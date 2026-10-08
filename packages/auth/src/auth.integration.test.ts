import { randomBytes, randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type InjectOptions } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Opt-in only: these tests mutate synthetic accounts on the isolated local fixture.
const enabled = process.env.ENOUGH_PHASE2_INTEGRATION === "1";
describe.skipIf(!enabled)("Phase 2 authentication with real PostgreSQL and Redis", () => {
  let app: FastifyInstance;
  let pool: typeof import("@enough/db").pool;
  let hashToken: typeof import("./crypto.js").hashToken;
  let closeRedis: typeof import("@enough/cache").closeRedis;
  let env: typeof import("@enough/config").env;
  const emails: string[] = [];
  const previews: Array<{ purpose: string; token: string }> = [];
  let testIp = 0;
  const ipPrefix = `127.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
  const password = "Phase2-synthetic-password-42!";
  const newPassword = "Phase2-changed-password-43!";

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
    expect([target.hostname, target.port, target.pathname, target.username]).toEqual([
      "127.0.0.1",
      "55432",
      "/enough_phase1",
      "enough_phase1",
    ]);
    expect(process.env.REDIS_URL).toBe("redis://127.0.0.1:56379/0");
    ({ env } = await import("@enough/config"));
    // Never enable real providers or send emails from the integration harness.
    Object.assign(env, {
      NODE_ENV: "development",
      AUTH_DEV_SHOW_EMAIL_LINKS: true,
      RESEND_API_KEY: undefined,
      AUTH_EMAIL_FROM: undefined,
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
      GITHUB_CLIENT_ID: undefined,
      GITHUB_CLIENT_SECRET: undefined,
      STRIPE_SECRET_KEY: undefined,
    });
    ({ pool } = await import("@enough/db"));
    ({ hashToken } = await import("./crypto.js"));
    ({ closeRedis } = await import("@enough/cache"));
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("External requests are disabled in local authentication tests");
      }),
    );
    vi.spyOn(console, "info").mockImplementation((value: unknown) => {
      if (typeof value !== "string") return;
      const preview = JSON.parse(value) as { event?: string; purpose?: string; url?: string };
      if (preview.event === "auth.email.preview" && preview.url && preview.purpose) {
        const url = new URL(preview.url);
        expect(url.searchParams.has("token")).toBe(false);
        const token = new URLSearchParams(url.hash.slice(1)).get("token");
        if (token) previews.push({ purpose: preview.purpose, token });
      }
    });
    app = Fastify({ logger: false });
    const { registerAuthRoutes } = await import("./routes.js");
    const { registerOAuthRoutes } = await import("./oauth.js");
    await registerAuthRoutes(app);
    await registerOAuthRoutes(app);
    await app.ready();
  });

  beforeEach(() => {
    testIp += 1;
    previews.length = 0;
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (pool) {
      // Account cascades remove only this run's fixtures. No global reset/flush.
      await pool.query(
        "DELETE FROM enough.auth_audit_events WHERE user_id IN (SELECT id FROM enough.auth_users WHERE email_normalized = ANY($1::text[]))",
        [emails],
      );
      await pool.query("DELETE FROM enough.auth_users WHERE email_normalized = ANY($1::text[])", [
        emails,
      ]);
    }
    await app?.close();
    await closeRedis?.();
    await pool?.end();
  });

  function request(options: InjectOptions) {
    return app.inject({ remoteAddress: `${ipPrefix}.${testIp}`, ...options });
  }
  async function csrf() {
    const response = await request({ method: "GET", url: "/auth/csrf" });
    const token = response.json<{ csrfToken: string }>().csrfToken;
    return { cookie: `enough_pre_csrf=${token}`, "x-csrf-token": token, origin: env.APP_BASE_URL };
  }
  function sessionHeaders(response: Awaited<ReturnType<typeof app.inject>>) {
    const cookies = response.cookies;
    const cookie = cookies.map((item) => `${item.name}=${item.value}`).join("; ");
    return {
      cookie,
      "x-csrf-token": cookies.find((item) => item.name === "enough_csrf")?.value ?? "",
      origin: env.APP_BASE_URL,
    };
  }
  function preview(purpose: string) {
    const found = previews.filter((item) => item.purpose === purpose).at(-1);
    if (!found) throw new Error(`Missing local email preview for ${purpose}`);
    return found.token;
  }
  async function signup(verified = true) {
    const email = `phase2-${randomUUID()}@example.test`;
    emails.push(email);
    const headers = await csrf();
    const response = await request({
      method: "POST",
      url: "/auth/signup",
      headers,
      payload: { email, password },
    });
    expect(response.statusCode).toBe(202);
    const token = preview("verify_email");
    const rows = await pool.query<{ id: string }>(
      "SELECT id FROM enough.auth_users WHERE email_normalized = $1",
      [email],
    );
    const id = rows.rows[0].id;
    if (verified)
      expect(
        (
          await request({
            method: "POST",
            url: "/auth/email-verification/consume",
            payload: { token },
          })
        ).statusCode,
      ).toBe(200);
    return { email, id, token, headers };
  }
  async function login(email: string, clientType = "web", suppliedPassword = password) {
    return request({
      method: "POST",
      url: "/auth/login",
      headers: clientType === "web" ? await csrf() : {},
      payload: {
        email,
        password: suppliedPassword,
        clientType,
        deviceName: `Phase 2 ${clientType}`,
      },
    });
  }

  it("requires pre-auth CSRF and rejects web-origin bearer impersonation", async () => {
    const payload = { email: "phase2-invalid@example.test", password };
    expect((await request({ method: "POST", url: "/auth/signup", payload })).statusCode).toBe(403);
    expect(
      (
        await request({
          method: "POST",
          url: "/auth/login",
          headers: { origin: env.APP_BASE_URL },
          payload: { ...payload, clientType: "extension" },
        })
      ).statusCode,
    ).toBe(400);
    const headers = await csrf();
    expect(
      (
        await request({
          method: "POST",
          url: "/auth/signup",
          headers: { ...headers, origin: "https://attacker.example" },
          payload,
        })
      ).statusCode,
    ).toBe(403);
  });

  it("verifies signup, generic duplicate responses, password gating and verification replay", async () => {
    const user = await signup(false);
    expect((await login(user.email)).statusCode).toBe(403);
    const duplicate = await request({
      method: "POST",
      url: "/auth/signup",
      headers: user.headers,
      payload: { email: user.email.toUpperCase(), password },
    });
    expect(duplicate.statusCode).toBe(202);
    expect(
      (
        await request({
          method: "POST",
          url: "/auth/email-verification/consume",
          payload: { token: user.token },
        })
      ).statusCode,
    ).toBe(400);
    const token = preview("verify_email");
    expect(
      (
        await request({
          method: "POST",
          url: "/auth/email-verification/consume",
          payload: { token },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request({
          method: "POST",
          url: "/auth/email-verification/consume",
          payload: { token },
        })
      ).statusCode,
    ).toBe(400);
    expect((await login(user.email, "web", "incorrect")).statusCode).toBe(401);
    expect((await login(user.email)).statusCode).toBe(200);
  });

  it("authenticates web cookies, enforces session CSRF, rotates and logs out", async () => {
    const user = await signup();
    const signedIn = await login(user.email);
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.json()).not.toHaveProperty("accessToken");
    const cookie = signedIn.cookies.find((item) => item.name === "enough_session");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
    const headers = sessionHeaders(signedIn);
    expect((await request({ method: "GET", url: "/auth/me", headers })).json().user.id).toBe(
      user.id,
    );
    expect(
      (await request({ method: "POST", url: "/auth/logout", headers: { cookie: headers.cookie } }))
        .statusCode,
    ).toBe(403);
    const rotation = await request({ method: "POST", url: "/auth/session/rotate", headers });
    expect(rotation.statusCode).toBe(200);
    expect((await request({ method: "GET", url: "/auth/me", headers })).statusCode).toBe(401);
    const rotated = sessionHeaders(rotation);
    expect((await request({ method: "GET", url: "/auth/me", headers: rotated })).statusCode).toBe(
      200,
    );
    expect(
      (await request({ method: "POST", url: "/auth/logout", headers: rotated })).statusCode,
    ).toBe(204);
    expect((await request({ method: "GET", url: "/auth/me", headers: rotated })).statusCode).toBe(
      401,
    );
  });

  it("allows only one concurrent rotation of the same authenticated token", async () => {
    const user = await signup();
    const signedIn = await login(user.email, "desktop");
    const { accessToken, sessionId } = signedIn.json();
    const locker = await pool.connect();
    let pending: Promise<Awaited<ReturnType<typeof app.inject>>[]> | undefined;
    try {
      await locker.query("BEGIN");
      await locker.query("SELECT id FROM enough.auth_sessions WHERE id = $1 FOR UPDATE", [
        sessionId,
      ]);
      // Both requests authenticate the old token before either UPDATE can complete.
      pending = Promise.all(
        [1, 2].map(() =>
          request({
            method: "POST",
            url: "/auth/session/rotate",
            headers: { authorization: `Bearer ${accessToken}` },
          }),
        ),
      );
      let waiting = 0;
      const deadline = Date.now() + 5_000;
      while (waiting < 2 && Date.now() < deadline) {
        const activity = await pool.query(`SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE application_name = 'enough' AND wait_event_type = 'Lock' AND query LIKE '%SET token_hash%'`);
        waiting = activity.rows[0].count;
        if (waiting < 2) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(2);
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
    }
    if (!pending) throw new Error("Rotation requests were not submitted");
    const responses = await pending;
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 401]);
    const winner = responses.find((response) => response.statusCode === 200);
    expect(
      (
        await request({
          method: "GET",
          url: "/auth/me",
          headers: { authorization: `Bearer ${winner?.json().accessToken}` },
        })
      ).statusCode,
    ).toBe(200);
  });

  it.each(["desktop", "extension"])(
    "authenticates %s bearer sessions, rejects cookie substitution and revokes devices",
    async (clientType) => {
      const user = await signup();
      const signedIn = await login(user.email, clientType);
      expect(signedIn.statusCode).toBe(200);
      const data = signedIn.json<{ accessToken: string; deviceId: string }>();
      expect(signedIn.cookies).toHaveLength(0);
      const headers = { authorization: `Bearer ${data.accessToken}` };
      expect((await request({ method: "GET", url: "/auth/me", headers })).statusCode).toBe(200);
      expect(
        (
          await request({
            method: "GET",
            url: "/auth/me",
            headers: { cookie: `enough_session=${data.accessToken}` },
          })
        ).statusCode,
      ).toBe(401);
      const devices = await request({ method: "GET", url: "/auth/devices", headers });
      expect(devices.json().devices).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: data.deviceId, clientType })]),
      );
      expect(
        (await request({ method: "DELETE", url: `/auth/devices/${data.deviceId}`, headers }))
          .statusCode,
      ).toBe(204);
      expect((await request({ method: "GET", url: "/auth/me", headers })).statusCode).toBe(401);
    },
  );

  it("isolates account sessions/devices and revokes an individual session", async () => {
    const owner = await signup();
    const other = await signup();
    const ownerSession = (await login(owner.email, "desktop")).json();
    const otherHeaders = sessionHeaders(await login(other.email));
    expect(
      (
        await request({
          method: "DELETE",
          url: `/auth/sessions/${ownerSession.sessionId}`,
          headers: otherHeaders,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await request({
          method: "DELETE",
          url: `/auth/devices/${ownerSession.deviceId}`,
          headers: otherHeaders,
        })
      ).statusCode,
    ).toBe(404);
    const sessions = (
      await request({ method: "GET", url: "/auth/sessions", headers: otherHeaders })
    ).json().sessions;
    expect(sessions.some((item: { id: string }) => item.id === ownerSession.sessionId)).toBe(false);
    const ownerWeb = sessionHeaders(await login(owner.email));
    expect(
      (
        await request({
          method: "DELETE",
          url: `/auth/sessions/${ownerSession.sessionId}`,
          headers: ownerWeb,
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await request({
          method: "GET",
          url: "/auth/me",
          headers: { authorization: `Bearer ${ownerSession.accessToken}` },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("consumes magic links exactly once under concurrent requests", async () => {
    const user = await signup();
    const headers = await csrf();
    expect(
      (
        await request({
          method: "POST",
          url: "/auth/magic-link/request",
          headers,
          payload: { email: user.email },
        })
      ).statusCode,
    ).toBe(202);
    const token = preview("magic_link");
    const responses = await Promise.all(
      [1, 2].map(() =>
        request({ method: "POST", url: "/auth/magic-link/consume", headers, payload: { token } }),
      ),
    );
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 400]);
  });

  it("rejects expired email tokens and expired sessions", async () => {
    const user = await signup(false);
    await pool.query(
      "UPDATE enough.auth_tokens SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE user_id = $1",
      [user.id],
    );
    expect(
      (
        await request({
          method: "POST",
          url: "/auth/email-verification/consume",
          payload: { token: user.token },
        })
      ).statusCode,
    ).toBe(400);
    await pool.query("UPDATE enough.auth_users SET email_verified_at = now() WHERE id = $1", [
      user.id,
    ]);
    const signedIn = await login(user.email, "desktop");
    const data = signedIn.json();
    await pool.query(
      "UPDATE enough.auth_sessions SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE id = $1",
      [data.sessionId],
    );
    expect(
      (
        await request({
          method: "GET",
          url: "/auth/me",
          headers: { authorization: `Bearer ${data.accessToken}` },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("resets passwords once, invalidates pending magic links and all existing sessions", async () => {
    const user = await signup();
    const old = (await login(user.email, "desktop")).json();
    const headers = await csrf();
    await request({
      method: "POST",
      url: "/auth/magic-link/request",
      headers,
      payload: { email: user.email },
    });
    const magic = preview("magic_link");
    await request({
      method: "POST",
      url: "/auth/password-reset/request",
      headers,
      payload: { email: user.email },
    });
    const token = preview("password_reset");
    const payload = { token, newPassword };
    expect(
      (await request({ method: "POST", url: "/auth/password-reset/consume", payload })).statusCode,
    ).toBe(200);
    expect(
      (await request({ method: "POST", url: "/auth/password-reset/consume", payload })).statusCode,
    ).toBe(400);
    expect(
      (
        await request({
          method: "POST",
          url: "/auth/magic-link/consume",
          headers,
          payload: { token: magic },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request({
          method: "GET",
          url: "/auth/me",
          headers: { authorization: `Bearer ${old.accessToken}` },
        })
      ).statusCode,
    ).toBe(401);
    expect((await login(user.email)).statusCode).toBe(401);
    expect((await login(user.email, "web", newPassword)).statusCode).toBe(200);
  });

  it("changes passwords and requires reauthentication for deletion", async () => {
    const user = await signup();
    const headers = sessionHeaders(await login(user.email));
    expect(
      (
        await request({
          method: "POST",
          url: "/auth/password/change",
          headers,
          payload: { currentPassword: "wrong", newPassword },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request({
          method: "POST",
          url: "/auth/password/change",
          headers,
          payload: { currentPassword: password, newPassword },
        })
      ).statusCode,
    ).toBe(200);
    expect((await request({ method: "GET", url: "/auth/me", headers })).statusCode).toBe(401);
    const updated = sessionHeaders(await login(user.email, "web", newPassword));
    expect(
      (
        await request({
          method: "DELETE",
          url: "/auth/account",
          headers: updated,
          payload: { confirmationEmail: user.email, password },
        })
      ).statusCode,
    ).toBe(403);
  });

  it.each(["web", "desktop", "extension"] as const)(
    "does not turn rotation or a derived %s session into fresh authentication for passwordless deletion",
    async (clientType) => {
      const user = await signup();
      const headers = await csrf();
      await request({
        method: "POST",
        url: "/auth/magic-link/request",
        headers,
        payload: { email: user.email },
      });
      const signedIn = await request({
        method: "POST",
        url: "/auth/magic-link/consume",
        headers,
        payload: { token: preview("magic_link") },
      });
      const account = sessionHeaders(signedIn);
      await pool.query("UPDATE enough.auth_users SET password_hash = NULL WHERE id = $1", [
        user.id,
      ]);
      await pool.query(
        "UPDATE enough.auth_sessions SET created_at = now() - interval '10 minutes' WHERE id = $1",
        [signedIn.json().sessionId],
      );
      const payload = { confirmationEmail: user.email };
      const rotated = await request({
        method: "POST",
        url: "/auth/session/rotate",
        headers: account,
      });
      expect(rotated.statusCode).toBe(200);
      expect(
        (
          await request({
            method: "DELETE",
            url: "/auth/account",
            headers: sessionHeaders(rotated),
            payload,
          })
        ).statusCode,
      ).toBe(403);
      const derived = await request({
        method: "POST",
        url: "/auth/sessions",
        headers: sessionHeaders(rotated),
        payload: { clientType, deviceName: `Derived Phase 2 ${clientType}` },
      });
      expect(derived.statusCode).toBe(201);
      const derivedHeaders =
        clientType === "web"
          ? sessionHeaders(derived)
          : { authorization: `Bearer ${derived.json().accessToken}` };
      expect(
        (
          await request({
            method: "DELETE",
            url: "/auth/account",
            headers: derivedHeaders,
            payload,
          })
        ).statusCode,
      ).toBe(403);
      // A real new magic-link sign-in still satisfies the deletion freshness requirement.
      const freshCsrf = await csrf();
      await request({
        method: "POST",
        url: "/auth/magic-link/request",
        headers: freshCsrf,
        payload: { email: user.email },
      });
      const fresh = await request({
        method: "POST",
        url: "/auth/magic-link/consume",
        headers: freshCsrf,
        payload: { token: preview("magic_link") },
      });
      expect(fresh.statusCode).toBe(200);
      expect(
        (
          await request({
            method: "DELETE",
            url: "/auth/account",
            headers: sessionHeaders(fresh),
            payload,
          })
        ).statusCode,
      ).toBe(204);
    },
  );

  it.each(["session", "device", "rotation"])(
    "rejects derived-session issuance after concurrent %s invalidation",
    async (invalidation) => {
      const user = await signup();
      const signedIn = await login(user.email, "desktop");
      const parent = signedIn.json();
      const locker = await pool.connect();
      let pending: Promise<Awaited<ReturnType<typeof request>>> | undefined;
      try {
        await locker.query("BEGIN");
        await locker.query("SELECT id FROM enough.auth_users WHERE id = $1 FOR UPDATE", [user.id]);
        pending = request({
          method: "POST",
          url: "/auth/sessions",
          headers: { authorization: `Bearer ${parent.accessToken}` },
          payload: { clientType: "extension", deviceName: "Concurrent derived session" },
        }).then((response) => response);
        let waiting = 0;
        const deadline = Date.now() + 5_000;
        while (waiting < 1 && Date.now() < deadline) {
          const activity = await pool.query(`SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE application_name = 'enough' AND wait_event_type = 'Lock' AND query LIKE '%FROM enough.auth_users%FOR UPDATE%'`);
          waiting = activity.rows[0].count;
          if (waiting < 1) await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(waiting).toBe(1);
        if (invalidation === "device") {
          await locker.query("UPDATE enough.auth_devices SET revoked_at = now() WHERE id = $1", [
            parent.deviceId,
          ]);
        } else if (invalidation === "rotation") {
          await locker.query("UPDATE enough.auth_sessions SET token_hash = $2 WHERE id = $1", [
            parent.sessionId,
            hashToken(randomUUID()),
          ]);
        } else {
          await locker.query("UPDATE enough.auth_sessions SET revoked_at = now() WHERE id = $1", [
            parent.sessionId,
          ]);
        }
        await locker.query("COMMIT");
      } finally {
        await locker.query("ROLLBACK");
        locker.release();
      }
      if (!pending) throw new Error("Session issuance request was not submitted");
      expect((await pending).statusCode).toBe(401);
      const devices = await pool.query(
        "SELECT count(*)::int AS count FROM enough.auth_devices WHERE user_id = $1",
        [user.id],
      );
      expect(devices.rows[0].count).toBe(1);
    },
  );

  it("rejects a password login if the password changes before session issuance", async () => {
    const user = await signup();
    const locker = await pool.connect();
    const { hashPassword } = await import("./crypto.js");
    const replacement = await hashPassword(newPassword);
    let pending: ReturnType<typeof login> | undefined;
    try {
      await locker.query("BEGIN");
      await locker.query("SELECT id FROM enough.auth_users WHERE id = $1 FOR UPDATE", [user.id]);
      pending = login(user.email, "desktop");
      let waiting = 0;
      const deadline = Date.now() + 5_000;
      while (waiting < 1 && Date.now() < deadline) {
        const activity = await pool.query(`SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE application_name = 'enough' AND wait_event_type = 'Lock' AND query LIKE '%FROM enough.auth_users%FOR UPDATE%'`);
        waiting = activity.rows[0].count;
        if (waiting < 1) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(1);
      await locker.query(
        "UPDATE enough.auth_users SET password_hash = $2, updated_at = now() WHERE id = $1",
        [user.id, replacement],
      );
      await locker.query("COMMIT");
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
    }
    if (!pending) throw new Error("Login request was not submitted");
    expect((await pending).statusCode).toBe(401);
    const active = await pool.query(
      "SELECT count(*)::int AS count FROM enough.auth_sessions WHERE user_id = $1 AND revoked_at IS NULL",
      [user.id],
    );
    expect(active.rows[0].count).toBe(0);
  });

  it("rejects a stale password change after another request has replaced the password", async () => {
    const user = await signup();
    const headers = sessionHeaders(await login(user.email));
    const { hashPassword } = await import("./crypto.js");
    const replacement = await hashPassword(`${newPassword}-concurrent`);
    const locker = await pool.connect();
    let pending: ReturnType<typeof request> | undefined;
    try {
      await locker.query("BEGIN");
      await locker.query("SELECT id FROM enough.auth_users WHERE id = $1 FOR UPDATE", [user.id]);
      pending = request({
        method: "POST",
        url: "/auth/password/change",
        headers,
        payload: { currentPassword: password, newPassword },
      });
      let waiting = 0;
      const deadline = Date.now() + 5_000;
      while (waiting < 1 && Date.now() < deadline) {
        const activity = await pool.query(`SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE application_name = 'enough' AND wait_event_type = 'Lock' AND query LIKE '%UPDATE enough.auth_users%password_hash%'`);
        waiting = activity.rows[0].count;
        if (waiting < 1) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(1);
      await locker.query("UPDATE enough.auth_users SET password_hash = $2 WHERE id = $1", [
        user.id,
        replacement,
      ]);
      await locker.query("COMMIT");
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
    }
    if (!pending) throw new Error("Password change request was not submitted");
    expect((await pending).statusCode).toBe(400);
    const current = await pool.query("SELECT password_hash FROM enough.auth_users WHERE id = $1", [
      user.id,
    ]);
    expect(current.rows[0].password_hash === replacement).toBe(true);
  });

  it("exports only the owner without credential hashes and deletes account cascades", async () => {
    const user = await signup();
    const headers = sessionHeaders(await login(user.email));
    const exported = await request({ method: "GET", url: "/auth/account/export", headers });
    expect(exported.statusCode).toBe(200);
    expect(exported.body).toContain(user.email);
    for (const secret of ["password_hash", "token_hash", "csrf_token_hash", password])
      expect(exported.body).not.toContain(secret);
    expect(
      (
        await request({
          method: "DELETE",
          url: "/auth/account",
          headers,
          payload: { confirmationEmail: user.email, password },
        })
      ).statusCode,
    ).toBe(204);
    expect((await request({ method: "GET", url: "/auth/me", headers })).statusCode).toBe(401);
    for (const table of [
      "auth_users",
      "auth_devices",
      "auth_sessions",
      "auth_tokens",
      "auth_identities",
    ]) {
      const column = table === "auth_users" ? "id" : "user_id";
      const remaining = await pool.query(
        `SELECT count(*)::int AS count FROM enough.${table} WHERE ${column} = $1`,
        [user.id],
      );
      expect(remaining.rows[0].count).toBe(0);
    }
  });

  it("rate limits failed password attempts using real Redis and returns Retry-After", async () => {
    const user = await signup();
    for (let index = 0; index < 8; index += 1)
      expect((await login(user.email, "desktop", "wrong")).statusCode).toBe(401);
    const limited = await login(user.email, "desktop", "wrong");
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("fails closed when Redis rate limiting is unavailable", async () => {
    const { getRedis } = await import("@enough/cache");
    const failure = vi
      .spyOn(getRedis(), "eval")
      .mockRejectedValueOnce(new Error("Synthetic Redis outage"));
    try {
      const response = await request({
        method: "POST",
        url: "/auth/login",
        payload: { email: `missing-${randomUUID()}@example.test`, password, clientType: "desktop" },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).not.toHaveProperty("accessToken");
    } finally {
      failure.mockRestore();
    }
  });

  it("keeps session credentials hashed and audit metadata free of credentials", async () => {
    const user = await signup();
    const signedIn = (await login(user.email, "desktop")).json();
    const stored = await pool.query(
      "SELECT token_hash, csrf_token_hash FROM enough.auth_sessions WHERE id = $1",
      [signedIn.sessionId],
    );
    expect(stored.rows[0].token_hash.equals(hashToken(signedIn.accessToken))).toBe(true);
    expect(stored.rows[0].csrf_token_hash).toBeNull();
    await request({
      method: "POST",
      url: "/auth/logout",
      headers: { authorization: `Bearer ${signedIn.accessToken}` },
    });
    const audit = await pool.query(
      "SELECT event_type, metadata FROM enough.auth_audit_events WHERE user_id = $1",
      [user.id],
    );
    expect(audit.rows.map((row) => row.event_type)).toEqual(
      expect.arrayContaining([
        "account.created",
        "verify_email.consumed",
        "session.created",
        "session.revoked",
      ]),
    );
    const serialized = JSON.stringify(audit.rows);
    expect(serialized.includes(signedIn.accessToken)).toBe(false);
    expect(serialized.includes(password)).toBe(false);
  });

  it.each(["google", "github"])("keeps %s disabled without real credentials", async (provider) => {
    const configuration = await request({ method: "GET", url: "/auth/providers" });
    expect(configuration.json()[provider]).toBe(false);
    const response = await request({
      method: "POST",
      url: `/auth/oauth/${provider}/start`,
      headers: await csrf(),
    });
    expect(response.statusCode).toBe(503);
  });

  it("rejects OAuth exchanges with the wrong browser, expiry or replay without provider credentials", async () => {
    const user = await signup();
    const headers = await csrf();
    const { newToken } = await import("./crypto.js");
    const token = newToken();
    await pool.query(
      `INSERT INTO enough.auth_tokens (id, user_id, token_hash, purpose, binding_hash, source_provider, expires_at)
      VALUES ($1, $2, $3, 'oauth_exchange', $4, 'google', now() + interval '2 minutes')`,
      [randomUUID(), user.id, hashToken(token), hashToken(headers["x-csrf-token"])],
    );
    const wrongBrowser = await csrf();
    expect(
      (
        await request({
          method: "POST",
          url: "/auth/oauth/consume",
          headers: wrongBrowser,
          payload: { token },
        })
      ).statusCode,
    ).toBe(400);
    const consumed = await request({
      method: "POST",
      url: "/auth/oauth/consume",
      headers,
      payload: { token },
    });
    expect(consumed.statusCode).toBe(200);
    expect(
      (await request({ method: "POST", url: "/auth/oauth/consume", headers, payload: { token } }))
        .statusCode,
    ).toBe(400);
    const expired = newToken();
    await pool.query(
      `INSERT INTO enough.auth_tokens (id, user_id, token_hash, purpose, binding_hash, source_provider, created_at, expires_at)
      VALUES ($1, $2, $3, 'oauth_exchange', $4, 'github', now() - interval '3 minutes', now() - interval '1 minute')`,
      [randomUUID(), user.id, hashToken(expired), hashToken(headers["x-csrf-token"])],
    );
    expect(
      (
        await request({
          method: "POST",
          url: "/auth/oauth/consume",
          headers,
          payload: { token: expired },
        })
      ).statusCode,
    ).toBe(400);
  });
});
