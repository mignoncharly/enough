import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.ENOUGH_PHASE2_INTEGRATION === "1";
describe.skipIf(!enabled)("Phase 2 live API and web proxy", () => {
  let pool: typeof import("@enough/db").pool;
  const ids: string[] = [];
  const api = "http://127.0.0.1:4402";
  const web = "http://127.0.0.1:3302";

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
    expect([target.hostname, target.port, target.pathname, target.username]).toEqual([
      "127.0.0.1",
      "55433",
      "/enough_phase2",
      "enough_phase2",
    ]);
    expect(process.env.APP_BASE_URL).toBe(web);
    expect(process.env.API_BASE_URL).toBe(api);
    expect(process.env.REDIS_URL).toBe("redis://127.0.0.1:56381/0");
    ({ pool } = await import("@enough/db"));
    const response = await fetch(`${api}/ready`, { signal: AbortSignal.timeout(5000) });
    expect(response.status).toBe(200);
  });
  afterAll(async () => {
    if (pool) {
      await pool.query("DELETE FROM enough.auth_audit_events WHERE user_id = ANY($1::uuid[])", [
        ids,
      ]);
      await pool.query("DELETE FROM enough.auth_users WHERE id = ANY($1::uuid[])", [ids]);
      await pool.end();
    }
  });

  async function account() {
    const { hashPassword } = await import("../../../packages/auth/src/crypto.js");
    const id = randomUUID();
    const email = `phase2-http-${id}@example.test`;
    const password = randomBytes(24).toString("base64url");
    ids.push(id);
    await pool.query(
      "INSERT INTO enough.auth_users (id, email, email_normalized, password_hash, email_verified_at) VALUES ($1, $2, $2, $3, now())",
      [id, email, await hashPassword(password)],
    );
    return { id, email, password };
  }
  async function send(base: string, path: string, options: RequestInit = {}) {
    return fetch(`${base}${path}`, {
      ...options,
      redirect: "manual",
      signal: AbortSignal.timeout(45000),
    });
  }
  function cookies(response: Response) {
    return response.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
  }

  it("keeps providers disabled and applies exact-origin CORS and no-store responses", async () => {
    const response = await send(api, "/auth/providers");
    expect(await response.json()).toMatchObject({ google: false, github: false });
    expect(response.headers.get("cache-control")).toBe("no-store");
    const allowed = await send(api, "/auth/login", {
      method: "OPTIONS",
      headers: { origin: web, "access-control-request-method": "POST" },
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(web);
    const denied = await send(api, "/auth/login", {
      method: "OPTIONS",
      headers: { origin: "https://attacker.example", "access-control-request-method": "POST" },
    });
    expect(denied.status).toBe(403);
    expect(denied.headers.has("access-control-allow-origin")).toBe(false);
  });

  it("authenticates cookie sessions through the live same-origin Next.js proxy", async () => {
    const user = await account();
    const csrf = await send(web, "/api/auth/csrf");
    expect(csrf.status).toBe(200);
    const { csrfToken } = await csrf.json();
    const response = await send(web, "/api/auth/login", {
      method: "POST",
      headers: {
        origin: web,
        cookie: cookies(csrf),
        "x-csrf-token": csrfToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: user.email, password: user.password, clientType: "web" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toHaveLength(2);
    const signedIn = await response.json();
    expect(signedIn).not.toHaveProperty("accessToken");
    const cookie = cookies(response);
    const me = await send(web, "/api/auth/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    expect((await me.json()).user.id).toBe(user.id);
    const denied = await send(web, "/api/auth/logout", {
      method: "POST",
      headers: { origin: web, cookie },
    });
    expect(denied.status).toBe(403);
    const csrfCookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("enough_csrf="));
    if (!csrfCookie) throw new Error("Missing authenticated CSRF cookie");
    const logout = await send(web, "/api/auth/logout", {
      method: "POST",
      headers: {
        origin: web,
        cookie,
        "x-csrf-token": csrfCookie.split(";", 1)[0].slice("enough_csrf=".length),
      },
    });
    expect(logout.status).toBe(204);
    expect((await send(web, "/api/auth/me", { headers: { cookie } })).status).toBe(401);
  });

  it("rejects hostile origins and bearer impersonation through the live web proxy", async () => {
    const user = await account();
    const csrf = await send(web, "/api/auth/csrf");
    const { csrfToken } = await csrf.json();
    const headers = {
      origin: web,
      cookie: cookies(csrf),
      "x-csrf-token": csrfToken,
      "content-type": "application/json",
    };
    const payload = { email: user.email, password: user.password, clientType: "web" };
    for (const origin of ["https://attacker.example", "null"]) {
      const denied = await send(web, "/api/auth/login", {
        method: "POST",
        headers: { ...headers, origin },
        body: JSON.stringify(payload),
      });
      expect(denied.status).toBe(403);
      expect(denied.headers.has("access-control-allow-origin")).toBe(false);
      expect(denied.headers.getSetCookie()).toHaveLength(0);
      expect(await denied.text()).not.toContain(user.password);
    }
    for (const clientType of ["desktop", "extension"]) {
      const denied = await send(web, "/api/auth/login", {
        method: "POST",
        headers,
        body: JSON.stringify({ ...payload, clientType, deviceName: "Phase 2 impersonation" }),
      });
      expect(denied.status).toBe(400);
      expect(await denied.json()).toEqual({ error: "Invalid client type." });
    }
    expect(
      (await pool.query("SELECT id FROM enough.auth_sessions WHERE user_id = $1", [user.id]))
        .rowCount,
    ).toBe(0);
  });

  it.each(["desktop", "extension"])(
    "logs in and revokes the %s bearer contract over real HTTP",
    async (clientType) => {
      const user = await account();
      const response = await send(api, "/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          password: user.password,
          clientType,
          deviceName: `Phase 2 HTTP ${clientType}`,
        }),
      });
      expect(response.status).toBe(200);
      const { accessToken, deviceId } = await response.json();
      const headers = { authorization: `Bearer ${accessToken}` };
      expect((await send(api, "/auth/me", { headers })).status).toBe(200);
      expect(
        (await send(api, `/auth/devices/${deviceId}`, { method: "DELETE", headers })).status,
      ).toBe(204);
      expect((await send(api, "/auth/me", { headers })).status).toBe(401);
    },
  );

  it.each(["/login", "/verify-email", "/reset-password", "/oauth/complete"])(
    "serves the %s authentication page",
    async (path) => {
      const response = await send(web, path);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
    },
  );
});
