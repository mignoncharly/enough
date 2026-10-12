import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { pool } from "@enough/db";

export interface EvidenceObject {
  key: string;
  sha256: string;
  size: number;
  contentType: string;
  bytes: Buffer;
}

interface ListedObject {
  key: string;
  lastModified: Date | undefined;
}

export interface EvidenceObjectStore {
  putStaging(input: {
    key: string;
    bytes: Buffer;
    sha256: string;
    contentType: string;
  }): Promise<void>;
  finalize(input: {
    stagingKey: string;
    objectKey: string;
    sha256: string;
    size: number;
    contentType: string;
  }): Promise<void>;
  get(key: string): Promise<EvidenceObject>;
  delete(key: string): Promise<void>;
  list(input: {
    prefix: "obj-" | "stage-";
    continuationToken?: string;
    maxKeys: number;
  }): Promise<{ objects: ListedObject[]; nextToken: string | undefined }>;
}

export class EvidenceStorageConfigurationError extends Error {
  readonly code = "EVIDENCE_STORAGE_NOT_CONFIGURED";
}

export class EvidenceStorageIntegrityError extends Error {
  readonly code = "EVIDENCE_STORAGE_INTEGRITY";
}

export interface EvidenceObjectCleanupResult {
  skipped: boolean;
  cleanupObjects: number;
  finalizedUploads: number;
  scannedObjects: number;
  removedOrphans: number;
  failures: number;
}

interface PendingUpload {
  id: string;
  user_id: string;
  storage_object_key: string;
  storage_staging_key: string;
  file_sha256: string;
  file_size: number;
  content_type: string;
}

function hasStorageConfig(): boolean {
  return Boolean(
    process.env.EVIDENCE_STORAGE_BUCKET?.trim() &&
      process.env.EVIDENCE_STORAGE_REGION?.trim() &&
      process.env.EVIDENCE_STORAGE_ACCESS_KEY_ID?.trim() &&
      process.env.EVIDENCE_STORAGE_SECRET_ACCESS_KEY?.trim(),
  );
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new EvidenceStorageConfigurationError();
  return value;
}

function createS3Client(): { client: S3Client; bucket: string } {
  const bucket = requiredEnvironment("EVIDENCE_STORAGE_BUCKET");
  const region = requiredEnvironment("EVIDENCE_STORAGE_REGION");
  const accessKeyId = requiredEnvironment("EVIDENCE_STORAGE_ACCESS_KEY_ID");
  const secretAccessKey = requiredEnvironment("EVIDENCE_STORAGE_SECRET_ACCESS_KEY");
  const configuredEndpoint = process.env.EVIDENCE_STORAGE_ENDPOINT?.trim();
  let endpoint: string | undefined;
  if (configuredEndpoint) {
    let parsed: URL;
    try {
      parsed = new URL(configuredEndpoint);
    } catch {
      throw new EvidenceStorageConfigurationError();
    }
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (
      !["https:", "http:"].includes(parsed.protocol) ||
      (parsed.protocol === "http:" && !isLoopback) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new EvidenceStorageConfigurationError();
    }
    endpoint = parsed.toString().replace(/\/$/, "");
  }
  return {
    bucket,
    client: new S3Client({
      region,
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      credentials: { accessKeyId, secretAccessKey },
      maxAttempts: 2,
    }),
  };
}

async function readVerifiedObject(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<EvidenceObject> {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = response.Body
    ? Buffer.from(await response.Body.transformToByteArray())
    : Buffer.alloc(0);
  const sha256 = response.Metadata?.sha256;
  const contentType = response.ContentType;
  const size = response.ContentLength;
  if (
    !sha256 ||
    !contentType ||
    typeof size !== "number" ||
    size !== bytes.length ||
    createHash("sha256").update(bytes).digest("hex") !== sha256
  ) {
    throw new EvidenceStorageIntegrityError();
  }
  return { key, sha256, contentType, size, bytes };
}

let store: EvidenceObjectStore | undefined;
let clientToClose: S3Client | undefined;

export function hasEvidenceObjectStorageConfig(): boolean {
  return hasStorageConfig();
}

export function evidenceObjectStore(): EvidenceObjectStore {
  if (store) return store;
  const { client, bucket } = createS3Client();
  clientToClose = client;
  store = {
    async putStaging(input) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: input.key,
          Body: input.bytes,
          ContentLength: input.bytes.length,
          ContentType: input.contentType,
          Metadata: { sha256: input.sha256 },
        }),
      );
    },
    async finalize(input) {
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: input.objectKey,
          CopySource: `${bucket}/${input.stagingKey}`,
          MetadataDirective: "REPLACE",
          ContentType: input.contentType,
          Metadata: { sha256: input.sha256 },
        }),
      );
      const verified = await readVerifiedObject(client, bucket, input.objectKey);
      if (
        verified.size !== input.size ||
        verified.contentType !== input.contentType ||
        verified.sha256 !== input.sha256
      ) {
        throw new EvidenceStorageIntegrityError();
      }
    },
    async get(key) {
      return readVerifiedObject(client, bucket, key);
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async list(input) {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: input.prefix,
          ContinuationToken: input.continuationToken,
          MaxKeys: Math.max(1, Math.min(100, input.maxKeys)),
        }),
      );
      return {
        objects: (response.Contents ?? []).flatMap((item) =>
          item.Key ? [{ key: item.Key, lastModified: item.LastModified }] : [],
        ),
        nextToken: response.NextContinuationToken,
      };
    },
  };
  return store;
}

