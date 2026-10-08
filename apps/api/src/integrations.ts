import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  checkRateLimit,
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  hashIntegrationCredential,
  newIntegrationCredential,
} from "@enough/auth";
import { pool } from "@enough/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireCsrf, requireSession } from "./api-auth.js";
import {
  type IntegrationProvider,
  integrationAdapter,
  integrationCatalog,
  type NormalizedIntegrationEvent,
} from "./integration-adapters.js";
import { insertNotification } from "./notifications.js";

const createIntegrationSchema = z
  .object({
    productId: z.string().uuid(),
    provider: z.enum(["WEBHOOK", "PUBLIC_API"]),
    displayName: z.string().trim().min(2).max(100),
  })
  .strict();
const integrationListQuerySchema = z.object({ productId: z.string().uuid() }).strict();
const integrationIdSchema = z.string().uuid();

interface IntegrationAccountRow {
  id: string;
  user_id: string;
  product_id: string;
  provider: IntegrationProvider;
  display_name: string;
  status: "ACTIVE" | "ERROR" | "REVOKED";
  api_key_hash: Buffer | null;
  signing_secret_ciphertext: Buffer | null;
  last_received_at: Date | null;
  created_at: Date;
}

interface IntegrationEventRow {
  id: string;
  integration_account_id: string;
  provider_event_id: string;
  event_type: string;
  verification_status: "AUTHENTICATED" | "REJECTED";
  occurred_at: Date;
  received_at: Date;
  completion_id: string | null;
  evidence_id: string | null;
  amount_minor: string | null;
  currency: string | null;
  payload_hash?: string;
}

interface IntegrationCompletionRow {
  id: string;
  task_id: string;
  product_id: string;
  user_id: string;
  task_status: string;
  verification_status: string;
  credit_transaction_id: string | null;
}

function rawBodyFrom(request: FastifyRequest): Buffer | null {
  return (request as FastifyRequest & { rawIntegrationBody?: Buffer }).rawIntegrationBody ?? null;
}

function eventResponse(row: IntegrationEventRow) {
  return {
    id: row.id,
    eventId: row.provider_event_id,
    eventType: row.event_type,
    verificationStatus: row.verification_status,
    occurredAt: row.occurred_at.toISOString(),
    receivedAt: row.received_at.toISOString(),
    completionId: row.completion_id,
    evidenceId: row.evidence_id,
    amountMinor: row.amount_minor === null ? null : Number(row.amount_minor),
    currency: row.currency,
  };
}

function accountResponse(row: IntegrationAccountRow, recentEvents: IntegrationEventRow[] = []) {
  const adapter = integrationAdapter(row.provider);
  const health =
    adapter?.getHealth({ status: row.status, lastReceivedAt: row.last_received_at }) ??
    (row.status === "REVOKED"
      ? "REVOKED"
      : row.status === "ERROR"
        ? "ERROR"
        : row.last_received_at
          ? "CONNECTED"
          : "IDLE");
  return {
    id: row.id,
    productId: row.product_id,
    provider: row.provider,
    displayName: row.display_name,
    status: row.status,
    health,
    lastReceivedAt: row.last_received_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    recentEvents: recentEvents.map(eventResponse),
  };
}

function auditMetadata(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

function requestHeaders(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  return {
    apiKey:
      typeof authorization === "string" && authorization.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : "",
    timestamp: request.headers["x-enough-timestamp"],
    signature: request.headers["x-enough-signature"],
  };
}

function canonicalPayload(
  event: NormalizedIntegrationEvent,
  userReferenceHash: string | null,
): string {
  return JSON.stringify({
    eventId: event.eventId,
    eventType: event.eventType,
    occurredAt: new Date(event.occurredAt).toISOString(),
    completionId: event.completionId ?? null,
    userReference: userReferenceHash,
    amountMinor: event.amountMinor ?? null,
    currency: event.currency ?? null,
  });
}

function sendIntegrationError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  request.log.error({ err: error }, "Integration operation failed");
  return reply
    .code(503)
    .send({ error: "The integration action could not be completed. Try again shortly." });
}

