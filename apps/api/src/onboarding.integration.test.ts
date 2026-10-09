import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { isLaunchedProductStage, PRODUCT_STAGE_GUIDANCE, PRODUCT_STAGES } from "@enough/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.ENOUGH_PHASE3_INTEGRATION === "1";
describe.skipIf(!enabled)(
  "Phase 3 onboarding with disposable PostgreSQL, Redis and web proxy",
  () => {
    let pool: typeof import("@enough/db").pool;
    const ids: string[] = [];
    const web = "http://127.0.0.1:3303";
    const api = "http://127.0.0.1:4404";
    const baseline = {
      productDescription: "A scheduling tool for clinics",
      targetCustomer: "Independent clinics",
      problemStatement: "Staff spend hours following up missed appointments",
      productStage: "IDEA",
      hasLaunched: false,
      userCount: 0,
      payingUserCount: 0,
      currentRevenue: null as string | null,
      revenueCurrency: "EUR",
      nextGoal: "Interview five clinic owners",
      buildTools: ["VS Code", "Terminal"],
    };

    beforeAll(async () => {
      const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
      expect([target.hostname, target.port, target.pathname, target.username]).toEqual([
        "127.0.0.1",
        "55434",
        "/enough_phase3",
        "enough_phase3",
      ]);
      expect(process.env.REDIS_URL).toBe("redis://127.0.0.1:56383/0");
      expect(process.env.APP_BASE_URL).toBe(web);
      expect(process.env.API_BASE_URL).toBe(api);
      ({ pool } = await import("@enough/db"));
      expect((await fetch(`${api}/ready`)).status).toBe(200);
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
        [id, `phase3-${id}@example.test`],
      );
      const { createSession } = await import("../../../packages/auth/src/session.js");
      const session = await createSession(id, "web", "Phase 3 automated fixture", "magic_link");
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
    function send(path: string, user?: Account, body?: unknown, extra: RequestInit = {}) {
      return fetch(`${web}/api${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: user?.headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "manual",
        signal: AbortSignal.timeout(45000),
        ...extra,
      });
    }
    async function save(user: Account, overrides: Partial<typeof baseline> = {}) {
      const response = await send("/onboarding", user, { ...baseline, ...overrides });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      return response.json();
    }

    it("has every migration applied in order with source-matching checksums", async () => {
      const directory = new URL("../../../packages/db/migrations/", import.meta.url);
      const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
      const applied = await pool.query(
        "SELECT id, checksum, applied_at FROM enough.schema_migrations ORDER BY id",
      );
      expect(applied.rows.map((row) => row.id)).toEqual(names);
      for (let i = 0; i < names.length; i += 1) {
        const sql = await readFile(new URL(names[i], directory), "utf8");
        expect(applied.rows[i].checksum).toBe(createHash("sha256").update(sql).digest("hex"));
        if (i)
          expect(+applied.rows[i].applied_at).toBeGreaterThanOrEqual(
            +applied.rows[i - 1].applied_at,
          );
      }
    });

    it("loads an empty profile then saves, reloads, edits and exports every answer", async () => {
      const user = await account();
      expect(await (await send("/onboarding", user)).json()).toMatchObject({
        completed: false,
        answers: null,
        recommendation: null,
      });
      const initial = await save(user);
      expect(initial.answers).toEqual(baseline);
      expect(await (await send("/onboarding", user)).json()).toEqual(initial);
      const edited = {
        productDescription: "A booking assistant",
        targetCustomer: "Dental practices",
        problemStatement: "Receptionists need fewer manual reminder calls",
        productStage: "FIRST_REVENUE",
        hasLaunched: true,
        userCount: 30,
        payingUserCount: 7,
        currentRevenue: "1234.56",
        revenueCurrency: "USD",
        nextGoal: "Retain the first seven paying clinics",
        buildTools: ["Cursor", "Terminal", "Figma"],
      };
      const updated = await save(user, edited);
      expect(updated.answers).toEqual(edited);
      expect(updated.productId).toBe(initial.productId);
      expect(await (await send("/onboarding", user)).json()).toEqual(updated);
      const exported = await send("/auth/account/export", user);
      expect(exported.status).toBe(200);
      const data = await exported.json();
      expect(data.onboarding).toMatchObject({
        product_description: edited.productDescription,
        target_customer: edited.targetCustomer,
        problem_statement: edited.problemStatement,
        product_stage: edited.productStage,
        has_launched: true,
        user_count: 30,
        paying_user_count: 7,
        current_revenue: "1234.56",
        revenue_currency: "USD",
        next_goal: edited.nextGoal,
        build_tools: edited.buildTools,
        recommended_config: updated.recommendation,
      });
      const cleared = await save(user, { currentRevenue: null, buildTools: [] });
      expect(cleared.answers.currentRevenue).toBeNull();
      expect(cleared.answers.buildTools).toEqual([]);
    });

    it.each(PRODUCT_STAGES)(
      "prepares the %s dashboard without manual policy creation",
      async (stage) => {
        const user = await account();
        const result = await save(user, { productStage: stage });
        expect(result.productId).toMatch(/^[a-f0-9-]{36}$/);
        expect(result.answers.hasLaunched).toBe(isLaunchedProductStage(stage));
        const guidance = PRODUCT_STAGE_GUIDANCE[stage];
        expect(result.recommendation).toMatchObject({
          productStage: stage,
          headline: guidance.headline,
          priorities: guidance.priorities,
          signalsToNotice: guidance.signals,
          tasks: guidance.tasks,
          recommendedRatio: {
            buildPercent: guidance.buildPercent,
            marketPercent: guidance.marketPercent,
          },
          nextGoal: baseline.nextGoal,
          buildTools: baseline.buildTools,
        });
        const detail = await send(`/products/${result.productId}`, user);
        expect(detail.status).toBe(200);
        expect(await detail.json()).toMatchObject({
          product: {
            id: result.productId,
            name: baseline.productDescription,
            productStage: stage,
            guidance: { headline: guidance.headline, priorities: guidance.priorities },
          },
          goals: [expect.objectContaining({ title: baseline.nextGoal, isPrimary: true })],
        });
        const rules = await pool.query(
          "SELECT count(*)::int AS count FROM enough.policy_rules WHERE user_id = $1",
          [user.id],
        );
        expect(rules.rows[0].count).toBe(0);
      },
    );

    it("uses normalized launch status and traction consistently in recommendations", async () => {
      const user = await account();
      const inferred = await save(user, {
        productStage: "LAUNCHED_ZERO_USERS",
        hasLaunched: false,
      });
      const explicit = await save(user, { productStage: "LAUNCHED_ZERO_USERS", hasLaunched: true });
      expect(inferred.answers).toEqual(explicit.answers);
      expect(inferred.recommendation).toEqual(explicit.recommendation);
      expect(explicit.recommendation.firstAction).toBe(
        "Invite a small group of likely customers to try the product.",
      );
      const revenue = await save(user, { userCount: 5, currentRevenue: "10.00" });
      expect(revenue.recommendation.firstAction).toBe(
        "Trace your current revenue to the customer problem and path that produced it.",
      );
      const paying = await save(user, {
        userCount: 5,
        payingUserCount: 2,
        currentRevenue: "10.00",
      });
      expect(paying.recommendation.firstAction).toBe(
        "Ask one paying customer which result made the product worth paying for.",
      );
    });

    it("isolates profile reads, forged ownership, product detail and exports between accounts", async () => {
      const owner = await account();
      const other = await account();
      const saved = await save(owner);
      expect(await (await send(`/onboarding?userId=${owner.id}`, other)).json()).toMatchObject({
        completed: false,
      });
      const forged = await send("/onboarding", other, {
        ...baseline,
        productDescription: "Other product",
        userId: owner.id,
        productId: saved.productId,
      });
      expect(forged.status).toBe(200);
      const otherSaved = await forged.json();
      expect(otherSaved.productId).not.toBe(saved.productId);
      expect(await (await send("/onboarding", owner)).json()).toEqual(saved);
      expect((await send(`/products/${saved.productId}`, other)).status).toBe(404);
      const exported = await (await send(`/auth/account/export?userId=${owner.id}`, other)).json();
      expect(exported.onboarding.product_description).toBe("Other product");
      expect(exported.products).toHaveLength(1);
      expect(exported.products[0].id).toBe(otherSaved.productId);
    });

    it("rejects unauthenticated, missing-CSRF, wrong-CSRF and hostile-origin writes without mutation", async () => {
      expect((await send("/onboarding")).status).toBe(401);
      expect((await send("/onboarding", undefined, baseline)).status).toBe(401);
      const user = await account();
      for (const headers of [
        { ...user.headers, "x-csrf-token": "" },
        { ...user.headers, "x-csrf-token": "incorrect" },
        { ...user.headers, origin: "https://attacker.example" },
      ])
        expect((await send("/onboarding", user, baseline, { headers })).status).toBe(403);
      expect(await (await send("/onboarding", user)).json()).toMatchObject({ completed: false });
    });

    it("rejects invalid answers without changing the saved profile", async () => {
      const user = await account();
      const saved = await save(user);
      const invalid = [
        { productDescription: "  " },
        { productDescription: "x".repeat(241) },
        { targetCustomer: " " },
        { problemStatement: "x".repeat(501) },
        { productStage: "INVALID" },
        { hasLaunched: "yes" },
        { userCount: -1 },
        { userCount: 1.5 },
        { userCount: 2147483648 },
        { payingUserCount: 1 },
        { currentRevenue: "-1" },
        { currentRevenue: "1.001" },
        { currentRevenue: "1000000000000" },
        { revenueCurrency: "eur" },
        { nextGoal: " " },
        { buildTools: Array.from({ length: 21 }, (_, i) => `Tool ${i}`) },
        { buildTools: ["x".repeat(81)] },
      ];
      for (const answer of invalid) {
        const response = await send("/onboarding", user, { ...baseline, ...answer });
        expect(response.status, JSON.stringify(answer)).toBe(400);
        expect((await response.json()).error).toEqual(expect.any(String));
      }
      expect(await (await send("/onboarding", user)).json()).toEqual(saved);
    });

    it("accepts upper numeric boundaries and normalizes whitespace and duplicate tools", async () => {
      const user = await account();
      const result = await save(user, {
        userCount: 2147483647,
        payingUserCount: 2147483647,
        currentRevenue: "999999999999.99",
        productDescription: "  A scheduling tool  ",
        buildTools: [" Terminal ", "Terminal", "Editor"],
      });
      expect(result.answers).toMatchObject({
        userCount: 2147483647,
        payingUserCount: 2147483647,
        currentRevenue: "999999999999.99",
        productDescription: "A scheduling tool",
        buildTools: ["Terminal", "Editor"],
      });
    });

    it("serializes simultaneous first saves and retries into one linked product and primary goal", async () => {
      const user = await account();
      const [first, second] = await Promise.all([
        save(user),
        save(user, { nextGoal: "Book three interviews" }),
      ]);
      expect(first.productId).toBe(second.productId);
      const final = await (await send("/onboarding", user)).json();
      await save(user, final.answers);
      const products = await (await send("/products", user)).json();
      expect(products.products).toHaveLength(1);
      const detail = await (await send(`/products/${products.products[0].id}`, user)).json();
      expect(detail.goals).toHaveLength(1);
      expect(detail.goals[0].title).toBe(final.answers.nextGoal);
      expect(detail.stageHistory).toHaveLength(1);
      expect(detail.metrics).toHaveLength(2);
    });

    it("serves onboarding and dashboard pages through the isolated web runtime", async () => {
      for (const path of ["/onboarding", "/dashboard"]) {
        const response = await fetch(`${web}${path}`, { signal: AbortSignal.timeout(45000) });
        expect(response.status).toBe(200);
        expect(await response.text()).toContain("Loading your workspace");
      }
    });
  },
);
