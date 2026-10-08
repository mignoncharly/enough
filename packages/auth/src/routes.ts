import { randomUUID } from "node:crypto";
import { env } from "@enough/config";
import { pool } from "@enough/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  hashPassword,
  hashToken,
  newToken,
  normalizeEmail,
  validPassword,
  verifyPassword,
} from "./crypto.js";
import { type AuthEmailPurpose, sendAuthEmail } from "./email.js";
import { checkRateLimit } from "./rate-limit.js";
import {
  type AuthMethod,
  type AuthSession,
  authenticate,
  type ClientType,
  clearSessionCookies,
  createSession,
  issuePreAuthCsrf,
  sessionPayload,
  setSessionCookies,
  toPublicUser,
  validatePreAuthCsrf,
  validateSessionCsrf,
} from "./session.js";

const emailSchema = z.string().trim().email().max(320);
const clientTypeSchema = z.enum(["web", "desktop", "extension"]);
const deviceNameSchema = z.string().trim().min(1).max(80);
const passwordSchema = z.string().min(12).max(1024);
const genericActionResponse = {
  message: "If the account can use this action, an email will arrive shortly.",
};

function invalidRequest(reply: FastifyReply): void {
  reply.code(400).send({ error: "Invalid request." });
}

async function rateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  action: string,
  email: string | null,
): Promise<boolean> {
  const ipLimit = action === "password-reset-consume" ? 10 : 40;
  if (!(await checkRateLimit(request, reply, `${action}:ip`, request.ip, ipLimit, 900)))
    return false;
  if (email) {
    const tokenEmailAction = ["magic-link", "password-reset", "verify-email"].includes(action);
    const emailLimit = tokenEmailAction ? 3 : 8;
    const emailWindow = tokenEmailAction ? 3_600 : 900;
    if (!(await checkRateLimit(request, reply, `${action}:email`, email, emailLimit, emailWindow)))
      return false;
  }
  return true;
}

function clientTypeAllowed(request: FastifyRequest, clientType: ClientType): boolean {
  const origin = request.headers.origin;
  return !(origin === new URL(env.APP_BASE_URL).origin && clientType !== "web");
}

async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthSession | null> {
  try {
    const session = await authenticate(request);
    if (session) return session;
  } catch (error) {
    request.log.error({ err: error }, "Could not load authentication session");
    reply.code(503).send({ error: "Authentication is temporarily unavailable." });
    return null;
  }
  reply.code(401).send({ error: "Authentication required." });
  return null;
}

function requireCsrf(request: FastifyRequest, reply: FastifyReply, session: AuthSession): boolean {
  if (validateSessionCsrf(request, session)) return true;
  reply.code(403).send({ error: "The request could not be verified. Refresh and try again." });
  return false;
}

