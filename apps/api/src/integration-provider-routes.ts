import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { checkRateLimit, decryptIntegrationSecret, encryptIntegrationSecret } from "@enough/auth";
import { env } from "@enough/config";
import { type DbClient, pool } from "@enough/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireCsrf, requireSession } from "./api-auth.js";
import { grantVerifiedTaskRewardInTransaction } from "./credits.js";
import type { IntegrationProvider, NormalizedIntegrationEvent } from "./integration-adapters.js";
import {
  exchangeProviderAuthorizationCode,
  type IntegrationOAuthRuntime,
  integrationOAuthRuntimeFromEnvironment,
  type OAuthIntegrationProvider,
  OAuthProtocolError,
  oauthFamily,
  readProviderAccountId,
  refreshProviderAccessToken,
  requiredOAuthScopes,
} from "./integration-oauth.js";
import { integrationProviderAdapter, ProviderApiError } from "./integration-provider-adapters.js";
import { validateStripeRestrictedKey, verifyStripeWebhook } from "./integration-stripe.js";

export interface ProviderIntegrationRouteOptions {
  oauthRuntime?: IntegrationOAuthRuntime;
  fetcher?: typeof fetch;
}

interface AccountScopeRow {
  id: string;
  user_id: string;
  product_id: string;
  provider: IntegrationProvider;
  display_name: string;
  status: "ACTIVE" | "ERROR" | "REVOKED";
  signing_secret_ciphertext: Buffer | null;
  api_key_hash: Buffer | null;
}

interface TokenRow {
  access_token_ciphertext: Buffer;
  refresh_token_ciphertext: Buffer | null;
  token_type: string;
  scopes: string[];
  expires_at: Date | null;
}

interface ProviderConfigRow {
  configuration: Record<string, unknown>;
  credential_ciphertext: Buffer | null;
  provider_account_ciphertext: Buffer | null;
}

type AuthenticatedProviderEvent = NormalizedIntegrationEvent & {
  providerOriginVerified: true;
  automaticVerificationEligible: boolean;
};

const analyticsEventTypes = [
  "analytics.user_signup",
  "analytics.user_activated",
  "analytics.trial_started",
  "analytics.conversion_completed",
  "analytics.user_retained",
  "analytics.user_churned",
] as const;

const oauthStartSchema = z
  .object({
    productId: z.string().uuid(),
    provider: z.enum(["GMAIL", "GOOGLE_CALENDAR", "OUTLOOK", "MICROSOFT_CALENDAR", "GA4"]),
    displayName: z.string().trim().min(2).max(100),
    propertyId: z
      .string()
      .regex(/^[1-9]\d{0,19}$/)
      .optional(),
    eventMap: z.record(z.string().trim().min(1).max(100), z.enum(analyticsEventTypes)).optional(),
  })
  .strict();

const apiCredentialSchema = z
  .object({
    productId: z.string().uuid(),
    provider: z.enum(["POSTHOG", "PLAUSIBLE"]),
    displayName: z.string().trim().min(2).max(100),
    apiToken: z.string().trim().min(12).max(4096),
    projectId: z
      .string()
      .regex(/^\d{1,12}$/)
      .optional(),
    region: z.enum(["us", "eu"]).optional(),
    siteId: z
      .string()
      .trim()
      .min(1)
      .max(253)
      .regex(
        /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/,
      )
      .optional(),
    eventMap: z.record(z.string().trim().min(1).max(100), z.enum(analyticsEventTypes)),
  })
  .strict();

const stripeConnectSchema = z
  .object({
    productId: z.string().uuid(),
    displayName: z.string().trim().min(2).max(100),
    restrictedApiKey: z
      .string()
      .trim()
      .min(12)
      .max(255)
      .regex(/^(?:rkcs_test_|rk_(?:test|live)_)[A-Za-z0-9]+$/),
    accountId: z
      .string()
      .trim()
      .regex(/^acct_[A-Za-z0-9]+$/)
      .optional(),
    webhookSigningSecret: z
      .string()
      .trim()
      .min(16)
      .max(255)
      .regex(/^whsec_[A-Za-z0-9+/=_-]+$/),
  })
  .strict();

const integrationIdSchema = z.string().uuid();
const evidenceLinkSchema = z.object({ completionId: z.string().uuid() }).strict();

const oauthProviders: OAuthIntegrationProvider[] = [
  "GMAIL",
  "GOOGLE_CALENDAR",
  "OUTLOOK",
  "MICROSOFT_CALENDAR",
  "GA4",
];

function redirectUri(family: "google" | "microsoft"): string {
  const uri = new URL(`/integrations/oauth/${family}/callback`, env.API_BASE_URL);
  if (family === "microsoft" && process.env.ENOUGH_PHASE14_MICROSOFT_LOCALHOST_CALLBACK === "1") {
    uri.hostname = "localhost";
  }
  return uri.toString();
}

function safeReturnUrl(provider: OAuthIntegrationProvider, status: "connected" | "failed"): string {
  const url = new URL("/integrations", env.APP_BASE_URL);
  url.searchParams.set("provider", provider.toLowerCase());
  url.searchParams.set("connection", status);
  return url.toString();
}

function rawJsonBody(request: FastifyRequest): Buffer | null {
  return (request as FastifyRequest & { rawJsonBody?: Buffer }).rawJsonBody ?? null;
}

function safeIntegrationFailure(request: FastifyRequest, reply: FastifyReply) {
  request.log.error("Provider integration operation failed");
  return reply
    .code(503)
    .send({ error: "The provider action could not be completed. Try again shortly." });
}

function safeErrorCode(error: unknown): string {
  if (error instanceof ProviderApiError || error instanceof OAuthProtocolError) return error.code;
  return "PROVIDER_SYNC_FAILED";
}

type OAuthCallbackStage =
  | "TOKEN_EXCHANGE"
  | "REFRESH_TOKEN_CHECK"
  | "PROVIDER_IDENTITY"
  | "CONNECTION_PERSISTENCE";

function safeOAuthCallbackFailureCode(error: unknown, stage: OAuthCallbackStage): string {
  const code = safeErrorCode(error);
  if (code !== "PROVIDER_SYNC_FAILED") return code;
  return stage === "CONNECTION_PERSISTENCE"
    ? "CONNECTION_PERSISTENCE_FAILED"
    : "OAUTH_CALLBACK_FAILED";
}

