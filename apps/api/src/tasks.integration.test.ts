import { randomUUID } from "node:crypto";
import { PRODUCT_STAGE_GUIDANCE, PRODUCT_STAGES } from "@enough/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe.skipIf(process.env.ENOUGH_PHASE12_INTEGRATION !== "1")(
  "Phase 12 growth tasks on isolated PostgreSQL, Redis, API, and web",
  () => {
    let pool: typeof import("@enough/db").pool;
    const userIds: string[] = [];
    const web = "http://127.0.0.1:3313";

    beforeAll(async () => {
      const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
      expect([target.hostname, target.port, target.pathname, target.username]).toEqual([
        "127.0.0.1",
        "55943",
        "/enough_phase12",
        "enough_phase12",
      ]);
      expect(process.env.REDIS_URL).toBe("redis://127.0.0.1:56405/0");
      expect(process.env.APP_BASE_URL).toBe(web);
      expect(process.env.API_BASE_URL).toBe("http://127.0.0.1:4422");
      expect(process.env.WORKER_PORT).toBe("4423");
      ({ pool } = await import("@enough/db"));
      const identity = await pool.query("SELECT current_user, current_database()");
      expect(identity.rows[0]).toEqual({
        current_user: "enough_phase12",
        current_database: "enough_phase12",
      });
      const migrations = await pool.query<{ id: string }>(
        "SELECT id FROM enough.schema_migrations WHERE id >= '0002_authentication.sql' AND id <= '0009_growth_task_engine.sql' ORDER BY id",
      );
      expect(migrations.rows.map((row) => row.id)).toEqual([
        "0002_authentication.sql",
        "0003_product_onboarding.sql",
        "0004_product_stage_engine.sql",
        "0005_activity_event_platform.sql",
        "0006_tool_classification.sql",
        "0007_rule_engine.sql",
        "0008_credit_engine.sql",
        "0009_growth_task_engine.sql",
      ]);
      const templates = await pool.query<{ count: string; stages: string }>(
        "SELECT count(*)::text AS count, count(DISTINCT product_stage)::text AS stages FROM enough.growth_task_templates WHERE is_active",
      );
      expect(templates.rows[0]).toEqual({ count: "27", stages: "9" });
    }, 60000);

    afterAll(async () => {
      if (!pool) return;
      await pool.query("DELETE FROM enough.auth_audit_events WHERE user_id = ANY($1::uuid[])", [
        userIds,
      ]);
      await pool.query("DELETE FROM enough.auth_users WHERE id = ANY($1::uuid[])", [userIds]);
      await pool.end();
    });

    async function account() {
      const id = randomUUID();
      const email = `phase12-${id}@example.test`;
      userIds.push(id);
      await pool.query(
        "INSERT INTO enough.auth_users (id, email, email_normalized, email_verified_at) VALUES ($1, $2, $2, now())",
        [id, email],
      );
      const { createSession } = await import("../../../packages/auth/src/session.js");
      const session = await createSession(id, "web", "Phase 12 synthetic test", "magic_link");
      return {
        id,
        email,
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

    async function product(user: Account, stage: string, name = `Phase 12 ${stage}`) {
      const result = await payload(
        await request("/products", user, {
          name,
          productStage: stage,
          targetCustomer: "Synthetic product teams",
          problemStatement: "Test stage-specific growth actions",
          initialGoal: "Verify a useful next action",
        }),
        201,
      );
      return result.product.id as string;
    }

    async function createTask(user: Account, body: Record<string, unknown>) {
      const result = await payload(await request("/tasks", user, body), 201);
      return result.task as {
        id: string;
        title: string;
        status: string;
        priority: number;
        signalStrength: number;
        estimatedMinutes: number;
        rewardCredits: number;
        recurrenceDays: number | null;
        dueAt: string | null;
      };
    }

    it("applies the ordered task migration and returns a concrete recommendation for each stage", async () => {
      expect((await request("/tasks")).status).toBe(401);
      const owner = await account();
      for (const stage of PRODUCT_STAGES) {
        const productId = await product(owner, stage);
        const data = await payload(await request(`/tasks?productId=${productId}`, owner));
        expect(data.productStage).toBe(stage);
        expect(data.templates.map((template: { title: string }) => template.title)).toEqual(
          PRODUCT_STAGE_GUIDANCE[stage].tasks,
        );
        expect(data.templates).toHaveLength(3);
        expect(data.tasks).toEqual([]);
        expect(
          data.templates.every((template: { title: string }) => template.title.length > 12),
        ).toBe(true);
      }
    });

    it("creates a stage task and custom task with their priorities, signals, estimates, due dates, and rewards", async () => {
      const owner = await account();
      const productId = await product(owner, "IDEA");
      const stageList = await payload(await request(`/tasks?productId=${productId}`, owner));
      const recommendation = stageList.templates[0] as {
        id: string;
        title: string;
        priority: number;
        signalStrength: number;
        estimatedMinutes: number;
        rewardCredits: number;
      };
      const recommendedTask = await createTask(owner, {
        productId,
        templateId: recommendation.id,
      });
      expect(recommendedTask).toMatchObject({
        title: recommendation.title,
        priority: recommendation.priority,
        signalStrength: recommendation.signalStrength,
        estimatedMinutes: recommendation.estimatedMinutes,
        rewardCredits: recommendation.rewardCredits,
        status: "ACTIVE",
      });

      const dueAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
      const customTask = await createTask(owner, {
        productId,
        title: "Ask three likely customers about their current workaround",
        description: "Record the alternatives they name.",
        priority: 5,
        signalStrength: 4,
        estimatedMinutes: 45,
        rewardCredits: 18,
        recurrenceDays: 7,
        dueAt,
      });
      expect(customTask).toMatchObject({
        title: "Ask three likely customers about their current workaround",
        priority: 5,
        signalStrength: 4,
        estimatedMinutes: 45,
        rewardCredits: 18,
        recurrenceDays: 7,
        dueAt,
      });

      const listed = await payload(await request(`/tasks?productId=${productId}`, owner));
      expect(listed.tasks.map((task: { id: string }) => task.id)).toEqual(
        expect.arrayContaining([recommendedTask.id, customTask.id]),
      );
    });

    it("isolates ownership, enforces CSRF and current-stage template selection, and cancels safely", async () => {
      const owner = await account();
      const other = await account();
      const ownerProduct = await product(owner, "IDEA");
      const otherProduct = await product(other, "IDEA", "Other Phase 12 product");
      const ownerList = await payload(await request(`/tasks?productId=${ownerProduct}`, owner));
      const otherTask = await createTask(other, {
        productId: otherProduct,
        title: "Ask one customer what they tried first",
        rewardCredits: 3,
      });

      expect((await request(`/tasks?productId=${ownerProduct}`, other)).status).toBe(404);
      expect(
        (
          await request(
            "/tasks",
            owner,
            { productId: ownerProduct, title: "A task without CSRF" },
            "POST",
            { ...owner.headers, "x-csrf-token": "" },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await request("/tasks", owner, {
            productId: ownerProduct,
            templateId: "problem-validation-1",
          })
        ).status,
      ).toBe(409);
      expect(
        (await request(`/tasks/${otherTask.id}`, owner, { status: "CANCELLED" }, "PATCH")).status,
      ).toBe(404);
      expect((await request(`/tasks/${otherTask.id}/complete`, owner, {})).status).toBe(404);

      const task = await createTask(owner, {
        productId: ownerProduct,
        title: "Review one customer conversation and write the next question",
      });
      const cancelled = await payload(
        await request(`/tasks/${task.id}`, owner, { status: "CANCELLED" }, "PATCH"),
      );
      expect(cancelled.task.status).toBe("CANCELLED");
      expect((await request(`/tasks/${task.id}/complete`, owner, {})).status).toBe(409);
      const repeatedCancel = await payload(
        await request(`/tasks/${task.id}`, owner, { status: "CANCELLED" }, "PATCH"),
      );
      expect(repeatedCancel.task.status).toBe("CANCELLED");
      expect(ownerList.templates).toHaveLength(3);
    });

    it("completes recurring tasks once, creates the next occurrence, and leaves rewards pending evidence", async () => {
      const owner = await account();
      const productId = await product(owner, "PROBLEM_VALIDATION");
      const task = await createTask(owner, {
        productId,
        title: "Schedule a follow-up with a target customer",
        priority: 4,
        signalStrength: 5,
        estimatedMinutes: 30,
        rewardCredits: 21,
        recurrenceDays: 14,
      });

      const first = await payload(await request(`/tasks/${task.id}/complete`, owner, {}));
      expect(first.replayed).toBe(false);
      expect(first.completion).toMatchObject({
        verificationStatus: "AWAITING_EVIDENCE",
        rewardCredits: 21,
        creditTransactionId: null,
      });
      expect(first.nextTask).toMatchObject({
        title: task.title,
        status: "ACTIVE",
        sequenceNumber: 2,
        recurrenceDays: 14,
        rewardCredits: 21,
      });
      const expectedDue = new Date(
        new Date(first.completion.completedAt).getTime() + 14 * 24 * 60 * 60 * 1000,
      );
      expect(
        Math.abs(new Date(first.nextTask.dueAt).getTime() - expectedDue.getTime()),
      ).toBeLessThan(1000);

      const replay = await payload(await request(`/tasks/${task.id}/complete`, owner, {}));
      expect(replay.replayed).toBe(true);
      expect(replay.completion.id).toBe(first.completion.id);
      expect(replay.nextTask.id).toBe(first.nextTask.id);
      const rows = await pool.query<{ tasks: string; completions: string }>(
        `SELECT (SELECT count(*)::text FROM enough.growth_tasks WHERE series_id = $1) AS tasks,
                (SELECT count(*)::text FROM enough.growth_task_completions WHERE task_id = $2) AS completions`,
        [task.id, task.id],
      );
      expect(rows.rows[0]).toEqual({ tasks: "2", completions: "1" });
      const reward = await pool.query(
        "SELECT id FROM enough.credit_transactions WHERE idempotency_key = $1",
        [`taskreward:${first.completion.id}`],
      );
      expect(reward.rowCount).toBe(0);
    });

    it("exports task history and removes task data through account deletion", async () => {
      const owner = await account();
      const productId = await product(owner, "FIRST_REVENUE");
      const task = await createTask(owner, {
        productId,
        title: "Ask a paying customer what made the purchase worthwhile",
        rewardCredits: 11,
      });
      await payload(await request(`/tasks/${task.id}/complete`, owner, {}));

      const exported = await payload(await request("/auth/account/export", owner));
      expect(exported.growthTasks).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: task.id, product_id: productId })]),
      );
      expect(exported.growthTaskCompletions).toEqual(
        expect.arrayContaining([expect.objectContaining({ task_id: task.id, reward_credits: 11 })]),
      );

      const deleted = await request(
        "/auth/account",
        owner,
        { confirmationEmail: owner.email },
        "DELETE",
      );
      expect(deleted.status).toBe(204);
      const remaining = await pool.query<{ tasks: string; completions: string }>(
        `SELECT (SELECT count(*)::text FROM enough.growth_tasks WHERE user_id = $1) AS tasks,
                (SELECT count(*)::text FROM enough.growth_task_completions WHERE user_id = $1) AS completions`,
        [owner.id],
      );
      expect(remaining.rows[0]).toEqual({ tasks: "0", completions: "0" });
    });
  },
);
