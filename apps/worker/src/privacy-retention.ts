import { pool } from "@enough/db";

interface RetentionAccount {
  user_id: string;
  activity_retention_days: number;
  notification_retention_days: number;
  audit_retention_days: number;
}

export async function pruneExpiredPrivacyData(): Promise<{
  accounts: number;
  activityEvents: number;
  notifications: number;
  auditEvents: number;
  adminAuditEvents: number;
  aiUsageEvents: number;
}> {
  const accounts = await pool.query<RetentionAccount>(
    `SELECT account.id AS user_id,
            COALESCE(preference.activity_retention_days, 365) AS activity_retention_days,
            COALESCE(preference.notification_retention_days, 365) AS notification_retention_days,
            COALESCE(preference.audit_retention_days, 730) AS audit_retention_days
     FROM enough.auth_users account
     LEFT JOIN enough.privacy_preferences preference ON preference.user_id = account.id`,
  );
  let activityEvents = 0;
  let notifications = 0;
  let auditEvents = 0;
  let adminAuditEvents = 0;
  let aiUsageEvents = 0;

  for (const account of accounts.rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const removedActivity = await client.query(
        `DELETE FROM enough.activity_events
         WHERE user_id = $1 AND effective_at < now() - make_interval(days => $2)`,
        [account.user_id, account.activity_retention_days],
      );
      activityEvents += removedActivity.rowCount ?? 0;

      // Rebuild the user's hourly rollups after pruning so aggregates cannot retain expired activity.
      await client.query(
        `DELETE FROM enough.activity_event_aggregates rollup
         USING enough.products product
         WHERE rollup.product_id = product.id AND product.user_id = $1`,
        [account.user_id],
      );
      await client.query(
        `INSERT INTO enough.activity_event_aggregates
           (product_id, event_type, bucket_start, event_count, last_event_at)
         SELECT event.product_id, event.event_type,
                date_trunc('hour', event.effective_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
                count(*)::bigint, max(event.effective_at)
         FROM enough.activity_events event
         WHERE event.user_id = $1
         GROUP BY event.product_id, event.event_type,
                  date_trunc('hour', event.effective_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
         ON CONFLICT (product_id, event_type, bucket_start) DO UPDATE
           SET event_count = EXCLUDED.event_count,
               last_event_at = EXCLUDED.last_event_at,
               updated_at = now()`,
        [account.user_id],
      );
      const removedNotifications = await client.query(
        `DELETE FROM enough.notifications
         WHERE user_id = $1 AND created_at < now() - make_interval(days => $2)`,
        [account.user_id, account.notification_retention_days],
      );
      notifications += removedNotifications.rowCount ?? 0;
      const removedAudit = await client.query(
        `DELETE FROM enough.auth_audit_events
         WHERE user_id = $1 AND created_at < now() - make_interval(days => $2)`,
        [account.user_id, account.audit_retention_days],
      );
      auditEvents += removedAudit.rowCount ?? 0;
      const removedAdminAudit = await client.query(
        `DELETE FROM enough.admin_audit_events
         WHERE actor_user_id = $1 AND created_at < now() - make_interval(days => $2)`,
        [account.user_id, account.audit_retention_days],
      );
      adminAuditEvents += removedAdminAudit.rowCount ?? 0;
      const removedAiUsage = await client.query(
        `DELETE FROM enough.admin_ai_usage_events
         WHERE user_id = $1 AND created_at < now() - make_interval(days => $2)`,
        [account.user_id, account.audit_retention_days],
      );
      aiUsageEvents += removedAiUsage.rowCount ?? 0;
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  const removedAnonymousAdminAudit = await pool.query(
    "DELETE FROM enough.admin_audit_events WHERE actor_user_id IS NULL AND created_at < now() - interval '730 days'",
  );
  adminAuditEvents += removedAnonymousAdminAudit.rowCount ?? 0;
  const removedAnonymousAiUsage = await pool.query(
    "DELETE FROM enough.admin_ai_usage_events WHERE user_id IS NULL AND created_at < now() - interval '730 days'",
  );
  aiUsageEvents += removedAnonymousAiUsage.rowCount ?? 0;

  return {
    accounts: accounts.rowCount ?? 0,
    activityEvents,
    notifications,
    auditEvents,
    adminAuditEvents,
    aiUsageEvents,
  };
}
