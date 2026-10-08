import { randomUUID } from "node:crypto";
import { checkRateLimit } from "@enough/auth";
import { env } from "@enough/config";
import { type DbClient, pool } from "@enough/db";
import {
  isValidPolicyTimezone,
  isWithinQuietHours,
  nextAllowedNotificationTime,
} from "@enough/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireCsrf, requireSession } from "./api-auth.js";

type NotificationType = "CREDIT_EARNED" | "STAGE_CHANGED" | "MARKET_SIGNAL" | "TASK_REVIEW";

interface NotificationInput {
  userId: string;
  productId: string;
  type: NotificationType;
  title: string;
  body: string;
  href: string;
  dedupeKey: string;
}

interface PreferencesRow {
  web_enabled: boolean;
  desktop_enabled: boolean;
  email_enabled: boolean;
  timezone: string;
  quiet_start: string | null;
  quiet_end: string | null;
}

function defaults(): PreferencesRow {
  return {
    web_enabled: true,
    desktop_enabled: true,
    email_enabled: false,
    timezone: "UTC",
    quiet_start: null,
    quiet_end: null,
  };
}

function safeNotificationHref(value: string): string {
  const fallback = "/notifications";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  try {
    const appUrl = new URL(env.APP_BASE_URL);
    const destination = new URL(value, appUrl);
    if (destination.origin !== appUrl.origin) return fallback;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return fallback;
  }
}

function preferencesResponse(row: PreferencesRow) {
  return {
    webEnabled: row.web_enabled,
    desktopEnabled: row.desktop_enabled,
    emailEnabled: row.email_enabled,
    timezone: row.timezone,
    quietHours:
      row.quiet_start && row.quiet_end
        ? { start: row.quiet_start.slice(0, 5), end: row.quiet_end.slice(0, 5) }
        : null,
  };
}

