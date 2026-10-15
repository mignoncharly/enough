import { createHash, createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const api = "http://127.0.0.1:4426";
const web = "http://127.0.0.1:3315";

describe.skipIf(process.env.ENOUGH_PHASE14_INTEGRATION !== "1")(
  "Phase 14 signed integration runtime",
  () => {
    let pool: typeof import("@enough/db").pool;
    const userIds: string[] = [];

    beforeAll(async () => {
      const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
      expect([target.hostname, target.port, target.pathname, target.username]).toEqual([
        "127.0.0.1",
        "55946",
        "/enough_phase14",
        "enough_phase14",
      ]);
      expect(process.env.REDIS_URL).toBe("redis://127.0.0.1:56409/0");
      expect(process.env.APP_BASE_URL).toBe(web);
      expect(process.env.API_BASE_URL).toBe(api);
      expect(process.env.WORKER_PORT).toBe("4427");
      ({ pool } = await import("@enough/db"));
      const identity = await pool.query("SELECT current_user, current_database()");
      expect(identity.rows[0]).toEqual({
        current_user: "enough_phase14",
        current_database: "enough_phase14",
      });
      const migration = await pool.query<{ id: string }>(
        "SELECT id FROM enough.schema_migrations WHERE id = '0011_integration_platform.sql'",
      );
      expect(migration.rowCount).toBe(1);
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
      const email = `phase14-${id}@example.test`;
      userIds.push(id);
      await pool.query(
        "INSERT INTO enough.auth_users (id, email, email_normalized, email_verified_at) VALUES ($1, $2, $2, now())",
        [id, email],
      );
      const { createSession } = await import("../../../packages/auth/src/session.js");
      const session = await createSession(id, "web", "Phase 14 synthetic test", "magic_link");
      return {
        id,
        email,
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
      return fetch(`${api}${path}`, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });
    }

    function appRequest(
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

    async function product(user: Account, name = "Phase 14 integration product") {
      const result = await payload(
        await request("/products", user, {
          name,
          productStage: "PROBLEM_VALIDATION",
          targetCustomer: "Synthetic product teams",
          problemStatement: "Verify authenticated integration events",
          initialGoal: "Review integration evidence before rewarding",
        }),
        201,
      );
      return result.product.id as string;
    }

    it("reports Google OAuth catalog availability from the isolated API environment", async () => {
      const owner = await account();
      const productId = await product(owner, "Phase 14 OAuth catalog product");
      const listing = await payload(await request(`/integrations?productId=${productId}`, owner));
      const expectedAvailable = Boolean(
        process.env.GOOGLE_INTEGRATION_CLIENT_ID && process.env.GOOGLE_INTEGRATION_CLIENT_SECRET,
      );
      for (const provider of ["GMAIL", "GOOGLE_CALENDAR", "GA4"]) {
        expect(
          listing.catalog.find((item: { provider: string }) => item.provider === provider)
            ?.available,
          `${provider} catalog availability should reflect the isolated API environment`,
        ).toBe(expectedAvailable);
      }
      expect(
        listing.catalog.find((item: { provider: string }) => item.provider === "OUTLOOK")
          ?.available,
      ).toBe(false);
      expect(
        listing.catalog.find((item: { provider: string }) => item.provider === "MICROSOFT_CALENDAR")
          ?.available,
      ).toBe(false);
      expect(
        listing.catalog.find((item: { provider: string }) => item.provider === "POSTHOG")
          ?.available,
      ).toBe(true);
      expect(
        listing.catalog.find((item: { provider: string }) => item.provider === "PLAUSIBLE")
          ?.available,
      ).toBe(true);
      expect(
        listing.accounts.some((item: { provider: string }) =>
          ["POSTHOG", "PLAUSIBLE"].includes(item.provider),
        ),
      ).toBe(false);
    });

    async function completedTask(user: Account, productId: string, rewardCredits = 5) {
      const created = await payload(
        await request("/growth-tasks", user, {
          productId,
          title: `Phase 14 completion ${randomUUID()}`,
          priority: 4,
          signalStrength: 4,
          estimatedMinutes: 20,
          rewardCredits,
        }),
        201,
      );
      const completed = await payload(
        await request(`/growth-tasks/${created.task.id}/complete`, user, {}),
      );
      expect(completed.completion).toMatchObject({
        verificationStatus: "AWAITING_EVIDENCE",
        rewardCredits,
        creditTransactionId: null,
      });
      return { taskId: created.task.id as string, completionId: completed.completion.id as string };
    }

    async function connect(
      user: Account,
      productId: string,
      displayName = "Acceptance webhook",
      provider: "WEBHOOK" | "PUBLIC_API" = "WEBHOOK",
    ) {
      return payload(
        await appRequest("/integrations", user, { productId, provider, displayName }),
        201,
      ) as Promise<{
        account: { id: string; status: string; health: string };
        credentials: { apiKey: string; signingSecret: string };
      }>;
    }

    async function sendEvent(
      credentials: { apiKey: string; signingSecret: string },
      event: Record<string, unknown>,
      options: { timestamp?: string; signature?: string; body?: string } = {},
    ) {
      const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000).toString();
      const body = options.body ?? JSON.stringify(event);
      const signature =
        options.signature ??
        `sha256=${createHmac("sha256", credentials.signingSecret)
          .update(timestamp)
          .update(".")
          .update(body)
          .digest("hex")}`;
      return fetch(`${api}/v1/events`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${credentials.apiKey}`,
          "content-type": "application/vnd.enough.event+json",
          "x-enough-timestamp": timestamp,
          "x-enough-signature": signature,
        },
        body,
        signal: AbortSignal.timeout(45000),
      });
    }

    it("scopes connections, encrypts credentials, exports safe metadata, and revokes access", async () => {
      expect(
        (await appRequest("/integrations?productId=00000000-0000-4000-8000-000000000001")).status,
      ).toBe(401);
      const owner = await account();
      const outsider = await account();
      const ownerProduct = await product(owner);
      const outsiderProduct = await product(outsider, "Phase 14 outsider product");
      const missingCsrf = { ...owner.headers, "x-csrf-token": "" };
      expect(
        (
          await appRequest(
            "/integrations",
            owner,
            { productId: ownerProduct, provider: "WEBHOOK", displayName: "No CSRF" },
            "POST",
            missingCsrf,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await appRequest("/integrations", owner, {
            productId: ownerProduct,
            provider: "STRIPE",
            displayName: "Unavailable customer revenue adapter",
          })
        ).status,
      ).toBe(400);
      expect((await appRequest(`/integrations?productId=${ownerProduct}`, outsider)).status).toBe(
        404,
      );

      const connected = await connect(owner, ownerProduct);
      expect(connected.account).toMatchObject({ status: "ACTIVE", health: "IDLE" });
      const credentialState = await pool.query<{
        api_key_hash: Buffer;
        signing_secret_ciphertext: Buffer;
      }>(
        `SELECT api_key_hash, signing_secret_ciphertext FROM enough.integration_accounts
         WHERE id = $1 AND product_id = $2 AND user_id = $3`,
        [connected.account.id, ownerProduct, owner.id],
      );
      expect(credentialState.rowCount).toBe(1);
      expect(credentialState.rows[0].api_key_hash).toEqual(
        createHash("sha256").update(connected.credentials.apiKey).digest(),
      );
      expect(credentialState.rows[0].signing_secret_ciphertext).not.toEqual(
        Buffer.from(connected.credentials.signingSecret),
      );
      const { decryptIntegrationSecret } = await import("@enough/auth");
      expect(decryptIntegrationSecret(credentialState.rows[0].signing_secret_ciphertext)).toBe(
        connected.credentials.signingSecret,
      );

      const listing = await payload(
        await appRequest(`/integrations?productId=${ownerProduct}`, owner),
      );
      expect(listing.accounts[0]).toMatchObject({
        id: connected.account.id,
        provider: "WEBHOOK",
        health: "IDLE",
      });
      const serializedListing = JSON.stringify(listing);
      expect(serializedListing).not.toContain(connected.credentials.apiKey);
      expect(serializedListing).not.toContain(connected.credentials.signingSecret);

      const exported = await payload(await request("/auth/account/export", owner));
      const serializedExport = JSON.stringify(exported);
      expect(serializedExport).not.toContain(connected.credentials.apiKey);
      expect(serializedExport).not.toContain(connected.credentials.signingSecret);
      expect(serializedExport).not.toContain(credentialState.rows[0].api_key_hash.toString("hex"));
      expect(exported.integrationAccounts).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: connected.account.id })]),
      );

      expect(
        (await appRequest(`/integrations/${connected.account.id}/revoke`, outsider, {})).status,
      ).toBe(404);
      await pool.query(
        `INSERT INTO enough.integration_tokens
           (integration_account_id, user_id, product_id, access_token_ciphertext)
         VALUES ($1, $2, $3, $4)`,
        [connected.account.id, owner.id, ownerProduct, randomUUID()],
      );
      const revoked = await payload(
        await appRequest(`/integrations/${connected.account.id}/revoke`, owner, {}),
      );
      expect(revoked.status).toBe("REVOKED");
      const revokedState = await pool.query<{
        status: string;
        api_key_hash: Buffer | null;
        tokens: string;
      }>(
        `SELECT account.status, account.api_key_hash,
                (SELECT count(*)::text FROM enough.integration_tokens token
                 WHERE token.integration_account_id = account.id) AS tokens
         FROM enough.integration_accounts account WHERE account.id = $1`,
        [connected.account.id],
      );
      expect(revokedState.rows[0]).toEqual({ status: "REVOKED", api_key_hash: null, tokens: "0" });
      expect(
        (
          await sendEvent(connected.credentials, {
            eventId: "revoked-event",
            eventType: "analytics.user_signup",
            occurredAt: new Date().toISOString(),
          })
        ).status,
      ).toBe(401);
      const audit = await pool.query<{ event_type: string; count: string }>(
        `SELECT event_type, count(*)::text AS count FROM enough.auth_audit_events
         WHERE user_id = $1 AND event_type IN ('integration.connected', 'integration.disconnected')
         GROUP BY event_type`,
        [owner.id],
      );
      expect(audit.rows).toEqual(
        expect.arrayContaining([
          { event_type: "integration.connected", count: "1" },
          { event_type: "integration.disconnected", count: "1" },
        ]),
      );
      expect(outsiderProduct).toBeTruthy();
    });

    it("rejects invalid, stale, malformed, and conflicting events; retries are idempotent", async () => {
      const owner = await account();
      const productId = await product(owner, "Phase 14 replay product");
      const connected = await connect(owner, productId, "Replay acceptance webhook");
      const event = {
        eventId: `phase14-${randomUUID()}`,
        eventType: "analytics.user_signup",
        occurredAt: new Date(Date.now() - 1000).toISOString(),
        userReference: `opaque-${randomUUID()}`,
      };
      expect((await sendEvent({ ...connected.credentials, apiKey: "invalid" }, event)).status).toBe(
        401,
      );
      expect(
        (await sendEvent(connected.credentials, event, { signature: `sha256=${"0".repeat(64)}` }))
          .status,
      ).toBe(401);
      const staleTimestamp = (Math.floor(Date.now() / 1000) - 600).toString();
      expect(
        (await sendEvent(connected.credentials, event, { timestamp: staleTimestamp })).status,
      ).toBe(401);
      const futureTimestamp = (Math.floor(Date.now() / 1000) + 600).toString();
      expect(
        (await sendEvent(connected.credentials, event, { timestamp: futureTimestamp })).status,
      ).toBe(401);
      expect(
        (
          await sendEvent(connected.credentials, {
            ...event,
            eventId: `${event.eventId}-future`,
            occurredAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          })
        ).status,
      ).toBe(400);
      expect((await sendEvent(connected.credentials, event, { body: "{" })).status).toBe(400);

      const malformed = await sendEvent(connected.credentials, {
        ...event,
        amountMinor: 500,
        currency: "EUR",
      });
      expect(malformed.status).toBe(400);
      const created = await payload(await sendEvent(connected.credentials, event), 202);
      expect(created).toMatchObject({ duplicate: false, rewardIssued: false });
      const duplicate = await payload(await sendEvent(connected.credentials, event));
      expect(duplicate).toMatchObject({ duplicate: true, rewardIssued: false });
      const conflict = await payload(
        await sendEvent(connected.credentials, { ...event, eventType: "analytics.user_activated" }),
        409,
      );
      expect(conflict.error).toContain("different event data");

      const stored = await pool.query<{
        user_reference_hash: string | null;
        payload_hash: string;
        provider_origin_verified: boolean;
      }>(
        `SELECT user_reference_hash, payload_hash, provider_origin_verified FROM enough.integration_events
         WHERE integration_account_id = $1 AND provider_event_id = $2`,
        [connected.account.id, event.eventId],
      );
      expect(stored.rowCount).toBe(1);
      expect(stored.rows[0].user_reference_hash).toBe(
        createHmac("sha256", connected.credentials.signingSecret)
          .update(event.userReference)
          .digest("hex"),
      );
      expect(stored.rows[0].payload_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(stored.rows[0].user_reference_hash).not.toBe(event.userReference);
      expect(stored.rows[0].provider_origin_verified).toBe(false);
      const connectedListing = await payload(
        await appRequest(`/integrations?productId=${productId}`, owner),
      );
      expect(connectedListing.accounts[0].health).toBe("CONNECTED");
    });

    it("ingests a normalized event through the separately named Public Event API adapter", async () => {
      const owner = await account();
      const productId = await product(owner, "Phase 14 public API product");
      const connected = await connect(owner, productId, "Public API acceptance", "PUBLIC_API");
      const accepted = await payload(
        await sendEvent(connected.credentials, {
          eventId: `phase14-public-api-${randomUUID()}`,
          eventType: "revenue.payment_received",
          occurredAt: new Date(Date.now() - 1000).toISOString(),
          amountMinor: 500,
          currency: "EUR",
        }),
        202,
      );
      expect(accepted).toMatchObject({ duplicate: false, rewardIssued: false });
      expect(accepted.event).toMatchObject({
        eventType: "revenue.payment_received",
        amountMinor: 500,
        currency: "EUR",
      });
    });

    it("keeps integration-originated evidence pending and grants the linked task reward exactly once after review", async () => {
      const owner = await account();
      const outsider = await account();
      const productId = await product(owner, "Phase 14 evidence linkage product");
      const outsiderProduct = await product(outsider, "Phase 14 outsider evidence product");
      const { completionId } = await completedTask(owner, productId, 5);
      const outsiderCompletion = await completedTask(outsider, outsiderProduct, 5);
      const connected = await connect(owner, productId, "Task evidence webhook");
      expect(
        (
          await sendEvent(connected.credentials, {
            eventId: `phase14-cross-scope-${randomUUID()}`,
            eventType: "calendar.interview_completed",
            occurredAt: new Date(Date.now() - 1000).toISOString(),
            completionId: outsiderCompletion.completionId,
          })
        ).status,
      ).toBe(404);
      const event = {
        eventId: `phase14-task-${randomUUID()}`,
        eventType: "calendar.interview_completed",
        occurredAt: new Date(Date.now() - 1000).toISOString(),
        completionId,
      };
      const accepted = await payload(await sendEvent(connected.credentials, event), 202);
      expect(accepted).toMatchObject({ duplicate: false, rewardIssued: false });
      expect(accepted.event.evidenceId).toBeTruthy();
      const pending = await pool.query<{
        provenance: string;
        verification_status: string;
        verification_method: string;
        reviewed_by_user_id: string | null;
      }>(
        `SELECT provenance, verification_status, verification_method, reviewed_by_user_id
         FROM enough.task_evidence_items WHERE id = $1 AND user_id = $2 AND product_id = $3`,
        [accepted.event.evidenceId, owner.id, productId],
      );
      expect(pending.rows[0]).toEqual({
        provenance: "SERVER_VERIFIED",
        verification_status: "PENDING",
        verification_method: "MANUAL",
        reviewed_by_user_id: null,
      });
      const beforeReview = await pool.query<{ transactions: string; balance: string }>(
        `SELECT count(transaction.id)::text AS transactions,
                coalesce(max(account.available_balance), 0)::text AS balance
         FROM enough.credit_transactions transaction
         LEFT JOIN enough.credit_accounts account ON account.id = transaction.account_id
         WHERE transaction.user_id = $1 AND transaction.idempotency_key = $2`,
        [owner.id, `taskreward:${completionId}`],
      );
      expect(beforeReview.rows[0]).toEqual({ transactions: "0", balance: "0" });

      const verified = await payload(
        await request(`/task-evidence/${accepted.event.evidenceId}/decision`, owner, {
          decision: "VERIFIED",
        }),
      );
      expect(verified).toMatchObject({ verificationStatus: "VERIFIED", rewardIssued: true });
      expect(
        await payload(
          await request(`/task-evidence/${accepted.event.evidenceId}/decision`, owner, {
            decision: "VERIFIED",
          }),
        ),
      ).toMatchObject({ verificationStatus: "VERIFIED", rewardIssued: false, replayed: true });
      const ledger = await pool.query<{ transactions: string; balance: string }>(
        `SELECT count(transaction.id)::text AS transactions,
                max(account.available_balance)::text AS balance
         FROM enough.credit_transactions transaction
         JOIN enough.credit_accounts account ON account.id = transaction.account_id
         WHERE transaction.user_id = $1 AND transaction.idempotency_key = $2`,
        [owner.id, `taskreward:${completionId}`],
      );
      expect(ledger.rows[0]).toEqual({ transactions: "1", balance: "5" });
      const eventReplay = await payload(await sendEvent(connected.credentials, event));
      expect(eventReplay).toMatchObject({ duplicate: true, rewardIssued: false });
    });

    it("serializes revocation against an in-flight signed event", async () => {
      const owner = await account();
      const productId = await product(owner, "Phase 14 revocation race product");
      const connected = await connect(owner, productId, "Revocation race webhook");
      const event = {
        eventId: `phase14-race-${randomUUID()}`,
        eventType: "analytics.user_activated",
        occurredAt: new Date(Date.now() - 1000).toISOString(),
      };
      const [ingestion, revocation] = await Promise.all([
        sendEvent(connected.credentials, event),
        appRequest(`/integrations/${connected.account.id}/revoke`, owner, {}),
      ]);
      expect([202, 401]).toContain(ingestion.status);
      expect(revocation.status).toBe(200);
      expect(
        (await sendEvent(connected.credentials, { ...event, eventId: `${event.eventId}-after` }))
          .status,
      ).toBe(401);
      const stored = await pool.query<{ count: string; account_status: string }>(
        `SELECT count(event.id)::text AS count, max(account.status) AS account_status
         FROM enough.integration_accounts account
         LEFT JOIN enough.integration_events event ON event.integration_account_id = account.id
         WHERE account.id = $1 GROUP BY account.status`,
        [connected.account.id],
      );
      expect(stored.rows[0]).toMatchObject({ account_status: "REVOKED" });
      expect(Number(stored.rows[0].count)).toBeLessThanOrEqual(1);
    });

    it("cascades integration accounts, tokens, sync history, and normalized events on account deletion", async () => {
      const owner = await account();
      const productId = await product(owner, "Phase 14 deletion cleanup product");
      const connected = await connect(owner, productId, "Deletion cleanup webhook");
      await sendEvent(connected.credentials, {
        eventId: `phase14-delete-${randomUUID()}`,
        eventType: "analytics.conversion_completed",
        occurredAt: new Date(Date.now() - 1000).toISOString(),
      });
      await pool.query(
        `INSERT INTO enough.integration_tokens
           (integration_account_id, user_id, product_id, access_token_ciphertext)
         VALUES ($1, $2, $3, $4)`,
        [connected.account.id, owner.id, productId, randomUUID()],
      );
      const syncRunId = randomUUID();
      await pool.query(
        `INSERT INTO enough.integration_sync_runs
           (id, integration_account_id, user_id, product_id, status, finished_at)
         VALUES ($1, $2, $3, $4, 'FAILED', now())`,
        [syncRunId, connected.account.id, owner.id, productId],
      );
      await pool.query(
        `INSERT INTO enough.integration_errors
           (id, integration_account_id, user_id, product_id, sync_run_id, error_code, safe_message)
         VALUES ($1, $2, $3, $4, $5, 'FIXTURE_FAILURE', 'Synthetic safe failure')`,
        [randomUUID(), connected.account.id, owner.id, productId, syncRunId],
      );
      await pool.query(
        `INSERT INTO enough.integration_provider_configs
           (integration_account_id, user_id, product_id, configuration, credential_ciphertext)
         VALUES ($1, $2, $3, '{"fixture":true}'::jsonb, $4)`,
        [connected.account.id, owner.id, productId, Buffer.from("synthetic-encrypted-fixture")],
      );
      await pool.query(
        `INSERT INTO enough.integration_oauth_states
           (id, state_hash, user_id, product_id, provider, display_name, scopes,
            configuration, pkce_verifier_ciphertext, expires_at)
         VALUES ($1, $2, $3, $4, 'GMAIL', 'Deletion state', '{}', '{}'::jsonb, $5, now() + interval '10 minutes')`,
        [
          randomUUID(),
          createHash("sha256").update(randomUUID()).digest("hex"),
          owner.id,
          productId,
          Buffer.from("synthetic-encrypted-verifier"),
        ],
      );
      const deleted = await request(
        "/auth/account",
        owner,
        { confirmationEmail: owner.email },
        "DELETE",
      );
      expect(deleted.status, await deleted.clone().text()).toBe(204);
      const remaining = await pool.query<{
        accounts: string;
        events: string;
        tokens: string;
        sync_runs: string;
        errors: string;
        provider_configs: string;
        oauth_states: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM enough.integration_accounts WHERE user_id = $1) AS accounts,
           (SELECT count(*)::text FROM enough.integration_events WHERE user_id = $1) AS events,
           (SELECT count(*)::text FROM enough.integration_tokens WHERE user_id = $1) AS tokens,
           (SELECT count(*)::text FROM enough.integration_sync_runs WHERE user_id = $1) AS sync_runs,
           (SELECT count(*)::text FROM enough.integration_errors WHERE user_id = $1) AS errors,
           (SELECT count(*)::text FROM enough.integration_provider_configs WHERE user_id = $1) AS provider_configs,
           (SELECT count(*)::text FROM enough.integration_oauth_states WHERE user_id = $1) AS oauth_states`,
        [owner.id],
      );
      expect(remaining.rows[0]).toEqual({
        accounts: "0",
        events: "0",
        tokens: "0",
        sync_runs: "0",
        errors: "0",
        provider_configs: "0",
        oauth_states: "0",
      });
    });

    it("enforces the account event-ingestion rate limit", async () => {
      const owner = await account();
      const productId = await product(owner, "Phase 14 rate limit product");
      const connected = await connect(owner, productId, "Rate limit webhook");
      const event = {
        eventId: `phase14-rate-${randomUUID()}`,
        eventType: "analytics.user_signup",
        occurredAt: new Date(Date.now() - 1000).toISOString(),
      };
      expect((await sendEvent(connected.credentials, event)).status).toBe(202);
      let finalStatus = 0;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        finalStatus = (await sendEvent(connected.credentials, event)).status;
        if (finalStatus === 429) break;
      }
      expect(finalStatus).toBe(429);
    }, 60000);
  },
);
