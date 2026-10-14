import { createHmac, randomUUID } from "node:crypto";
import { decryptIntegrationSecret } from "@enough/auth";
import { pool } from "@enough/db";
import type { FastifyRequest } from "fastify";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createSession } from "../../../packages/auth/src/session.js";
import type { IntegrationOAuthRuntime } from "./integration-oauth.js";
import { registerIntegrationRoutes } from "./integrations.js";

const apiBase = "http://127.0.0.1:4426";
const appBase = "http://127.0.0.1:3315";
const oauthRuntime: IntegrationOAuthRuntime = {
  google: { clientId: "phase14-google-client", clientSecret: "phase14-google-secret" },
  microsoft: { clientId: "phase14-ms-client", clientSecret: "phase14-ms-secret" },
};
const userIds: string[] = [];
const fixtureFetch: typeof fetch = globalThis.fetch.bind(globalThis);
let activeFetcher: typeof fetch = async () => {
  throw new Error("No provider protocol fixture installed.");
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stripeSignature(body: Buffer, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const digest = createHmac("sha256", secret)
    .update(timestamp)
    .update(".")
    .update(body)
    .digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

describe.skipIf(process.env.ENOUGH_PHASE14_INTEGRATION !== "1")(
  "Phase 14 provider connection and verified-event runtime",
  () => {
    let providerApp: ReturnType<typeof Fastify>;

    beforeAll(async () => {
      const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
      expect([target.hostname, target.port, target.pathname, target.username]).toEqual([
        "127.0.0.1",
        "55946",
        "/enough_phase14",
        "enough_phase14",
      ]);
      const migration = await pool.query<{ id: string }>(
        "SELECT id FROM enough.schema_migrations WHERE id = '0020_provider_integrations.sql'",
      );
      expect(migration.rowCount).toBe(1);
      providerApp = Fastify({ bodyLimit: 256 * 1024, logger: false });
      providerApp.removeContentTypeParser("application/json");
      providerApp.addContentTypeParser(
        "application/json",
        { parseAs: "buffer" },
        (
          request: FastifyRequest,
          body: Buffer,
          done: (error: Error | null, value?: unknown) => void,
        ) => {
          (request as typeof request & { rawJsonBody?: Buffer }).rawJsonBody = Buffer.isBuffer(body)
            ? body
            : Buffer.from(body, "utf8");
          try {
            done(null, JSON.parse(Buffer.from(body).toString("utf8")) as unknown);
          } catch {
            done(Object.assign(new Error("Invalid fixture JSON."), { statusCode: 400 }), undefined);
          }
        },
      );
      vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
        activeFetcher(input, init),
      );
      await registerIntegrationRoutes(providerApp, {
        providerOptions: { oauthRuntime, fetcher: (input, init) => activeFetcher(input, init) },
      });
    }, 60_000);

    afterAll(async () => {
      if (providerApp) await providerApp.close();
      vi.unstubAllGlobals();
      await pool.query("DELETE FROM enough.auth_audit_events WHERE user_id = ANY($1::uuid[])", [
        userIds,
      ]);
      await pool.query("DELETE FROM enough.auth_users WHERE id = ANY($1::uuid[])", [userIds]);
      await pool.end();
    });

    async function account() {
      const id = randomUUID();
      userIds.push(id);
      const email = `phase14-provider-${id}@example.test`;
      await pool.query(
        "INSERT INTO enough.auth_users (id, email, email_normalized, email_verified_at) VALUES ($1, $2, $2, now())",
        [id, email],
      );
      const session = await createSession(id, "web", "Phase 14 provider fixture", "magic_link");
      return {
        id,
        headers: {
          cookie: `enough_session=${session.token}; enough_csrf=${session.csrfToken}`,
          "x-csrf-token": session.csrfToken ?? "",
          origin: appBase,
          "content-type": "application/json",
        },
      };
    }

    async function apiRequest(
      path: string,
      user: Awaited<ReturnType<typeof account>>,
      body: unknown,
    ) {
      return fixtureFetch(`${apiBase}${path}`, {
        method: "POST",
        headers: user.headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      });
    }

    async function createProductAndCompletion(user: Awaited<ReturnType<typeof account>>) {
      const productResponse = await apiRequest("/products", user, {
        name: `Provider test ${randomUUID()}`,
        productStage: "PROBLEM_VALIDATION",
        targetCustomer: "Synthetic customers",
        problemStatement: "Verify an authentic integration event",
        initialGoal: "Record one vendor-backed outcome",
      });
      expect(productResponse.status, await productResponse.clone().text()).toBe(201);
      const product = ((await productResponse.json()) as { product: { id: string } }).product;
      const taskResponse = await apiRequest("/growth-tasks", user, {
        productId: product.id,
        title: `Provider reward task ${randomUUID()}`,
        priority: 4,
        signalStrength: 4,
        estimatedMinutes: 20,
        rewardCredits: 5,
      });
      expect(taskResponse.status, await taskResponse.clone().text()).toBe(201);
      const task = ((await taskResponse.json()) as { task: { id: string } }).task;
      const completionResponse = await apiRequest(`/growth-tasks/${task.id}/complete`, user, {});
      expect(completionResponse.status, await completionResponse.clone().text()).toBe(200);
      const completion = ((await completionResponse.json()) as { completion: { id: string } })
        .completion;
      return { productId: product.id, taskId: task.id, completionId: completion.id };
    }

    function providerRequest(
      user: Awaited<ReturnType<typeof account>>,
      method: string,
      path: string,
      body?: unknown,
    ) {
      return providerApp.inject({
        method,
        url: path,
        headers: user.headers,
        ...(body === undefined ? {} : { payload: body }),
      });
    }

    it("binds OAuth state to the product, consumes callbacks once, persists encrypted tokens, refreshes, and records sync failures", async () => {
      let mode:
        | "oauth"
        | "oauth-no-refresh"
        | "refresh"
        | "refresh-preserve"
        | "sync-fail"
        | "revoke-fail" = "oauth";
      const fetcher: typeof fetch = async (value, init) => {
        expect(init?.redirect).toBe("error");
        const url = String(value);
        const parsedUrl = new URL(url);
        if (url.includes("/token")) {
          const form = new URLSearchParams(String(init?.body));
          if (form.get("grant_type") === "authorization_code") {
            expect(form.get("code_verifier")).toBeTruthy();
            const grantedScope = form.get("code")?.startsWith("calendar-")
              ? "openid https://www.googleapis.com/auth/calendar.events.readonly"
              : "openid https://www.googleapis.com/auth/gmail.metadata";
            return json({
              access_token: "fixture-original-access-token",
              ...(mode === "oauth-no-refresh"
                ? {}
                : { refresh_token: "fixture-original-refresh-token" }),
              token_type: "Bearer",
              expires_in: 3600,
              scope: grantedScope,
            });
          }
          expect(form.get("grant_type")).toBe("refresh_token");
          if (mode === "refresh-preserve")
            return json({
              access_token: "fixture-preserved-access-token",
              token_type: "Bearer",
              expires_in: 1800,
              scope: "openid https://www.googleapis.com/auth/gmail.metadata",
            });
          return json({
            access_token: "fixture-rotated-access-token",
            refresh_token: "fixture-rotated-refresh-token",
            token_type: "Bearer",
            expires_in: 1800,
            scope: "openid https://www.googleapis.com/auth/gmail.metadata",
          });
        }
        if (url.includes("openidconnect.googleapis.com"))
          return json({ sub: "synthetic-google-subject" });
        if (url.includes("gmail.googleapis.com")) {
          if (mode === "sync-fail") return json({ error: "fixture private provider failure" }, 503);
          if (parsedUrl.searchParams.get("labelIds") === "SENT")
            return json({
              messages: [{ id: "synthetic-sent-message" }, { id: "synthetic-sent-message" }],
            });
          if (parsedUrl.searchParams.get("labelIds") === "INBOX") return json({ messages: [] });
          return json({
            id: "synthetic-sent-message",
            threadId: "synthetic-thread",
            internalDate: String(Date.parse("2026-10-12T10:00:00.000Z")),
            payload: { headers: [{ name: "To", value: "customer@example.test" }] },
          });
        }
        if (url.includes("oauth2.googleapis.com/revoke"))
          return mode === "revoke-fail"
            ? json({ error: "fixture sensitive revoke response" }, 503)
            : new Response(null, { status: 200 });
        throw new Error(`Unexpected fixture request host: ${new URL(url).host}`);
      };
      activeFetcher = fetcher;

      const owner = await account();
      const { productId, completionId } = await createProductAndCompletion(owner);
      const started = await providerRequest(owner, "POST", "/integrations/oauth/GMAIL/start", {
        productId,
        provider: "GMAIL",
        displayName: "Synthetic Gmail",
      });
      expect(started.statusCode, started.body).toBe(200);
      const authorizationUrl = new URL(
        (started.json() as { authorizationUrl: string }).authorizationUrl,
      );
      const state = authorizationUrl.searchParams.get("state");
      expect(state).toBeTruthy();
      if (!state) throw new Error("OAuth state was not included in the authorization URL.");
      expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
      expect(authorizationUrl.searchParams.get("scope")).toBe(
        "openid https://www.googleapis.com/auth/gmail.metadata",
      );
      const tamperedState = `${state.slice(0, -1)}${state.endsWith("A") ? "B" : "A"}`;
      const tamperedCallback = await providerApp.inject({
        method: "GET",
        url: `/integrations/oauth/google/callback?state=${encodeURIComponent(tamperedState)}&code=fixture-code`,
      });
      expect(tamperedCallback.statusCode).toBe(400);
      expect(tamperedCallback.json()).toEqual({
        error: "The authorization request expired or was already used.",
      });
      const afterTamperedState = await pool.query<{ accounts: string; tokens: string }>(
        `SELECT
           (SELECT count(*)::text FROM enough.integration_accounts
            WHERE user_id = $1 AND provider = 'GMAIL' AND product_id = $2) AS accounts,
           (SELECT count(*)::text FROM enough.integration_tokens token
            JOIN enough.integration_accounts account ON account.id = token.integration_account_id
            WHERE account.user_id = $1 AND account.provider = 'GMAIL' AND account.product_id = $2) AS tokens`,
        [owner.id, productId],
      );
      expect(afterTamperedState.rows[0]).toEqual({ accounts: "0", tokens: "0" });

      const noCodeStart = await providerRequest(owner, "POST", "/integrations/oauth/GMAIL/start", {
        productId,
        provider: "GMAIL",
        displayName: "Synthetic Gmail",
      });
      expect(noCodeStart.statusCode, noCodeStart.body).toBe(200);
      const noCodeUrl = new URL(
        (noCodeStart.json() as { authorizationUrl: string }).authorizationUrl,
      );
      const noCodeState = noCodeUrl.searchParams.get("state");
      expect(noCodeState).toBeTruthy();
      if (!noCodeState) throw new Error("OAuth state was not included in the authorization URL.");
      const missingCodeCallback = await providerApp.inject({
        method: "GET",
        url: `/integrations/oauth/google/callback?state=${encodeURIComponent(noCodeState)}`,
      });
      expect(missingCodeCallback.statusCode).toBe(302);
      expect(missingCodeCallback.headers.location).toContain("provider=gmail");
      expect(missingCodeCallback.headers.location).toContain("connection=failed");
      expect(missingCodeCallback.headers.location).not.toContain(noCodeState);
      const missingCodeAudit = await pool.query<{ metadata: Record<string, unknown> }>(
        `SELECT metadata FROM enough.auth_audit_events
         WHERE user_id = $1 AND event_type = 'integration.connection_failed'
           AND metadata->>'productId' = $2`,
        [owner.id, productId],
      );
      expect(missingCodeAudit.rows).toEqual([
        {
          metadata: {
            productId,
            provider: "GMAIL",
            failureCode: "AUTHORIZATION_CODE_MISSING",
            callbackStage: "TOKEN_EXCHANGE",
          },
        },
      ]);
      const beforeValidCallback = await pool.query<{ accounts: string; tokens: string }>(
        `SELECT
           (SELECT count(*)::text FROM enough.integration_accounts
            WHERE user_id = $1 AND provider = 'GMAIL' AND product_id = $2) AS accounts,
           (SELECT count(*)::text FROM enough.integration_tokens token
            JOIN enough.integration_accounts account ON account.id = token.integration_account_id
            WHERE account.user_id = $1 AND account.provider = 'GMAIL' AND account.product_id = $2) AS tokens`,
        [owner.id, productId],
      );
      expect(beforeValidCallback.rows[0]).toEqual({ accounts: "0", tokens: "0" });
      const persistedState = await pool.query<{
        state_hash: string;
        pkce_verifier_ciphertext: Buffer;
      }>(
        "SELECT state_hash, pkce_verifier_ciphertext FROM enough.integration_oauth_states WHERE user_id = $1 AND product_id = $2",
        [owner.id, productId],
      );
      expect(persistedState.rowCount).toBe(2);
      expect(persistedState.rows.every((row) => row.state_hash !== state)).toBe(true);

      const callback = await providerApp.inject({
        method: "GET",
        url: `/integrations/oauth/google/callback?state=${encodeURIComponent(state)}&code=fixture-code`,
      });
      expect(callback.statusCode).toBe(302);
      const accountResult = await pool.query<{ id: string }>(
        "SELECT id FROM enough.integration_accounts WHERE user_id = $1 AND provider = 'GMAIL' AND product_id = $2",
        [owner.id, productId],
      );
      expect(accountResult.rowCount).toBe(1);
      const integrationId = accountResult.rows[0].id;
      const stored = await pool.query<{
        access_token_ciphertext: Buffer;
        refresh_token_ciphertext: Buffer;
      }>(
        "SELECT access_token_ciphertext, refresh_token_ciphertext FROM enough.integration_tokens WHERE integration_account_id = $1",
        [integrationId],
      );
      expect(decryptIntegrationSecret(stored.rows[0].access_token_ciphertext)).toBe(
        "fixture-original-access-token",
      );
      expect(stored.rows[0].access_token_ciphertext.toString()).not.toContain(
        "fixture-original-access-token",
      );
      expect(decryptIntegrationSecret(stored.rows[0].refresh_token_ciphertext)).toBe(
        "fixture-original-refresh-token",
      );
      const exportedResponse = await fixtureFetch(`${apiBase}/auth/account/export`, {
        headers: owner.headers,
        signal: AbortSignal.timeout(45_000),
      });
      expect(exportedResponse.status, await exportedResponse.clone().text()).toBe(200);
      const exportedText = await exportedResponse.text();
      expect(exportedText).toContain("GMAIL");
      expect(exportedText).not.toContain("fixture-original-access-token");
      expect(exportedText).not.toContain("fixture-original-refresh-token");
      expect(exportedText).not.toContain("synthetic-google-subject");
      const replay = await providerApp.inject({
        method: "GET",
        url: `/integrations/oauth/google/callback?state=${encodeURIComponent(state)}&code=fixture-code`,
      });
      expect(replay.statusCode).toBe(400);

      mode = "oauth-no-refresh";
      const repeatedStart = await providerRequest(
        owner,
        "POST",
        "/integrations/oauth/GMAIL/start",
        { productId, provider: "GMAIL", displayName: "Synthetic Gmail reconnected" },
      );
      expect(repeatedStart.statusCode, repeatedStart.body).toBe(200);
      const repeatedUrl = new URL(
        (repeatedStart.json() as { authorizationUrl: string }).authorizationUrl,
      );
      const repeatedState = repeatedUrl.searchParams.get("state");
      expect(repeatedState).toBeTruthy();
      if (!repeatedState) throw new Error("OAuth state was not included in the authorization URL.");
      const repeatedCallback = await providerApp.inject({
        method: "GET",
        url: `/integrations/oauth/google/callback?state=${encodeURIComponent(repeatedState)}&code=second-fixture-code`,
      });
      expect(repeatedCallback.statusCode).toBe(302);
      expect(repeatedCallback.headers.location).toContain("connection=connected");
      const afterReconnect = await pool.query<{ id: string; status: string }>(
        `SELECT id, status FROM enough.integration_accounts
         WHERE user_id = $1 AND provider = 'GMAIL' AND product_id = $2`,
        [owner.id, productId],
      );
      expect(afterReconnect.rows).toEqual([{ id: integrationId, status: "ACTIVE" }]);
      const preservedGmailRefresh = await pool.query<{ refresh_token_ciphertext: Buffer }>(
        "SELECT refresh_token_ciphertext FROM enough.integration_tokens WHERE integration_account_id = $1",
        [integrationId],
      );
      expect(decryptIntegrationSecret(preservedGmailRefresh.rows[0].refresh_token_ciphertext)).toBe(
        "fixture-original-refresh-token",
      );

      mode = "oauth";
      const calendarStart = await providerRequest(
        owner,
        "POST",
        "/integrations/oauth/GOOGLE_CALENDAR/start",
        { productId, provider: "GOOGLE_CALENDAR", displayName: "Synthetic Calendar" },
      );
      expect(calendarStart.statusCode, calendarStart.body).toBe(200);
      const calendarUrl = new URL(
        (calendarStart.json() as { authorizationUrl: string }).authorizationUrl,
      );
      const calendarState = calendarUrl.searchParams.get("state");
      expect(calendarState).toBeTruthy();
      if (!calendarState) throw new Error("OAuth state was not included in the authorization URL.");
      const calendarCallback = await providerApp.inject({
        method: "GET",
        url: `/integrations/oauth/google/callback?state=${encodeURIComponent(calendarState)}&code=calendar-fixture-code`,
      });
      expect(calendarCallback.statusCode).toBe(302);
      const googleProviderCounts = await pool.query<{ provider: string; count: string }>(
        `SELECT provider, count(*)::text AS count FROM enough.integration_accounts
         WHERE user_id = $1 AND product_id = $2 AND provider IN ('GMAIL', 'GOOGLE_CALENDAR')
         GROUP BY provider ORDER BY provider`,
        [owner.id, productId],
      );
      expect(googleProviderCounts.rows).toEqual([
        { provider: "GMAIL", count: "1" },
        { provider: "GOOGLE_CALENDAR", count: "1" },
      ]);
      const calendarAccount = await pool.query<{ id: string }>(
        "SELECT id FROM enough.integration_accounts WHERE user_id = $1 AND product_id = $2 AND provider = 'GOOGLE_CALENDAR'",
        [owner.id, productId],
      );
      expect(calendarAccount.rowCount).toBe(1);

      mode = "oauth-no-refresh";
      const calendarReconnectStart = await providerRequest(
        owner,
        "POST",
        "/integrations/oauth/GOOGLE_CALENDAR/start",
        { productId, provider: "GOOGLE_CALENDAR", displayName: "Synthetic Calendar reconnected" },
      );
      expect(calendarReconnectStart.statusCode, calendarReconnectStart.body).toBe(200);
      const calendarReconnectState = new URL(
        (calendarReconnectStart.json() as { authorizationUrl: string }).authorizationUrl,
      ).searchParams.get("state");
      expect(calendarReconnectState).toBeTruthy();
      if (!calendarReconnectState)
        throw new Error("Google Calendar OAuth state was not included in the authorization URL.");
      const calendarReconnect = await providerApp.inject({
        method: "GET",
        url: `/integrations/oauth/google/callback?state=${encodeURIComponent(calendarReconnectState)}&code=calendar-reconnect-fixture-code`,
      });
      expect(calendarReconnect.statusCode).toBe(302);
      expect(calendarReconnect.headers.location).toContain("connection=connected");
      const googleConnections = await pool.query<{
        provider: string;
        id: string;
        status: string;
      }>(
        `SELECT provider, id, status FROM enough.integration_accounts
         WHERE user_id = $1 AND product_id = $2 AND provider IN ('GMAIL', 'GOOGLE_CALENDAR')
         ORDER BY provider`,
        [owner.id, productId],
      );
      expect(googleConnections.rows).toEqual([
        { provider: "GMAIL", id: integrationId, status: "ACTIVE" },
        { provider: "GOOGLE_CALENDAR", id: calendarAccount.rows[0].id, status: "ACTIVE" },
      ]);
      const preservedCalendarRefresh = await pool.query<{ refresh_token_ciphertext: Buffer }>(
        "SELECT refresh_token_ciphertext FROM enough.integration_tokens WHERE integration_account_id = $1",
        [calendarAccount.rows[0].id],
      );
      expect(
        decryptIntegrationSecret(preservedCalendarRefresh.rows[0].refresh_token_ciphertext),
      ).toBe("fixture-original-refresh-token");

      await pool.query(
        "UPDATE enough.integration_tokens SET expires_at = now() - interval '1 minute' WHERE integration_account_id = $1",
        [integrationId],
      );
      mode = "refresh";
      const synced = await providerRequest(
        owner,
        "POST",
        `/integrations/${integrationId}/sync`,
        {},
      );
      expect(synced.statusCode, synced.body).toBe(200);
      const rotated = await pool.query<{
        access_token_ciphertext: Buffer;
        refresh_token_ciphertext: Buffer;
      }>(
        "SELECT access_token_ciphertext, refresh_token_ciphertext FROM enough.integration_tokens WHERE integration_account_id = $1",
        [integrationId],
      );
      expect(decryptIntegrationSecret(rotated.rows[0].access_token_ciphertext)).toBe(
        "fixture-rotated-access-token",
      );
      expect(decryptIntegrationSecret(rotated.rows[0].refresh_token_ciphertext)).toBe(
        "fixture-rotated-refresh-token",
      );
      const successfulRun = await pool.query<{ status: string; events_verified: number }>(
        "SELECT status, events_verified FROM enough.integration_sync_runs WHERE integration_account_id = $1 ORDER BY started_at DESC LIMIT 1",
        [integrationId],
      );
      expect(successfulRun.rows[0]).toEqual({ status: "SUCCEEDED", events_verified: 0 });
      const eventRow = await pool.query<{
        provider_event_id: string;
        provider_origin_verified: boolean;
        evidence_id: string | null;
      }>(
        `SELECT provider_event_id, provider_origin_verified, evidence_id
         FROM enough.integration_events WHERE integration_account_id = $1`,
        [integrationId],
      );
      expect(eventRow.rowCount).toBe(1);
      expect(eventRow.rows[0]).toMatchObject({ provider_origin_verified: true, evidence_id: null });
      const eventCountBeforeReplay = eventRow.rowCount;
      await pool.query(
        "UPDATE enough.integration_tokens SET expires_at = now() - interval '1 minute' WHERE integration_account_id = $1",
        [integrationId],
      );
      mode = "refresh-preserve";
      const repeatedSync = await providerRequest(
        owner,
        "POST",
        `/integrations/${integrationId}/sync`,
        {},
      );
      const repeatedRun = await pool.query<{ status: string; error_code: string | null }>(
        `SELECT status, error_code FROM enough.integration_sync_runs
         WHERE integration_account_id = $1 ORDER BY started_at DESC LIMIT 1`,
        [integrationId],
      );
      expect(
        repeatedSync.statusCode,
        `${repeatedSync.body}; ${JSON.stringify(repeatedRun.rows[0])}`,
      ).toBe(200);
      const preservedTokens = await pool.query<{
        access_token_ciphertext: Buffer;
        refresh_token_ciphertext: Buffer;
      }>(
        "SELECT access_token_ciphertext, refresh_token_ciphertext FROM enough.integration_tokens WHERE integration_account_id = $1",
        [integrationId],
      );
      expect(decryptIntegrationSecret(preservedTokens.rows[0].access_token_ciphertext)).toBe(
        "fixture-preserved-access-token",
      );
      expect(decryptIntegrationSecret(preservedTokens.rows[0].refresh_token_ciphertext)).toBe(
        "fixture-rotated-refresh-token",
      );
      const eventCountAfterReplay = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM enough.integration_events WHERE integration_account_id = $1",
        [integrationId],
      );
      expect(eventCountAfterReplay.rows[0].count).toBe(String(eventCountBeforeReplay));
      const outsider = await account();
      const isolated = await providerRequest(
        outsider,
        "POST",
        `/integrations/${integrationId}/events/${encodeURIComponent(eventRow.rows[0].provider_event_id)}/evidence`,
        { completionId },
      );
      expect(isolated.statusCode).toBe(404);
      const linked = await providerRequest(
        owner,
        "POST",
        `/integrations/${integrationId}/events/${encodeURIComponent(eventRow.rows[0].provider_event_id)}/evidence`,
        { completionId },
      );
      expect(linked.statusCode, linked.body).toBe(201);
      const evidenceId = (linked.json() as { evidenceId: string }).evidenceId;
      expect(linked.json()).toMatchObject({ verificationStatus: "PENDING" });
      const pendingEvidence = await pool.query<{
        verification_status: string;
        verification_method: string;
      }>(
        "SELECT verification_status, verification_method FROM enough.task_evidence_items WHERE id = $1",
        [evidenceId],
      );
      expect(pendingEvidence.rows[0]).toEqual({
        verification_status: "PENDING",
        verification_method: "MANUAL",
      });
      const reviewed = await apiRequest(`/task-evidence/${evidenceId}/decision`, owner, {
        decision: "VERIFIED",
      });
      expect(reviewed.status, await reviewed.clone().text()).toBe(200);
      expect(await reviewed.json()).toMatchObject({
        verificationStatus: "VERIFIED",
        rewardIssued: true,
      });
      const relink = await providerRequest(
        owner,
        "POST",
        `/integrations/${integrationId}/events/${encodeURIComponent(eventRow.rows[0].provider_event_id)}/evidence`,
        { completionId },
      );
      expect(relink.statusCode).toBe(404);

      mode = "sync-fail";
      const failure = await providerRequest(
        owner,
        "POST",
        `/integrations/${integrationId}/sync`,
        {},
      );
      expect(failure.statusCode).toBe(503);
      expect(failure.body).not.toContain("fixture private provider failure");
      const failedRun = await pool.query<{ status: string; error_code: string }>(
        `SELECT run.status, run.error_code FROM enough.integration_sync_runs run
         JOIN enough.integration_accounts account ON account.id = run.integration_account_id
         WHERE account.id = $1 ORDER BY run.started_at DESC LIMIT 1`,
        [integrationId],
      );
      expect(failedRun.rows[0]).toMatchObject({
        status: "FAILED",
        error_code: "PROVIDER_HTTP_503",
      });
      mode = "revoke-fail";
      const disconnected = await providerRequest(
        owner,
        "POST",
        `/integrations/${integrationId}/revoke`,
        {},
      );
      expect(disconnected.statusCode).toBe(200);
      expect(disconnected.json()).toMatchObject({
        status: "REVOKED",
        providerRevocation: "MANUAL_REQUIRED",
      });
      expect(disconnected.body).not.toContain("fixture sensitive revoke response");
      const revokedState = await pool.query<{
        status: string;
        token_count: string;
        metadata: Record<string, unknown>;
      }>(
        `SELECT account.status,
                (SELECT count(*)::text FROM enough.integration_tokens token
                 WHERE token.integration_account_id = account.id) AS token_count,
                (SELECT metadata FROM enough.auth_audit_events
                 WHERE user_id = $2 AND event_type = 'integration.provider_revocation_result'
                   AND metadata->>'integrationId' = account.id::text
                 ORDER BY created_at DESC LIMIT 1) AS metadata
         FROM enough.integration_accounts account WHERE account.id = $1`,
        [integrationId, owner.id],
      );
      expect(revokedState.rows[0]).toMatchObject({
        status: "REVOKED",
        token_count: "0",
        metadata: {
          integrationId,
          provider: "GMAIL",
          httpStatus: 503,
          resultCategory: "ATTENTION_REQUIRED",
        },
      });
      expect(JSON.stringify(revokedState.rows[0].metadata)).not.toContain(
        "fixture sensitive revoke response",
      );
    }, 60_000);

    it("records safe OAuth callback stage failures and preserves existing connections", async () => {
      let scenario: "success" | "token-exchange-failure" | "missing-refresh" | "identity-failure" =
        "success";
      const secretMarker = "raw-provider-error-secret-marker";
      activeFetcher = async (value) => {
        const url = String(value);
        if (url.includes("oauth2.googleapis.com/token")) {
          if (scenario === "token-exchange-failure")
            return json(
              {
                error: "invalid_grant",
                error_description: secretMarker,
                access_token: secretMarker,
              },
              400,
            );
          return json({
            access_token: "fixture-callback-access-token",
            ...(scenario === "missing-refresh"
              ? {}
              : { refresh_token: "fixture-callback-refresh-token" }),
            token_type: "Bearer",
            expires_in: 3600,
            scope: "openid https://www.googleapis.com/auth/gmail.metadata",
          });
        }
        if (url.includes("openidconnect.googleapis.com/v1/userinfo")) {
          if (scenario === "identity-failure")
            return json({ error: secretMarker, access_token: secretMarker }, 401);
          return json({ sub: "callback-stage-google-subject" });
        }
        throw new Error(`Unexpected test provider host: ${new URL(url).host}`);
      };

      async function connect(
        owner: Awaited<ReturnType<typeof account>>,
        productId: string,
        displayName: string,
        code: string,
      ) {
        const started = await providerRequest(owner, "POST", "/integrations/oauth/GMAIL/start", {
          productId,
          provider: "GMAIL",
          displayName,
        });
        expect(started.statusCode, started.body).toBe(200);
        const state = new URL(
          (started.json() as { authorizationUrl: string }).authorizationUrl,
        ).searchParams.get("state");
        expect(state).toBeTruthy();
        if (!state)
          throw new Error("Google OAuth state was not included in the authorization URL.");
        const callback = await providerApp.inject({
          method: "GET",
          url: `/integrations/oauth/google/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`,
        });
        return { state, callback };
      }

      async function expectFailure(input: {
        owner: Awaited<ReturnType<typeof account>>;
        productId: string;
        state: string;
        code: string;
        callback: Awaited<ReturnType<typeof providerApp.inject>>;
        callbackStage: string;
        failureCode: string;
        expectedAccounts: number;
        expectedTokens: number;
      }) {
        expect(input.callback.statusCode).toBe(302);
        const location = input.callback.headers.location ?? "";
        expect(location).toContain("provider=gmail");
        expect(location).toContain("connection=failed");
        expect(location).not.toContain(input.state);
        expect(location).not.toContain(input.code);
        expect(location).not.toContain(secretMarker);
        const audit = await pool.query<{ metadata: Record<string, unknown> }>(
          `SELECT metadata FROM enough.auth_audit_events
           WHERE user_id = $1 AND event_type = 'integration.connection_failed'
             AND metadata->>'productId' = $2`,
          [input.owner.id, input.productId],
        );
        expect(audit.rows).toHaveLength(1);
        expect(audit.rows[0].metadata).toEqual({
          productId: input.productId,
          provider: "GMAIL",
          failureCode: input.failureCode,
          callbackStage: input.callbackStage,
        });
        const safeAudit = JSON.stringify(audit.rows[0].metadata);
        expect(safeAudit).not.toContain(secretMarker);
        expect(safeAudit).not.toContain(input.state);
        expect(safeAudit).not.toContain(input.code);
        const persisted = await pool.query<{ accounts: number; tokens: number }>(
          `SELECT
             (SELECT count(*)::int FROM enough.integration_accounts
              WHERE user_id = $1 AND product_id = $2 AND provider = 'GMAIL') AS accounts,
             (SELECT count(*)::int FROM enough.integration_tokens token
              JOIN enough.integration_accounts account ON account.id = token.integration_account_id
              WHERE account.user_id = $1 AND account.product_id = $2 AND account.provider = 'GMAIL') AS tokens`,
          [input.owner.id, input.productId],
        );
        expect(persisted.rows[0]).toEqual({
          accounts: input.expectedAccounts,
          tokens: input.expectedTokens,
        });
      }

      const existingOwner = await account();
      const existingProduct = await createProductAndCompletion(existingOwner);
      const first = await connect(
        existingOwner,
        existingProduct.productId,
        "Existing Gmail connection",
        "initial-valid-code",
      );
      expect(first.callback.headers.location).toContain("connection=connected");
      const beforeFailure = await pool.query<{
        id: string;
        status: string;
        access_token_ciphertext: Buffer;
        refresh_token_ciphertext: Buffer;
      }>(
        `SELECT account.id, account.status, token.access_token_ciphertext, token.refresh_token_ciphertext
         FROM enough.integration_accounts account
         JOIN enough.integration_tokens token ON token.integration_account_id = account.id
         WHERE account.user_id = $1 AND account.product_id = $2 AND account.provider = 'GMAIL'`,
        [existingOwner.id, existingProduct.productId],
      );
      expect(beforeFailure.rowCount).toBe(1);
      scenario = "token-exchange-failure";
      const failedReconnect = await connect(
        existingOwner,
        existingProduct.productId,
        "Existing Gmail connection",
        "token-exchange-failure-code",
      );
      await expectFailure({
        owner: existingOwner,
        productId: existingProduct.productId,
        ...failedReconnect,
        code: "token-exchange-failure-code",
        callbackStage: "TOKEN_EXCHANGE",
        failureCode: "PROVIDER_REJECTED_AUTHORIZATION",
        expectedAccounts: 1,
        expectedTokens: 1,
      });
      const afterFailure = await pool.query<{
        id: string;
        status: string;
        access_token_ciphertext: Buffer;
        refresh_token_ciphertext: Buffer;
      }>(
        `SELECT account.id, account.status, token.access_token_ciphertext, token.refresh_token_ciphertext
         FROM enough.integration_accounts account
         JOIN enough.integration_tokens token ON token.integration_account_id = account.id
         WHERE account.user_id = $1 AND account.product_id = $2 AND account.provider = 'GMAIL'`,
        [existingOwner.id, existingProduct.productId],
      );
      expect(afterFailure.rows[0].id).toBe(beforeFailure.rows[0].id);
      expect(afterFailure.rows[0].status).toBe("ACTIVE");
      expect(
        afterFailure.rows[0].access_token_ciphertext.equals(
          beforeFailure.rows[0].access_token_ciphertext,
        ),
      ).toBe(true);
      expect(
        afterFailure.rows[0].refresh_token_ciphertext.equals(
          beforeFailure.rows[0].refresh_token_ciphertext,
        ),
      ).toBe(true);

      scenario = "missing-refresh";
      const freshOwner = await account();
      const freshProduct = await createProductAndCompletion(freshOwner);
      const missingRefresh = await connect(
        freshOwner,
        freshProduct.productId,
        "Fresh Gmail without refresh token",
        "missing-refresh-code",
      );
      await expectFailure({
        owner: freshOwner,
        productId: freshProduct.productId,
        ...missingRefresh,
        code: "missing-refresh-code",
        callbackStage: "REFRESH_TOKEN_CHECK",
        failureCode: "REFRESH_TOKEN_REQUIRED",
        expectedAccounts: 0,
        expectedTokens: 0,
      });

      scenario = "identity-failure";
      const identityOwner = await account();
      const identityProduct = await createProductAndCompletion(identityOwner);
      const identityFailure = await connect(
        identityOwner,
        identityProduct.productId,
        "Gmail identity lookup failure",
        "identity-failure-code",
      );
      await expectFailure({
        owner: identityOwner,
        productId: identityProduct.productId,
        ...identityFailure,
        code: "identity-failure-code",
        callbackStage: "PROVIDER_IDENTITY",
        failureCode: "PROVIDER_IDENTITY_UNAVAILABLE",
        expectedAccounts: 0,
        expectedTokens: 0,
      });

      scenario = "success";
      await pool.query(
        "DROP TRIGGER IF EXISTS phase14_oauth_persistence_failure ON enough.integration_accounts",
      );
      await pool.query("DROP FUNCTION IF EXISTS enough.phase14_oauth_persistence_failure()");
      await pool.query(`
        CREATE FUNCTION enough.phase14_oauth_persistence_failure()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.display_name = 'Persistence failure fixture' THEN
            RAISE EXCEPTION 'fixture persistence failure marker';
          END IF;
          RETURN NEW;
        END
        $$`);
      await pool.query(`
        CREATE TRIGGER phase14_oauth_persistence_failure
        BEFORE INSERT OR UPDATE ON enough.integration_accounts
        FOR EACH ROW EXECUTE FUNCTION enough.phase14_oauth_persistence_failure()`);
      try {
        const persistenceOwner = await account();
        const persistenceProduct = await createProductAndCompletion(persistenceOwner);
        const persistenceFailure = await connect(
          persistenceOwner,
          persistenceProduct.productId,
          "Persistence failure fixture",
          "persistence-failure-code",
        );
        await expectFailure({
          owner: persistenceOwner,
          productId: persistenceProduct.productId,
          ...persistenceFailure,
          code: "persistence-failure-code",
          callbackStage: "CONNECTION_PERSISTENCE",
          failureCode: "CONNECTION_PERSISTENCE_FAILED",
          expectedAccounts: 0,
          expectedTokens: 0,
        });
      } finally {
        await pool.query(
          "DROP TRIGGER IF EXISTS phase14_oauth_persistence_failure ON enough.integration_accounts",
        );
        await pool.query("DROP FUNCTION IF EXISTS enough.phase14_oauth_persistence_failure()");
      }
    });

    it("serializes concurrent OAuth attempts for the same provider identity", async () => {
      let identityCalls = 0;
      let releaseIdentities: (() => void) | undefined;
      const bothIdentities = new Promise<void>((resolve) => {
        releaseIdentities = resolve;
      });
      activeFetcher = async (value) => {
        const url = String(value);
        if (url.includes("oauth2.googleapis.com/token"))
          return json({
            access_token: "fixture-concurrent-access-token",
            refresh_token: "fixture-concurrent-refresh-token",
            token_type: "Bearer",
            expires_in: 3600,
            scope: "openid https://www.googleapis.com/auth/gmail.metadata",
          });
        if (url.includes("openidconnect.googleapis.com/v1/userinfo")) {
          identityCalls += 1;
          if (identityCalls === 2) releaseIdentities?.();
          await bothIdentities;
          return json({ sub: "same-concurrent-google-subject" });
        }
        throw new Error(`Unexpected test provider host: ${new URL(url).host}`);
      };

      const owner = await account();
      const { productId } = await createProductAndCompletion(owner);
      async function start(): Promise<string> {
        const started = await providerRequest(owner, "POST", "/integrations/oauth/GMAIL/start", {
          productId,
          provider: "GMAIL",
          displayName: "Concurrent Gmail connection",
        });
        expect(started.statusCode, started.body).toBe(200);
        const state = new URL(
          (started.json() as { authorizationUrl: string }).authorizationUrl,
        ).searchParams.get("state");
        expect(state).toBeTruthy();
        if (!state)
          throw new Error("Google OAuth state was not included in the authorization URL.");
        return state;
      }
      const states = await Promise.all([start(), start()]);
      const callbacks = await Promise.all(
        states.map((state, index) =>
          providerApp.inject({
            method: "GET",
            url: `/integrations/oauth/google/callback?state=${encodeURIComponent(state)}&code=concurrent-code-${index}`,
          }),
        ),
      );
      expect(callbacks.map((callback) => callback.statusCode)).toEqual([302, 302]);
      expect(callbacks.map((callback) => callback.headers.location)).toEqual([
        expect.stringContaining("connection=connected"),
        expect.stringContaining("connection=connected"),
      ]);
      const rows = await pool.query<{ accounts: number; active: number; tokens: number }>(
        `SELECT
           (SELECT count(*)::int FROM enough.integration_accounts
            WHERE user_id = $1 AND product_id = $2 AND provider = 'GMAIL') AS accounts,
           (SELECT count(*)::int FROM enough.integration_accounts
            WHERE user_id = $1 AND product_id = $2 AND provider = 'GMAIL' AND status = 'ACTIVE') AS active,
           (SELECT count(*)::int FROM enough.integration_tokens token
            JOIN enough.integration_accounts account ON account.id = token.integration_account_id
            WHERE account.user_id = $1 AND account.product_id = $2 AND account.provider = 'GMAIL') AS tokens`,
        [owner.id, productId],
      );
      expect(rows.rows[0]).toEqual({ accounts: 1, active: 1, tokens: 1 });
    });

    it("verifies Microsoft scopes, refresh rotation, expiry, disconnect, and sync health", async () => {
      let mode: "oauth" | "refresh" | "refresh-preserve" | "sync-fail" = "oauth";
      const expectedScopes = "openid offline_access User.Read Mail.ReadBasic";
      const fetcher: typeof fetch = async (value, init) => {
        expect(init?.redirect).toBe("error");
        const url = String(value);
        if (url.includes("login.microsoftonline.com") && url.endsWith("/token")) {
          const form = new URLSearchParams(String(init?.body));
          if (form.get("grant_type") === "authorization_code")
            return json({
              access_token: "fixture-ms-original-access",
              refresh_token: "fixture-ms-original-refresh",
              token_type: "Bearer",
              expires_in: 3600,
              scope: "User.Read Mail.ReadBasic",
            });
          expect(form.get("grant_type")).toBe("refresh_token");
          expect(form.get("refresh_token")).toBe(
            mode === "refresh-preserve"
              ? "fixture-ms-rotated-refresh"
              : "fixture-ms-original-refresh",
          );
          expect(form.get("scope")).toBe(expectedScopes);
          return mode === "refresh-preserve"
            ? json({
                access_token: "fixture-ms-preserved-access",
                token_type: "Bearer",
                expires_in: 1800,
                scope: "User.Read Mail.ReadBasic",
              })
            : json({
                access_token: "fixture-ms-rotated-access",
                refresh_token: "fixture-ms-rotated-refresh",
                token_type: "Bearer",
                expires_in: 1800,
                scope:
                  "https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.ReadBasic",
              });
        }
        if (url.includes("graph.microsoft.com/v1.0/me?$select=id"))
          return json({ id: "fixture-ms-account-id" });
        if (url.includes("graph.microsoft.com/v1.0/me/mailFolders/")) {
          if (mode === "sync-fail") return json({ error: "private Graph diagnostic" }, 503);
          const expectedAccessToken =
            mode === "refresh"
              ? "fixture-ms-rotated-access"
              : mode === "refresh-preserve"
                ? "fixture-ms-preserved-access"
                : "fixture-ms-original-access";
          expect(new Headers(init?.headers).get("authorization")).toBe(
            `Bearer ${expectedAccessToken}`,
          );
          if (url.includes("/sentitems/messages"))
            return json({
              value: [
                {
                  id: "fixture-ms-message",
                  conversationId: "fixture-ms-conversation",
                  sentDateTime: "2026-10-12T10:00:00Z",
                  toRecipients: [
                    { emailAddress: { address: "Customer@example.test" } },
                    { emailAddress: { address: "customer@example.test" } },
                  ],
                },
              ],
            });
          expect(new URL(url).searchParams.get("$select")).not.toContain("body");
          return json({ value: [] });
        }
        throw new Error(`Unexpected Microsoft fixture request: ${url}`);
      };
      activeFetcher = fetcher;

      const owner = await account();
      const { productId } = await createProductAndCompletion(owner);
      const started = await providerRequest(owner, "POST", "/integrations/oauth/OUTLOOK/start", {
        productId,
        provider: "OUTLOOK",
        displayName: "Synthetic Outlook",
      });
      expect(started.statusCode, started.body).toBe(200);
      const authorizationUrl = new URL(
        (started.json() as { authorizationUrl: string }).authorizationUrl,
      );
      expect(authorizationUrl.searchParams.get("scope")).toBe(expectedScopes);
      expect(authorizationUrl.searchParams.get("state")).toBeTruthy();
      const state = authorizationUrl.searchParams.get("state");
      if (!state)
        throw new Error("Microsoft OAuth state was not included in the authorization URL.");
      const callback = await providerApp.inject({
        method: "GET",
        url: `/integrations/oauth/microsoft/callback?state=${encodeURIComponent(state)}&code=fixture-ms-code`,
      });
      expect(callback.statusCode).toBe(302);
      const accountResult = await pool.query<{ id: string }>(
        "SELECT id FROM enough.integration_accounts WHERE user_id = $1 AND product_id = $2 AND provider = 'OUTLOOK'",
        [owner.id, productId],
      );
      expect(accountResult.rowCount).toBe(1);
      const integrationId = accountResult.rows[0].id;
      const initialTokens = await pool.query<{
        scopes: string[];
        refresh_token_ciphertext: Buffer;
      }>(
        "SELECT scopes, refresh_token_ciphertext FROM enough.integration_tokens WHERE integration_account_id = $1",
        [integrationId],
      );
      expect(initialTokens.rows[0].scopes).toEqual(expectedScopes.split(" "));
      expect(decryptIntegrationSecret(initialTokens.rows[0].refresh_token_ciphertext)).toBe(
        "fixture-ms-original-refresh",
      );

      await pool.query(
        "UPDATE enough.integration_tokens SET expires_at = now() - interval '1 minute' WHERE integration_account_id = $1",
        [integrationId],
      );
      mode = "refresh";
      const firstSync = await providerRequest(
        owner,
        "POST",
        `/integrations/${integrationId}/sync`,
        {},
      );
      expect(firstSync.statusCode, firstSync.body).toBe(200);
      const rotatedTokens = await pool.query<{
        scopes: string[];
        refresh_token_ciphertext: Buffer;
      }>(
        "SELECT scopes, refresh_token_ciphertext FROM enough.integration_tokens WHERE integration_account_id = $1",
        [integrationId],
      );
      expect(rotatedTokens.rows[0].scopes).toEqual(expectedScopes.split(" "));
      expect(decryptIntegrationSecret(rotatedTokens.rows[0].refresh_token_ciphertext)).toBe(
        "fixture-ms-rotated-refresh",
      );
      const syncedEvents = await pool.query<{
        count: string;
        provider_origin_verified: boolean;
        evidence_id: string | null;
      }>(
        `SELECT count(*)::text AS count, bool_and(provider_origin_verified) AS provider_origin_verified,
                max(evidence_id::text) AS evidence_id
         FROM enough.integration_events WHERE integration_account_id = $1`,
        [integrationId],
      );
      expect(syncedEvents.rows[0]).toEqual({
        count: "1",
        provider_origin_verified: true,
        evidence_id: null,
      });

      await pool.query(
        "UPDATE enough.integration_tokens SET expires_at = now() - interval '1 minute' WHERE integration_account_id = $1",
        [integrationId],
      );
      mode = "refresh-preserve";
      const repeatedSync = await providerRequest(
        owner,
        "POST",
        `/integrations/${integrationId}/sync`,
        {},
      );
      expect(repeatedSync.statusCode, repeatedSync.body).toBe(200);
      const preservedTokens = await pool.query<{ refresh_token_ciphertext: Buffer }>(
        "SELECT refresh_token_ciphertext FROM enough.integration_tokens WHERE integration_account_id = $1",
        [integrationId],
      );
      expect(decryptIntegrationSecret(preservedTokens.rows[0].refresh_token_ciphertext)).toBe(
        "fixture-ms-rotated-refresh",
      );
      const eventCount = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM enough.integration_events WHERE integration_account_id = $1",
        [integrationId],
      );
      expect(eventCount.rows[0].count).toBe("1");

      mode = "sync-fail";
      const failure = await providerRequest(
        owner,
        "POST",
        `/integrations/${integrationId}/sync`,
        {},
      );
      expect(failure.statusCode).toBe(503);
      expect(failure.body).not.toContain("private Graph diagnostic");
      const failedRun = await pool.query<{ status: string; error_code: string }>(
        `SELECT account.status, run.error_code
         FROM enough.integration_accounts account
         JOIN enough.integration_sync_runs run ON run.integration_account_id = account.id
         WHERE account.id = $1 ORDER BY run.started_at DESC LIMIT 1`,
        [integrationId],
      );
      expect(failedRun.rows[0]).toEqual({ status: "ERROR", error_code: "PROVIDER_HTTP_503" });
      const disconnected = await providerRequest(
        owner,
        "POST",
        `/integrations/${integrationId}/revoke`,
        {},
      );
      expect(disconnected.statusCode).toBe(200);
      expect(disconnected.json()).toMatchObject({
        status: "REVOKED",
        providerRevocation: "MANUAL_REQUIRED",
      });
    }, 60_000);

    it("isolates analytics connections and records private sync failures in provider health", async () => {
      const owner = await account();
      const outsider = await account();
      const { productId } = await createProductAndCompletion(owner);
      const token = "phc_phase14_fixture_token";
      let calls = 0;
      activeFetcher = async (value, init) => {
        calls += 1;
        expect(String(value)).toBe("https://eu.posthog.com/api/projects/12345/query/");
        expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
        expect(init?.redirect).toBe("error");
        if (calls === 1) return json({ results: [] });
        return json({ error: "synthetic private analytics failure" }, 503);
      };

      const connected = await providerRequest(owner, "POST", "/integrations/credentials", {
        productId,
        provider: "POSTHOG",
        displayName: "Synthetic analytics",
        apiToken: token,
        projectId: "12345",
        region: "eu",
        eventMap: { signup: "analytics.user_signup" },
      });
      expect(connected.statusCode, connected.body).toBe(201);
      const integrationId = (connected.json() as { integrationId: string }).integrationId;
      const crossAccount = await providerRequest(
        outsider,
        "POST",
        `/integrations/${integrationId}/sync`,
        {},
      );
      expect(crossAccount.statusCode).toBe(404);
      const failure = await providerRequest(
        owner,
        "POST",
        `/integrations/${integrationId}/sync`,
        {},
      );
      expect(failure.statusCode).toBe(503);
      expect(failure.body).not.toContain(token);
      expect(failure.body).not.toContain("synthetic private analytics failure");
      const health = await pool.query<{ status: string; error_code: string }>(
        `SELECT account.status, run.error_code
         FROM enough.integration_accounts account
         JOIN enough.integration_sync_runs run ON run.integration_account_id = account.id
         WHERE account.id = $1 ORDER BY run.started_at DESC LIMIT 1`,
        [integrationId],
      );
      expect(health.rows[0]).toEqual({ status: "ERROR", error_code: "PROVIDER_HTTP_503" });
    });

    it("confirms Stripe test-mode events through Stripe, creates one automatic reward, and keeps owner HMAC distinct", async () => {
      const owner = await account();
      const { productId, completionId } = await createProductAndCompletion(owner);
      const webhookSecret = "whsec_phase14_fixture_only_secret";
      const event = {
        id: "evt_phase14fixturepayment",
        type: "payment_intent.succeeded",
        created: Math.floor(Date.now() / 1000) - 10,
        livemode: false,
        data: {
          object: {
            id: "pi_phase14fixturepayment",
            amount_received: 5_00,
            currency: "usd",
            metadata: { enough_task_completion_id: completionId },
          },
        },
      };
      const body = Buffer.from(JSON.stringify(event));
      let accountReadCalls = 0;
      let eventReadCalls = 0;
      const fetcher: typeof fetch = async (value, init) => {
        const url = String(value);
        if (url === "https://api.stripe.com/v1/account") {
          accountReadCalls += 1;
          return json({ error: { message: "sandbox account endpoint unavailable" } }, 403);
        }
        if (url === "https://api.stripe.com/v1/events?limit=1") {
          expect(init?.redirect).toBe("error");
          return json({ object: "list", data: [] });
        }
        if (url === `https://api.stripe.com/v1/events/${event.id}`) {
          eventReadCalls += 1;
          expect(new Headers(init?.headers).get("authorization")).toBe(
            "Bearer rkcs_test_fixturekey",
          );
          return new Response(body);
        }
        if (url === "https://api.stripe.com/v1/events/evt_phase14unavailable")
          return json({ error: { message: "private event read denied" } }, 403);
        throw new Error(`Unexpected Stripe fixture request: ${url}`);
      };
      activeFetcher = fetcher;
      const connected = await providerApp.inject({
        method: "POST",
        url: "/integrations/stripe",
        headers: owner.headers,
        payload: {
          productId,
          displayName: "Stripe test account",
          restrictedApiKey: "rkcs_test_fixturekey",
          accountId: "acct_phase14fixture",
          webhookSigningSecret: webhookSecret,
        },
      });
      expect(connected.statusCode, connected.body).toBe(201);
      expect(accountReadCalls).toBe(0);
      const integrationId = (connected.json() as { integrationId: string }).integrationId;

      const first = await providerApp.inject({
        method: "POST",
        url: `/v1/integrations/stripe/${integrationId}/events`,
        headers: {
          "content-type": "application/json",
          "stripe-signature": stripeSignature(body, webhookSecret),
        },
        payload: body,
      });
      expect(first.statusCode, first.body).toBe(202);
      expect(first.json()).toMatchObject({ duplicate: false, rewardIssued: true });
      expect(eventReadCalls).toBe(1);
      const duplicate = await providerApp.inject({
        method: "POST",
        url: `/v1/integrations/stripe/${integrationId}/events`,
        headers: {
          "content-type": "application/json",
          "stripe-signature": stripeSignature(body, webhookSecret),
        },
        payload: body,
      });
      expect(duplicate.statusCode, duplicate.body).toBe(200);
      expect(duplicate.json()).toMatchObject({ duplicate: true, rewardIssued: false });
      expect(eventReadCalls).toBe(2);

      const unconfirmedEvent = {
        ...event,
        id: "evt_phase14unavailable",
        data: { object: { ...event.data.object, id: "pi_phase14unavailable" } },
      };
      const unconfirmedBody = Buffer.from(JSON.stringify(unconfirmedEvent));
      const unconfirmed = await providerApp.inject({
        method: "POST",
        url: `/v1/integrations/stripe/${integrationId}/events`,
        headers: {
          "content-type": "application/json",
          "stripe-signature": stripeSignature(unconfirmedBody, webhookSecret),
        },
        payload: unconfirmedBody,
      });
      expect(unconfirmed.statusCode).toBe(422);
      expect(unconfirmed.body).not.toContain("private event read denied");
      expect(unconfirmed.body).not.toContain("rkcs_test_fixturekey");
      expect(unconfirmed.body).not.toContain(webhookSecret);

      const stored = await pool.query<{
        provider_origin_verified: boolean;
        verification_status: string;
        evidence_status: string;
        verification_method: string;
        completion_status: string;
        reward_count: string;
      }>(
        `SELECT event.provider_origin_verified, event.verification_status,
                evidence.verification_status AS evidence_status,
                evidence.verification_method, completion.verification_status AS completion_status,
                (SELECT count(*)::text FROM enough.credit_transactions transaction
                 WHERE transaction.idempotency_key = $2) AS reward_count
         FROM enough.integration_events event
         JOIN enough.task_evidence_items evidence ON evidence.id = event.evidence_id
         JOIN enough.growth_task_completions completion ON completion.id = event.completion_id
         WHERE event.integration_account_id = $1`,
        [integrationId, `taskreward:${completionId}`],
      );
      expect(stored.rows[0]).toEqual({
        provider_origin_verified: true,
        verification_status: "AUTHENTICATED",
        evidence_status: "VERIFIED",
        verification_method: "AUTOMATIC",
        completion_status: "AUTOMATICALLY_VERIFIED",
        reward_count: "1",
      });
      const eventCount = await pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM enough.integration_events WHERE integration_account_id = $1",
        [integrationId],
      );
      expect(eventCount.rows[0].count).toBe(1);
      const tokenState = await pool.query<{
        token: Buffer;
        secret: Buffer;
        account_id: Buffer;
      }>(
        `SELECT token.access_token_ciphertext AS token, config.credential_ciphertext AS secret,
                config.provider_account_ciphertext AS account_id
         FROM enough.integration_tokens token
         JOIN enough.integration_provider_configs config ON config.integration_account_id = token.integration_account_id
         WHERE token.integration_account_id = $1`,
        [integrationId],
      );
      expect(decryptIntegrationSecret(tokenState.rows[0].token)).toBe("rkcs_test_fixturekey");
      expect(decryptIntegrationSecret(tokenState.rows[0].secret)).toContain(webhookSecret);
      expect(decryptIntegrationSecret(tokenState.rows[0].account_id)).toBe("acct_phase14fixture");
    }, 60_000);
  },
);