async function removeStripeCustomer(userId: string): Promise<void> {
  const customer = await pool.query<{ stripe_customer_id: string }>(
    "SELECT stripe_customer_id FROM enough.billing_customers WHERE user_id = $1",
    [userId],
  );
  const customerId = customer.rows[0]?.stripe_customer_id;
  if (!customerId) return;
  if (!env.STRIPE_SECRET_KEY) throw new Error("Stripe account cleanup is not configured.");

  const endpoint = `https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`;
  const requestStripe = async (method: "GET" | "DELETE") => {
    try {
      return await fetch(endpoint, {
        method,
        headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error("Stripe account cleanup request failed.");
    }
  };
  const existing = await requestStripe("GET");
  if (existing.status === 404) {
    await existing.text().catch(() => "");
    return;
  }
  const existingBody = (await existing.json().catch(() => null)) as { deleted?: boolean } | null;
  if (!existing.ok) throw new Error(`Stripe account cleanup failed (${existing.status}).`);
  if (existingBody?.deleted) return;

  // Stripe's customer deletion immediately cancels active subscriptions and removes payment details.
  const deleted = await requestStripe("DELETE");
  if (deleted.status === 404) return;
  if (!deleted.ok) throw new Error(`Stripe account cleanup failed (${deleted.status}).`);
  await deleted.json().catch(() => null);
}

async function issueEmailToken(
  request: FastifyRequest,
  userId: string,
  recipient: string,
  purpose: AuthEmailPurpose,
): Promise<void> {
  const token = newToken();
  const tokenHash = hashToken(token);
  const lifetimeHours = purpose === "verify_email" ? 24 : purpose === "password_reset" ? 1 : 0.25;
  const id = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM enough.auth_tokens
       WHERE expires_at < now() - interval '30 days'
          OR consumed_at < now() - interval '30 days'`,
    );
    await client.query(
      `UPDATE enough.auth_tokens SET consumed_at = now()
       WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [userId, purpose],
    );
    await client.query(
      `INSERT INTO enough.auth_tokens (id, user_id, token_hash, purpose, expires_at)
       VALUES ($1, $2, $3, $4, now() + ($5 * interval '1 hour'))`,
      [id, userId, tokenHash, purpose, lifetimeHours],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const path =
    purpose === "verify_email"
      ? "/verify-email"
      : purpose === "password_reset"
        ? "/reset-password"
        : "/login";
  const actionUrl = new URL(path, env.APP_BASE_URL);
  actionUrl.hash = `token=${token}`;
  void sendAuthEmail(purpose, recipient, actionUrl.toString(), tokenHash).catch(
    (error: unknown) => {
      request.log.warn(
        { err: error, purpose },
        "Transactional authentication email could not be delivered",
      );
    },
  );
}

async function consumeToken(
  tokenValue: string,
  purpose: AuthEmailPurpose,
): Promise<{
  id: string;
  email: string;
  displayName: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
} | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<{
      id: string;
      email: string;
      display_name: string | null;
      email_verified_at: Date | null;
      created_at: Date;
    }>(
      `SELECT u.id, u.email, u.display_name, u.email_verified_at, u.created_at
       FROM enough.auth_tokens t
       JOIN enough.auth_users u ON u.id = t.user_id
       WHERE t.token_hash = $1 AND t.purpose = $2
         AND t.consumed_at IS NULL AND t.expires_at > now()
       FOR UPDATE OF t, u`,
      [hashToken(tokenValue), purpose],
    );
    const row = found.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return null;
    }

    await client.query("UPDATE enough.auth_tokens SET consumed_at = now() WHERE token_hash = $1", [
      hashToken(tokenValue),
    ]);
    if (purpose === "verify_email") {
      await client.query(
        "UPDATE enough.auth_users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1",
        [row.id],
      );
    }
    await client.query(
      `INSERT INTO enough.auth_audit_events (id, user_id, event_type)
       VALUES ($1, $2, $3)`,
      [randomUUID(), row.id, `${purpose}.consumed`],
    );
    await client.query("COMMIT");
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      emailVerifiedAt:
        purpose === "verify_email" ? (row.email_verified_at ?? new Date()) : row.email_verified_at,
      createdAt: row.created_at,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/auth/csrf", async (_request, reply) => issuePreAuthCsrf(reply));

  app.post("/auth/signup", async (request, reply) => {
    const parsed = z
      .object({
        email: emailSchema,
        password: passwordSchema,
        displayName: z.string().trim().max(80).optional(),
        clientType: clientTypeSchema.default("web"),
      })
      .safeParse(request.body);
    if (!parsed.success || !validPassword(parsed.data.password)) return invalidRequest(reply);
    const body = parsed.data;
    if (!clientTypeAllowed(request, body.clientType))
      return reply.code(400).send({ error: "Invalid client type." });
    if (body.clientType === "web" && !validatePreAuthCsrf(request)) {
      return reply
        .code(403)
        .send({ error: "The request could not be verified. Refresh and try again." });
    }
    const email = normalizeEmail(body.email);
    if (!(await rateLimit(request, reply, "signup", email))) return;

    const passwordHash = await hashPassword(body.password);
    let user: { id: string; email_verified_at: Date | null } | undefined;
    try {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const inserted = await client.query<{ id: string; email_verified_at: Date | null }>(
          `INSERT INTO enough.auth_users (id, email, email_normalized, display_name, password_hash)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (email_normalized) DO NOTHING
           RETURNING id, email_verified_at`,
          [randomUUID(), body.email.trim(), email, body.displayName?.trim() || null, passwordHash],
        );
        user = inserted.rows[0];
        if (user) {
          await client.query(
            `INSERT INTO enough.auth_audit_events (id, user_id, event_type)
             VALUES ($1, $2, 'account.created')`,
            [randomUUID(), user.id],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      request.log.error({ err: error }, "Could not create authentication account");
      return reply.code(503).send({ error: "Account creation is temporarily unavailable." });
    }

    if (user) {
      await issueEmailToken(request, user.id, body.email.trim(), "verify_email");
    } else {
      const existing = await pool.query<{ id: string; email_verified_at: Date | null }>(
        "SELECT id, email_verified_at FROM enough.auth_users WHERE email_normalized = $1",
        [email],
      );
      if (existing.rows[0] && !existing.rows[0].email_verified_at) {
        await issueEmailToken(request, existing.rows[0].id, body.email.trim(), "verify_email");
      }
    }
    return reply.code(202).send(genericActionResponse);
  });

  app.post("/auth/login", async (request, reply) => {
    const parsed = z
      .object({
        email: emailSchema,
        password: z.string().min(1).max(1024),
        clientType: clientTypeSchema.default("web"),
        deviceName: deviceNameSchema.optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return invalidRequest(reply);
    const body = parsed.data;
    if (!clientTypeAllowed(request, body.clientType))
      return reply.code(400).send({ error: "Invalid client type." });
    if (body.clientType === "web" && !validatePreAuthCsrf(request)) {
      return reply
        .code(403)
        .send({ error: "The request could not be verified. Refresh and try again." });
    }
    const email = normalizeEmail(body.email);
    if (!(await rateLimit(request, reply, "login", email))) return;

    const result = await pool.query<{
      id: string;
      email: string;
      display_name: string | null;
      password_hash: string | null;
      email_verified_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, email, display_name, password_hash, email_verified_at, created_at
       FROM enough.auth_users WHERE email_normalized = $1`,
      [email],
    );
    const user = result.rows[0];
    const passwordMatches = await verifyPassword(body.password, user?.password_hash ?? "");
    if (!user || !passwordMatches)
      return reply.code(401).send({ error: "Email or password is incorrect." });
    if (!user.email_verified_at)
      return reply.code(403).send({ error: "Verify your email address before signing in." });

    const issue = await createSession(
      user.id,
      body.clientType,
      body.deviceName ?? (body.clientType === "web" ? "Web browser" : `${body.clientType} device`),
      "password",
    );
    setSessionCookies(reply, issue);
    return reply.send({
      user: toPublicUser({
        ...user,
        displayName: user.display_name,
        emailVerifiedAt: user.email_verified_at,
        createdAt: user.created_at,
      }),
      ...sessionPayload(issue),
    });
  });

  app.post("/auth/magic-link/request", async (request, reply) => {
    const parsed = z.object({ email: emailSchema }).safeParse(request.body);
    if (!parsed.success) return invalidRequest(reply);
    if (!validatePreAuthCsrf(request))
      return reply.code(403).send({ error: "The request could not be verified." });
    const email = normalizeEmail(parsed.data.email);
    if (!(await rateLimit(request, reply, "magic-link", email))) return;
    const found = await pool.query<{ id: string; email: string; email_verified_at: Date | null }>(
      "SELECT id, email, email_verified_at FROM enough.auth_users WHERE email_normalized = $1",
      [email],
    );
    if (found.rows[0]?.email_verified_at) {
      await issueEmailToken(request, found.rows[0].id, found.rows[0].email, "magic_link");
    }
    return reply.code(202).send(genericActionResponse);
  });

  app.post("/auth/magic-link/consume", async (request, reply) => {
    const parsed = z
      .object({
        token: z.string().min(40).max(128),
        clientType: clientTypeSchema.default("web"),
        deviceName: deviceNameSchema.optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return invalidRequest(reply);
    const body = parsed.data;
    if (!clientTypeAllowed(request, body.clientType))
      return reply.code(400).send({ error: "Invalid client type." });
    if (body.clientType === "web" && !validatePreAuthCsrf(request)) {
      return reply
        .code(403)
        .send({ error: "The request could not be verified. Refresh and try again." });
    }
    if (!(await rateLimit(request, reply, "magic-consume", null))) return;
    const user = await consumeToken(body.token, "magic_link");
    if (!user?.emailVerifiedAt)
      return reply.code(400).send({ error: "This sign-in link is invalid or has expired." });
    const issue = await createSession(
      user.id,
      body.clientType,
      body.deviceName ?? "Web browser",
      "magic_link",
    );
    setSessionCookies(reply, issue);
    return reply.send({ user: toPublicUser(user), ...sessionPayload(issue) });
  });

  app.post("/auth/email-verification/resend", async (request, reply) => {
    const parsed = z.object({ email: emailSchema }).safeParse(request.body);
    if (!parsed.success) return invalidRequest(reply);
    if (!validatePreAuthCsrf(request))
      return reply.code(403).send({ error: "The request could not be verified." });
    const email = normalizeEmail(parsed.data.email);
    if (!(await rateLimit(request, reply, "verify-email", email))) return;
    const found = await pool.query<{ id: string; email: string; email_verified_at: Date | null }>(
      "SELECT id, email, email_verified_at FROM enough.auth_users WHERE email_normalized = $1",
      [email],
    );
    if (found.rows[0] && !found.rows[0].email_verified_at) {
      await issueEmailToken(request, found.rows[0].id, found.rows[0].email, "verify_email");
    }
    return reply.code(202).send(genericActionResponse);
  });

  app.post("/auth/email-verification/consume", async (request, reply) => {
    const parsed = z.object({ token: z.string().min(40).max(128) }).safeParse(request.body);
    if (!parsed.success) return invalidRequest(reply);
    if (!(await rateLimit(request, reply, "verify-consume", null))) return;
    const user = await consumeToken(parsed.data.token, "verify_email");
    if (!user)
      return reply.code(400).send({ error: "This verification link is invalid or has expired." });
    return reply.send({ message: "Email verified. You can now sign in." });
  });

  app.post("/auth/password-reset/request", async (request, reply) => {
    const parsed = z.object({ email: emailSchema }).safeParse(request.body);
    if (!parsed.success) return invalidRequest(reply);
    if (!validatePreAuthCsrf(request))
      return reply.code(403).send({ error: "The request could not be verified." });
    const email = normalizeEmail(parsed.data.email);
    if (!(await rateLimit(request, reply, "password-reset", email))) return;
    const found = await pool.query<{ id: string; email: string; password_hash: string | null }>(
      "SELECT id, email, password_hash FROM enough.auth_users WHERE email_normalized = $1",
      [email],
    );
    if (found.rows[0]?.password_hash) {
      await issueEmailToken(request, found.rows[0].id, found.rows[0].email, "password_reset");
    }
    return reply.code(202).send(genericActionResponse);
  });

  app.post("/auth/password-reset/consume", async (request, reply) => {
    const parsed = z
      .object({ token: z.string().min(40).max(128), newPassword: passwordSchema })
      .safeParse(request.body);
    if (!parsed.success || !validPassword(parsed.data.newPassword)) return invalidRequest(reply);
    if (!(await rateLimit(request, reply, "password-reset-consume", null))) return;
    const passwordHash = await hashPassword(parsed.data.newPassword);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<{ user_id: string }>(
        `SELECT user_id FROM enough.auth_tokens
         WHERE token_hash = $1 AND purpose = 'password_reset'
           AND consumed_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [hashToken(parsed.data.token)],
      );
      const user = found.rows[0];
      if (!user) {
        await client.query("ROLLBACK");
        return reply
          .code(400)
          .send({ error: "This password reset link is invalid or has expired." });
      }
      await client.query(
        "UPDATE enough.auth_tokens SET consumed_at = now() WHERE token_hash = $1",
        [hashToken(parsed.data.token)],
      );
      await client.query(
        "UPDATE enough.auth_users SET password_hash = $2, updated_at = now() WHERE id = $1",
        [user.user_id, passwordHash],
      );
      await client.query(
        "UPDATE enough.auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
        [user.user_id],
      );
      await client.query(
        `UPDATE enough.auth_tokens SET consumed_at = now()
         WHERE user_id = $1 AND purpose IN ('password_reset', 'magic_link') AND consumed_at IS NULL`,
        [user.user_id],
      );
      await client.query(
        `INSERT INTO enough.auth_audit_events (id, user_id, event_type)
         VALUES ($1, $2, 'password.reset')`,
        [randomUUID(), user.user_id],
      );
      await client.query("COMMIT");
      clearSessionCookies(reply);
      return reply.send({ message: "Password updated. Sign in with your new password." });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.get("/auth/me", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!(await checkRateLimit(request, reply, "auth:me", session.id, 120, 60))) return;
    return reply.send({
      user: toPublicUser(session),
      session: {
        id: session.sessionId,
        deviceId: session.deviceId,
        authMethod: session.authMethod,
        createdAt: session.sessionCreatedAt.toISOString(),
        expiresAt: session.sessionExpiresAt.toISOString(),
      },
    });
  });

  app.post("/auth/logout", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "auth:logout", session.id, 60, 60 * 60))) return;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE enough.auth_sessions SET revoked_at = now() WHERE id = $1", [
        session.sessionId,
      ]);
      await client.query(
        `INSERT INTO enough.auth_audit_events (id, user_id, device_id, event_type)
         VALUES ($1, $2, $3, 'session.revoked')`,
        [randomUUID(), session.id, session.deviceId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    clearSessionCookies(reply);
    return reply.code(204).send();
  });

  app.post("/auth/session/rotate", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "auth:session-rotate", session.id, 20, 60 * 60)))
      return;
    const token = newToken();
    const csrfToken = session.credentialType === "cookie" ? newToken() : null;
    const expiresAt = new Date(Date.now() + env.AUTH_SESSION_DAYS * 24 * 60 * 60 * 1000);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE enough.auth_sessions
         SET token_hash = $2, csrf_token_hash = $3, created_at = now(), expires_at = $4, last_seen_at = now()
         WHERE id = $1 AND revoked_at IS NULL`,
        [session.sessionId, hashToken(token), csrfToken ? hashToken(csrfToken) : null, expiresAt],
      );
      if (!updated.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(401).send({ error: "Your session has expired." });
      }
      await client.query(
        `INSERT INTO enough.auth_audit_events (id, user_id, device_id, event_type)
         VALUES ($1, $2, $3, 'session.rotated')`,
        [randomUUID(), session.id, session.deviceId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const issue = {
      sessionId: session.sessionId,
      deviceId: session.deviceId,
      token,
      csrfToken,
      expiresAt,
      credentialType: session.credentialType,
    };
    setSessionCookies(reply, issue);
    return reply.send(sessionPayload(issue));
  });

  app.get("/auth/sessions", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!(await checkRateLimit(request, reply, "auth:sessions-read", session.id, 60, 60))) return;
    const result = await pool.query<{
      id: string;
      device_id: string;
      name: string;
      client_type: ClientType;
      auth_method: AuthMethod;
      created_at: Date;
      expires_at: Date;
      last_seen_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT s.id, s.device_id, d.name, d.client_type, s.auth_method, s.created_at,
              s.expires_at, s.last_seen_at, s.revoked_at
       FROM enough.auth_sessions s
       JOIN enough.auth_devices d ON d.id = s.device_id
       WHERE s.user_id = $1
       ORDER BY s.last_seen_at DESC`,
      [session.id],
    );
    return reply.send({
      sessions: result.rows.map((row) => ({
        id: row.id,
        deviceId: row.device_id,
        deviceName: row.name,
        clientType: row.client_type,
        authMethod: row.auth_method,
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
        lastSeenAt: row.last_seen_at.toISOString(),
        revoked: Boolean(row.revoked_at),
        current: row.id === session.sessionId,
      })),
    });
  });

  app.post("/auth/sessions", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "auth:sessions-create", session.id, 20, 60 * 60)))
      return;
    const parsed = z
      .object({ clientType: clientTypeSchema, deviceName: deviceNameSchema })
      .safeParse(request.body);
    if (!parsed.success) return invalidRequest(reply);
    if (session.credentialType === "bearer" && parsed.data.clientType === "web")
      return invalidRequest(reply);
    const issue = await createSession(
      session.id,
      parsed.data.clientType,
      parsed.data.deviceName,
      session.authMethod,
    );
    setSessionCookies(reply, issue);
    return reply.code(201).send(sessionPayload(issue));
  });

  app.delete("/auth/sessions/:sessionId", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "auth:sessions-revoke", session.id, 60, 60 * 60)))
      return;
    const parsed = z
      .string()
      .uuid()
      .safeParse((request.params as { sessionId?: string }).sessionId);
    if (!parsed.success) return invalidRequest(reply);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ device_id: string }>(
        `UPDATE enough.auth_sessions SET revoked_at = now()
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
         RETURNING device_id`,
        [parsed.data, session.id],
      );
      if (!result.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Session not found." });
      }
      await client.query(
        `INSERT INTO enough.auth_audit_events (id, user_id, device_id, event_type)
         VALUES ($1, $2, $3, 'session.revoked')`,
        [randomUUID(), session.id, result.rows[0].device_id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    if (parsed.data === session.sessionId) clearSessionCookies(reply);
    return reply.code(204).send();
  });

  app.get("/auth/devices", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!(await checkRateLimit(request, reply, "auth:devices-read", session.id, 60, 60))) return;
    const result = await pool.query<{
      id: string;
      name: string;
      client_type: ClientType;
      created_at: Date;
      last_seen_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT id, name, client_type, created_at, last_seen_at, revoked_at
       FROM enough.auth_devices WHERE user_id = $1 ORDER BY last_seen_at DESC`,
      [session.id],
    );
    return reply.send({
      devices: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        clientType: row.client_type,
        createdAt: row.created_at.toISOString(),
        lastSeenAt: row.last_seen_at.toISOString(),
        revoked: Boolean(row.revoked_at),
      })),
    });
  });

  app.delete("/auth/devices/:deviceId", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "auth:devices-revoke", session.id, 30, 60 * 60)))
      return;
    const parsed = z
      .string()
      .uuid()
      .safeParse((request.params as { deviceId?: string }).deviceId);
    if (!parsed.success) return invalidRequest(reply);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE enough.auth_devices SET revoked_at = now()
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [parsed.data, session.id],
      );
      if (!result.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Device not found." });
      }
      await client.query(
        `UPDATE enough.auth_sessions SET revoked_at = now()
         WHERE device_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [parsed.data, session.id],
      );
      await client.query(
        `INSERT INTO enough.auth_audit_events (id, user_id, device_id, event_type)
         VALUES ($1, $2, $3, 'device.revoked')`,
        [randomUUID(), session.id, parsed.data],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    if (parsed.data === session.deviceId) clearSessionCookies(reply);
    return reply.code(204).send();
  });

  app.post("/auth/password/change", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "auth:password-change", session.id, 5, 60 * 60)))
      return;
    const parsed = z
      .object({ currentPassword: z.string().min(1).max(1024), newPassword: passwordSchema })
      .safeParse(request.body);
    if (!parsed.success || !validPassword(parsed.data.newPassword)) return invalidRequest(reply);
    const result = await pool.query<{ password_hash: string | null }>(
      "SELECT password_hash FROM enough.auth_users WHERE id = $1",
      [session.id],
    );
    const oldHash = result.rows[0]?.password_hash;
    if (!oldHash || !(await verifyPassword(parsed.data.currentPassword, oldHash))) {
      return reply.code(400).send({ error: "Current password is incorrect." });
    }
    const passwordHash = await hashPassword(parsed.data.newPassword);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE enough.auth_users SET password_hash = $2, updated_at = now() WHERE id = $1",
        [session.id, passwordHash],
      );
      await client.query(
        "UPDATE enough.auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
        [session.id],
      );
      await client.query(
        `UPDATE enough.auth_tokens SET consumed_at = now()
         WHERE user_id = $1 AND purpose IN ('password_reset', 'magic_link') AND consumed_at IS NULL`,
        [session.id],
      );
      await client.query(
        `INSERT INTO enough.auth_audit_events (id, user_id, device_id, event_type)
         VALUES ($1, $2, $3, 'password.changed')`,
        [randomUUID(), session.id, session.deviceId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    clearSessionCookies(reply);
    return reply.send({ message: "Password changed. Sign in again with your new password." });
  });

  app.get("/auth/account/export", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!(await checkRateLimit(request, reply, "auth:account-export", session.id, 6, 60 * 60)))
      return;
    await pool.query(
      "INSERT INTO enough.privacy_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
      [session.id],
    );
    const [
      user,
      identities,
      devices,
      sessions,
      audit,
      onboarding,
      products,
      stageHistory,
      goals,
      metrics,
      growthTasks,
      growthTaskCompletions,
      taskEvidenceItems,
      integrationAccounts,
      integrationEvents,
      integrationSyncRuns,
      integrationErrors,
      activity,
      activityAggregates,
      toolMappings,
      policyRules,
      policyRuleVersions,
      policyOverrides,
      creditAccounts,
      creditTransactions,
      creditLots,
      creditReservations,
      creditReservationAllocations,
      creditTransactionAllocations,
      creditRefundAllocations,
      notificationPreferences,
      notifications,
    ] = await Promise.all([
      pool.query<{
        id: string;
        email: string;
        display_name: string | null;
        email_verified_at: Date | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT id, email, display_name, email_verified_at, created_at, updated_at
         FROM enough.auth_users WHERE id = $1`,
        [session.id],
      ),
      pool.query<{ provider: string; provider_subject: string; created_at: Date }>(
        "SELECT provider, provider_subject, created_at FROM enough.auth_identities WHERE user_id = $1",
        [session.id],
      ),
      pool.query(
        "SELECT id, name, client_type, created_at, last_seen_at, revoked_at FROM enough.auth_devices WHERE user_id = $1",
        [session.id],
      ),
      pool.query(
        "SELECT id, device_id, credential_type, auth_method, created_at, expires_at, last_seen_at, revoked_at FROM enough.auth_sessions WHERE user_id = $1",
        [session.id],
      ),
      pool.query(
        "SELECT id, device_id, event_type, created_at, metadata FROM enough.auth_audit_events WHERE user_id = $1 ORDER BY created_at",
        [session.id],
      ),
      pool.query(
        `SELECT product_description, target_customer, problem_statement, product_stage,
                has_launched, user_count, paying_user_count, current_revenue, revenue_currency,
                next_goal, build_tools, recommended_config, completed_at, created_at, updated_at
         FROM enough.onboarding_profiles WHERE user_id = $1`,
        [session.id],
      ),
      pool.query(
        `SELECT id, name, target_customer, problem_statement, product_stage, has_launched,
                user_count, paying_user_count, current_revenue, revenue_currency, created_at, updated_at
         FROM enough.products WHERE user_id = $1 ORDER BY created_at`,
        [session.id],
      ),
      pool.query(
        `SELECT history.id, history.product_id, history.from_stage, history.to_stage,
                history.change_reason, history.changed_at
         FROM enough.product_stage_history AS history
         JOIN enough.products AS product ON product.id = history.product_id
         WHERE product.user_id = $1 ORDER BY history.changed_at`,
        [session.id],
      ),
      pool.query(
        `SELECT id, product_id, goal_type, title, description, status, target_value,
                unit, is_primary, due_at, created_at, updated_at, completed_at
         FROM enough.product_goals WHERE user_id = $1 ORDER BY created_at`,
        [session.id],
      ),
      pool.query(
        `SELECT metric.id, metric.product_id, metric.metric_key, metric.display_name,
                metric.value::text AS value, metric.unit, metric.recorded_at, metric.created_at
         FROM enough.product_metrics AS metric
         JOIN enough.products AS product ON product.id = metric.product_id
        WHERE product.user_id = $1 ORDER BY metric.recorded_at`,
        [session.id],
      ),
      pool.query(
        `SELECT id, product_id, template_id, series_id, sequence_number, title, description,
                status, priority, signal_strength, estimated_minutes, reward_credits,
                recurrence_days, due_at, created_at, updated_at, completed_at
         FROM enough.growth_tasks WHERE user_id = $1 ORDER BY created_at`,
        [session.id],
      ),
      pool.query(
        `SELECT id, task_id, product_id, verification_status, reward_credits,
                credit_transaction_id, reviewed_by_user_id, reviewed_at, review_note, completed_at
         FROM enough.growth_task_completions WHERE user_id = $1 ORDER BY completed_at`,
        [session.id],
      ),
      pool.query(
        `SELECT id, completion_id, task_id, product_id, evidence_type, title, note,
                evidence_url, integration_provider, integration_reference, provenance,
                original_file_name, content_type, file_size, file_sha256,
                replace(encode(file_data, 'base64'), chr(10), '') AS file_content_base64,
                verification_status, reviewed_by_user_id, reviewed_at, review_note, verification_method,
                created_at, updated_at, deleted_at
         FROM enough.task_evidence_items WHERE user_id = $1 ORDER BY created_at`,
        [session.id],
      ),
      pool.query(
        `SELECT id, product_id, provider, display_name, status, scopes,
                connected_at, last_received_at, revoked_at, created_at, updated_at
         FROM enough.integration_accounts WHERE user_id = $1 ORDER BY created_at`,
        [session.id],
      ),
      pool.query(
        `SELECT id, integration_account_id, product_id, provider_event_id, event_type,
                user_reference_hash, amount_minor, currency, occurred_at, received_at,
                payload_hash, verification_status, completion_id, task_id, evidence_id
         FROM enough.integration_events WHERE user_id = $1 ORDER BY received_at`,
        [session.id],
      ),
      pool.query(
        `SELECT id, integration_account_id, product_id, status, started_at, finished_at,
                events_received, events_verified
         FROM enough.integration_sync_runs WHERE user_id = $1 ORDER BY started_at`,
        [session.id],
      ),
      pool.query(
        `SELECT id, integration_account_id, product_id, sync_run_id, error_code,
                safe_message, created_at
         FROM enough.integration_errors WHERE user_id = $1 ORDER BY created_at`,
        [session.id],
      ),
      pool.query(
        `SELECT id, product_id, device_id, client_event_id, event_type, event_version,
                client_sequence::text AS client_sequence, client_occurred_at, effective_at,
                received_at, clock_adjusted, attributes, batch_id
         FROM enough.activity_events WHERE user_id = $1 ORDER BY effective_at, device_id, client_sequence`,
        [session.id],
      ),
      pool.query(
        `SELECT rollup.product_id, rollup.event_type, rollup.bucket_start,
                rollup.event_count, rollup.last_event_at, rollup.updated_at
         FROM enough.activity_event_aggregates AS rollup
         JOIN enough.products AS product ON product.id = rollup.product_id
         WHERE product.user_id = $1 ORDER BY rollup.bucket_start`,
        [session.id],
      ),
      pool.query(
        `SELECT id, product_id, tool_kind, tool_key, display_name, classification,
                context_key, context_value, created_at, updated_at
         FROM enough.tool_classification_mappings WHERE user_id = $1 ORDER BY created_at`,
        [session.id],
      ),
      pool.query(
        `SELECT id, product_id, device_id, name, enabled, priority, action, conditions, schedule,
                version, created_at, updated_at, archived_at
         FROM enough.policy_rules WHERE user_id = $1 ORDER BY created_at`,
        [session.id],
      ),
      pool.query(
        `SELECT id, rule_id, version, snapshot, created_at
         FROM enough.policy_rule_versions WHERE user_id = $1 ORDER BY rule_id, version`,
        [session.id],
      ),
      pool.query(
        `SELECT id, product_id, device_id, tool_kind, tool_key, action, reason,
                starts_at, expires_at, created_at, revoked_at
         FROM enough.policy_overrides WHERE user_id = $1 ORDER BY created_at`,
        [session.id],
      ),
      pool.query(
        `SELECT id, product_id, available_balance, reserved_balance, lifetime_earned,
                lifetime_spent, created_at, updated_at
         FROM enough.credit_accounts WHERE user_id = $1 ORDER BY created_at`,
        [session.id],
      ),
      pool.query(
        `SELECT id, account_id, device_id, action, amount, available_delta, reserved_delta,
                balance_after_available, balance_after_reserved, idempotency_key,
                reservation_id, related_transaction_id, refunded_amount, metadata, created_at
         FROM enough.credit_transactions WHERE user_id = $1 ORDER BY created_at`,
        [session.id],
      ),
      pool.query(
        `SELECT id, account_id, source_transaction_id, original_amount, available_amount,
                reserved_amount, expires_at, created_at
         FROM enough.credit_lots WHERE user_id = $1 ORDER BY created_at`,
        [session.id],
      ),
      pool.query(
        `SELECT id, account_id, status, amount, remaining_amount, expires_at, created_at, updated_at
         FROM enough.credit_reservations WHERE user_id = $1 ORDER BY created_at`,
        [session.id],
      ),
      pool.query(
        `SELECT id, reservation_id, lot_id, account_id, amount, status, created_at
         FROM enough.credit_reservation_allocations WHERE user_id = $1 ORDER BY created_at`,
        [session.id],
      ),
      pool.query(
        `SELECT id, transaction_id, lot_id, account_id, amount, refunded_amount, created_at
         FROM enough.credit_transaction_allocations WHERE user_id = $1 ORDER BY created_at`,
        [session.id],
      ),
      pool.query(
        `SELECT id, refund_transaction_id, source_allocation_id, account_id, amount, created_at
         FROM enough.credit_refund_allocations WHERE user_id = $1 ORDER BY created_at`,
        [session.id],
      ),
      pool.query(
        "SELECT web_enabled, desktop_enabled, email_enabled, timezone, quiet_start, quiet_end, created_at, updated_at FROM enough.notification_preferences WHERE user_id = $1",
        [session.id],
      ),
      pool.query(
        "SELECT id, product_id, notification_type, title, body, href, dedupe_key, created_at, read_at, desktop_status, desktop_delivered_at, email_status, email_available_at, email_attempts, email_sent_at FROM enough.notifications WHERE user_id = $1 ORDER BY created_at",
        [session.id],
      ),
    ]);
    const [privacyPreferences, privacyConsents] = await Promise.all([
      pool.query(
        "SELECT activity_retention_days, notification_retention_days, audit_retention_days, created_at, updated_at FROM enough.privacy_preferences WHERE user_id = $1",
        [session.id],
      ),
      pool.query(
        "SELECT purpose, enabled, policy_version, source, revision, granted_at, revoked_at, updated_at FROM enough.privacy_consents WHERE user_id = $1 ORDER BY purpose",
        [session.id],
      ),
    ]);
    const [billingCustomer, billingSubscriptions, billingEntitlements, billingInvoices] =
      await Promise.all([
        pool.query(
          "SELECT stripe_customer_id, trial_claimed_at, created_at, updated_at FROM enough.billing_customers WHERE user_id = $1",
          [session.id],
        ),
        pool.query(
          "SELECT stripe_subscription_id, stripe_customer_id, stripe_price_id, plan_key, status, currency, billing_interval, unit_amount_minor, trial_start, trial_end, current_period_start, current_period_end, cancel_at_period_end, cancel_at, canceled_at, grace_until, latest_invoice_id, created_at, updated_at FROM enough.billing_subscriptions WHERE user_id = $1 ORDER BY created_at",
          [session.id],
        ),
        pool.query(
          "SELECT entitlement_key, status, source_subscription_id, expires_at, updated_at FROM enough.billing_entitlements WHERE user_id = $1",
          [session.id],
        ),
        pool.query(
          "SELECT stripe_invoice_id, stripe_customer_id, stripe_subscription_id, invoice_number, status, currency, amount_due_minor, amount_paid_minor, tax_minor, period_start, period_end, due_at, paid_at, hosted_invoice_url, attempt_count, last_payment_error, stripe_created_at, updated_at FROM enough.billing_invoices WHERE user_id = $1 ORDER BY stripe_created_at",
          [session.id],
        ),
      ]);
    reply
      .header("content-type", "application/json; charset=utf-8")
      .header("content-disposition", 'attachment; filename="enough-account-export.json"');
    return reply.send({
      exportedAt: new Date().toISOString(),
      account: user.rows[0],
      identities: identities.rows,
      devices: devices.rows,
      sessions: sessions.rows,
      auditEvents: audit.rows,
      onboarding: onboarding.rows[0] ?? null,
      activityEvents: activity.rows,
      activityAggregates: activityAggregates.rows,
      toolClassificationMappings: toolMappings.rows,
      policyRules: policyRules.rows,
      policyRuleVersions: policyRuleVersions.rows,
      policyOverrides: policyOverrides.rows,
      growthTasks: growthTasks.rows,
      growthTaskCompletions: growthTaskCompletions.rows,
      taskEvidenceItems: taskEvidenceItems.rows,
      integrationAccounts: integrationAccounts.rows,
      integrationEvents: integrationEvents.rows,
      integrationSyncRuns: integrationSyncRuns.rows,
      integrationErrors: integrationErrors.rows,
      creditAccounts: creditAccounts.rows,
      creditTransactions: creditTransactions.rows,
      creditLots: creditLots.rows,
      creditReservations: creditReservations.rows,
      creditReservationAllocations: creditReservationAllocations.rows,
      creditTransactionAllocations: creditTransactionAllocations.rows,
      creditRefundAllocations: creditRefundAllocations.rows,
      notificationPreferences: notificationPreferences.rows[0] ?? null,
      notifications: notifications.rows,
      privacyPreferences: privacyPreferences.rows[0] ?? null,
      privacyConsents: privacyConsents.rows,
      billingCustomer: billingCustomer.rows[0] ?? null,
      billingSubscriptions: billingSubscriptions.rows,
      billingEntitlements: billingEntitlements.rows,
      billingInvoices: billingInvoices.rows,
      products: products.rows.map((product) => ({
        ...product,
        stageHistory: stageHistory.rows.filter((item) => item.product_id === product.id),
        goals: goals.rows.filter((item) => item.product_id === product.id),
        metrics: metrics.rows.filter((item) => item.product_id === product.id),
      })),
    });
  });

  app.delete("/auth/account", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "auth:account-delete", session.id, 3, 60 * 60)))
      return;
    const parsed = z
      .object({ confirmationEmail: emailSchema, password: z.string().max(1024).optional() })
      .safeParse(request.body);
    if (
      !parsed.success ||
      normalizeEmail(parsed.data.confirmationEmail) !== normalizeEmail(session.email)
    )
      return invalidRequest(reply);
    const account = await pool.query<{ password_hash: string | null }>(
      "SELECT password_hash FROM enough.auth_users WHERE id = $1",
      [session.id],
    );
    if (account.rows[0]?.password_hash) {
      if (
        !parsed.data.password ||
        !(await verifyPassword(parsed.data.password, account.rows[0].password_hash))
      ) {
        return reply.code(403).send({ error: "Re-enter your password to delete this account." });
      }
    } else if (Date.now() - session.sessionCreatedAt.getTime() > 5 * 60 * 1000) {
      return reply.code(403).send({ error: "Sign in again before deleting this account." });
    }

    try {
      await removeStripeCustomer(session.id);
    } catch (error) {
      request.log.warn({ err: error }, "Stripe cleanup blocked account deletion");
      return reply.code(503).send({
        error:
          "Billing data could not be removed from Stripe. Try again later or contact support before deleting this account.",
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Preserve one anonymous deletion receipt; remove older audit rows that could identify this account.
      await client.query("DELETE FROM enough.auth_audit_events WHERE user_id = $1", [session.id]);
      await client.query(
        `INSERT INTO enough.auth_audit_events (id, user_id, event_type)
         VALUES ($1, $2, 'account.deleted')`,
        [randomUUID(), session.id],
      );
      await client.query("DELETE FROM enough.auth_users WHERE id = $1", [session.id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    clearSessionCookies(reply);
    return reply.code(204).send();
  });
}
