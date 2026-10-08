import { createHash, randomUUID } from "node:crypto";
import { env } from "@enough/config";
import { pool } from "@enough/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { decryptSecret, encryptSecret, hashToken, newToken, normalizeEmail } from "./crypto.js";
import { checkRateLimit } from "./rate-limit.js";
import {
  authenticate,
  clearPreAuthCsrf,
  createSession,
  sessionPayload,
  setSessionCookies,
  toPublicUser,
  validatePreAuthCsrf,
  validateSessionCsrf,
} from "./session.js";

type Provider = "google" | "github";
interface ProviderUser {
  subject: string;
  email: string;
  displayName: string | null;
}

function providerConfigured(provider: Provider): boolean {
  return provider === "google"
    ? Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
    : Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
}

function providerCredentials(provider: Provider): { clientId: string; clientSecret: string } {
  const clientId = provider === "google" ? env.GOOGLE_CLIENT_ID : env.GITHUB_CLIENT_ID;
  const clientSecret = provider === "google" ? env.GOOGLE_CLIENT_SECRET : env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("OAuth provider is not configured.");
  return { clientId, clientSecret };
}

function callbackUrl(provider: Provider): string {
  return `${env.API_BASE_URL.replace(/\/$/, "")}/auth/oauth/${provider}/callback`;
}

function providerRedirect(_provider: Provider, error: string): string {
  const destination = new URL("/login", env.APP_BASE_URL);
  destination.searchParams.set("oauth", error);
  return destination.toString();
}

async function rateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  action: string,
): Promise<boolean> {
  return checkRateLimit(request, reply, `oauth:${action}:ip`, request.ip, 20, 900);
}

async function takeOAuthState(
  provider: Provider,
  state: string,
): Promise<{ verifier: string; csrfBindingHash: Buffer } | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      encrypted_code_verifier: Buffer;
      csrf_binding_hash: Buffer;
    }>(
      `SELECT encrypted_code_verifier, csrf_binding_hash
       FROM enough.auth_oauth_states
       WHERE state_hash = $1 AND provider = $2 AND consumed_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [hashToken(state), provider],
    );
    const row = result.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      "UPDATE enough.auth_oauth_states SET consumed_at = now() WHERE state_hash = $1",
      [hashToken(state)],
    );
    await client.query("COMMIT");
    return {
      verifier: decryptSecret(row.encrypted_code_verifier),
      csrfBindingHash: row.csrf_binding_hash,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function exchangeCode(provider: Provider, code: string, verifier: string): Promise<string> {
  const { clientId, clientSecret } = providerCredentials(provider);
  const fields = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: callbackUrl(provider),
    code_verifier: verifier,
    grant_type: "authorization_code",
  });
  const endpoint =
    provider === "google"
      ? "https://oauth2.googleapis.com/token"
      : "https://github.com/login/oauth/access_token";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: fields,
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`OAuth token exchange failed with HTTP ${response.status}`);
  const body = z.object({ access_token: z.string().min(1) }).safeParse(await response.json());
  if (!body.success) throw new Error("OAuth provider returned an invalid token response.");
  return body.data.access_token;
}

async function googleUser(accessToken: string): Promise<ProviderUser> {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Google userinfo failed with HTTP ${response.status}`);
  const parsed = z
    .object({
      sub: z.string().min(1).max(255),
      email: z.string().email().max(320),
      email_verified: z.boolean(),
      name: z.string().max(200).optional(),
    })
    .safeParse(await response.json());
  if (!parsed.success || !parsed.data.email_verified)
    throw new Error("Google did not provide a verified email address.");
  return {
    subject: parsed.data.sub,
    email: parsed.data.email,
    displayName: parsed.data.name?.trim().slice(0, 80) || null,
  };
}

