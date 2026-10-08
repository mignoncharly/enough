import { createHash, randomUUID } from "node:crypto";
import { checkRateLimit } from "@enough/auth";
import { pool } from "@enough/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireCsrf, requireSession } from "./api-auth.js";
import { grantVerifiedTaskRewardInTransaction } from "./credits.js";
import { insertNotification } from "./notifications.js";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_UPLOAD_REQUEST_BYTES = 2_850_000;
const MAX_USER_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_USER_EVIDENCE_ITEMS = 200;
const evidenceTypes = [
  "SELF_REPORT",
  "NOTE",
  "URL",
  "UPLOAD",
  "SCREENSHOT",
  "INTEGRATION",
] as const;
const evidenceStatuses = ["PENDING", "VERIFIED", "REJECTED"] as const;
const completionStatuses = [
  "SELF_REPORTED",
  "AWAITING_EVIDENCE",
  "AWAITING_REVIEW",
  "VERIFIED",
  "AUTOMATICALLY_VERIFIED",
  "REJECTED",
] as const;
const integrationProviders = [
  "gmail",
  "google_calendar",
  "outlook",
  "microsoft_calendar",
  "stripe",
  "posthog",
  "plausible",
  "ga4",
  "webhook",
  "public_api",
  "other",
] as const;

const httpUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .url()
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  }, "Use an HTTP or HTTPS link.");

const createEvidenceSchema = z
  .object({
    completionId: z.string().uuid(),
    evidenceType: z.enum(evidenceTypes),
    title: z.string().trim().min(2).max(160).optional(),
    note: z.string().trim().min(2).max(5000).optional(),
    url: httpUrlSchema.optional(),
    integrationProvider: z.enum(integrationProviders).optional(),
    integrationReference: z.string().trim().min(1).max(300).optional(),
    fileName: z.string().trim().min(1).max(500).optional(),
    contentType: z.enum(["image/png", "image/jpeg", "image/webp", "application/pdf"]).optional(),
    fileContentBase64: z
      .string()
      .min(4)
      .max(Math.ceil(MAX_UPLOAD_BYTES / 3) * 4)
      .optional(),
  })
  .strict()
  .superRefine((body, context) => {
    const hasAnyFileField = Boolean(body.fileName || body.contentType || body.fileContentBase64);
    if (["SELF_REPORT", "NOTE"].includes(body.evidenceType) && !body.note) {
      context.addIssue({
        code: "custom",
        message: "Add a short note for this evidence.",
        path: ["note"],
      });
    }
    if (body.evidenceType === "URL" && !body.url) {
      context.addIssue({ code: "custom", message: "Add an HTTP or HTTPS link.", path: ["url"] });
    }
    if (
      ["UPLOAD", "SCREENSHOT"].includes(body.evidenceType) &&
      (!body.fileName || !body.contentType || !body.fileContentBase64)
    ) {
      context.addIssue({
        code: "custom",
        message: "Choose a supported file to upload.",
        path: ["fileContentBase64"],
      });
    }
    if (body.evidenceType === "SCREENSHOT" && body.contentType === "application/pdf") {
      context.addIssue({
        code: "custom",
        message: "Screenshots must be PNG, JPEG, or WebP images.",
        path: ["contentType"],
      });
    }
    if (
      body.evidenceType === "INTEGRATION" &&
      (!body.integrationProvider || !body.integrationReference)
    ) {
      context.addIssue({
        code: "custom",
        message: "Choose a source and enter its event reference.",
        path: ["integrationReference"],
      });
    }
    if (!["UPLOAD", "SCREENSHOT"].includes(body.evidenceType) && hasAnyFileField) {
      context.addIssue({
        code: "custom",
        message: "Files can only be attached as uploads or screenshots.",
        path: ["fileContentBase64"],
      });
    }
    if (body.evidenceType !== "URL" && body.url) {
      context.addIssue({
        code: "custom",
        message: "Links can only be attached as URL evidence.",
        path: ["url"],
      });
    }
    if (
      body.evidenceType !== "INTEGRATION" &&
      (body.integrationProvider || body.integrationReference)
    ) {
      context.addIssue({
        code: "custom",
        message: "Integration fields require integration evidence.",
        path: ["integrationProvider"],
      });
    }
  });