export function createEvidenceObjectKeys(): { objectKey: string; stagingKey: string } {
  const opaque = randomBytes(32).toString("base64url");
  return { objectKey: `obj-${opaque}`, stagingKey: `stage-${opaque}` };
}

export async function finalizeEvidenceUpload(evidenceId: string, userId: string): Promise<boolean> {
  const row = await pool.query<PendingUpload>(
    `SELECT id, user_id, storage_object_key, storage_staging_key,
            file_sha256, file_size, content_type
     FROM enough.task_evidence_items
     WHERE id = $1 AND user_id = $2 AND storage_state = 'FINALIZING' AND deleted_at IS NULL`,
    [evidenceId, userId],
  );
  const pending = row.rows[0];
  if (!pending) return false;
  await evidenceObjectStore().finalize({
    objectKey: pending.storage_object_key,
    stagingKey: pending.storage_staging_key,
    sha256: pending.file_sha256.trim(),
    size: pending.file_size,
    contentType: pending.content_type,
  });
  const updated = await pool.query(
    `UPDATE enough.task_evidence_items SET storage_state = 'READY', storage_staging_key = NULL,
        updated_at = now()
     WHERE id = $1 AND user_id = $2 AND storage_state = 'FINALIZING'
       AND storage_object_key = $3 AND storage_staging_key = $4 AND deleted_at IS NULL
     RETURNING id, completion_id, task_id, product_id, user_id, evidence_type, title, note,
       evidence_url, integration_provider, integration_reference, provenance,
       original_file_name, content_type, file_size, file_sha256, storage_state,
       verification_status, reviewed_by_user_id, reviewed_at, review_note, verification_method,
       created_at, updated_at`,
    [evidenceId, userId, pending.storage_object_key, pending.storage_staging_key],
  );
  if (updated.rowCount !== 1) return false;
  await reconcileEvidenceObjectStorage({ maxFinalize: 0, maxScan: 0 });
  return true;
}

function safeStorageErrorCode(error: unknown): string {
  const candidate =
    error && typeof error === "object" ? (error as { code?: unknown; name?: unknown }) : {};
  const value =
    typeof candidate.code === "string"
      ? candidate.code
      : typeof candidate.name === "string"
        ? candidate.name
        : "StorageError";
  return value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || "StorageError";
}

function boundedInteger(value: number | undefined, fallback: number, max: number): number {
  return Math.max(0, Math.min(max, Number.isInteger(value) ? (value as number) : fallback));
}

