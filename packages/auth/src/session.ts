import { randomUUID } from "node:crypto";
import { env } from "@enough/config";
import { pool } from "@enough/db";
import type { FastifyReply, FastifyRequest } from "fastify";
import { equalBuffer, equalText, hashToken, newToken } from "./crypto.js";

export type ClientType = "web" | "desktop" | "extension";
export type AuthMethod = "password" | "magic_link" | "google" | "github";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

export interface AuthSession extends AuthUser {
  sessionId: string;
  deviceId: string;
  credentialType: "cookie" | "bearer";
  authMethod: AuthMethod;
  sessionCreatedAt: Date;
  sessionExpiresAt: Date;
  csrfTokenHash: Buffer | null;
}

export interface SessionIssue {
  sessionId: string;
  deviceId: string;
  token: string;
  csrfToken: string | null;
  expiresAt: Date;
  credentialType: "cookie" | "bearer";
}

export const sessionCookieName =
  env.NODE_ENV === "production" ? "__Host-enough_session" : "enough_session";
export const csrfCookieName = env.NODE_ENV === "production" ? "__Host-enough_csrf" : "enough_csrf";
const preCsrfCookieName =
  env.NODE_ENV === "production" ? "__Host-enough_pre_csrf" : "enough_pre_csrf";
const secureCookie = env.NODE_ENV === "production";

function cookieHeader(name: string, value: string, maxAge: number, httpOnly: boolean): string {
  return [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
    "SameSite=Lax",
    ...(secureCookie ? ["Secure"] : []),
    ...(httpOnly ? ["HttpOnly"] : []),
  ].join("; ");
}

function appendCookie(reply: FastifyReply, value: string): void {
  const current = reply.getHeader("set-cookie");
  const existing = Array.isArray(current) ? current.map(String) : current ? [String(current)] : [];
  reply.header("set-cookie", [...existing, value]);
}

function readCookie(request: FastifyRequest, name: string): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return null;
}

export function issuePreAuthCsrf(reply: FastifyReply): { csrfToken: string } {
  const csrfToken = newToken();
  appendCookie(reply, cookieHeader(preCsrfCookieName, csrfToken, 600, false));
  return { csrfToken };
}

export function clearPreAuthCsrf(reply: FastifyReply): void {
  appendCookie(reply, cookieHeader(preCsrfCookieName, "", 0, false));
}

export function validatePreAuthCsrf(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (origin && origin !== new URL(env.APP_BASE_URL).origin) return false;
  const cookie = readCookie(request, preCsrfCookieName);
  const header = request.headers["x-csrf-token"];
  return typeof cookie === "string" && typeof header === "string" && equalText(cookie, header);
}

export function validateSessionCsrf(request: FastifyRequest, session: AuthSession): boolean {
  if (session.credentialType === "bearer") return true;
  if (!session.csrfTokenHash) return false;
  const origin = request.headers.origin;
  if (origin && origin !== new URL(env.APP_BASE_URL).origin) return false;
  const cookie = readCookie(request, csrfCookieName);
  const header = request.headers["x-csrf-token"];
  if (typeof cookie !== "string" || typeof header !== "string" || !equalText(cookie, header))
    return false;
  return equalBuffer(hashToken(header), session.csrfTokenHash);
}

export function setSessionCookies(reply: FastifyReply, issue: SessionIssue): void {
  if (issue.credentialType !== "cookie" || !issue.csrfToken) return;
  const age = Math.floor((issue.expiresAt.getTime() - Date.now()) / 1000);
  appendCookie(reply, cookieHeader(sessionCookieName, issue.token, age, true));
  appendCookie(reply, cookieHeader(csrfCookieName, issue.csrfToken, age, false));
}

export function clearSessionCookies(reply: FastifyReply): void {
  appendCookie(reply, cookieHeader(sessionCookieName, "", 0, true));
  appendCookie(reply, cookieHeader(csrfCookieName, "", 0, false));
  appendCookie(reply, cookieHeader(preCsrfCookieName, "", 0, false));
}

