import { randomUUID } from "node:crypto";
import { evaluatePolicyRules, type PolicyEvaluationInput } from "@enough/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe.skipIf(process.env.ENOUGH_PHASE7_INTEGRATION !== "1")(
  "Phase 7 policy rules on disposable PostgreSQL, Redis, API, and web proxy",
  () => {
    let pool: typeof import("@enough/db").pool;
    const ids: string[] = [];
    const api = "http://127.0.0.1:4412";
    const web = "http://127.0.0.1:3307";

    beforeAll(async () => {
      const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
      expect([target.hostname, target.port, target.pathname, target.username]).toEqual([
        "127.0.0.1",
        "55438",
        "/enough_phase7",
        "enough_phase7",
      ]);
      expect(process.env.REDIS_URL).toBe("redis://127.0.0.1:56391/0");
      expect(process.env.APP_BASE_URL).toBe(web);
      expect(process.env.API_BASE_URL).toBe(api);
      ({ pool } = await import("@enough/db"));
      const identity = await pool.query("SELECT current_user, current_database()");
      expect(identity.rows[0]).toEqual({
        current_user: "enough_phase7",
        current_database: "enough_phase7",
      });
      const migrations = await pool.query<{ id: string }>(
        "SELECT id FROM enough.schema_migrations ORDER BY id",
      );
      expect(migrations.rows).toHaveLength(15);
      expect(migrations.rows.slice(0, 7).map((row) => row.id)).toEqual([
        "0001_create_enough_schema.sql",
        "0002_authentication.sql",
        "0003_product_onboarding.sql",
        "0004_product_stage_engine.sql",
        "0005_activity_event_platform.sql",
        "0006_tool_classification.sql",
        "0007_rule_engine.sql",
      ]);
      const tables = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'enough' AND table_name IN
           ('policy_rules', 'policy_rule_versions', 'policy_overrides')
         ORDER BY table_name`,
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        "policy_overrides",
        "policy_rule_versions",
        "policy_rules",
      ]);
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
      const email = `phase7-${id}@example.test`;
      ids.push(id);
      await pool.query(
        "INSERT INTO enough.auth_users (id, email, email_normalized, email_verified_at) VALUES ($1, $2, $2, now())",
        [id, email],
      );
      const { createSession } = await import("../../../packages/auth/src/session.js");
      const session = await createSession(id, "web", "Phase 7 synthetic test", "magic_link");
      const device = await pool.query<{ id: string }>(
        "SELECT id FROM enough.auth_devices WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
        [id],
      );
      expect(device.rows).toHaveLength(1);
      return {
        id,
        email,
        deviceId: device.rows[0].id,
        headers: {
          cookie: `enough_session=${session.token}; enough_csrf=${session.csrfToken}`,
          "x-csrf-token": session.csrfToken ?? "",
          origin: web,
          "content-type": "application/json",
        },
      };
    }

    type Account = Awaited<ReturnType<typeof account>>;

    function request(
      path: string,
      user?: Account,
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

    async function product(user: Account, name = `Phase 7 product ${randomUUID()}`) {
      const response = await request("/products", user, {
        name,
        productStage: "IDEA",
        targetCustomer: "Synthetic test teams",
        problemStatement: "Verify rule-engine scope and ownership",
        initialGoal: "Validate deterministic rules",
      });
      const result = await payload(response, 201);
      return result.product.id as string;
    }

    function ruleBody(overrides: Record<string, unknown> = {}) {
      return {
        name: "Phase 7 test rule",
        enabled: true,
        priority: 10,
        action: "BLOCK",
        productId: null,
        deviceId: null,
        conditions: {},
        schedule: null,
        ...overrides,
      };
    }

    async function createRule(user: Account, body = ruleBody()) {
      return payload(await request("/rules", user, body), 201);
    }

    async function evaluate(user: Account, body: Record<string, unknown>) {
      return payload(await request("/rules/evaluate", user, body));
    }

    it("applies migrations 0002–0007 and protects rule reads and writes", async () => {
      expect((await request("/rules")).status).toBe(401);
      const owner = await account();
      const other = await account();
      const noCsrfHeaders = { ...owner.headers, "x-csrf-token": "" };
      expect((await request("/rules", owner, ruleBody(), "POST", noCsrfHeaders)).status).toBe(403);

      const created = await createRule(owner, ruleBody({ name: "Owned policy rule" }));
      const ruleId = created.rule.id as string;
      expect(created.rule).toMatchObject({
        name: "Owned policy rule",
        version: 1,
        productId: null,
        deviceId: null,
        archivedAt: null,
      });

      const listed = await payload(await request("/rules", owner));
      expect(listed.rules.map((rule: { id: string }) => rule.id)).toContain(ruleId);
      expect((await payload(await request("/rules", other))).rules).toEqual([]);
      expect((await request(`/rules/${ruleId}/versions`, other)).status).toBe(404);
      expect(
        (await request(`/rules/${ruleId}`, other, { expectedVersion: 1 }, "DELETE")).status,
      ).toBe(404);

      const firstUpdate = ruleBody({ name: "Concurrent edit A", action: "WARN" });
      const secondUpdate = ruleBody({ name: "Concurrent edit B", action: "ALLOW" });
      const [first, second] = await Promise.all([
        request(`/rules/${ruleId}`, owner, { ...firstUpdate, expectedVersion: 1 }, "PATCH"),
        request(`/rules/${ruleId}`, owner, { ...secondUpdate, expectedVersion: 1 }, "PATCH"),
      ]);
      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const updatedResponse = first.status === 200 ? first : second;
      const updated = await payload(updatedResponse);
      expect(updated.rule.version).toBe(2);

      const stale = await request(
        `/rules/${ruleId}`,
        owner,
        { ...ruleBody({ name: "Stale overwrite" }), expectedVersion: 1 },
        "PATCH",
      );
      expect(stale.status).toBe(409);

      const versions = await payload(await request(`/rules/${ruleId}/versions`, owner));
      expect(versions.versions.map((version: { version: number }) => version.version)).toEqual([
        2, 1,
      ]);
      const archived = await request(`/rules/${ruleId}`, owner, { expectedVersion: 2 }, "DELETE");
      expect(archived.status).toBe(204);
      const historyAfterArchive = await payload(await request(`/rules/${ruleId}/versions`, owner));
      expect(
        historyAfterArchive.versions.map((version: { version: number }) => version.version),
      ).toEqual([3, 2, 1]);
      expect(historyAfterArchive.versions[0].snapshot).toMatchObject({
        archivedAt: expect.any(String),
        enabled: false,
        version: 3,
      });
      const archivedList = await payload(await request("/rules", owner));
      expect(
        archivedList.rules.find((rule: { id: string }) => rule.id === ruleId).archivedAt,
      ).toEqual(expect.any(String));
    });

    it("enforces product/device ownership, schedule conditions, and shared evaluator parity", async () => {
      const owner = await account();
      const other = await account();
      const productId = await product(owner, "Phase 7 owned scope");
      const otherProductId = await product(owner, "Phase 7 second owned scope");
      const foreignProductId = await product(other, "Phase 7 foreign scope");
      const now = Date.now();
      const schedule = {
        timezone: "Europe/Berlin",
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: "00:00",
        endTime: "00:00",
        startsAt: new Date(now - 60_000).toISOString(),
        endsAt: new Date(now + 60 * 60_000).toISOString(),
      };
      const conditions = {
        classifications: ["NEUTRAL"],
        toolKind: "APPLICATION",
        toolKeys: ["com.example.phase7"],
        contextKey: "purpose",
        contextValue: "work",
      };
      const created = await createRule(
        owner,
        ruleBody({
          name: "Scoped scheduled deny",
          productId,
          deviceId: owner.deviceId,
          conditions,
          schedule,
        }),
      );
      const ruleRecord = created.rule;
      const input: Omit<PolicyEvaluationInput, "classification" | "evaluatedAt"> = {
        toolKind: "APPLICATION",
        toolKey: "com.example.phase7",
        productId,
        deviceId: owner.deviceId,
        contextKey: "Purpose",
        contextValue: "WORK",
      };

      const result = await evaluate(owner, input);
      expect(result.classification.classification).toBe("NEUTRAL");
      expect(result.decision).toMatchObject({
        action: "BLOCK",
        allowed: false,
        source: "RULE",
        matchedRuleId: ruleRecord.id,
        matchedRuleVersion: 1,
      });
      const expected = evaluatePolicyRules(
        {
          ...input,
          classification: result.classification.classification,
          evaluatedAt: result.decision.evaluatedAt,
        },
        [ruleRecord],
        [],
      );
      expect(result.decision).toEqual(expected);

      expect((await evaluate(owner, { ...input, contextValue: "personal" })).decision.source).toBe(
        "DEFAULT",
      );
      expect(
        (await evaluate(owner, { ...input, productId: otherProductId, deviceId: null })).decision
          .source,
      ).toBe("DEFAULT");
      expect((await evaluate(owner, { ...input, deviceId: null })).decision.source).toBe("DEFAULT");
      expect(
        (await request("/rules", owner, ruleBody({ productId: foreignProductId }))).status,
      ).toBe(404);
      expect((await request("/rules", owner, ruleBody({ deviceId: other.deviceId }))).status).toBe(
        404,
      );
      const foreignEvaluation = await request("/rules/evaluate", owner, {
        ...input,
        productId: foreignProductId,
      });
      expect(foreignEvaluation.status).toBe(404);
      const noCsrfEvaluation = await request("/rules/evaluate", owner, input, "POST", {
        ...owner.headers,
        "x-csrf-token": "",
      });
      expect(noCsrfEvaluation.status).toBe(403);
    });

    it("applies temporary overrides, expiry, revocation, and user isolation", async () => {
      const owner = await account();
      const other = await account();
      const input = {
        toolKind: "APPLICATION",
        toolKey: "com.example.phase7-override",
        productId: null,
        deviceId: null,
      };
      await createRule(
        owner,
        ruleBody({
          name: "Underlying block",
          conditions: { toolKind: input.toolKind, toolKeys: [input.toolKey] },
        }),
      );
      const tooLongExpiry = await request("/rules/overrides", owner, {
        ...input,
        action: "ALLOW",
        reason: "Bound check",
        expiresAt: new Date(Date.now() + 31 * 24 * 60 * 60_000).toISOString(),
      });
      expect(tooLongExpiry.status).toBe(400);

      const expiring = await payload(
        await request("/rules/overrides", owner, {
          ...input,
          action: "ALLOW",
          reason: "Temporary test allowance",
          expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        }),
        201,
      );
      expect((await evaluate(owner, input)).decision).toMatchObject({
        action: "ALLOW",
        source: "OVERRIDE",
        matchedOverrideId: expiring.override.id,
      });
      await pool.query(
        `UPDATE enough.policy_overrides
         SET starts_at = now() - interval '2 minutes', expires_at = now() - interval '1 minute'
         WHERE id = $1 AND user_id = $2`,
        [expiring.override.id, owner.id],
      );
      expect((await evaluate(owner, input)).decision).toMatchObject({
        action: "BLOCK",
        source: "RULE",
        matchedOverrideId: null,
      });

      const revocable = await payload(
        await request("/rules/overrides", owner, {
          ...input,
          action: "ALLOW",
          reason: "Revocation test allowance",
          expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        }),
        201,
      );
      expect(
        (await request(`/rules/overrides/${revocable.override.id}`, other, {}, "DELETE")).status,
      ).toBe(404);
      expect(
        (await request(`/rules/overrides/${revocable.override.id}`, owner, {}, "DELETE")).status,
      ).toBe(204);
      expect((await evaluate(owner, input)).decision).toMatchObject({
        action: "BLOCK",
        source: "RULE",
      });
      expect((await evaluate(other, input)).decision.source).toBe("DEFAULT");
    });

    it("exports only owned rules and cascades rule history and overrides on deletion", async () => {
      const owner = await account();
      const other = await account();
      const productId = await product(owner, "Phase 7 deletion scope");
      const accountRule = await createRule(owner, ruleBody({ name: "Exported account rule" }));
      const productRule = await createRule(
        owner,
        ruleBody({ name: "Product-scoped rule", productId }),
      );
      const otherRule = await createRule(other, ruleBody({ name: "Other account rule" }));
      const override = await payload(
        await request("/rules/overrides", owner, {
          productId,
          deviceId: null,
          toolKind: "DOMAIN",
          toolKey: "rules.example.test",
          action: "BLOCK",
          reason: "Scoped export test",
          expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        }),
        201,
      );

      const exported = await payload(await request("/auth/account/export", owner));
      expect(exported.policyRules.map((rule: { id: string }) => rule.id)).toEqual(
        expect.arrayContaining([accountRule.rule.id, productRule.rule.id]),
      );
      expect(exported.policyRuleVersions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ rule_id: accountRule.rule.id, version: 1 }),
          expect.objectContaining({ rule_id: productRule.rule.id, version: 1 }),
        ]),
      );
      expect(exported.policyOverrides).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: override.override.id })]),
      );
      const otherExport = await payload(await request("/auth/account/export", other));
      expect(otherExport.policyRules.map((rule: { id: string }) => rule.id)).toEqual([
        otherRule.rule.id,
      ]);
      expect(JSON.stringify(otherExport)).not.toContain(accountRule.rule.id);

      await pool.query("DELETE FROM enough.products WHERE id = $1 AND user_id = $2", [
        productId,
        owner.id,
      ]);
      const productScopedRows = await pool.query(
        `SELECT
           (SELECT count(*)::int FROM enough.policy_rules WHERE id = $1) AS rules,
           (SELECT count(*)::int FROM enough.policy_rule_versions WHERE rule_id = $1) AS versions,
           (SELECT count(*)::int FROM enough.policy_overrides WHERE id = $2) AS overrides`,
        [productRule.rule.id, override.override.id],
      );
      expect(productScopedRows.rows[0]).toEqual({ rules: 0, versions: 0, overrides: 0 });

      await pool.query("DELETE FROM enough.auth_users WHERE id = $1", [owner.id]);
      const accountRows = await pool.query(
        `SELECT
           (SELECT count(*)::int FROM enough.policy_rules WHERE user_id = $1) AS rules,
           (SELECT count(*)::int FROM enough.policy_rule_versions WHERE user_id = $1) AS versions,
           (SELECT count(*)::int FROM enough.policy_overrides WHERE user_id = $1) AS overrides`,
        [owner.id],
      );
      expect(accountRows.rows[0]).toEqual({ rules: 0, versions: 0, overrides: 0 });
    });

    it("renders the authenticated rules workspace route in the isolated web runtime", async () => {
      const response = await fetch(`${web}/rules`, {
        signal: AbortSignal.timeout(45000),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      const html = await response.text();
      expect(html).toContain("Loading rules");
      const routeScript = html.match(/src="([^"]*app\/rules\/page\.js[^"]*)"/);
      expect(routeScript?.[1]).toBeDefined();
      const scriptResponse = await fetch(new URL(routeScript?.[1] ?? "", web), {
        signal: AbortSignal.timeout(45000),
      });
      expect(scriptResponse.status).toBe(200);
      const script = await scriptResponse.text();
      expect(script).toContain("Choose how tools are handled");
      expect(script).toContain("Rules and versions");
      expect(script).toContain("Evaluate a tool now");
    });
  },
);
