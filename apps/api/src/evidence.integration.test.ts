import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createEvidenceObjectKeys,
  evidenceObjectStore,
  reconcileEvidenceObjectStorage,
} from "@enough/evidence-storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe.skipIf(process.env.ENOUGH_PHASE13_INTEGRATION !== "1")(
  "Phase 13 private evidence and verified task rewards",
  () => {
    let pool: typeof import("@enough/db").pool;
    const userIds: string[] = [];
    const web = "http://127.0.0.1:3314";

    beforeAll(async () => {
      const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
      expect([target.hostname, target.port, target.pathname, target.username]).toEqual([
        "127.0.0.1",
        "55944",
        "/enough_phase13",
        "enough_phase13",
      ]);
      expect(process.env.REDIS_URL).toBe("redis://127.0.0.1:56407/0");
      expect(process.env.APP_BASE_URL).toBe(web);
      expect(process.env.API_BASE_URL).toBe("http://127.0.0.1:4424");
      expect(process.env.WORKER_PORT).toBe("4425");
      ({ pool } = await import("@enough/db"));
      const identity = await pool.query("SELECT current_user, current_database()");
      expect(identity.rows[0]).toEqual({
        current_user: "enough_phase13",
        current_database: "enough_phase13",
      });
      const migrations = await pool.query<{ id: string }>(
        "SELECT id FROM enough.schema_migrations WHERE id BETWEEN '0002_authentication.sql' AND '0019_evidence_object_storage_finalize.sql' ORDER BY id",
      );
      expect(migrations.rows.map((row) => row.id)).toContain("0010_evidence_system.sql");
      expect(migrations.rows.map((row) => row.id)).toContain("0011_integration_platform.sql");
      expect(migrations.rows.map((row) => row.id)).toContain(
        "0018_evidence_object_storage_prepare.sql",
      );
      expect(migrations.rows.map((row) => row.id)).toContain(
        "0019_evidence_object_storage_finalize.sql",
      );
      const legacyBlobColumn = await pool.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'enough' AND table_name = 'task_evidence_items' AND column_name = 'file_data'`,
      );
      expect(legacyBlobColumn.rowCount).toBe(0);
      expect(process.env.EVIDENCE_STORAGE_ENDPOINT).toBe("http://127.0.0.1:55945");
    }, 60000);

    afterAll(async () => {
      if (!pool) return;
      await pool.query("DELETE FROM enough.auth_audit_events WHERE user_id = ANY($1::uuid[])", [
        userIds,
      ]);
      await pool.query("DELETE FROM enough.auth_users WHERE id = ANY($1::uuid[])", [userIds]);
      await pool.end();
    });

    async function account() {
      const id = randomUUID();
      const email = `phase13-${id}@example.test`;
      userIds.push(id);
      await pool.query(
        "INSERT INTO enough.auth_users (id, email, email_normalized, email_verified_at) VALUES ($1, $2, $2, now())",
        [id, email],
      );
      const { createSession } = await import("../../../packages/auth/src/session.js");
      const session = await createSession(id, "web", "Phase 13 synthetic test", "magic_link");
      return {
        id,
        headers: {
          cookie: `enough_session=${session.token}; enough_csrf=${session.csrfToken}`,
          "x-csrf-token": session.csrfToken ?? "",
          origin: web,
          "content-type": "application/json",
        },
      };
    }

    type Account = Awaited<ReturnType<typeof account>>;

    function request(
      path: string,
      user?: Account | { headers: HeadersInit },
      body?: unknown,
      method?: string,
      headers: HeadersInit | undefined = user?.headers,
    ) {
      return fetch(`${web}/api${path}`, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });
    }

    async function payload(response: Response, status = 200) {
      expect(response.status, await response.clone().text()).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      return response.json();
    }

    async function product(user: Account, name = "Phase 13 evidence product") {
      const result = await payload(
        await request("/products", user, {
          name,
          productStage: "PROBLEM_VALIDATION",
          targetCustomer: "Synthetic product teams",
          problemStatement: "Verify private task evidence",
          initialGoal: "Earn credits only after a verified task",
        }),
        201,
      );
      return result.product.id as string;
    }

    async function completedTask(user: Account, productId: string, rewardCredits = 12) {
      const created = await payload(
        await request("/tasks", user, {
          productId,
          title: `Phase 13 completion ${randomUUID()}`,
          priority: 4,
          signalStrength: 4,
          estimatedMinutes: 25,
          rewardCredits,
        }),
        201,
      );
      const completed = await payload(
        await request(`/tasks/${created.task.id}/complete`, user, {}),
      );
      expect(completed.completion).toMatchObject({
        verificationStatus: "AWAITING_EVIDENCE",
        rewardCredits,
        creditTransactionId: null,
      });
      return { taskId: created.task.id as string, completionId: completed.completion.id as string };
    }

    async function addEvidence(
      user: Account,
      body: Record<string, unknown>,
      idempotencyKey?: string,
    ) {
      const headers = idempotencyKey
        ? { ...user.headers, "idempotency-key": idempotencyKey }
        : user.headers;
      const result = await payload(await request("/evidence", user, body, "POST", headers), 201);
      return result.evidence as {
        id: string;
        verificationStatus: string;
        provenance: string;
        fileName: string | null;
        url: string | null;
      };
    }

    it("keeps evidence scoped, retryable, and pending until a safe verified reward is issued once", async () => {
      expect(
        (await request("/evidence?productId=00000000-0000-4000-8000-000000000001")).status,
      ).toBe(401);
      const owner = await account();
      const other = await account();
      const ownerProduct = await product(owner);
      const otherProduct = await product(other, "Phase 13 other account product");
      const { completionId } = await completedTask(owner, ownerProduct, 12);
      const otherCompletion = await completedTask(other, otherProduct, 20);

      const missingCsrf = { ...owner.headers, "x-csrf-token": "" };
      expect(
        (
          await request(
            "/evidence",
            owner,
            { completionId, evidenceType: "NOTE", note: "This should be rejected." },
            "POST",
            missingCsrf,
          )
        ).status,
      ).toBe(403);
      const crossAccountEvidence = await request("/evidence", owner, {
        completionId: otherCompletion.completionId,
        evidenceType: "NOTE",
        note: "Cross-account evidence must not attach.",
      });
      expect(crossAccountEvidence.status).toBe(404);

      const integration = await addEvidence(owner, {
        completionId,
        evidenceType: "INTEGRATION",
        title: "User submitted webhook reference",
        integrationProvider: "webhook",
        integrationReference: "event:phase13-synthetic-42",
      });
      expect(integration).toMatchObject({
        verificationStatus: "PENDING",
        provenance: "USER_SUBMITTED",
      });
      expect((await request(`/evidence?productId=${ownerProduct}`, other)).status).toBe(404);
      expect((await request(`/evidence/${integration.id}/content`, other)).status).toBe(404);

      const decisionWithoutCsrf = await request(
        `/evidence/${integration.id}/decision`,
        owner,
        { decision: "VERIFIED" },
        "POST",
        missingCsrf,
      );
      expect(decisionWithoutCsrf.status).toBe(403);
      const rejectionWithoutReason = await request(`/evidence/${integration.id}/decision`, owner, {
        decision: "REJECTED",
      });
      expect(rejectionWithoutReason.status).toBe(400);
      const credentialBearingUrl = new URL("https://example.test/path");
      credentialBearingUrl.username = `phase13-${randomUUID()}`;
      credentialBearingUrl.password = randomUUID();
      expect(
        (
          await request("/evidence", owner, {
            completionId,
            evidenceType: "URL",
            title: "Credential-bearing URL",
            url: credentialBearingUrl.toString(),
          })
        ).status,
      ).toBe(400);
      const rejected = await payload(
        await request(`/evidence/${integration.id}/decision`, owner, {
          decision: "REJECTED",
          reason: "Reference needs context.",
        }),
      );
      expect(rejected).toMatchObject({ verificationStatus: "REJECTED", rewardIssued: false });

      const retry = await addEvidence(owner, {
        completionId,
        evidenceType: "SELF_REPORT",
        title: "Completion details",
        note: "I completed the task and recorded the customer response.",
      });
      const verified = await payload(
        await request(`/evidence/${retry.id}/decision`, owner, { decision: "VERIFIED" }),
      );
      expect(verified).toMatchObject({
        verificationStatus: "VERIFIED",
        completionStatus: "VERIFIED",
        rewardIssued: true,
        replayed: false,
      });
      const replay = await payload(
        await request(`/evidence/${retry.id}/decision`, owner, { decision: "VERIFIED" }),
      );
      expect(replay).toMatchObject({
        verificationStatus: "VERIFIED",
        rewardIssued: false,
        replayed: true,
      });
      const manualReview = await pool.query<{
        evidence_status: string;
        verification_method: string;
        reviewed_by_user_id: string;
        completion_status: string;
      }>(
        `SELECT evidence.verification_status AS evidence_status,
                evidence.verification_method, evidence.reviewed_by_user_id,
                completion.verification_status AS completion_status
         FROM enough.task_evidence_items evidence
         JOIN enough.growth_task_completions completion ON completion.id = evidence.completion_id
         WHERE evidence.id = $1`,
        [retry.id],
      );
      expect(manualReview.rows[0]).toEqual({
        evidence_status: "VERIFIED",
        verification_method: "MANUAL",
        reviewed_by_user_id: owner.id,
        completion_status: "VERIFIED",
      });
      expect(
        (
          await request(`/evidence/${retry.id}/decision`, owner, {
            decision: "REJECTED",
            reason: "Conflict.",
          })
        ).status,
      ).toBe(409);

      const ledger = await pool.query<{ transactions: string; balance: string }>(
        `SELECT count(t.id)::text AS transactions, max(a.available_balance)::text AS balance
         FROM enough.credit_transactions t
         JOIN enough.credit_accounts a ON a.id = t.account_id
         WHERE t.user_id = $1 AND t.idempotency_key = $2`,
        [owner.id, `taskreward:${completionId}`],
      );
      expect(ledger.rows[0]).toEqual({ transactions: "1", balance: "12" });
      const exported = await payload(await request("/auth/account/export", owner));
      const exportedEvidence = exported.taskEvidenceItems as Array<Record<string, unknown>>;
      expect(exportedEvidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: integration.id, provenance: "USER_SUBMITTED" }),
          expect.objectContaining({ id: retry.id, verification_status: "VERIFIED" }),
        ]),
      );
    });

    it("serves uploads privately, exports their bytes, deletes content, and cascades on account deletion", async () => {
      const owner = await account();
      const outsider = await account();
      const productId = await product(owner);
      const { completionId } = await completedTask(owner, productId, 0);
      const urlEvidence = await addEvidence(owner, {
        completionId,
        evidenceType: "URL",
        title: "Private source reference",
        url: "https://example.test/phase13-evidence",
      });
      expect(urlEvidence.url).toBe("https://example.test/phase13-evidence");
      const imageBytes = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52,
      ]);
      const screenshotBody = {
        completionId,
        evidenceType: "SCREENSHOT",
        title: "Synthetic screenshot evidence",
        fileName: "C:\\private\\phase13-secret-marker\\acceptance.png",
        contentType: "image/png",
        fileContentBase64: imageBytes.toString("base64"),
      };
      const uploadIdempotencyKey = randomUUID();
      const upload = await addEvidence(owner, screenshotBody, uploadIdempotencyKey);
      expect(upload.verificationStatus).toBe("PENDING");
      expect(upload.fileName).toBe("acceptance.png");
      const retry = await payload(
        await request("/evidence", owner, screenshotBody, "POST", {
          ...owner.headers,
          "idempotency-key": uploadIdempotencyKey,
        }),
        200,
      );
      expect(retry.evidence.id).toBe(upload.id);
      const stored = await pool.query<{
        storage_object_key: string;
        storage_staging_key: string | null;
        storage_state: string;
        file_size: number;
        file_sha256: string;
      }>(
        `SELECT storage_object_key, storage_staging_key, storage_state, file_size, file_sha256
         FROM enough.task_evidence_items WHERE id = $1`,
        [upload.id],
      );
      const objectKey = stored.rows[0].storage_object_key;
      expect(objectKey).toMatch(/^obj-[A-Za-z0-9_-]{43}$/);
      expect(stored.rows[0]).toMatchObject({
        storage_state: "READY",
        storage_staging_key: null,
        file_size: imageBytes.length,
        file_sha256: createHash("sha256").update(imageBytes).digest("hex"),
      });
      expect(JSON.stringify(upload)).not.toContain(objectKey);
      const object = await evidenceObjectStore().get(objectKey);
      expect(object.bytes).toEqual(imageBytes);
      expect(object.sha256).toBe(stored.rows[0].file_sha256.trim());
      const anonymousObject = await fetch(
        `${process.env.EVIDENCE_STORAGE_ENDPOINT}/${process.env.EVIDENCE_STORAGE_BUCKET}/${objectKey}`,
      );
      expect([401, 403]).toContain(anonymousObject.status);

      const downloaded = await request(`/evidence/${upload.id}/content`, owner);
      expect(downloaded.status).toBe(200);
      expect(downloaded.headers.get("content-type")).toContain("image/png");
      expect(downloaded.headers.get("cache-control")).toContain("no-store");
      expect(downloaded.headers.get("cache-control")).not.toContain("public");
      expect(downloaded.headers.get("x-content-type-options")).toBe("nosniff");
      expect(downloaded.headers.get("content-security-policy")).toContain("sandbox");
      expect(downloaded.headers.get("content-disposition")).toContain("acceptance.png");
      expect(downloaded.headers.get("content-disposition")).not.toContain("private");
      expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(imageBytes);
      expect((await request(`/evidence/${upload.id}/content`, outsider)).status).toBe(404);
      const listed = await payload(await request(`/evidence?productId=${productId}`, owner));
      expect(JSON.stringify(listed)).not.toContain(objectKey);

      const supportedUploads = [
        {
          fileName: "accepted.jpg",
          contentType: "image/jpeg",
          bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
        },
        {
          fileName: "accepted.webp",
          contentType: "image/webp",
          bytes: Buffer.from("RIFF0000WEBP"),
        },
        {
          fileName: "accepted.pdf",
          contentType: "application/pdf",
          bytes: Buffer.from("%PDF-1.7 synthetic"),
        },
      ] as const;
      const createdUploads = [];
      for (const item of supportedUploads) {
        createdUploads.push(
          await addEvidence(owner, {
            completionId,
            evidenceType: "UPLOAD",
            title: `Accepted ${item.contentType}`,
            fileName: item.fileName,
            contentType: item.contentType,
            fileContentBase64: item.bytes.toString("base64"),
          }),
        );
      }
      const pdf = await request(`/evidence/${createdUploads[2].id}/content`, owner);
      expect(pdf.status).toBe(200);
      expect(pdf.headers.get("content-disposition")).toContain("attachment");
      expect(Buffer.from(await pdf.arrayBuffer())).toEqual(supportedUploads[2].bytes);

      const unavailableUpload = await addEvidence(owner, {
        completionId,
        evidenceType: "UPLOAD",
        title: "Storage outage handling",
        fileName: "missing.png",
        contentType: "image/png",
        fileContentBase64: imageBytes.toString("base64"),
      });
      const unavailableKey = await pool.query<{ storage_object_key: string }>(
        "SELECT storage_object_key FROM enough.task_evidence_items WHERE id = $1",
        [unavailableUpload.id],
      );
      await evidenceObjectStore().delete(unavailableKey.rows[0].storage_object_key);
      const storageFailure = await request(`/evidence/${unavailableUpload.id}/content`, owner);
      expect(storageFailure.status).toBe(503);
      const storageFailureBody = await storageFailure.text();
      expect(storageFailureBody).toContain("Try again shortly.");
      expect(storageFailureBody).not.toContain(process.env.EVIDENCE_STORAGE_BUCKET);
      expect(storageFailureBody).not.toContain(unavailableKey.rows[0].storage_object_key);
      expect(storageFailureBody).not.toContain("NoSuchKey");
      expect((await request(`/evidence/${unavailableUpload.id}`, owner, {}, "DELETE")).status).toBe(
        200,
      );

      const invalidSignature = await request("/evidence", owner, {
        completionId,
        evidenceType: "UPLOAD",
        title: "Invalid image bytes",
        fileName: "invalid.png",
        contentType: "image/png",
        fileContentBase64: Buffer.from("not an image").toString("base64"),
      });
      expect(invalidSignature.status).toBe(400);
      const forbiddenScreenshotPdf = await request("/evidence", owner, {
        completionId,
        evidenceType: "SCREENSHOT",
        title: "PDF is not a screenshot",
        fileName: "document.pdf",
        contentType: "application/pdf",
        fileContentBase64: Buffer.from("%PDF-1.7 synthetic").toString("base64"),
      });
      expect(forbiddenScreenshotPdf.status).toBe(400);
      const oversizedImage = Buffer.alloc(2 * 1024 * 1024 + 1);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(oversizedImage);
      const oversized = await request("/evidence", owner, {
        completionId,
        evidenceType: "UPLOAD",
        title: "Oversized upload",
        fileName: "too-large.png",
        contentType: "image/png",
        fileContentBase64: oversizedImage.toString("base64"),
      });
      expect([400, 413]).toContain(oversized.status);

      const exported = await payload(await request("/auth/account/export", owner));
      const exportedEvidence = exported.taskEvidenceItems as Array<Record<string, unknown>>;
      expect(exportedEvidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: upload.id,
            file_content_base64: imageBytes.toString("base64"),
            file_sha256: createHash("sha256").update(imageBytes).digest("hex"),
          }),
        ]),
      );
      expect(JSON.stringify(exportedEvidence)).not.toContain("phase13-secret-marker");
      expect(JSON.stringify(exportedEvidence)).not.toContain(objectKey);

      expect((await request(`/evidence/${upload.id}`, owner, {}, "DELETE")).status).toBe(200);
      expect((await request(`/evidence/${upload.id}/content`, owner)).status).toBe(404);
      const tombstone = await pool.query<{
        original_file_name: string | null;
        file_sha256: string | null;
        storage_object_key: string | null;
        storage_staging_key: string | null;
        storage_state: string;
        deleted_at: Date | null;
      }>(
        `SELECT original_file_name, file_sha256, storage_object_key, storage_staging_key,
                storage_state, deleted_at
         FROM enough.task_evidence_items WHERE id = $1`,
        [upload.id],
      );
      expect(tombstone.rows[0]).toMatchObject({
        original_file_name: null,
        file_sha256: null,
        storage_object_key: null,
        storage_staging_key: null,
        storage_state: "NONE",
      });
      expect(tombstone.rows[0]?.deleted_at).toBeInstanceOf(Date);
      await expect(evidenceObjectStore().get(objectKey)).rejects.toBeTruthy();

      const cascadeTask = await completedTask(owner, productId, 0);
      const cascadeEvidence = await addEvidence(owner, {
        completionId: cascadeTask.completionId,
        evidenceType: "UPLOAD",
        title: "File evidence for account deletion cascade",
        fileName: "account-delete.png",
        contentType: "image/png",
        fileContentBase64: imageBytes.toString("base64"),
      });
      const cascadeObject = await pool.query<{ storage_object_key: string }>(
        "SELECT storage_object_key FROM enough.task_evidence_items WHERE id = $1",
        [cascadeEvidence.id],
      );
      await pool.query("DELETE FROM enough.auth_users WHERE id = $1", [owner.id]);
      const afterAccountDelete = await pool.query(
        "SELECT id FROM enough.task_evidence_items WHERE id = $1",
        [cascadeEvidence.id],
      );
      expect(afterAccountDelete.rowCount).toBe(0);
      const queuedCleanup = await pool.query(
        "SELECT 1 FROM enough.task_evidence_object_cleanup WHERE object_key = $1 AND reason = 'ACCOUNT_DELETE'",
        [cascadeObject.rows[0].storage_object_key],
      );
      expect(queuedCleanup.rowCount).toBe(1);
      await reconcileEvidenceObjectStorage({ maxFinalize: 0, maxScan: 0 });
      await expect(
        evidenceObjectStore().get(cascadeObject.rows[0].storage_object_key),
      ).rejects.toBeTruthy();
    });

    it("resumes a committed upload when S3 finalization fails, and hides backend errors", async () => {
      const owner = await account();
      const productId = await product(owner, "Phase 13 object finalization product");
      const { completionId } = await completedTask(owner, productId, 0);
      const bytes = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03, 0x04,
      ]);
      const fileSha256 = createHash("sha256").update(bytes).digest("hex");
      const title = "Retry after object finalization";
      const fileName = "retry.png";
      const idempotencyKey = randomUUID();
      const requestHash = createHash("sha256")
        .update(
          JSON.stringify({
            completionId,
            evidenceType: "UPLOAD",
            title,
            note: null,
            fileName,
            contentType: "image/png",
            fileSha256,
          }),
        )
        .digest("hex");
      const keys = createEvidenceObjectKeys();
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO enough.task_evidence_items
           (id, completion_id, task_id, product_id, user_id, evidence_type, title,
            provenance, original_file_name, content_type, file_size, file_sha256,
            storage_state, storage_object_key, storage_staging_key,
            upload_idempotency_key, upload_request_sha256)
         SELECT $1, completion.id, completion.task_id, completion.product_id, completion.user_id,
                'UPLOAD', $4, 'USER_SUBMITTED', $5, 'image/png', $6, $7,
                'FINALIZING', $8, $9, $10, $11
         FROM enough.growth_task_completions completion
         WHERE completion.id = $2 AND completion.user_id = $3
         RETURNING id`,
        [
          randomUUID(),
          completionId,
          owner.id,
          title,
          fileName,
          bytes.length,
          fileSha256,
          keys.objectKey,
          keys.stagingKey,
          idempotencyKey,
          requestHash,
        ],
      );
      const evidenceId = inserted.rows[0].id;
      const body = {
        completionId,
        evidenceType: "UPLOAD",
        title,
        fileName,
        contentType: "image/png",
        fileContentBase64: bytes.toString("base64"),
      };
      const missingStage = await request("/evidence", owner, body, "POST", {
        ...owner.headers,
        "idempotency-key": idempotencyKey,
      });
      expect(missingStage.status).toBe(503);
      const missingMessage = await missingStage.text();
      expect(missingMessage).toContain("could not be saved");
      expect(missingMessage).not.toContain(process.env.EVIDENCE_STORAGE_BUCKET);
      expect(missingMessage).not.toContain(keys.stagingKey);
      expect(missingMessage).not.toContain("NoSuchKey");
      const stillPending = await pool.query<{ storage_state: string }>(
        "SELECT storage_state FROM enough.task_evidence_items WHERE id = $1",
        [evidenceId],
      );
      expect(stillPending.rows[0].storage_state).toBe("FINALIZING");

      await evidenceObjectStore().putStaging({
        key: keys.stagingKey,
        bytes,
        sha256: fileSha256,
        contentType: "image/png",
      });
      const resumed = await payload(
        await request("/evidence", owner, body, "POST", {
          ...owner.headers,
          "idempotency-key": idempotencyKey,
        }),
        200,
      );
      expect(resumed.evidence.id).toBe(evidenceId);
      expect(resumed.evidence.fileAvailable).toBe(true);
      const restored = await request(`/evidence/${evidenceId}/content`, owner);
      expect(restored.status).toBe(200);
      expect(Buffer.from(await restored.arrayBuffer())).toEqual(bytes);
      expect((await request(`/evidence/${evidenceId}`, owner, {}, "DELETE")).status).toBe(200);
    });

    it("cleans a staged object after the database transaction fails and removes aged orphans", async () => {
      const owner = await account();
      const productId = await product(owner, "Phase 13 transaction cleanup product");
      const { completionId } = await completedTask(owner, productId, 0);
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const before = await evidenceObjectStore().list({ prefix: "stage-", maxKeys: 100 });
      await pool.query(`
        CREATE FUNCTION enough.phase13_reject_file_evidence() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.evidence_type IN ('UPLOAD', 'SCREENSHOT') THEN
            RAISE EXCEPTION 'synthetic transaction failure' USING ERRCODE = 'P0001';
          END IF;
          RETURN NEW;
        END $$
      `);
      await pool.query(`
        CREATE TRIGGER phase13_reject_file_evidence
        BEFORE INSERT ON enough.task_evidence_items
        FOR EACH ROW EXECUTE FUNCTION enough.phase13_reject_file_evidence()
      `);
      try {
        const failed = await request(
          "/evidence",
          owner,
          {
            completionId,
            evidenceType: "UPLOAD",
            title: "Transaction failure after staging",
            fileName: "failure.png",
            contentType: "image/png",
            fileContentBase64: bytes.toString("base64"),
          },
          "POST",
          { ...owner.headers, "idempotency-key": randomUUID() },
        );
        expect(failed.status).toBe(503);
        const body = await failed.text();
        expect(body).toContain("could not be saved");
        expect(body).not.toContain("synthetic transaction failure");
        expect(body).not.toContain(process.env.EVIDENCE_STORAGE_BUCKET);
      } finally {
        await pool.query("DROP TRIGGER phase13_reject_file_evidence ON enough.task_evidence_items");
        await pool.query("DROP FUNCTION enough.phase13_reject_file_evidence()");
      }
      const after = await evidenceObjectStore().list({ prefix: "stage-", maxKeys: 100 });
      expect(after.objects.map((item) => item.key)).toEqual(before.objects.map((item) => item.key));
      const orphanKeys = createEvidenceObjectKeys();
      await evidenceObjectStore().putStaging({
        key: orphanKeys.stagingKey,
        bytes,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        contentType: "image/png",
      });
      const reconciled = await reconcileEvidenceObjectStorage({
        maxCleanup: 0,
        maxFinalize: 0,
        maxScan: 100,
        orphanGraceMs: 0,
      });
      expect(reconciled.scannedObjects).toBeGreaterThan(0);
      expect(reconciled.removedOrphans).toBeGreaterThan(0);
      await expect(evidenceObjectStore().get(orphanKeys.stagingKey)).rejects.toBeTruthy();
      const audit = await pool.query<{ removed_orphans: number; scanned_objects: number }>(
        `SELECT removed_orphans, scanned_objects
         FROM enough.task_evidence_storage_reconcile_runs ORDER BY started_at DESC LIMIT 1`,
      );
      expect(audit.rows[0]?.removed_orphans).toBeGreaterThan(0);
      expect(audit.rows[0]?.scanned_objects).toBeLessThanOrEqual(100);
    });

    it("restores evidence metadata and its private object from a paired database/object backup", async () => {
      const owner = await account();
      const productId = await product(owner, "Phase 13 storage recovery product");
      const { completionId } = await completedTask(owner, productId, 0);
      const bytes = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52,
      ]);
      const uploaded = await addEvidence(owner, {
        completionId,
        evidenceType: "SCREENSHOT",
        title: "Paired backup recovery",
        fileName: "recovery.png",
        contentType: "image/png",
        fileContentBase64: bytes.toString("base64"),
      });
      const metadata = await pool.query<{
        storage_object_key: string;
        file_sha256: string;
        file_size: number;
        content_type: string;
      }>(
        `SELECT storage_object_key, file_sha256, file_size, content_type
         FROM enough.task_evidence_items WHERE id = $1 AND user_id = $2`,
        [uploaded.id, owner.id],
      );
      const original = metadata.rows[0];
      expect(original).toBeTruthy();
      const objectBackup = await evidenceObjectStore().get(original.storage_object_key);
      const backupDirectory = await mkdtemp(path.join(tmpdir(), "enough-phase13-restore-"));
      const databaseDump = path.join(backupDirectory, "database.dump");
      const objectBackupPath = path.join(backupDirectory, "evidence-object.bin");
      const restoreDatabase = `enough_phase13_restore_${randomUUID().replaceAll("-", "")}`;
      let databaseCreated = false;
      let stagingKey: string | undefined;
      const sourceDatabaseUrl = process.env.DATABASE_URL;
      const adminDatabaseUrl = process.env.PHASE13_RESTORE_ADMIN_DATABASE_URL;
      if (!sourceDatabaseUrl || !adminDatabaseUrl)
        throw new Error("The isolated PostgreSQL restore fixture is not configured.");

      function pgEnvironment(connectionString: string, databaseOverride?: string) {
        const parsed = new URL(connectionString);
        const environment = { ...process.env };
        for (const key of Object.keys(environment))
          if (key.startsWith("PG")) delete environment[key];
        environment.PGHOST = parsed.hostname;
        environment.PGPORT = parsed.port || "5432";
        environment.PGUSER = decodeURIComponent(parsed.username);
        environment.PGPASSWORD = decodeURIComponent(parsed.password);
        environment.PGDATABASE = databaseOverride ?? parsed.pathname.slice(1);
        return environment;
      }

      function run(command: string, args: string[], environment: NodeJS.ProcessEnv) {
        return new Promise<void>((resolve, reject) => {
          const child = spawn(command, args, {
            env: environment,
            stdio: "ignore",
            windowsHide: true,
          });
          child.once("error", () => reject(new Error("A PostgreSQL backup tool was unavailable.")));
          child.once("close", (code) =>
            code === 0
              ? resolve()
              : reject(new Error("The isolated PostgreSQL backup or restore command failed.")),
          );
        });
      }

      function capture(command: string, args: string[], environment: NodeJS.ProcessEnv) {
        return new Promise<string>((resolve, reject) => {
          const child = spawn(command, args, {
            env: environment,
            stdio: ["ignore", "pipe", "ignore"],
            windowsHide: true,
          });
          let output = "";
          child.stdout.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
          child.once("error", () =>
            reject(new Error("The isolated PostgreSQL query tool was unavailable.")),
          );
          child.once("close", (code) =>
            code === 0
              ? resolve(output.trim())
              : reject(new Error("The isolated PostgreSQL recovery query failed.")),
          );
        });
      }

      try {
        await writeFile(objectBackupPath, objectBackup.bytes);
        await run(
          "pg_dump",
          ["--format=custom", "--no-owner", "--no-acl", `--file=${databaseDump}`],
          pgEnvironment(sourceDatabaseUrl),
        );
        await run(
          "createdb",
          ["--maintenance-db=postgres", "--template=template0", restoreDatabase],
          pgEnvironment(adminDatabaseUrl, "postgres"),
        );
        databaseCreated = true;
        await run(
          "pg_restore",
          [
            "--no-owner",
            "--no-acl",
            "--exit-on-error",
            `--dbname=${restoreDatabase}`,
            databaseDump,
          ],
          pgEnvironment(adminDatabaseUrl, restoreDatabase),
        );
        const restoredMetadata = await capture(
          "psql",
          [
            "--no-psqlrc",
            "--tuples-only",
            "--no-align",
            "--set=ON_ERROR_STOP=1",
            `--command=SELECT storage_object_key || E'\\t' || file_sha256 || E'\\t' || file_size::text || E'\\t' || content_type FROM enough.task_evidence_items WHERE id = '${uploaded.id}'::uuid AND user_id = '${owner.id}'::uuid`,
          ],
          pgEnvironment(adminDatabaseUrl, restoreDatabase),
        );
        const [restoredObjectKey, restoredSha256, restoredSize, restoredType] =
          restoredMetadata.split("\t");
        if (!restoredObjectKey || !restoredSha256 || !restoredSize || !restoredType)
          throw new Error("The paired restore did not recover complete evidence metadata.");
        expect(restoredObjectKey).toBe(original.storage_object_key);
        expect(restoredSha256?.trim()).toBe(original.file_sha256.trim());
        expect(Number(restoredSize)).toBe(original.file_size);
        expect(restoredType).toBe(original.content_type);

        await evidenceObjectStore().delete(original.storage_object_key);
        const restoreKeys = createEvidenceObjectKeys();
        stagingKey = restoreKeys.stagingKey;
        await evidenceObjectStore().putStaging({
          key: stagingKey,
          bytes: await readFile(objectBackupPath),
          sha256: restoredSha256.trim(),
          contentType: restoredType,
        });
        await evidenceObjectStore().finalize({
          stagingKey,
          objectKey: restoredObjectKey,
          sha256: restoredSha256.trim(),
          size: Number(restoredSize),
          contentType: restoredType,
        });
        const restoredObject = await evidenceObjectStore().get(restoredObjectKey);
        expect(restoredObject.bytes).toEqual(bytes);
        expect(restoredObject.sha256).toBe(restoredSha256?.trim());
      } finally {
        if (stagingKey)
          await evidenceObjectStore()
            .delete(stagingKey)
            .catch(() => undefined);
        if (databaseCreated)
          await run(
            "dropdb",
            ["--maintenance-db=postgres", restoreDatabase],
            pgEnvironment(adminDatabaseUrl, "postgres"),
          );
        await rm(backupDirectory, { recursive: true, force: true });
      }
    }, 120000);

    it("rolls back evidence review and credit creation together when ledger persistence fails", async () => {
      const owner = await account();
      const productId = await product(owner);
      const { completionId } = await completedTask(owner, productId, 7);
      const evidence = await addEvidence(owner, {
        completionId,
        evidenceType: "NOTE",
        title: "Atomic reward evidence",
        note: "A transaction rollback must preserve pending evidence and a zero wallet.",
      });
      await pool.query(`
        CREATE OR REPLACE FUNCTION enough.phase13_test_reject_credit_lot()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'phase13 synthetic ledger failure';
        END;
        $$
      `);
      await pool.query(`
        CREATE TRIGGER phase13_test_reject_credit_lot
        BEFORE INSERT ON enough.credit_lots
        FOR EACH ROW EXECUTE FUNCTION enough.phase13_test_reject_credit_lot()
      `);
      try {
        const failed = await request(`/evidence/${evidence.id}/decision`, owner, {
          decision: "VERIFIED",
        });
        expect(failed.status).toBeGreaterThanOrEqual(500);
        const failureBody = await failed.text();
        expect(failureBody).not.toContain("phase13 synthetic ledger failure");
        expect(failureBody).not.toContain("C:\\Enough");
        const state = await pool.query<{
          evidence_status: string;
          completion_status: string;
          transactions: string;
          balance: string;
        }>(
          `SELECT e.verification_status AS evidence_status,
                  c.verification_status AS completion_status,
                  (SELECT count(*)::text FROM enough.credit_transactions t WHERE t.idempotency_key = $2) AS transactions,
                  (SELECT coalesce(max(available_balance), 0)::text FROM enough.credit_accounts a WHERE a.user_id = $1 AND a.product_id = e.product_id) AS balance
           FROM enough.task_evidence_items e
           JOIN enough.growth_task_completions c ON c.id = e.completion_id
           WHERE e.id = $3`,
          [owner.id, `taskreward:${completionId}`, evidence.id],
        );
        expect(state.rows[0]).toEqual({
          evidence_status: "PENDING",
          completion_status: "AWAITING_REVIEW",
          transactions: "0",
          balance: "0",
        });
      } finally {
        await pool.query(
          "DROP TRIGGER IF EXISTS phase13_test_reject_credit_lot ON enough.credit_lots",
        );
        await pool.query("DROP FUNCTION IF EXISTS enough.phase13_test_reject_credit_lot()");
      }

      const retry = await payload(
        await request(`/evidence/${evidence.id}/decision`, owner, { decision: "VERIFIED" }),
      );
      expect(retry).toMatchObject({
        verificationStatus: "VERIFIED",
        completionStatus: "VERIFIED",
        rewardIssued: true,
      });
    });

    it("enforces the per-account upload-byte and evidence-item quotas", async () => {
      const uploadOwner = await account();
      const uploadProduct = await product(uploadOwner, "Phase 13 upload quota product");
      const uploadTask = await completedTask(uploadOwner, uploadProduct, 0);
      const maxFile = Buffer.alloc(2 * 1024 * 1024);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(maxFile);
      const fileHash = createHash("sha256").update(maxFile).digest("hex");
      const fixtureObjectKeys = Array.from(
        { length: 10 },
        () => createEvidenceObjectKeys().objectKey,
      );
      const fixtureIdempotencyKeys = Array.from({ length: 10 }, () => randomUUID());
      await pool.query(
        `INSERT INTO enough.task_evidence_items
           (id, completion_id, task_id, product_id, user_id, evidence_type, title,
            original_file_name, content_type, file_size, file_sha256, storage_state,
            storage_object_key, upload_idempotency_key, upload_request_sha256)
         SELECT fixture.id, $2, $3, $4, $5, 'UPLOAD', 'Synthetic quota fixture',
                'quota.png', 'image/png', $6, $7, 'READY', fixture.object_key,
                fixture.idempotency_key, $9
         FROM unnest($1::uuid[], $8::text[], $10::uuid[])
           AS fixture(id, object_key, idempotency_key)`,
        [
          Array.from({ length: 10 }, () => randomUUID()),
          uploadTask.completionId,
          uploadTask.taskId,
          uploadProduct,
          uploadOwner.id,
          maxFile.length,
          fileHash,
          fixtureObjectKeys,
          createHash("sha256").update("synthetic upload quota row").digest("hex"),
          fixtureIdempotencyKeys,
        ],
      );
      const uploadQuota = await request("/evidence", uploadOwner, {
        completionId: uploadTask.completionId,
        evidenceType: "UPLOAD",
        title: "Over account upload quota",
        fileName: "extra.png",
        contentType: "image/png",
        fileContentBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString(
          "base64",
        ),
      });
      expect(uploadQuota.status).toBe(413);
      expect(await uploadQuota.text()).toContain("20 MiB");

      const itemOwner = await account();
      const itemProduct = await product(itemOwner, "Phase 13 item quota product");
      const itemTask = await completedTask(itemOwner, itemProduct, 0);
      await pool.query(
        `INSERT INTO enough.task_evidence_items
           (id, completion_id, task_id, product_id, user_id, evidence_type, title, note)
         SELECT id, $2, $3, $4, $5, 'NOTE', 'Synthetic quota fixture', 'Seeded pending evidence'
         FROM unnest($1::uuid[]) AS id`,
        [
          Array.from({ length: 200 }, () => randomUUID()),
          itemTask.completionId,
          itemTask.taskId,
          itemProduct,
          itemOwner.id,
        ],
      );
      const itemQuota = await request("/evidence", itemOwner, {
        completionId: itemTask.completionId,
        evidenceType: "NOTE",
        title: "Over account evidence quota",
        note: "This record must be rejected at the account item boundary.",
      });
      expect(itemQuota.status).toBe(413);
      expect(await itemQuota.text()).toContain("200 evidence item limit");
    });
  },
);