export async function createSession(
  userId: string,
  clientType: ClientType,
  deviceName: string,
  authMethod: AuthMethod,
): Promise<SessionIssue> {
  const sessionId = randomUUID();
  const deviceId = randomUUID();
  const token = newToken();
  const csrfToken = clientType === "web" ? newToken() : null;
  const credentialType = clientType === "web" ? "cookie" : "bearer";
  const expiresAt = new Date(Date.now() + env.AUTH_SESSION_DAYS * 24 * 60 * 60 * 1000);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM enough.auth_users WHERE id = $1 FOR UPDATE", [userId]);
    await client.query(
      `INSERT INTO enough.auth_devices (id, user_id, name, client_type)
       VALUES ($1, $2, $3, $4)`,
      [deviceId, userId, deviceName, clientType],
    );
    await client.query(
      `INSERT INTO enough.auth_sessions
         (id, user_id, device_id, token_hash, csrf_token_hash, credential_type, auth_method, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        sessionId,
        userId,
        deviceId,
        hashToken(token),
        csrfToken ? hashToken(csrfToken) : null,
        credentialType,
        authMethod,
        expiresAt,
      ],
    );
    await client.query(
      `UPDATE enough.auth_sessions
       SET revoked_at = now()
       WHERE id IN (
         SELECT id FROM enough.auth_sessions
         WHERE user_id = $1 AND revoked_at IS NULL
         ORDER BY last_seen_at DESC, created_at DESC
         OFFSET $2
       )`,
      [userId, 20],
    );
    await client.query(
      `INSERT INTO enough.auth_audit_events (id, user_id, device_id, event_type)
       VALUES ($1, $2, $3, 'session.created')`,
      [randomUUID(), userId, deviceId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return { sessionId, deviceId, token, csrfToken, expiresAt, credentialType };
}

export async function authenticate(request: FastifyRequest): Promise<AuthSession | null> {
  const authorization = request.headers.authorization;
  let token: string | null = null;
  let expectedType: "cookie" | "bearer";

  if (authorization && /^Bearer\s+/i.test(authorization)) {
    token = authorization.replace(/^Bearer\s+/i, "");
    expectedType = "bearer";
  } else {
    token = readCookie(request, sessionCookieName);
    expectedType = "cookie";
  }
  if (!token || token.length > 128) return null;

  const result = await pool.query<{
    session_id: string;
    device_id: string;
    credential_type: "cookie" | "bearer";
    auth_method: AuthMethod;
    session_created_at: Date;
    session_expires_at: Date;
    csrf_token_hash: Buffer | null;
    id: string;
    email: string;
    display_name: string | null;
    email_verified_at: Date | null;
    user_created_at: Date;
  }>(
    `SELECT s.id AS session_id, s.device_id, s.credential_type, s.auth_method,
            s.created_at AS session_created_at, s.expires_at AS session_expires_at,
            s.csrf_token_hash, u.id, u.email, u.display_name, u.email_verified_at,
            u.created_at AS user_created_at
     FROM enough.auth_sessions s
     JOIN enough.auth_users u ON u.id = s.user_id
     JOIN enough.auth_devices d ON d.id = s.device_id
     WHERE s.token_hash = $1 AND s.credential_type = $2
       AND s.revoked_at IS NULL AND s.expires_at > now() AND d.revoked_at IS NULL`,
    [hashToken(token), expectedType],
  );
  const row = result.rows[0];
  if (!row) return null;

  await pool.query(
    `UPDATE enough.auth_sessions SET last_seen_at = now()
     WHERE id = $1 AND last_seen_at < now() - interval '5 minutes'`,
    [row.session_id],
  );
  await pool.query(
    `UPDATE enough.auth_devices SET last_seen_at = now()
     WHERE id = $1 AND last_seen_at < now() - interval '5 minutes'`,
    [row.device_id],
  );

  return {
    sessionId: row.session_id,
    deviceId: row.device_id,
    credentialType: row.credential_type,
    authMethod: row.auth_method,
    sessionCreatedAt: row.session_created_at,
    sessionExpiresAt: row.session_expires_at,
    csrfTokenHash: row.csrf_token_hash,
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    emailVerifiedAt: row.email_verified_at,
    createdAt: row.user_created_at,
  };
}

export function sessionPayload(issue: SessionIssue): Record<string, unknown> {
  return issue.credentialType === "bearer"
    ? {
        tokenType: "Bearer",
        accessToken: issue.token,
        expiresAt: issue.expiresAt.toISOString(),
        sessionId: issue.sessionId,
        deviceId: issue.deviceId,
      }
    : {
        expiresAt: issue.expiresAt.toISOString(),
        sessionId: issue.sessionId,
        deviceId: issue.deviceId,
      };
}

export function toPublicUser(user: AuthUser): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    emailVerified: Boolean(user.emailVerifiedAt),
    createdAt: user.createdAt.toISOString(),
  };
}
