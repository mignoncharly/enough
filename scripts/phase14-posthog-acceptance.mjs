import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { posthogRegionHosts, readPhase14PostHogConfig } from "./phase14-posthog-config.mjs";

const fixture = join(tmpdir(), "enough-phase14");
const config = await readPhase14PostHogConfig(join(fixture, "posthog.env"));
console.info(
  JSON.stringify({
    posthogConfig: {
      fileExists: config.fileExists,
      personalApiKeyPresent: config.personalApiKeyPresent,
      projectTokenPresent: config.projectTokenPresent,
      projectIdPresent: config.projectIdPresent,
      regionPresent: config.regionPresent,
    },
  }),
);
if (!config.personalApiKeyPresent || !config.projectTokenPresent) {
  throw new Error(
    "Phase 14 PostHog local configuration is required; credential values were not read from chat.",
  );
}

const account = JSON.parse(await readFile(join(fixture, "manual-account.json"), "utf8"));
if (account.fixture !== true || !account.productId || !account.email || !account.password) {
  throw new Error("The isolated Phase 14 disposable account is missing or invalid.");
}
const fixtureEnv = await readFile(join(fixture, "fixture.env"), "utf8");
for (const line of fixtureEnv.split(/\r?\n/)) {
  const separator = line.indexOf("=");
  if (separator > 0) process.env[line.slice(0, separator)] = line.slice(separator + 1);
}

const { pool } = await import("../packages/db/src/index.ts");
const { decryptIntegrationSecret } = await import("../packages/auth/src/index.ts");
const webUrl = new URL(account.webBaseUrl);
const apiUrl = new URL(account.webBaseUrl);
apiUrl.port = "4426";
const apiBase = apiUrl.origin;
const origin = webUrl.origin;
const hosts = posthogRegionHosts(config.region);
const eventName = "phase14.acceptance_probe";
const normalizedType = "analytics.user_signup";
const displayName = "Phase 14 PostHog acceptance";
const eventMap = { [eventName]: normalizedType };
const csrfCookies = (response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
const csrfFrom = (value) =>
  value
    .split("; ")
    .find((cookie) => cookie.startsWith("enough_csrf="))
    ?.slice("enough_csrf=".length);

let sessionCookies = "";
let requestHeaders;
let integrationId = null;
let disconnected = false;
let stage = "fixture_login";
let disconnectResult = null;
let postDisconnectApiStatus = null;
let postDisconnectSyncStatus = null;
let providerRevokeStatus = null;
let providerCredentialFound = null;
let providerPersonalApiKeyRevoked = null;
let postRevocationApiStatus = null;
const postRevocationAttemptStatuses = [];

async function posthogQuery(query, { expectResults = true } = {}) {
  const response = await fetch(`${hosts.apiBaseUrl}/api/projects/${config.projectId}/query/`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.personalApiKey}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null);
  assert.equal(response.status, 200, `PostHog private Query API returned HTTP ${response.status}.`);
  if (expectResults) assert.ok(Array.isArray(body?.results));
  return body;
}

async function posthogQueryStatus() {
  const response = await fetch(`${hosts.apiBaseUrl}/api/projects/${config.projectId}/query/`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.personalApiKey}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: { kind: "HogQLQuery", query: "SELECT 1 AS enough_posthog_revocation_probe" },
    }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const status = response.status;
  await response.body?.cancel().catch(() => undefined);
  return status;
}

async function readProviderRevocationMetadata(response) {
  const body = await response.json().catch(() => null);
  return {
    credentialFound: typeof body?.found === "boolean" ? body.found : null,
    personalApiKeyRevoked: body?.found === true && body?.type === "personal_api_key",
  };
}

async function getIntegrations() {
  const response = await fetch(
    new URL(`/integrations?productId=${encodeURIComponent(account.productId)}`, apiBase),
    { headers: requestHeaders, redirect: "error", signal: AbortSignal.timeout(15_000) },
  );
  const body = await response.json().catch(() => null);
  assert.equal(
    response.status,
    200,
    `Enough integration catalog returned HTTP ${response.status}.`,
  );
  return body;
}

