import { randomUUID } from "node:crypto";
import type { AuthSession } from "@enough/auth";
import { checkRateLimit } from "@enough/auth";
import { checkRedis } from "@enough/cache";
import { env } from "@enough/config";
import { checkDatabase, type DbClient, pool } from "@enough/db";
import { createMainQueue } from "@enough/queue";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireCsrf, requireSession } from "./api-auth.js";

type AdminRole = "ADMIN" | "SUPPORT";
type AdminAccess = AuthSession & { role: AdminRole };

const uuidSchema = z.string().uuid();
const configuredAdmins = () =>
  new Set(
    env.ADMIN_EMAILS.split(",")
      .map((email) => email.trim().toLocaleLowerCase())
      .filter(Boolean),
  );

async function checkHttpService(url: string): Promise<"ok" | "unavailable"> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500), redirect: "error" });
    return response.ok ? "ok" : "unavailable";
  } catch {
    return "unavailable";
  }
}

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AdminAccess | null> {
  const session = await requireSession(request, reply);
  if (!session) return null;
  if (!session.emailVerifiedAt) {
    reply.code(403).send({ error: "Admin Console access requires a verified email address." });
    return null;
  }
  try {
    const result = await pool.query<{ role: AdminRole }>(
      "SELECT role FROM enough.admin_roles WHERE user_id = $1",
      [session.id],
    );
    const role = configuredAdmins().has(session.email.trim().toLocaleLowerCase())
      ? "ADMIN"
      : (result.rows[0]?.role ?? null);
    if (!role) {
      reply.code(403).send({ error: "Admin Console access is not enabled for this account." });
      return null;
    }
    return { ...session, role };
  } catch (error) {
    request.log.error({ err: error }, "Could not verify admin access");
    reply.code(503).send({ error: "Admin access is temporarily unavailable." });
    return null;
  }
}

async function requireAdminRole(
  request: FastifyRequest,
  reply: FastifyReply,
  role: AdminRole,
): Promise<AdminAccess | null> {
  const access = await requireAdmin(request, reply);
  if (access && access.role !== role) {
    reply.code(403).send({ error: "This support action requires an administrator account." });
    return null;
  }
  return access;
}

