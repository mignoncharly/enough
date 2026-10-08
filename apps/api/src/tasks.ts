import { randomUUID } from "node:crypto";
import { checkRateLimit } from "@enough/auth";
import { type DbClient, pool } from "@enough/db";
import { PRODUCT_STAGE_LABELS, type ProductStage } from "@enough/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireCsrf, requireSession } from "./api-auth.js";

const taskStatuses = ["ACTIVE", "COMPLETED", "CANCELLED"] as const;

interface ProductTaskContext {
  id: string;
  product_stage: ProductStage;
}

interface TaskTemplateRow {
  id: string;
  product_stage: ProductStage;
  title: string;
  priority: number;
  signal_strength: number;
  estimated_minutes: number;
  default_reward_credits: number;
}

interface TaskRow {
  id: string;
  user_id: string;
  product_id: string;
  template_id: string | null;
  series_id: string;
  sequence_number: number;
  title: string;
  description: string | null;
  status: (typeof taskStatuses)[number];
  priority: number;
  signal_strength: number;
  estimated_minutes: number;
  reward_credits: number;
  recurrence_days: number | null;
  due_at: Date | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  completion_id?: string | null;
  verification_status?:
    | "SELF_REPORTED"
    | "AWAITING_EVIDENCE"
    | "AWAITING_REVIEW"
    | "VERIFIED"
    | "AUTOMATICALLY_VERIFIED"
    | "REJECTED"
    | null;
}

const createTaskSchema = z
  .object({
    productId: z.string().uuid(),
    templateId: z.string().trim().min(3).max(80).optional(),
    title: z.string().trim().min(2).max(250).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    priority: z.number().int().min(1).max(5).optional(),
    signalStrength: z.number().int().min(1).max(5).optional(),
    estimatedMinutes: z.number().int().min(5).max(600).optional(),
    rewardCredits: z.number().int().min(0).max(10000).optional(),
    recurrenceDays: z.number().int().min(1).max(365).nullable().optional(),
    dueAt: z.string().datetime().nullable().optional(),
  })
  .strict()
  .refine((body) => Boolean(body.templateId || body.title), {
    message: "Choose a template or enter a task title.",
  });

const cancelTaskSchema = z.object({ status: z.literal("CANCELLED") }).strict();
const productQuerySchema = z.object({ productId: z.string().uuid() }).strict();

function templateResponse(row: TaskTemplateRow) {
  return {
    id: row.id,
    productStage: row.product_stage,
    productStageLabel: PRODUCT_STAGE_LABELS[row.product_stage],
    title: row.title,
    priority: row.priority,
    signalStrength: row.signal_strength,
    estimatedMinutes: row.estimated_minutes,
    rewardCredits: row.default_reward_credits,
  };
}

function taskResponse(row: TaskRow) {
  return {
    id: row.id,
    productId: row.product_id,
    templateId: row.template_id,
    seriesId: row.series_id,
    sequenceNumber: row.sequence_number,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    signalStrength: row.signal_strength,
    estimatedMinutes: row.estimated_minutes,
    rewardCredits: row.reward_credits,
    recurrenceDays: row.recurrence_days,
    dueAt: row.due_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    verificationStatus: row.verification_status ?? null,
  };
}

function taskIdFrom(request: FastifyRequest): string | null {
  const parsed = z
    .string()
    .uuid()
    .safeParse((request.params as { taskId?: string }).taskId);
  return parsed.success ? parsed.data : null;
}

async function loadTask(client: DbClient, taskId: string, userId: string): Promise<TaskRow | null> {
  const result = await client.query<TaskRow>(
    `SELECT task.*, completion.id AS completion_id,
            completion.verification_status
     FROM enough.growth_tasks task
     LEFT JOIN enough.growth_task_completions completion ON completion.task_id = task.id
     WHERE task.id = $1 AND task.user_id = $2`,
    [taskId, userId],
  );
  return result.rows[0] ?? null;
}

function sendTaskError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  request.log.error({ err: error }, "Growth task operation failed");
  return reply.code(503).send({ error: "The task could not be saved. Try again shortly." });
}

