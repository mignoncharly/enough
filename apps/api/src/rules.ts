import { randomUUID } from "node:crypto";
import { checkRateLimit } from "@enough/auth";
import { type DbClient, pool } from "@enough/db";
import {
  evaluatePolicyRules,
  isValidPolicyTimezone,
  normalizeToolKey,
  POLICY_OVERRIDE_ACTIONS,
  POLICY_RULE_ACTIONS,
  type PolicyDecision,
  type PolicyOverride,
  type PolicyOverrideAction,
  type PolicyRule,
  type PolicyRuleAction,
  type PolicyRuleConditions,
  type PolicyRuleSchedule,
  resolveToolClassification,
  TOOL_CLASSIFICATIONS,
  TOOL_KINDS,
  type ToolClassification,
  type ToolClassificationEntry,
  type ToolKind,
} from "@enough/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireCsrf, requireSession } from "./api-auth.js";

interface RuleRow {
  id: string;
  user_id: string;
  product_id: string | null;
  device_id: string | null;
  name: string;
  enabled: boolean;
  priority: number;
  action: PolicyRuleAction;
  conditions: PolicyRuleConditions;
  schedule: PolicyRuleSchedule | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
  product_name?: string | null;
  device_name?: string | null;
}

interface OverrideRow {
  id: string;
  user_id: string;
  product_id: string | null;
  device_id: string | null;
  tool_kind: ToolKind;
  tool_key: string;
  action: PolicyOverrideAction;
  reason: string;
  starts_at: Date;
  expires_at: Date;
  created_at: Date;
  revoked_at: Date | null;
  product_name?: string | null;
  device_name?: string | null;
}

const conditionsSchema = z
  .object({
    classifications: z
      .array(z.enum(TOOL_CLASSIFICATIONS))
      .min(1)
      .max(TOOL_CLASSIFICATIONS.length)
      .optional(),
    toolKind: z.enum(TOOL_KINDS).optional(),
    toolKeys: z.array(z.string().trim().min(1).max(500)).min(1).max(40).optional(),
    contextKey: z.string().trim().min(1).max(80).optional(),
    contextValue: z.string().trim().min(1).max(160).optional(),
  })
  .strict()
  .refine((conditions) => Boolean(conditions.toolKeys?.length) === Boolean(conditions.toolKind), {
    message: "Choose a tool type when matching tool identifiers.",
  })
  .refine((conditions) => Boolean(conditions.contextKey) === Boolean(conditions.contextValue), {
    message: "Enter both a context name and value, or leave both blank.",
  });

const scheduleSchema = z
  .object({
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine(isValidPolicyTimezone, "Choose a valid time zone."),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    endTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    startsAt: z.string().datetime().nullable().optional(),
    endsAt: z.string().datetime().nullable().optional(),
  })
  .strict()
  .refine(
    (schedule) =>
      !schedule.startsAt ||
      !schedule.endsAt ||
      Date.parse(schedule.startsAt) < Date.parse(schedule.endsAt),
    {
      message: "The schedule end must be after its start.",
    },
  );

const ruleSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    enabled: z.boolean(),
    priority: z.number().int().min(-10000).max(10000),
    action: z.enum(POLICY_RULE_ACTIONS),
    productId: z.string().uuid().nullable(),
    deviceId: z.string().uuid().nullable(),
    conditions: conditionsSchema,
    schedule: scheduleSchema.nullable(),
  })
  .strict();

const updateRuleSchema = ruleSchema.extend({ expectedVersion: z.number().int().min(1) });
const archiveRuleSchema = z.object({ expectedVersion: z.number().int().min(1) }).strict();

const createOverrideSchema = z
  .object({
    productId: z.string().uuid().nullable(),
    deviceId: z.string().uuid().nullable(),
    toolKind: z.enum(TOOL_KINDS),
    toolKey: z.string().trim().min(1).max(500),
    action: z.enum(POLICY_OVERRIDE_ACTIONS),
    reason: z.string().trim().min(2).max(300),
    startsAt: z.string().datetime().optional(),
    expiresAt: z.string().datetime(),
  })
  .strict();

const evaluationSchema = z
  .object({
    toolKind: z.enum(TOOL_KINDS),
    toolKey: z.string().trim().min(1).max(500),
    productId: z.string().uuid().nullable(),
    deviceId: z.string().uuid().nullable(),
    contextKey: z.string().trim().max(80).optional(),
    contextValue: z.string().trim().max(160).optional(),
  })
  .strict()
  .refine((input) => Boolean(input.contextKey) === Boolean(input.contextValue), {
    message: "Enter both a context name and value, or leave both blank.",
  });