async function recordOAuthCallbackFailure(input: {
  request: FastifyRequest;
  userId: string;
  deviceId: string | null;
  provider: OAuthIntegrationProvider;
  productId: string;
  failureCode: string;
  callbackStage: OAuthCallbackStage;
}): Promise<void> {
  let client: DbClient | null = null;
  try {
    client = await pool.connect();
    await client.query(
      `INSERT INTO enough.auth_audit_events (id, user_id, device_id, event_type, metadata)
       VALUES ($1, $2, $3, 'integration.connection_failed', $4::jsonb)`,
      [
        randomUUID(),
        input.userId,
        input.deviceId,
        JSON.stringify({
          productId: input.productId,
          provider: input.provider,
          failureCode: input.failureCode,
          callbackStage: input.callbackStage,
        }),
      ],
    );
  } catch {
    input.request.log.error("Provider connection failure could not be audited");
  } finally {
    client?.release();
  }
}

function getProviderConfig(options: ProviderIntegrationRouteOptions): IntegrationOAuthRuntime {
  return options.oauthRuntime ?? integrationOAuthRuntimeFromEnvironment();
}

async function assertOwnedProduct(userId: string, productId: string): Promise<boolean> {
  const result = await pool.query("SELECT 1 FROM enough.products WHERE id = $1 AND user_id = $2", [
    productId,
    userId,
  ]);
  return result.rowCount === 1;
}

