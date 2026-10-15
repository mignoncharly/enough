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

try {
  const csrfResponse = await fetch(new URL("/auth/csrf", apiBase), { headers: { origin } });
  if (!csrfResponse.ok) throw new Error(`CSRF setup failed with HTTP ${csrfResponse.status}.`);
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
      deviceName: "Phase 14 Outlook reply acceptance",
    }),
  });
  if (!loginResponse.ok)
    throw new Error(`Disposable fixture login failed with HTTP ${loginResponse.status}.`);

  const sessionCookies = cookies(loginResponse);
  const requestHeaders = {
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
    if (!response.ok) throw new Error(`Integration query failed with HTTP ${response.status}.`);
    return response.json();
  };
  const integrations = await getIntegrations();
  const outlookAccounts = integrations.accounts.filter(
    (item) => item.provider === "OUTLOOK" && !item.displayName.startsWith("[TEST FIXTURE]"),
  );
  const activeOutlookAccounts = outlookAccounts.filter((item) => item.status !== "REVOKED");
  if (activeOutlookAccounts.length !== 1)
    throw new Error(
      `Expected one active non-fixture Outlook connection; observed ${activeOutlookAccounts.length}.`,
    );
  const integrationId = activeOutlookAccounts[0].id;
  const replyCount = async () => {
    const result = await pool.query(
      `SELECT count(*)::int AS count
       FROM enough.integration_events
       WHERE integration_account_id = $1 AND event_type = 'email.reply_received'`,
      [integrationId],
    );
    return result.rows[0].count;
  };
  const replyCountBefore = await replyCount();
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
  const immediateDedupSync = firstSync.succeeded ? await sync() : null;
  const replyCountAfter = await replyCount();
  const recentSyncRuns = await pool.query(
    `SELECT status, error_code, events_received
     FROM enough.integration_sync_runs
     WHERE integration_account_id = $1
     ORDER BY started_at DESC
     LIMIT 3`,
    [integrationId],
  );
  const persistedEventTypes = await pool.query(
    `SELECT event_type, count(*)::int AS count
     FROM enough.integration_events
     WHERE integration_account_id = $1
     GROUP BY event_type`,
    [integrationId],
  );
  console.info(
    JSON.stringify({
      activeNonFixtureOutlookConnections: activeOutlookAccounts.length,
      firstSync,
      immediateDedupSync,
      immediateDedupPassed:
        immediateDedupSync === null
          ? null
          : immediateDedupSync.succeeded && immediateDedupSync.eventsReceived === 0,
      replyEventsBefore: replyCountBefore,
      replyEventsAfter: replyCountAfter,
      replyEventsAdded: replyCountAfter - replyCountBefore,
      replyReceivedPresent: replyCountAfter > 0,
      persistedEventCounts: Object.fromEntries(
        persistedEventTypes.rows.map((row) => [row.event_type, row.count]),
      ),
      recentSyncRuns: recentSyncRuns.rows,
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
