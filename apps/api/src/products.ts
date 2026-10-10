import { randomUUID } from "node:crypto";
import { checkRateLimit } from "@enough/auth";
import { type DbClient, pool } from "@enough/db";
import {
  isLaunchedProductStage,
  PRODUCT_STAGE_GUIDANCE,
  PRODUCT_STAGE_LABELS,
  PRODUCT_STAGES,
  type ProductStage,
} from "@enough/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireCsrf, requireSession } from "./api-auth.js";
import { insertNotification } from "./notifications.js";
import { initialRecommendation } from "./onboarding.js";

const goalTypes = [
  "PROBLEM_RESEARCH",
  "CUSTOMER_INTERVIEWS",
  "PROTOTYPE_TESTS",
  "WAITLIST",
  "LAUNCH",
  "SIGNUPS",
  "ACTIVATION",
  "RETENTION",
  "REVENUE",
  "CUSTOM",
] as const;
const goalStatuses = ["ACTIVE", "COMPLETED", "CANCELLED"] as const;

interface ProductRow {
  id: string;
  user_id: string;
  name: string;
  target_customer: string;
  problem_statement: string;
  product_stage: ProductStage;
  has_launched: boolean;
  user_count: number;
  paying_user_count: number;
  current_revenue: string | null;
  revenue_currency: string;
  created_at: Date;
  updated_at: Date;
}

interface GoalRow {
  id: string;
  goal_type: (typeof goalTypes)[number];
  title: string;
  description: string | null;
  status: (typeof goalStatuses)[number];
  target_value: string | null;
  unit: string | null;
  is_primary: boolean;
  due_at: Date | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

interface MetricRow {
  id: string;
  metric_key: string;
  display_name: string;
  value: string;
  unit: string;
  recorded_at: Date;
}

const createProductSchema = z
  .object({
    name: z.string().trim().min(3).max(240),
    targetCustomer: z.string().trim().min(2).max(240),
    problemStatement: z.string().trim().min(3).max(500),
    productStage: z.enum(PRODUCT_STAGES),
    hasLaunched: z.boolean().default(false),
    userCount: z.number().int().min(0).max(2_147_483_647).default(0),
    payingUserCount: z.number().int().min(0).max(2_147_483_647).default(0),
    currentRevenue: z
      .string()
      .regex(/^\d{1,12}(?:\.\d{0,2})?$/)
      .nullable()
      .default(null),
    revenueCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default("EUR"),
    initialGoal: z.string().trim().min(2).max(250),
  })
  .refine((product) => product.payingUserCount <= product.userCount, {
    message: "Paying users cannot exceed total users.",
    path: ["payingUserCount"],
  });

const stageChangeSchema = z.object({
  productStage: z.enum(PRODUCT_STAGES),
  expectedStage: z.enum(PRODUCT_STAGES).optional(),
  reason: z.string().trim().max(500).optional(),
});

const createGoalSchema = z.object({
  goalType: z.enum(goalTypes).default("CUSTOM"),
  title: z.string().trim().min(2).max(250),
  description: z.string().trim().max(1000).nullable().optional(),
  targetValue: z
    .string()
    .regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/)
    .nullable()
    .optional(),
  unit: z.string().trim().max(32).nullable().optional(),
  isPrimary: z.boolean().default(false),
  dueAt: z.string().datetime().nullable().optional(),
});

const updateGoalSchema = z.object({
  status: z.enum(goalStatuses),
  expectedStatus: z.enum(goalStatuses).optional(),
});

