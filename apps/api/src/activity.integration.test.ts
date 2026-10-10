import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe.skipIf(process.env.ENOUGH_PHASE5_INTEGRATION !== "1")(
  "Phase 5 activity on disposable PostgreSQL, Redis and live HTTP",
  () => {
    let pool: typeof import("@enough/db").pool;
    const ids: string[] = [];
    const phase6 = process.env.ENOUGH_PHASE6_INTEGRATION === "1";
    const api = phase6 ? "http://127.0.0.1:4410" : "http://127.0.0.1:4408";
    const web = phase6 ? "http://127.0.0.1:3306" : "http://127.0.0.1:3305";

    beforeAll(async () => {
      const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
      expect([target.hostname, target.port, target.pathname, target.username]).toEqual([
        "127.0.0.1",
        phase6 ? "55437" : "55436",
        phase6 ? "/enough_phase6" : "/enough_phase5",
        phase6 ? "enough_phase6" : "enough_phase5",
      ]);
      expect(process.env.REDIS_URL).toBe(
        phase6 ? "redis://127.0.0.1:56389/0" : "redis://127.0.0.1:56387/0",
      );
      expect(process.env.APP_BASE_URL).toBe(web);
      expect(process.env.API_BASE_URL).toBe(api);
      ({ pool } = await import("@enough/db"));
      const identity = await pool.query("SELECT current_user, current_database()");
      expect(identity.rows[0]).toEqual({
        current_user: phase6 ? "enough_phase6" : "enough_phase5",
        current_database: phase6 ? "enough_phase6" : "enough_phase5",
      });
    });
    afterAll(async () => {
      if (!pool) return;
      await pool.query("DELETE FROM enough.auth_audit_events WHERE user_id = ANY($1::uuid[])", [
        ids,
      ]);
      await pool.query("DELETE FROM enough.auth_users WHERE id = ANY($1::uuid[])", [ids]);
      await pool.end();
    });

    async function device(id: string, type: "web" | "desktop" | "extension" = "desktop") {
      const { createSession } = await import("../../../packages/auth/src/session.js");
      const session = await createSession(id, type, "Phase 5 synthetic device", "magic_link");
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (type === "web") {
        headers.cookie = `enough_session=${session.token}; enough_csrf=${session.csrfToken}`;
        headers["x-csrf-token"] = session.csrfToken ?? "";
        headers.origin = web;
      } else headers.authorization = `Bearer ${session.token}`;
      return { id, deviceId: session.deviceId, sessionId: session.sessionId, headers };
    }
    type User = Awaited<ReturnType<typeof device>>;
    function request(path: string, user?: User, body?: unknown, method?: string, proxy = false) {
      return fetch(`${proxy ? `${web}/api` : api}${path}`, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers: user?.headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });
    }
    async function ok(path: string, user: User, body?: unknown, method?: string, proxy = false) {
      const response = await request(path, user, body, method, proxy);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      return response.json();
    }
    async function product(user: User) {
      const response = await request("/products", user, {
        name: `Synthetic product ${randomUUID()}`,
        productStage: "IDEA",
        targetCustomer: "Test teams",
        problemStatement: "Synthetic workflow",
        initialGoal: "Verify activity ingestion",
      });
      expect(response.status).toBe(201);
      return (await response.json()).product.id as string;
    }
    async function account(consent = true, type: "web" | "desktop" | "extension" = "desktop") {
      const id = randomUUID();
      ids.push(id);
      await pool.query(
        "INSERT INTO enough.auth_users (id, email, email_normalized, email_verified_at) VALUES ($1, $2, $2, now())",
        [id, `phase5-${id}@example.test`],
      );
      const user = await device(id, type);
      if (consent)
        await ok("/privacy-consents/ACTIVITY_COLLECTION", user, { enabled: true }, "PUT");
      return { ...user, productId: await product(user) };
    }
    function event(productId: string, clientSequence = 0, overrides: Record<string, unknown> = {}) {
      return {
        eventId: randomUUID(),
        productId,
        eventType: "app.usage",
        eventVersion: 1,
        clientSequence,
        occurredAt: new Date(Date.now() - 60_000).toISOString(),
        attributes: { app: "test.exe", seconds: 30 },
        ...overrides,
      };
    }
    async function counts(user: User) {
      const result = await pool.query(
        `SELECT (SELECT count(*)::int FROM enough.activity_events WHERE user_id = $1) AS events,
          (SELECT COALESCE(sum(a.event_count), 0)::int FROM enough.activity_event_aggregates a
           JOIN enough.products p ON p.id = a.product_id WHERE p.user_id = $1) AS aggregate,
          (SELECT count(*)::int FROM enough.auth_audit_events WHERE user_id = $1
           AND event_type = 'activity.events_ingested') AS audits`,
        [user.id],
      );
      return result.rows[0];
    }
    async function consistent(user: User) {
      const mismatch = await pool.query(
        `WITH actual AS (
           SELECT product_id, event_type,
             date_trunc('hour', effective_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS bucket_start,
             count(*)::bigint AS event_count, max(effective_at) AS last_event_at
           FROM enough.activity_events WHERE user_id = $1 GROUP BY 1, 2, 3
         ), stored AS (
           SELECT a.product_id, a.event_type, a.bucket_start, a.event_count, a.last_event_at
           FROM enough.activity_event_aggregates a JOIN enough.products p ON p.id = a.product_id
           WHERE p.user_id = $1
         ) SELECT * FROM ((SELECT * FROM actual EXCEPT SELECT * FROM stored)
           UNION ALL (SELECT * FROM stored EXCEPT SELECT * FROM actual)) delta`,
        [user.id],
      );
      expect(mismatch.rows).toEqual([]);
    }

    it("ingests through cookie web proxy and bearer clients with server-owned identity", async () => {
      const user = await account(true, "web");
      const sample = event(user.productId);
      expect(await ok("/activity/events", user, sample, "POST", true)).toMatchObject({
        received: 1,
        accepted: 1,
        duplicates: 0,
      });
      const extension = await device(user.id, "extension");
      expect(await ok("/activity/events", extension, event(user.productId))).toMatchObject({
        accepted: 1,
      });
      const rows = await pool.query(
        "SELECT device_id FROM enough.activity_events WHERE user_id = $1",
        [user.id],
      );
      expect(rows.rows.map((row) => row.device_id).sort()).toEqual(
        [user.deviceId, extension.deviceId].sort(),
      );
      await consistent(user);
    });

    it("normalizes UUIDs, timezone offsets, default versions and attribute order for replay", async () => {
      const user = await account();
      const sample = event(user.productId, 0, {
        occurredAt: new Date(Date.now() - 3600_000).toISOString(),
      });
      await ok("/activity/events", user, sample);
      const retry = {
        ...sample,
        eventId: sample.eventId.toUpperCase(),
        productId: user.productId.toUpperCase(),
        eventVersion: undefined,
        occurredAt: sample.occurredAt.replace("Z", "+00:00"),
        attributes: { seconds: 30, app: "test.exe" },
      };
      expect(await ok("/activity/batch", user, { events: [retry, retry] })).toMatchObject({
        received: 2,
        accepted: 0,
        duplicates: 2,
      });
      expect(await counts(user)).toEqual({ events: 1, aggregate: 1, audits: 1 });
    });

    it("replays mixed duplicate batches without changing aggregates or audit counts", async () => {
      const user = await account();
      const a = event(user.productId, 0);
      const b = event(user.productId, 1);
      const batch = { events: [b, a, b] };
      expect(await ok("/activity/batch", user, batch)).toMatchObject({
        received: 3,
        accepted: 2,
        duplicates: 1,
      });
      expect(await ok("/activity/batch", user, batch)).toMatchObject({
        accepted: 0,
        duplicates: 3,
      });
      expect(await counts(user)).toEqual({ events: 2, aggregate: 2, audits: 1 });
      await consistent(user);
    });

    it.each(["id", "sequence"])(
      "rejects conflicting %s reuse inside a batch atomically",
      async (kind) => {
        const user = await account();
        const a = event(user.productId);
        const conflict =
          kind === "id" ? { ...a, attributes: { seconds: 99 } } : event(user.productId);
        expect(
          (
            await request("/activity/batch", user, {
              events: [event(user.productId, 2), a, conflict],
            })
          ).status,
        ).toBe(409);
        expect(await counts(user)).toEqual({ events: 0, aggregate: 0, audits: 0 });
      },
    );

    it.each(["id", "sequence"])(
      "rolls back fresh rows/rollups/audit on stored %s conflict",
      async (kind) => {
        const user = await account();
        const a = event(user.productId);
        await ok("/activity/events", user, a);
        const conflict =
          kind === "id" ? { ...a, attributes: { seconds: 99 } } : event(user.productId);
        expect(
          (await request("/activity/batch", user, { events: [event(user.productId, 1), conflict] }))
            .status,
        ).toBe(409);
        expect(await counts(user)).toEqual({ events: 1, aggregate: 1, audits: 1 });
        await consistent(user);
      },
    );

    it("accepts offline and out-of-order sequences with independent product/device streams", async () => {
      const user = await account();
      const otherProduct = await product(user);
      const otherDevice = await device(user.id, "extension");
      const batch = [9, 2, 7].map((seq) => event(user.productId, seq));
      const result = await ok("/activity/batch", user, { events: batch });
      expect(result.events.map((row: { clientSequence: number }) => row.clientSequence)).toEqual([
        2, 7, 9,
      ]);
      await ok("/activity/events", user, event(user.productId, 1));
      await ok("/activity/events", user, event(otherProduct, 2));
      await ok("/activity/events", otherDevice, event(user.productId, 2));
      expect(await counts(user)).toMatchObject({ events: 6, aggregate: 6 });
      await consistent(user);
    });

    it("corrects future/old timestamps, preserves submitted times, and retries stored corrections", async () => {
      const user = await account();
      const now = Date.now();
      const offsets = [4 * 60_000, 6 * 60_000, -7 * 86400_000 + 60_000, -7 * 86400_000 - 60_000];
      const events = offsets.map((offset, i) =>
        event(user.productId, i, { occurredAt: new Date(now + offset).toISOString() }),
      );
      const result = await ok("/activity/batch", user, { events });
      expect(result.clockAdjusted).toBe(2);
      expect(result.events.map((row: { clockAdjusted: boolean }) => row.clockAdjusted)).toEqual([
        false,
        true,
        false,
        true,
      ]);
      for (const row of result.events.filter(
        (row: { clockAdjusted: boolean }) => row.clockAdjusted,
      ))
        expect(row.effectiveAt).toBe(result.serverTime);
      const saved = await pool.query(
        "SELECT client_occurred_at FROM enough.activity_events WHERE user_id = $1 ORDER BY client_sequence",
        [user.id],
      );
      expect(saved.rows.map((row) => row.client_occurred_at.toISOString())).toEqual(
        events.map((row) => row.occurredAt),
      );
      const replay = await ok("/activity/batch", user, { events });
      expect(replay).toMatchObject({ accepted: 0, duplicates: 4, clockAdjusted: 0 });
      expect(replay.events.map((row: { effectiveAt: string }) => row.effectiveAt)).toEqual(
        result.events.map((row: { effectiveAt: string }) => row.effectiveAt),
      );
      await consistent(user);
    });

    it("aggregates by UTC hour/product/type with correct count and maximum time", async () => {
      const user = await account();
      const day = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
      const events = ["00:59:59.999Z", "01:00:00.000Z", "01:30:00.000Z"].map((time, i) =>
        event(user.productId, i, { occurredAt: `${day}T${time}` }),
      );
      await ok("/activity/batch", user, {
        events: [
          ...events,
          event(user.productId, 3, {
            eventType: "browser.domain",
            occurredAt: `${day}T01:10:00.000Z`,
          }),
        ],
      });
      const buckets = await pool.query(
        "SELECT event_type, event_count::int FROM enough.activity_event_aggregates WHERE product_id = $1 ORDER BY event_type, bucket_start",
        [user.productId],
      );
      expect(buckets.rows).toEqual([
        { event_type: "app.usage", event_count: 1 },
        { event_type: "app.usage", event_count: 2 },
        { event_type: "browser.domain", event_count: 1 },
      ]);
      await consistent(user);
    });

    it("handles simultaneous identical reversed batches exactly once", async () => {
      const user = await account();
      const events = Array.from({ length: 40 }, (_, i) => event(user.productId, i));
      const replies = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          ok("/activity/batch", user, { events: i % 2 ? [...events].reverse() : events }),
        ),
      );
      expect(replies.reduce((sum, result) => sum + result.accepted, 0)).toBe(40);
      expect(await counts(user)).toEqual({ events: 40, aggregate: 40, audits: 1 });
      await consistent(user);
    });

    it.each(["id", "sequence"])(
      "has one atomic winner for simultaneous %s conflicts",
      async (kind) => {
        const user = await account();
        const shared = event(user.productId, 0);
        const replies = await Promise.all(
          [0, 1].map((index) =>
            request("/activity/batch", user, {
              events: [
                event(user.productId, index + 1),
                kind === "id"
                  ? { ...shared, attributes: { seconds: index } }
                  : event(user.productId, 0),
              ],
            }),
          ),
        );
        expect(replies.map((reply) => reply.status).sort()).toEqual([200, 409]);
        expect(await counts(user)).toEqual({ events: 2, aggregate: 2, audits: 1 });
        await consistent(user);
      },
    );

    it("keeps exact totals for ten concurrent 100-event multi-device batches", async () => {
      const user = await account();
      const devices = await Promise.all(Array.from({ length: 10 }, () => device(user.id)));
      const start = performance.now();
      const results = await Promise.all(
        devices.map((sender) =>
          ok("/activity/batch", sender, {
            events: Array.from({ length: 100 }, (_, i) => event(user.productId, i)),
          }),
        ),
      );
      expect(results.every((result) => result.accepted === 100)).toBe(true);
      expect(await counts(user)).toEqual({ events: 1000, aggregate: 1000, audits: 10 });
      await consistent(user);
      console.info(
        `Phase 5 bounded load: 1000 events / 10 devices in ${Math.round(performance.now() - start)} ms`,
      );
      expect((await request("/activity/events", user, event(user.productId, 101))).status).toBe(
        429,
      );
      expect(await counts(user)).toMatchObject({ events: 1000, aggregate: 1000 });
    });

    it("enforces consent, authentication, CSRF, ownership and strict identity fields", async () => {
      const user = await account(false, "web");
      const other = await account();
      const sample = event(user.productId);
      expect((await request("/activity/events", undefined, sample)).status).toBe(401);
      expect((await request("/activity/events", user, sample)).status).toBe(403);
      await ok("/privacy-consents/ACTIVITY_COLLECTION", user, { enabled: true }, "PUT");
      for (const headers of [
        { ...user.headers, "x-csrf-token": "invalid" },
        { ...user.headers, origin: "https://hostile.example.test" },
      ]) {
        expect((await request("/activity/events", { ...user, headers }, sample)).status).toBe(403);
      }
      expect(
        (await request("/activity/batch", user, { events: [sample, event(other.productId, 1)] }))
          .status,
      ).toBe(404);
      for (const field of ["userId", "deviceId"])
        expect(
          (await request("/activity/events", user, { ...sample, [field]: other.id })).status,
        ).toBe(400);
      expect((await request(`/activity/events?productId=${other.productId}`, user)).status).toBe(
        404,
      );
      await ok("/activity/events", user, sample);
      await ok("/privacy-consents/ACTIVITY_COLLECTION", user, { enabled: false }, "PUT");
      expect((await request("/activity/events", user, event(user.productId, 1))).status).toBe(403);
      expect(await counts(user)).toEqual({ events: 1, aggregate: 1, audits: 1 });
      expect((await ok("/activity/events", other)).events).toEqual([]);
    });

    it("rejects malformed envelopes and bounded payload violations without mutation", async () => {
      const user = await account();
      const sample = event(user.productId);
      const invalid = [
        { eventId: "invalid" },
        { productId: "invalid" },
        { eventType: "Bad Type" },
        { eventVersion: 0 },
        { eventVersion: 32768 },
        { clientSequence: -1 },
        { clientSequence: 1.5 },
        { clientSequence: Number.MAX_SAFE_INTEGER + 1 },
        { occurredAt: "2026-10-10" },
        { attributes: { nested: {} } },
        { attributes: { values: [] } },
        { attributes: { "invalid-key": "value" } },
        { attributes: { app: "x".repeat(257) } },
        { attributes: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`a${i}`, i])) },
        {
          attributes: Object.fromEntries(
            Array.from({ length: 8 }, (_, i) => [`a${i}`, "é".repeat(200)]),
          ),
        },
      ];
      for (const overrides of invalid)
        expect((await request("/activity/events", user, { ...sample, ...overrides })).status).toBe(
          400,
        );
      for (const events of [[], Array.from({ length: 101 }, () => sample)])
        expect((await request("/activity/batch", user, { events })).status).toBe(400);
      expect(
        (
          await request("/activity/batch", user, {
            events: [sample],
            padding: "x".repeat(310 * 1024),
          })
        ).status,
      ).toBe(413);
      expect(await counts(user)).toEqual({ events: 0, aggregate: 0, audits: 0 });
    });

    it.each(["test\u0000.exe", "test\ud800.exe", "test\udc00.exe"])(
      "rejects PostgreSQL-incompatible text case %# as a validation error",
      async (app) => {
        const user = await account();
        expect(
          (
            await request(
              "/activity/events",
              user,
              event(user.productId, 0, { attributes: { app } }),
            )
          ).status,
        ).toBe(400);
        expect(await counts(user)).toEqual({ events: 0, aggregate: 0, audits: 0 });
      },
    );

    it("paginates tied times without gaps and exports only owned data without hashes", async () => {
      const user = await account();
      const time = new Date(Date.now() - 60_000).toISOString();
      const events = Array.from({ length: 7 }, (_, i) =>
        event(user.productId, i, { occurredAt: time }),
      );
      await ok("/activity/batch", user, { events });
      const seen: string[] = [];
      let cursor = "";
      do {
        const page = await ok(
          `/activity/events?limit=2&productId=${user.productId}${cursor}`,
          user,
        );
        seen.push(...page.events.map((row: { eventId: string }) => row.eventId));
        cursor = page.nextCursor
          ? `&before=${encodeURIComponent(page.nextCursor.before)}&beforeId=${page.nextCursor.beforeId}`
          : "";
      } while (cursor);
      expect(seen.sort()).toEqual(events.map((row) => row.eventId).sort());
      expect(
        (await ok(`/activity/events?since=${encodeURIComponent(new Date().toISOString())}`, user))
          .events,
      ).toEqual([]);
      expect((await request(`/activity/events?before=${time}`, user)).status).toBe(400);
      const exported = await ok("/auth/account/export", user);
      expect(exported.activityEvents).toHaveLength(7);
      expect(exported.activityAggregates).toHaveLength(1);
      expect(JSON.stringify(exported.activityEvents)).not.toMatch(/event_hash|token_hash/);
      const other = await account();
      expect((await ok("/auth/account/export", other)).activityEvents).toEqual([]);
      const audit = await pool.query(
        "SELECT metadata FROM enough.auth_audit_events WHERE user_id = $1 AND event_type = 'activity.events_ingested'",
        [user.id],
      );
      expect(Object.keys(audit.rows[0].metadata).sort()).toEqual([
        "accepted",
        "batchId",
        "duplicates",
      ]);
    });

    it("accepts exact attribute/sequence/version bounds and isolates reused IDs across owners", async () => {
      const user = await account();
      const other = await account();
      const attributes = Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => [`a${i}`, "x".repeat(248)]),
      );
      expect(Buffer.byteLength(JSON.stringify(attributes))).toBe(2049);
      attributes.a0 = "x".repeat(247);
      expect(Buffer.byteLength(JSON.stringify(attributes))).toBe(2048);
      const sample = event(user.productId, Number.MAX_SAFE_INTEGER, {
        attributes,
        eventVersion: 32767,
      });
      await ok("/activity/events", user, sample);
      await ok("/activity/events", other, { ...sample, productId: other.productId });
      await ok(
        "/activity/events",
        user,
        event(user.productId, 1, {
          attributes: Object.fromEntries(
            Array.from({ length: 16 }, (_, i) => [`a${i}`, i === 0 ? "😀" : i]),
          ),
        }),
      );
      expect(await counts(user)).toMatchObject({ events: 2, aggregate: 2 });
      expect(await counts(other)).toMatchObject({ events: 1, aggregate: 1 });
    });

    it("rolls back an injected database failure after rollup and safely retries the same IDs", async () => {
      const user = await account();
      const sample = event(user.productId);
      const constraint = `phase5_failure_${user.id.replaceAll("-", "")}`;
      // This disposable-only constraint targets this synthetic account and the
      // final audit write, after event and aggregate writes have executed.
      await pool.query(`ALTER TABLE enough.auth_audit_events ADD CONSTRAINT ${constraint}
        CHECK (user_id <> '${user.id}'::uuid OR event_type <> 'activity.events_ingested') NOT VALID`);
      try {
        expect((await request("/activity/events", user, sample)).status).toBe(503);
        expect(await counts(user)).toEqual({ events: 0, aggregate: 0, audits: 0 });
      } finally {
        await pool.query(`ALTER TABLE enough.auth_audit_events DROP CONSTRAINT ${constraint}`);
      }
      expect(await ok("/activity/events", user, sample)).toMatchObject({ accepted: 1 });
      await consistent(user);
    });

    it("deletes activity and aggregates together, cascades products/accounts and isolates other owners", async () => {
      const user = await account();
      const other = await account();
      await ok("/activity/events", user, event(user.productId));
      await ok("/activity/events", other, event(other.productId));
      expect(
        await ok("/privacy-activity", user, { confirmation: "DELETE" }, "DELETE"),
      ).toMatchObject({ deleted: 1 });
      expect(await counts(user)).toMatchObject({ events: 0, aggregate: 0 });
      await ok("/activity/events", user, event(user.productId, 1));
      await pool.query("DELETE FROM enough.products WHERE id = $1 AND user_id = $2", [
        user.productId,
        user.id,
      ]);
      expect(await counts(user)).toMatchObject({ events: 0, aggregate: 0 });
      const replacement = await product(user);
      await ok("/activity/events", user, event(replacement));
      expect(
        (
          await request(
            "/auth/account",
            user,
            { confirmationEmail: `phase5-${user.id}@example.test` },
            "DELETE",
          )
        ).status,
      ).toBe(204);
      expect(await counts(user)).toMatchObject({ events: 0, aggregate: 0 });
      expect((await request("/activity/events", user)).status).toBe(401);
      expect(await counts(other)).toMatchObject({ events: 1, aggregate: 1 });
      await consistent(other);
    });

    // Wait for a real PostgreSQL lock dependency, rather than a timing-only race.
    async function waitForBlocked(pid: number) {
      for (let i = 0; i < 200; i += 1) {
        const result = await pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
          [pid],
        );
        if (result.rowCount) return;
        await delay(10);
      }
      throw new Error("Expected ingestion to wait on the fixture transaction");
    }

    it.each(["session", "device", "rotation", "expiry"])(
      "rejects %s invalidation while ingestion waits on consent",
      async (kind) => {
        const user = await account();
        const locker = await pool.connect();
        let pending: Promise<Response> | undefined;
        try {
          await locker.query("BEGIN");
          const pid = (await locker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
          await locker.query(
            "SELECT 1 FROM enough.privacy_consents WHERE user_id = $1 FOR UPDATE",
            [user.id],
          );
          pending = request("/activity/events", user, event(user.productId));
          await waitForBlocked(pid);
          if (kind === "rotation") {
            await pool.query(
              "UPDATE enough.auth_sessions SET token_hash = decode(repeat('00', 32), 'hex') WHERE id = $1 AND user_id = $2",
              [user.sessionId, user.id],
            );
          } else if (kind === "expiry") {
            await pool.query(
              "UPDATE enough.auth_sessions SET created_at = clock_timestamp() - interval '2 seconds', expires_at = clock_timestamp() - interval '1 second' WHERE id = $1 AND user_id = $2",
              [user.sessionId, user.id],
            );
          } else {
            const table = kind === "session" ? "auth_sessions" : "auth_devices";
            const id = kind === "session" ? user.sessionId : user.deviceId;
            await pool.query(
              `UPDATE enough.${table} SET revoked_at = now() WHERE id = $1 AND user_id = $2`,
              [id, user.id],
            );
          }
          await locker.query("COMMIT");
          expect((await pending).status).toBe(401);
          expect(await counts(user)).toEqual({ events: 0, aggregate: 0, audits: 0 });
        } finally {
          await locker.query("ROLLBACK");
          locker.release();
          await pending?.catch(() => {});
        }
      },
    );

    it("denies an upload queued behind committed consent revocation", async () => {
      const user = await account();
      const locker = await pool.connect();
      let pending: Promise<Response> | undefined;
      try {
        await locker.query("BEGIN");
        const pid = (await locker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        await locker.query(
          "UPDATE enough.privacy_consents SET enabled = false WHERE user_id = $1",
          [user.id],
        );
        pending = request("/activity/events", user, event(user.productId));
        await waitForBlocked(pid);
        await locker.query("COMMIT");
        expect((await pending).status).toBe(403);
        expect(await counts(user)).toEqual({ events: 0, aggregate: 0, audits: 0 });
      } finally {
        await locker.query("ROLLBACK");
        locker.release();
        await pending?.catch(() => {});
      }
    });
  },
);
