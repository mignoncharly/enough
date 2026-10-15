import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixture = join(tmpdir(), "enough-phase14");
const account = JSON.parse(await readFile(join(fixture, "manual-account.json"), "utf8"));
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
const cookies = (response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
const csrfFrom = (value) =>
  value
    .split("; ")
    .find((cookie) => cookie.startsWith("enough_csrf="))
    ?.slice("enough_csrf=".length);
const graphRead = async (token) => {
  const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=id", {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null);
  const errorCode =
    body && typeof body === "object" && body.error && typeof body.error.code === "string"
      ? body.error.code
      : null;
  return { httpStatus: response.status, errorCode };
};

let sessionCookies = "";
let requestHeaders;
try {
  const csrfResponse = await fetch(new URL("/auth/csrf", apiBase), { headers: { origin } });
  assert.equal(csrfResponse.status, 200, "Fixture CSRF setup failed.");
  const csrf = await csrfResponse.json();
  const loginResponse = await fetch(new URL("/auth/login", apiBase), {
    method: "POST",
    headers: {
      origin,
      cookie: cookies(csrfResponse),
      "content-type": "application/json",
      "x-csrf-token": csrf.csrfToken,
    },
    body: JSON.stringify({
      email: account.email,
      password: account.password,
      clientType: "web",
      deviceName: "Phase 14 Microsoft Calendar acceptance",
    }),
  });
  assert.equal(loginResponse.status, 200, "Disposable fixture login failed.");
  sessionCookies = cookies(loginResponse);
  requestHeaders = {
    origin,
    cookie: sessionCookies,
    "content-type": "application/json",
    "x-csrf-token": csrfFrom(sessionCookies) ?? "",
  };

  const getIntegrations = async () => {
    const response = await fetch(
      new URL(`/integrations?productId=${encodeURIComponent(account.productId)}`, apiBase),
      { headers: requestHeaders },
    );
    assert.equal(response.status, 200, "Integration query failed.");
    return response.json();
  };
  const integrations = await getIntegrations();
  const calendarAccounts = integrations.accounts.filter(
    (item) =>
      item.provider === "MICROSOFT_CALENDAR" &&
      !item.displayName.startsWith("[TEST FIXTURE]") &&
      item.status !== "REVOKED",
  );
  assert.equal(
    calendarAccounts.length,
    1,
    "Expected one active non-fixture Microsoft Calendar connection.",
  );
  const integrationId = calendarAccounts[0].id;
  const tokenRows = await pool.query(
    `SELECT access_token_ciphertext, refresh_token_ciphertext, scopes, expires_at, refreshed_at
     FROM enough.integration_tokens WHERE integration_account_id = $1`,
    [integrationId],
  );
  assert.equal(tokenRows.rowCount, 1, "Expected a stored Microsoft Calendar token row.");
  const initialTokenRow = tokenRows.rows[0];
  assert.ok(initialTokenRow.access_token_ciphertext && initialTokenRow.refresh_token_ciphertext);
  const initialAccessToken = decryptIntegrationSecret(initialTokenRow.access_token_ciphertext);
  const accessBeforeSync = await graphRead(initialAccessToken);

  const eventCount = async () => {
    const result = await pool.query(
      `SELECT count(*)::int AS count
       FROM enough.integration_events WHERE integration_account_id = $1`,
      [integrationId],
    );
    return result.rows[0].count;
  };
  const matchingEvents = async () => {
    const result = await pool.query(
      `SELECT provider_event_id, event_type, occurred_at
       FROM enough.integration_events
       WHERE integration_account_id = $1 AND event_type = 'calendar.interview_completed'
       ORDER BY occurred_at DESC`,
      [integrationId],
    );
    return result.rows;
  };
  const countBeforeSync = await eventCount();
  const sync = async () => {
    const response = await fetch(new URL(`/integrations/${integrationId}/sync`, apiBase), {
      method: "POST",
      headers: requestHeaders,
      body: "{}",
    });
    const body = await response.json().catch(() => null);
    return {
      httpStatus: response.status,
      succeeded: response.ok,
      eventsReceived: Number.isInteger(body?.eventsReceived) ? body.eventsReceived : null,
    };
  };

  const firstSync = await sync();
  assert.equal(firstSync.httpStatus, 200, "Normal Microsoft Calendar sync failed.");
  const eventsAfterFirstSync = await matchingEvents();
  assert.equal(
    eventsAfterFirstSync.length,
    1,
    "Expected exactly one normalized completed interview event.",
  );
  const interview = eventsAfterFirstSync[0];
  const occurredAt = new Date(interview.occurred_at);
  assert.equal(interview.event_type, "calendar.interview_completed");
  assert.ok(
    occurredAt >= new Date("2026-10-14T00:00:00.000Z") &&
      occurredAt < new Date("2026-10-15T00:00:00.000Z"),
    "The normalized interview event did not occur on 2026-10-14.",
  );
  assert.ok(
    firstSync.eventsReceived >= 1,
    "The first sync did not ingest the existing calendar event.",
  );
  const countAfterFirstSync = await eventCount();
  assert.equal(countAfterFirstSync - countBeforeSync, firstSync.eventsReceived);

  const secondSync = await sync();
  assert.equal(secondSync.httpStatus, 200, "Immediate Calendar dedup sync failed.");
  assert.equal(
    secondSync.eventsReceived,
    0,
    "Immediate Calendar re-sync returned duplicate events.",
  );
  const countAfterSecondSync = await eventCount();
  assert.equal(
    countAfterSecondSync,
    countAfterFirstSync,
    "Immediate Calendar re-sync added persisted events.",
  );
  const interviewsAfterSecondSync = await matchingEvents();
  assert.equal(
    interviewsAfterSecondSync.length,
    1,
    "Calendar re-sync duplicated the completed interview event.",
  );

  const refreshedTokenRows = await pool.query(
    `SELECT access_token_ciphertext, refresh_token_ciphertext, scopes, expires_at, refreshed_at
     FROM enough.integration_tokens WHERE integration_account_id = $1`,
    [integrationId],
  );
  assert.equal(refreshedTokenRows.rowCount, 1, "Calendar token row disappeared before Disconnect.");
  const activeTokenRow = refreshedTokenRows.rows[0];
  const activeAccessToken = decryptIntegrationSecret(activeTokenRow.access_token_ciphertext);
  const currentGraphAccess = await graphRead(activeAccessToken);
  assert.equal(
    currentGraphAccess.httpStatus,
    200,
    "Current Microsoft access token was not valid before Disconnect.",
  );
  const refreshState = {
    accessTokenEncrypted: Boolean(activeTokenRow.access_token_ciphertext),
    refreshTokenEncrypted: Boolean(activeTokenRow.refresh_token_ciphertext),
    accessTokenDecrypts: Boolean(activeAccessToken),
    accessTokenChangedDuringSync: activeAccessToken !== initialAccessToken,
    refreshTokenDecrypts: Boolean(
      decryptIntegrationSecret(activeTokenRow.refresh_token_ciphertext),
    ),
    scopeIncludesCalendarsRead: activeTokenRow.scopes?.includes("Calendars.Read") ?? false,
    expiryInFuture: new Date(activeTokenRow.expires_at).getTime() > Date.now(),
    refreshedAt: activeTokenRow.refreshed_at,
    graphAccessHttpStatus: currentGraphAccess.httpStatus,
  };

  const disconnectResponse = await fetch(
    new URL(`/integrations/${integrationId}/revoke`, apiBase),
    {
      method: "POST",
      headers: requestHeaders,
      body: "{}",
    },
  );
  const disconnectBody = await disconnectResponse.json().catch(() => null);
  assert.equal(disconnectResponse.status, 200, "Normal Microsoft Calendar Disconnect failed.");
  const localState = await pool.query(
    `SELECT status FROM enough.integration_accounts WHERE id = $1`,
    [integrationId],
  );
  const tokenCount = await pool.query(
    `SELECT count(*)::int AS count FROM enough.integration_tokens WHERE integration_account_id = $1`,
    [integrationId],
  );
  assert.equal(
    localState.rows[0]?.status,
    "REVOKED",
    "Local integration did not enter REVOKED state.",
  );
  assert.equal(tokenCount.rows[0]?.count, 0, "Local Microsoft Calendar token row was not deleted.");
  const postDisconnectGraph = await graphRead(activeAccessToken);
  const postDisconnectSync = await sync();

  console.info(
    JSON.stringify({
      firstSync,
      accessTokenBeforeSync: accessBeforeSync,
      normalizedEvent: {
        eventType: interview.event_type,
        occurredAt: occurredAt.toISOString(),
        onExpectedDate: true,
      },
      secondSync,
      persistedEventCountBeforeSync: countBeforeSync,
      persistedEventCountAfterFirstSync: countAfterFirstSync,
      persistedEventCountAfterSecondSync: countAfterSecondSync,
      uniqueInterviewEventCountAfterSecondSync: interviewsAfterSecondSync.length,
      currentMicrosoftRefreshState: refreshState,
      disconnect: {
        httpStatus: disconnectResponse.status,
        localStatus: localState.rows[0].status,
        localTokenRows: tokenCount.rows[0].count,
        providerRevocation: disconnectBody?.providerRevocation ?? null,
      },
      previouslyValidAccessTokenAfterDisconnect: postDisconnectGraph,
      localSyncAfterDisconnect: {
        httpStatus: postDisconnectSync.httpStatus,
        succeeded: postDisconnectSync.succeeded,
        eventsReceived: postDisconnectSync.eventsReceived,
      },
    }),
  );

  await fetch(new URL("/auth/logout", apiBase), {
    method: "POST",
    headers: {
      origin,
      cookie: sessionCookies,
      "x-csrf-token": csrfFrom(sessionCookies) ?? "",
    },
  });
} finally {
  await pool.end();
}