async function insertOAuthConnection(input: {
  provider: OAuthIntegrationProvider;
  userId: string;
  productId: string;
  displayName: string;
  providerAccountId: string;
  configuration: Record<string, unknown>;
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  expiresAt: Date;
  scopes: string[];
  deviceId: string | null;
  setCallbackStage: (stage: OAuthCallbackStage) => void;
}): Promise<void> {
  const client = await pool.connect();
  const providerAccountHash = createHmac("sha256", env.AUTH_SECRET)
    .update(input.providerAccountId)
    .digest("hex");
  try {
    await client.query("BEGIN");
    const product = await client.query(
      "SELECT id FROM enough.products WHERE id = $1 AND user_id = $2 FOR UPDATE",
      [input.productId, input.userId],
    );
    if (product.rowCount !== 1) throw new ProviderApiError("PRODUCT_NOT_FOUND");
    const existing = await client.query<{ id: string; status: string }>(
      `SELECT account.id, account.status
       FROM enough.integration_accounts account
       JOIN enough.integration_provider_configs config ON config.integration_account_id = account.id
       WHERE account.user_id = $1 AND account.product_id = $2 AND account.provider = $3
         AND config.provider_account_hash = $4
       ORDER BY CASE account.status WHEN 'ACTIVE' THEN 0 WHEN 'ERROR' THEN 1 ELSE 2 END,
                account.created_at ASC
       FOR UPDATE OF account`,
      [input.userId, input.productId, input.provider, providerAccountHash],
    );
    const accountId = existing.rows[0]?.id ?? randomUUID();
    let refreshToken = input.refreshToken;
    if (!refreshToken) {
      input.setCallbackStage("REFRESH_TOKEN_CHECK");
      if (oauthFamily(input.provider) === "google") {
        for (const candidate of existing.rows.filter((row) => row.status === "ACTIVE")) {
          const stored = await client.query<{ refresh_token_ciphertext: Buffer | null }>(
            `SELECT refresh_token_ciphertext FROM enough.integration_tokens
             WHERE integration_account_id = $1 AND user_id = $2 AND product_id = $3
             FOR UPDATE`,
            [candidate.id, input.userId, input.productId],
          );
          const encryptedRefresh = stored.rows[0]?.refresh_token_ciphertext;
          if (!encryptedRefresh) continue;
          try {
            const existingRefreshToken = decryptIntegrationSecret(encryptedRefresh);
            if (existingRefreshToken.trim()) {
              refreshToken = existingRefreshToken;
              break;
            }
          } catch {
            // An unreadable stored token cannot satisfy the refresh requirement.
          }
        }
      }
      if (!refreshToken) throw new OAuthProtocolError("REFRESH_TOKEN_REQUIRED");
      input.setCallbackStage("CONNECTION_PERSISTENCE");
    }
    const duplicateIds = existing.rows
      .slice(1)
      .filter((row) => row.status !== "REVOKED")
      .map((row) => row.id);
    if (duplicateIds.length > 0) {
      await client.query(
        `UPDATE enough.integration_accounts
         SET status = 'REVOKED', revoked_at = now(), updated_at = now()
         WHERE id = ANY($1::uuid[]) AND status <> 'REVOKED'`,
        [duplicateIds],
      );
      await client.query(
        "DELETE FROM enough.integration_tokens WHERE integration_account_id = ANY($1::uuid[])",
        [duplicateIds],
      );
    }
    if (existing.rows[0]) {
      await client.query(
        `UPDATE enough.integration_accounts
         SET display_name = $2, scopes = $3, status = 'ACTIVE', connected_at = now(),
             revoked_at = NULL, updated_at = now()
         WHERE id = $1`,
        [accountId, input.displayName, input.scopes],
      );
    } else {
      await client.query(
        `INSERT INTO enough.integration_accounts
           (id, user_id, product_id, provider, display_name, scopes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [accountId, input.userId, input.productId, input.provider, input.displayName, input.scopes],
      );
    }
    await client.query(
      `INSERT INTO enough.integration_tokens
         (integration_account_id, user_id, product_id, access_token_ciphertext,
          refresh_token_ciphertext, token_type, scopes, expires_at, refreshed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (integration_account_id) DO UPDATE
         SET access_token_ciphertext = EXCLUDED.access_token_ciphertext,
             refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
             token_type = EXCLUDED.token_type, scopes = EXCLUDED.scopes,
             expires_at = EXCLUDED.expires_at, refreshed_at = now(), updated_at = now()`,
      [
        accountId,
        input.userId,
        input.productId,
        encryptIntegrationSecret(input.accessToken),
        encryptIntegrationSecret(refreshToken),
        input.tokenType,
        input.scopes,
        input.expiresAt,
      ],
    );
    await client.query(
      `INSERT INTO enough.integration_provider_configs
         (integration_account_id, user_id, product_id, configuration,
          provider_account_ciphertext, provider_account_hash)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       ON CONFLICT (integration_account_id) DO UPDATE
         SET configuration = EXCLUDED.configuration,
             provider_account_ciphertext = EXCLUDED.provider_account_ciphertext,
             provider_account_hash = EXCLUDED.provider_account_hash,
             updated_at = now()`,
      [
        accountId,
        input.userId,
        input.productId,
        JSON.stringify(input.configuration),
        encryptIntegrationSecret(input.providerAccountId),
        providerAccountHash,
      ],
    );
    await client.query(
      `INSERT INTO enough.auth_audit_events (id, user_id, device_id, event_type, metadata)
       VALUES ($1, $2, $3, 'integration.connected', $4::jsonb)`,
      [
        randomUUID(),
        input.userId,
        input.deviceId,
        JSON.stringify({
          integrationId: accountId,
          productId: input.productId,
          provider: input.provider,
        }),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getUsableAccessToken(
  client: DbClient,
  account: AccountScopeRow,
  config: ProviderIntegrationRouteOptions,
): Promise<{ accessToken: string; scopes: string[]; providerConfig: ProviderConfigRow }> {
  const tokenResult = await client.query<TokenRow>(
    `SELECT access_token_ciphertext, refresh_token_ciphertext, token_type, scopes, expires_at
     FROM enough.integration_tokens WHERE integration_account_id = $1 FOR UPDATE`,
    [account.id],
  );
  const tokens = tokenResult.rows[0];
  const providerConfigResult = await client.query<ProviderConfigRow>(
    `SELECT configuration, credential_ciphertext, provider_account_ciphertext
     FROM enough.integration_provider_configs WHERE integration_account_id = $1 FOR UPDATE`,
    [account.id],
  );
  const providerConfig = providerConfigResult.rows[0];
  if (!tokens || !providerConfig) throw new ProviderApiError("TOKEN_NOT_FOUND");
  let accessToken = decryptIntegrationSecret(tokens.access_token_ciphertext);
  if (tokens.expires_at && tokens.expires_at.getTime() <= Date.now() + 60_000) {
    if (!tokens.refresh_token_ciphertext) throw new ProviderApiError("REAUTHORIZATION_REQUIRED");
    if (!oauthProviders.includes(account.provider as OAuthIntegrationProvider))
      throw new ProviderApiError("REAUTHORIZATION_REQUIRED");
    const provider = account.provider as OAuthIntegrationProvider;
    const refreshed = await refreshProviderAccessToken({
      provider,
      runtime: getProviderConfig(config),
      refreshToken: decryptIntegrationSecret(tokens.refresh_token_ciphertext),
      scopes: tokens.scopes,
      fetcher: config.fetcher,
    });
    accessToken = refreshed.accessToken;
    await client.query(
      `UPDATE enough.integration_tokens
       SET access_token_ciphertext = $2, refresh_token_ciphertext = $3,
           expires_at = $4, scopes = $5, refreshed_at = now(), updated_at = now()
       WHERE integration_account_id = $1`,
      [
        account.id,
        encryptIntegrationSecret(refreshed.accessToken),
        encryptIntegrationSecret(
          refreshed.refreshToken ?? decryptIntegrationSecret(tokens.refresh_token_ciphertext),
        ),
        refreshed.expiresAt,
        refreshed.scopes,
      ],
    );
  }
  return { accessToken, scopes: tokens.scopes, providerConfig };
}

function normalizedPayloadHash(event: NormalizedIntegrationEvent): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        eventId: event.eventId,
        eventType: event.eventType,
        occurredAt: new Date(event.occurredAt).toISOString(),
        completionId: event.completionId ?? null,
        userReference: event.userReference ?? null,
        amountMinor: event.amountMinor ?? null,
        currency: event.currency ?? null,
      }),
    )
    .digest("hex");
}

async function insertVendorEvent(
  client: DbClient,
  account: AccountScopeRow,
  providerEvent: AuthenticatedProviderEvent,
  options: { allowAutomaticReward: boolean },
): Promise<{ inserted: boolean; evidenceId: string | null; rewardTransactionId: string | null }> {
  const occurredAt = new Date(providerEvent.occurredAt);
  if (
    !Number.isFinite(occurredAt.getTime()) ||
    occurredAt.getTime() > Date.now() + 5 * 60_000 ||
    occurredAt.getTime() < Date.now() - 366 * 86400_000
  )
    throw new ProviderApiError("EVENT_TIME_OUT_OF_RANGE");
  const payloadHash = normalizedPayloadHash(providerEvent);
  const userReferenceHash = providerEvent.userReference
    ? createHmac("sha256", env.AUTH_SECRET).update(providerEvent.userReference).digest("hex")
    : null;
  const insertion = await client.query<{
    id: string;
    provider_event_id: string;
    payload_hash: string;
  }>(
    `INSERT INTO enough.integration_events
       (id, integration_account_id, user_id, product_id, provider_event_id, event_type,
        user_reference_hash, amount_minor, currency, occurred_at, payload_hash,
        verification_status, completion_id, task_id, provider_origin_verified)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'AUTHENTICATED', NULL, NULL, true)
     ON CONFLICT DO NOTHING
     RETURNING id, provider_event_id, payload_hash`,
    [
      randomUUID(),
      account.id,
      account.user_id,
      account.product_id,
      providerEvent.eventId,
      providerEvent.eventType,
      userReferenceHash,
      providerEvent.amountMinor ?? null,
      providerEvent.currency ?? null,
      occurredAt,
      payloadHash,
    ],
  );
  if (!insertion.rows[0]) {
    const existing = await client.query<{
      id: string;
      payload_hash: string;
      event_type: string;
      user_reference_hash: string | null;
      amount_minor: string | null;
      currency: string | null;
      completion_id: string | null;
    }>(
      `SELECT id, payload_hash, event_type, user_reference_hash,
              amount_minor::text AS amount_minor, currency, completion_id
       FROM enough.integration_events
       WHERE integration_account_id = $1 AND provider_event_id = $2`,
      [account.id, providerEvent.eventId],
    );
    if (existing.rows[0] && existing.rows[0].payload_hash !== payloadHash) {
      const previous = existing.rows[0];
      const stableContinuationTimestampCorrection =
        ["GMAIL", "OUTLOOK"].includes(account.provider) &&
        providerEvent.eventType === "email.conversation_continued" &&
        previous.event_type === "email.conversation_continued" &&
        previous.user_reference_hash === null &&
        previous.amount_minor === null &&
        previous.currency === null &&
        previous.completion_id === null &&
        (providerEvent.userReference === undefined || providerEvent.userReference === null) &&
        (providerEvent.amountMinor === undefined || providerEvent.amountMinor === null) &&
        (providerEvent.currency === undefined || providerEvent.currency === null) &&
        (providerEvent.completionId === undefined || providerEvent.completionId === null);
      if (!stableContinuationTimestampCorrection) throw new ProviderApiError("EVENT_ID_CONFLICT");
      await client.query(
        `UPDATE enough.integration_events SET occurred_at = $2, payload_hash = $3
         WHERE id = $1`,
        [previous.id, occurredAt, payloadHash],
      );
    }
    return { inserted: false, evidenceId: null, rewardTransactionId: null };
  }

  if (!providerEvent.completionId)
    return { inserted: true, evidenceId: null, rewardTransactionId: null };
  const completionResult = await client.query<{
    id: string;
    task_id: string;
    product_id: string;
    user_id: string;
    task_title: string;
    task_status: string;
    verification_status: string;
    reward_credits: number;
    credit_transaction_id: string | null;
  }>(
    `SELECT completion.id, completion.task_id, completion.product_id, completion.user_id,
            task.title AS task_title, task.status AS task_status,
            completion.verification_status, completion.reward_credits,
            completion.credit_transaction_id
     FROM enough.growth_task_completions completion
     JOIN enough.growth_tasks task ON task.id = completion.task_id
     WHERE completion.id = $1 AND completion.product_id = $2 AND completion.user_id = $3
     FOR UPDATE OF completion`,
    [providerEvent.completionId, account.product_id, account.user_id],
  );
  const completion = completionResult.rows[0];
  if (
    completion?.task_status !== "COMPLETED" ||
    !["AWAITING_EVIDENCE", "AWAITING_REVIEW"].includes(completion.verification_status) ||
    completion.credit_transaction_id
  )
    return { inserted: true, evidenceId: null, rewardTransactionId: null };

  const automatic =
    options.allowAutomaticReward &&
    providerEvent.providerOriginVerified &&
    providerEvent.automaticVerificationEligible &&
    account.provider === "STRIPE";
  const evidenceId = randomUUID();
  const title = providerEvent.eventType.replaceAll(".", " ").replaceAll("_", " ");
  await client.query(
    `INSERT INTO enough.task_evidence_items
       (id, completion_id, task_id, product_id, user_id, evidence_type, title, note,
        integration_provider, integration_reference, provenance, verification_status,
        reviewed_at, verification_method)
     VALUES ($1, $2, $3, $4, $5, 'INTEGRATION', $6, $7, $8, $9, 'SERVER_VERIFIED',
             $10, CASE WHEN $10 = 'VERIFIED' THEN now() ELSE NULL END, $11)`,
    [
      evidenceId,
      completion.id,
      completion.task_id,
      completion.product_id,
      completion.user_id,
      title.slice(0, 160),
      automatic
        ? "Stripe confirmed the payment through its authenticated event API."
        : `A vendor-authenticated ${title} event was attached for owner review.`,
      account.provider.toLowerCase(),
      providerEvent.eventId,
      automatic ? "VERIFIED" : "PENDING",
      automatic ? "AUTOMATIC" : "MANUAL",
    ],
  );
  await client.query(
    `UPDATE enough.integration_events SET completion_id = $2, task_id = $3, evidence_id = $4
     WHERE integration_account_id = $1 AND provider_event_id = $5`,
    [account.id, completion.id, completion.task_id, evidenceId, providerEvent.eventId],
  );
  if (!automatic) {
    if (completion.verification_status === "AWAITING_EVIDENCE")
      await client.query(
        `UPDATE enough.growth_task_completions SET verification_status = 'AWAITING_REVIEW'
         WHERE id = $1 AND verification_status = 'AWAITING_EVIDENCE'`,
        [completion.id],
      );
    return { inserted: true, evidenceId, rewardTransactionId: null };
  }

  await client.query(
    `UPDATE enough.growth_task_completions
     SET verification_status = 'AUTOMATICALLY_VERIFIED', reviewed_at = now(),
         reviewed_by_user_id = NULL, review_note = 'Vendor-authenticated Stripe payment event'
     WHERE id = $1 AND verification_status IN ('AWAITING_EVIDENCE', 'AWAITING_REVIEW')
       AND credit_transaction_id IS NULL`,
    [completion.id],
  );
  const transactionId = await grantVerifiedTaskRewardInTransaction(client, {
    userId: completion.user_id,
    deviceId: null,
    productId: completion.product_id,
    taskId: completion.task_id,
    completionId: completion.id,
    evidenceId,
    amount: completion.reward_credits,
    verificationMethod: "AUTOMATIC",
  });
  await client.query(
    "UPDATE enough.growth_task_completions SET credit_transaction_id = $2 WHERE id = $1",
    [completion.id, transactionId],
  );
  return { inserted: true, evidenceId, rewardTransactionId: transactionId };
}

async function createProviderConnection(input: {
  userId: string;
  deviceId: string | null;
  productId: string;
  provider: "POSTHOG" | "PLAUSIBLE" | "STRIPE";
  displayName: string;
  accessToken: string;
  scopes: string[];
  configuration: Record<string, unknown>;
  credential?: string;
  providerAccountId?: string;
}): Promise<string> {
  const client = await pool.connect();
  const integrationId = randomUUID();
  try {
    await client.query("BEGIN");
    const product = await client.query(
      "SELECT id FROM enough.products WHERE id = $1 AND user_id = $2 FOR UPDATE",
      [input.productId, input.userId],
    );
    if (product.rowCount !== 1) throw new ProviderApiError("PRODUCT_NOT_FOUND");
    await client.query(
      `INSERT INTO enough.integration_accounts
         (id, user_id, product_id, provider, display_name, scopes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        integrationId,
        input.userId,
        input.productId,
        input.provider,
        input.displayName,
        input.scopes,
      ],
    );
    await client.query(
      `INSERT INTO enough.integration_tokens
         (integration_account_id, user_id, product_id, access_token_ciphertext,
          token_type, scopes)
       VALUES ($1, $2, $3, $4, 'Bearer', $5)`,
      [
        integrationId,
        input.userId,
        input.productId,
        encryptIntegrationSecret(input.accessToken),
        input.scopes,
      ],
    );
    await client.query(
      `INSERT INTO enough.integration_provider_configs
         (integration_account_id, user_id, product_id, configuration, credential_ciphertext,
          provider_account_ciphertext, provider_account_hash)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
      [
        integrationId,
        input.userId,
        input.productId,
        JSON.stringify(input.configuration),
        input.credential ? encryptIntegrationSecret(input.credential) : null,
        input.providerAccountId ? encryptIntegrationSecret(input.providerAccountId) : null,
        input.providerAccountId
          ? createHmac("sha256", env.AUTH_SECRET).update(input.providerAccountId).digest("hex")
          : null,
      ],
    );
    await client.query(
      `INSERT INTO enough.auth_audit_events (id, user_id, device_id, event_type, metadata)
       VALUES ($1, $2, $3, 'integration.connected', $4::jsonb)`,
      [
        randomUUID(),
        input.userId,
        input.deviceId,
        JSON.stringify({
          integrationId,
          productId: input.productId,
          provider: input.provider,
        }),
      ],
    );
    await client.query("COMMIT");
    return integrationId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function responseHeaders(request: FastifyRequest): { signature?: string } {
  const value = request.headers["stripe-signature"];
  return { signature: typeof value === "string" ? value : undefined };
}

export async function registerProviderIntegrationRoutes(
  app: FastifyInstance,
  options: ProviderIntegrationRouteOptions = {},
): Promise<void> {
  const runtime = getProviderConfig(options);

  app.post("/integrations/oauth/:provider/start", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (
      !(await checkRateLimit(request, reply, "integrations:oauth:start", session.id, 10, 60 * 60))
    )
      return;
    const parsed = oauthStartSchema.safeParse({
      ...(request.body as Record<string, unknown>),
      provider: (request.params as { provider?: string }).provider,
    });
    if (!parsed.success)
      return reply.code(400).send({ error: "Review the provider connection details." });
    const body = parsed.data;
    if (!oauthProviders.includes(body.provider))
      return reply.code(404).send({ error: "Provider not found." });
    const family = oauthFamily(body.provider);
    if (!runtime[family])
      return reply.code(503).send({ error: "This provider connection is not configured." });
    if (!(await assertOwnedProduct(session.id, body.productId)))
      return reply.code(404).send({ error: "Product not found." });
    if (body.provider === "GA4" && (!body.propertyId || !body.eventMap))
      return reply
        .code(400)
        .send({ error: "A GA4 property and normalized event map are required." });
    if (
      body.provider === "GA4" &&
      (Object.keys(body.eventMap ?? {}).length === 0 ||
        Object.keys(body.eventMap ?? {}).length > 20 ||
        Object.keys(body.eventMap ?? {}).some((name) => !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name)))
    )
      return reply.code(400).send({ error: "Review the GA4 event map." });
    if (body.provider !== "GA4" && (body.propertyId || body.eventMap))
      return reply.code(400).send({ error: "This provider does not use analytics settings." });
    const configuration =
      body.provider === "GA4" ? { propertyId: body.propertyId, eventMap: body.eventMap } : {};
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const scopes = requiredOAuthScopes(body.provider);
    try {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const product = await client.query(
          "SELECT id FROM enough.products WHERE id = $1 AND user_id = $2 FOR UPDATE",
          [body.productId, session.id],
        );
        if (product.rowCount !== 1) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "Product not found." });
        }
        await client.query(
          `WITH expired AS (
             SELECT id FROM enough.integration_oauth_states
             WHERE expires_at < now() - interval '1 day' ORDER BY expires_at LIMIT 100
           ) DELETE FROM enough.integration_oauth_states WHERE id IN (SELECT id FROM expired)`,
        );
        await client.query(
          `INSERT INTO enough.integration_oauth_states
             (id, state_hash, user_id, device_id, product_id, provider, display_name, scopes,
              configuration, pkce_verifier_ciphertext, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, now() + interval '10 minutes')`,
          [
            randomUUID(),
            createHash("sha256").update(state).digest("hex"),
            session.id,
            session.deviceId,
            body.productId,
            body.provider,
            body.displayName,
            scopes,
            JSON.stringify(configuration),
            encryptIntegrationSecret(verifier),
          ],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      const authorizationUrl = new URL(
        (await import("./integration-oauth.js"))
          .buildProviderAuthorizationUrl({
            provider: body.provider,
            runtime,
            state,
            redirectUri: redirectUri(family),
            codeChallenge: challenge,
          })
          .toString(),
      );
      return reply.send({ authorizationUrl: authorizationUrl.toString() });
    } catch {
      return safeIntegrationFailure(request, reply);
    }
  });

  app.get("/integrations/oauth/:family/callback", async (request, reply) => {
    if (!(await checkRateLimit(request, reply, "integrations:oauth:callback", request.ip, 30, 60)))
      return;
    const family = (request.params as { family?: string }).family;
    if (family !== "google" && family !== "microsoft") return reply.code(404).send();
    const query = request.query as { state?: string; code?: string; error?: string };
    const state = typeof query.state === "string" ? query.state : "";
    const code = typeof query.code === "string" ? query.code : "";
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(state))
      return reply.code(400).send({ error: "Invalid authorization state." });
    const client = await pool.connect();
    let stateRow:
      | {
          id: string;
          user_id: string;
          device_id: string | null;
          product_id: string;
          provider: OAuthIntegrationProvider;
          display_name: string;
          scopes: string[];
          configuration: Record<string, unknown>;
          pkce_verifier_ciphertext: Buffer;
        }
      | undefined;
    try {
      await client.query("BEGIN");
      const found = await client.query(
        `SELECT id, user_id, device_id, product_id, provider, display_name, scopes,
                configuration, pkce_verifier_ciphertext
         FROM enough.integration_oauth_states
         WHERE state_hash = $1 AND consumed_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [createHash("sha256").update(state).digest("hex")],
      );
      stateRow = found.rows[0] as typeof stateRow;
      if (!stateRow || oauthFamily(stateRow.provider) !== family) {
        await client.query("ROLLBACK");
        return reply
          .code(400)
          .send({ error: "The authorization request expired or was already used." });
      }
      await client.query(
        "UPDATE enough.integration_oauth_states SET consumed_at = now() WHERE id = $1",
        [stateRow.id],
      );
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK");
      return safeIntegrationFailure(request, reply);
    } finally {
      client.release();
    }
    if (query.error || !code) {
      await recordOAuthCallbackFailure({
        request,
        userId: stateRow.user_id,
        deviceId: stateRow.device_id,
        provider: stateRow.provider,
        productId: stateRow.product_id,
        failureCode: query.error ? "PROVIDER_AUTHORIZATION_DENIED" : "AUTHORIZATION_CODE_MISSING",
        callbackStage: "TOKEN_EXCHANGE",
      });
      return reply.redirect(safeReturnUrl(stateRow.provider, "failed"));
    }
    let callbackStage: OAuthCallbackStage = "TOKEN_EXCHANGE";
    try {
      const tokenSet = await exchangeProviderAuthorizationCode({
        provider: stateRow.provider,
        runtime,
        code,
        redirectUri: redirectUri(family),
        codeVerifier: decryptIntegrationSecret(stateRow.pkce_verifier_ciphertext),
        scopes: stateRow.scopes,
        fetcher: options.fetcher,
      });
      callbackStage = "PROVIDER_IDENTITY";
      const providerAccountId = await readProviderAccountId({
        provider: stateRow.provider,
        accessToken: tokenSet.accessToken,
        fetcher: options.fetcher,
      });
      callbackStage = "CONNECTION_PERSISTENCE";
      await insertOAuthConnection({
        provider: stateRow.provider,
        userId: stateRow.user_id,
        productId: stateRow.product_id,
        displayName: stateRow.display_name,
        providerAccountId,
        configuration: stateRow.configuration,
        accessToken: tokenSet.accessToken,
        refreshToken: tokenSet.refreshToken,
        tokenType: tokenSet.tokenType,
        expiresAt: tokenSet.expiresAt,
        scopes: tokenSet.scopes,
        deviceId: stateRow.device_id,
        setCallbackStage: (stage) => {
          callbackStage = stage;
        },
      });
      return reply.redirect(safeReturnUrl(stateRow.provider, "connected"));
    } catch (error) {
      const failureCode = safeOAuthCallbackFailureCode(error, callbackStage);
      await recordOAuthCallbackFailure({
        request,
        userId: stateRow.user_id,
        deviceId: stateRow.device_id,
        provider: stateRow.provider,
        productId: stateRow.product_id,
        failureCode,
        callbackStage,
      });
      return reply.redirect(safeReturnUrl(stateRow.provider, "failed"));
    }
  });

  app.post("/integrations/credentials", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (
      !(await checkRateLimit(
        request,
        reply,
        "integrations:credentials:create",
        session.id,
        10,
        60 * 60,
      ))
    )
      return;
    const parsed = apiCredentialSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Review the provider connection details." });
    const body = parsed.data;
    if (body.provider === "POSTHOG" && (!body.projectId || !body.region || body.siteId))
      return reply.code(400).send({ error: "Choose a PostHog project and region." });
    if (body.provider === "PLAUSIBLE" && (!body.siteId || body.projectId || body.region))
      return reply.code(400).send({ error: "Choose a Plausible site domain." });
    const configuration =
      body.provider === "POSTHOG"
        ? { projectId: body.projectId, region: body.region, eventMap: body.eventMap }
        : { siteId: body.siteId, eventMap: body.eventMap };
    try {
      const adapter = integrationProviderAdapter(body.provider);
      if (!adapter) return reply.code(400).send({ error: "This provider is not available yet." });
      await adapter({
        provider: body.provider,
        accessToken: body.apiToken,
        configuration,
        fetcher: options.fetcher,
      });
      const id = await createProviderConnection({
        userId: session.id,
        deviceId: session.deviceId,
        productId: body.productId,
        provider: body.provider,
        displayName: body.displayName,
        accessToken: body.apiToken,
        scopes: [body.provider === "POSTHOG" ? "query:read" : "stats:read"],
        configuration,
      });
      return reply.code(201).send({ integrationId: id, status: "ACTIVE" });
    } catch {
      return safeIntegrationFailure(request, reply);
    }
  });

  app.post("/integrations/stripe", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (
      !(await checkRateLimit(request, reply, "integrations:stripe:create", session.id, 10, 60 * 60))
    )
      return;
    const parsed = stripeConnectSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Review the restricted Stripe connection details." });
    const body = parsed.data;
    try {
      const providerAccountId = await validateStripeRestrictedKey({
        apiKey: body.restrictedApiKey,
        ...(body.accountId ? { accountId: body.accountId } : {}),
        fetcher: options.fetcher,
      });
      const id = await createProviderConnection({
        userId: session.id,
        deviceId: session.deviceId,
        productId: body.productId,
        provider: "STRIPE",
        displayName: body.displayName,
        accessToken: body.restrictedApiKey,
        scopes: ["restricted_events_read"],
        configuration: { mode: body.restrictedApiKey.includes("_test_") ? "test" : "live" },
        credential: JSON.stringify({ webhookSigningSecret: body.webhookSigningSecret }),
        providerAccountId,
      });
      return reply.code(201).send({
        integrationId: id,
        status: "ACTIVE",
        webhookPath: `/v1/integrations/stripe/${id}/events`,
        webhookUrl: new URL(`/v1/integrations/stripe/${id}/events`, env.API_BASE_URL).toString(),
      });
    } catch {
      return safeIntegrationFailure(request, reply);
    }
  });

  app.post("/integrations/:integrationId/sync", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "integrations:sync", session.id, 10, 60))) return;
    const parsedId = integrationIdSchema.safeParse(
      (request.params as { integrationId?: string }).integrationId,
    );
    if (!parsedId.success) return reply.code(400).send({ error: "Invalid integration ID." });
    const client = await pool.connect();
    let account: AccountScopeRow | undefined;
    const syncRunId = randomUUID();
    let accessToken = "";
    let providerConfig: ProviderConfigRow | undefined;
    try {
      await client.query("BEGIN");
      const found = await client.query<AccountScopeRow>(
        `SELECT id, user_id, product_id, provider, display_name, status,
                signing_secret_ciphertext, api_key_hash
         FROM enough.integration_accounts WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [parsedId.data, session.id],
      );
      account = found.rows[0];
      if (!account) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Integration not found." });
      }
      const adapter = integrationProviderAdapter(account.provider);
      if (!adapter || account.status === "REVOKED") {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "This integration does not support sync." });
      }
      const credentials = await getUsableAccessToken(client, account, options);
      accessToken = credentials.accessToken;
      providerConfig = credentials.providerConfig;
      await client.query(
        `INSERT INTO enough.integration_sync_runs
           (id, integration_account_id, user_id, product_id, status)
         VALUES ($1, $2, $3, $4, 'RUNNING')`,
        [syncRunId, account.id, account.user_id, account.product_id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (account) {
        try {
          const errorCode = safeErrorCode(error).slice(0, 80);
          await client.query("BEGIN");
          await client.query(
            `INSERT INTO enough.integration_sync_runs
               (id, integration_account_id, user_id, product_id, status, finished_at, error_code)
             VALUES ($1, $2, $3, $4, 'FAILED', now(), $5)
             ON CONFLICT (id) DO UPDATE
               SET status = 'FAILED', finished_at = now(), error_code = EXCLUDED.error_code`,
            [syncRunId, account.id, account.user_id, account.product_id, errorCode],
          );
          await client.query(
            `INSERT INTO enough.integration_errors
               (id, integration_account_id, user_id, product_id, sync_run_id, error_code, safe_message)
             VALUES ($1, $2, $3, $4, $5, $6, 'The provider connection needs attention.')`,
            [randomUUID(), account.id, account.user_id, account.product_id, syncRunId, errorCode],
          );
          await client.query(
            `UPDATE enough.integration_accounts SET status = 'ERROR', updated_at = now()
             WHERE id = $1 AND status <> 'REVOKED'`,
            [account.id],
          );
          await client.query("COMMIT");
        } catch {
          await client.query("ROLLBACK").catch(() => undefined);
        }
      }
      return safeIntegrationFailure(request, reply);
    } finally {
      client.release();
    }

    if (!account || !providerConfig) return safeIntegrationFailure(request, reply);
    const adapter = integrationProviderAdapter(account.provider);
    if (!adapter) return reply.code(409).send({ error: "This integration does not support sync." });
    try {
      const events = await adapter({
        provider: account.provider,
        accessToken,
        configuration: providerConfig.configuration,
        fetcher: options.fetcher,
      });
      const eventClient = await pool.connect();
      let inserted = 0;
      let rewardCount = 0;
      try {
        await eventClient.query("BEGIN");
        const current = await eventClient.query<AccountScopeRow>(
          `SELECT id, user_id, product_id, provider, display_name, status,
                  signing_secret_ciphertext, api_key_hash
           FROM enough.integration_accounts WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [account.id, session.id],
        );
        if (!current.rows[0] || current.rows[0].status === "REVOKED") {
          await eventClient.query("ROLLBACK");
          return reply.code(409).send({ error: "This integration was disconnected during sync." });
        }
        for (const event of events) {
          const stored = await insertVendorEvent(eventClient, current.rows[0], event, {
            allowAutomaticReward: false,
          });
          if (stored.inserted) inserted += 1;
          if (stored.rewardTransactionId) rewardCount += 1;
        }
        await eventClient.query(
          `UPDATE enough.integration_sync_runs
           SET status = 'SUCCEEDED', finished_at = now(), events_received = $2,
               events_verified = $3, error_code = NULL
           WHERE id = $1`,
          [syncRunId, inserted, 0],
        );
        await eventClient.query(
          `UPDATE enough.integration_accounts SET status = 'ACTIVE', last_sync_at = now(),
           last_received_at = CASE WHEN $2 > 0 THEN now() ELSE last_received_at END, updated_at = now()
           WHERE id = $1`,
          [account.id, inserted],
        );
        await eventClient.query("COMMIT");
      } catch (error) {
        await eventClient.query("ROLLBACK");
        throw error;
      } finally {
        eventClient.release();
      }
      return reply.send({
        integrationId: account.id,
        eventsReceived: inserted,
        rewardsIssued: rewardCount,
      });
    } catch (error) {
      const errorCode = safeErrorCode(error);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE enough.integration_sync_runs
           SET status = 'FAILED', finished_at = now(), error_code = $2
           WHERE id = $1 AND status = 'RUNNING'`,
          [syncRunId, errorCode.slice(0, 80)],
        );
        await client.query(
          `UPDATE enough.integration_accounts SET status = 'ERROR', updated_at = now()
           WHERE id = $1 AND status <> 'REVOKED'`,
          [account.id],
        );
        await client.query(
          `INSERT INTO enough.integration_errors
             (id, integration_account_id, user_id, product_id, sync_run_id, error_code, safe_message)
           VALUES ($1, $2, $3, $4, $5, $6, 'The provider sync failed. Retry or reconnect this integration.')`,
          [
            randomUUID(),
            account.id,
            account.user_id,
            account.product_id,
            syncRunId,
            errorCode.slice(0, 80),
          ],
        );
        await client.query("COMMIT");
      } catch {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
      return safeIntegrationFailure(request, reply);
    }
  });

  app.post("/integrations/:integrationId/events/:eventId/evidence", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "integrations:evidence", session.id, 30, 60)))
      return;
    const params = request.params as { integrationId?: string; eventId?: string };
    const integrationId = integrationIdSchema.safeParse(params.integrationId);
    const eventId = z.string().min(1).max(255).safeParse(params.eventId);
    const parsed = evidenceLinkSchema.safeParse(request.body);
    if (!integrationId.success || !eventId.success || !parsed.success)
      return reply.code(400).send({ error: "Review the evidence link." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const accountResult = await client.query<AccountScopeRow>(
        `SELECT id, user_id, product_id, provider, display_name, status,
                signing_secret_ciphertext, api_key_hash
         FROM enough.integration_accounts WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [integrationId.data, session.id],
      );
      const account = accountResult.rows[0];
      if (!account || account.status === "REVOKED") {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Integration event not found." });
      }
      const eventResult = await client.query<{
        id: string;
        provider_event_id: string;
        event_type: string;
        provider_origin_verified: boolean;
        evidence_id: string | null;
      }>(
        `SELECT id, provider_event_id, event_type, provider_origin_verified, evidence_id
         FROM enough.integration_events
         WHERE integration_account_id = $1 AND user_id = $2 AND product_id = $3
           AND provider_event_id = $4 FOR UPDATE`,
        [account.id, account.user_id, account.product_id, eventId.data],
      );
      const event = eventResult.rows[0];
      if (!event?.provider_origin_verified || event.evidence_id) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Integration event not found." });
      }
      const completionResult = await client.query<{
        id: string;
        task_id: string;
        task_title: string;
        task_status: string;
        verification_status: string;
        credit_transaction_id: string | null;
      }>(
        `SELECT completion.id, completion.task_id, task.title AS task_title,
                task.status AS task_status, completion.verification_status,
                completion.credit_transaction_id
         FROM enough.growth_task_completions completion
         JOIN enough.growth_tasks task ON task.id = completion.task_id
         WHERE completion.id = $1 AND completion.user_id = $2 AND completion.product_id = $3
         FOR UPDATE OF completion`,
        [parsed.data.completionId, account.user_id, account.product_id],
      );
      const completion = completionResult.rows[0];
      if (
        completion?.task_status !== "COMPLETED" ||
        !["AWAITING_EVIDENCE", "AWAITING_REVIEW"].includes(completion.verification_status) ||
        completion.credit_transaction_id
      ) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "The task completion cannot accept this evidence." });
      }
      const evidenceId = randomUUID();
      const title = event.event_type.replaceAll(".", " ").replaceAll("_", " ");
      await client.query(
        `INSERT INTO enough.task_evidence_items
           (id, completion_id, task_id, product_id, user_id, evidence_type, title, note,
            integration_provider, integration_reference, provenance, verification_status,
            reviewed_at, verification_method)
         VALUES ($1, $2, $3, $4, $5, 'INTEGRATION', $6, $7, $8, $9, 'SERVER_VERIFIED',
                 'PENDING', NULL, 'MANUAL')`,
        [
          evidenceId,
          completion.id,
          completion.task_id,
          account.product_id,
          account.user_id,
          title.slice(0, 160),
          `A vendor-authenticated ${title} event was attached for owner review.`,
          account.provider.toLowerCase(),
          event.provider_event_id,
        ],
      );
      await client.query(
        `UPDATE enough.integration_events
         SET completion_id = $2, task_id = $3, evidence_id = $4
         WHERE id = $1 AND evidence_id IS NULL`,
        [event.id, completion.id, completion.task_id, evidenceId],
      );
      if (completion.verification_status === "AWAITING_EVIDENCE")
        await client.query(
          `UPDATE enough.growth_task_completions SET verification_status = 'AWAITING_REVIEW'
           WHERE id = $1 AND verification_status = 'AWAITING_EVIDENCE'`,
          [completion.id],
        );
      await client.query(
        `INSERT INTO enough.auth_audit_events (id, user_id, event_type, metadata)
         VALUES ($1, $2, 'integration.evidence_linked', $3::jsonb)`,
        [
          randomUUID(),
          account.user_id,
          JSON.stringify({ integrationId: account.id, completionId: completion.id, evidenceId }),
        ],
      );
      await client.query("COMMIT");
      return reply.code(201).send({ evidenceId, verificationStatus: "PENDING" });
    } catch {
      await client.query("ROLLBACK");
      return safeIntegrationFailure(request, reply);
    } finally {
      client.release();
    }
  });

  app.post(
    "/v1/integrations/stripe/:integrationId/events",
    { bodyLimit: 256 * 1024 },
    async (request, reply) => {
      const integrationId = integrationIdSchema.safeParse(
        (request.params as { integrationId?: string }).integrationId,
      );
      const body = rawJsonBody(request);
      const signature = responseHeaders(request).signature;
      if (!integrationId.success || !body || !signature)
        return reply.code(400).send({ error: "A valid Stripe event request is required." });
      if (!(await checkRateLimit(request, reply, "integrations:stripe:ip", request.ip, 120, 60)))
        return;
      const client = await pool.connect();
      let account: AccountScopeRow | undefined;
      let accessToken = "";
      let providerConfig: ProviderConfigRow | undefined;
      let providerAccountId = "";
      try {
        await client.query("BEGIN");
        const found = await client.query<AccountScopeRow>(
          `SELECT id, user_id, product_id, provider, display_name, status,
                  signing_secret_ciphertext, api_key_hash
           FROM enough.integration_accounts
           WHERE id = $1 AND provider = 'STRIPE' AND status = 'ACTIVE' FOR UPDATE`,
          [integrationId.data],
        );
        account = found.rows[0];
        if (!account) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "Stripe integration not found." });
        }
        if (
          !(await checkRateLimit(
            request,
            reply,
            "integrations:stripe:account",
            account.id,
            120,
            60,
          ))
        ) {
          await client.query("ROLLBACK");
          return;
        }
        const credentials = await getUsableAccessToken(client, account, options);
        accessToken = credentials.accessToken;
        providerConfig = credentials.providerConfig;
        if (!providerConfig.credential_ciphertext || !providerConfig.provider_account_ciphertext)
          throw new ProviderApiError("STRIPE_CONFIGURATION_MISSING");
        providerAccountId = decryptIntegrationSecret(providerConfig.provider_account_ciphertext);
        await client.query("COMMIT");
      } catch {
        await client.query("ROLLBACK");
        return reply
          .code(401)
          .send({ error: "Stripe integration credentials are invalid or revoked." });
      } finally {
        client.release();
      }
      if (!account || !providerConfig?.credential_ciphertext) return reply.code(401).send();
      try {
        const credential = JSON.parse(
          decryptIntegrationSecret(providerConfig.credential_ciphertext),
        ) as { webhookSigningSecret?: unknown };
        const mode = providerConfig.configuration.mode;
        if (
          typeof credential.webhookSigningSecret !== "string" ||
          (mode !== "test" && mode !== "live")
        )
          throw new ProviderApiError("STRIPE_CONFIGURATION_MISSING");
        const event = await verifyStripeWebhook({
          rawBody: body,
          signatureHeader: signature,
          signingSecret: credential.webhookSigningSecret,
          restrictedApiKey: accessToken,
          expectedAccountId: providerAccountId,
          expectedLivemode: mode === "live",
          fetcher: options.fetcher,
        });
        const eventClient = await pool.connect();
        try {
          await eventClient.query("BEGIN");
          const locked = await eventClient.query<AccountScopeRow>(
            `SELECT id, user_id, product_id, provider, display_name, status,
                    signing_secret_ciphertext, api_key_hash
             FROM enough.integration_accounts WHERE id = $1 AND status = 'ACTIVE' FOR UPDATE`,
            [account.id],
          );
          if (!locked.rows[0]) {
            await eventClient.query("ROLLBACK");
            return reply
              .code(401)
              .send({ error: "Stripe integration credentials are invalid or revoked." });
          }
          const stored = await insertVendorEvent(eventClient, locked.rows[0], event, {
            allowAutomaticReward: true,
          });
          if (stored.inserted) {
            await eventClient.query(
              `UPDATE enough.integration_accounts SET last_received_at = now(), status = 'ACTIVE', updated_at = now()
               WHERE id = $1`,
              [account.id],
            );
            await eventClient.query(
              `INSERT INTO enough.auth_audit_events (id, user_id, event_type, metadata)
               VALUES ($1, $2, 'integration.event_authenticated', $3::jsonb)`,
              [
                randomUUID(),
                account.user_id,
                JSON.stringify({
                  integrationId: account.id,
                  eventId: event.eventId,
                  eventType: event.eventType,
                  providerOriginVerified: true,
                  automaticVerificationEligible: event.automaticVerificationEligible,
                }),
              ],
            );
          }
          await eventClient.query("COMMIT");
          return reply.code(stored.inserted ? 202 : 200).send({
            duplicate: !stored.inserted,
            eventId: event.eventId,
            evidenceId: stored.evidenceId,
            rewardIssued: Boolean(stored.rewardTransactionId),
          });
        } catch {
          await eventClient.query("ROLLBACK");
          return safeIntegrationFailure(request, reply);
        } finally {
          eventClient.release();
        }
      } catch (error) {
        request.log.warn(
          {
            stripeVerificationError: error instanceof ProviderApiError ? error.code : "UNEXPECTED",
          },
          "Stripe event verification failed.",
        );
        const status =
          error instanceof ProviderApiError && error.code === "INVALID_STRIPE_SIGNATURE"
            ? 401
            : error instanceof ProviderApiError && error.code === "STRIPE_EVENT_NOT_CONFIRMED"
              ? 422
              : 400;
        return reply.code(status).send({ error: "Stripe could not confirm this event." });
      }
    },
  );
}