export async function registerIntegrationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/integrations", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!(await checkRateLimit(request, reply, "integrations:read", session.id, 60, 60))) return;
    const parsed = integrationListQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Choose a valid product." });
    try {
      const product = await pool.query(
        "SELECT 1 FROM enough.products WHERE id = $1 AND user_id = $2",
        [parsed.data.productId, session.id],
      );
      if (product.rowCount !== 1) return reply.code(404).send({ error: "Product not found." });
      const [accounts, events] = await Promise.all([
        pool.query<IntegrationAccountRow>(
          `SELECT id, user_id, product_id, provider, display_name, status,
                  api_key_hash, signing_secret_ciphertext, last_received_at, created_at
           FROM enough.integration_accounts WHERE product_id = $1 AND user_id = $2
           ORDER BY created_at DESC`,
          [parsed.data.productId, session.id],
        ),
        pool.query<IntegrationEventRow>(
          `SELECT id, integration_account_id, provider_event_id, event_type,
                  verification_status, occurred_at, received_at, completion_id, evidence_id,
                  amount_minor::text AS amount_minor, currency
           FROM enough.integration_events WHERE product_id = $1 AND user_id = $2
           ORDER BY received_at DESC LIMIT 200`,
          [parsed.data.productId, session.id],
        ),
      ]);
      const eventsByAccount = new Map<string, IntegrationEventRow[]>();
      for (const event of events.rows) {
        const current = eventsByAccount.get(event.integration_account_id) ?? [];
        if (current.length < 20) current.push(event);
        eventsByAccount.set(event.integration_account_id, current);
      }
      return reply.send({
        productId: parsed.data.productId,
        catalog: integrationCatalog,
        accounts: accounts.rows.map((account) =>
          accountResponse(account, eventsByAccount.get(account.id) ?? []),
        ),
      });
    } catch (error) {
      return sendIntegrationError(request, reply, error);
    }
  });

  app.post("/integrations", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "integrations:create", session.id, 15, 60 * 60)))
      return;
    const parsed = createIntegrationSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? "Review the integration details." });
    const adapter = integrationAdapter(parsed.data.provider);
    if (!adapter) return reply.code(400).send({ error: "This provider is not available yet." });

    const apiKey = `enp_live_${newIntegrationCredential()}`;
    const signingSecret = `enp_whsec_${newIntegrationCredential()}`;
    const integrationId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const product = await client.query(
        "SELECT id FROM enough.products WHERE id = $1 AND user_id = $2 FOR UPDATE",
        [parsed.data.productId, session.id],
      );
      if (product.rowCount !== 1) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Product not found." });
      }
      const created = await client.query<IntegrationAccountRow>(
        `INSERT INTO enough.integration_accounts
           (id, user_id, product_id, provider, display_name, api_key_hash, signing_secret_ciphertext)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, user_id, product_id, provider, display_name, status,
                   api_key_hash, signing_secret_ciphertext, last_received_at, created_at`,
        [
          integrationId,
          session.id,
          parsed.data.productId,
          parsed.data.provider,
          parsed.data.displayName,
          hashIntegrationCredential(apiKey),
          encryptIntegrationSecret(signingSecret),
        ],
      );
      await client.query(
        `INSERT INTO enough.auth_audit_events (id, user_id, device_id, event_type, metadata)
         VALUES ($1, $2, $3, 'integration.connected', $4::jsonb)`,
        [
          randomUUID(),
          session.id,
          session.deviceId,
          auditMetadata({
            integrationId,
            productId: parsed.data.productId,
            provider: parsed.data.provider,
          }),
        ],
      );
      await client.query("COMMIT");
      return reply.code(201).send({
        account: accountResponse(created.rows[0]),
        credentials: {
          apiKey,
          signingSecret,
          contentType: "application/vnd.enough.event+json",
          signatureFormat:
            "sha256=HMAC_SHA256(signingSecret, unixTimestamp + '.' + exactRequestBodyBytes)",
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      return sendIntegrationError(request, reply, error);
    } finally {
      client.release();
    }
  });

  app.post("/integrations/:integrationId/revoke", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "integrations:revoke", session.id, 30, 60 * 60)))
      return;
    const integrationId = integrationIdSchema.safeParse(
      (request.params as { integrationId?: string }).integrationId,
    );
    if (!integrationId.success) return reply.code(400).send({ error: "Invalid integration ID." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const account = await client.query<{
        id: string;
        status: string;
        provider: IntegrationProvider;
        product_id: string;
      }>(
        `SELECT id, status, provider, product_id FROM enough.integration_accounts
         WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [integrationId.data, session.id],
      );
      const current = account.rows[0];
      if (!current) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Integration not found." });
      }
      if (current.status !== "REVOKED") {
        await client.query(
          `UPDATE enough.integration_accounts
           SET status = 'REVOKED', api_key_hash = NULL, signing_secret_ciphertext = NULL,
               revoked_at = now(), updated_at = now()
           WHERE id = $1`,
          [current.id],
        );
        await client.query(
          "DELETE FROM enough.integration_tokens WHERE integration_account_id = $1",
          [current.id],
        );
        await client.query(
          `INSERT INTO enough.auth_audit_events (id, user_id, device_id, event_type, metadata)
           VALUES ($1, $2, $3, 'integration.disconnected', $4::jsonb)`,
          [
            randomUUID(),
            session.id,
            session.deviceId,
            auditMetadata({
              integrationId: current.id,
              productId: current.product_id,
              provider: current.provider,
            }),
          ],
        );
      }
      await client.query("COMMIT");
      return reply.send({ integrationId: current.id, status: "REVOKED" });
    } catch (error) {
      await client.query("ROLLBACK");
      return sendIntegrationError(request, reply, error);
    } finally {
      client.release();
    }
  });

  app.post("/v1/events", async (request, reply) => {
    const headers = requestHeaders(request);
    const rawBody = rawBodyFrom(request);
    if (!headers.apiKey || headers.apiKey.length > 160 || !rawBody) {
      return reply.code(401).send({ error: "Integration credentials are required." });
    }
    if (!(await checkRateLimit(request, reply, "integrations:event:ip", request.ip, 300, 60)))
      return;
    const keyHash = hashIntegrationCredential(headers.apiKey);
    let account: IntegrationAccountRow | undefined;
    try {
      const found = await pool.query<IntegrationAccountRow>(
        `SELECT id, user_id, product_id, provider, display_name, status,
                api_key_hash, signing_secret_ciphertext, last_received_at, created_at
         FROM enough.integration_accounts WHERE api_key_hash = $1 AND status = 'ACTIVE'`,
        [keyHash],
      );
      account = found.rows[0];
      if (!account?.signing_secret_ciphertext)
        return reply.code(401).send({ error: "Integration credentials are invalid or revoked." });
      if (
        !(await checkRateLimit(request, reply, "integrations:event:account", account.id, 120, 60))
      )
        return;
      const timestamp = typeof headers.timestamp === "string" ? headers.timestamp : "";
      const signature = typeof headers.signature === "string" ? headers.signature : "";
      const unixTimestamp = Number(timestamp);
      if (
        !Number.isSafeInteger(unixTimestamp) ||
        Math.abs(Date.now() - unixTimestamp * 1000) > 5 * 60 * 1000
      ) {
        return reply.code(401).send({ error: "The signed event timestamp is missing or expired." });
      }
      const adapter = integrationAdapter(account.provider);
      if (!adapter)
        return reply.code(403).send({ error: "This integration does not accept inbound events." });
      const signingSecret = decryptIntegrationSecret(account.signing_secret_ciphertext);
      if (!adapter.verifyRequest({ secret: signingSecret, timestamp, signature, rawBody })) {
        return reply.code(401).send({ error: "The integration signature is invalid." });
      }
      let event: NormalizedIntegrationEvent;
      try {
        event = adapter.parseEvent(request.body);
      } catch (error) {
        if (error instanceof z.ZodError)
          return reply.code(400).send({ error: error.issues[0]?.message ?? "Invalid event." });
        throw error;
      }
      const occurredAt = new Date(event.occurredAt);
      const now = Date.now();
      if (
        occurredAt.getTime() > now + 5 * 60 * 1000 ||
        occurredAt.getTime() < now - 365 * 24 * 60 * 60 * 1000
      ) {
        return reply
          .code(400)
          .send({ error: "Event time must be within the last year and not in the future." });
      }
      const userReferenceHash = event.userReference
        ? createHmac("sha256", signingSecret).update(event.userReference).digest("hex")
        : null;
      const payloadHash = createHash("sha256")
        .update(canonicalPayload(event, userReferenceHash))
        .digest("hex");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const lockedAccount = await client.query<IntegrationAccountRow>(
          `SELECT id, user_id, product_id, provider, display_name, status,
                  api_key_hash, signing_secret_ciphertext, last_received_at, created_at
           FROM enough.integration_accounts
           WHERE id = $1 AND api_key_hash = $2 AND status = 'ACTIVE'
           FOR UPDATE`,
          [account.id, keyHash],
        );
        const currentAccount = lockedAccount.rows[0];
        if (!currentAccount?.signing_secret_ciphertext) {
          await client.query("ROLLBACK");
          return reply.code(401).send({ error: "This integration has been revoked." });
        }
        const existing = await client.query<IntegrationEventRow>(
          `SELECT id, integration_account_id, provider_event_id, event_type,
                  verification_status, occurred_at, received_at, completion_id, evidence_id,
                  amount_minor::text AS amount_minor, currency, payload_hash
           FROM enough.integration_events
           WHERE integration_account_id = $1 AND provider_event_id = $2`,
          [currentAccount.id, event.eventId],
        );
        if (existing.rows[0]) {
          await client.query("ROLLBACK");
          if (existing.rows[0].payload_hash && existing.rows[0].payload_hash !== payloadHash) {
            return reply
              .code(409)
              .send({ error: "This event ID was already used with different event data." });
          }
          return reply.send({
            event: eventResponse(existing.rows[0]),
            duplicate: true,
            rewardIssued: false,
          });
        }

        let completion: IntegrationCompletionRow | undefined;
        if (event.completionId) {
          const completionResult = await client.query<IntegrationCompletionRow>(
            `SELECT completion.id, completion.task_id, completion.product_id, completion.user_id,
                    task.status AS task_status, completion.verification_status,
                    completion.credit_transaction_id
             FROM enough.growth_task_completions completion
             JOIN enough.growth_tasks task ON task.id = completion.task_id
             WHERE completion.id = $1 AND completion.user_id = $2 AND completion.product_id = $3
             FOR UPDATE OF completion`,
            [event.completionId, currentAccount.user_id, currentAccount.product_id],
          );
          completion = completionResult.rows[0];
          if (completion?.task_status !== "COMPLETED") {
            await client.query("ROLLBACK");
            return reply.code(404).send({ error: "The linked completed task was not found." });
          }
          if (
            ["VERIFIED", "AUTOMATICALLY_VERIFIED", "SELF_REPORTED"].includes(
              completion.verification_status,
            )
          ) {
            await client.query("ROLLBACK");
            return reply.code(409).send({
              error: "This completion is already verified and cannot accept more evidence.",
            });
          }
        }

        const receivedAt = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
        const eventReceivedAt = receivedAt.rows[0].now;
        let evidenceId: string | null = null;
        const creditTransactionId = completion?.credit_transaction_id ?? null;
        if (completion) {
          evidenceId = randomUUID();
          const title = event.eventType.replaceAll(".", " ").replaceAll("_", " ");
          await client.query(
            `INSERT INTO enough.task_evidence_items
             (id, completion_id, task_id, product_id, user_id, evidence_type, title, note,
                integration_provider, integration_reference, provenance, verification_status,
                reviewed_at, review_note, verification_method)
             VALUES ($1, $2, $3, $4, $5, 'INTEGRATION', $6, $7, $8, $9, 'SERVER_VERIFIED',
                     'PENDING', NULL, NULL, 'MANUAL')`,
            [
              evidenceId,
              completion.id,
              completion.task_id,
              completion.product_id,
              completion.user_id,
              title,
              `Signed event received from ${currentAccount.display_name}.`,
              currentAccount.provider.toLowerCase(),
              event.eventId,
            ],
          );
          await client.query(
            `UPDATE enough.growth_task_completions
             SET verification_status = 'AWAITING_REVIEW', reviewed_by_user_id = NULL,
                 reviewed_at = NULL, review_note = NULL
             WHERE id = $1`,
            [completion.id],
          );
        }

        const inserted = await client.query<IntegrationEventRow>(
          `INSERT INTO enough.integration_events
             (id, integration_account_id, user_id, product_id, provider_event_id, event_type,
              user_reference_hash, amount_minor, currency, occurred_at, received_at, payload_hash,
              verification_status, completion_id, task_id, evidence_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                   'AUTHENTICATED', $13, $14, $15)
           RETURNING id, integration_account_id, provider_event_id, event_type, verification_status,
                     occurred_at, received_at, completion_id, evidence_id, amount_minor::text AS amount_minor, currency`,
          [
            randomUUID(),
            currentAccount.id,
            currentAccount.user_id,
            currentAccount.product_id,
            event.eventId,
            event.eventType,
            userReferenceHash,
            event.amountMinor ?? null,
            event.currency ?? null,
            occurredAt,
            eventReceivedAt,
            payloadHash,
            completion?.id ?? null,
            completion?.task_id ?? null,
            evidenceId,
          ],
        );
        await client.query(
          "UPDATE enough.integration_accounts SET last_received_at = $2, updated_at = $2 WHERE id = $1",
          [currentAccount.id, eventReceivedAt],
        );
        const milestoneLabels: Record<string, string> = {
          "email.reply_received": "customer reply",
          "calendar.interview_completed": "customer interview",
          "calendar.demo_completed": "product demo",
          "revenue.payment_received": "payment",
          "revenue.subscription_created": "subscription",
        };
        const milestone = milestoneLabels[event.eventType];
        if (milestone) {
          const product = await client.query<{ name: string }>(
            "SELECT name FROM enough.products WHERE id = $1 AND user_id = $2",
            [currentAccount.product_id, currentAccount.user_id],
          );
          if (product.rows[0]) {
            await insertNotification(client, {
              userId: currentAccount.user_id,
              productId: currentAccount.product_id,
              type: "MARKET_SIGNAL",
              title: "A market signal was recorded",
              body:
                "A " +
                milestone +
                " event was received for “" +
                product.rows[0].name +
                "” from " +
                currentAccount.display_name +
                ".",
              href: `/reports?productId=${currentAccount.product_id}`,
              dedupeKey: `signal:${inserted.rows[0].id}`,
            });
          }
        }
        if (completion && evidenceId) {
          await insertNotification(client, {
            userId: currentAccount.user_id,
            productId: currentAccount.product_id,
            type: "TASK_REVIEW",
            title: "Task evidence needs review",
            body:
              "A signed " +
              event.eventType.replaceAll(".", " ").replaceAll("_", " ") +
              " event was attached to a completed task. Review it before granting credits.",
            href: `/evidence?productId=${currentAccount.product_id}`,
            dedupeKey: `task-evidence:${evidenceId}`,
          });
        }
        await client.query(
          `INSERT INTO enough.auth_audit_events (id, user_id, event_type, metadata)
           VALUES ($1, $2, 'integration.event_authenticated', $3::jsonb)`,
          [
            randomUUID(),
            currentAccount.user_id,
            auditMetadata({
              integrationId: currentAccount.id,
              eventId: event.eventId,
              eventType: event.eventType,
              completionId: completion?.id ?? null,
              rewardIssued: false,
            }),
          ],
        );
        await client.query("COMMIT");
        return reply.code(202).send({
          event: eventResponse(inserted.rows[0]),
          duplicate: false,
          rewardIssued: false,
          creditTransactionId,
        });
      } catch (error) {
        await client.query("ROLLBACK");
        return sendIntegrationError(request, reply, error);
      } finally {
        client.release();
      }
    } catch (error) {
      return sendIntegrationError(request, reply, error);
    }
  });
}
