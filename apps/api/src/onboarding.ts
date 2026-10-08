import { randomUUID } from "node:crypto";
import { checkRateLimit } from "@enough/auth";
import { pool } from "@enough/db";
import {
  isLaunchedProductStage,
  PRODUCT_STAGE_GUIDANCE,
  PRODUCT_STAGES,
  type ProductStage,
} from "@enough/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireCsrf, requireSession } from "./api-auth.js";

const onboardingSchema = z
  .object({
    productDescription: z.string().trim().min(3).max(240),
    targetCustomer: z.string().trim().min(2).max(240),
    problemStatement: z.string().trim().min(3).max(500),
    productStage: z.enum(PRODUCT_STAGES),
    hasLaunched: z.boolean(),
    userCount: z.number().int().min(0).max(2_147_483_647),
    payingUserCount: z.number().int().min(0).max(2_147_483_647),
    currentRevenue: z
      .string()
      .regex(/^\d{1,12}(?:\.\d{0,2})?$/)
      .nullable(),
    revenueCurrency: z.string().regex(/^[A-Z]{3}$/),
    nextGoal: z.string().trim().min(2).max(250),
    buildTools: z
      .array(z.string().trim().min(1).max(80))
      .max(20)
      .transform((tools) => [...new Set(tools)]),
  })
  .refine((answers) => answers.payingUserCount <= answers.userCount, {
    message: "Paying users cannot exceed total users.",
    path: ["payingUserCount"],
  });

interface OnboardingRow {
  product_description: string;
  target_customer: string;
  problem_statement: string;
  product_stage: ProductStage;
  has_launched: boolean;
  user_count: number;
  paying_user_count: number;
  current_revenue: string | null;
  revenue_currency: string;
  next_goal: string;
  build_tools: string[];
  recommended_config: Record<string, unknown>;
  completed_at: Date;
}

function profileResponse(row: OnboardingRow) {
  return {
    completed: true,
    completedAt: row.completed_at.toISOString(),
    answers: {
      productDescription: row.product_description,
      targetCustomer: row.target_customer,
      problemStatement: row.problem_statement,
      productStage: row.product_stage,
      hasLaunched: row.has_launched,
      userCount: row.user_count,
      payingUserCount: row.paying_user_count,
      currentRevenue: row.current_revenue,
      revenueCurrency: row.revenue_currency.trim(),
      nextGoal: row.next_goal,
      buildTools: row.build_tools,
    },
    recommendation: row.recommended_config,
  };
}

function initialRecommendation(answers: z.infer<typeof onboardingSchema>) {
  const stage = PRODUCT_STAGE_GUIDANCE[answers.productStage];
  let firstAction = stage.priorities[0] ?? stage.headline;
  if (Number(answers.currentRevenue ?? "0") > 0) {
    firstAction = "Trace your current revenue to the customer problem and path that produced it.";
  }
  if (answers.hasLaunched && answers.userCount === 0) {
    firstAction = "Invite a small group of likely customers to try the product.";
  }
  if (answers.payingUserCount > 0) {
    firstAction = "Ask one paying customer which result made the product worth paying for.";
  }
  return {
    version: 2,
    productStage: answers.productStage,
    headline: stage.headline,
    firstAction,
    priorities: stage.priorities,
    signalsToNotice: stage.signals,
    tasks: stage.tasks,
    recommendedRatio: { buildPercent: stage.buildPercent, marketPercent: stage.marketPercent },
    nextGoal: answers.nextGoal,
    buildTools: answers.buildTools,
    reviewPrompt:
      "What did you learn from a customer or prospect, and what will you change because of it?",
  };
}