async function audit(
  client: DbClient,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await client.query(
    `INSERT INTO enough.admin_audit_events (id, actor_user_id, action, target_type, target_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [randomUUID(), actorId, action, targetType, targetId, JSON.stringify(metadata)],
  );
}

async function transaction<T>(operation: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function reportError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
  message: string,
) {
  request.log.error({ err: error }, "Admin Console operation failed");
  return reply.code(503).send({ error: message });
}

async function allowRead(
  request: FastifyRequest,
  reply: FastifyReply,
  key: string,
  access: AdminAccess,
): Promise<boolean> {
  return checkRateLimit(request, reply, `admin:${key}`, access.id, 120, 60);
}

async function allowWrite(
  request: FastifyRequest,
  reply: FastifyReply,
  key: string,
  access: AdminAccess,
): Promise<boolean> {
  if (!requireCsrf(request, reply, access)) return false;
  return checkRateLimit(request, reply, `admin:${key}`, access.id, 30, 60);
}

const userSearchSchema = z.object({ q: z.string().trim().max(120).optional() });
const featureFlagSchema = z
  .object({
    key: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9_.-]{1,79}$/),
    description: z.string().trim().min(2).max(500),
    enabled: z.boolean().default(false),
    rolloutPercent: z.number().int().min(0).max(100).default(100),
    configuration: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
const featureFlagPatchSchema = z
  .object({
    description: z.string().trim().min(2).max(500).optional(),
    enabled: z.boolean().optional(),
    rolloutPercent: z.number().int().min(0).max(100).optional(),
    configuration: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Change at least one flag setting.");
const growthTemplateSchema = z
  .object({
    id: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9_-]{2,79}$/),
    productStage: z.enum([
      "IDEA",
      "PROBLEM_VALIDATION",
      "SOLUTION_VALIDATION",
      "PRE_LAUNCH",
      "LAUNCHED_ZERO_USERS",
      "EARLY_USERS",
      "FIRST_REVENUE",
      "PRODUCT_MARKET_SIGNAL",
      "GROWTH",
    ]),
    title: z.string().trim().min(2).max(250),
    priority: z.number().int().min(1).max(5),
    signalStrength: z.number().int().min(1).max(5),
    estimatedMinutes: z.number().int().min(5).max(600),
    defaultRewardCredits: z.number().int().min(0).max(10000),
    isActive: z.boolean().default(true),
  })
  .strict();
const growthTemplatePatchSchema = growthTemplateSchema
  .omit({ id: true, productStage: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Change at least one template setting.");
const ruleTemplateSchema = z
  .object({
    id: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9_-]{2,79}$/),
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().min(2).max(500),
    action: z.enum(["ALLOW", "BLOCK", "WARN", "REQUIRE_OVERRIDE"]),
    priority: z.number().int().min(-10000).max(10000),
    conditions: z.record(z.string(), z.unknown()).default({}),
    schedule: z.record(z.string(), z.unknown()).nullable().default(null),
    isActive: z.boolean().default(true),
  })
  .strict();
const ruleTemplatePatchSchema = ruleTemplateSchema
  .omit({ id: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Change at least one template setting.");
const adminRoleSchema = z.object({ role: z.enum(["ADMIN", "SUPPORT"]).nullable() }).strict();

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/me", async (request, reply) => {
    const access = await requireAdmin(request, reply);
    if (!access) return;
    if (!(await allowRead(request, reply, "me", access))) return;
    return reply.send({ user: { id: access.id, email: access.email }, role: access.role });
  });

  app.get("/admin/dashboard", async (request, reply) => {
    const access = await requireAdmin(request, reply);
    if (!access || !(await allowRead(request, reply, "dashboard", access))) return;
    try {
      const [counts, database, redis, web, worker] = await Promise.all([
        pool.query<{
          users: string;
          subscriptions: string;
          activeSubscriptions: string;
          devices: string;
          activeIntegrations: string;
          failedIntegrations: string;
          aiRequests30d: string;
        }>(
          `SELECT
             (SELECT count(*) FROM enough.auth_users) AS users,
             (SELECT count(*) FROM enough.billing_subscriptions) AS subscriptions,
             (SELECT count(*) FROM enough.billing_subscriptions WHERE status IN ('active','trialing','past_due','paused')) AS "activeSubscriptions",
             (SELECT count(*) FROM enough.auth_devices WHERE revoked_at IS NULL) AS devices,
             (SELECT count(*) FROM enough.integration_accounts WHERE status = 'ACTIVE') AS "activeIntegrations",
             (SELECT count(*) FROM enough.integration_accounts WHERE status = 'ERROR') AS "failedIntegrations",
             (SELECT count(*) FROM enough.admin_ai_usage_events WHERE created_at >= now() - interval '30 days') AS "aiRequests30d"`,
        ),
        checkDatabase(),
        checkRedis(),
        checkHttpService(`http://127.0.0.1:${env.WEB_PORT}/api/ready`),
        checkHttpService(`http://127.0.0.1:${env.WORKER_PORT}/ready`),
      ]);
      let queueHealth: "ok" | "unavailable" = "ok";
      let jobCounts: Record<string, number> = {};
      const queue = createMainQueue();
      try {
        jobCounts = await queue.getJobCounts("waiting", "active", "delayed", "failed", "paused");
      } catch {
        queueHealth = "unavailable";
      } finally {
        await queue.close();
      }
      return reply.send({
        counts: Object.fromEntries(
          Object.entries(counts.rows[0] ?? {}).map(([key, value]) => [key, Number(value)]),
        ),
        health: {
          web,
          api: "ok",
          worker,
          database: database ? "ok" : "unavailable",
          redis: redis ? "ok" : "unavailable",
          queue: queueHealth,
        },
        jobs: jobCounts,
        configuration: {
          openAiConfigured: Boolean(env.OPENAI_API_KEY),
          stripeConfigured: Boolean(env.STRIPE_SECRET_KEY),
          emailConfigured: Boolean(env.RESEND_API_KEY),
        },
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      return reportError(request, reply, error, "Admin overview is temporarily unavailable.");
    }
  });

  app.get("/admin/users", async (request, reply) => {
    const access = await requireAdmin(request, reply);
    if (!access || !(await allowRead(request, reply, "users", access))) return;
    const parsed = userSearchSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Search text is too long." });
    const bootstrapEmails = [...configuredAdmins()];
    try {
      const result = await pool.query(
        `SELECT u.id, u.email, u.display_name AS "displayName", u.email_verified_at AS "emailVerifiedAt",
                u.created_at AS "createdAt",
                CASE WHEN lower(u.email) = ANY($2::text[]) THEN 'ADMIN' ELSE r.role END AS "adminRole",
                (SELECT count(*)::int FROM enough.auth_devices d WHERE d.user_id = u.id AND d.revoked_at IS NULL) AS "activeDevices",
                (SELECT s.status FROM enough.billing_subscriptions s WHERE s.user_id = u.id ORDER BY s.updated_at DESC LIMIT 1) AS "subscriptionStatus"
         FROM enough.auth_users u LEFT JOIN enough.admin_roles r ON r.user_id = u.id
         WHERE ($1 = '' OR u.email ILIKE '%' || $1 || '%' OR COALESCE(u.display_name, '') ILIKE '%' || $1 || '%')
         ORDER BY u.created_at DESC LIMIT 100`,
        [parsed.data.q ?? "", bootstrapEmails],
      );
      return reply.send({ users: result.rows });
    } catch (error) {
      return reportError(request, reply, error, "Users could not be loaded.");
    }
  });

  app.get("/admin/users/:userId", async (request, reply) => {
    const access = await requireAdmin(request, reply);
    if (!access || !(await allowRead(request, reply, "user-detail", access))) return;
    const userId = uuidSchema.safeParse((request.params as { userId?: string }).userId);
    if (!userId.success) return reply.code(400).send({ error: "Invalid user ID." });
    try {
      const [user, devices, subscriptions, integrations, aiUsage] = await Promise.all([
        pool.query(
          `SELECT id, email, display_name AS "displayName", email_verified_at AS "emailVerifiedAt", created_at AS "createdAt" FROM enough.auth_users WHERE id = $1`,
          [userId.data],
        ),
        pool.query(
          `SELECT id, name, client_type AS "clientType", created_at AS "createdAt", last_seen_at AS "lastSeenAt", revoked_at AS "revokedAt" FROM enough.auth_devices WHERE user_id = $1 ORDER BY last_seen_at DESC LIMIT 50`,
          [userId.data],
        ),
        pool.query(
          `SELECT stripe_subscription_id AS id, plan_key AS "planKey", status, currency, billing_interval AS "billingInterval", current_period_end AS "currentPeriodEnd", cancel_at_period_end AS "cancelAtPeriodEnd", updated_at AS "updatedAt" FROM enough.billing_subscriptions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 20`,
          [userId.data],
        ),
        pool.query(
          `SELECT id, product_id AS "productId", provider, display_name AS "displayName", status, last_received_at AS "lastReceivedAt", created_at AS "createdAt", (SELECT count(*)::int FROM enough.integration_errors e WHERE e.integration_account_id = a.id) AS "errorCount" FROM enough.integration_accounts a WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
          [userId.data],
        ),
        pool.query(
          `SELECT capability, status, model, input_tokens AS "inputTokens", output_tokens AS "outputTokens", latency_ms AS "latencyMs", created_at AS "createdAt" FROM enough.admin_ai_usage_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`,
          [userId.data],
        ),
      ]);
      if (!user.rows[0]) return reply.code(404).send({ error: "User not found." });
      return reply.send({
        user: user.rows[0],
        devices: devices.rows,
        subscriptions: subscriptions.rows,
        integrations: integrations.rows,
        aiUsage: aiUsage.rows,
      });
    } catch (error) {
      return reportError(request, reply, error, "User details could not be loaded.");
    }
  });

  app.patch("/admin/users/:userId/role", async (request, reply) => {
    const access = await requireAdminRole(request, reply, "ADMIN");
    if (!access || !(await allowWrite(request, reply, "user-role", access))) return;
    const userId = uuidSchema.safeParse((request.params as { userId?: string }).userId);
    const input = adminRoleSchema.safeParse(request.body);
    if (!userId.success || !input.success)
      return reply.code(400).send({ error: "Choose a valid user and admin role." });
    if (userId.data === access.id && input.data.role !== "ADMIN")
      return reply.code(409).send({ error: "You cannot remove your own administrator access." });
    try {
      const target = await pool.query<{ email: string; email_verified_at: Date | null }>(
        "SELECT email, email_verified_at FROM enough.auth_users WHERE id = $1",
        [userId.data],
      );
      if (!target.rows[0]) return reply.code(404).send({ error: "User not found." });
      if (input.data.role && !target.rows[0].email_verified_at)
        return reply
          .code(409)
          .send({ error: "Verify the user's email before granting admin access." });
      if (
        configuredAdmins().has(target.rows[0].email.trim().toLocaleLowerCase()) &&
        input.data.role !== "ADMIN"
      ) {
        return reply.code(409).send({
          error: "Remove this address from ADMIN_EMAILS before changing its administrator access.",
        });
      }
      const result = await transaction(async (client) => {
        const target = await client.query(
          "SELECT id FROM enough.auth_users WHERE id = $1 FOR UPDATE",
          [userId.data],
        );
        if (target.rowCount !== 1) return false;
        if (input.data.role) {
          await client.query(
            `INSERT INTO enough.admin_roles (user_id, role, granted_by)
             VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, created_at = now()`,
            [userId.data, input.data.role, access.id],
          );
        } else {
          const admins = await client.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM enough.admin_roles WHERE role = 'ADMIN' AND user_id <> $1",
            [userId.data],
          );
          const current = await client.query<{ role: AdminRole | null }>(
            "SELECT role FROM enough.admin_roles WHERE user_id = $1",
            [userId.data],
          );
          if (
            current.rows[0]?.role === "ADMIN" &&
            Number(admins.rows[0]?.count ?? 0) === 0 &&
            configuredAdmins().size === 0
          ) {
            throw new Error("At least one administrator must remain.");
          }
          await client.query("DELETE FROM enough.admin_roles WHERE user_id = $1", [userId.data]);
        }
        await audit(
          client,
          access.id,
          input.data.role ? "admin.user_role_changed" : "admin.user_role_removed",
          "user",
          userId.data,
          { role: input.data.role },
        );
        return true;
      });
      return result
        ? reply.send({ userId: userId.data, role: input.data.role })
        : reply.code(404).send({ error: "User not found." });
    } catch (error) {
      return reportError(request, reply, error, "The user role could not be changed.");
    }
  });

  app.post("/admin/users/:userId/revoke-sessions", async (request, reply) => {
    const access = await requireAdmin(request, reply);
    if (!access || !(await allowWrite(request, reply, "revoke-sessions", access))) return;
    const userId = uuidSchema.safeParse((request.params as { userId?: string }).userId);
    if (!userId.success) return reply.code(400).send({ error: "Invalid user ID." });
    if (userId.data === access.id)
      return reply.code(409).send({ error: "Use account settings to manage your own sessions." });
    try {
      const revoked = await transaction(async (client) => {
        const result = await client.query(
          "UPDATE enough.auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
          [userId.data],
        );
        await audit(client, access.id, "admin.user_sessions_revoked", "user", userId.data, {
          count: result.rowCount ?? 0,
        });
        return result.rowCount ?? 0;
      });
      return reply.send({ userId: userId.data, revokedSessions: revoked });
    } catch (error) {
      return reportError(request, reply, error, "User sessions could not be revoked.");
    }
  });

  app.get("/admin/subscriptions", async (request, reply) => {
    const access = await requireAdmin(request, reply);
    if (!access || !(await allowRead(request, reply, "subscriptions", access))) return;
    try {
      const result = await pool.query(
        `SELECT s.stripe_subscription_id AS id, s.user_id AS "userId", u.email, s.plan_key AS "planKey", s.status,
                s.currency, s.billing_interval AS "billingInterval", s.unit_amount_minor AS "unitAmountMinor",
                s.trial_end AS "trialEnd", s.current_period_end AS "currentPeriodEnd", s.cancel_at_period_end AS "cancelAtPeriodEnd",
                s.grace_until AS "graceUntil", s.updated_at AS "updatedAt"
         FROM enough.billing_subscriptions s JOIN enough.auth_users u ON u.id = s.user_id
         ORDER BY s.updated_at DESC LIMIT 200`,
      );
      return reply.send({ subscriptions: result.rows });
    } catch (error) {
      return reportError(request, reply, error, "Subscriptions could not be loaded.");
    }
  });

  app.get("/admin/devices", async (request, reply) => {
    const access = await requireAdmin(request, reply);
    if (!access || !(await allowRead(request, reply, "devices", access))) return;
    try {
      const result = await pool.query(
        `SELECT d.id, d.user_id AS "userId", u.email, d.name, d.client_type AS "clientType", d.created_at AS "createdAt", d.last_seen_at AS "lastSeenAt", d.revoked_at AS "revokedAt"
         FROM enough.auth_devices d JOIN enough.auth_users u ON u.id = d.user_id ORDER BY d.last_seen_at DESC LIMIT 300`,
      );
      return reply.send({ devices: result.rows });
    } catch (error) {
      return reportError(request, reply, error, "Devices could not be loaded.");
    }
  });

  app.post("/admin/devices/:deviceId/revoke", async (request, reply) => {
    const access = await requireAdmin(request, reply);
    if (!access || !(await allowWrite(request, reply, "revoke-device", access))) return;
    const deviceId = uuidSchema.safeParse((request.params as { deviceId?: string }).deviceId);
    if (!deviceId.success) return reply.code(400).send({ error: "Invalid device ID." });
    if (deviceId.data === access.deviceId)
      return reply
        .code(409)
        .send({ error: "You cannot revoke the device used by your current admin session." });
    try {
      const changed = await transaction(async (client) => {
        const device = await client.query<{ user_id: string }>(
          "SELECT user_id FROM enough.auth_devices WHERE id = $1 FOR UPDATE",
          [deviceId.data],
        );
        if (!device.rows[0]) return false;
        await client.query(
          "UPDATE enough.auth_devices SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1",
          [deviceId.data],
        );
        await client.query(
          "UPDATE enough.auth_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE device_id = $1 AND revoked_at IS NULL",
          [deviceId.data],
        );
        await audit(client, access.id, "admin.device_revoked", "device", deviceId.data, {
          userId: device.rows[0].user_id,
        });
        return true;
      });
      return changed
        ? reply.send({ deviceId: deviceId.data, revoked: true })
        : reply.code(404).send({ error: "Device not found." });
    } catch (error) {
      return reportError(request, reply, error, "The device could not be revoked.");
    }
  });

  app.get("/admin/integrations", async (request, reply) => {
    const access = await requireAdmin(request, reply);
    if (!access || !(await allowRead(request, reply, "integrations", access))) return;
    try {
      const result = await pool.query(
        `SELECT a.id, a.user_id AS "userId", u.email, a.product_id AS "productId", a.provider,
                a.display_name AS "displayName", a.status, a.last_received_at AS "lastReceivedAt", a.created_at AS "createdAt",
                (SELECT count(*)::int FROM enough.integration_errors e WHERE e.integration_account_id = a.id) AS "errorCount",
                (SELECT e.safe_message FROM enough.integration_errors e WHERE e.integration_account_id = a.id ORDER BY e.created_at DESC LIMIT 1) AS "latestError"
         FROM enough.integration_accounts a JOIN enough.auth_users u ON u.id = a.user_id ORDER BY a.updated_at DESC LIMIT 300`,
      );
      return reply.send({ integrations: result.rows });
    } catch (error) {
      return reportError(request, reply, error, "Integrations could not be loaded.");
    }
  });

  app.post("/admin/integrations/:integrationId/revoke", async (request, reply) => {
    const access = await requireAdmin(request, reply);
    if (!access || !(await allowWrite(request, reply, "revoke-integration", access))) return;
    const integrationId = uuidSchema.safeParse(
      (request.params as { integrationId?: string }).integrationId,
    );
    if (!integrationId.success) return reply.code(400).send({ error: "Invalid integration ID." });
    try {
      const changed = await transaction(async (client) => {
        const found = await client.query<{ id: string; user_id: string; status: string }>(
          "SELECT id, user_id, status FROM enough.integration_accounts WHERE id = $1 FOR UPDATE",
          [integrationId.data],
        );
        const integration = found.rows[0];
        if (!integration) return false;
        if (integration.status !== "REVOKED") {
          await client.query(
            `UPDATE enough.integration_accounts SET status = 'REVOKED', api_key_hash = NULL,
             signing_secret_ciphertext = NULL, revoked_at = now(), updated_at = now() WHERE id = $1`,
            [integration.id],
          );
          await client.query(
            "DELETE FROM enough.integration_tokens WHERE integration_account_id = $1",
            [integration.id],
          );
        }
        await audit(client, access.id, "admin.integration_revoked", "integration", integration.id, {
          userId: integration.user_id,
        });
        return true;
      });
      return changed
        ? reply.send({ integrationId: integrationId.data, status: "REVOKED" })
        : reply.code(404).send({ error: "Integration not found." });
    } catch (error) {
      return reportError(request, reply, error, "The integration could not be revoked.");
    }
  });

  app.get("/admin/jobs", async (request, reply) => {
    const access = await requireAdmin(request, reply);
    if (!access || !(await allowRead(request, reply, "jobs", access))) return;
    const queue = createMainQueue();
    try {
      const jobs = await queue.getJobs(["failed"], 0, 49, true);
      return reply.send({
        jobs: jobs.map((job) => ({
          id: job.id,
          name: job.name,
          attemptsMade: job.attemptsMade,
          failedReason: String(job.failedReason ?? "Job failed.")
            .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
            .replace(/(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+/g, "[redacted]")
            .slice(0, 300),
          timestamp: job.timestamp,
          processedOn: job.processedOn ?? null,
          finishedOn: job.finishedOn ?? null,
        })),
      });
    } catch (error) {
      return reportError(request, reply, error, "Failed jobs could not be loaded.");
    } finally {
      await queue.close();
    }
  });

  app.post("/admin/jobs/:jobId/retry", async (request, reply) => {
    const access = await requireAdmin(request, reply);
    if (!access || !(await allowWrite(request, reply, "retry-job", access))) return;
    const jobId = z
      .string()
      .min(1)
      .max(200)
      .safeParse((request.params as { jobId?: string }).jobId);
    if (!jobId.success) return reply.code(400).send({ error: "Invalid job ID." });
    const queue = createMainQueue();
    try {
      const job = await queue.getJob(jobId.data);
      if (!job) return reply.code(404).send({ error: "Job not found." });
      if ((await job.getState()) !== "failed")
        return reply.code(409).send({ error: "Only failed jobs can be retried." });
      await job.retry("failed");
      await transaction((client) =>
        audit(client, access.id, "admin.job_retried", "job", jobId.data, { name: job.name }),
      );
      return reply.send({ jobId: jobId.data, retried: true });
    } catch (error) {
      return reportError(request, reply, error, "The failed job could not be retried.");
    } finally {
      await queue.close();
    }
  });

  app.get("/admin/growth-templates", async (request, reply) => {
    const access = await requireAdmin(request, reply);
    if (!access || !(await allowRead(request, reply, "growth-templates", access))) return;
    try {
      const result = await pool.query(
        `SELECT id, product_stage AS "productStage", title, priority, signal_strength AS "signalStrength",
                estimated_minutes AS "estimatedMinutes", default_reward_credits AS "defaultRewardCredits", is_active AS "isActive", created_at AS "createdAt"
         FROM enough.growth_task_templates ORDER BY product_stage, priority DESC, id`,
      );
      return reply.send({ templates: result.rows });
    } catch (error) {
      return reportError(request, reply, error, "Growth templates could not be loaded.");
    }
  });

  app.post("/admin/growth-templates", async (request, reply) => {
    const access = await requireAdminRole(request, reply, "ADMIN");
    if (!access || !(await allowWrite(request, reply, "create-growth-template", access))) return;
    const input = growthTemplateSchema.safeParse(request.body);
    if (!input.success)
      return reply
        .code(400)
        .send({ error: input.error.issues[0]?.message ?? "Review the growth template." });
    try {
      const row = await transaction(async (client) => {
        const saved = await client.query(
          `INSERT INTO enough.growth_task_templates (id, product_stage, title, priority, signal_strength, estimated_minutes, default_reward_credits, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, product_stage AS "productStage", title, priority, signal_strength AS "signalStrength", estimated_minutes AS "estimatedMinutes", default_reward_credits AS "defaultRewardCredits", is_active AS "isActive"`,
          [
            input.data.id,
            input.data.productStage,
            input.data.title,
            input.data.priority,
            input.data.signalStrength,
            input.data.estimatedMinutes,
            input.data.defaultRewardCredits,
            input.data.isActive,
          ],
        );
        await audit(
          client,
          access.id,
          "admin.growth_template_created",
          "growth_template",
          input.data.id,
          { stage: input.data.productStage },
        );
        return saved.rows[0];
      });
      return reply.code(201).send({ template: row });
    } catch (error) {
      return reportError(
        request,
        reply,
        error,
        "The growth template could not be created. Check that its ID is unique.",
      );
    }
  });

  app.patch("/admin/growth-templates/:templateId", async (request, reply) => {
    const access = await requireAdminRole(request, reply, "ADMIN");
    if (!access || !(await allowWrite(request, reply, "update-growth-template", access))) return;
    const templateId = z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{2,79}$/)
      .safeParse((request.params as { templateId?: string }).templateId);
    const input = growthTemplatePatchSchema.safeParse(request.body);
    if (!templateId.success || !input.success)
      return reply.code(400).send({
        error: input.success
          ? "Invalid template ID."
          : (input.error.issues[0]?.message ?? "Review the template changes."),
      });
    try {
      const result = await transaction(async (client) => {
        const saved = await client.query(
          `UPDATE enough.growth_task_templates SET
             title = COALESCE($2, title), priority = COALESCE($3, priority), signal_strength = COALESCE($4, signal_strength),
             estimated_minutes = COALESCE($5, estimated_minutes), default_reward_credits = COALESCE($6, default_reward_credits),
             is_active = COALESCE($7, is_active)
           WHERE id = $1
           RETURNING id, product_stage AS "productStage", title, priority, signal_strength AS "signalStrength", estimated_minutes AS "estimatedMinutes", default_reward_credits AS "defaultRewardCredits", is_active AS "isActive"`,
          [
            templateId.data,
            input.data.title ?? null,
            input.data.priority ?? null,
            input.data.signalStrength ?? null,
            input.data.estimatedMinutes ?? null,
            input.data.defaultRewardCredits ?? null,
            input.data.isActive ?? null,
          ],
        );
        if (saved.rows[0])
          await audit(
            client,
            access.id,
            "admin.growth_template_updated",
            "growth_template",
            templateId.data,
            { changedFields: Object.keys(input.data) },
          );
        return saved.rows[0];
      });
      return result
        ? reply.send({ template: result })
        : reply.code(404).send({ error: "Growth template not found." });
    } catch (error) {
      return reportError(request, reply, error, "The growth template could not be updated.");
    }
  });

  app.get("/admin/rule-templates", async (request, reply) => {
    const access = await requireAdmin(request, reply);
    if (!access || !(await allowRead(request, reply, "rule-templates", access))) return;
    try {
      const result = await pool.query(
        `SELECT id, name, description, action, priority, conditions, schedule, is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"
         FROM enough.admin_rule_templates ORDER BY is_active DESC, name`,
      );
      return reply.send({ templates: result.rows });
    } catch (error) {
      return reportError(request, reply, error, "Rule templates could not be loaded.");
    }
  });

  app.post("/admin/rule-templates", async (request, reply) => {
    const access = await requireAdminRole(request, reply, "ADMIN");
    if (!access || !(await allowWrite(request, reply, "create-rule-template", access))) return;
    const input = ruleTemplateSchema.safeParse(request.body);
    if (!input.success)
      return reply
        .code(400)
        .send({ error: input.error.issues[0]?.message ?? "Review the rule template." });
    try {
      const row = await transaction(async (client) => {
        const saved = await client.query(
          `INSERT INTO enough.admin_rule_templates (id, name, description, action, priority, conditions, schedule, is_active, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $9)
           RETURNING id, name, description, action, priority, conditions, schedule, is_active AS "isActive"`,
          [
            input.data.id,
            input.data.name,
            input.data.description,
            input.data.action,
            input.data.priority,
            JSON.stringify(input.data.conditions),
            input.data.schedule === null ? null : JSON.stringify(input.data.schedule),
            input.data.isActive,
            access.id,
          ],
        );
        await audit(
          client,
          access.id,
          "admin.rule_template_created",
          "rule_template",
          input.data.id,
          { action: input.data.action },
        );
        return saved.rows[0];
      });
      return reply.code(201).send({ template: row });
    } catch (error) {
      return reportError(
        request,
        reply,
        error,
        "The rule template could not be created. Check that its ID is unique.",
      );
    }
  });

  app.patch("/admin/rule-templates/:templateId", async (request, reply) => {
    const access = await requireAdminRole(request, reply, "ADMIN");
    if (!access || !(await allowWrite(request, reply, "update-rule-template", access))) return;
    const templateId = z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{2,79}$/)
      .safeParse((request.params as { templateId?: string }).templateId);
    const input = ruleTemplatePatchSchema.safeParse(request.body);
    if (!templateId.success || !input.success)
      return reply.code(400).send({
        error: input.success
          ? "Invalid template ID."
          : (input.error.issues[0]?.message ?? "Review the rule template changes."),
      });
    try {
      const row = await transaction(async (client) => {
        const saved = await client.query(
          `UPDATE enough.admin_rule_templates SET name = COALESCE($2, name), description = COALESCE($3, description),
             action = COALESCE($4, action), priority = COALESCE($5, priority),
             conditions = COALESCE($6::jsonb, conditions), schedule = CASE WHEN $7::boolean THEN $8::jsonb ELSE schedule END,
             is_active = COALESCE($9, is_active), updated_by = $10, updated_at = now()
           WHERE id = $1 RETURNING id, name, description, action, priority, conditions, schedule, is_active AS "isActive"`,
          [
            templateId.data,
            input.data.name ?? null,
            input.data.description ?? null,
            input.data.action ?? null,
            input.data.priority ?? null,
            input.data.conditions === undefined ? null : JSON.stringify(input.data.conditions),
            input.data.schedule !== undefined,
            input.data.schedule === undefined || input.data.schedule === null
              ? null
              : JSON.stringify(input.data.schedule),
            input.data.isActive ?? null,
            access.id,
          ],
        );
        if (saved.rows[0])
          await audit(
            client,
            access.id,
            "admin.rule_template_updated",
            "rule_template",
            templateId.data,
            { changedFields: Object.keys(input.data) },
          );
        return saved.rows[0];
      });
      return row
        ? reply.send({ template: row })
        : reply.code(404).send({ error: "Rule template not found." });
    } catch (error) {
      return reportError(request, reply, error, "The rule template could not be updated.");
    }
  });

  app.get("/admin/feature-flags", async (request, reply) => {
    const access = await requireAdmin(request, reply);
    if (!access || !(await allowRead(request, reply, "feature-flags", access))) return;
    try {
      const result = await pool.query(
        `SELECT flag_key AS key, description, enabled, rollout_percent AS "rolloutPercent", configuration, updated_at AS "updatedAt" FROM enough.admin_feature_flags ORDER BY flag_key`,
      );
      const flags =
        access.role === "ADMIN"
          ? result.rows
          : result.rows.map((flag) => ({
              key: flag.key,
              description: flag.description,
              enabled: flag.enabled,
              rolloutPercent: flag.rolloutPercent,
              updatedAt: flag.updatedAt,
            }));
      return reply.send({ flags });
    } catch (error) {
      return reportError(request, reply, error, "Feature flags could not be loaded.");
    }
  });

  app.post("/admin/feature-flags", async (request, reply) => {
    const access = await requireAdminRole(request, reply, "ADMIN");
    if (!access || !(await allowWrite(request, reply, "create-feature-flag", access))) return;
    const input = featureFlagSchema.safeParse(request.body);
    if (!input.success)
      return reply
        .code(400)
        .send({ error: input.error.issues[0]?.message ?? "Review the feature flag." });
    try {
      const row = await transaction(async (client) => {
        const saved = await client.query(
          `INSERT INTO enough.admin_feature_flags (flag_key, description, enabled, rollout_percent, configuration, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $6)
           ON CONFLICT (flag_key) DO UPDATE SET description = EXCLUDED.description, enabled = EXCLUDED.enabled,
             rollout_percent = EXCLUDED.rollout_percent, configuration = EXCLUDED.configuration, updated_by = EXCLUDED.updated_by, updated_at = now()
           RETURNING flag_key AS key, description, enabled, rollout_percent AS "rolloutPercent", configuration, updated_at AS "updatedAt"`,
          [
            input.data.key,
            input.data.description,
            input.data.enabled,
            input.data.rolloutPercent,
            JSON.stringify(input.data.configuration),
            access.id,
          ],
        );
        await audit(client, access.id, "admin.feature_flag_saved", "feature_flag", input.data.key, {
          enabled: input.data.enabled,
          rolloutPercent: input.data.rolloutPercent,
        });
        return saved.rows[0];
      });
      return reply.send({ flag: row });
    } catch (error) {
      return reportError(request, reply, error, "The feature flag could not be saved.");
    }
  });

  app.patch("/admin/feature-flags/:flagKey", async (request, reply) => {
    const access = await requireAdminRole(request, reply, "ADMIN");
    if (!access || !(await allowWrite(request, reply, "update-feature-flag", access))) return;
    const key = z
      .string()
      .regex(/^[a-z][a-z0-9_.-]{1,79}$/)
      .safeParse((request.params as { flagKey?: string }).flagKey);
    const input = featureFlagPatchSchema.safeParse(request.body);
    if (!key.success || !input.success)
      return reply.code(400).send({
        error: input.success
          ? "Invalid flag key."
          : (input.error.issues[0]?.message ?? "Review the flag changes."),
      });
    try {
      const row = await transaction(async (client) => {
        const saved = await client.query(
          `UPDATE enough.admin_feature_flags SET description = COALESCE($2, description), enabled = COALESCE($3, enabled),
             rollout_percent = COALESCE($4, rollout_percent), configuration = COALESCE($5::jsonb, configuration), updated_by = $6, updated_at = now()
           WHERE flag_key = $1 RETURNING flag_key AS key, description, enabled, rollout_percent AS "rolloutPercent", configuration, updated_at AS "updatedAt"`,
          [
            key.data,
            input.data.description ?? null,
            input.data.enabled ?? null,
            input.data.rolloutPercent ?? null,
            input.data.configuration === undefined
              ? null
              : JSON.stringify(input.data.configuration),
            access.id,
          ],
        );
        if (saved.rows[0])
          await audit(client, access.id, "admin.feature_flag_updated", "feature_flag", key.data, {
            changedFields: Object.keys(input.data),
          });
        return saved.rows[0];
      });
      return row
        ? reply.send({ flag: row })
        : reply.code(404).send({ error: "Feature flag not found." });
    } catch (error) {
      return reportError(request, reply, error, "The feature flag could not be updated.");
    }
  });

  app.get("/admin/ai-usage", async (request, reply) => {
    const access = await requireAdmin(request, reply);
    if (!access || !(await allowRead(request, reply, "ai-usage", access))) return;
    try {
      const [summary, recent] = await Promise.all([
        pool.query(`SELECT count(*)::int AS requests, count(*) FILTER (WHERE status = 'FAILED')::int AS failures,
                           COALESCE(sum(input_tokens), 0)::bigint AS "inputTokens", COALESCE(sum(output_tokens), 0)::bigint AS "outputTokens"
                    FROM enough.admin_ai_usage_events WHERE created_at >= now() - interval '30 days'`),
        pool.query(`SELECT e.id, e.user_id AS "userId", u.email, e.capability, e.model, e.status, e.input_tokens AS "inputTokens", e.output_tokens AS "outputTokens", e.latency_ms AS "latencyMs", e.created_at AS "createdAt"
                    FROM enough.admin_ai_usage_events e LEFT JOIN enough.auth_users u ON u.id = e.user_id
                    ORDER BY e.created_at DESC LIMIT 100`),
      ]);
      return reply.send({ summary: summary.rows[0], events: recent.rows });
    } catch (error) {
      return reportError(request, reply, error, "AI usage could not be loaded.");
    }
  });

  app.get("/admin/audit", async (request, reply) => {
    const access = await requireAdmin(request, reply);
    if (!access || !(await allowRead(request, reply, "audit", access))) return;
    try {
      const result = await pool.query(
        `SELECT a.id, a.actor_user_id AS "actorUserId", actor.email AS "actorEmail", a.action,
                a.target_type AS "targetType", a.target_id AS "targetId", a.metadata, a.created_at AS "createdAt"
         FROM enough.admin_audit_events a LEFT JOIN enough.auth_users actor ON actor.id = a.actor_user_id
         ORDER BY a.created_at DESC, a.id DESC LIMIT 200`,
      );
      return reply.send({ events: result.rows });
    } catch (error) {
      return reportError(request, reply, error, "Admin audit history could not be loaded.");
    }
  });
}
