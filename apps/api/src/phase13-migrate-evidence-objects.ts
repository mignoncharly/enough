import { createHash, randomUUID } from "node:crypto";
import { pool } from "@enough/db";
import {
  createEvidenceObjectKeys,
  evidenceObjectStore,
  finalizeEvidenceUpload,
} from "@enough/evidence-storage";

let migrated = 0;
try {
  const interrupted = await pool.query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM enough.task_evidence_items
     WHERE storage_state = 'FINALIZING' ORDER BY created_at, id`,
  );
  if (interrupted.rowCount) evidenceObjectStore();
  for (const item of interrupted.rows) {
    await finalizeEvidenceUpload(item.id, item.user_id);
    migrated += 1;
  }
  while (true) {
    const client = await pool.connect();
    let transactionOpen = false;
    let row:
      | {
          id: string;
          user_id: string;
          original_file_name: string;
          content_type: string;
          file_size: number;
          file_sha256: string;
          file_data: Buffer;
        }
      | undefined;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      const pending = await client.query<NonNullable<typeof row>>(
        `SELECT id, user_id, original_file_name, content_type, file_size,
                file_sha256, file_data
         FROM enough.task_evidence_items
         WHERE storage_state = 'MIGRATION_PENDING' AND file_data IS NOT NULL
         ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      row = pending.rows[0];
      if (!row) {
        await client.query("COMMIT");
        transactionOpen = false;
        break;
      }
      const storage = evidenceObjectStore();
      const digest = createHash("sha256").update(row.file_data).digest("hex");
      if (row.file_data.length !== row.file_size || digest !== row.file_sha256.trim()) {
        throw new Error(
          "Evidence BYTEA checksum verification failed; original data remains in PostgreSQL.",
        );
      }
      const keys = createEvidenceObjectKeys();
      await storage.putStaging({
        key: keys.stagingKey,
        bytes: row.file_data,
        sha256: digest,
        contentType: row.content_type,
      });
      const uploadId = randomUUID();
      const requestHash = createHash("sha256")
        .update(
          JSON.stringify({ evidenceId: row.id, fileSha256: digest, contentType: row.content_type }),
        )
        .digest("hex");
      await client.query(
        `UPDATE enough.task_evidence_items
         SET storage_state = 'FINALIZING', storage_object_key = $2, storage_staging_key = $3,
             upload_idempotency_key = $4, upload_request_sha256 = $5, file_data = NULL,
             updated_at = now()
         WHERE id = $1 AND storage_state = 'MIGRATION_PENDING'`,
        [row.id, keys.objectKey, keys.stagingKey, uploadId, requestHash],
      );
      await client.query("COMMIT");
      transactionOpen = false;
    } catch (error) {
      if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    if (row) {
      await finalizeEvidenceUpload(row.id, row.user_id);
      migrated += 1;
    }
  }

  const remaining = await pool.query<{ pending: string; finalizing: string }>(
    `SELECT count(*) FILTER (WHERE storage_state = 'MIGRATION_PENDING')::text AS pending,
            count(*) FILTER (WHERE storage_state = 'FINALIZING')::text AS finalizing
     FROM enough.task_evidence_items`,
  );
  if (Number(remaining.rows[0]?.pending) > 0 || Number(remaining.rows[0]?.finalizing) > 0) {
    throw new Error(
      "Evidence object migration remains incomplete; rerun the migration command to resume.",
    );
  }
  console.info(`Checksum-verified evidence objects migrated: ${migrated}.`);
} finally {
  await pool.end();
}