const evidenceListQuerySchema = z.object({ productId: z.string().uuid() }).strict();
const decisionSchema = z
  .object({
    decision: z.enum(["VERIFIED", "REJECTED"]),
    reason: z.string().trim().min(3).max(1000).optional(),
  })
  .strict()
  .refine((body) => body.decision !== "REJECTED" || Boolean(body.reason), {
    message: "Add a reason when rejecting evidence.",
    path: ["reason"],
  });

interface EvidenceRow {
  id: string;
  completion_id: string;
  task_id: string;
  product_id: string;
  user_id: string;
  evidence_type: (typeof evidenceTypes)[number];
  title: string;
  note: string | null;
  evidence_url: string | null;
  integration_provider: (typeof integrationProviders)[number] | null;
  integration_reference: string | null;
  provenance: "USER_SUBMITTED" | "SERVER_VERIFIED";
  original_file_name: string | null;
  content_type: string | null;
  file_size: number | null;
  file_sha256: string | null;
  verification_status: (typeof evidenceStatuses)[number];
  reviewed_by_user_id: string | null;
  reviewed_at: Date | null;
  review_note: string | null;
  verification_method: "MANUAL" | "AUTOMATIC";
  created_at: Date;
  updated_at: Date;
}

interface CompletionRow {
  id: string;
  task_id: string;
  product_id: string;
  user_id: string;
  task_title: string;
  task_status: string;
  verification_status: (typeof completionStatuses)[number];
  reward_credits: number;
  credit_transaction_id: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: Date | null;
  review_note: string | null;
  completed_at: Date;
}

interface ReviewRow {
  evidence_id: string;
  completion_id: string;
  task_id: string;
  task_title: string;
  product_id: string;
  evidence_status: (typeof evidenceStatuses)[number];
  evidence_type: (typeof evidenceTypes)[number];
  reward_credits: number;
  credit_transaction_id: string | null;
  completion_status: (typeof completionStatuses)[number];
  task_status: string;
}

