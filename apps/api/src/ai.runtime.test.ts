import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Fastify from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertPhase15MigrationLedger,
  phase15Fixture as fixture,
  phase15MigrationFiles,
} from "../../../scripts/phase15-fixture-plan.mjs";
import { type CoachContext, createCoachSession } from "../../web/app/coach/coach-session";
import type { AiCoachResponse, AiCoachResult } from "../../web/app/workspace-data";

describe.skipIf(process.env.ENOUGH_PHASE15_INTEGRATION !== "1")(
  "Phase 15 isolated real API/database",
  () => {
    let pool: typeof import("@enough/db").pool;
    let cache: typeof import("@enough/cache");
    let env: typeof import("@enough/config").env;
    let seed: {
      fixture: string;
      accounts: Array<{
        id: string;
        session: { token: string; csrfToken: string; sessionId: string };
      }>;
      products: Array<{
        id: string;
        owner: string;
        stage: string;
        taskId: string;
        evidenceId: string;
        completionId: string;
      }>;
      canaries: Record<string, string>;
    };
    const capabilities = [
      "ONBOARDING_ANALYSIS",
      "TASK_GENERATION",
      "SCOPE_CHALLENGE",
      "WEEKLY_DIAGNOSIS",
      "NEXT_ACTION",
      "OVERBUILDING_EXPLANATION",
      "EVIDENCE_CLASSIFICATION",
    ] as const;
    const api = `http://127.0.0.1:${fixture.ports.api}`;
    const web = `http://127.0.0.1:${fixture.ports.web}`;
    beforeAll(async () => {
      expect(process.env.OPENAI_API_KEY).toBe("");
      const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
      expect([target.hostname, target.port, target.pathname, target.username]).toEqual([
        fixture.host,
        String(fixture.ports.postgres),
        `/${fixture.database}`,
        fixture.role,
      ]);
      expect(process.env.REDIS_URL).toBe(`redis://127.0.0.1:${fixture.ports.redis}/0`);
      expect(process.env.APP_BASE_URL).toBe(web);
      ({ pool } = await import("@enough/db"));
      cache = await import("@enough/cache");
      ({ env } = await import("@enough/config"));
      seed = JSON.parse(await readFile(path.join(fixture.directory, "seed.json"), "utf8"));
      expect(seed.fixture).toBe(fixture.owner);
      expect((await pool.query("SELECT current_user, current_database()")).rows[0]).toEqual({
        current_user: fixture.role,
        current_database: fixture.database,
      });
    });
    beforeEach(async () => {
      await cache.getRedis().flushdb();
    });
    afterAll(async () => {
      vi.unstubAllGlobals();
      if (pool) await pool.end();
      if (cache) await cache.closeRedis();
    });
    function headers(account = 0) {
      const session = seed.accounts[account].session;
      return {
        cookie: `enough_session=${session.token}; enough_csrf=${session.csrfToken}`,
        "x-csrf-token": session.csrfToken,
        origin: web,
        "content-type": "application/json",
      };
    }
    async function request(
      route: string,
      body?: unknown,
      account = 0,
      method?: string,
      base = api,
      override?: Record<string, string>,
    ) {
      return fetch(`${base}${route}`, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers: override ?? headers(account),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
    }
    function input(capability: (typeof capabilities)[number], product = 0): CoachContext {
      const selected = seed.products[product];
      return {
        productId: selected.id,
        capability,
        ...(capability === "SCOPE_CHALLENGE" ? { taskId: selected.taskId } : {}),
        ...(capability === "EVIDENCE_CLASSIFICATION" ? { evidenceId: selected.evidenceId } : {}),
      };
    }
    async function json(response: Response, status = 200) {
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      return response.json();
    }
    async function ledger() {
      return (await pool.query("SELECT count(*)::int AS count FROM enough.credit_transactions"))
        .rows[0].count;
    }
    async function taskCount() {
      return (await pool.query("SELECT count(*)::int AS count FROM enough.growth_tasks")).rows[0]
        .count;
    }
    async function coach(context: CoachContext): Promise<AiCoachResponse> {
      const response = await request("/api/ai/coach", context, 0, "POST", web);
      if (!response.ok) throw new Error("Safe runtime Coach failure");
      return response.json();
    }
    function controller() {
      return createCoachSession({
        request: coach,
        createTask: async (body) =>
          await json(await request("/api/tasks", body, 0, "POST", web), 201),
        unauthorized: () => {
          throw new Error("Unexpected unauthorized runtime test");
        },
      });
    }

    it("verifies complete schema, recorded checksums and idempotent migration evidence", async () => {
      const rows = (
        await pool.query("SELECT id, checksum FROM enough.schema_migrations ORDER BY id")
      ).rows;
      await assertPhase15MigrationLedger(rows.map((row) => row.id));
      expect(rows.map((row) => row.id)).toEqual(await phase15MigrationFiles());
      for (const row of rows)
        expect(row.checksum).toBe(
          createHash("sha256")
            .update(
              await readFile(new URL(`../../../packages/db/migrations/${row.id}`, import.meta.url)),
            )
            .digest("hex"),
        );
      const evidence = JSON.parse(
        await readFile(path.join(fixture.directory, "migration-evidence.json"), "utf8"),
      );
      expect(evidence).toMatchObject({
        count: 20,
        checksumMatch: true,
        noPending: true,
        idempotent: true,
      });
      const columns = (
        await pool.query(
          "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='enough'",
        )
      ).rows;
      for (const [table, column] of [
        ["privacy_consents", "enabled"],
        ["admin_ai_usage_events", "input_tokens"],
        ["task_evidence_items", "storage_object_key"],
        ["task_evidence_object_cleanup", "object_key"],
        ["integration_provider_configs", "configuration"],
      ])
        expect(columns.some((row) => row.table_name === table && row.column_name === column)).toBe(
          true,
        );
      expect(
        columns.some(
          (row) => row.table_name === "task_evidence_items" && row.column_name === "file_data",
        ),
      ).toBe(false);
    });
    it.each(capabilities)(
      "%s: local response, correct product scope, ownership, no task/reward/provider side effects",
      async (capability) => {
        const credits = await ledger(),
          tasks = await taskCount();
        const first = await json(await request("/ai/coach", input(capability)));
        const second = await json(await request("/ai/coach", input(capability)));
        expect(first).toEqual(second);
        expect(first.source).toBe("STAGE_GUIDANCE");
        expect(typeof first.advice.headline).toBe("string");
        expect(first.advice.caveat).toContain("advisory");
        expect(first.advice.tasks.length > 0).toBe(capability === "TASK_GENERATION");
        if (capability === "WEEKLY_DIAGNOSIS")
          expect(first.advice.diagnosis).toContain("3 activity events");
        if (capability === "SCOPE_CHALLENGE")
          expect(first.advice.diagnosis).toContain("35 minutes");
        if (capability === "EVIDENCE_CLASSIFICATION")
          expect(first.advice.evidenceClassification.category).toBe("UNCLEAR");
        const other = await json(await request("/ai/coach", input(capability, 1)));
        expect(other.source).toBe("STAGE_GUIDANCE");
        if (
          [
            "ONBOARDING_ANALYSIS",
            "TASK_GENERATION",
            "NEXT_ACTION",
            "OVERBUILDING_EXPLANATION",
          ].includes(capability)
        )
          expect(other.advice).not.toEqual(first.advice);
        await json(await request("/ai/coach", input(capability), 1), 404);
        await json(await request("/ai/coach", input(capability, 2)), 404);
        expect(await ledger()).toBe(credits);
        expect(await taskCount()).toBe(tasks);
        expect(
          (await pool.query("SELECT count(*)::int AS count FROM enough.admin_ai_usage_events"))
            .rows[0].count,
        ).toBe(0);
        expect(
          (await readFile(path.join(fixture.directory, "egress-blocked.log"), "utf8")).length,
        ).toBe(0);
      },
    );
    it("rejects cross-product task/evidence and soft-deleted evidence", async () => {
      await json(
        await request("/ai/coach", {
          ...input("SCOPE_CHALLENGE"),
          taskId: seed.products[1].taskId,
        }),
        404,
      );
      await json(
        await request("/ai/coach", {
          ...input("EVIDENCE_CLASSIFICATION"),
          evidenceId: seed.products[1].evidenceId,
        }),
        404,
      );
      await pool.query("UPDATE enough.task_evidence_items SET deleted_at=now() WHERE id=$1", [
        seed.products[0].evidenceId,
      ]);
      try {
        await json(await request("/ai/coach", input("EVIDENCE_CLASSIFICATION")), 404);
      } finally {
        await pool.query("UPDATE enough.task_evidence_items SET deleted_at=NULL WHERE id=$1", [
          seed.products[0].evidenceId,
        ]);
      }
    });
    it("rejects missing/deleted product, malformed input, unauthenticated and invalid sessions", async () => {
      const gone = "15000000-0000-4000-8000-000000000099";
      await pool.query(
        "INSERT INTO enough.products (id,user_id,name,target_customer,problem_statement,product_stage) VALUES ($1,$2,'Transient synthetic product','Synthetic target','Synthetic problem','IDEA')",
        [gone, seed.accounts[0].id],
      );
      await pool.query("DELETE FROM enough.products WHERE id=$1", [gone]);
      await json(await request("/ai/coach", { ...input("NEXT_ACTION"), productId: gone }), 404);
      await json(
        await request("/ai/coach", { ...input("NEXT_ACTION"), capability: "INVALID" }),
        400,
      );
      await json(
        await request("/ai/coach", input("NEXT_ACTION"), 0, "POST", api, {
          "content-type": "application/json",
        }),
        401,
      );
      await json(
        await request("/ai/coach", input("NEXT_ACTION"), 0, "POST", api, {
          ...headers(),
          cookie: "enough_session=synthetic-invalid",
        }),
        401,
      );
    });
    it("rejects revoked sessions", async () => {
      await pool.query("UPDATE enough.auth_sessions SET revoked_at=now() WHERE id=$1", [
        seed.accounts[1].session.sessionId,
      ]);
      try {
        await json(await request("/ai/status", undefined, 1), 401);
      } finally {
        await pool.query("UPDATE enough.auth_sessions SET revoked_at=NULL WHERE id=$1", [
          seed.accounts[1].session.sessionId,
        ]);
      }
    });
    it("enforces CSRF and exact web origin through both API and web proxy", async () => {
      for (const [base, route] of [
        [api, "/ai/coach"],
        [web, "/api/ai/coach"],
      ]) {
        for (const override of [
          { ...headers(), origin: "https://wrong.example.test" },
          { ...headers(), "x-csrf-token": "synthetic-wrong" },
          { ...headers(), "x-csrf-token": "" },
        ])
          await json(await request(route, input("NEXT_ACTION"), 0, "POST", base, override), 403);
      }
    });
    it("enforces the shared per-account Coach quota and keeps account B independent", async () => {
      for (let i = 0; i < 8; i++)
        await json(await request("/ai/coach", input(i % 2 ? "NEXT_ACTION" : "TASK_GENERATION")));
      const limited = await request("/ai/coach", input("OVERBUILDING_EXPLANATION"));
      await json(limited, 429);
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      await json(await request("/ai/coach", input("NEXT_ACTION", 2), 1));
    });
    it("persists consent grant/revoke per account while disabled mode stays local", async () => {
      const status = await json(await request("/ai/status"));
      expect(status).toMatchObject({
        providerConfigured: false,
        providerConsentEnabled: false,
        model: null,
      });
      await json(
        await request("/privacy-consents/AI_PROVIDER_PROCESSING", { enabled: true }, 0, "PUT"),
      );
      expect((await json(await request("/ai/status"))).providerConsentEnabled).toBe(true);
      expect((await json(await request("/ai/status", undefined, 1))).providerConsentEnabled).toBe(
        false,
      );
      // An account ID in extra input cannot select another account's consent.
      await json(
        await request(
          "/privacy-consents/AI_PROVIDER_PROCESSING",
          { enabled: false, userId: seed.accounts[0].id },
          1,
          "PUT",
        ),
        400,
      );
      expect((await json(await request("/ai/status"))).providerConsentEnabled).toBe(true);
      await json(
        await request("/privacy-consents/AI_PROVIDER_PROCESSING", { enabled: false }, 0, "PUT"),
      );
      const row = (
        await pool.query(
          "SELECT enabled,revision,revoked_at FROM enough.privacy_consents WHERE user_id=$1 AND purpose='AI_PROVIDER_PROCESSING'",
          [seed.accounts[0].id],
        )
      ).rows[0];
      expect(row.enabled).toBe(false);
      expect(Number(row.revision)).toBe(2);
      expect(row.revoked_at).toBeTruthy();
      expect((await json(await request("/ai/coach", input("NEXT_ACTION")))).source).toBe(
        "STAGE_GUIDANCE",
      );
    });
    it("fails closed on a real consent read failure; configured path is instrumented without external calls", async () => {
      const { registerAiRoutes } = await import("./ai.js");
      const { requestLoggerOptions } = await import("./logging.js");
      const logs: string[] = [];
      const local = Fastify({
        logger: {
          ...requestLoggerOptions("debug"),
          stream: {
            write: (line: string) => {
              logs.push(line);
            },
          },
        },
      });
      await registerAiRoutes(local);
      const fallback = (await json(
        await request("/ai/coach", input("TASK_GENERATION")),
      )) as AiCoachResult;
      const mock = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              status: "completed",
              output: [
                {
                  type: "message",
                  status: "completed",
                  role: "assistant",
                  content: [
                    {
                      type: "output_text",
                      text: JSON.stringify({
                        ...fallback.advice,
                        headline: seed.canaries.response,
                      }),
                    },
                  ],
                },
              ],
              usage: { input_tokens: 10, output_tokens: 20 },
            }),
          ),
      );
      const oldModel = env.OPENAI_MODEL;
      env.OPENAI_API_KEY = "synthetic-phase15-in-memory-only";
      env.OPENAI_MODEL = "synthetic-phase15-mock";
      vi.stubGlobal("fetch", mock);
      const invoke = () =>
        local.inject({
          method: "POST",
          url: "/ai/coach",
          headers: headers(),
          payload: input("TASK_GENERATION"),
        });
      try {
        await pool.query(
          "DELETE FROM enough.privacy_consents WHERE user_id=$1 AND purpose='AI_PROVIDER_PROCESSING'",
          [seed.accounts[0].id],
        );
        expect((await invoke()).statusCode).toBe(403);
        expect(mock).not.toHaveBeenCalled();
        await pool.query(
          "INSERT INTO enough.privacy_consents (user_id,purpose,enabled,granted_at) VALUES ($1,'AI_PROVIDER_PROCESSING',true,now())",
          [seed.accounts[0].id],
        );
        expect((await invoke()).statusCode).toBe(200);
        expect(mock).toHaveBeenCalledTimes(1);
        const credits = await ledger(),
          tasks = await taskCount();
        const save = vi.fn();
        const state = createCoachSession({
          request: async () => {
            const response = await invoke();
            if (response.statusCode !== 200) throw new Error("Safe mocked provider failure");
            return response.json();
          },
          createTask: save,
          unauthorized: vi.fn(),
        });
        state.select(input("TASK_GENERATION"));
        mock.mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              status: "completed",
              output: [
                {
                  type: "message",
                  status: "completed",
                  role: "assistant",
                  content: [{ type: "refusal", refusal: seed.canaries.response }],
                },
              ],
            }),
          ),
        );
        await state.request();
        expect(state.getSnapshot().refusal).toBeTruthy();
        await state.addTask(fallback.advice.tasks[0]);
        mock.mockRejectedValueOnce(new Error(seed.canaries.response));
        await state.request();
        expect(state.getSnapshot().error).toBeTruthy();
        await state.addTask(fallback.advice.tasks[0]);
        expect(save).not.toHaveBeenCalled();
        expect(await taskCount()).toBe(tasks);
        expect(await ledger()).toBe(credits);
        await pool.query(
          "UPDATE enough.privacy_consents SET enabled=false,revoked_at=now() WHERE user_id=$1 AND purpose='AI_PROVIDER_PROCESSING'",
          [seed.accounts[0].id],
        );
        expect((await invoke()).statusCode).toBe(403);
        expect(mock).toHaveBeenCalledTimes(3);
        await pool.query(
          "ALTER TABLE enough.privacy_consents RENAME TO phase15_consents_temporarily_unavailable",
        );
        try {
          expect((await invoke()).statusCode).toBe(503);
          expect(mock).toHaveBeenCalledTimes(3);
        } finally {
          await pool.query(
            "ALTER TABLE enough.phase15_consents_temporarily_unavailable RENAME TO privacy_consents",
          );
        }
        const usage = (
          await pool.query(
            "SELECT model,status,input_tokens,output_tokens FROM enough.admin_ai_usage_events ORDER BY created_at",
          )
        ).rows;
        expect(usage).toEqual([
          {
            model: "synthetic-phase15-mock",
            status: "SUCCEEDED",
            input_tokens: 10,
            output_tokens: 20,
          },
          {
            model: "synthetic-phase15-mock",
            status: "FAILED",
            input_tokens: null,
            output_tokens: null,
          },
          {
            model: "synthetic-phase15-mock",
            status: "FAILED",
            input_tokens: null,
            output_tokens: null,
          },
        ]);
        for (const secret of [
          ...Object.values(seed.canaries),
          env.OPENAI_API_KEY,
          seed.accounts[0].session.token,
        ])
          expect(logs.some((line) => line.includes(secret))).toBe(false);
      } finally {
        env.OPENAI_API_KEY = "";
        env.OPENAI_MODEL = oldModel;
        vi.unstubAllGlobals();
        await local.close();
      }
      // The actual listening API stayed disabled throughout the instrumented branch.
      expect((await json(await request("/ai/status"))).providerConfigured).toBe(false);
    });
    it("creates one explicit current zero-reward suggestion through the web proxy", async () => {
      const session = controller();
      session.select(input("TASK_GENERATION"));
      const credits = await ledger(),
        before = await taskCount();
      await session.request();
      const task = session.getSnapshot().result?.advice.tasks[0];
      expect(task).toBeTruthy();
      if (!task) throw new Error("Missing current synthetic task suggestion");
      expect(await taskCount()).toBe(before);
      await Promise.all([session.addTask(task), session.addTask(task)]);
      await session.addTask(task);
      expect(await taskCount()).toBe(before + 1);
      expect(await ledger()).toBe(credits);
      const rows = (
        await pool.query(
          "SELECT user_id,product_id,reward_credits,status FROM enough.growth_tasks WHERE title=$1",
          [task.title],
        )
      ).rows;
      expect(rows).toEqual([
        {
          user_id: seed.accounts[0].id,
          product_id: seed.products[0].id,
          reward_credits: 0,
          status: "ACTIVE",
        },
      ]);
      session.select(input("NEXT_ACTION", 1));
      await session.addTask(task);
      expect(await taskCount()).toBe(before + 1);
      await json(
        await request(
          "/growth-tasks",
          {
            productId: seed.products[0].id,
            title: "Synthetic unauthorized save",
            rewardCredits: 0,
          },
          1,
        ),
        404,
      );
    });
    it.each(["product", "capability", "task", "evidence"])(
      "invalidates completed and delayed real web responses on %s change",
      async (kind) => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        let started!: () => void;
        const received = new Promise<void>((resolve) => {
          started = resolve;
        });
        let first = true;
        const session = createCoachSession({
          request: async (context) => {
            const result = await coach(context);
            if (first) {
              first = false;
              started();
              await gate;
            }
            return result;
          },
          createTask: vi.fn(),
          unauthorized: vi.fn(),
        });
        const initial = input(
          kind === "task"
            ? "SCOPE_CHALLENGE"
            : kind === "evidence"
              ? "EVIDENCE_CLASSIFICATION"
              : "NEXT_ACTION",
        );
        session.select(initial);
        const pending = session.request();
        await received;
        const next =
          kind === "product"
            ? input("NEXT_ACTION", 1)
            : kind === "capability"
              ? input("OVERBUILDING_EXPLANATION")
              : {
                  ...initial,
                  ...(kind === "task"
                    ? { taskId: seed.products[1].taskId }
                    : { evidenceId: seed.products[1].evidenceId }),
                };
        session.select(next);
        expect(session.getSnapshot().result).toBeNull();
        await session.request();
        const newer = session.getSnapshot();
        release();
        await pending;
        expect(session.getSnapshot()).toBe(newer);
        if (kind === "task" || kind === "evidence") expect(newer.error).toBeTruthy();
        else expect(newer.result).toBeTruthy();
        session.select(initial);
        expect(session.getSnapshot()).toMatchObject({
          result: null,
          error: "",
          refusal: "",
          requesting: false,
        });
      },
    );
    it("preserves task completion/evidence semantics: no early credits and no duplicate completion", async () => {
      const credits = await ledger();
      const task = (
        await json(
          await request("/growth-tasks", {
            productId: seed.products[0].id,
            title: "Synthetic Phase 15 completion regression",
            rewardCredits: 0,
          }),
          201,
        )
      ).task;
      const complete = (await json(await request(`/growth-tasks/${task.id}/complete`, {})))
        .completion;
      expect(complete.verificationStatus).toBe("AWAITING_EVIDENCE");
      expect(complete.creditTransactionId).toBeNull();
      expect(
        (await json(await request(`/growth-tasks/${task.id}/complete`, {}))).completion.id,
      ).toBe(complete.id);
      await json(
        await request(
          "/task-evidence",
          {
            completionId: complete.id,
            evidenceType: "NOTE",
            title: "Synthetic note",
            note: seed.canaries.evidence,
          },
          1,
        ),
        404,
      );
      const evidence = (
        await json(
          await request("/task-evidence", {
            completionId: complete.id,
            evidenceType: "NOTE",
            title: "Synthetic note",
            note: seed.canaries.evidence,
          }),
          201,
        )
      ).evidence;
      expect(evidence.verificationStatus).toBe("PENDING");
      await json(await request(`/task-evidence/${evidence.id}`, {}, 0, "DELETE"));
      expect(
        (
          await pool.query(
            "SELECT verification_status,credit_transaction_id FROM enough.growth_task_completions WHERE id=$1",
            [complete.id],
          )
        ).rows[0],
      ).toEqual({ verification_status: "AWAITING_EVIDENCE", credit_transaction_id: null });
      expect(await ledger()).toBe(credits);
    });
    it("captures safe API/web logs with no private canaries, cookie/token values or provider bodies", async () => {
      const logs = await Promise.all(
        ["api.log", "web.log"].map((file) => readFile(path.join(fixture.directory, file), "utf8")),
      );
      const privateValues = [
        ...Object.values(seed.canaries),
        ...seed.accounts.flatMap((account) => [account.session.token, account.session.csrfToken]),
        "synthetic-phase15-in-memory-only",
      ];
      for (const value of privateValues)
        expect(logs.some((log) => log.includes(value))).toBe(false);
      expect(logs[0].includes("AI coach context prepared")).toBe(true);
      expect(
        (await readFile(path.join(fixture.directory, "egress-blocked.log"), "utf8")).length,
      ).toBe(0);
    });
  },
);