export async function insertNotification(
  client: DbClient,
  input: NotificationInput,
): Promise<boolean> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [input.userId]);
  const [preferenceResult, volumeResult] = await Promise.all([
    client.query<PreferencesRow>(
      `SELECT COALESCE(preferences.web_enabled, true) AS web_enabled,
              COALESCE(preferences.desktop_enabled, true) AS desktop_enabled,
              COALESCE(preferences.email_enabled, false) AS email_enabled,
              COALESCE(preferences.timezone, 'UTC') AS timezone,
              preferences.quiet_start::text, preferences.quiet_end::text,
              (user_account.email_verified_at IS NOT NULL) AS email_verified
       FROM enough.auth_users user_account
       LEFT JOIN enough.notification_preferences preferences ON preferences.user_id = user_account.id
       WHERE user_account.id = $1`,
      [input.userId],
    ),
    client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM enough.notifications WHERE user_id = $1 AND created_at >= now() - interval '24 hours'",
      [input.userId],
    ),
  ]);
  const preferences = preferenceResult.rows[0];
  if (!preferences || Number(volumeResult.rows[0]?.count ?? 0) >= 100) return false;
  const emailVerified = (preferences as PreferencesRow & { email_verified: boolean })
    .email_verified;
  const emailRequested = preferences.email_enabled && emailVerified;
  if (!preferences.web_enabled && !preferences.desktop_enabled && !emailRequested) return false;

  const quietStart = preferences.quiet_start?.slice(0, 5) ?? null;
  const quietEnd = preferences.quiet_end?.slice(0, 5) ?? null;
  const now = new Date();
  const emailAvailableAt = emailRequested
    ? (nextAllowedNotificationTime(preferences.timezone, quietStart, quietEnd, now) ?? now)
    : null;
  const inserted = await client.query(
    `INSERT INTO enough.notifications
       (id, user_id, product_id, notification_type, title, body, href, dedupe_key,
        desktop_status, email_status, email_available_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
    [
      randomUUID(),
      input.userId,
      input.productId,
      input.type,
      input.title.slice(0, 120),
      input.body.slice(0, 500),
      safeNotificationHref(input.href),
      input.dedupeKey,
      preferences.desktop_enabled ? "PENDING" : "NOT_REQUESTED",
      emailRequested ? "PENDING" : "SKIPPED",
      emailRequested ? emailAvailableAt : null,
    ],
  );
  return inserted.rowCount === 1;
}

function notifyError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  request.log.error({ err: error }, "Notification operation failed");
  return reply.code(503).send({ error: "Notifications are temporarily unavailable." });
}

const preferencesSchema = z
  .object({
    webEnabled: z.boolean(),
    desktopEnabled: z.boolean(),
    emailEnabled: z.boolean(),
    timezone: z.string().trim().min(1).max(100),
    quietHours: z
      .object({
        start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
        end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .refine((value) => value.quietHours === null || value.quietHours.start !== value.quietHours.end, {
    message: "Quiet hours need different start and end times.",
  });
const notificationIdSchema = z.string().uuid();
const querySchema = z.object({ channel: z.enum(["WEB", "DESKTOP"]).default("WEB") }).strict();

export async function registerNotificationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/notification-data", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!(await checkRateLimit(request, reply, "notifications:read", session.id, 120, 60))) return;
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({ error: "Choose WEB or DESKTOP notifications." });
    try {
      const result = await pool.query<{
        id: string;
        notification_type: NotificationType;
        title: string;
        body: string;
        href: string;
        created_at: Date;
        read_at: Date | null;
      }>(
        `SELECT notification.id, notification.notification_type, notification.title, notification.body,
                notification.href, notification.created_at, notification.read_at
         FROM enough.notifications notification
         LEFT JOIN enough.notification_preferences preferences ON preferences.user_id = notification.user_id
         WHERE notification.user_id = $1
           AND ($2 = 'WEB' AND COALESCE(preferences.web_enabled, true)
             OR $2 = 'DESKTOP' AND COALESCE(preferences.desktop_enabled, true)
                AND notification.desktop_status = 'PENDING'
                AND notification.created_at >= now() - interval '7 days')
         ORDER BY CASE WHEN $2 = 'DESKTOP' THEN notification.created_at END ASC NULLS LAST,
                  notification.created_at DESC, notification.id DESC
         LIMIT 50`,
        [session.id, parsed.data.channel],
      );
      if (parsed.data.channel === "DESKTOP") {
        const [preferenceResult, volumeResult] = await Promise.all([
          pool.query<PreferencesRow>(
            `SELECT COALESCE(web_enabled, true) AS web_enabled,
                    COALESCE(desktop_enabled, true) AS desktop_enabled,
                    COALESCE(email_enabled, false) AS email_enabled,
                    COALESCE(timezone, 'UTC') AS timezone,
                    quiet_start::text, quiet_end::text
             FROM enough.notification_preferences WHERE user_id = $1`,
            [session.id],
          ),
          pool.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM enough.notifications WHERE user_id = $1 AND desktop_delivered_at >= now() - interval '1 hour'",
            [session.id],
          ),
        ]);
        const preferences = preferenceResult.rows[0] ?? defaults();
        const start = preferences.quiet_start?.slice(0, 5) ?? null;
        const end = preferences.quiet_end?.slice(0, 5) ?? null;
        if (
          Number(volumeResult.rows[0]?.count ?? 0) >= 10 ||
          isWithinQuietHours(preferences.timezone, start, end)
        ) {
          return reply.send({
            notifications: [],
            quietHours: isWithinQuietHours(preferences.timezone, start, end),
          });
        }
      }
      return reply.send({
        notifications: result.rows.map((row) => ({
          id: row.id,
          type: row.notification_type,
          title: row.title,
          body: row.body,
          href: safeNotificationHref(row.href),
          createdAt: row.created_at.toISOString(),
          readAt: row.read_at?.toISOString() ?? null,
        })),
      });
    } catch (error) {
      return notifyError(request, reply, error);
    }
  });

  app.get("/notification-preferences", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (
      !(await checkRateLimit(request, reply, "notifications:preferences:read", session.id, 60, 60))
    )
      return;
    try {
      const result = await pool.query<PreferencesRow>(
        `SELECT web_enabled, desktop_enabled, email_enabled, timezone, quiet_start::text, quiet_end::text
         FROM enough.notification_preferences WHERE user_id = $1`,
        [session.id],
      );
      return reply.send({ preferences: preferencesResponse(result.rows[0] ?? defaults()) });
    } catch (error) {
      return notifyError(request, reply, error);
    }
  });

  app.patch("/notification-preferences", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (
      !(await checkRateLimit(request, reply, "notifications:preferences", session.id, 20, 60 * 60))
    )
      return;
    const parsed = preferencesSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? "Review the notification preferences." });
    const input = parsed.data;
    if (!isValidPolicyTimezone(input.timezone))
      return reply.code(400).send({ error: "Choose a valid time zone." });
    if (input.emailEnabled) {
      if (!env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM)
        return reply
          .code(409)
          .send({ error: "Email delivery is not configured for this workspace yet." });
      try {
        const verified = await pool.query(
          "SELECT 1 FROM enough.auth_users WHERE id = $1 AND email_verified_at IS NOT NULL",
          [session.id],
        );
        if (verified.rowCount !== 1)
          return reply
            .code(409)
            .send({ error: "Verify your email address before enabling email notifications." });
      } catch (error) {
        return notifyError(request, reply, error);
      }
    }
    try {
      const result = await pool.query<PreferencesRow>(
        `INSERT INTO enough.notification_preferences
           (user_id, web_enabled, desktop_enabled, email_enabled, timezone, quiet_start, quiet_end)
         VALUES ($1, $2, $3, $4, $5, $6::time, $7::time)
         ON CONFLICT (user_id) DO UPDATE SET
           web_enabled = EXCLUDED.web_enabled, desktop_enabled = EXCLUDED.desktop_enabled,
           email_enabled = EXCLUDED.email_enabled, timezone = EXCLUDED.timezone,
           quiet_start = EXCLUDED.quiet_start, quiet_end = EXCLUDED.quiet_end, updated_at = now()
         RETURNING web_enabled, desktop_enabled, email_enabled, timezone,
                   quiet_start::text, quiet_end::text`,
        [
          session.id,
          input.webEnabled,
          input.desktopEnabled,
          input.emailEnabled,
          input.timezone,
          input.quietHours?.start ?? null,
          input.quietHours?.end ?? null,
        ],
      );
      return reply.send({ preferences: preferencesResponse(result.rows[0]) });
    } catch (error) {
      return notifyError(request, reply, error);
    }
  });

  app.post("/notification-data/read-all", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "notifications:write", session.id, 30, 60))) return;
    try {
      const result = await pool.query(
        "UPDATE enough.notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL",
        [session.id],
      );
      return reply.send({ markedRead: result.rowCount ?? 0 });
    } catch (error) {
      return notifyError(request, reply, error);
    }
  });

  app.post("/notification-data/:notificationId/read", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "notifications:write", session.id, 30, 60))) return;
    const notificationId = notificationIdSchema.safeParse(
      (request.params as { notificationId?: string }).notificationId,
    );
    if (!notificationId.success) return reply.code(400).send({ error: "Invalid notification ID." });
    try {
      const result = await pool.query(
        "UPDATE enough.notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2 RETURNING id",
        [notificationId.data, session.id],
      );
      if (result.rowCount !== 1) return reply.code(404).send({ error: "Notification not found." });
      return reply.send({ read: true });
    } catch (error) {
      return notifyError(request, reply, error);
    }
  });

  app.post("/notification-data/:notificationId/desktop-delivered", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "notifications:desktop-ack", session.id, 30, 60)))
      return;
    const notificationId = notificationIdSchema.safeParse(
      (request.params as { notificationId?: string }).notificationId,
    );
    if (!notificationId.success) return reply.code(400).send({ error: "Invalid notification ID." });
    try {
      const result = await pool.query(
        `UPDATE enough.notifications SET desktop_status = 'DELIVERED', desktop_delivered_at = now()
         WHERE id = $1 AND user_id = $2 AND desktop_status = 'PENDING' RETURNING id`,
        [notificationId.data, session.id],
      );
      return reply.send({ delivered: result.rowCount === 1 });
    } catch (error) {
      return notifyError(request, reply, error);
    }
  });
}