function ruleFromRow(row: RuleRow): PolicyRule {
  return {
    id: row.id,
    version: row.version,
    name: row.name,
    enabled: row.enabled,
    priority: row.priority,
    productId: row.product_id,
    deviceId: row.device_id,
    action: row.action,
    conditions: row.conditions,
    schedule: row.schedule,
    archivedAt: row.archived_at?.toISOString() ?? null,
  };
}

function ruleResponse(row: RuleRow) {
  return {
    ...ruleFromRow(row),
    productName: row.product_name ?? null,
    deviceName: row.device_name ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function overrideFromRow(row: OverrideRow): PolicyOverride {
  return {
    id: row.id,
    productId: row.product_id,
    deviceId: row.device_id,
    toolKind: row.tool_kind,
    toolKey: row.tool_key,
    action: row.action,
    reason: row.reason,
    startsAt: row.starts_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString() ?? null,
  };
}

function overrideResponse(row: OverrideRow) {
  return {
    ...overrideFromRow(row),
    productName: row.product_name ?? null,
    deviceName: row.device_name ?? null,
  };
}

function normalizeConditions(conditions: PolicyRuleConditions): PolicyRuleConditions {
  const toolKind = conditions.toolKind;
  if (conditions.toolKeys && !toolKind) throw new Error("Tool keys require a tool kind.");
  const keys = toolKind
    ? conditions.toolKeys?.map((key) => normalizeToolKey(toolKind, key))
    : undefined;
  return {
    ...(conditions.classifications
      ? { classifications: [...new Set(conditions.classifications)].sort() as ToolClassification[] }
      : {}),
    ...(conditions.toolKind ? { toolKind: conditions.toolKind } : {}),
    ...(keys ? { toolKeys: [...new Set(keys)].sort() } : {}),
    ...(conditions.contextKey
      ? { contextKey: conditions.contextKey.toLocaleLowerCase("en-US") }
      : {}),
    ...(conditions.contextValue
      ? { contextValue: conditions.contextValue.toLocaleLowerCase("en-US") }
      : {}),
  };
}

function normalizeRuleBody(body: z.infer<typeof ruleSchema>) {
  return {
    ...body,
    conditions: normalizeConditions(body.conditions),
    schedule: body.schedule
      ? {
          ...body.schedule,
          daysOfWeek: [...new Set(body.schedule.daysOfWeek)].sort((a, b) => a - b),
          startsAt: body.schedule.startsAt ? new Date(body.schedule.startsAt).toISOString() : null,
          endsAt: body.schedule.endsAt ? new Date(body.schedule.endsAt).toISOString() : null,
        }
      : null,
  };
}

function ruleSnapshot(row: RuleRow, archivedAt: Date | null = row.archived_at) {
  return JSON.stringify({
    ...ruleFromRow(row),
    archivedAt: archivedAt?.toISOString() ?? null,
  });
}

async function scopeIsOwned(
  client: DbClient,
  userId: string,
  productId: string | null,
  deviceId: string | null,
): Promise<boolean> {
  if (productId) {
    const product = await client.query(
      "SELECT 1 FROM enough.products WHERE id = $1 AND user_id = $2",
      [productId, userId],
    );
    if (product.rowCount !== 1) return false;
  }
  if (deviceId) {
    const device = await client.query(
      "SELECT 1 FROM enough.auth_devices WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
      [deviceId, userId],
    );
    if (device.rowCount !== 1) return false;
  }
  return true;
}

async function listRules(userId: string): Promise<RuleRow[]> {
  const result = await pool.query<RuleRow>(
    `SELECT policy_rule.*, product.name AS product_name, device.name AS device_name
     FROM enough.policy_rules policy_rule
     LEFT JOIN enough.products product ON product.id = policy_rule.product_id AND product.user_id = policy_rule.user_id
     LEFT JOIN enough.auth_devices device ON device.id = policy_rule.device_id AND device.user_id = policy_rule.user_id
     WHERE policy_rule.user_id = $1
     ORDER BY policy_rule.archived_at NULLS FIRST, policy_rule.priority DESC, policy_rule.created_at, policy_rule.id`,
    [userId],
  );
  return result.rows;
}

export async function registerRuleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/rules", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!(await checkRateLimit(request, reply, "rules:read", session.id, 120, 60))) return;
    try {
      const [rules, overrides] = await Promise.all([
        listRules(session.id),
        pool.query<OverrideRow>(
          `SELECT ovr.*, product.name AS product_name, device.name AS device_name
           FROM enough.policy_overrides ovr
           LEFT JOIN enough.products product ON product.id = ovr.product_id AND product.user_id = ovr.user_id
           LEFT JOIN enough.auth_devices device ON device.id = ovr.device_id AND device.user_id = ovr.user_id
           WHERE ovr.user_id = $1 AND ovr.revoked_at IS NULL
           ORDER BY ovr.created_at DESC LIMIT 100`,
          [session.id],
        ),
      ]);
      return reply.send({
        rules: rules.map(ruleResponse),
        overrides: overrides.rows.map(overrideResponse),
      });
    } catch (error) {
      request.log.error({ err: error }, "Could not load policy rules");
      return reply.code(503).send({ error: "Your rules are temporarily unavailable." });
    }
  });

  app.get("/rules/:ruleId/versions", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!(await checkRateLimit(request, reply, "rules:read", session.id, 120, 60))) return;
    const ruleId = z
      .string()
      .uuid()
      .safeParse((request.params as { ruleId?: string }).ruleId);
    if (!ruleId.success) return reply.code(400).send({ error: "Invalid rule ID." });
    try {
      const result = await pool.query<{
        version: number;
        snapshot: Record<string, unknown>;
        created_at: Date;
      }>(
        `SELECT version, snapshot, created_at FROM enough.policy_rule_versions
         WHERE rule_id = $1 AND user_id = $2 ORDER BY version DESC`,
        [ruleId.data, session.id],
      );
      if (!result.rows.length) return reply.code(404).send({ error: "Rule not found." });
      return reply.send({
        versions: result.rows.map((row) => ({
          version: row.version,
          snapshot: row.snapshot,
          createdAt: row.created_at.toISOString(),
        })),
      });
    } catch (error) {
      request.log.error({ err: error }, "Could not load rule history");
      return reply.code(503).send({ error: "Rule history is temporarily unavailable." });
    }
  });

  app.post("/rules", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "rules:write", session.id, 120, 60 * 60))) return;
    const parsed = ruleSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? "Review the rule details." });
    let body: ReturnType<typeof normalizeRuleBody>;
    try {
      body = normalizeRuleBody(parsed.data);
    } catch (error) {
      return reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : "Review the tool conditions." });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (!(await scopeIsOwned(client, session.id, body.productId, body.deviceId))) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Product or active device not found." });
      }
      const inserted = await client.query<RuleRow>(
        `INSERT INTO enough.policy_rules
           (id, user_id, product_id, device_id, name, enabled, priority, action, conditions, schedule)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
         RETURNING *`,
        [
          randomUUID(),
          session.id,
          body.productId,
          body.deviceId,
          body.name,
          body.enabled,
          body.priority,
          body.action,
          JSON.stringify(body.conditions),
          body.schedule ? JSON.stringify(body.schedule) : null,
        ],
      );
      const row = inserted.rows[0];
      await client.query(
        `INSERT INTO enough.policy_rule_versions (id, rule_id, user_id, version, snapshot)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [randomUUID(), row.id, session.id, row.version, ruleSnapshot(row)],
      );
      await client.query("COMMIT");
      return reply.code(201).send({ rule: ruleResponse(row) });
    } catch (error) {
      await client.query("ROLLBACK");
      request.log.error({ err: error }, "Could not create policy rule");
      return reply.code(503).send({ error: "The rule could not be created." });
    } finally {
      client.release();
    }
  });

  app.patch("/rules/:ruleId", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "rules:write", session.id, 120, 60 * 60))) return;
    const ruleId = z
      .string()
      .uuid()
      .safeParse((request.params as { ruleId?: string }).ruleId);
    if (!ruleId.success) return reply.code(400).send({ error: "Invalid rule ID." });
    const parsed = updateRuleSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? "Review the rule details." });
    const { expectedVersion, ...ruleData } = parsed.data;
    let body: ReturnType<typeof normalizeRuleBody>;
    try {
      body = normalizeRuleBody(ruleData);
    } catch (error) {
      return reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : "Review the tool conditions." });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<RuleRow>(
        "SELECT * FROM enough.policy_rules WHERE id = $1 AND user_id = $2 AND archived_at IS NULL FOR UPDATE",
        [ruleId.data, session.id],
      );
      const oldRule = current.rows[0];
      if (!oldRule) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Rule not found." });
      }
      if (oldRule.version !== expectedVersion) {
        await client.query("ROLLBACK");
        return reply.code(409).send({
          error: "This rule changed elsewhere. Reload it before saving.",
          currentVersion: oldRule.version,
        });
      }
      if (!(await scopeIsOwned(client, session.id, body.productId, body.deviceId))) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Product or active device not found." });
      }
      const updated = await client.query<RuleRow>(
        `UPDATE enough.policy_rules
         SET product_id = $3, device_id = $4, name = $5, enabled = $6, priority = $7,
             action = $8, conditions = $9::jsonb, schedule = $10::jsonb,
             version = version + 1, updated_at = now()
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [
          ruleId.data,
          session.id,
          body.productId,
          body.deviceId,
          body.name,
          body.enabled,
          body.priority,
          body.action,
          JSON.stringify(body.conditions),
          body.schedule ? JSON.stringify(body.schedule) : null,
        ],
      );
      const row = updated.rows[0];
      await client.query(
        `INSERT INTO enough.policy_rule_versions (id, rule_id, user_id, version, snapshot)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [randomUUID(), row.id, session.id, row.version, ruleSnapshot(row)],
      );
      await client.query("COMMIT");
      return reply.send({ rule: ruleResponse(row) });
    } catch (error) {
      await client.query("ROLLBACK");
      request.log.error({ err: error }, "Could not update policy rule");
      return reply.code(503).send({ error: "The rule could not be updated." });
    } finally {
      client.release();
    }
  });

  app.delete("/rules/:ruleId", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "rules:write", session.id, 120, 60 * 60))) return;
    const ruleId = z
      .string()
      .uuid()
      .safeParse((request.params as { ruleId?: string }).ruleId);
    if (!ruleId.success) return reply.code(400).send({ error: "Invalid rule ID." });
    const parsed = archiveRuleSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: "Reload this rule and retry with its current version." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<RuleRow>(
        "SELECT * FROM enough.policy_rules WHERE id = $1 AND user_id = $2 AND archived_at IS NULL FOR UPDATE",
        [ruleId.data, session.id],
      );
      const oldRule = current.rows[0];
      if (!oldRule) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Rule not found." });
      }
      if (oldRule.version !== parsed.data.expectedVersion) {
        await client.query("ROLLBACK");
        return reply.code(409).send({
          error: "This rule changed elsewhere. Reload it before archiving.",
          currentVersion: oldRule.version,
        });
      }
      const archived = await client.query<RuleRow>(
        `UPDATE enough.policy_rules
         SET enabled = false, archived_at = now(), version = version + 1, updated_at = now()
         WHERE id = $1 AND user_id = $2 RETURNING *`,
        [ruleId.data, session.id],
      );
      const row = archived.rows[0];
      await client.query(
        `INSERT INTO enough.policy_rule_versions (id, rule_id, user_id, version, snapshot)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [randomUUID(), row.id, session.id, row.version, ruleSnapshot(row)],
      );
      await client.query("COMMIT");
      return reply.code(204).send();
    } catch (error) {
      await client.query("ROLLBACK");
      request.log.error({ err: error }, "Could not archive policy rule");
      return reply.code(503).send({ error: "The rule could not be archived." });
    } finally {
      client.release();
    }
  });

  app.post("/rules/overrides", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "rules:write", session.id, 120, 60 * 60))) return;
    const parsed = createOverrideSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? "Review the override details." });
    const body = parsed.data;
    let toolKey: string;
    try {
      toolKey = normalizeToolKey(body.toolKind, body.toolKey);
    } catch (error) {
      return reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : "Enter a valid tool identifier." });
    }
    const startsAt = body.startsAt ? Date.parse(body.startsAt) : Date.now();
    const expiresAt = Date.parse(body.expiresAt);
    const nowMillis = Date.now();
    if (
      expiresAt <= startsAt ||
      expiresAt <= nowMillis ||
      expiresAt - startsAt > 30 * 24 * 60 * 60 * 1000 ||
      expiresAt - nowMillis > 30 * 24 * 60 * 60 * 1000
    ) {
      return reply
        .code(400)
        .send({ error: "Overrides must expire within 30 days of their start." });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (!(await scopeIsOwned(client, session.id, body.productId, body.deviceId))) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Product or active device not found." });
      }
      const inserted = await client.query<OverrideRow>(
        `WITH inserted AS (
           INSERT INTO enough.policy_overrides
             (id, user_id, product_id, device_id, tool_kind, tool_key, action, reason, starts_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *
         )
         SELECT inserted.*, product.name AS product_name, device.name AS device_name
         FROM inserted
         LEFT JOIN enough.products product ON product.id = inserted.product_id AND product.user_id = inserted.user_id
         LEFT JOIN enough.auth_devices device ON device.id = inserted.device_id AND device.user_id = inserted.user_id`,
        [
          randomUUID(),
          session.id,
          body.productId,
          body.deviceId,
          body.toolKind,
          toolKey,
          body.action,
          body.reason,
          new Date(startsAt).toISOString(),
          new Date(expiresAt).toISOString(),
        ],
      );
      await client.query("COMMIT");
      return reply.code(201).send({ override: overrideResponse(inserted.rows[0]) });
    } catch (error) {
      await client.query("ROLLBACK");
      request.log.error({ err: error }, "Could not create policy override");
      return reply.code(503).send({ error: "The override could not be created." });
    } finally {
      client.release();
    }
  });

  app.delete("/rules/overrides/:overrideId", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "rules:write", session.id, 120, 60 * 60))) return;
    const overrideId = z
      .string()
      .uuid()
      .safeParse((request.params as { overrideId?: string }).overrideId);
    if (!overrideId.success) return reply.code(400).send({ error: "Invalid override ID." });
    try {
      const revoked = await pool.query(
        `UPDATE enough.policy_overrides SET revoked_at = now()
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [overrideId.data, session.id],
      );
      if (revoked.rowCount !== 1)
        return reply.code(404).send({ error: "Active override not found." });
      return reply.code(204).send();
    } catch (error) {
      request.log.error({ err: error }, "Could not revoke policy override");
      return reply.code(503).send({ error: "The override could not be revoked." });
    }
  });

  app.post("/rules/evaluate", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "rules:evaluate", session.id, 120, 60))) return;
    const parsed = evaluationSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? "Review the evaluation input." });
    const body = parsed.data;
    let toolKey: string;
    try {
      toolKey = normalizeToolKey(body.toolKind, body.toolKey);
    } catch (error) {
      return reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : "Enter a valid tool identifier." });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const now = await client.query<{ evaluated_at: Date }>(
        "SELECT clock_timestamp() AS evaluated_at",
      );
      if (!(await scopeIsOwned(client, session.id, body.productId, body.deviceId))) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Product or active device not found." });
      }
      const [ruleResult, overrideResult, mappingResult, catalogResult] = await Promise.all([
        client.query<RuleRow>(
          "SELECT * FROM enough.policy_rules WHERE user_id = $1 AND archived_at IS NULL",
          [session.id],
        ),
        client.query<OverrideRow>(
          "SELECT * FROM enough.policy_overrides WHERE user_id = $1 AND revoked_at IS NULL",
          [session.id],
        ),
        client.query<{
          tool_kind: ToolKind;
          tool_key: string;
          display_name: string;
          classification: ToolClassification;
          product_id: string | null;
          context_key: string;
          context_value: string;
        }>(
          `SELECT tool_kind, tool_key, display_name, classification, product_id, context_key, context_value
           FROM enough.tool_classification_mappings
           WHERE user_id = $1 AND (product_id IS NULL OR product_id = $2)`,
          [session.id, body.productId],
        ),
        client.query<{
          tool_kind: ToolKind;
          tool_key: string;
          display_name: string;
          classification: ToolClassification;
        }>(
          "SELECT tool_kind, tool_key, display_name, classification FROM enough.tool_classification_catalog",
        ),
      ]);
      const catalogEntries: ToolClassificationEntry[] = catalogResult.rows.map((row) => ({
        toolKind: row.tool_kind,
        toolKey: row.tool_key,
        displayName: row.display_name,
        classification: row.classification,
      }));
      const mappings: ToolClassificationEntry[] = mappingResult.rows.map((row) => ({
        toolKind: row.tool_kind,
        toolKey: row.tool_key,
        displayName: row.display_name,
        classification: row.classification,
        productId: row.product_id,
        contextKey: row.context_key,
        contextValue: row.context_value,
      }));
      const classification = resolveToolClassification(
        { ...body, toolKey },
        mappings,
        catalogEntries,
      );
      const input = {
        ...body,
        toolKey,
        classification: classification.classification,
        evaluatedAt: now.rows[0].evaluated_at.toISOString(),
      };
      const decision: PolicyDecision = evaluatePolicyRules(
        input,
        ruleResult.rows.map(ruleFromRow),
        overrideResult.rows.map(overrideFromRow),
      );
      await client.query("COMMIT");
      return reply.send({ decision, classification });
    } catch (error) {
      await client.query("ROLLBACK");
      request.log.error({ err: error }, "Could not evaluate policy rules");
      return reply.code(503).send({ error: "The policy decision is temporarily unavailable." });
    } finally {
      client.release();
    }
  });
}
