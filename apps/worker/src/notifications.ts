import { createHash } from "node:crypto";
import { env } from "@enough/config";
import { pool } from "@enough/db";
import { nextAllowedNotificationTime } from "@enough/shared";

interface PendingEmail {
  id: string;
  user_id: string;
  email: string;
  title: string;
  body: string;
  href: string;
  email_attempts: number;
  email_enabled: boolean;
  email_verified: boolean;
  timezone: string;
  quiet_start: string | null;
  quiet_end: string | null;
}

function escapeHtml(value: string): string {
  const escapes: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => escapes[character] ?? character);
}

function safeNotificationUrl(value: string): string {
  const appUrl = new URL(env.APP_BASE_URL);
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return new URL("/notifications", appUrl).toString();
  }
  try {
    const destination = new URL(value, appUrl);
    if (destination.origin !== appUrl.origin) return new URL("/notifications", appUrl).toString();
    return destination.toString();
  } catch {
    return new URL("/notifications", appUrl).toString();
  }
}

async function deliver(row: PendingEmail): Promise<boolean> {
  const url = safeNotificationUrl(row.href);
  const settingsUrl = new URL("/settings", env.APP_BASE_URL).toString();
  const subject = `Enough: ${row.title}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;background:#f4f4f0;color:#172321;font-family:Arial,Helvetica,sans-serif"><div style="max-width:560px;margin:0 auto;padding:32px 20px"><p style="font-size:13px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;color:#326653">Enough</p><h1 style="font-size:24px;line-height:1.3">${escapeHtml(row.title)}</h1><p style="font-size:16px;line-height:1.6">${escapeHtml(row.body)}</p><p><a href="${escapeHtml(url)}" style="display:inline-block;min-height:44px;padding:12px 20px;border-radius:8px;background:#245b48;color:#fff;text-decoration:none;font-weight:bold">Open Enough</a></p><p style="font-size:13px;line-height:1.5;color:#52615c">Change notification preferences in <a href="${escapeHtml(settingsUrl)}">workspace settings</a>.</p></div></body></html>`;
  const text =
    row.title +
    "\n\n" +
    row.body +
    "\n\nOpen Enough: " +
    url +
    "\nNotification preferences: " +
    settingsUrl;
  const key = createHash("sha256").update("notification\0").update(row.id).digest("hex");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify({ from: env.AUTH_EMAIL_FROM, to: [row.email], subject, html, text }),
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  return response.ok;
}

async function processOne(): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<PendingEmail>(
      `SELECT notification.id, notification.user_id, user_account.email,
              notification.title, notification.body, notification.href,
              notification.email_attempts,
              COALESCE(preferences.email_enabled, false) AS email_enabled,
              (user_account.email_verified_at IS NOT NULL) AS email_verified,
              COALESCE(preferences.timezone, 'UTC') AS timezone,
              preferences.quiet_start::text, preferences.quiet_end::text
       FROM enough.notifications notification
       JOIN enough.auth_users user_account ON user_account.id = notification.user_id
       LEFT JOIN enough.notification_preferences preferences ON preferences.user_id = notification.user_id
       LEFT JOIN enough.privacy_preferences privacy ON privacy.user_id = notification.user_id
       WHERE notification.email_status = 'PENDING'
         AND notification.email_available_at <= now()
         AND notification.created_at >= now() - make_interval(days => COALESCE(privacy.notification_retention_days, 365))
       ORDER BY notification.email_available_at, notification.created_at
       LIMIT 1
       FOR UPDATE OF notification SKIP LOCKED`,
    );
    const row = result.rows[0];
    if (!row) {
      await client.query("COMMIT");
      return false;
    }
    if (!row.email_enabled || !row.email_verified || !env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM) {
      if (!env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        "UPDATE enough.notifications SET email_status = 'SKIPPED', email_available_at = NULL WHERE id = $1",
        [row.id],
      );
      await client.query("COMMIT");
      return true;
    }

    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [row.user_id]);
    const sentRecently = await client.query<{ email_sent_at: Date }>(
      `SELECT email_sent_at FROM enough.notifications
       WHERE user_id = $1 AND email_status = 'SENT'
         AND email_sent_at >= now() - interval '24 hours'
       ORDER BY email_sent_at ASC LIMIT 3`,
      [row.user_id],
    );
    if (sentRecently.rows.length >= 3) {
      const eligibleAt = new Date(sentRecently.rows[0].email_sent_at.getTime() + 24 * 60 * 60_000);
      await client.query("UPDATE enough.notifications SET email_available_at = $2 WHERE id = $1", [
        row.id,
        eligibleAt,
      ]);
      await client.query("COMMIT");
      return true;
    }

    const quietStart = row.quiet_start?.slice(0, 5) ?? null;
    const quietEnd = row.quiet_end?.slice(0, 5) ?? null;
    const afterQuietHours = nextAllowedNotificationTime(row.timezone, quietStart, quietEnd);
    if (afterQuietHours) {
      await client.query("UPDATE enough.notifications SET email_available_at = $2 WHERE id = $1", [
        row.id,
        afterQuietHours,
      ]);
      await client.query("COMMIT");
      return true;
    }

    try {
      const sent = await deliver(row);
      if (sent) {
        await client.query(
          `UPDATE enough.notifications
           SET email_status = 'SENT', email_available_at = NULL,
               email_attempts = email_attempts + 1, email_sent_at = now()
           WHERE id = $1`,
          [row.id],
        );
      } else {
        const attempts = row.email_attempts + 1;
        await client.query(
          `UPDATE enough.notifications
           SET email_status = CASE WHEN $2 >= 5 THEN 'FAILED' ELSE 'PENDING' END,
               email_available_at = CASE WHEN $2 >= 5 THEN NULL
                 ELSE now() + make_interval(secs => LEAST(3600, 30 * (2 ^ LEAST($2, 7)))) END,
               email_attempts = $2
           WHERE id = $1`,
          [row.id, attempts],
        );
      }
    } catch {
      const attempts = row.email_attempts + 1;
      await client.query(
        `UPDATE enough.notifications
         SET email_status = CASE WHEN $2 >= 5 THEN 'FAILED' ELSE 'PENDING' END,
             email_available_at = CASE WHEN $2 >= 5 THEN NULL
               ELSE now() + make_interval(secs => LEAST(3600, 30 * (2 ^ LEAST($2, 7)))) END,
             email_attempts = $2
         WHERE id = $1`,
        [row.id, attempts],
      );
    }
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function drainPendingNotificationEmails(): Promise<void> {
  if (!env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM) return;
  for (let count = 0; count < 10; count += 1) {
    if (!(await processOne())) return;
  }
}
