import { randomUUID } from "node:crypto";
import { PRODUCT_STAGE_GUIDANCE, PRODUCT_STAGES } from "@enough/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe.skipIf(process.env.ENOUGH_PHASE4_INTEGRATION !== "1")(
  "Phase 4 products on disposable PostgreSQL, Redis and web proxy",
  () => {
    let pool: typeof import("@enough/db").pool;
    const ids: string[] = [];
    const web = "http://127.0.0.1:3304";
    const answers = {
      productDescription: "Clinic scheduling assistant",
      targetCustomer: "Independent clinics",
      problemStatement: "Appointment reminders take too much staff time",
      productStage: "IDEA",
      hasLaunched: false,
      userCount: 10,
      payingUserCount: 2,
      currentRevenue: "10.00",
      revenueCurrency: "EUR",
      nextGoal: "Interview five clinic owners",
      buildTools: ["Terminal"],
    };

    beforeAll(async () => {
      const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
      expect([target.hostname, target.port, target.pathname, target.username]).toEqual([
        "127.0.0.1",
        "55435",
        "/enough_phase4",
        "enough_phase4",
      ]);
      expect(process.env.REDIS_URL).toBe("redis://127.0.0.1:56385/0");
      expect(process.env.APP_BASE_URL).toBe(web);
      expect(process.env.API_BASE_URL).toBe("http://127.0.0.1:4406");
      ({ pool } = await import("@enough/db"));
    });
    afterAll(async () => {
      if (!pool) return;
      await pool.query("DELETE FROM enough.auth_audit_events WHERE user_id = ANY($1::uuid[])", [
        ids,
      ]);
      await pool.query("DELETE FROM enough.auth_users WHERE id = ANY($1::uuid[])", [ids]);
      await pool.end();
    });

    async function account() {
      const id = randomUUID();
      ids.push(id);
      await pool.query(
        "INSERT INTO enough.auth_users (id, email, email_normalized, email_verified_at) VALUES ($1, $2, $2, now())",
        [id, `phase4-${id}@example.test`],
      );
      const { createSession } = await import("../../../packages/auth/src/session.js");
      const session = await createSession(id, "web", "Phase 4 disposable test", "magic_link");
      return {
        id,
        headers: {
          cookie: `enough_session=${session.token}; enough_csrf=${session.csrfToken}`,
          "x-csrf-token": session.csrfToken ?? "",
          origin: web,
          "content-type": "application/json",
        },
      };
    }
    type Account = Awaited<ReturnType<typeof account>>;
    function request(path: string, user?: Account, body?: unknown, method?: string) {
      return fetch(`${web}/api${path}`, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers: user?.headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });
    }
    async function ok(path: string, user: Account, body?: unknown, method?: string) {
      const response = await request(path, user, body, method);
      expect(response.status, `${method ?? "request"} ${path}`).toBe(
        body === undefined ||
          method === "PATCH" ||
          path === "/onboarding" ||
          path.endsWith("/stage")
          ? 200
          : 201,
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      return response.json();
    }
    async function create(user: Account, name = "Second product", productStage = "IDEA") {
      const result = await ok("/products", user, {
        name,
        productStage,
        targetCustomer: answers.targetCustomer,
        problemStatement: answers.problemStatement,
        initialGoal: "Find three customers",
      });
      return result.product;
    }
    async function onboard(user: Account) {
      return ok("/onboarding", user, answers);
    }
    const metric = (metricKey: string, value: string, unit = "users") => ({
      metricKey,
      value,
      unit,
      displayName: "Test observation",
    });

    it.each(PRODUCT_STAGES)(
      "creates a distinct %s product with correct guidance and initial records",
      async (stage) => {
        const user = await account();
        const product = await create(user, `Product ${stage}`, stage);
        const detail = await ok(`/products/${product.id}`, user);
        expect(detail.product.guidance).toMatchObject(PRODUCT_STAGE_GUIDANCE[stage]);
        expect(detail.product.guidance.buildPercent + detail.product.guidance.marketPercent).toBe(
          100,
        );
        expect(detail.stageHistory).toMatchObject([{ fromStage: null, toStage: stage }]);
        expect(detail.goals).toMatchObject([
          { isPrimary: true, status: "ACTIVE", title: "Find three customers" },
        ]);
        expect(detail.metrics).toHaveLength(2);
      },
    );

    it("records all stage transitions in order and makes same-stage retries a no-op", async () => {
      const user = await account();
      const { productId } = await onboard(user);
      for (let i = 1; i < PRODUCT_STAGES.length; i += 1) {
        const stage = PRODUCT_STAGES[i];
        await ok(`/products/${productId}/stage`, user, {
          productStage: stage,
          expectedStage: PRODUCT_STAGES[i - 1],
          reason: `Evidence ${i}`,
        });
        const profile = await ok("/onboarding", user);
        expect(profile.answers.productStage).toBe(stage);
        expect(profile.recommendation.headline).toBe(PRODUCT_STAGE_GUIDANCE[stage].headline);
        expect(profile.recommendation.firstAction).toBe(
          "Ask one paying customer which result made the product worth paying for.",
        );
      }
      const retry = await ok(`/products/${productId}/stage`, user, {
        productStage: "GROWTH",
        expectedStage: "GROWTH",
      });
      expect(retry.changed).toBe(false);
      const detail = await ok(`/products/${productId}`, user);
      expect(detail.stageHistory).toHaveLength(9);
      expect(detail.stageHistory.map((entry: { toStage: string }) => entry.toStage)).toEqual(
        [...PRODUCT_STAGES].reverse(),
      );
      const exported = await ok("/auth/account/export", user);
      expect(exported.products[0].stageHistory).toHaveLength(9);
    });

    it("rejects stale and simultaneous stage changes without extra history", async () => {
      const user = await account();
      const product = await create(user);
      const replies = await Promise.all([
        request(`/products/${product.id}/stage`, user, {
          productStage: "EARLY_USERS",
          expectedStage: "IDEA",
        }),
        request(`/products/${product.id}/stage`, user, {
          productStage: "PRE_LAUNCH",
          expectedStage: "IDEA",
        }),
      ]);
      expect(replies.map((reply) => reply.status).sort()).toEqual([200, 409]);
      const detail = await ok(`/products/${product.id}`, user);
      expect(detail.stageHistory).toHaveLength(2);
    });

    it("synchronizes canonical metrics, onboarding answers, recommendations and export", async () => {
      const user = await account();
      const { productId } = await onboard(user);
      await ok(`/products/${productId}/metrics`, user, metric("total_users", "30"));
      await ok(`/products/${productId}/metrics`, user, metric("paying_users", "0"));
      await ok(`/products/${productId}/metrics`, user, metric("current_revenue", "123.45", "USD"));
      const profile = await ok("/onboarding", user);
      expect(profile.answers).toMatchObject({
        userCount: 30,
        payingUserCount: 0,
        currentRevenue: "123.45",
        revenueCurrency: "USD",
      });
      expect(profile.recommendation.firstAction).toBe(
        "Trace your current revenue to the customer problem and path that produced it.",
      );
      const detail = await ok(`/products/${productId}`, user);
      expect(detail.product).toMatchObject({
        userCount: 30,
        payingUserCount: 0,
        currentRevenue: "123.45",
        revenueCurrency: "USD",
      });
      const exported = await ok("/auth/account/export", user);
      expect(exported.onboarding).toMatchObject({
        user_count: 30,
        paying_user_count: 0,
        current_revenue: "123.45",
        revenue_currency: "USD",
      });
      expect(exported.products[0].metrics).toHaveLength(6);
      await ok("/onboarding", user, profile.answers);
      expect((await ok(`/products/${productId}`, user)).metrics).toHaveLength(6);
    });

    it("updates the onboarding goal when a new primary is created and preserves completed goals on reload/save", async () => {
      const user = await account();
      const { productId } = await onboard(user);
      const { goal } = await ok(`/products/${productId}/goals`, user, {
        title: "Reach ten paying clinics",
        isPrimary: true,
      });
      const profile = await ok("/onboarding", user);
      expect(profile.answers.nextGoal).toBe(goal.title);
      expect(profile.recommendation.nextGoal).toBe(goal.title);
      await ok(
        `/products/${productId}/goals/${goal.id}`,
        user,
        { status: "COMPLETED", expectedStatus: "ACTIVE" },
        "PATCH",
      );
      const completed = await ok(`/products/${productId}`, user);
      expect(completed.goals.find((item: { id: string }) => item.id === goal.id)).toMatchObject({
        status: "COMPLETED",
        isPrimary: false,
        completedAt: expect.any(String),
      });
      await ok("/onboarding", user, profile.answers);
      const reloaded = await ok(`/products/${productId}`, user);
      expect(reloaded.goals).toHaveLength(2);
      expect(reloaded.goals.filter((item: { isPrimary: boolean }) => item.isPrimary)).toHaveLength(
        0,
      );
    });

    it("rejects stale goal status writes and keeps completion timestamps on idempotent retries", async () => {
      const user = await account();
      const product = await create(user);
      const { goals } = await ok(`/products/${product.id}`, user);
      const path = `/products/${product.id}/goals/${goals[0].id}`;
      const completed = await ok(
        path,
        user,
        { status: "COMPLETED", expectedStatus: "ACTIVE" },
        "PATCH",
      );
      expect(
        (await request(path, user, { status: "CANCELLED", expectedStatus: "ACTIVE" }, "PATCH"))
          .status,
      ).toBe(409);
      const retry = await ok(
        path,
        user,
        { status: "COMPLETED", expectedStatus: "COMPLETED" },
        "PATCH",
      );
      expect(retry.goal.completedAt).toBe(completed.goal.completedAt);
      const reopened = await ok(
        path,
        user,
        { status: "ACTIVE", expectedStatus: "COMPLETED" },
        "PATCH",
      );
      expect(reopened.goal).toMatchObject({
        status: "ACTIVE",
        completedAt: null,
        isPrimary: false,
      });
    });

    it("serializes concurrent primary creation and onboarding/metric writes without losing synchronization", async () => {
      const user = await account();
      const { productId } = await onboard(user);
      await Promise.all([
        ok(`/products/${productId}/goals`, user, { title: "Primary alpha", isPrimary: true }),
        ok(`/products/${productId}/goals`, user, { title: "Primary beta", isPrimary: true }),
      ]);
      let detail = await ok(`/products/${productId}`, user);
      const primaries = detail.goals.filter((item: { isPrimary: boolean }) => item.isPrimary);
      expect(primaries).toHaveLength(1);
      expect((await ok("/onboarding", user)).answers.nextGoal).toBe(primaries[0].title);
      await Promise.all([
        ok("/onboarding", user, { ...answers, userCount: 20 }),
        ok(`/products/${productId}/metrics`, user, metric("total_users", "40")),
      ]);
      detail = await ok(`/products/${productId}`, user);
      expect((await ok("/onboarding", user)).answers.userCount).toBe(detail.product.userCount);
    });

    it("keeps custom observations append-only and rejects invalid canonical metrics atomically", async () => {
      const user = await account();
      const { productId } = await onboard(user);
      const custom = await ok(
        `/products/${productId}/metrics`,
        user,
        metric("net_feedback", "-1.2500", "points"),
      );
      expect(custom.metric.value).toBe("-1.2500");
      const before = await ok(`/products/${productId}`, user);
      for (const input of [
        metric("total_users", "1"),
        metric("total_users", "3.5"),
        metric("paying_users", "11"),
        metric("current_revenue", "-1", "EUR"),
        metric("current_revenue", "1.001", "EUR"),
        metric("current_revenue", "1.00", "eur"),
        metric("Bad Key", "1"),
      ]) {
        expect((await request(`/products/${productId}/metrics`, user, input)).status).toBe(400);
      }
      expect(await ok(`/products/${productId}`, user)).toEqual(before);
    });

    it("rejects stale canonical metric values/currencies without adding observations", async () => {
      const user = await account();
      const { productId } = await onboard(user);
      await ok(`/products/${productId}/metrics`, user, {
        ...metric("total_users", "20"),
        expectedValue: "10",
      });
      const stale = await request(`/products/${productId}/metrics`, user, {
        ...metric("total_users", "30"),
        expectedValue: "10",
      });
      expect(stale.status).toBe(409);
      const currency = await request(`/products/${productId}/metrics`, user, {
        ...metric("current_revenue", "20", "GBP"),
        expectedValue: "10.00",
        expectedCurrency: "USD",
      });
      expect(currency.status).toBe(409);
      const detail = await ok(`/products/${productId}`, user);
      expect(detail.metrics).toHaveLength(4);
      expect(detail.product).toMatchObject({
        userCount: 20,
        currentRevenue: "10.00",
        revenueCurrency: "EUR",
      });
    });

    it("does not add duplicate revenue observations for equivalent decimal representations", async () => {
      const user = await account();
      const { productId } = await onboard(user);
      await ok("/onboarding", user, { ...answers, currentRevenue: "10" });
      expect((await ok(`/products/${productId}`, user)).metrics).toHaveLength(3);
    });

    it("rolls back a conflicting onboarding rename without changing stage, goal or metrics", async () => {
      const user = await account();
      const profile = await onboard(user);
      await create(user, "Existing name");
      const before = await ok(`/products/${profile.productId}`, user);
      const response = await request("/onboarding", user, {
        ...answers,
        productDescription: "existing name",
        productStage: "GROWTH",
        userCount: 99,
      });
      expect(response.status).toBe(409);
      expect(await ok("/onboarding", user)).toEqual(profile);
      expect(await ok(`/products/${profile.productId}`, user)).toEqual(before);
    });

    it("prevents concurrent traction updates from violating paying <= total", async () => {
      const user = await account();
      const { productId } = await onboard(user);
      const replies = await Promise.all([
        request(`/products/${productId}/metrics`, user, metric("total_users", "3")),
        request(`/products/${productId}/metrics`, user, metric("paying_users", "8")),
      ]);
      expect(replies.map((reply) => reply.status).sort()).toEqual([201, 400]);
      const { product } = await ok(`/products/${productId}`, user);
      expect(product.payingUserCount).toBeLessThanOrEqual(product.userCount);
    });

    it("returns a useful conflict for duplicate product names without partial records", async () => {
      const user = await account();
      await create(user, "Clinic Tool");
      const duplicate = await request("/products", user, {
        name: "clinic tool",
        targetCustomer: "Clinics",
        problemStatement: "Scheduling is slow",
        productStage: "IDEA",
        initialGoal: "Interview users",
      });
      expect(duplicate.status).toBe(409);
      expect((await ok("/products", user)).products).toHaveLength(1);
    });

    it("keeps multiple products separate and rejects cross-account/cross-product mutations and exports", async () => {
      const owner = await account();
      const other = await account();
      const { productId } = await onboard(owner);
      const second = await create(owner);
      const { goals } = await ok(`/products/${productId}`, owner);
      await create(other, "Other account product");
      for (const [path, body, method] of [
        [`/products/${productId}`, undefined, "GET"],
        [`/products/${productId}/stage`, { productStage: "GROWTH" }, "POST"],
        [`/products/${productId}/goals`, { title: "Forged goal" }, "POST"],
        [`/products/${productId}/metrics`, metric("total_users", "999"), "POST"],
        [`/products/${productId}/goals/${goals[0].id}`, { status: "COMPLETED" }, "PATCH"],
      ] as const)
        expect((await request(path, other, body, method)).status).toBe(404);
      expect(
        (
          await request(
            `/products/${second.id}/goals/${goals[0].id}`,
            owner,
            { status: "COMPLETED" },
            "PATCH",
          )
        ).status,
      ).toBe(404);
      const exported = await ok(`/auth/account/export?userId=${owner.id}`, other);
      expect(exported.products).toHaveLength(1);
      expect(exported.products[0].name).toBe("Other account product");
      expect((await ok(`/products/${productId}`, owner)).product.userCount).toBe(10);
    });

    it("requires authentication and CSRF on every product mutation", async () => {
      const user = await account();
      const product = await create(user);
      const { goals } = await ok(`/products/${product.id}`, user);
      for (const [path, body, method] of [
        ["/products", { name: "Forbidden product" }, "POST"],
        [`/products/${product.id}/stage`, { productStage: "GROWTH" }, "POST"],
        [`/products/${product.id}/goals`, { title: "Forbidden goal" }, "POST"],
        [`/products/${product.id}/metrics`, metric("total_users", "1"), "POST"],
        [`/products/${product.id}/goals/${goals[0].id}`, { status: "COMPLETED" }, "PATCH"],
      ] as const) {
        expect((await request(path, undefined, body, method)).status).toBe(401);
        expect(
          (
            await request(
              path,
              { ...user, headers: { ...user.headers, "x-csrf-token": "" } },
              body,
              method,
            )
          ).status,
        ).toBe(403);
      }
      expect((await request("/products")).status).toBe(401);
      expect((await request(`/products/${product.id}`)).status).toBe(401);
    });

    it("validates stage, goal bounds and IDs without changing product records", async () => {
      const user = await account();
      const product = await create(user);
      const before = await ok(`/products/${product.id}`, user);
      expect(
        (await request(`/products/${product.id}/stage`, user, { productStage: "INVALID" })).status,
      ).toBe(400);
      expect(
        (
          await request(`/products/${product.id}/stage`, user, {
            productStage: "GROWTH",
            reason: "x".repeat(501),
          })
        ).status,
      ).toBe(400);
      for (const goal of [
        { title: " " },
        { title: "Good goal", targetValue: "10000000000" },
        { title: "Good goal", dueAt: "tomorrow" },
      ]) {
        expect((await request(`/products/${product.id}/goals`, user, goal)).status).toBe(400);
      }
      expect((await request("/products/not-a-uuid", user)).status).toBe(400);
      expect((await request(`/products/${randomUUID()}`, user)).status).toBe(404);
      expect(await ok(`/products/${product.id}`, user)).toEqual(before);
    });

    it("cascades product children, unlinks onboarding and safely rejects deleted IDs", async () => {
      const user = await account();
      const { productId } = await onboard(user);
      const other = await create(user);
      await pool.query("DELETE FROM enough.products WHERE id = $1 AND user_id = $2", [
        productId,
        user.id,
      ]);
      for (const table of ["product_stage_history", "product_goals", "product_metrics"]) {
        expect(
          (
            await pool.query(
              `SELECT count(*)::int AS count FROM enough.${table} WHERE product_id = $1`,
              [productId],
            )
          ).rows[0].count,
        ).toBe(0);
      }
      expect((await ok("/onboarding", user)).productId).toBeNull();
      expect((await request(`/products/${productId}`, user)).status).toBe(404);
      expect(
        (await request(`/products/${productId}/stage`, user, { productStage: "GROWTH" })).status,
      ).toBe(404);
      const recreated = await onboard(user);
      expect(recreated.productId).not.toBe(productId);
      expect((await ok("/products", user)).products).toHaveLength(2);
      expect((await ok(`/products/${other.id}`, user)).product.id).toBe(other.id);
    });

    it("cascades all Phase 4 records on account deletion without touching another account", async () => {
      const user = await account();
      const other = await account();
      const { productId } = await onboard(user);
      const survivor = await create(other);
      expect(
        (
          await request(
            "/auth/account",
            user,
            { confirmationEmail: `phase4-${user.id}@example.test` },
            "DELETE",
          )
        ).status,
      ).toBe(204);
      expect(
        (await pool.query("SELECT id FROM enough.products WHERE id = $1", [productId])).rowCount,
      ).toBe(0);
      for (const table of ["product_stage_history", "product_goals", "product_metrics"]) {
        expect(
          (
            await pool.query(
              `SELECT count(*)::int AS count FROM enough.${table} WHERE product_id = $1`,
              [productId],
            )
          ).rows[0].count,
        ).toBe(0);
      }
      expect((await request(`/products/${productId}`, user)).status).toBe(401);
      expect((await ok(`/products/${survivor.id}`, other)).product.id).toBe(survivor.id);
    });
  },
);