function evidenceResponse(row: EvidenceRow) {
  return {
    id: row.id,
    completionId: row.completion_id,
    taskId: row.task_id,
    productId: row.product_id,
    evidenceType: row.evidence_type,
    title: row.title,
    note: row.note,
    url: row.evidence_url,
    integrationProvider: row.integration_provider,
    integrationReference: row.integration_reference,
    provenance: row.provenance,
    fileName: row.original_file_name,
    contentType: row.content_type,
    fileSize: row.file_size,
    fileSha256: row.file_sha256,
    contentUrl: row.file_size ? `/api/evidence/${row.id}/content` : null,
    verificationStatus: row.verification_status,
    verificationMethod: row.verification_method,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    reviewNote: row.review_note,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function completionResponse(row: CompletionRow, evidence: EvidenceRow[]) {
  return {
    id: row.id,
    taskId: row.task_id,
    productId: row.product_id,
    taskTitle: row.task_title,
    taskStatus: row.task_status,
    verificationStatus: row.verification_status,
    rewardCredits: row.reward_credits,
    creditTransactionId: row.credit_transaction_id,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    reviewNote: row.review_note,
    completedAt: row.completed_at.toISOString(),
    evidence: evidence.filter((item) => item.completion_id === row.id).map(evidenceResponse),
  };
}

function evidenceIdFrom(request: FastifyRequest): string | null {
  const parsed = z
    .string()
    .uuid()
    .safeParse((request.params as { evidenceId?: string }).evidenceId);
  return parsed.success ? parsed.data : null;
}

function detectFileType(
  bytes: Buffer,
): "image/png" | "image/jpeg" | "image/webp" | "application/pdf" | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (bytes.length >= 5 && bytes.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

function safeFileName(value: string): string {
  const base =
    value
      .split(/[\\/]/)
      .pop()
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip control characters from untrusted uploaded filenames.
      ?.replace(/[\u0000-\u001f\u007f]/g, "")
      .trim() ?? "";
  return base.replace(/[^A-Za-z0-9._ ()-]/g, "_").slice(0, 160) || "evidence-upload";
}

function sendEvidenceError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  request.log.error({ err: error }, "Task evidence operation failed");
  return reply.code(503).send({ error: "The evidence could not be saved. Try again shortly." });
}

export async function registerEvidenceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/task-evidence", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!(await checkRateLimit(request, reply, "evidence:read", session.id, 120, 60))) return;
    const parsed = evidenceListQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Choose a valid product." });
    try {
      const product = await pool.query(
        "SELECT 1 FROM enough.products WHERE id = $1 AND user_id = $2",
        [parsed.data.productId, session.id],
      );
      if (product.rowCount !== 1) return reply.code(404).send({ error: "Product not found." });
      const [completions, evidence] = await Promise.all([
        pool.query<CompletionRow>(
          `SELECT completion.id, completion.task_id, completion.product_id, completion.user_id,
                  task.title AS task_title, task.status AS task_status,
                  completion.verification_status, completion.reward_credits,
                  completion.credit_transaction_id, completion.reviewed_by_user_id,
                  completion.reviewed_at, completion.review_note, completion.completed_at
           FROM enough.growth_task_completions completion
           JOIN enough.growth_tasks task ON task.id = completion.task_id
           WHERE completion.product_id = $1 AND completion.user_id = $2
             AND (completion.verification_status IN ('AWAITING_EVIDENCE', 'AWAITING_REVIEW', 'REJECTED') OR
                  EXISTS (
                    SELECT 1 FROM enough.task_evidence_items pending_evidence
                    WHERE pending_evidence.completion_id = completion.id
                      AND pending_evidence.verification_status = 'PENDING'
                      AND pending_evidence.deleted_at IS NULL
                  ) OR
                  completion.id IN (
                    SELECT recent.id FROM enough.growth_task_completions recent
                    WHERE recent.product_id = $1 AND recent.user_id = $2
                    ORDER BY recent.completed_at DESC LIMIT 250
                  ))
           ORDER BY CASE WHEN completion.verification_status IN ('AWAITING_EVIDENCE', 'AWAITING_REVIEW', 'REJECTED') THEN 0 ELSE 1 END,
                    completion.completed_at DESC`,
          [parsed.data.productId, session.id],
        ),
        pool.query<EvidenceRow>(
          `SELECT id, completion_id, task_id, product_id, user_id, evidence_type, title, note,
                  evidence_url, integration_provider, integration_reference, provenance,
                  original_file_name, content_type, file_size, file_sha256, verification_status,
                  reviewed_by_user_id, reviewed_at, review_note, verification_method, created_at, updated_at
           FROM enough.task_evidence_items
           WHERE product_id = $1 AND user_id = $2 AND deleted_at IS NULL
           ORDER BY created_at DESC LIMIT 500`,
          [parsed.data.productId, session.id],
        ),
      ]);
      return reply.send({
        productId: parsed.data.productId,
        completions: completions.rows.map((item) => completionResponse(item, evidence.rows)),
      });
    } catch (error) {
      return sendEvidenceError(request, reply, error);
    }
  });

  app.post("/task-evidence", { bodyLimit: MAX_UPLOAD_REQUEST_BYTES }, async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "evidence:create", session.id, 40, 60 * 60))) return;
    const parsed = createEvidenceSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? "Review the evidence details." });
    const body = parsed.data;
    let fileData: Buffer | null = null;
    let fileSha256: string | null = null;
    let fileName: string | null = null;
    let contentType: string | null = null;
    if (body.fileContentBase64 && body.fileName && body.contentType) {
      if (
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          body.fileContentBase64,
        )
      ) {
        return reply.code(400).send({ error: "The uploaded file encoding is invalid." });
      }
      fileData = Buffer.from(body.fileContentBase64, "base64");
      if (
        fileData.length === 0 ||
        fileData.length > MAX_UPLOAD_BYTES ||
        fileData.toString("base64") !== body.fileContentBase64
      ) {
        return reply.code(413).send({ error: "Uploads must be a valid file of 2 MiB or less." });
      }
      contentType = detectFileType(fileData) ?? null;
      if (
        !contentType ||
        contentType !== body.contentType ||
        (body.evidenceType === "SCREENSHOT" && contentType === "application/pdf")
      ) {
        return reply
          .code(400)
          .send({ error: "The file content does not match a supported file type." });
      }
      if (!(await checkRateLimit(request, reply, "evidence:upload", session.id, 10, 60 * 60)))
        return;
      fileName = safeFileName(body.fileName);
      fileSha256 = createHash("sha256").update(fileData).digest("hex");
    }
    const evidenceId = randomUUID();
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
      const completionResult = await client.query<CompletionRow>(
        `SELECT completion.id, completion.task_id, completion.product_id, completion.user_id,
                task.title AS task_title, task.status AS task_status,
                completion.verification_status, completion.reward_credits,
                completion.credit_transaction_id, completion.reviewed_by_user_id,
                completion.reviewed_at, completion.review_note, completion.completed_at
         FROM enough.growth_task_completions completion
         JOIN enough.growth_tasks task ON task.id = completion.task_id
         WHERE completion.id = $1 AND completion.user_id = $2
         FOR UPDATE OF completion`,
        [body.completionId, session.id],
      );
      const completion = completionResult.rows[0];
      if (completion?.task_status !== "COMPLETED") {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Completed task not found." });
      }
      if (
        ["VERIFIED", "AUTOMATICALLY_VERIFIED", "SELF_REPORTED"].includes(
          completion.verification_status,
        )
      ) {
        await client.query("ROLLBACK");
        return reply
          .code(409)
          .send({ error: "This completion is locked and cannot accept more evidence." });
      }
      const usage = await client.query<{ item_count: string; file_bytes: string }>(
        `SELECT count(*) FILTER (WHERE deleted_at IS NULL)::text AS item_count,
                COALESCE(sum(file_size) FILTER (WHERE deleted_at IS NULL), 0)::text AS file_bytes
         FROM enough.task_evidence_items WHERE user_id = $1`,
        [session.id],
      );
      if (Number(usage.rows[0].item_count) >= MAX_USER_EVIDENCE_ITEMS) {
        await client.query("ROLLBACK");
        return reply
          .code(413)
          .send({ error: "This account has reached the 200 evidence item limit." });
      }
      if (fileData && Number(usage.rows[0].file_bytes) + fileData.length > MAX_USER_UPLOAD_BYTES) {
        await client.query("ROLLBACK");
        return reply
          .code(413)
          .send({ error: "This account has reached the 20 MiB evidence upload limit." });
      }
      const title =
        body.title?.trim() ||
        (body.evidenceType === "URL"
          ? "Reference link"
          : body.evidenceType === "UPLOAD" || body.evidenceType === "SCREENSHOT"
            ? (fileName ?? "File attachment")
            : body.evidenceType === "INTEGRATION"
              ? `${body.integrationProvider} event`
              : body.evidenceType === "SELF_REPORT"
                ? "Self-report"
                : "Evidence note");
      const inserted = await client.query<EvidenceRow>(
        `INSERT INTO enough.task_evidence_items
           (id, completion_id, task_id, product_id, user_id, evidence_type, title, note,
            evidence_url, integration_provider, integration_reference, provenance,
            original_file_name, content_type, file_size, file_sha256, file_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'USER_SUBMITTED',
                 $12, $13, $14, $15, $16)
         RETURNING id, completion_id, task_id, product_id, user_id, evidence_type, title, note,
                   evidence_url, integration_provider, integration_reference, provenance,
                   original_file_name, content_type, file_size, file_sha256, verification_status,
                   reviewed_by_user_id, reviewed_at, review_note, verification_method, created_at, updated_at`,
        [
          evidenceId,
          completion.id,
          completion.task_id,
          completion.product_id,
          session.id,
          body.evidenceType,
          title,
          body.note ?? null,
          body.url ?? null,
          body.integrationProvider ?? null,
          body.integrationReference ?? null,
          fileName,
          contentType,
          fileData?.length ?? null,
          fileSha256,
          fileData,
        ],
      );
      await client.query(
        `UPDATE enough.growth_task_completions
         SET verification_status = 'AWAITING_REVIEW', reviewed_by_user_id = NULL, reviewed_at = NULL,
             review_note = NULL
         WHERE id = $1 AND verification_status IN ('AWAITING_EVIDENCE', 'REJECTED')`,
        [completion.id],
      );
      await client.query(
        `INSERT INTO enough.auth_audit_events (id, user_id, device_id, event_type, metadata)
         VALUES ($1, $2, $3, 'task_evidence.created', $4::jsonb)`,
        [
          randomUUID(),
          session.id,
          session.deviceId,
          JSON.stringify({
            evidenceId,
            completionId: completion.id,
            evidenceType: body.evidenceType,
            fileSize: fileData?.length ?? null,
          }),
        ],
      );
      await client.query("COMMIT");
      return reply.code(201).send({ evidence: evidenceResponse(inserted.rows[0]) });
    } catch (error) {
      await client.query("ROLLBACK");
      return sendEvidenceError(request, reply, error);
    } finally {
      client.release();
    }
  });

  app.get("/task-evidence/:evidenceId/content", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!(await checkRateLimit(request, reply, "evidence:content", session.id, 60, 60))) return;
    const evidenceId = evidenceIdFrom(request);
    if (!evidenceId) return reply.code(400).send({ error: "Invalid evidence ID." });
    try {
      const result = await pool.query<{
        content_type: string;
        file_data: Buffer;
        file_size: number;
        original_file_name: string;
      }>(
        `SELECT content_type, file_data, file_size, original_file_name
         FROM enough.task_evidence_items WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND file_data IS NOT NULL`,
        [evidenceId, session.id],
      );
      const file = result.rows[0];
      if (!file) return reply.code(404).send({ error: "Evidence file not found." });
      const disposition = file.content_type.startsWith("image/") ? "inline" : "attachment";
      const safeName =
        file.original_file_name.replace(/[^A-Za-z0-9._ ()-]/g, "_").slice(0, 160) ||
        "evidence-upload";
      return reply
        .header("content-type", file.content_type)
        .header("content-length", String(file.file_size))
        .header("content-disposition", `${disposition}; filename="${safeName}"`)
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'; sandbox")
        .header("cache-control", "private, no-store")
        .send(file.file_data);
    } catch (error) {
      return sendEvidenceError(request, reply, error);
    }
  });

  app.delete("/task-evidence/:evidenceId", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    const evidenceId = evidenceIdFrom(request);
    if (!evidenceId) return reply.code(400).send({ error: "Invalid evidence ID." });
    if (!(await checkRateLimit(request, reply, "evidence:delete", session.id, 30, 60 * 60))) return;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const user = await client.query("SELECT id FROM enough.auth_users WHERE id = $1 FOR UPDATE", [
        session.id,
      ]);
      if (user.rowCount !== 1) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Evidence not found." });
      }
      const removed = await client.query(
        `UPDATE enough.task_evidence_items
         SET evidence_type = 'NOTE', title = 'Evidence deleted', note = 'This evidence was deleted by the account owner.',
             evidence_url = NULL, integration_provider = NULL, integration_reference = NULL,
             original_file_name = NULL, content_type = NULL, file_size = NULL, file_sha256 = NULL,
             file_data = NULL, review_note = NULL, provenance = 'USER_SUBMITTED',
             deleted_at = COALESCE(deleted_at, now()), updated_at = now()
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
         RETURNING id, completion_id`,
        [evidenceId, session.id],
      );
      if (removed.rowCount !== 1) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Evidence not found." });
      }
      await client.query(
        `INSERT INTO enough.auth_audit_events (id, user_id, event_type, metadata)
         VALUES ($1, $2, 'privacy.evidence.deleted', $3::jsonb)`,
        [randomUUID(), session.id, JSON.stringify({ evidenceId })],
      );
      await client.query(
        `UPDATE enough.growth_task_completions completion
         SET verification_status = 'AWAITING_EVIDENCE'
         WHERE completion.id = $1 AND completion.user_id = $2
           AND completion.verification_status = 'AWAITING_REVIEW'
           AND NOT EXISTS (
             SELECT 1 FROM enough.task_evidence_items evidence
             WHERE evidence.completion_id = completion.id AND evidence.deleted_at IS NULL
           )`,
        [removed.rows[0].completion_id, session.id],
      );
      await client.query("COMMIT");
      return reply.send({ deleted: true, evidenceId });
    } catch (error) {
      await client.query("ROLLBACK");
      return sendEvidenceError(request, reply, error);
    } finally {
      client.release();
    }
  });

  app.post("/task-evidence/:evidenceId/decision", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    const evidenceId = evidenceIdFrom(request);
    if (!evidenceId) return reply.code(400).send({ error: "Invalid evidence ID." });
    const parsed = decisionSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? "Review the decision." });
    if (!(await checkRateLimit(request, reply, "evidence:review", session.id, 30, 60 * 60))) return;
    try {
      const preview = await pool.query<{
        completion_id: string;
        reward_credits: number;
        verification_status: (typeof completionStatuses)[number];
        credit_transaction_id: string | null;
      }>(
        `SELECT evidence.completion_id, completion.reward_credits,
                completion.verification_status, completion.credit_transaction_id
         FROM enough.task_evidence_items evidence
         JOIN enough.growth_task_completions completion ON completion.id = evidence.completion_id
         WHERE evidence.id = $1 AND evidence.user_id = $2 AND evidence.deleted_at IS NULL`,
        [evidenceId, session.id],
      );
      if (!preview.rows[0]) return reply.code(404).send({ error: "Evidence not found." });
      const previewCompletion = preview.rows[0];
      if (
        parsed.data.decision === "VERIFIED" &&
        previewCompletion.reward_credits > 0 &&
        !previewCompletion.credit_transaction_id &&
        !["VERIFIED", "AUTOMATICALLY_VERIFIED", "SELF_REPORTED"].includes(
          previewCompletion.verification_status,
        ) &&
        !(await checkRateLimit(request, reply, "credits:grant", session.id, 10, 60 * 60))
      )
        return;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const user = await client.query(
          "SELECT id FROM enough.auth_users WHERE id = $1 FOR UPDATE",
          [session.id],
        );
        if (user.rowCount !== 1) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "Account not found." });
        }
        const locked = await client.query<ReviewRow>(
          `SELECT evidence.id AS evidence_id, evidence.completion_id AS completion_id,
                  evidence.task_id AS task_id, evidence.product_id AS product_id,
                  evidence.evidence_type, evidence.title, evidence.note, evidence.evidence_url,
                  evidence.integration_provider, evidence.integration_reference, evidence.provenance,
                  evidence.original_file_name, evidence.content_type, evidence.file_size, evidence.file_sha256,
                  evidence.verification_status AS evidence_status,
                  completion.verification_status AS completion_status, completion.reward_credits,
                  completion.credit_transaction_id, task.status AS task_status, task.title AS task_title
           FROM enough.task_evidence_items evidence
           JOIN enough.growth_task_completions completion ON completion.id = evidence.completion_id
           JOIN enough.growth_tasks task ON task.id = completion.task_id
           WHERE evidence.id = $1 AND evidence.user_id = $2 AND evidence.deleted_at IS NULL
           FOR UPDATE OF evidence, completion`,
          [evidenceId, session.id],
        );
        const current = locked.rows[0];
        if (!current) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "Evidence not found." });
        }
        if (current.evidence_status !== "PENDING") {
          if (current.evidence_status === parsed.data.decision) {
            await client.query("COMMIT");
            return reply.send({
              evidenceId,
              verificationStatus: current.evidence_status,
              completionStatus: current.completion_status,
              creditTransactionId: current.credit_transaction_id,
              rewardIssued: false,
              replayed: true,
            });
          }
          await client.query("ROLLBACK");
          return reply
            .code(409)
            .send({ error: "This evidence already has a different review decision." });
        }
        const clock = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
        const reviewedAt = clock.rows[0].now;
        await client.query(
          `UPDATE enough.task_evidence_items
           SET verification_status = $2, reviewed_by_user_id = $3, reviewed_at = $4,
               review_note = $5, verification_method = 'MANUAL', updated_at = $4
           WHERE id = $1`,
          [evidenceId, parsed.data.decision, session.id, reviewedAt, parsed.data.reason ?? null],
        );
        let creditTransactionId = current.credit_transaction_id;
        let completionStatus = current.completion_status;
        let rewardIssued = false;
        if (parsed.data.decision === "VERIFIED") {
          if (current.task_status !== "COMPLETED") {
            await client.query("ROLLBACK");
            return reply
              .code(409)
              .send({ error: "Evidence can only be verified for a completed task." });
          }
          if (!["SELF_REPORTED", "VERIFIED"].includes(current.completion_status)) {
            creditTransactionId = await grantVerifiedTaskRewardInTransaction(client, {
              userId: session.id,
              deviceId: session.deviceId,
              productId: current.product_id,
              taskId: current.task_id,
              completionId: current.completion_id,
              evidenceId,
              amount: current.reward_credits,
              verificationMethod: "MANUAL",
            });
            rewardIssued = Boolean(creditTransactionId);
            completionStatus = "VERIFIED";
            await client.query(
              `UPDATE enough.growth_task_completions
               SET verification_status = 'VERIFIED', reviewed_by_user_id = $2, reviewed_at = $3,
                   review_note = $4, credit_transaction_id = $5
               WHERE id = $1`,
              [
                current.completion_id,
                session.id,
                reviewedAt,
                parsed.data.reason ?? null,
                creditTransactionId,
              ],
            );
          }
        } else if (!["SELF_REPORTED", "VERIFIED"].includes(current.completion_status)) {
          const remaining = await client.query<{ pending: boolean; verified: boolean }>(
            `SELECT bool_or(verification_status = 'PENDING') AS pending,
                    bool_or(verification_status = 'VERIFIED') AS verified
             FROM enough.task_evidence_items WHERE completion_id = $1`,
            [current.completion_id],
          );
          if (!remaining.rows[0].pending && !remaining.rows[0].verified) {
            completionStatus = "REJECTED";
            await client.query(
              `UPDATE enough.growth_task_completions
               SET verification_status = 'REJECTED', reviewed_by_user_id = $2, reviewed_at = $3,
                   review_note = $4 WHERE id = $1`,
              [current.completion_id, session.id, reviewedAt, parsed.data.reason ?? null],
            );
          }
        }
        await client.query(
          `INSERT INTO enough.auth_audit_events (id, user_id, device_id, event_type, metadata)
           VALUES ($1, $2, $3, 'task_evidence.reviewed', $4::jsonb)`,
          [
            randomUUID(),
            session.id,
            session.deviceId,
            JSON.stringify({
              evidenceId,
              completionId: current.completion_id,
              decision: parsed.data.decision,
              rewardCredits: parsed.data.decision === "VERIFIED" ? current.reward_credits : 0,
            }),
          ],
        );
        if (rewardIssued && current.reward_credits > 0) {
          await insertNotification(client, {
            userId: session.id,
            productId: current.product_id,
            type: "CREDIT_EARNED",
            title: "Task reward verified",
            body: current.reward_credits + " credits were added for “" + current.task_title + "”.",
            href: `/evidence?productId=${current.product_id}`,
            dedupeKey: `reward:${current.completion_id}`,
          });
        }
        await client.query("COMMIT");
        return reply.send({
          evidenceId,
          verificationStatus: parsed.data.decision,
          completionStatus,
          creditTransactionId,
          rewardIssued,
          replayed: false,
        });
      } catch (error) {
        await client.query("ROLLBACK");
        return sendEvidenceError(request, reply, error);
      } finally {
        client.release();
      }
    } catch (error) {
      return sendEvidenceError(request, reply, error);
    }
  });
}
