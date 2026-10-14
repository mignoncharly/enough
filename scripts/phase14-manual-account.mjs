import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

assert.equal(process.env.ENOUGH_PHASE14_MANUAL_ACCOUNT, "1");
const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.deepEqual(
  [target.hostname, target.port, target.pathname, target.username],
  ["127.0.0.1", "55946", "/enough_phase14", "enough_phase14"],
);
assert.equal(process.env.APP_BASE_URL, "http://127.0.0.1:3315");
assert.equal(process.env.API_BASE_URL, "http://127.0.0.1:4426");
assert.equal(process.env.REDIS_URL, "redis://127.0.0.1:56409/0");
assert.equal(
  Boolean(process.env.GOOGLE_INTEGRATION_CLIENT_ID),
  Boolean(process.env.GOOGLE_INTEGRATION_CLIENT_SECRET),
  "Phase 14 Google integration client settings must be supplied together.",
);
assert.equal(process.env.MICROSOFT_INTEGRATION_CLIENT_ID, "");
assert.equal(process.env.STRIPE_SECRET_KEY, "");

const { encryptIntegrationSecret, hashIntegrationCredential, newIntegrationCredential } =
  await import("../packages/auth/src/index.ts");
const { hashPassword } = await import("../packages/auth/src/crypto.ts");
const { createSession } = await import("../packages/auth/src/session.ts");
const { pool } = await import("../packages/db/src/index.ts");
const { grantVerifiedTaskRewardInTransaction } = await import("../apps/api/src/credits.ts");
const { requiredOAuthScopes } = await import("../apps/api/src/integration-oauth.ts");

const userId = randomUUID();
const email = `phase14-manual-${userId}@example.test`;
const password = randomBytes(24).toString("base64url");
let productId = "";
const fixtureTag = "[TEST FIXTURE]";
const now = new Date();

