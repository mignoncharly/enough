import { checkRateLimit } from "@enough/auth";
import { pool } from "@enough/db";
import { PRODUCT_STAGE_GUIDANCE, PRODUCT_STAGE_LABELS, type ProductStage } from "@enough/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "./api-auth.js";

const reportQuerySchema = z
  .object({
    productId: z.string().uuid(),
    days: z.coerce
      .number()
      .int()
      .refine((value) => [7, 30, 90].includes(value))
      .default(30),
  })
  .strict();

interface ProductReportRow {
  id: string;
  name: string;
  product_stage: ProductStage;
  has_launched: boolean;
  user_count: number;
  paying_user_count: number;
  current_revenue: string | null;
  revenue_currency: string;
}

interface DayRow {
  report_day: string;
  activity_events: string;
  build_seconds: string;
  grow_seconds: string;
}

interface SignalDayRow {
  report_day: string;
  outreach: string;
  replies: string;
  interviews: string;
  demos: string;
  feedback_calls: string;
  sales_calls: string;
  onboarding_calls: string;
  retention_calls: string;
  signups: string;
  activations: string;
  retained: string;
  payments: string;
}

interface CreditDayRow {
  report_day: string;
  earned: string;
  spent: string;
  refunded: string;
  adjusted: string;
}

function safeInteger(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed)) throw new Error("Report value exceeds the supported range.");
  return parsed;
}

function utcDays(startAt: Date, days: number): string[] {
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(startAt.getTime() + index * 86_400_000);
    return day.toISOString().slice(0, 10);
  });
}

