import { randomBytes, randomUUID } from "node:crypto";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthSession } from "./session.js";

vi.mock("@enough/db", () => ({ pool: {} }));

afterEach(() => {
  vi.doUnmock("@enough/config");
  vi.resetModules();
});

async function productionSessions() {
  vi.doMock("@enough/config", () => ({
    env: {
      NODE_ENV: "production",
      APP_BASE_URL: "https://app.example.test",
      AUTH_SECRET: randomBytes(32).toString("hex"),
    },
  }));
  return import("./session.js");
}

describe("authentication security boundaries", () => {
  it("sets host-scoped secure HTTP-only session cookies and readable CSRF cookies", async () => {
    const { setSessionCookies, issuePreAuthCsrf, clearSessionCookies } = await productionSessions();
    const app = Fastify();
    app.get("/issue", async (_request, reply) => {
      setSessionCookies(reply, {
        sessionId: randomUUID(),
        deviceId: randomUUID(),
        token: randomBytes(32).toString("base64url"),
        csrfToken: randomBytes(32).toString("base64url"),
        expiresAt: new Date(Date.now() + 60_000),
        credentialType: "cookie",
      });
      issuePreAuthCsrf(reply);
      return {};
    });
    app.get("/clear", async (_request, reply) => {
      clearSessionCookies(reply);
      return {};
    });
    try {
      const response = await app.inject({ method: "GET", url: "/issue" });
      const cookies = response.cookies;
      expect(cookies.map((cookie) => cookie.name)).toEqual([
        "__Host-enough_session",
        "__Host-enough_csrf",
        "__Host-enough_pre_csrf",
      ]);
      for (const cookie of cookies) {
        expect(cookie.secure).toBe(true);
        expect(cookie.path).toBe("/");
        expect(cookie.sameSite).toBe("Lax");
        expect(cookie.domain).toBeUndefined();
      }
      expect(cookies[0].httpOnly).toBe(true);
      expect(cookies[1].httpOnly).toBeUndefined();
      expect(cookies[2].httpOnly).toBeUndefined();
      const cleared = await app.inject({ method: "GET", url: "/clear" });
      expect(cleared.cookies.every((cookie) => cookie.maxAge === 0 && cookie.secure)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("rejects wrong origins and CSRF tokens that do not match the authenticated session", async () => {
    const { validateSessionCsrf } = await productionSessions();
    const { hashToken } = await import("./crypto.js");
    const token = randomBytes(32).toString("base64url");
    const session: AuthSession = {
      id: randomUUID(),
      sessionId: randomUUID(),
      deviceId: randomUUID(),
      email: "synthetic@example.test",
      displayName: null,
      emailVerifiedAt: new Date(),
      createdAt: new Date(),
      authMethod: "password",
      credentialType: "cookie",
      sessionCreatedAt: new Date(),
      sessionExpiresAt: new Date(Date.now() + 60_000),
      csrfTokenHash: hashToken(token),
      tokenHash: hashToken(randomBytes(32).toString("base64url")),
    };
    const app = Fastify();
    app.post("/protected", async (request, reply) =>
      reply.code(validateSessionCsrf(request, session) ? 200 : 403).send(),
    );
    const headers = {
      origin: "https://app.example.test",
      cookie: `__Host-enough_csrf=${token}`,
      "x-csrf-token": token,
    };
    try {
      expect((await app.inject({ method: "POST", url: "/protected", headers })).statusCode).toBe(
        200,
      );
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/protected",
            headers: { ...headers, origin: "https://attacker.example" },
          })
        ).statusCode,
      ).toBe(403);
      const wrong = randomBytes(32).toString("base64url");
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/protected",
            headers: { ...headers, cookie: `__Host-enough_csrf=${wrong}`, "x-csrf-token": wrong },
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("rejects production preview and incomplete OAuth credential pairs in configuration", async () => {
    const { parseEnvironment } = await import("@enough/config");
    expect(() =>
      parseEnvironment({ NODE_ENV: "production", AUTH_DEV_SHOW_EMAIL_LINKS: "true" }),
    ).toThrow("Development email link previews must be disabled in production");
    // Generated, in-memory values only; no provider credentials exist in these tests.
    expect(() => parseEnvironment({ GOOGLE_CLIENT_ID: randomBytes(16).toString("hex") })).toThrow(
      "Google OAuth requires both a client ID and client secret",
    );
    expect(() =>
      parseEnvironment({ GITHUB_CLIENT_SECRET: randomBytes(16).toString("hex") }),
    ).toThrow("GitHub OAuth requires both a client ID and client secret");
    expect(
      parseEnvironment({
        GOOGLE_CLIENT_ID: "",
        GOOGLE_CLIENT_SECRET: "",
        GITHUB_CLIENT_ID: "",
        GITHUB_CLIENT_SECRET: "",
      }),
    ).toMatchObject({ GOOGLE_CLIENT_ID: undefined, GITHUB_CLIENT_ID: undefined });
  });
});
