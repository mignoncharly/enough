import { randomUUID } from "node:crypto";
import { checkRateLimit } from "@enough/auth";
import { pool } from "@enough/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireCsrf, requireSession } from "./api-auth.js";

const retentionOptions = [30, 90, 180, 365, 730, 1825, 3650] as const;
const purposes = ["ACTIVITY_COLLECTION", "AI_PROVIDER_PROCESSING"] as const;
interface ConsentRow {
  purpose: (typeof purposes)[number];
  enabled: boolean;
  policy_version: string;
  source: "web" | "desktop" | "extension";
  revision: string;
  granted_at: Date | null;
  revoked_at: Date | null;
  updated_at: Date;
}

const preferenceSchema = z
  .object({
    activityRetentionDays: z
      .number()
      .int()
      .refine((value) => retentionOptions.includes(value as (typeof retentionOptions)[number])),
    notificationRetentionDays: z
      .number()
      .int()
      .refine((value) => retentionOptions.includes(value as (typeof retentionOptions)[number])),
    auditRetentionDays: z
      .number()
      .int()
      .refine((value) => retentionOptions.includes(value as (typeof retentionOptions)[number])),
  })
  .strict();

export async function registerPrivacyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/privacy-consents", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!(await checkRateLimit(request, reply, "privacy:consent-status", session.id, 60, 60)))
      return;
    try {
      const rows = await pool.query<{
        purpose: (typeof purposes)[number];
        enabled: boolean;
        revision: string;
      }>(
        "SELECT purpose, enabled, revision::text AS revision FROM enough.privacy_consents WHERE user_id = $1",
        [session.id],
      );
      const grants = new Map(rows.rows.map((row) => [row.purpose, row] as const));
      const activity = grants.get("ACTIVITY_COLLECTION");
      const ai = grants.get("AI_PROVIDER_PROCESSING");
      return reply.send({
        activityCollectionEnabled: activity?.enabled === true,
        activityConsentRevision: activity?.revision ?? null,
        aiProviderProcessingEnabled: ai?.enabled === true,
      });
    } catch (error) {
      request.log.error({ err: error }, "Privacy consent state could not be loaded");
      return reply.code(503).send({ error: "Privacy consent state is temporarily unavailable." });
    }
  });

  app.get("/privacy-data", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!(await checkRateLimit(request, reply, "privacy:read", session.id, 60, 60))) return;

    try {
      await pool.query(
        "INSERT INTO enough.privacy_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
        [session.id],
      );
      const [account, preferences, consentRows, identities, devices, activity, evidence, audit] =
        await Promise.all([
          pool.query<{
            email: string;
            email_verified_at: Date | null;
            created_at: Date;
            has_password: boolean;
          }>(
            "SELECT email, email_verified_at, created_at, password_hash IS NOT NULL AS has_password FROM enough.auth_users WHERE id = $1",
            [session.id],
          ),
          pool.query(
            "SELECT activity_retention_days, notification_retention_days, audit_retention_days, updated_at FROM enough.privacy_preferences WHERE user_id = $1",
            [session.id],
          ),
          pool.query<ConsentRow>(
            "SELECT purpose, enabled, policy_version, source, revision::text AS revision, granted_at, revoked_at, updated_at FROM enough.privacy_consents WHERE user_id = $1",
            [session.id],
          ),
          pool.query(
            "SELECT provider, created_at FROM enough.auth_identities WHERE user_id = $1 ORDER BY provider",
            [session.id],
          ),
          pool.query(
            "SELECT id, name, client_type, created_at, last_seen_at, revoked_at FROM enough.auth_devices WHERE user_id = $1 ORDER BY last_seen_at DESC LIMIT 100",
            [session.id],
          ),
          pool.query(
            `SELECT event.id, event.product_id, product.name AS product_name, event.device_id,
                  device.name AS device_name, event.event_type, event.effective_at,
                  event.received_at, event.attributes
           FROM enough.activity_events event
           JOIN enough.products product ON product.id = event.product_id AND product.user_id = event.user_id
           LEFT JOIN enough.auth_devices device ON device.id = event.device_id
           WHERE event.user_id = $1
           ORDER BY event.effective_at DESC LIMIT 50`,
            [session.id],
          ),
          pool.query<{ item_count: string; live_count: string; file_bytes: string }>(
            `SELECT count(*)::text AS item_count,
                  count(*) FILTER (WHERE deleted_at IS NULL)::text AS live_count,
                  COALESCE(sum(file_size) FILTER (WHERE deleted_at IS NULL), 0)::text AS file_bytes
           FROM enough.task_evidence_items WHERE user_id = $1`,
            [session.id],
          ),
          pool.query(
            `SELECT id, event_type, created_at, metadata
           FROM enough.auth_audit_events WHERE user_id = $1
           ORDER BY created_at DESC LIMIT 100`,
            [session.id],
          ),
        ]);
      if (!account.rows[0]) return reply.code(404).send({ error: "Account not found." });

      const savedConsents = new Map(consentRows.rows.map((row) => [row.purpose, row] as const));
      return reply.send({
        account: {
          email: account.rows[0].email,
          emailVerified: Boolean(account.rows[0].email_verified_at),
          createdAt: account.rows[0].created_at,
          hasPassword: account.rows[0].has_password,
        },
        preferences: preferences.rows[0],
        retentionOptions,
        consents: purposes.map(
          (purpose) =>
            savedConsents.get(purpose) ?? {
              purpose,
              enabled: false,
              granted_at: null,
              revoked_at: null,
              source: null,
            },
        ),
        identities: identities.rows,
        devices: devices.rows,
        collectedActivity: activity.rows,
        evidence: {
          itemCount: Number(evidence.rows[0]?.item_count ?? 0),
          liveCount: Number(evidence.rows[0]?.live_count ?? 0),
          fileBytes: Number(evidence.rows[0]?.file_bytes ?? 0),
        },
        auditHistory: audit.rows,
      });
    } catch (error) {
      request.log.error({ err: error }, "Privacy dashboard could not be loaded");
      return reply.code(503).send({ error: "Privacy information is temporarily unavailable." });
    }
  });

  app.patch("/privacy-settings", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "privacy:settings", session.id, 30, 60 * 60)))
      return;
    const parsed = preferenceSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: "Choose a supported retention period for each data category." });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const saved = await client.query(
        `INSERT INTO enough.privacy_preferences
           (user_id, activity_retention_days, notification_retention_days, audit_retention_days)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET
           activity_retention_days = EXCLUDED.activity_retention_days,
           notification_retention_days = EXCLUDED.notification_retention_days,
           audit_retention_days = EXCLUDED.audit_retention_days,
           updated_at = now()
         RETURNING activity_retention_days, notification_retention_days, audit_retention_days, updated_at`,
        [
          session.id,
          parsed.data.activityRetentionDays,
          parsed.data.notificationRetentionDays,
          parsed.data.auditRetentionDays,
        ],
      );
      await client.query(
        `INSERT INTO enough.auth_audit_events (id, user_id, event_type, metadata)
         VALUES ($1, $2, 'privacy.retention.updated', $3::jsonb)`,
        [randomUUID(), session.id, JSON.stringify(parsed.data)],
      );
      await client.query("COMMIT");
      return reply.send({ preferences: saved.rows[0], workerIntervalHours: 6 });
    } catch (error) {
      await client.query("ROLLBACK");
      request.log.error({ err: error }, "Privacy retention preferences could not be saved");
      return reply.code(503).send({ error: "Retention preferences could not be saved." });
    } finally {
      client.release();
    }
  });

  app.put("/privacy-consents/:purpose", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "privacy:consent", session.id, 30, 60 * 60))) return;
    const purpose = (request.params as { purpose?: string }).purpose;
    if (!purposes.includes(purpose as (typeof purposes)[number]))
      return reply.code(404).send({ error: "Consent purpose not found." });
    const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: "Choose whether to grant or revoke this optional consent." });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const saved = await client.query(
        `INSERT INTO enough.privacy_consents
           (user_id, purpose, enabled, source, revision, granted_at, revoked_at)
         VALUES ($1, $2, $3, 'web', 1, CASE WHEN $3 THEN now() END, CASE WHEN $3 THEN NULL ELSE now() END)
         ON CONFLICT (user_id, purpose) DO UPDATE SET
           enabled = EXCLUDED.enabled,
           source = 'web',
           revision = privacy_consents.revision + 1,
           granted_at = CASE WHEN EXCLUDED.enabled THEN now() ELSE privacy_consents.granted_at END,
           revoked_at = CASE WHEN EXCLUDED.enabled THEN NULL ELSE now() END,
           updated_at = now()
         RETURNING purpose, enabled, policy_version, source, revision::text AS revision, granted_at, revoked_at, updated_at`,
        [session.id, purpose, parsed.data.enabled],
      );
      await client.query(
        `INSERT INTO enough.auth_audit_events (id, user_id, event_type, metadata)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [
          randomUUID(),
          session.id,
          `privacy.consent.${parsed.data.enabled ? "granted" : "revoked"}`,
          JSON.stringify({ purpose, source: "web" }),
        ],
      );
      await client.query("COMMIT");
      return reply.send({ consent: saved.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      request.log.error({ err: error }, "Privacy consent could not be saved");
      return reply.code(503).send({ error: "Consent preference could not be saved." });
    } finally {
      client.release();
    }
  });

  app.delete("/privacy-activity", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "privacy:activity-delete", session.id, 3, 60 * 60)))
      return;
    const parsed = z
      .object({ confirmation: z.literal("DELETE") })
      .strict()
      .safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Type DELETE to confirm removal of activity history." });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const user = await client.query("SELECT id FROM enough.auth_users WHERE id = $1 FOR UPDATE", [
        session.id,
      ]);
      if (user.rowCount !== 1) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Account not found." });
      }
      const removed = await client.query("DELETE FROM enough.activity_events WHERE user_id = $1", [
        session.id,
      ]);
      await client.query(
        `DELETE FROM enough.activity_event_aggregates rollup
         USING enough.products product
         WHERE rollup.product_id = product.id AND product.user_id = $1`,
        [session.id],
      );
      await client.query(
        `INSERT INTO enough.auth_audit_events (id, user_id, event_type, metadata)
         VALUES ($1, $2, 'privacy.activity.deleted', $3::jsonb)`,
        [randomUUID(), session.id, JSON.stringify({ count: removed.rowCount ?? 0 })],
      );
      await client.query("COMMIT");
      return reply.send({ deleted: removed.rowCount ?? 0 });
    } catch (error) {
      await client.query("ROLLBACK");
      request.log.error({ err: error }, "Activity history could not be deleted");
      return reply.code(503).send({ error: "Activity history could not be deleted." });
    } finally {
      client.release();
    }
  });
}