async function createTaskCompletion(title, headers) {
  const created = await fetch(`${process.env.API_BASE_URL}/growth-tasks`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      productId,
      title,
      priority: 4,
      signalStrength: 4,
      estimatedMinutes: 20,
      rewardCredits: 5,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(created.status, 201, "Phase 14 task setup failed.");
  const task = (await created.json()).task;
  const completed = await fetch(`${process.env.API_BASE_URL}/growth-tasks/${task.id}/complete`, {
    method: "POST",
    headers,
    body: "{}",
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(completed.status, 200, "Phase 14 task completion setup failed.");
  const completion = (await completed.json()).completion;
  assert.equal(completion.verificationStatus, "AWAITING_EVIDENCE");
  assert.equal(completion.creditTransactionId, null);
  return { task, completion };
}

async function createProviderAccount(input) {
  const id = randomUUID();
  const revoked = input.status === "REVOKED";
  let apiKeyHash = null;
  let signingSecretCiphertext = null;
  if (input.provider === "WEBHOOK" || input.provider === "PUBLIC_API") {
    const apiKey = newIntegrationCredential();
    const signingSecret = newIntegrationCredential();
    apiKeyHash = hashIntegrationCredential(apiKey);
    signingSecretCiphertext = encryptIntegrationSecret(signingSecret);
  }
  await pool.query(
    `INSERT INTO enough.integration_accounts
       (id, user_id, product_id, provider, display_name, status, api_key_hash,
        signing_secret_ciphertext, scopes, last_received_at, last_sync_at, revoked_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             CASE WHEN $6 = 'ACTIVE' THEN $10::timestamptz ELSE NULL END,
             CASE WHEN $6 = 'REVOKED' THEN NULL ELSE $10::timestamptz END,
             CASE WHEN $6 = 'REVOKED' THEN $10::timestamptz ELSE NULL END)`,
    [
      id,
      userId,
      productId,
      input.provider,
      `${fixtureTag} ${input.label}`,
      input.status,
      apiKeyHash,
      signingSecretCiphertext,
      input.scopes ?? [],
      now,
    ],
  );
  if (revoked || input.provider === "WEBHOOK" || input.provider === "PUBLIC_API") return id;

  const apiToken = input.provider === "STRIPE" ? "rk_test_fixtureonly" : `fixture-access-${id}`;
  const refreshToken = input.oauth ? `fixture-refresh-${id}` : null;
  const scopes = input.scopes ?? [];
  await pool.query(
    `INSERT INTO enough.integration_tokens
       (integration_account_id, user_id, product_id, access_token_ciphertext,
        refresh_token_ciphertext, token_type, scopes, expires_at, refreshed_at)
     VALUES ($1, $2, $3, $4, $5, 'Bearer', $6, $7, $8)`,
    [
      id,
      userId,
      productId,
      encryptIntegrationSecret(apiToken),
      refreshToken ? encryptIntegrationSecret(refreshToken) : null,
      scopes,
      new Date(Date.now() + 60 * 60_000),
      now,
    ],
  );

  const providerAccountId = `fixture-${input.provider.toLowerCase()}-${randomUUID()}`;
  const configuration = input.configuration ?? {};
  const credential =
    input.provider === "STRIPE"
      ? '{"webhookSigningSecret":"whsec_fixtureonlysecret1234"}'
      : input.provider === "POSTHOG" || input.provider === "PLAUSIBLE"
        ? apiToken
        : null;
  await pool.query(
    `INSERT INTO enough.integration_provider_configs
       (integration_account_id, user_id, product_id, configuration, credential_ciphertext,
        provider_account_ciphertext, provider_account_hash)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
    [
      id,
      userId,
      productId,
      JSON.stringify(configuration),
      credential ? encryptIntegrationSecret(credential) : null,
      encryptIntegrationSecret(providerAccountId),
      createHmac("sha256", process.env.AUTH_SECRET ?? "")
        .update(providerAccountId)
        .digest("hex"),
    ],
  );
  return id;
}

async function createIntegrationEvent(input) {
  const eventId = `fixture-${input.source}-${randomUUID()}`;
  const eventRowId = randomUUID();
  const evidenceId = randomUUID();
  const title = input.eventType.replaceAll(".", " ").replaceAll("_", " ");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO enough.task_evidence_items
         (id, completion_id, task_id, product_id, user_id, evidence_type, title, note,
          integration_provider, integration_reference, provenance, verification_status,
          reviewed_at, verification_method)
       VALUES ($1, $2, $3, $4, $5, 'INTEGRATION', $6, $7, $8, $9, 'SERVER_VERIFIED',
               $10, CASE WHEN $10 = 'VERIFIED' THEN now() ELSE NULL END, $11)`,
      [
        evidenceId,
        input.completion.id,
        input.task.id,
        productId,
        userId,
        title,
        input.automatic
          ? "Fixture-only Stripe test event used to verify the displayed provider evidence and reward."
          : "Fixture-only owner-controlled signed event. This evidence remains pending owner review.",
        input.provider.toLowerCase(),
        eventId,
        input.automatic ? "VERIFIED" : "PENDING",
        input.automatic ? "AUTOMATIC" : "MANUAL",
      ],
    );
    if (input.automatic) {
      await client.query(
        `UPDATE enough.growth_task_completions
         SET verification_status = 'AUTOMATICALLY_VERIFIED', reviewed_at = now(),
             reviewed_by_user_id = NULL,
             review_note = 'Fixture-only vendor-authenticated Stripe payment event'
         WHERE id = $1 AND credit_transaction_id IS NULL`,
        [input.completion.id],
      );
      const creditTransactionId = await grantVerifiedTaskRewardInTransaction(client, {
        userId,
        deviceId: null,
        productId,
        taskId: input.task.id,
        completionId: input.completion.id,
        evidenceId,
        amount: 5,
        verificationMethod: "AUTOMATIC",
      });
      await client.query(
        "UPDATE enough.growth_task_completions SET credit_transaction_id = $2 WHERE id = $1",
        [input.completion.id, creditTransactionId],
      );
    } else {
      await client.query(
        `UPDATE enough.growth_task_completions SET verification_status = 'AWAITING_REVIEW'
         WHERE id = $1 AND credit_transaction_id IS NULL`,
        [input.completion.id],
      );
    }
    await client.query(
      `INSERT INTO enough.integration_events
         (id, integration_account_id, user_id, product_id, provider_event_id, event_type,
          occurred_at, payload_hash, verification_status, completion_id, task_id, evidence_id,
          provider_origin_verified, amount_minor, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'AUTHENTICATED', $9, $10, $11, $12, $13, $14)`,
      [
        eventRowId,
        input.accountId,
        userId,
        productId,
        eventId,
        input.eventType,
        now,
        createHash("sha256").update(`${eventId}:${input.eventType}`).digest("hex"),
        input.completion.id,
        input.task.id,
        evidenceId,
        input.provider === "STRIPE",
        input.provider === "STRIPE" ? 2500 : null,
        input.provider === "STRIPE" ? "USD" : null,
      ],
    );
    await client.query("COMMIT");
    return { eventId, evidenceId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function seedProviderEvent(accountId, provider, eventType) {
  const eventId = `fixture-${provider.toLowerCase()}-${randomUUID()}`;
  await pool.query(
    `INSERT INTO enough.integration_events
       (id, integration_account_id, user_id, product_id, provider_event_id, event_type,
        occurred_at, payload_hash, verification_status, provider_origin_verified)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'AUTHENTICATED', true)`,
    [
      randomUUID(),
      accountId,
      userId,
      productId,
      eventId,
      eventType,
      now,
      createHash("sha256").update(`${eventId}:${eventType}`).digest("hex"),
    ],
  );
}

try {
  await pool.query(
    `INSERT INTO enough.auth_users
       (id, email, email_normalized, password_hash, email_verified_at)
     VALUES ($1, $2, $2, $3, now())`,
    [userId, email, await hashPassword(password)],
  );
  const session = await createSession(
    userId,
    "web",
    "Phase 14 browser acceptance fixture",
    "magic_link",
  );
  const headers = {
    cookie: `enough_session=${session.token}; enough_csrf=${session.csrfToken}`,
    "x-csrf-token": session.csrfToken ?? "",
    origin: process.env.APP_BASE_URL,
    "content-type": "application/json",
  };
  const productResponse = await fetch(`${process.env.API_BASE_URL}/products`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Phase 14 integration browser fixture",
      targetCustomer: "Synthetic product teams",
      problemStatement: "Verify provider-origin evidence presentation",
      productStage: "IDEA",
      initialGoal: "Review fixture event evidence and Build Credit",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(productResponse.status, 201, "Phase 14 product setup failed.");
  const product = (await productResponse.json()).product;
  productId = product.id;

  const stripeTask = await createTaskCompletion(
    "[TEST FIXTURE] Stripe payment evidence task",
    headers,
  );
  const genericTask = await createTaskCompletion(
    "[TEST FIXTURE] Generic webhook review task",
    headers,
  );
  const publicTask = await createTaskCompletion(
    "[TEST FIXTURE] Public Event API review task",
    headers,
  );

  const accounts = new Map();
  const catalog = [
    {
      provider: "GMAIL",
      label: "Gmail healthy",
      oauth: true,
      scopes: requiredOAuthScopes("GMAIL"),
    },
    {
      provider: "GOOGLE_CALENDAR",
      label: "Google Calendar healthy",
      oauth: true,
      scopes: requiredOAuthScopes("GOOGLE_CALENDAR"),
    },
    {
      provider: "OUTLOOK",
      label: "Outlook healthy",
      oauth: true,
      scopes: requiredOAuthScopes("OUTLOOK"),
    },
    {
      provider: "MICROSOFT_CALENDAR",
      label: "Microsoft Calendar degraded",
      status: "ERROR",
      oauth: true,
      scopes: requiredOAuthScopes("MICROSOFT_CALENDAR"),
    },
    {
      provider: "STRIPE",
      label: "Stripe customer revenue healthy",
      configuration: { mode: "test" },
      scopes: ["restricted_events_read"],
    },
    {
      provider: "POSTHOG",
      label: "PostHog healthy",
      configuration: {
        projectId: "314159",
        region: "us",
        eventMap: { signup: "analytics.user_signup" },
      },
      scopes: ["query:read"],
    },
    {
      provider: "PLAUSIBLE",
      label: "Plausible healthy",
      configuration: {
        siteId: "fixture.example.test",
        eventMap: { signup: "analytics.user_signup" },
      },
      scopes: ["stats:read"],
    },
    {
      provider: "GA4",
      label: "GA4 revoked",
      status: "REVOKED",
      oauth: true,
      scopes: requiredOAuthScopes("GA4"),
    },
  ];
  for (const item of catalog) {
    accounts.set(
      item.provider,
      await createProviderAccount({ ...item, status: item.status ?? "ACTIVE" }),
    );
  }
  const representativeEvents = {
    GMAIL: "email.outreach_sent",
    GOOGLE_CALENDAR: "calendar.demo_completed",
    OUTLOOK: "email.reply_received",
    POSTHOG: "analytics.user_signup",
    PLAUSIBLE: "analytics.user_signup",
  };
  for (const item of catalog) {
    if (item.status === "ERROR" || item.status === "REVOKED" || item.provider === "STRIPE")
      continue;
    await seedProviderEvent(
      accounts.get(item.provider),
      item.provider,
      representativeEvents[item.provider],
    );
  }
  accounts.set(
    "WEBHOOK",
    await createProviderAccount({
      provider: "WEBHOOK",
      label: "Generic webhook owner-controlled",
      status: "ACTIVE",
    }),
  );
  accounts.set(
    "PUBLIC_API",
    await createProviderAccount({
      provider: "PUBLIC_API",
      label: "Public Event API owner-controlled",
      status: "ACTIVE",
    }),
  );

  const stripeEvent = await createIntegrationEvent({
    provider: "STRIPE",
    source: "stripe",
    accountId: accounts.get("STRIPE"),
    eventType: "revenue.payment_received",
    task: stripeTask.task,
    completion: stripeTask.completion,
    automatic: true,
  });
  const genericEvent = await createIntegrationEvent({
    provider: "WEBHOOK",
    source: "webhook",
    accountId: accounts.get("WEBHOOK"),
    eventType: "analytics.user_signup",
    task: genericTask.task,
    completion: genericTask.completion,
    automatic: false,
  });
  const publicEvent = await createIntegrationEvent({
    provider: "PUBLIC_API",
    source: "public-api",
    accountId: accounts.get("PUBLIC_API"),
    eventType: "analytics.user_signup",
    task: publicTask.task,
    completion: publicTask.completion,
    automatic: false,
  });

  for (const item of catalog.filter((entry) => entry.status !== "REVOKED")) {
    const accountId = accounts.get(item.provider);
    const failed = item.status === "ERROR";
    const syncRunId = randomUUID();
    await pool.query(
      `INSERT INTO enough.integration_sync_runs
         (id, integration_account_id, user_id, product_id, status, started_at, finished_at,
          events_received, events_verified, error_code)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9)`,
      [
        syncRunId,
        accountId,
        userId,
        productId,
        failed ? "FAILED" : "SUCCEEDED",
        now,
        failed ? 0 : 1,
        0,
        failed ? "PROVIDER_TEMPORARY_FAILURE" : null,
      ],
    );
    if (failed) {
      await pool.query(
        `INSERT INTO enough.integration_errors
           (id, integration_account_id, user_id, product_id, sync_run_id, error_code, safe_message)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          randomUUID(),
          accountId,
          userId,
          productId,
          syncRunId,
          "PROVIDER_TEMPORARY_FAILURE",
          "This provider could not be reached. Retry the sync when the connection is available.",
        ],
      );
    }
  }
  await pool.query(
    `UPDATE enough.integration_accounts SET last_sync_at = $2
     WHERE user_id = $1 AND status <> 'REVOKED'`,
    [userId, now],
  );

  const stripeReward = await pool.query(
    `SELECT count(*)::int AS count
     FROM enough.credit_transactions credit_transaction
     JOIN enough.credit_accounts account ON account.id = credit_transaction.account_id
     WHERE credit_transaction.user_id = $1 AND account.product_id = $2
       AND credit_transaction.action = 'EARN' AND credit_transaction.idempotency_key LIKE 'taskreward:%'`,
    [userId, productId],
  );
  assert.equal(stripeReward.rows[0].count, 1, "The fixture must show exactly one provider reward.");
  const ownerRewards = await pool.query(
    `SELECT count(*)::int AS count
     FROM enough.credit_transactions credit_transaction
     JOIN enough.credit_accounts account ON account.id = credit_transaction.account_id
     WHERE credit_transaction.user_id = $1 AND account.product_id = $2
       AND credit_transaction.idempotency_key IN ($3, $4)`,
    [
      userId,
      productId,
      `taskreward:${genericTask.completion.id}`,
      `taskreward:${publicTask.completion.id}`,
    ],
  );
  assert.equal(
    ownerRewards.rows[0].count,
    0,
    "Owner-controlled source fixtures must not grant credit.",
  );

  await writeFile(
    join(tmpdir(), "enough-phase14", "manual-account.json"),
    `${JSON.stringify(
      {
        email,
        password,
        webBaseUrl: process.env.APP_BASE_URL,
        productId,
        fixture: true,
        seededEvents: {
          stripe: stripeEvent.eventId,
          genericWebhook: genericEvent.eventId,
          publicEventApi: publicEvent.eventId,
        },
      },
      null,
      2,
    )}\n`,
    { mode: 0o600, flag: "wx" },
  );
  console.info("Disposable Phase 14 account and acceptance fixture are ready for local use.");
  console.info(
    "Provider states and evidence are labeled [TEST FIXTURE]; no provider account was connected.",
  );
} finally {
  await pool.end();
}