async function enoughPost(method, path, body = {}) {
  const response = await fetch(new URL(path, apiBase), {
    method,
    headers: requestHeaders,
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json().catch(() => null);
  return { response, result };
}

async function matchingProbe() {
  const result = await posthogQuery(
    `SELECT team_id, event, toString(timestamp), distinct_id FROM events
     WHERE event = '${eventName}' AND timestamp >= now() - INTERVAL 7 DAY
     ORDER BY timestamp DESC LIMIT 1`,
  );
  return result.results[0] ?? null;
}

async function disconnectLocal() {
  if (!integrationId || disconnected || !requestHeaders) return null;
  const { response, result } = await enoughPost("POST", `/integrations/${integrationId}/revoke`);
  assert.equal(response.status, 200, `Enough local Disconnect returned HTTP ${response.status}.`);
  const localState = await pool.query(
    "SELECT status FROM enough.integration_accounts WHERE id = $1",
    [integrationId],
  );
  const tokenRows = await pool.query(
    "SELECT count(*)::int AS count FROM enough.integration_tokens WHERE integration_account_id = $1",
    [integrationId],
  );
  assert.equal(localState.rows[0]?.status, "REVOKED");
  assert.equal(tokenRows.rows[0]?.count, 0);
  disconnected = true;
  disconnectResult = {
    httpStatus: response.status,
    localStatus: localState.rows[0].status,
    localTokenRows: tokenRows.rows[0].count,
    providerRevocation: result?.providerRevocation ?? null,
  };
  return disconnectResult;
}

try {
  const csrfResponse = await fetch(new URL("/auth/csrf", apiBase), {
    headers: { origin },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(csrfResponse.status, 200, "Fixture CSRF setup failed.");
  const csrf = await csrfResponse.json();
  const loginResponse = await fetch(new URL("/auth/login", apiBase), {
    method: "POST",
    headers: {
      origin,
      cookie: csrfCookies(csrfResponse),
      "content-type": "application/json",
      "x-csrf-token": csrf.csrfToken,
    },
    body: JSON.stringify({
      email: account.email,
      password: account.password,
      clientType: "web",
      deviceName: "Phase 14 PostHog acceptance",
    }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(loginResponse.status, 200, "Disposable fixture login failed.");
  sessionCookies = csrfCookies(loginResponse);
  requestHeaders = {
    origin,
    cookie: sessionCookies,
    "content-type": "application/json",
    "x-csrf-token": csrfFrom(sessionCookies) ?? "",
  };

  stage = "live_catalog";
  const catalog = await getIntegrations();
  const posthogEntry = catalog.catalog.find((item) => item.provider === "POSTHOG");
  assert.equal(posthogEntry?.available, true, "PostHog API-token catalog entry is not available.");
  const activeAccounts = catalog.accounts.filter(
    (item) =>
      item.provider === "POSTHOG" && item.status === "ACTIVE" && item.displayName === displayName,
  );
  assert.ok(
    activeAccounts.length <= 1,
    "More than one active real PostHog account exists for the fixture.",
  );

  stage = "posthog_api_preflight";
  const projectProbe = await posthogQuery("SELECT 1 AS enough_posthog_project_probe");
  assert.ok(projectProbe.results.length > 0, "PostHog project query returned no result.");
  let realEvent = await matchingProbe();
  let distinctId = realEvent?.[3] ?? null;
  if (!realEvent) {
    const capturedAt = new Date(Date.now() - 15_000);
    distinctId = `enough-phase14-${randomUUID()}`;
    const ingestResponse = await fetch(hosts.ingestionUrl, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        api_key: config.projectToken,
        distinct_id: distinctId,
        event: eventName,
        properties: {
          $process_person_profile: false,
          enough_phase14_probe: true,
        },
        timestamp: capturedAt.toISOString(),
      }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    assert.ok(ingestResponse.ok, `PostHog event ingestion returned HTTP ${ingestResponse.status}.`);
  }
  stage = "posthog_event_retrieval";
  for (let attempt = 0; attempt < 40 && !realEvent; attempt += 1) {
    realEvent = await matchingProbe();
    if (!realEvent) await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  assert.ok(
    realEvent,
    "PostHog did not return the injected provider event within the retrieval window.",
  );
  assert.equal(
    String(realEvent[0]),
    config.projectId,
    "PostHog returned an event from a different project.",
  );
  assert.equal(realEvent[1], eventName);
  assert.equal(realEvent[3], distinctId);

  stage = "enough_connection";
  if (activeAccounts.length === 1) {
    integrationId = activeAccounts[0].id;
    const storedConfig = await pool.query(
      `SELECT configuration FROM enough.integration_provider_configs
       WHERE integration_account_id = $1`,
      [integrationId],
    );
    const storedToken = await pool.query(
      `SELECT access_token_ciphertext FROM enough.integration_tokens
       WHERE integration_account_id = $1`,
      [integrationId],
    );
    const configuration = storedConfig.rows[0]?.configuration;
    const configurationMatches = Boolean(
      configuration &&
        configuration.projectId === config.projectId &&
        configuration.region === config.region &&
        JSON.stringify(configuration.eventMap) === JSON.stringify(eventMap),
    );
    assert.ok(
      configurationMatches,
      "The existing PostHog connection does not match this local acceptance configuration.",
    );
    assert.equal(storedToken.rowCount, 1);
    assert.ok(
      decryptIntegrationSecret(storedToken.rows[0].access_token_ciphertext) ===
        config.personalApiKey,
      "The existing PostHog connection uses a different credential.",
    );
    integrationId = activeAccounts[0].id;
  } else {
    const { response, result } = await enoughPost("POST", "/integrations/credentials", {
      productId: account.productId,
      provider: "POSTHOG",
      displayName,
      apiToken: config.personalApiKey,
      projectId: config.projectId,
      region: config.region,
      eventMap,
    });
    assert.equal(
      response.status,
      201,
      `Enough PostHog credential route returned HTTP ${response.status}.`,
    );
    if (typeof result?.integrationId === "string") {
      integrationId = result.integrationId;
    }
    assert.ok(typeof integrationId === "string");
    assert.equal(result?.status, "ACTIVE");
  }

  const encryptedToken = await pool.query(
    `SELECT access_token_ciphertext FROM enough.integration_tokens
     WHERE integration_account_id = $1`,
    [integrationId],
  );
  assert.equal(encryptedToken.rowCount, 1);
  assert.ok(
    encryptedToken.rows[0].access_token_ciphertext.toString() !== config.personalApiKey,
    "The PostHog credential was stored without encryption.",
  );
  assert.ok(
    decryptIntegrationSecret(encryptedToken.rows[0].access_token_ciphertext) ===
      config.personalApiKey,
  );

  const eventCount = async () => {
    const result = await pool.query(
      `SELECT count(*)::int AS count FROM enough.integration_events
       WHERE integration_account_id = $1`,
      [integrationId],
    );
    return result.rows[0].count;
  };
  const countBeforeSync = await eventCount();
  stage = "first_sync";
  const first = await enoughPost("POST", `/integrations/${integrationId}/sync`);
  assert.equal(
    first.response.status,
    200,
    `Enough PostHog sync returned HTTP ${first.response.status}.`,
  );
  assert.ok(Number.isInteger(first.result?.eventsReceived));
  const persisted = await pool.query(
    `SELECT event_type, occurred_at, provider_origin_verified
     FROM enough.integration_events WHERE integration_account_id = $1
     ORDER BY received_at ASC`,
    [integrationId],
  );
  assert.equal(persisted.rowCount, 1, "Expected exactly one persisted normalized PostHog event.");
  const normalizedEvent = persisted.rows[0];
  assert.equal(normalizedEvent.event_type, normalizedType);
  assert.equal(normalizedEvent.provider_origin_verified, true);
  const occurredAt = new Date(normalizedEvent.occurred_at);
  const providerEventDay = new Date(realEvent[2]).toISOString().slice(0, 10);
  assert.equal(occurredAt.toISOString().slice(0, 10), providerEventDay);
  assert.ok(occurredAt.getTime() <= Date.now());
  const countAfterFirstSync = await eventCount();
  assert.equal(countAfterFirstSync, 1);
  assert.equal(countAfterFirstSync - countBeforeSync, first.result.eventsReceived);

  stage = "immediate_resync";
  const second = await enoughPost("POST", `/integrations/${integrationId}/sync`);
  assert.equal(
    second.response.status,
    200,
    `PostHog resync returned HTTP ${second.response.status}.`,
  );
  assert.equal(second.result?.eventsReceived, 0, "Immediate PostHog resync returned a duplicate.");
  const countAfterSecondSync = await eventCount();
  assert.equal(countAfterSecondSync, countAfterFirstSync);

  stage = "disconnect";
  await disconnectLocal();
  const afterDisconnectQuery = await fetch(
    `${hosts.apiBaseUrl}/api/projects/${config.projectId}/query/`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.personalApiKey}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: { kind: "HogQLQuery", query: "SELECT 1 AS enough_posthog_disconnect_probe" },
      }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    },
  );
  postDisconnectApiStatus = afterDisconnectQuery.status;
  await afterDisconnectQuery.body?.cancel().catch(() => undefined);
  assert.equal(postDisconnectApiStatus, 200);
  const afterDisconnectSync = await enoughPost("POST", `/integrations/${integrationId}/sync`);
  postDisconnectSyncStatus = afterDisconnectSync.response.status;
  assert.equal(postDisconnectSyncStatus, 409);

  stage = "provider_key_revocation";
  const providerRevokeResponse = await fetch(`${hosts.apiBaseUrl}/api/revoke_leaked_key/`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ token: config.personalApiKey }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  providerRevokeStatus = providerRevokeResponse.status;
  ({
    credentialFound: providerCredentialFound,
    personalApiKeyRevoked: providerPersonalApiKeyRevoked,
  } = await readProviderRevocationMetadata(providerRevokeResponse));
  assert.equal(providerRevokeStatus, 200);
  assert.equal(providerCredentialFound, true);
  assert.equal(providerPersonalApiKeyRevoked, true);

  stage = "provider_key_revocation_verification";
  for (const delayMs of [0, 1_000, 2_000, 4_000, 5_000]) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const status = await posthogQueryStatus();
    postRevocationAttemptStatuses.push(status);
    postRevocationApiStatus = status;
    if (status === 401 || status === 403) break;
    if (status !== 200 && status !== 429 && status < 500) break;
  }
  assert.ok([401, 403].includes(postRevocationApiStatus));

  console.info(
    JSON.stringify({
      posthogApi: { authenticated: true, projectAccess: true, projectIdentityMatched: true },
      event: { retrieved: true, normalizedType, occurredAt: occurredAt.toISOString() },
      sync: {
        firstEventsReceived: first.result.eventsReceived,
        persistedEventRows: countAfterFirstSync,
        secondEventsReceived: second.result.eventsReceived,
        persistedEventRowsAfterResync: countAfterSecondSync,
      },
      credential: { encryptedAtRest: true },
      disconnect: disconnectResult,
      providerSideCredentialAcceptedAfterLocalDisconnect: postDisconnectApiStatus === 200,
      postDisconnectEnoughSyncStatus: postDisconnectSyncStatus,
      providerRevocation: {
        region: config.region,
        httpStatus: providerRevokeStatus,
        credentialFound: providerCredentialFound,
        personalApiKeyRevoked: providerPersonalApiKeyRevoked,
        postRevocationQueryHttpStatus: postRevocationApiStatus,
        postRevocationAttemptStatuses,
        projectTokenRevoked: false,
      },
      credentialValuesPrinted: false,
    }),
  );
} catch {
  if (integrationId && !disconnected) {
    try {
      await disconnectLocal();
    } catch {
      // Keep sensitive provider diagnostics and credentials out of local output.
    }
  }
  console.error(
    JSON.stringify({ phase14PostHogAcceptance: "FAILED", stage, credentialValuesPrinted: false }),
  );
  process.exitCode = 1;
} finally {
  try {
    if (requestHeaders && sessionCookies) {
      await fetch(new URL("/auth/logout", apiBase), {
        method: "POST",
        headers: {
          origin,
          cookie: sessionCookies,
          "x-csrf-token": csrfFrom(sessionCookies) ?? "",
        },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    }
  } catch {
    // The disposable fixture session expires independently.
  }
  await pool.end();
}