export async function registerOnboardingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/onboarding", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!(await checkRateLimit(request, reply, "onboarding:read", session.id, 120, 60))) return;
    try {
      const result = await pool.query<OnboardingRow>(
        "SELECT * FROM enough.onboarding_profiles WHERE user_id = $1",
        [session.id],
      );
      const row = result.rows[0];
      return reply.send(
        row
          ? profileResponse(row)
          : { completed: false, completedAt: null, answers: null, recommendation: null },
      );
    } catch (error) {
      request.log.error({ err: error }, "Could not load onboarding profile");
      return reply.code(503).send({ error: "Your workspace is temporarily unavailable." });
    }
  });

  app.post("/onboarding", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "onboarding:write", session.id, 30, 60 * 60)))
      return;
    const parsed = onboardingSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? "Review your answers and try again." });
    }
    const answers = parsed.data;
    const hasLaunched = answers.hasLaunched || isLaunchedProductStage(answers.productStage);
    const recommendation = initialRecommendation(answers);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Serialize profile writes for this account so simultaneous first saves cannot
      // create duplicate products or goals.
      await client.query("SELECT id FROM enough.auth_users WHERE id = $1 FOR UPDATE", [session.id]);
      const existingProfile = await client.query<{ product_id: string | null }>(
        "SELECT product_id FROM enough.onboarding_profiles WHERE user_id = $1 FOR UPDATE",
        [session.id],
      );
      let productId = existingProfile.rows[0]?.product_id ?? null;
      let previousProduct:
        | {
            product_stage: ProductStage;
            user_count: number;
            paying_user_count: number;
            current_revenue: string | null;
            revenue_currency: string;
          }
        | undefined;

      if (productId) {
        const current = await client.query<{
          product_stage: ProductStage;
          user_count: number;
          paying_user_count: number;
          current_revenue: string | null;
          revenue_currency: string;
        }>(
          `SELECT product_stage, user_count, paying_user_count, current_revenue::text AS current_revenue, revenue_currency
           FROM enough.products WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [productId, session.id],
        );
        previousProduct = current.rows[0];
        if (!previousProduct) productId = null;
      }

      if (!productId) {
        productId = randomUUID();
        await client.query(
          `INSERT INTO enough.products
             (id, user_id, name, target_customer, problem_statement, product_stage, has_launched,
              user_count, paying_user_count, current_revenue, revenue_currency)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            productId,
            session.id,
            answers.productDescription,
            answers.targetCustomer,
            answers.problemStatement,
            answers.productStage,
            hasLaunched,
            answers.userCount,
            answers.payingUserCount,
            answers.currentRevenue,
            answers.revenueCurrency,
          ],
        );
        await client.query(
          `INSERT INTO enough.product_stage_history
             (id, product_id, from_stage, to_stage, change_reason, changed_by)
           VALUES ($1, $2, NULL, $3, 'Initial stage from onboarding', $4)`,
          [randomUUID(), productId, answers.productStage, session.id],
        );
        await client.query(
          `INSERT INTO enough.product_goals
             (id, product_id, user_id, goal_type, title, status, is_primary)
           VALUES ($1, $2, $3, 'CUSTOM', $4, 'ACTIVE', true)`,
          [randomUUID(), productId, session.id, answers.nextGoal],
        );
        await client.query(
          `INSERT INTO enough.product_metrics (id, product_id, metric_key, display_name, value, unit)
           VALUES ($1, $2, 'total_users', 'Total users', $3, 'users'),
                  ($4, $2, 'paying_users', 'Paying users', $5, 'users')`,
          [randomUUID(), productId, answers.userCount, randomUUID(), answers.payingUserCount],
        );
        if (answers.currentRevenue !== null) {
          await client.query(
            `INSERT INTO enough.product_metrics (id, product_id, metric_key, display_name, value, unit)
             VALUES ($1, $2, 'current_revenue', 'Current revenue', $3, $4)`,
            [randomUUID(), productId, answers.currentRevenue, answers.revenueCurrency],
          );
        }
      } else {
        await client.query(
          `UPDATE enough.products
           SET name = $3, target_customer = $4, problem_statement = $5, product_stage = $6,
               has_launched = $7, user_count = $8, paying_user_count = $9,
               current_revenue = $10, revenue_currency = $11, updated_at = now()
           WHERE id = $1 AND user_id = $2`,
          [
            productId,
            session.id,
            answers.productDescription,
            answers.targetCustomer,
            answers.problemStatement,
            answers.productStage,
            hasLaunched,
            answers.userCount,
            answers.payingUserCount,
            answers.currentRevenue,
            answers.revenueCurrency,
          ],
        );
        if (previousProduct && previousProduct.product_stage !== answers.productStage) {
          await client.query(
            `INSERT INTO enough.product_stage_history
               (id, product_id, from_stage, to_stage, change_reason, changed_by)
             VALUES ($1, $2, $3, $4, 'Stage updated during onboarding', $5)`,
            [
              randomUUID(),
              productId,
              previousProduct.product_stage,
              answers.productStage,
              session.id,
            ],
          );
        }
        if (previousProduct && previousProduct.user_count !== answers.userCount) {
          await client.query(
            `INSERT INTO enough.product_metrics (id, product_id, metric_key, display_name, value, unit)
             VALUES ($1, $2, 'total_users', 'Total users', $3, 'users')`,
            [randomUUID(), productId, answers.userCount],
          );
        }
        if (previousProduct && previousProduct.paying_user_count !== answers.payingUserCount) {
          await client.query(
            `INSERT INTO enough.product_metrics (id, product_id, metric_key, display_name, value, unit)
             VALUES ($1, $2, 'paying_users', 'Paying users', $3, 'users')`,
            [randomUUID(), productId, answers.payingUserCount],
          );
        }
        if (
          answers.currentRevenue !== null &&
          previousProduct &&
          (previousProduct.current_revenue !== answers.currentRevenue ||
            previousProduct.revenue_currency.trim() !== answers.revenueCurrency)
        ) {
          await client.query(
            `INSERT INTO enough.product_metrics (id, product_id, metric_key, display_name, value, unit)
             VALUES ($1, $2, 'current_revenue', 'Current revenue', $3, $4)`,
            [randomUUID(), productId, answers.currentRevenue, answers.revenueCurrency],
          );
        }
        const activePrimaryGoal = await client.query(
          `UPDATE enough.product_goals SET title = $3, updated_at = now()
           WHERE product_id = $1 AND user_id = $2 AND status = 'ACTIVE' AND is_primary`,
          [productId, session.id, answers.nextGoal],
        );
        if (!activePrimaryGoal.rowCount) {
          await client.query(
            `INSERT INTO enough.product_goals
               (id, product_id, user_id, goal_type, title, status, is_primary)
             VALUES ($1, $2, $3, 'CUSTOM', $4, 'ACTIVE', true)`,
            [randomUUID(), productId, session.id, answers.nextGoal],
          );
        }
      }

      const saved = await client.query<OnboardingRow>(
        `INSERT INTO enough.onboarding_profiles
           (user_id, product_description, target_customer, problem_statement, product_stage,
            has_launched, user_count, paying_user_count, current_revenue, revenue_currency,
            next_goal, build_tools, recommended_config, completed_at, updated_at, product_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, now(), now(), $14)
         ON CONFLICT (user_id) DO UPDATE SET
           product_description = EXCLUDED.product_description,
           target_customer = EXCLUDED.target_customer,
           problem_statement = EXCLUDED.problem_statement,
           product_stage = EXCLUDED.product_stage,
           has_launched = EXCLUDED.has_launched,
           user_count = EXCLUDED.user_count,
           paying_user_count = EXCLUDED.paying_user_count,
           current_revenue = EXCLUDED.current_revenue,
           revenue_currency = EXCLUDED.revenue_currency,
           next_goal = EXCLUDED.next_goal,
           build_tools = EXCLUDED.build_tools,
           recommended_config = EXCLUDED.recommended_config,
           product_id = EXCLUDED.product_id,
           completed_at = now(),
           updated_at = now()
         RETURNING *`,
        [
          session.id,
          answers.productDescription,
          answers.targetCustomer,
          answers.problemStatement,
          answers.productStage,
          hasLaunched,
          answers.userCount,
          answers.payingUserCount,
          answers.currentRevenue,
          answers.revenueCurrency,
          answers.nextGoal,
          answers.buildTools,
          JSON.stringify(recommendation),
          productId,
        ],
      );
      await client.query(
        `INSERT INTO enough.auth_audit_events (id, user_id, device_id, event_type)
         VALUES ($1, $2, $3, 'onboarding.saved')`,
        [randomUUID(), session.id, session.deviceId],
      );
      await client.query("COMMIT");
      return reply.send(profileResponse(saved.rows[0]));
    } catch (error) {
      await client.query("ROLLBACK");
      request.log.error({ err: error }, "Could not save onboarding profile");
      return reply.code(503).send({ error: "Your answers could not be saved. Try again shortly." });
    } finally {
      client.release();
    }
  });
}