export async function registerTaskRoutes(app: FastifyInstance): Promise<void> {
  app.get("/growth-tasks", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!(await checkRateLimit(request, reply, "growth-tasks:read", session.id, 120, 60))) return;
    const parsedQuery = productQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) return reply.code(400).send({ error: "Choose a valid product." });
    try {
      const product = await pool.query<ProductTaskContext>(
        "SELECT id, product_stage FROM enough.products WHERE id = $1 AND user_id = $2",
        [parsedQuery.data.productId, session.id],
      );
      if (!product.rows[0]) return reply.code(404).send({ error: "Product not found." });
      const [tasks, templates] = await Promise.all([
        pool.query<TaskRow>(
          `SELECT task.*, completion.id AS completion_id, completion.verification_status
           FROM enough.growth_tasks task
           LEFT JOIN enough.growth_task_completions completion ON completion.task_id = task.id
           WHERE task.product_id = $1 AND task.user_id = $2
           ORDER BY CASE task.status WHEN 'ACTIVE' THEN 0 WHEN 'COMPLETED' THEN 1 ELSE 2 END,
                    task.priority DESC, task.due_at ASC NULLS LAST, task.created_at DESC
           LIMIT 250`,
          [parsedQuery.data.productId, session.id],
        ),
        pool.query<TaskTemplateRow>(
          `SELECT id, product_stage, title, priority, signal_strength, estimated_minutes, default_reward_credits
           FROM enough.growth_task_templates
           WHERE product_stage = $1 AND is_active
           ORDER BY priority DESC, id`,
          [product.rows[0].product_stage],
        ),
      ]);
      return reply.send({
        productId: product.rows[0].id,
        productStage: product.rows[0].product_stage,
        productStageLabel: PRODUCT_STAGE_LABELS[product.rows[0].product_stage],
        templates: templates.rows.map(templateResponse),
        tasks: tasks.rows.map(taskResponse),
      });
    } catch (error) {
      return sendTaskError(request, reply, error);
    }
  });

  app.post("/growth-tasks", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "growth-tasks:create", session.id, 60, 60 * 60)))
      return;
    const parsed = createTaskSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? "Review the task details." });
    const body = parsed.data;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const product = await client.query<ProductTaskContext>(
        "SELECT id, product_stage FROM enough.products WHERE id = $1 AND user_id = $2 FOR SHARE",
        [body.productId, session.id],
      );
      if (!product.rows[0]) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Product not found." });
      }
      let template: TaskTemplateRow | undefined;
      if (body.templateId) {
        const result = await client.query<TaskTemplateRow>(
          `SELECT id, product_stage, title, priority, signal_strength, estimated_minutes, default_reward_credits
           FROM enough.growth_task_templates
           WHERE id = $1 AND product_stage = $2 AND is_active`,
          [body.templateId, product.rows[0].product_stage],
        );
        template = result.rows[0];
        if (!template) {
          await client.query("ROLLBACK");
          return reply.code(409).send({
            error:
              "That recommendation no longer matches this product stage. Reload the task list.",
          });
        }
      }
      const title = template?.title ?? body.title;
      if (!title) {
        await client.query("ROLLBACK");
        return reply.code(400).send({ error: "A task title is required." });
      }
      const id = randomUUID();
      const created = await client.query<TaskRow>(
        `INSERT INTO enough.growth_tasks
           (id, user_id, product_id, template_id, series_id, title, description, priority,
            signal_strength, estimated_minutes, reward_credits, recurrence_days, due_at)
         VALUES ($1, $2, $3, $4, $1, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [
          id,
          session.id,
          body.productId,
          template?.id ?? null,
          title,
          body.description ?? null,
          body.priority ?? template?.priority ?? 3,
          body.signalStrength ?? template?.signal_strength ?? 3,
          body.estimatedMinutes ?? template?.estimated_minutes ?? 30,
          body.rewardCredits ?? template?.default_reward_credits ?? 0,
          body.recurrenceDays ?? null,
          body.dueAt ? new Date(body.dueAt) : null,
        ],
      );
      await client.query(
        `INSERT INTO enough.auth_audit_events (id, user_id, device_id, event_type, metadata)
         VALUES ($1, $2, $3, 'growth_task.created', $4::jsonb)`,
        [
          randomUUID(),
          session.id,
          session.deviceId,
          JSON.stringify({
            taskId: id,
            productId: body.productId,
            templateId: template?.id ?? null,
          }),
        ],
      );
      await client.query("COMMIT");
      return reply.code(201).send({ task: taskResponse(created.rows[0]) });
    } catch (error) {
      await client.query("ROLLBACK");
      return sendTaskError(request, reply, error);
    } finally {
      client.release();
    }
  });

  app.patch("/growth-tasks/:taskId", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "growth-tasks:update", session.id, 120, 60 * 60)))
      return;
    const taskId = taskIdFrom(request);
    if (!taskId) return reply.code(400).send({ error: "Invalid task ID." });
    const parsed = cancelTaskSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Tasks can only be cancelled from this action." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const task = await client.query<TaskRow>(
        "SELECT * FROM enough.growth_tasks WHERE id = $1 AND user_id = $2 FOR UPDATE",
        [taskId, session.id],
      );
      const current = task.rows[0];
      if (!current) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Task not found." });
      }
      if (current.status === "COMPLETED") {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "A completed task cannot be cancelled." });
      }
      if (current.status === "ACTIVE") {
        await client.query(
          "UPDATE enough.growth_tasks SET status = 'CANCELLED', updated_at = now() WHERE id = $1",
          [taskId],
        );
        await client.query(
          `INSERT INTO enough.auth_audit_events (id, user_id, device_id, event_type, metadata)
           VALUES ($1, $2, $3, 'growth_task.cancelled', $4::jsonb)`,
          [
            randomUUID(),
            session.id,
            session.deviceId,
            JSON.stringify({ taskId, productId: current.product_id }),
          ],
        );
      }
      const updated = await loadTask(client, taskId, session.id);
      await client.query("COMMIT");
      return reply.send({ task: taskResponse(updated ?? current) });
    } catch (error) {
      await client.query("ROLLBACK");
      return sendTaskError(request, reply, error);
    } finally {
      client.release();
    }
  });

  app.post("/growth-tasks/:taskId/complete", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "growth-tasks:complete", session.id, 60, 60 * 60)))
      return;
    const taskId = taskIdFrom(request);
    if (!taskId) return reply.code(400).send({ error: "Invalid task ID." });
    try {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const locked = await client.query<TaskRow>(
          "SELECT * FROM enough.growth_tasks WHERE id = $1 AND user_id = $2 FOR UPDATE",
          [taskId, session.id],
        );
        const current = locked.rows[0];
        if (!current) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "Task not found." });
        }
        if (current.status === "CANCELLED") {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "A cancelled task cannot be completed." });
        }
        if (current.status === "COMPLETED") {
          const existing = await client.query<{
            id: string;
            verification_status:
              | "SELF_REPORTED"
              | "AWAITING_EVIDENCE"
              | "AWAITING_REVIEW"
              | "VERIFIED"
              | "AUTOMATICALLY_VERIFIED"
              | "REJECTED";
            reward_credits: number;
            credit_transaction_id: string | null;
            completed_at: Date;
          }>(
            `SELECT id, verification_status, reward_credits, credit_transaction_id, completed_at
             FROM enough.growth_task_completions WHERE task_id = $1`,
            [taskId],
          );
          const task = await loadTask(client, taskId, session.id);
          const next = await client.query<TaskRow>(
            `SELECT * FROM enough.growth_tasks
             WHERE series_id = $1 AND sequence_number > $2 AND status = 'ACTIVE'
             ORDER BY sequence_number LIMIT 1`,
            [current.series_id, current.sequence_number],
          );
          await client.query("COMMIT");
          return reply.send({
            task: taskResponse(task ?? current),
            completion: existing.rows[0]
              ? {
                  id: existing.rows[0].id,
                  verificationStatus: existing.rows[0].verification_status,
                  rewardCredits: existing.rows[0].reward_credits,
                  creditTransactionId: existing.rows[0].credit_transaction_id,
                  completedAt: existing.rows[0].completed_at.toISOString(),
                }
              : null,
            nextTask: next.rows[0] ? taskResponse(next.rows[0]) : null,
            replayed: true,
          });
        }
        const clock = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
        const completedAt = clock.rows[0].now;
        const updated = await client.query<TaskRow>(
          `UPDATE enough.growth_tasks SET status = 'COMPLETED', completed_at = $2, updated_at = $2
           WHERE id = $1 RETURNING *`,
          [taskId, completedAt],
        );
        const completionId = randomUUID();
        await client.query(
          `INSERT INTO enough.growth_task_completions
             (id, task_id, product_id, user_id, verification_status, reward_credits, completed_at)
           VALUES ($1, $2, $3, $4, 'AWAITING_EVIDENCE', $5, $6)`,
          [
            completionId,
            taskId,
            current.product_id,
            session.id,
            current.reward_credits,
            completedAt,
          ],
        );
        let nextTask: TaskRow | null = null;
        if (current.recurrence_days) {
          const nextId = randomUUID();
          const dueAt = new Date(
            completedAt.getTime() + current.recurrence_days * 24 * 60 * 60 * 1000,
          );
          const next = await client.query<TaskRow>(
            `INSERT INTO enough.growth_tasks
               (id, user_id, product_id, template_id, series_id, sequence_number, title, description,
                priority, signal_strength, estimated_minutes, reward_credits, recurrence_days, due_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING *`,
            [
              nextId,
              session.id,
              current.product_id,
              current.template_id,
              current.series_id,
              current.sequence_number + 1,
              current.title,
              current.description,
              current.priority,
              current.signal_strength,
              current.estimated_minutes,
              current.reward_credits,
              current.recurrence_days,
              dueAt,
            ],
          );
          nextTask = next.rows[0];
        }
        await client.query(
          `INSERT INTO enough.auth_audit_events (id, user_id, device_id, event_type, metadata)
           VALUES ($1, $2, $3, 'growth_task.completed', $4::jsonb)`,
          [
            randomUUID(),
            session.id,
            session.deviceId,
            JSON.stringify({
              taskId,
              productId: current.product_id,
              rewardCreditsPending: current.reward_credits,
              verificationStatus: "AWAITING_EVIDENCE",
            }),
          ],
        );
        await client.query("COMMIT");
        return reply.send({
          task: taskResponse(updated.rows[0]),
          completion: {
            id: completionId,
            verificationStatus: "AWAITING_EVIDENCE",
            rewardCredits: current.reward_credits,
            creditTransactionId: null,
            completedAt: completedAt.toISOString(),
          },
          nextTask: nextTask ? taskResponse(nextTask) : null,
          replayed: false,
        });
      } catch (error) {
        await client.query("ROLLBACK");
        return sendTaskError(request, reply, error);
      } finally {
        client.release();
      }
    } catch (error) {
      return sendTaskError(request, reply, error);
    }
  });
}