export async function registerReportRoutes(app: FastifyInstance): Promise<void> {
  app.get("/report-data", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!(await checkRateLimit(request, reply, "reports:read", session.id, 60, 60))) return;
    const parsed = reportQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({ error: "Choose a valid product and report range." });

    const now = new Date();
    const startAt = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (parsed.data.days - 1)),
    );
    try {
      const productResult = await pool.query<ProductReportRow>(
        `SELECT id, name, product_stage, has_launched, user_count, paying_user_count,
                current_revenue::text AS current_revenue, revenue_currency
         FROM enough.products WHERE id = $1 AND user_id = $2`,
        [parsed.data.productId, session.id],
      );
      const product = productResult.rows[0];
      if (!product) return reply.code(404).send({ error: "Product not found." });

      const range = [product.id, session.id, startAt, now];
      const weekStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6),
      );
      const [
        activity,
        signals,
        payments,
        credits,
        completions,
        stages,
        funnels,
        weeklyTasks,
        highestSignalTask,
      ] = await Promise.all([
        pool.query<DayRow>(
          `SELECT (effective_at AT TIME ZONE 'UTC')::date::text AS report_day,
                  COUNT(*)::text AS activity_events,
                  COALESCE(SUM(CASE WHEN event_type = 'focus.session_ended' AND attributes->>'mode' = 'BUILD'
                    THEN CASE WHEN attributes->>'duration_seconds' ~ '^[0-9]{1,6}$'
                      THEN CASE WHEN (attributes->>'duration_seconds')::integer <= 21600 THEN (attributes->>'duration_seconds')::integer ELSE 0 END
                      ELSE 0 END ELSE 0 END), 0)::text AS build_seconds,
                  COALESCE(SUM(CASE WHEN event_type = 'focus.session_ended' AND attributes->>'mode' = 'GROWTH'
                    THEN CASE WHEN attributes->>'duration_seconds' ~ '^[0-9]{1,6}$'
                      THEN CASE WHEN (attributes->>'duration_seconds')::integer <= 21600 THEN (attributes->>'duration_seconds')::integer ELSE 0 END
                      ELSE 0 END ELSE 0 END), 0)::text AS grow_seconds
           FROM enough.activity_events
           WHERE product_id = $1 AND user_id = $2 AND effective_at >= $3 AND effective_at < $4
           GROUP BY report_day ORDER BY report_day`,
          range,
        ),
        pool.query<SignalDayRow>(
          `SELECT (occurred_at AT TIME ZONE 'UTC')::date::text AS report_day,
                  (COUNT(*) FILTER (WHERE event_type = 'email.outreach_sent'))::text AS outreach,
                  (COUNT(*) FILTER (WHERE event_type = 'email.reply_received'))::text AS replies,
                  (COUNT(*) FILTER (WHERE event_type = 'calendar.interview_completed'))::text AS interviews,
                  (COUNT(*) FILTER (WHERE event_type = 'calendar.demo_completed'))::text AS demos,
                  (COUNT(*) FILTER (WHERE event_type = 'calendar.feedback_call_completed'))::text AS feedback_calls,
                  (COUNT(*) FILTER (WHERE event_type = 'calendar.sales_call_completed'))::text AS sales_calls,
                  (COUNT(*) FILTER (WHERE event_type = 'calendar.onboarding_completed'))::text AS onboarding_calls,
                  (COUNT(*) FILTER (WHERE event_type = 'calendar.retention_call_completed'))::text AS retention_calls,
                  (COUNT(*) FILTER (WHERE event_type = 'analytics.user_signup'))::text AS signups,
                  (COUNT(*) FILTER (WHERE event_type = 'analytics.user_activated'))::text AS activations,
                  (COUNT(*) FILTER (WHERE event_type = 'analytics.user_retained'))::text AS retained,
                  (COUNT(*) FILTER (WHERE event_type = 'revenue.payment_received'))::text AS payments
           FROM enough.integration_events
           WHERE product_id = $1 AND user_id = $2 AND verification_status = 'AUTHENTICATED'
             AND occurred_at >= $3 AND occurred_at < $4
           GROUP BY report_day ORDER BY report_day`,
          range,
        ),
        pool.query<{
          report_day: string;
          currency: string;
          amount_minor: string;
          payment_count: string;
        }>(
          `SELECT (occurred_at AT TIME ZONE 'UTC')::date::text AS report_day, currency,
                  SUM(amount_minor)::text AS amount_minor, COUNT(*)::text AS payment_count
           FROM enough.integration_events
           WHERE product_id = $1 AND user_id = $2 AND verification_status = 'AUTHENTICATED'
             AND event_type = 'revenue.payment_received' AND amount_minor IS NOT NULL
             AND occurred_at >= $3 AND occurred_at < $4
           GROUP BY report_day, currency ORDER BY report_day, currency`,
          range,
        ),
        pool.query<CreditDayRow>(
          `SELECT (credit_tx.created_at AT TIME ZONE 'UTC')::date::text AS report_day,
                  COALESCE(SUM(credit_tx.amount) FILTER (WHERE credit_tx.action = 'EARN'), 0)::text AS earned,
                  COALESCE(SUM(credit_tx.amount) FILTER (WHERE credit_tx.action = 'SPEND'), 0)::text AS spent,
                  COALESCE(SUM(credit_tx.amount) FILTER (WHERE credit_tx.action = 'REFUND'), 0)::text AS refunded,
                  COALESCE(SUM(credit_tx.available_delta) FILTER (WHERE credit_tx.action = 'ADJUST'), 0)::text AS adjusted
           FROM enough.credit_accounts wallet
           JOIN enough.credit_transactions credit_tx ON credit_tx.account_id = wallet.id AND credit_tx.user_id = wallet.user_id
           WHERE wallet.product_id = $1 AND wallet.user_id = $2
             AND credit_tx.created_at >= $3 AND credit_tx.created_at < $4
           GROUP BY report_day ORDER BY report_day`,
          range,
        ),
        pool.query<{ report_day: string; completed: string; verified: string }>(
          `SELECT (completion.completed_at AT TIME ZONE 'UTC')::date::text AS report_day,
                  COUNT(*)::text AS completed,
                  (COUNT(*) FILTER (WHERE completion.verification_status IN ('VERIFIED', 'AUTOMATICALLY_VERIFIED')))::text AS verified
           FROM enough.growth_task_completions completion
           WHERE completion.product_id = $1 AND completion.user_id = $2
             AND completion.completed_at >= $3 AND completion.completed_at < $4
           GROUP BY report_day ORDER BY report_day`,
          range,
        ),
        pool.query<{
          id: string;
          from_stage: ProductStage | null;
          to_stage: ProductStage;
          changed_at: Date;
        }>(
          `SELECT history.id, history.from_stage, history.to_stage, history.changed_at
           FROM enough.product_stage_history history
           WHERE history.product_id = $1
           ORDER BY history.changed_at DESC LIMIT 100`,
          [product.id],
        ),
        pool.query<{ funnel_key: string; started: string; converted: string }>(
          `WITH linked_people AS (
             SELECT integration_account_id, user_reference_hash,
                    MIN(occurred_at) FILTER (WHERE event_type = 'email.outreach_sent') AS outreach_at,
                    MIN(occurred_at) FILTER (WHERE event_type = 'email.reply_received') AS reply_at,
                    MIN(occurred_at) FILTER (WHERE event_type = 'calendar.demo_completed') AS demo_at,
                    MIN(occurred_at) FILTER (WHERE event_type = 'analytics.user_signup') AS signup_at,
                    MIN(occurred_at) FILTER (WHERE event_type IN ('revenue.payment_received', 'revenue.subscription_created')) AS customer_at
             FROM enough.integration_events
             WHERE product_id = $1 AND user_id = $2 AND verification_status = 'AUTHENTICATED'
               AND user_reference_hash IS NOT NULL AND occurred_at >= $3 AND occurred_at < $4
             GROUP BY integration_account_id, user_reference_hash
           )
           SELECT 'outreach_reply' AS funnel_key,
                  COUNT(*) FILTER (WHERE outreach_at IS NOT NULL)::text AS started,
                  COUNT(*) FILTER (WHERE outreach_at IS NOT NULL AND reply_at >= outreach_at)::text AS converted
           FROM linked_people
           UNION ALL
           SELECT 'demo_signup', COUNT(*) FILTER (WHERE demo_at IS NOT NULL)::text,
                  COUNT(*) FILTER (WHERE demo_at IS NOT NULL AND signup_at >= demo_at)::text FROM linked_people
           UNION ALL
           SELECT 'signup_customer', COUNT(*) FILTER (WHERE signup_at IS NOT NULL)::text,
                  COUNT(*) FILTER (WHERE signup_at IS NOT NULL AND customer_at >= signup_at)::text FROM linked_people`,
          range,
        ),
        pool.query<{ completed: string; verified: string; awaiting_review: string }>(
          `SELECT COUNT(*)::text AS completed,
                  (COUNT(*) FILTER (WHERE verification_status IN ('VERIFIED', 'AUTOMATICALLY_VERIFIED')))::text AS verified,
                  (COUNT(*) FILTER (WHERE verification_status IN ('AWAITING_EVIDENCE', 'AWAITING_REVIEW')))::text AS awaiting_review
           FROM enough.growth_task_completions
           WHERE product_id = $1 AND user_id = $2 AND completed_at >= $3 AND completed_at < $4`,
          [product.id, session.id, weekStart, now],
        ),
        pool.query<{ title: string; signal_strength: number }>(
          `SELECT task.title, task.signal_strength
           FROM enough.growth_task_completions completion
           JOIN enough.growth_tasks task ON task.id = completion.task_id
           WHERE completion.product_id = $1 AND completion.user_id = $2
             AND completion.completed_at >= $3 AND completion.completed_at < $4
           ORDER BY task.signal_strength DESC, completion.completed_at DESC LIMIT 1`,
          [product.id, session.id, weekStart, now],
        ),
      ]);

      const activityByDay = new Map(activity.rows.map((row) => [row.report_day, row]));
      const signalsByDay = new Map(signals.rows.map((row) => [row.report_day, row]));
      const creditsByDay = new Map(credits.rows.map((row) => [row.report_day, row]));
      const completionsByDay = new Map(completions.rows.map((row) => [row.report_day, row]));
      const paymentsByDay = new Map<
        string,
        Array<{ currency: string; amountMinor: number; paymentCount: number }>
      >();
      for (const row of payments.rows) {
        const dayPayments = paymentsByDay.get(row.report_day) ?? [];
        dayPayments.push({
          currency: row.currency.trim(),
          amountMinor: safeInteger(row.amount_minor),
          paymentCount: safeInteger(row.payment_count),
        });
        paymentsByDay.set(row.report_day, dayPayments);
      }

      const days = utcDays(startAt, parsed.data.days).map((day) => {
        const activityDay = activityByDay.get(day);
        const signalDay = signalsByDay.get(day);
        const creditDay = creditsByDay.get(day);
        const completionDay = completionsByDay.get(day);
        const dailySignals = {
          outreach: safeInteger(signalDay?.outreach),
          replies: safeInteger(signalDay?.replies),
          interviews: safeInteger(signalDay?.interviews),
          demos: safeInteger(signalDay?.demos),
          feedbackCalls: safeInteger(signalDay?.feedback_calls),
          salesCalls: safeInteger(signalDay?.sales_calls),
          onboardingCalls: safeInteger(signalDay?.onboarding_calls),
          retentionCalls: safeInteger(signalDay?.retention_calls),
          signups: safeInteger(signalDay?.signups),
          activations: safeInteger(signalDay?.activations),
          retained: safeInteger(signalDay?.retained),
          payments: safeInteger(signalDay?.payments),
        };
        const marketSignals =
          dailySignals.replies +
          dailySignals.interviews +
          dailySignals.demos +
          dailySignals.feedbackCalls +
          dailySignals.salesCalls +
          dailySignals.onboardingCalls +
          dailySignals.retentionCalls +
          dailySignals.signups +
          dailySignals.activations +
          dailySignals.retained +
          dailySignals.payments;
        return {
          day,
          activityEvents: safeInteger(activityDay?.activity_events),
          buildSeconds: safeInteger(activityDay?.build_seconds),
          growSeconds: safeInteger(activityDay?.grow_seconds),
          marketSignals,
          signals: dailySignals,
          payments: paymentsByDay.get(day) ?? [],
          credits: {
            earned: safeInteger(creditDay?.earned),
            spent: safeInteger(creditDay?.spent),
            refunded: safeInteger(creditDay?.refunded),
            adjusted: safeInteger(creditDay?.adjusted),
          },
          tasksCompleted: safeInteger(completionDay?.completed),
          tasksVerified: safeInteger(completionDay?.verified),
        };
      });

      const week = days.slice(-7);
      const weekBuildSeconds = week.reduce((total, day) => total + day.buildSeconds, 0);
      const weekGrowSeconds = week.reduce((total, day) => total + day.growSeconds, 0);
      const weekMarketSignals = week.reduce((total, day) => total + day.marketSignals, 0);
      const weekCreditsEarned = week.reduce((total, day) => total + day.credits.earned, 0);
      const weekCreditsSpent = week.reduce((total, day) => total + day.credits.spent, 0);
      const weekTaskSummary = weeklyTasks.rows[0];
      const totalFocusSeconds = weekBuildSeconds + weekGrowSeconds;
      const buildShare =
        totalFocusSeconds > 0 ? Math.round((weekBuildSeconds / totalFocusSeconds) * 100) : null;
      const stageGuidance = PRODUCT_STAGE_GUIDANCE[product.product_stage];
      const recommendation =
        totalFocusSeconds === 0
          ? "No completed focus-session durations were recorded in the last seven UTC days. The Build/Grow split is unavailable; record a focus session or review this manually."
          : weekMarketSignals === 0
            ? `No market-signal events were recorded in the last seven UTC days. Consider this stage action: ${stageGuidance.priorities[0]}.`
            : buildShare !== null && buildShare > stageGuidance.buildPercent + 15
              ? `Recorded focus time was ${buildShare}% Build against stage guidance of ${stageGuidance.buildPercent}%. Consider pairing the next build session with: ${stageGuidance.priorities[0]}.`
              : "Recorded Build/Grow time and market-signal events are available for review. Compare the completed work with the customer signals you wanted to learn about.";

      const funnelLabels: Record<string, string> = {
        outreach_reply: "Outreach → reply",
        demo_signup: "Demo → signup",
        signup_customer: "Signup → payment or subscription event",
      };
      const conversionFunnels = funnels.rows.map((row) => {
        const started = safeInteger(row.started);
        const converted = safeInteger(row.converted);
        return {
          key: row.funnel_key,
          label: funnelLabels[row.funnel_key] ?? row.funnel_key,
          started,
          converted,
          conversionPercent: started > 0 ? Math.round((converted / started) * 1000) / 10 : null,
        };
      });

      return reply.send({
        product: {
          id: product.id,
          name: product.name,
          productStage: product.product_stage,
          productStageLabel: PRODUCT_STAGE_LABELS[product.product_stage],
          hasLaunched: product.has_launched,
          userCount: product.user_count,
          payingUserCount: product.paying_user_count,
          currentRevenue: product.current_revenue,
          revenueCurrency: product.revenue_currency.trim(),
        },
        period: {
          days: parsed.data.days,
          startDate: startAt.toISOString().slice(0, 10),
          endDate: now.toISOString().slice(0, 10),
          timezone: "UTC",
        },
        stageGuidance: {
          buildPercent: stageGuidance.buildPercent,
          marketPercent: stageGuidance.marketPercent,
          priorities: stageGuidance.priorities,
        },
        days,
        weeklyReview: {
          startDate: week[0]?.day ?? now.toISOString().slice(0, 10),
          endDate: now.toISOString().slice(0, 10),
          buildSeconds: weekBuildSeconds,
          growSeconds: weekGrowSeconds,
          buildShare,
          growShare: buildShare === null ? null : 100 - buildShare,
          marketSignals: weekMarketSignals,
          tasksCompleted: safeInteger(weekTaskSummary?.completed),
          tasksVerified: safeInteger(weekTaskSummary?.verified),
          tasksAwaitingReview: safeInteger(weekTaskSummary?.awaiting_review),
          creditsEarned: weekCreditsEarned,
          creditsSpent: weekCreditsSpent,
          highestSignalTask: highestSignalTask.rows[0]
            ? {
                title: highestSignalTask.rows[0].title,
                signalStrength: highestSignalTask.rows[0].signal_strength,
              }
            : null,
          recommendation,
        },
        conversionFunnels,
        stageHistory: stages.rows.map((row) => ({
          id: row.id,
          fromStage: row.from_stage,
          fromStageLabel: row.from_stage ? PRODUCT_STAGE_LABELS[row.from_stage] : null,
          toStage: row.to_stage,
          toStageLabel: PRODUCT_STAGE_LABELS[row.to_stage],
          changedAt: row.changed_at.toISOString(),
        })),
        trustNotes: [
          "Build/Grow time is derived from reported focus.session_ended durations, limited to six hours per event; active or unreported sessions may be missing.",
          "Market signals and funnel counts come from authenticated integration events. A valid signature shows control of the configured source, not independent vendor verification.",
          "Funnel conversion uses anonymous references only when the same integration account supplies them; unlinked events are excluded from conversion percentages.",
          "Credit values summarize the product wallet ledger. Manual earn and adjustment controls are prototype controls.",
        ],
      });
    } catch (error) {
      request.log.error({ err: error }, "Could not build product report");
      return reply.code(503).send({ error: "The report is temporarily unavailable." });
    }
  });
}