const createMetricSchema = z.object({
  metricKey: z.string().regex(/^[a-z][a-z0-9_]{0,49}$/),
  displayName: z.string().trim().min(2).max(100),
  value: z.string().regex(/^-?(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/),
  unit: z.string().trim().min(1).max(32),
  expectedValue: z
    .string()
    .regex(/^-?(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/)
    .nullable()
    .optional(),
  expectedCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
});

function productResponse(product: ProductRow) {
  const guidance = PRODUCT_STAGE_GUIDANCE[product.product_stage];
  return {
    id: product.id,
    name: product.name,
    targetCustomer: product.target_customer,
    problemStatement: product.problem_statement,
    productStage: product.product_stage,
    productStageLabel: PRODUCT_STAGE_LABELS[product.product_stage],
    hasLaunched: product.has_launched,
    userCount: product.user_count,
    payingUserCount: product.paying_user_count,
    currentRevenue: product.current_revenue,
    revenueCurrency: product.revenue_currency.trim(),
    createdAt: product.created_at.toISOString(),
    updatedAt: product.updated_at.toISOString(),
    guidance: {
      ...guidance,
      productStage: product.product_stage,
      productStageLabel: PRODUCT_STAGE_LABELS[product.product_stage],
    },
  };
}

function goalResponse(goal: GoalRow) {
  return {
    id: goal.id,
    goalType: goal.goal_type,
    title: goal.title,
    description: goal.description,
    status: goal.status,
    targetValue: goal.target_value,
    unit: goal.unit,
    isPrimary: goal.is_primary,
    dueAt: goal.due_at?.toISOString() ?? null,
    createdAt: goal.created_at.toISOString(),
    updatedAt: goal.updated_at.toISOString(),
    completedAt: goal.completed_at?.toISOString() ?? null,
  };
}

function metricResponse(metric: MetricRow) {
  return {
    id: metric.id,
    metricKey: metric.metric_key,
    displayName: metric.display_name,
    value: metric.value,
    unit: metric.unit.trim(),
    recordedAt: metric.recorded_at.toISOString(),
  };
}

function productIdFrom(request: FastifyRequest): string | null {
  const parsed = z
    .string()
    .uuid()
    .safeParse((request.params as { productId?: string }).productId);
  return parsed.success ? parsed.data : null;
}

async function findOwnedProduct(productId: string, userId: string): Promise<ProductRow | null> {
  const result = await pool.query<ProductRow>(
    "SELECT * FROM enough.products WHERE id = $1 AND user_id = $2",
    [productId, userId],
  );
  return result.rows[0] ?? null;
}

// Call under the account/product write locks, within the same transaction.
// With no active primary, next_goal remains the last onboarding answer; status
// lives on the canonical goal and an unchanged wizard save must not reopen it.
async function syncOnboardingProfile(client: DbClient, productId: string, userId: string) {
  const result = await client.query<ProductRow & { next_goal: string; build_tools: string[] }>(
    `SELECT product.*, profile.build_tools,
       COALESCE((SELECT title FROM enough.product_goals
         WHERE product_id = product.id AND user_id = $2 AND is_primary AND status = 'ACTIVE'),
         profile.next_goal) AS next_goal
     FROM enough.products product JOIN enough.onboarding_profiles profile
       ON profile.product_id = product.id AND profile.user_id = product.user_id
     WHERE product.id = $1 AND product.user_id = $2`,
    [productId, userId],
  );
  const product = result.rows[0];
  if (!product) return;
  const recommendation = initialRecommendation({
    productDescription: product.name,
    targetCustomer: product.target_customer,
    problemStatement: product.problem_statement,
    productStage: product.product_stage,
    hasLaunched: product.has_launched,
    userCount: product.user_count,
    payingUserCount: product.paying_user_count,
    currentRevenue: product.current_revenue,
    revenueCurrency: product.revenue_currency.trim(),
    nextGoal: product.next_goal,
    buildTools: product.build_tools,
  });
  await client.query(
    `UPDATE enough.onboarding_profiles SET product_description = $3,
       target_customer = $4, problem_statement = $5, product_stage = $6,
       has_launched = $7, user_count = $8, paying_user_count = $9,
       current_revenue = $10, revenue_currency = $11, next_goal = $12,
       recommended_config = $13::jsonb, updated_at = now()
     WHERE product_id = $1 AND user_id = $2`,
    [
      productId,
      userId,
      product.name,
      product.target_customer,
      product.problem_statement,
      product.product_stage,
      product.has_launched,
      product.user_count,
      product.paying_user_count,
      product.current_revenue,
      product.revenue_currency,
      product.next_goal,
      JSON.stringify(recommendation),
    ],
  );
}

async function loadProductDetail(productId: string, userId: string) {
  const product = await findOwnedProduct(productId, userId);
  if (!product) return null;
  const [history, goals, metrics] = await Promise.all([
    pool.query<{
      id: string;
      from_stage: ProductStage | null;
      to_stage: ProductStage;
      change_reason: string | null;
      changed_at: Date;
    }>(
      `SELECT history.id, history.from_stage, history.to_stage, history.change_reason, history.changed_at
       FROM enough.product_stage_history history
       JOIN enough.products product ON product.id = history.product_id
       WHERE history.product_id = $1 AND product.user_id = $2
       ORDER BY history.changed_at DESC`,
      [productId, userId],
    ),
    pool.query<GoalRow>(
      "SELECT * FROM enough.product_goals WHERE product_id = $1 AND user_id = $2 ORDER BY is_primary DESC, created_at DESC",
      [productId, userId],
    ),
    pool.query<MetricRow>(
      `SELECT id, metric_key, display_name, value::text AS value, unit, recorded_at
       FROM enough.product_metrics WHERE product_id = $1
       ORDER BY recorded_at DESC LIMIT 100`,
      [productId],
    ),
  ]);
  return {
    product: productResponse(product),
    stageHistory: history.rows.map((row) => ({
      id: row.id,
      fromStage: row.from_stage,
      fromStageLabel: row.from_stage ? PRODUCT_STAGE_LABELS[row.from_stage] : null,
      toStage: row.to_stage,
      toStageLabel: PRODUCT_STAGE_LABELS[row.to_stage],
      reason: row.change_reason,
      changedAt: row.changed_at.toISOString(),
    })),
    goals: goals.rows.map(goalResponse),
    metrics: metrics.rows.map(metricResponse),
  };
}

export async function registerProductRoutes(app: FastifyInstance): Promise<void> {
  app.get("/products", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!(await checkRateLimit(request, reply, "products:read", session.id, 120, 60))) return;
    try {
      const result = await pool.query<ProductRow>(
        "SELECT * FROM enough.products WHERE user_id = $1 ORDER BY updated_at DESC, created_at DESC",
        [session.id],
      );
      return reply.send({ products: result.rows.map(productResponse) });
    } catch (error) {
      request.log.error({ err: error }, "Could not list products");
      return reply.code(503).send({ error: "Your products are temporarily unavailable." });
    }
  });

  app.post("/products", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "products:create", session.id, 20, 60 * 60))) return;
    const parsed = createProductSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? "Review your product details." });
    const body = parsed.data;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const created = await client.query<ProductRow>(
        `INSERT INTO enough.products
           (id, user_id, name, target_customer, problem_statement, product_stage, has_launched,
            user_count, paying_user_count, current_revenue, revenue_currency)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          randomUUID(),
          session.id,
          body.name,
          body.targetCustomer,
          body.problemStatement,
          body.productStage,
          body.hasLaunched || isLaunchedProductStage(body.productStage),
          body.userCount,
          body.payingUserCount,
          body.currentRevenue,
          body.revenueCurrency,
        ],
      );
      const product = created.rows[0];
      await client.query(
        `INSERT INTO enough.product_stage_history
           (id, product_id, from_stage, to_stage, change_reason, changed_by)
         VALUES ($1, $2, NULL, $3, 'Initial stage', $4)`,
        [randomUUID(), product.id, product.product_stage, session.id],
      );
      await client.query(
        `INSERT INTO enough.product_goals
           (id, product_id, user_id, goal_type, title, status, is_primary)
         VALUES ($1, $2, $3, 'CUSTOM', $4, 'ACTIVE', true)`,
        [randomUUID(), product.id, session.id, body.initialGoal],
      );
      await client.query(
        `INSERT INTO enough.product_metrics (id, product_id, metric_key, display_name, value, unit)
         VALUES ($1, $2, 'total_users', 'Total users', $3, 'users'),
                ($4, $2, 'paying_users', 'Paying users', $5, 'users')`,
        [randomUUID(), product.id, body.userCount, randomUUID(), body.payingUserCount],
      );
      if (body.currentRevenue !== null) {
        await client.query(
          `INSERT INTO enough.product_metrics (id, product_id, metric_key, display_name, value, unit)
           VALUES ($1, $2, 'current_revenue', 'Current revenue', $3, $4)`,
          [randomUUID(), product.id, body.currentRevenue, body.revenueCurrency],
        );
      }
      await client.query(
        `INSERT INTO enough.auth_audit_events (id, user_id, device_id, event_type)
         VALUES ($1, $2, $3, 'product.created')`,
        [randomUUID(), session.id, session.deviceId],
      );
      await client.query("COMMIT");
      return reply.code(201).send({ product: productResponse(product) });
    } catch (error) {
      await client.query("ROLLBACK");
      if (
        (error as { code?: string; constraint?: string }).code === "23505" &&
        (error as { constraint?: string }).constraint === "products_user_name_idx"
      )
        return reply
          .code(409)
          .send({ error: "A product with this name already exists. Choose another name." });
      request.log.error({ err: error }, "Could not create product");
      return reply
        .code(503)
        .send({ error: "The product could not be created. Try again shortly." });
    } finally {
      client.release();
    }
  });

  app.get("/products/:productId", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!(await checkRateLimit(request, reply, "products:read", session.id, 120, 60))) return;
    const productId = productIdFrom(request);
    if (!productId) return reply.code(400).send({ error: "Invalid product ID." });
    try {
      const detail = await loadProductDetail(productId, session.id);
      if (!detail) return reply.code(404).send({ error: "Product not found." });
      return reply.send(detail);
    } catch (error) {
      request.log.error({ err: error }, "Could not load product");
      return reply.code(503).send({ error: "The product is temporarily unavailable." });
    }
  });

  app.post("/products/:productId/stage", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "products:stage", session.id, 60, 60 * 60))) return;
    const productId = productIdFrom(request);
    if (!productId) return reply.code(400).send({ error: "Invalid product ID." });
    const parsed = stageChangeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Choose a valid product stage." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM enough.auth_users WHERE id = $1 FOR UPDATE", [session.id]);
      const current = await client.query<{ product_stage: ProductStage; name: string }>(
        "SELECT product_stage, name FROM enough.products WHERE id = $1 AND user_id = $2 FOR UPDATE",
        [productId, session.id],
      );
      const previousStage = current.rows[0]?.product_stage;
      if (!previousStage) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Product not found." });
      }
      if (parsed.data.expectedStage !== undefined && parsed.data.expectedStage !== previousStage) {
        await client.query("ROLLBACK");
        return reply
          .code(409)
          .send({ error: "The product stage changed. Refresh and review before trying again." });
      }
      if (previousStage === parsed.data.productStage) {
        await client.query("COMMIT");
        return reply.send({
          changed: false,
          productStage: previousStage,
          guidance: PRODUCT_STAGE_GUIDANCE[previousStage],
        });
      }
      await client.query(
        `UPDATE enough.products
         SET product_stage = $3,
             has_launched = has_launched OR $4::boolean,
             updated_at = now()
         WHERE id = $1 AND user_id = $2`,
        [
          productId,
          session.id,
          parsed.data.productStage,
          isLaunchedProductStage(parsed.data.productStage),
        ],
      );
      await client.query(
        `INSERT INTO enough.product_stage_history
           (id, product_id, from_stage, to_stage, change_reason, changed_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          randomUUID(),
          productId,
          previousStage,
          parsed.data.productStage,
          parsed.data.reason || null,
          session.id,
        ],
      );
      const guidance = PRODUCT_STAGE_GUIDANCE[parsed.data.productStage];
      await syncOnboardingProfile(client, productId, session.id);
      await client.query(
        `INSERT INTO enough.auth_audit_events (id, user_id, device_id, event_type)
         VALUES ($1, $2, $3, 'product.stage_changed')`,
        [randomUUID(), session.id, session.deviceId],
      );
      await insertNotification(client, {
        userId: session.id,
        productId,
        type: "STAGE_CHANGED",
        title: "Product stage changed",
        body:
          current.rows[0].name +
          " moved from " +
          PRODUCT_STAGE_LABELS[previousStage] +
          " to " +
          PRODUCT_STAGE_LABELS[parsed.data.productStage] +
          ".",
        href: `/products?productId=${productId}`,
        dedupeKey:
          "stage:" +
          productId +
          ":" +
          previousStage +
          ":" +
          parsed.data.productStage +
          ":" +
          Date.now(),
      });
      await client.query("COMMIT");
      return reply.send({
        changed: true,
        fromStage: previousStage,
        productStage: parsed.data.productStage,
        guidance,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      request.log.error({ err: error }, "Could not change product stage");
      return reply.code(503).send({ error: "The product stage could not be changed." });
    } finally {
      client.release();
    }
  });

  app.post("/products/:productId/goals", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "products:goal-create", session.id, 60, 60 * 60)))
      return;
    const productId = productIdFrom(request);
    if (!productId) return reply.code(400).send({ error: "Invalid product ID." });
    const parsed = createGoalSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? "Review the goal details." });
    const goal = parsed.data;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM enough.auth_users WHERE id = $1 FOR UPDATE", [session.id]);
      const product = await client.query(
        "SELECT id FROM enough.products WHERE id = $1 AND user_id = $2 FOR UPDATE",
        [productId, session.id],
      );
      if (!product.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Product not found." });
      }
      if (goal.isPrimary) {
        await client.query(
          "UPDATE enough.product_goals SET is_primary = false, updated_at = now() WHERE product_id = $1 AND user_id = $2 AND status = 'ACTIVE' AND is_primary",
          [productId, session.id],
        );
      }
      const saved = await client.query<GoalRow>(
        `INSERT INTO enough.product_goals
           (id, product_id, user_id, goal_type, title, description, target_value, unit, is_primary, due_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          randomUUID(),
          productId,
          session.id,
          goal.goalType,
          goal.title,
          goal.description ?? null,
          goal.targetValue ?? null,
          goal.unit ?? null,
          goal.isPrimary,
          goal.dueAt ?? null,
        ],
      );
      await syncOnboardingProfile(client, productId, session.id);
      await client.query(
        `INSERT INTO enough.auth_audit_events (id, user_id, device_id, event_type)
         VALUES ($1, $2, $3, 'product.goal_created')`,
        [randomUUID(), session.id, session.deviceId],
      );
      await client.query("COMMIT");
      return reply.code(201).send({ goal: goalResponse(saved.rows[0]) });
    } catch (error) {
      await client.query("ROLLBACK");
      request.log.error({ err: error }, "Could not create product goal");
      return reply.code(503).send({ error: "The goal could not be created." });
    } finally {
      client.release();
    }
  });

  app.patch("/products/:productId/goals/:goalId", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "products:goal-update", session.id, 120, 60 * 60)))
      return;
    const productId = productIdFrom(request);
    const goalId = z
      .string()
      .uuid()
      .safeParse((request.params as { goalId?: string }).goalId);
    if (!productId || !goalId.success)
      return reply.code(400).send({ error: "Invalid product or goal ID." });
    const parsed = updateGoalSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Choose a valid goal status." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM enough.auth_users WHERE id = $1 FOR UPDATE", [session.id]);
      await client.query(
        "SELECT id FROM enough.products WHERE id = $1 AND user_id = $2 FOR UPDATE",
        [productId, session.id],
      );
      const current = await client.query<GoalRow>(
        "SELECT * FROM enough.product_goals WHERE id = $1 AND product_id = $2 AND user_id = $3 FOR UPDATE",
        [goalId.data, productId, session.id],
      );
      if (!current.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Goal not found." });
      }
      if (
        parsed.data.expectedStatus !== undefined &&
        parsed.data.expectedStatus !== current.rows[0].status
      ) {
        await client.query("ROLLBACK");
        return reply
          .code(409)
          .send({ error: "The goal status changed. Refresh and review before trying again." });
      }
      const result = await client.query<GoalRow>(
        `UPDATE enough.product_goals AS goal
         SET status = $4, is_primary = CASE WHEN $4 = 'ACTIVE' THEN is_primary ELSE false END,
             completed_at = CASE WHEN $4 = 'COMPLETED' THEN COALESCE(completed_at, now()) ELSE NULL END,
             updated_at = now()
         FROM enough.products AS product
         WHERE goal.id = $1 AND goal.product_id = $2 AND goal.user_id = $3
           AND product.id = goal.product_id AND product.user_id = $3
         RETURNING goal.*`,
        [goalId.data, productId, session.id, parsed.data.status],
      );
      if (!result.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Goal not found." });
      }
      await syncOnboardingProfile(client, productId, session.id);
      await client.query(
        `INSERT INTO enough.auth_audit_events (id, user_id, device_id, event_type)
         VALUES ($1, $2, $3, 'product.goal_updated')`,
        [randomUUID(), session.id, session.deviceId],
      );
      await client.query("COMMIT");
      return reply.send({ goal: goalResponse(result.rows[0]) });
    } catch (error) {
      await client.query("ROLLBACK");
      request.log.error({ err: error }, "Could not update product goal");
      return reply.code(503).send({ error: "The goal could not be updated." });
    } finally {
      client.release();
    }
  });

  app.post("/products/:productId/metrics", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "products:metric-write", session.id, 120, 60 * 60)))
      return;
    const productId = productIdFrom(request);
    if (!productId) return reply.code(400).send({ error: "Invalid product ID." });
    const parsed = createMetricSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? "Review the metric details." });
    const metric = parsed.data;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM enough.auth_users WHERE id = $1 FOR UPDATE", [session.id]);
      const found = await client.query<ProductRow>(
        "SELECT * FROM enough.products WHERE id = $1 AND user_id = $2 FOR UPDATE",
        [productId, session.id],
      );
      const product = found.rows[0];
      if (!product) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Product not found." });
      }
      const metricKey = metric.metricKey;
      const canonicalValue =
        metricKey === "total_users"
          ? product.user_count
          : metricKey === "paying_users"
            ? product.paying_user_count
            : metricKey === "current_revenue"
              ? product.current_revenue
              : undefined;
      if (
        canonicalValue !== undefined &&
        metric.expectedValue !== undefined &&
        ((canonicalValue === null) !== (metric.expectedValue === null) ||
          Number(canonicalValue) !== Number(metric.expectedValue) ||
          (metricKey === "current_revenue" &&
            metric.expectedCurrency !== undefined &&
            metric.expectedCurrency !== product.revenue_currency.trim()))
      ) {
        await client.query("ROLLBACK");
        return reply
          .code(409)
          .send({ error: "The product metric changed. Refresh and review before trying again." });
      }
      let displayName = metric.displayName;
      let value = metric.value;
      let unit = metric.unit;
      if (metricKey === "total_users") {
        const count = Number(value);
        if (
          !Number.isSafeInteger(count) ||
          count < product.paying_user_count ||
          count > 2_147_483_647
        ) {
          await client.query("ROLLBACK");
          return reply.code(400).send({
            error: "Total users must be a whole number at least as large as paying users.",
          });
        }
        displayName = "Total users";
        value = String(count);
        unit = "users";
        await client.query(
          "UPDATE enough.products SET user_count = $3, updated_at = now() WHERE id = $1 AND user_id = $2",
          [productId, session.id, count],
        );
      } else if (metricKey === "paying_users") {
        const count = Number(value);
        if (!Number.isSafeInteger(count) || count < 0 || count > product.user_count) {
          await client.query("ROLLBACK");
          return reply
            .code(400)
            .send({ error: "Paying users must be a whole number between zero and total users." });
        }
        displayName = "Paying users";
        value = String(count);
        unit = "users";
        await client.query(
          "UPDATE enough.products SET paying_user_count = $3, updated_at = now() WHERE id = $1 AND user_id = $2",
          [productId, session.id, count],
        );
      } else if (metricKey === "current_revenue") {
        if (!/^\d{1,12}(?:\.\d{0,2})?$/.test(value) || !/^[A-Z]{3}$/.test(unit)) {
          await client.query("ROLLBACK");
          return reply
            .code(400)
            .send({ error: "Revenue must be non-negative and use a three-letter currency code." });
        }
        displayName = "Current revenue";
        await client.query(
          "UPDATE enough.products SET current_revenue = $3, revenue_currency = $4, updated_at = now() WHERE id = $1 AND user_id = $2",
          [productId, session.id, value, unit],
        );
      }
      const saved = await client.query<MetricRow>(
        `INSERT INTO enough.product_metrics (id, product_id, metric_key, display_name, value, unit)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, metric_key, display_name, value::text AS value, unit, recorded_at`,
        [randomUUID(), productId, metricKey, displayName, value, unit],
      );
      await syncOnboardingProfile(client, productId, session.id);
      await client.query(
        `INSERT INTO enough.auth_audit_events (id, user_id, device_id, event_type)
         VALUES ($1, $2, $3, 'product.metric_recorded')`,
        [randomUUID(), session.id, session.deviceId],
      );
      await client.query("COMMIT");
      return reply.code(201).send({ metric: metricResponse(saved.rows[0]) });
    } catch (error) {
      await client.query("ROLLBACK");
      request.log.error({ err: error }, "Could not record product metric");
      return reply.code(503).send({ error: "The metric could not be recorded." });
    } finally {
      client.release();
    }
  });
}