export async function reconcileEvidenceObjectStorage(
  options: {
    maxCleanup?: number;
    maxFinalize?: number;
    maxScan?: number;
    orphanGraceMs?: number;
  } = {},
): Promise<EvidenceObjectCleanupResult> {
  const result: EvidenceObjectCleanupResult = {
    skipped: false,
    cleanupObjects: 0,
    finalizedUploads: 0,
    scannedObjects: 0,
    removedOrphans: 0,
    failures: 0,
  };
  if (!hasStorageConfig()) return { ...result, skipped: true };
  const maxCleanup = boundedInteger(options.maxCleanup, 100, 100);
  const maxFinalize = boundedInteger(options.maxFinalize, 25, 25);
  const maxScan = boundedInteger(options.maxScan, 100, 100);
  const orphanGraceMs = Math.max(0, options.orphanGraceMs ?? 60 * 60 * 1000);
  const client = await pool.connect();
  const runId = randomUUID();
  let locked = false;
  try {
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext('enough:evidence-object-storage-reconcile')) AS locked",
    );
    locked = lock.rows[0]?.locked === true;
    if (!locked) return { ...result, skipped: true };
    await client.query("INSERT INTO enough.task_evidence_storage_reconcile_runs (id) VALUES ($1)", [
      runId,
    ]);
    await client.query(
      "DELETE FROM enough.task_evidence_storage_reconcile_runs WHERE started_at < now() - interval '90 days'",
    );

    const storage = evidenceObjectStore();
    if (maxCleanup > 0) {
      const cleanup = await client.query<{
        object_key: string;
      }>(
        `SELECT object_key FROM enough.task_evidence_object_cleanup
         WHERE next_attempt_at <= now() ORDER BY next_attempt_at, created_at LIMIT $1`,
        [maxCleanup],
      );
      for (const item of cleanup.rows) {
        try {
          await storage.delete(item.object_key);
          await client.query(
            "DELETE FROM enough.task_evidence_object_cleanup WHERE object_key = $1",
            [item.object_key],
          );
          result.cleanupObjects += 1;
        } catch (error) {
          const errorCode = safeStorageErrorCode(error);
          await client.query(
            `UPDATE enough.task_evidence_object_cleanup
             SET attempt_count = attempt_count + 1,
                 next_attempt_at = now() + LEAST(interval '1 day',
                   interval '1 minute' * power(2, LEAST(attempt_count, 10))),
                 last_error_code = $2, updated_at = now()
             WHERE object_key = $1`,
            [item.object_key, errorCode],
          );
          result.failures += 1;
        }
      }
    }

    if (maxFinalize > 0) {
      const pending = await client.query<PendingUpload>(
        `SELECT id, user_id, storage_object_key, storage_staging_key,
                file_sha256, file_size, content_type
         FROM enough.task_evidence_items
         WHERE storage_state = 'FINALIZING' AND deleted_at IS NULL
         ORDER BY updated_at, created_at LIMIT $1`,
        [maxFinalize],
      );
      for (const item of pending.rows) {
        try {
          const finalized = await finalizeEvidenceUpload(item.id, item.user_id);
          if (finalized) result.finalizedUploads += 1;
        } catch {
          await client.query(
            "UPDATE enough.task_evidence_items SET updated_at = now() WHERE id = $1 AND storage_state = 'FINALIZING'",
            [item.id],
          );
          result.failures += 1;
        }
      }
    }

    if (maxScan > 0) {
      let remaining = maxScan;
      for (const prefix of ["objects", "staging"] as const) {
        if (remaining === 0) break;
        const objectPrefix = prefix === "objects" ? "obj-" : "stage-";
        const cursor = await client.query<{ continuation_token: string | null }>(
          "SELECT continuation_token FROM enough.task_evidence_storage_reconcile_state WHERE id = $1",
          [prefix],
        );
        const page = await storage.list({
          prefix: objectPrefix,
          continuationToken: cursor.rows[0]?.continuation_token ?? undefined,
          maxKeys: Math.min(50, remaining),
        });
        for (const item of page.objects) {
          result.scannedObjects += 1;
          remaining -= 1;
          if (!item.lastModified || item.lastModified.getTime() > Date.now() - orphanGraceMs)
            continue;
          const referenced = await client.query(
            `SELECT 1 FROM enough.task_evidence_items
             WHERE storage_object_key = $1 OR storage_staging_key = $1 LIMIT 1`,
            [item.key],
          );
          if (referenced.rowCount) continue;
          try {
            await storage.delete(item.key);
            await client.query(
              "DELETE FROM enough.task_evidence_object_cleanup WHERE object_key = $1",
              [item.key],
            );
            result.removedOrphans += 1;
          } catch (error) {
            await client.query(
              `INSERT INTO enough.task_evidence_object_cleanup
                 (object_key, evidence_id, user_id, reason, attempt_count, last_error_code)
               VALUES ($1, NULL, NULL, 'ORPHAN', 1, $2)
               ON CONFLICT (object_key) DO UPDATE SET
                 attempt_count = enough.task_evidence_object_cleanup.attempt_count + 1,
                 last_error_code = EXCLUDED.last_error_code,
                 next_attempt_at = now() + interval '1 minute', updated_at = now()`,
              [item.key, safeStorageErrorCode(error)],
            );
            result.failures += 1;
          }
        }
        await client.query(
          `UPDATE enough.task_evidence_storage_reconcile_state
           SET continuation_token = $2, updated_at = now() WHERE id = $1`,
          [prefix, page.nextToken ?? null],
        );
      }
    }

    await client.query(
      `UPDATE enough.task_evidence_storage_reconcile_runs SET
         finished_at = now(), cleanup_objects = $2, finalized_uploads = $3,
         scanned_objects = $4, removed_orphans = $5, failures = $6
       WHERE id = $1`,
      [
        runId,
        result.cleanupObjects,
        result.finalizedUploads,
        result.scannedObjects,
        result.removedOrphans,
        result.failures,
      ],
    );
    return result;
  } catch (error) {
    result.failures += 1;
    await client
      .query(
        `UPDATE enough.task_evidence_storage_reconcile_runs SET
           finished_at = now(), cleanup_objects = $2, finalized_uploads = $3,
           scanned_objects = $4, removed_orphans = $5, failures = $6, error_code = $7
         WHERE id = $1`,
        [
          runId,
          result.cleanupObjects,
          result.finalizedUploads,
          result.scannedObjects,
          result.removedOrphans,
          result.failures,
          safeStorageErrorCode(error),
        ],
      )
      .catch(() => undefined);
    return result;
  } finally {
    if (locked) {
      await client
        .query("SELECT pg_advisory_unlock(hashtext('enough:evidence-object-storage-reconcile'))")
        .catch(() => undefined);
    }
    client.release();
  }
}

export async function closeEvidenceObjectStore(): Promise<void> {
  clientToClose?.destroy();
  clientToClose = undefined;
  store = undefined;
}