async function githubUser(accessToken: string): Promise<ProviderUser> {
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${accessToken}`,
    "x-github-api-version": "2026-03-10",
  };
  const userResponse = await fetch("https://api.github.com/user", {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!userResponse.ok)
    throw new Error(`GitHub user lookup failed with HTTP ${userResponse.status}`);
  const user = z
    .object({
      id: z.number().int().positive(),
      name: z.string().nullable().optional(),
      login: z.string().min(1).max(100),
    })
    .safeParse(await userResponse.json());
  if (!user.success) throw new Error("GitHub returned an invalid user response.");

  const emailResponse = await fetch("https://api.github.com/user/emails?per_page=100", {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!emailResponse.ok)
    throw new Error(`GitHub email lookup failed with HTTP ${emailResponse.status}`);
  const emails = z
    .array(
      z.object({ email: z.string().email().max(320), primary: z.boolean(), verified: z.boolean() }),
    )
    .safeParse(await emailResponse.json());
  if (!emails.success) throw new Error("GitHub returned an invalid email response.");
  const email =
    emails.data.find((candidate) => candidate.primary && candidate.verified) ??
    emails.data.find((candidate) => candidate.verified);
  if (!email) throw new Error("GitHub did not provide a verified email address.");
  return {
    subject: String(user.data.id),
    email: email.email,
    displayName: user.data.name?.trim().slice(0, 80) || user.data.login,
  };
}

async function resolveOAuthUser(
  provider: Provider,
  identity: ProviderUser,
): Promise<{
  id: string;
  email: string;
  displayName: string | null;
  emailVerifiedAt: Date;
  createdAt: Date;
}> {
  const email = normalizeEmail(identity.email);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locks = [`email:${email}`, `identity:${provider}:${identity.subject}`].sort();
    for (const lock of locks)
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lock]);

    let linked = await client.query<{
      id: string;
      email: string;
      display_name: string | null;
      email_verified_at: Date | null;
      created_at: Date;
    }>(
      `SELECT u.id, u.email, u.display_name, u.email_verified_at, u.created_at
       FROM enough.auth_identities i JOIN enough.auth_users u ON u.id = i.user_id
       WHERE i.provider = $1 AND i.provider_subject = $2
       FOR UPDATE OF u`,
      [provider, identity.subject],
    );
    let user = linked.rows[0];
    if (!user) {
      const existing = await client.query<{
        id: string;
        email: string;
        display_name: string | null;
        email_verified_at: Date | null;
        created_at: Date;
      }>(
        `SELECT id, email, display_name, email_verified_at, created_at
         FROM enough.auth_users WHERE email_normalized = $1 FOR UPDATE`,
        [email],
      );
      user = existing.rows[0];
      if (!user) {
        const inserted = await client.query<{
          id: string;
          email: string;
          display_name: string | null;
          email_verified_at: Date;
          created_at: Date;
        }>(
          `INSERT INTO enough.auth_users
             (id, email, email_normalized, display_name, email_verified_at)
           VALUES ($1, $2, $3, $4, now())
           RETURNING id, email, display_name, email_verified_at, created_at`,
          [randomUUID(), identity.email, email, identity.displayName],
        );
        user = inserted.rows[0];
        await client.query(
          `INSERT INTO enough.auth_audit_events (id, user_id, event_type)
           VALUES ($1, $2, 'account.created')`,
          [randomUUID(), user.id],
        );
      } else {
        const updated = await client.query<{
          id: string;
          email: string;
          display_name: string | null;
          email_verified_at: Date;
          created_at: Date;
        }>(
          `UPDATE enough.auth_users
           SET email_verified_at = COALESCE(email_verified_at, now()),
               display_name = COALESCE(display_name, $2), updated_at = now()
           WHERE id = $1
           RETURNING id, email, display_name, email_verified_at, created_at`,
          [user.id, identity.displayName],
        );
        user = updated.rows[0];
      }

      await client.query(
        `INSERT INTO enough.auth_identities (id, user_id, provider, provider_subject)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (provider, provider_subject) DO NOTHING`,
        [randomUUID(), user.id, provider, identity.subject],
      );
      linked = await client.query<{
        id: string;
        email: string;
        display_name: string | null;
        email_verified_at: Date;
        created_at: Date;
      }>(
        `SELECT u.id, u.email, u.display_name, u.email_verified_at, u.created_at
         FROM enough.auth_identities i JOIN enough.auth_users u ON u.id = i.user_id
         WHERE i.provider = $1 AND i.provider_subject = $2`,
        [provider, identity.subject],
      );
      user = linked.rows[0];
    }

    if (!user?.email_verified_at) {
      throw new Error("OAuth identity did not resolve to a verified account.");
    }
    await client.query(
      `INSERT INTO enough.auth_audit_events (id, user_id, event_type)
       VALUES ($1, $2, $3)`,
      [randomUUID(), user.id, `oauth.${provider}.login`],
    );
    await client.query("COMMIT");
    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      emailVerifiedAt: user.email_verified_at,
      createdAt: user.created_at,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function oauthProvider(value: unknown): Provider | null {
  return value === "google" || value === "github" ? value : null;
}

export async function registerOAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/auth/providers", async () => ({
    emailPassword: true,
    passwordless: true,
    google: providerConfigured("google"),
    github: providerConfigured("github"),
    passkeys: false,
  }));

  app.get("/auth/identities", async (request, reply) => {
    const session = await authenticate(request);
    if (!session) return reply.code(401).send({ error: "Authentication required." });
    if (!(await checkRateLimit(request, reply, "oauth:identities-read", session.id, 60, 60)))
      return;
    const [account, identities] = await Promise.all([
      pool.query<{ has_password: boolean }>(
        "SELECT password_hash IS NOT NULL AS has_password FROM enough.auth_users WHERE id = $1",
        [session.id],
      ),
      pool.query(
        "SELECT provider, created_at FROM enough.auth_identities WHERE user_id = $1 ORDER BY provider",
        [session.id],
      ),
    ]);
    return reply.send({
      hasPassword: Boolean(account.rows[0]?.has_password),
      identities: identities.rows,
    });
  });

  app.delete("/auth/identities/:provider", async (request, reply) => {
    const session = await authenticate(request);
    if (!session) return reply.code(401).send({ error: "Authentication required." });
    if (!validateSessionCsrf(request, session))
      return reply
        .code(403)
        .send({ error: "The request could not be verified. Refresh and try again." });
    if (!(await checkRateLimit(request, reply, "oauth:disconnect", session.id, 10, 60 * 60)))
      return;
    const provider = oauthProvider((request.params as { provider?: string }).provider);
    if (!provider) return reply.code(404).send({ error: "Provider not found." });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const account = await client.query<{ password_hash: string | null }>(
        "SELECT password_hash FROM enough.auth_users WHERE id = $1 FOR UPDATE",
        [session.id],
      );
      if (!account.rows[0]) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Account not found." });
      }
      const identity = await client.query(
        "SELECT 1 FROM enough.auth_identities WHERE user_id = $1 AND provider = $2 FOR UPDATE",
        [session.id, provider],
      );
      if (identity.rowCount !== 1) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "That sign-in method is not linked." });
      }
      const alternatives = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM enough.auth_identities WHERE user_id = $1 AND provider <> $2",
        [session.id, provider],
      );
      if (!account.rows[0].password_hash && Number(alternatives.rows[0]?.count ?? 0) === 0) {
        await client.query("ROLLBACK");
        return reply.code(409).send({
          error: "Add a password or another sign-in method before disconnecting the last one.",
        });
      }
      await client.query(
        "DELETE FROM enough.auth_identities WHERE user_id = $1 AND provider = $2",
        [session.id, provider],
      );
      await client.query(
        `INSERT INTO enough.auth_audit_events (id, user_id, event_type, metadata)
         VALUES ($1, $2, 'oauth.identity.disconnected', $3::jsonb)`,
        [randomUUID(), session.id, JSON.stringify({ provider })],
      );
      await client.query("COMMIT");
      return reply.send({ provider, disconnected: true });
    } catch (error) {
      await client.query("ROLLBACK");
      request.log.error({ err: error, provider }, "OAuth identity could not be disconnected");
      return reply.code(503).send({ error: "Sign-in method could not be disconnected." });
    } finally {
      client.release();
    }
  });

  app.post("/auth/oauth/:provider/start", async (request, reply) => {
    const provider = oauthProvider((request.params as { provider?: string }).provider);
    if (!provider) return reply.code(404).send({ error: "Provider not found." });
    if (!providerConfigured(provider))
      return reply.code(503).send({ error: `${provider} sign-in is not configured.` });
    if (!validatePreAuthCsrf(request))
      return reply
        .code(403)
        .send({ error: "The request could not be verified. Refresh and try again." });
    if (!(await rateLimit(request, reply, `${provider}:start`))) return;
    const csrfHeader = request.headers["x-csrf-token"];
    if (typeof csrfHeader !== "string")
      return reply.code(403).send({ error: "The request could not be verified." });

    const state = newToken();
    const verifier = newToken();
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    await pool.query(
      `INSERT INTO enough.auth_oauth_states
         (state_hash, provider, encrypted_code_verifier, csrf_binding_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '10 minutes')`,
      [hashToken(state), provider, encryptSecret(verifier), hashToken(csrfHeader)],
    );
    await pool.query(
      "DELETE FROM enough.auth_oauth_states WHERE expires_at < now() - interval '1 day'",
    );

    const { clientId } = providerCredentials(provider);
    const authorizeUrl = new URL(
      provider === "google"
        ? "https://accounts.google.com/o/oauth2/v2/auth"
        : "https://github.com/login/oauth/authorize",
    );
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", callbackUrl(provider));
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set(
      "scope",
      provider === "google" ? "openid profile email" : "read:user user:email",
    );
    return reply.send({ authorizationUrl: authorizeUrl.toString() });
  });

  app.get("/auth/oauth/:provider/callback", async (request, reply) => {
    const provider = oauthProvider((request.params as { provider?: string }).provider);
    if (!provider) return reply.code(404).send({ error: "Provider not found." });
    if (!(await rateLimit(request, reply, "callback"))) return;
    const parsed = z
      .object({
        code: z.string().min(1).max(4096).optional(),
        state: z.string().min(40).max(128),
        error: z.string().optional(),
      })
      .safeParse(request.query);
    if (!parsed.success) return reply.redirect(providerRedirect(provider, "error"));
    try {
      const state = await takeOAuthState(provider, parsed.data.state);
      if (!state) return reply.redirect(providerRedirect(provider, "error"));
      if (parsed.data.error) return reply.redirect(providerRedirect(provider, "cancelled"));
      if (!parsed.data.code) return reply.redirect(providerRedirect(provider, "error"));

      const accessToken = await exchangeCode(provider, parsed.data.code, state.verifier);
      const identity =
        provider === "google" ? await googleUser(accessToken) : await githubUser(accessToken);
      const user = await resolveOAuthUser(provider, identity);
      const exchangeToken = newToken();
      await pool.query(
        `INSERT INTO enough.auth_tokens
           (id, user_id, token_hash, purpose, binding_hash, source_provider, expires_at)
         VALUES ($1, $2, $3, 'oauth_exchange', $4, $5, now() + interval '2 minutes')`,
        [randomUUID(), user.id, hashToken(exchangeToken), state.csrfBindingHash, provider],
      );
      const destination = new URL("/oauth/complete", env.APP_BASE_URL);
      destination.hash = `token=${exchangeToken}`;
      return reply.redirect(destination.toString());
    } catch (error) {
      request.log.warn({ err: error, provider }, "OAuth sign-in did not complete");
      return reply.redirect(providerRedirect(provider, "error"));
    }
  });

  app.post("/auth/oauth/consume", async (request, reply) => {
    const parsed = z.object({ token: z.string().min(40).max(128) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid request." });
    if (!validatePreAuthCsrf(request))
      return reply
        .code(403)
        .send({ error: "The request could not be verified. Refresh and try again." });
    if (!(await rateLimit(request, reply, "consume"))) return;
    const csrfHeader = request.headers["x-csrf-token"];
    if (typeof csrfHeader !== "string")
      return reply.code(403).send({ error: "The request could not be verified." });

    const client = await pool.connect();
    let user: ProviderUser & { id: string; createdAt: Date; emailVerifiedAt: Date };
    let authMethod: Provider;
    try {
      await client.query("BEGIN");
      const found = await client.query<{
        user_id: string;
        email: string;
        display_name: string | null;
        email_verified_at: Date | null;
        created_at: Date;
        source_provider: Provider;
      }>(
        `SELECT u.id AS user_id, u.email, u.display_name, u.email_verified_at, u.created_at, t.source_provider
         FROM enough.auth_tokens t JOIN enough.auth_users u ON u.id = t.user_id
         WHERE t.token_hash = $1 AND t.purpose = 'oauth_exchange'
           AND t.binding_hash = $2 AND t.consumed_at IS NULL AND t.expires_at > now()
         FOR UPDATE OF t, u`,
        [hashToken(parsed.data.token), hashToken(csrfHeader)],
      );
      const row = found.rows[0];
      if (!row?.email_verified_at) {
        await client.query("ROLLBACK");
        return reply.code(400).send({ error: "This sign-in has expired. Start again." });
      }
      await client.query(
        "UPDATE enough.auth_tokens SET consumed_at = now() WHERE token_hash = $1",
        [hashToken(parsed.data.token)],
      );
      await client.query(
        `INSERT INTO enough.auth_audit_events (id, user_id, event_type)
         VALUES ($1, $2, 'oauth.exchange.completed')`,
        [randomUUID(), row.user_id],
      );
      await client.query("COMMIT");
      user = {
        id: row.user_id,
        email: row.email,
        subject: "",
        displayName: row.display_name,
        emailVerifiedAt: row.email_verified_at,
        createdAt: row.created_at,
      };
      authMethod = row.source_provider;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const issue = await createSession(user.id, "web", "Web browser", authMethod);
    setSessionCookies(reply, issue);
    clearPreAuthCsrf(reply);
    return reply.send({ user: toPublicUser(user), ...sessionPayload(issue) });
  });
}
