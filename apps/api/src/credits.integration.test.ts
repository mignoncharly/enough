import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe.skipIf(process.env.ENOUGH_PHASE8_INTEGRATION !== "1")(
  "Phase 8 credits and build sessions on disposable PostgreSQL, Redis, API, and web proxy",
  () => {
    let pool: typeof import("@enough/db").pool;
    const userIds: string[] = [];
    const api = "http://127.0.0.1:4414";
    const web = "http://127.0.0.1:3308";

    beforeAll(async () => {
      const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
      expect([target.hostname, target.port, target.pathname, target.username]).toEqual([
        "127.0.0.1",
        "55439",
        "/enough_phase8",
        "enough_phase8",
      ]);
      expect(process.env.REDIS_URL).toBe("redis://127.0.0.1:56393/0");
      expect(process.env.APP_BASE_URL).toBe(web);
      expect(process.env.API_BASE_URL).toBe(api);
      expect(process.env.CREDITS_MANUAL_CONTROLS_ENABLED).toBe("true");
      ({ pool } = await import("@enough/db"));
      const identity = await pool.query("SELECT current_user, current_database()");
      expect(identity.rows[0]).toEqual({
        current_user: "enough_phase8",
        current_database: "enough_phase8",
      });
      const migration = await pool.query(
        "SELECT id FROM enough.schema_migrations WHERE id = '0016_build_session_lifecycle.sql'",
      );
      expect(migration.rowCount).toBe(1);
    }, 60000);

    afterAll(async () => {
      if (pool) {
        await pool.query("DELETE FROM enough.auth_users WHERE id = ANY($1::uuid[])", [userIds]);
        await pool.end();
      }
    });

    async function device(userId: string, label: string) {
      const { createSession } = await import("../../../packages/auth/src/session.js");
      const session = await createSession(userId, "web", label, "magic_link");
      return {
        deviceId: session.deviceId,
        headers: {
          cookie: `enough_session=${session.token}; enough_csrf=${session.csrfToken}`,
          "x-csrf-token": session.csrfToken ?? "",
          origin: web,
          "content-type": "application/json",
        },
      };
    }

    async function account() {
      const id = randomUUID();
      const email = `phase8-${id}@example.test`;
      userIds.push(id);
      await pool.query(
        "INSERT INTO enough.auth_users (id, email, email_normalized, email_verified_at) VALUES ($1, $2, $2, now())",
        [id, email],
      );
      return { id, ...(await device(id, "Phase 8 synthetic test device")) };
    }

    type Account = Awaited<ReturnType<typeof account>>;

    function request(
      path: string,
      user?: Account | { headers: HeadersInit },
      body?: unknown,
      method?: string,
      headers: HeadersInit | undefined = user?.headers,
    ) {
      return fetch(`${web}/api${path}`, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });
    }

    async function payload(response: Response, status = 200) {
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      return response.json();
    }

    async function product(user: Account, suffix = "primary") {
      const response = await request("/onboarding", user, {
        productDescription: `Phase 8 ${suffix} synthetic workspace`,
        targetCustomer: "Synthetic review teams",
        problemStatement: "Test server-authoritative product credit sessions",
        productStage: "IDEA",
        hasLaunched: false,
        userCount: 0,
        payingUserCount: 0,
        currentRevenue: null,
        revenueCurrency: "EUR",
        nextGoal: "Verify isolated credit balances",
        buildTools: ["Terminal"],
      });
      const profile = await payload(response);
      expect(profile.productId).toEqual(expect.any(String));
      return profile.productId as string;
    }

    async function earn(
      user: Account,
      productId: string,
      amount: number,
      key: string = randomUUID(),
    ) {
      return payload(
        await request("/credits/earn", user, {
          productId,
          amount,
          idempotencyKey: `phase8-earn-${key}`,
          reason: "Synthetic test credits",
        }),
        201,
      );
    }

    async function wallet(user: Account, productId: string) {
      return payload(await request(`/credits?productId=${productId}`, user));
    }

    it("requires authentication and CSRF, isolates product wallets, and rejects foreign product IDs", async () => {
      expect((await request("/credits")).status).toBe(401);
      const owner = await account();
      const other = await account();
      const ownerProduct = await product(owner);
      const secondOwnerProduct = await payload(
        await request("/products", owner, {
          name: "Phase 8 second product",
          targetCustomer: "Synthetic review teams",
          problemStatement: "Keep product wallets distinct",
          productStage: "IDEA",
          initialGoal: "Confirm the second balance stays separate",
        }),
        201,
      ).then((result) => result.product.id as string);
      const otherProduct = await product(other);
      const unauthenticatedStart = await request("/credits/build-sessions/start", undefined, {
        productId: ownerProduct,
        reserveMinutes: 1,
        idempotencyKey: randomUUID(),
      });
      expect(unauthenticatedStart.status).toBe(401);
      const noCsrf = { ...owner.headers, "x-csrf-token": "" };
      expect(
        (
          await request(
            "/credits/build-sessions/start",
            owner,
            { productId: ownerProduct, reserveMinutes: 1, idempotencyKey: randomUUID() },
            "POST",
            noCsrf,
          )
        ).status,
      ).toBe(403);

      await earn(owner, ownerProduct, 8);
      expect((await wallet(owner, ownerProduct)).account.availableBalance).toBe(8);
      expect((await wallet(owner, secondOwnerProduct)).account.availableBalance).toBe(0);
      expect((await payload(await request("/credits", owner))).account.availableBalance).toBe(0);
      expect((await request(`/credits?productId=${ownerProduct}`, other)).status).toBe(404);
      expect(
        (
          await request("/credits/earn", other, {
            productId: ownerProduct,
            amount: 1,
            idempotencyKey: randomUUID(),
          })
        ).status,
      ).toBe(404);
      expect((await wallet(other, otherProduct)).account.availableBalance).toBe(0);
    });

    it("supports reserve, release, reserved spend, partial refunds, adjustments, expiry, and export", async () => {
      const owner = await account();
      const productId = await product(owner);
      await earn(owner, productId, 10);

      const released = await payload(
        await request("/credits/reserve", owner, {
          productId,
          amount: 4,
          idempotencyKey: randomUUID(),
        }),
        201,
      );
      const releasePath = `/credits/reservations/${released.reservation.id}/release`;
      const releaseKey = randomUUID();
      await payload(
        await request(releasePath, owner, { productId, idempotencyKey: releaseKey }),
        201,
      );
      await payload(
        await request(releasePath, owner, { productId, idempotencyKey: releaseKey }),
        200,
      );
      expect((await wallet(owner, productId)).account.availableBalance).toBe(10);

      const reserved = await payload(
        await request("/credits/reserve", owner, {
          productId,
          amount: 4,
          idempotencyKey: randomUUID(),
        }),
        201,
      );
      const spent = await payload(
        await request(`/credits/reservations/${reserved.reservation.id}/spend`, owner, {
          productId,
          idempotencyKey: randomUUID(),
        }),
        201,
      );
      const refundPath = "/credits/refund";
      for (const amount of [2, 2]) {
        await payload(
          await request(refundPath, owner, {
            productId,
            transactionId: spent.transaction.id,
            amount,
            idempotencyKey: randomUUID(),
          }),
          201,
        );
      }
      expect((await wallet(owner, productId)).account.availableBalance).toBe(10);

      for (const [direction, amount] of [
        ["CREDIT", 3],
        ["DEBIT", 1],
      ] as const) {
        await payload(
          await request("/credits/adjust", owner, {
            productId,
            direction,
            amount,
            idempotencyKey: randomUUID(),
            reason: "Synthetic balance correction",
          }),
          201,
        );
      }
      await earn(owner, productId, 2, "expiring");
      const expiringLot = await pool.query<{ id: string }>(
        `SELECT id FROM enough.credit_lots WHERE user_id = $1 AND account_id = $2
         ORDER BY created_at DESC LIMIT 1`,
        [owner.id, (await wallet(owner, productId)).account.id],
      );
      await pool.query(
        "UPDATE enough.credit_lots SET expires_at = now() - interval '1 second' WHERE id = $1",
        [expiringLot.rows[0].id],
      );
      await payload(
        await request("/credits/expire", owner, {
          productId,
          idempotencyKey: randomUUID(),
        }),
        201,
      );
      expect((await wallet(owner, productId)).account.availableBalance).toBe(12);

      const exported = await payload(await request("/auth/account/export", owner));
      expect(exported.creditAccounts).toHaveLength(1);
      expect(
        exported.creditTransactions.some((item: { action: string }) => item.action === "EXPIRE"),
      ).toBe(true);
      expect(exported.creditReservationAllocations[0]).toHaveProperty("remaining_amount");
    });

    it("serializes concurrent spends and only permits one open session per product account", async () => {
      const owner = await account();
      const productId = await product(owner);
      await earn(owner, productId, 5);
      const spends = await Promise.all([
        request("/credits/spend", owner, {
          productId,
          amount: 4,
          idempotencyKey: randomUUID(),
        }),
        request("/credits/spend", owner, {
          productId,
          amount: 4,
          idempotencyKey: randomUUID(),
        }),
      ]);
      expect(spends.map((response) => response.status).sort()).toEqual([201, 409]);
      expect((await wallet(owner, productId)).account.availableBalance).toBe(1);
      const databaseBalance = await pool.query<{
        available_balance: string;
        reserved_balance: string;
      }>(
        "SELECT available_balance::text, reserved_balance::text FROM enough.credit_accounts WHERE user_id = $1 AND product_id = $2",
        [owner.id, productId],
      );
      expect(databaseBalance.rows[0]).toEqual({ available_balance: "1", reserved_balance: "0" });

      await earn(owner, productId, 6);
      const starts = await Promise.all([
        request("/credits/build-sessions/start", owner, {
          productId,
          reserveMinutes: 2,
          idempotencyKey: randomUUID(),
        }),
        request("/credits/build-sessions/start", owner, {
          productId,
          reserveMinutes: 2,
          idempotencyKey: randomUUID(),
        }),
      ]);
      expect(starts.map((response) => response.status).sort()).toEqual([201, 409]);
      const successfulStart = starts.find((response) => response.status === 201);
      expect(successfulStart).toBeDefined();
      const session = (await successfulStart?.json())?.buildSession;
      expect(session.status).toBe("ACTIVE");
      await payload(
        await request(`/credits/build-sessions/${session.id}/settle`, owner, {
          leaseVersion: session.leaseVersion,
          idempotencyKey: randomUUID(),
        }),
      );
    });

    it("meters and settles idempotently, recovers cross-device leases, and rejects stale devices", async () => {
      const owner = await account();
      const productId = await product(owner);
      await earn(owner, productId, 6);
      expect(
        (
          await request("/credits/build-sessions/start", owner, {
            productId,
            reserveMinutes: 61,
            idempotencyKey: randomUUID(),
          })
        ).status,
      ).toBe(400);
      const startKey = randomUUID();
      const startBody = { productId, reserveMinutes: 5, idempotencyKey: startKey };
      const started = await payload(
        await request("/credits/build-sessions/start", owner, startBody),
        201,
      );
      const sessionId = started.buildSession.id as string;
      const replayedStart = await payload(
        await request("/credits/build-sessions/start", owner, startBody),
        200,
      );
      expect(replayedStart.buildSession.id).toBe(sessionId);
      expect((await wallet(owner, productId)).account).toMatchObject({
        availableBalance: 1,
        reservedBalance: 5,
      });
      expect(
        (
          await request(`/credits/reservations/${started.reservation.id}/release`, owner, {
            productId,
            idempotencyKey: randomUUID(),
          })
        ).status,
      ).toBe(409);

      const intruder = await account();
      expect(
        (
          await request(`/credits/build-sessions/${sessionId}/settle`, intruder, {
            leaseVersion: 1,
            idempotencyKey: randomUUID(),
          })
        ).status,
      ).toBe(404);

      await pool.query(
        "UPDATE enough.build_sessions SET last_heartbeat_at = clock_timestamp() - interval '61 seconds' WHERE id = $1",
        [sessionId],
      );
      const heartbeatKey = randomUUID();
      const heartbeatBody = { leaseVersion: 1, idempotencyKey: heartbeatKey };
      const heartbeat = await payload(
        await request(`/credits/build-sessions/${sessionId}/heartbeat`, owner, heartbeatBody),
      );
      expect(heartbeat.session).toMatchObject({
        status: "ACTIVE",
        activeSeconds: 61,
        billableMinutes: 2,
      });
      expect(
        await payload(
          await request(`/credits/build-sessions/${sessionId}/heartbeat`, owner, heartbeatBody),
        ),
      ).toEqual(heartbeat);
      expect(
        (
          await request(`/credits/build-sessions/${sessionId}/heartbeat`, owner, {
            leaseVersion: 2,
            idempotencyKey: heartbeatKey,
          })
        ).status,
      ).toBe(409);

      const secondDevice = await device(owner.id, "Phase 8 cross-device recovery");
      await pool.query(
        "UPDATE enough.build_sessions SET last_heartbeat_at = clock_timestamp() - interval '91 seconds' WHERE id = $1",
        [sessionId],
      );
      const resumed = await payload(
        await request(`/credits/build-sessions/${sessionId}/resume`, secondDevice, {
          leaseVersion: 1,
          idempotencyKey: randomUUID(),
        }),
      );
      expect(resumed.session).toMatchObject({
        status: "ACTIVE",
        leaseVersion: 2,
        activeSeconds: 61,
      });
      expect(
        (
          await request(`/credits/build-sessions/${sessionId}/heartbeat`, owner, {
            leaseVersion: 1,
            idempotencyKey: randomUUID(),
          })
        ).status,
      ).toBe(409);

      await pool.query(
        "UPDATE enough.build_sessions SET last_heartbeat_at = clock_timestamp() - interval '61 seconds' WHERE id = $1",
        [sessionId],
      );
      const finalHeartbeat = await payload(
        await request(`/credits/build-sessions/${sessionId}/heartbeat`, secondDevice, {
          leaseVersion: 2,
          idempotencyKey: randomUUID(),
        }),
      );
      expect(finalHeartbeat.session).toMatchObject({ activeSeconds: 122, billableMinutes: 3 });
      const settled = await payload(
        await request(`/credits/build-sessions/${sessionId}/settle`, secondDevice, {
          leaseVersion: 2,
          idempotencyKey: randomUUID(),
        }),
      );
      expect(settled.session.status).toBe("COMPLETED");
      expect(settled.account).toMatchObject({
        availableBalance: 3,
        reservedBalance: 0,
        lifetimeSpent: 3,
      });
      const ledger = await pool.query<{ action: string; amount: string; available_delta: string }>(
        `SELECT action, amount::text, available_delta::text FROM enough.credit_transactions
         WHERE reservation_id = $1 AND action = 'SPEND'`,
        [started.reservation.id],
      );
      expect(ledger.rows).toEqual([{ action: "SPEND", amount: "3", available_delta: "2" }]);
      const allocations = await pool.query<{ amount: string }>(
        "SELECT amount::text FROM enough.credit_transaction_allocations WHERE transaction_id IN (SELECT id FROM enough.credit_transactions WHERE reservation_id = $1 AND action = 'SPEND')",
        [started.reservation.id],
      );
      expect(allocations.rows.reduce((total, item) => total + Number(item.amount), 0)).toBe(3);
      const exported = await payload(await request("/auth/account/export", owner));
      expect(exported.buildSessions).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: sessionId, status: "COMPLETED" })]),
      );
      expect(exported.buildSessionCommands.length).toBeGreaterThanOrEqual(4);
    });

    it("settles expired reservations and releases unused synthetic minutes", async () => {
      const owner = await account();
      const productId = await product(owner);
      await earn(owner, productId, 3);
      const started = await payload(
        await request("/credits/build-sessions/start", owner, {
          productId,
          reserveMinutes: 2,
          idempotencyKey: randomUUID(),
        }),
        201,
      );
      await pool.query(
        `UPDATE enough.build_sessions SET expires_at = clock_timestamp() - interval '1 second'
         WHERE id = $1`,
        [started.buildSession.id],
      );
      await pool.query(
        `UPDATE enough.credit_reservations SET expires_at = clock_timestamp() - interval '1 second'
         WHERE id = $1`,
        [started.reservation.id],
      );
      const result = await wallet(owner, productId);
      expect(result.buildSessions[0].status).toBe("EXPIRED");
      expect(result.account).toMatchObject({ availableBalance: 3, reservedBalance: 0 });
      const negative = await pool.query(
        `SELECT count(*)::int AS count FROM enough.credit_accounts
         WHERE user_id = $1 AND (available_balance < 0 OR reserved_balance < 0)`,
        [owner.id],
      );
      expect(negative.rows[0].count).toBe(0);
    });

    it("renders the authenticated credit workspace without exposing fixture credentials", async () => {
      const response = await fetch(`${web}/credits`, { signal: AbortSignal.timeout(45000) });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      const html = await response.text();
      expect(html).toContain("Loading credits");
      const routeScript = html.match(/src="([^"]*app\/credits\/page\.js[^"]*)"/);
      expect(routeScript?.[1]).toBeDefined();
      const scriptResponse = await fetch(new URL(routeScript?.[1] ?? "", web), {
        signal: AbortSignal.timeout(45000),
      });
      expect(scriptResponse.status).toBe(200);
      const script = await scriptResponse.text();
      expect(script).toContain("Server-authoritative build session");
      expect(script).toContain("Recover session lease");
      expect(script).toContain("Manual grants are disabled");
    });
  },
);
