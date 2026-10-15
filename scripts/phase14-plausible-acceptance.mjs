import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  plausibleAcceptanceQuery,
  readPhase14PlausibleConfig,
} from "./phase14-plausible-config.mjs";

const allowedFlags = new Set([
  "--verify-provider-revocation",
  "--browser-probe",
  "--existing-events-only",
]);
if (
  process.argv.slice(2).some((flag) => !allowedFlags.has(flag)) ||
  (process.argv.includes("--browser-probe") &&
    (process.argv.includes("--verify-provider-revocation") ||
      process.argv.includes("--existing-events-only")))
) {
  throw new Error("Unsupported or conflicting Plausible acceptance modes.");
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const apiRequire = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { register } = await import(pathToFileURL(apiRequire.resolve("tsx/esm/api")).href);
register();
const fixture = join(tmpdir(), "enough-phase14");
const config = await readPhase14PlausibleConfig(join(fixture, "plausible.env"));
const probeMarkerPath = join(fixture, "plausible-probe-attempt.json");
function safeProbeHeaders(headers, browserCors = false) {
  const dropped = headers.get("x-plausible-dropped");
  return {
    droppedHeader:
      dropped === null ? null : /^[0-9]{1,6}$/.test(dropped) ? dropped : "nonstandard-value",
    droppedHeaderVisibility: browserCors ? "cors-exposed-only" : "complete",
    contentType:
      headers.get("content-type")?.split(";", 1)[0] === "text/plain"
        ? "text/plain"
        : headers.get("content-type")?.split(";", 1)[0] === "application/json"
          ? "application/json"
          : "other-or-absent",
  };
}
async function retainProbeResponse(source, metadata) {
  await appendFile(
    join(fixture, "plausible-probe-responses.jsonl"),
    `${JSON.stringify({ source, recordedAt: new Date().toISOString(), ...metadata })}\n`,
    { mode: 0o600 },
  );
}
async function priorProbeAttempt() {
  try {
    const marker = JSON.parse(await readFile(probeMarkerPath, "utf8"));
    return marker.siteId === config.siteId && marker.goalName === "phase14_acceptance_probe";
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw new Error("The local Plausible probe-attempt marker could not be verified.");
  }
}
async function recordProbeAttempt(source) {
  await writeFile(
    probeMarkerPath,
    JSON.stringify({
      siteId: config.siteId,
      goalName: "phase14_acceptance_probe",
      attemptedAt: new Date().toISOString(),
      source,
    }),
    { flag: "wx", mode: 0o600 },
  );
}
async function verifyAcceptanceGoal() {
  const url = new URL("https://plausible.io/api/v1/sites/goals");
  url.searchParams.set("site_id", config.siteId);
  for (let page = 0; page < 20; page += 1) {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${config.statsApiKey}`, accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(response.status, 200, "Plausible goal verification failed.");
    const body = await response.json().catch(() => null);
    assert.ok(Array.isArray(body?.goals), "Invalid Plausible goal listing.");
    const goal = body.goals.find((entry) => entry?.event_name === "phase14_acceptance_probe");
    if (goal) {
      assert.ok(
        goal.display_name === "phase14_acceptance_probe" &&
          Object.keys(goal.custom_props ?? {}).length === 0,
        "The acceptance goal display name or property filters do not match.",
      );
      return true;
    }
    if (typeof body.meta?.after !== "string" || !body.meta.after) break;
    url.searchParams.set("after", body.meta.after);
  }
  throw new Error("The dedicated Plausible acceptance goal was not found.");
}
const verifyProviderRevocation = process.argv.includes("--verify-provider-revocation");
console.info(
  JSON.stringify({
    plausibleConfig: {
      fileExists: config.fileExists,
      statsApiKeyPresent: config.statsApiKeyPresent,
      siteIdPresent: config.siteIdPresent,
    },
    mode: verifyProviderRevocation
      ? "verify-provider-revocation"
      : process.argv.includes("--browser-probe")
        ? "browser-probe"
        : "acceptance",
  }),
);
if (!config.statsApiKeyPresent || !config.siteIdPresent) {
  console.error(
    "Phase 14 Plausible requires the two local values in TEMP/enough-phase14/plausible.env; no credential value was read from chat.",
  );
  process.exitCode = 1;
} else if (process.argv.includes("--browser-probe")) {
  try {
    await verifyAcceptanceGoal();
    const response = await fetch("https://plausible.io/api/v2/query", {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.statsApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(plausibleAcceptanceQuery(config.siteId)),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(response.status, 200);
    const body = await response.json().catch(() => null);
    assert.ok(Array.isArray(body?.results));
    assert.ok(
      !body.results.some((row) => Number(row?.metrics?.[0]) > 0),
      "An existing probe must be reused without resubmission.",
    );
  } catch {
    throw new Error(
      "Browser probe preflight failed or an existing probe must be reused; no event was submitted.",
    );
  }
  if (await priorProbeAttempt())
    throw new Error(
      "A probe attempt is already recorded; inspect provider data before sending another event.",
    );
  const browserOrigin = "http://127.0.0.1:4428";
  let attempted = false;
  const payload = JSON.stringify({
    domain: config.siteId,
    name: "phase14_acceptance_probe",
    url: `https://${config.siteId}/phase14-acceptance`,
  }).replaceAll("<", "\\u003c");
  const page = `<!doctype html><html><head><meta charset="utf-8"><title>Phase 14 Plausible probe</title></head>
<body><h1>Phase 14 Plausible acceptance probe</h1><p>One public Events API request. No credential is sent to this page.</p>
<button id="send">Send one acceptance probe</button><p id="status">Ready</p>
<script>const safeProbeHeaders = ${safeProbeHeaders.toString()}; document.getElementById('send').onclick = async function () {
  this.disabled = true;
  const status = document.getElementById('status');
  status.textContent='Checking the one-request gate';
  let begin;
  try { begin = await fetch('/begin', {method:'POST'}); }
  catch { status.textContent='Local probe server unavailable. No event was sent by this click.'; return; }
  if (!begin.ok) { status.textContent='An attempt is already recorded.'; return; }
  status.textContent='Sending one probe';
  let metadata;
  try {
    const response = await fetch('https://plausible.io/api/event', {method:'POST', credentials:'omit', headers:{'content-type':'text/plain'}, body:JSON.stringify(${payload})});
    metadata = {httpStatus:response.status, ...safeProbeHeaders(response.headers, true)};
  } catch { metadata = {httpStatus:null, browserResponseReadable:false}; }
  status.textContent='Probe attempted; Stats API verification will determine ingestion.';
  await fetch('/result', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(metadata)});
};</script></body></html>`;
  const server = createServer(async (request, response) => {
    if (request.headers.host !== "127.0.0.1:4428") {
      response.writeHead(403).end();
      return;
    }
    if (request.method === "GET" && request.url === "/") {
      response
        .writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
        .end(page);
    } else if (
      request.method === "POST" &&
      request.url === "/begin" &&
      request.headers.origin === browserOrigin
    ) {
      if (attempted) {
        response.writeHead(409).end();
        return;
      }
      attempted = true;
      try {
        await recordProbeAttempt("browser");
        response.writeHead(200).end();
      } catch {
        response.writeHead(409).end();
      }
    } else if (
      request.method === "POST" &&
      request.url === "/result" &&
      request.headers.origin === browserOrigin
    ) {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 2048) {
          response.writeHead(413).end();
          return;
        }
      }
      try {
        const metadata = JSON.parse(body);
        const safeMetadata = {
          httpStatus: Number.isInteger(metadata.httpStatus) ? metadata.httpStatus : null,
          droppedHeader:
            metadata.droppedHeader === null
              ? null
              : /^[0-9]{1,6}$/.test(metadata.droppedHeader ?? "")
                ? metadata.droppedHeader
                : "unavailable-or-nonstandard",
          droppedHeaderVisibility: "cors-exposed-only",
          contentType: ["text/plain", "application/json"].includes(metadata.contentType)
            ? metadata.contentType
            : "other-or-absent",
          genuineBrowserUserAgent: true,
          forwardedClientIp: false,
        };
        await retainProbeResponse("browser", safeMetadata);
        console.info(
          JSON.stringify({
            browserProbe: {
              ...safeMetadata,
            },
            credentialValuesPrinted: false,
          }),
        );
        response.writeHead(200).end();
        server.close();
        clearTimeout(deadline);
      } catch {
        response.writeHead(400).end();
      }
    } else response.writeHead(404).end();
  });
  const deadline = setTimeout(() => {
    server.close();
    process.exitCode = 1;
  }, 1_800_000);
  server.listen(4428, "127.0.0.1");
  await once(server, "listening");
  console.info(
    JSON.stringify({ browserProbeReady: true, localUrl: browserOrigin, credentialInPage: false }),
  );
} else {
  const apiBase = "http://127.0.0.1:4426";
  const statsQueryUrl = "https://plausible.io/api/v2/query";
  const goalName = "phase14_acceptance_probe";
  const normalizedType = "analytics.user_signup";
  const displayName = "Phase 14 Plausible acceptance";
  const eventMap = { [goalName]: normalizedType };
  let ownedRuntime = null;
  let pool = null;
  let account = null;
  let apiUrl = null;
  let origin = null;
  let requestHeaders = null;
  let sessionCookies = "";
  let integrationId = null;
  let localDisconnected = false;
  let stage = "fixture_start";
  let eventSubmission = null;
  let providerRevocation = null;
  let directQueryStatusAfterDisconnect = null;
  let migrationLatest = null;
  let disconnectResult = null;
  let syncResult = null;
  let postDisconnectSyncStatus = null;
  const revocationAttemptStatuses = [];

  async function fixtureReady() {
    try {
      const response = await fetch(`${apiBase}/ready`, { signal: AbortSignal.timeout(1500) });
      if (!response.ok) return false;
      const body = await response.json().catch(() => null);
      return body?.service === "api" && body?.status === "ok";
    } catch {
      return false;
    }
  }

  async function startOrReuseFixture() {
    if (await fixtureReady()) return;
    ownedRuntime = spawn(
      process.execPath,
      [join(root, "scripts", "phase2-runtime.mjs"), "serve", "--phase14-plausible"],
      { cwd: root, windowsHide: true, stdio: "ignore" },
    );
    for (let attempt = 0; attempt < 240; attempt += 1) {
      if (ownedRuntime.exitCode !== null) {
        throw new Error("The isolated Phase 14 fixture exited before becoming ready.");
      }
      if (await fixtureReady()) return;
      await delay(500);
    }
    throw new Error("The isolated Phase 14 fixture did not become ready within two minutes.");
  }

  async function stopOwnedFixture() {
    if (!ownedRuntime || ownedRuntime.exitCode !== null) return;
    ownedRuntime.kill("SIGTERM");
    await Promise.race([once(ownedRuntime, "exit"), delay(15_000)]);
    if (ownedRuntime.exitCode === null) ownedRuntime.kill("SIGKILL");
    // Windows terminates Node on SIGTERM without running its JavaScript signal handler.
    // Stop only the dedicated services belonging to the fixture we started.
    for (const [command, args] of [
      ["wsl", ["-d", "Ubuntu", "--exec", "redis-cli", "-p", "56410", "shutdown"]],
      [process.execPath, [join(root, "scripts", "phase1-postgres.mjs"), "stop", "--phase14"]],
    ]) {
      try {
        execFileSync(command, args, { cwd: root, windowsHide: true, stdio: "ignore" });
      } catch {
        // A service may already have been stopped by the runtime's cleanup handler.
      }
    }
  }

  async function loadFixtureEnvironment() {
    const text = await readFile(join(fixture, "fixture.env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const separator = line.indexOf("=");
      if (separator > 0) process.env[line.slice(0, separator)] = line.slice(separator + 1);
    }
    account = JSON.parse(await readFile(join(fixture, "manual-account.json"), "utf8"));
    if (
      account.fixture !== true ||
      typeof account.productId !== "string" ||
      typeof account.email !== "string" ||
      typeof account.password !== "string" ||
      typeof account.webBaseUrl !== "string"
    ) {
      throw new Error("The isolated Phase 14 disposable account is missing or invalid.");
    }
    const webUrl = new URL(account.webBaseUrl);
    apiUrl = new URL(account.webBaseUrl);
    apiUrl.port = "4426";
    origin = webUrl.origin;
  }

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

  async function loginFixture() {
    const csrfResponse = await fetch(new URL("/auth/csrf", apiUrl), {
      headers: { origin },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(csrfResponse.status, 200, "Fixture CSRF setup failed.");
    const csrf = await csrfResponse.json();
    const loginResponse = await fetch(new URL("/auth/login", apiUrl), {
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
        deviceName: "Phase 14 Plausible acceptance",
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
  }

  async function statsQuery() {
    const response = await fetch(statsQueryUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.statsApiKey}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(plausibleAcceptanceQuery(config.siteId)),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    const status = response.status;
    if (status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      return { status, results: null };
    }
    const body = await response.json().catch(() => null);
    if (!Array.isArray(body?.results)) {
      throw new Error("Plausible Stats API returned an invalid response shape.");
    }
    return { status, results: body.results };
  }

  async function verifySiteIdentity() {
    const response = await fetch("https://plausible.io/api/v1/sites", {
      headers: {
        authorization: `Bearer ${config.statsApiKey}`,
        accept: "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    const status = response.status;
    if (status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      return { status, matched: false };
    }
    const body = await response.json().catch(() => null);
    if (!Array.isArray(body?.sites)) {
      throw new Error("Plausible site identity response was invalid.");
    }
    return {
      status,
      matched: body.sites.some((site) => site?.domain === config.siteId),
    };
  }

  function positiveDailyRows(results) {
    return results
      .map((row) => ({
        day: row?.dimensions?.[0],
        count: Number(row?.metrics?.[0]),
      }))
      .filter(
        (row) =>
          typeof row.day === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(row.day) &&
          Number.isFinite(Date.parse(`${row.day}T00:00:00.000Z`)) &&
          new Date(`${row.day}T00:00:00.000Z`).toISOString().slice(0, 10) === row.day &&
          Number.isFinite(row.count) &&
          row.count > 0,
      );
  }

  async function enoughRequest(method, path, body = {}) {
    const response = await fetch(new URL(path, apiUrl), {
      method,
      headers: requestHeaders,
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    const result = await response.json().catch(() => null);
    return { response, result };
  }

  async function getIntegrations() {
    const response = await fetch(
      new URL(`/integrations?productId=${encodeURIComponent(account.productId)}`, apiUrl),
      { headers: requestHeaders, redirect: "error", signal: AbortSignal.timeout(15_000) },
    );
    const body = await response.json().catch(() => null);
    assert.equal(response.status, 200, "Enough integration catalog request failed.");
    return body;
  }

  async function disconnectLocal() {
    if (!integrationId || localDisconnected || !requestHeaders) return null;
    const { response, result } = await enoughRequest(
      "POST",
      `/integrations/${integrationId}/revoke`,
    );
    assert.equal(response.status, 200, "Enough local Disconnect failed.");
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
    localDisconnected = true;
    disconnectResult = {
      httpStatus: response.status,
      localStatus: localState.rows[0].status,
      localCredentialRows: tokenRows.rows[0].count,
      providerRevocation: result?.providerRevocation ?? null,
    };
    return disconnectResult;
  }

  async function localRevocationChecks() {
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
    const { response } = await enoughRequest("POST", `/integrations/${integrationId}/sync`);
    postDisconnectSyncStatus = response.status;
    assert.equal(postDisconnectSyncStatus, 409);
    return {
      localStatus: localState.rows[0].status,
      localCredentialRows: tokenRows.rows[0].count,
      postDisconnectSyncHttpStatus: postDisconnectSyncStatus,
    };
  }

  async function findRevokedAccount() {
    const catalog = await getIntegrations();
    const entry = catalog.accounts.find(
      (item) =>
        item.provider === "PLAUSIBLE" &&
        item.displayName === displayName &&
        item.status === "REVOKED",
    );
    assert.ok(
      typeof entry?.id === "string",
      "No locally revoked Plausible acceptance connection exists.",
    );
    integrationId = entry.id;
    return localRevocationChecks();
  }

  try {
    stage = "fixture_start";
    await startOrReuseFixture();
    await loadFixtureEnvironment();
    execFileSync(process.execPath, ["--import", "tsx", "src/migration-precheck.ts"], {
      cwd: join(root, "packages", "db"),
      env: process.env,
      windowsHide: true,
      stdio: "ignore",
    });
    const { pool: fixturePool } = await import("../packages/db/src/index.ts");
    pool = fixturePool;
    const migrationState = await pool.query(
      "SELECT max(id) AS latest FROM enough.schema_migrations",
    );
    migrationLatest = migrationState.rows[0]?.latest ?? null;
    assert.equal(
      migrationLatest,
      "0020_provider_integrations.sql",
      "The Phase 14 fixture is not migrated through 0020.",
    );
    await loginFixture();

    if (verifyProviderRevocation) {
      stage = "local_disconnect_verification";
      const local = await findRevokedAccount();
      stage = "provider_revocation_verification";
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const query = await statsQuery();
        revocationAttemptStatuses.push(query.status);
        if ([401, 403].includes(query.status)) break;
        if (![200, 429, 500, 502, 503, 504].includes(query.status)) break;
        if (attempt < 4) await delay(2000);
      }
      providerRevocation = {
        status: [401, 403].includes(revocationAttemptStatuses.at(-1)) ? "PASS" : "BLOCKED",
        httpStatuses: revocationAttemptStatuses,
        apiHost: "plausible.io",
        regionSelectionRequired: false,
        publicRevocationApi: false,
      };
      console.info(
        JSON.stringify({
          localDisconnect: local,
          fixture: { migrationPrecheckPassed: true, latestMigration: migrationLatest },
          providerRevocation,
          credentialValuesPrinted: false,
        }),
      );
      if (providerRevocation.status !== "PASS") process.exitCode = 1;
    } else {
      stage = "stats_api_preflight";
      const siteIdentity = await verifySiteIdentity();
      assert.equal(siteIdentity.status, 200, "Plausible Stats API could not list team sites.");
      assert.equal(
        siteIdentity.matched,
        true,
        "The configured site is not owned by this Stats API key's team.",
      );
      const preflight = await statsQuery();
      assert.equal(preflight.status, 200, "Plausible private Stats API authentication failed.");
      stage = "goal_verification";
      await verifyAcceptanceGoal();
      const existingProbeRows = positiveDailyRows(preflight.results);
      if (process.argv.includes("--existing-events-only")) {
        assert.ok(
          existingProbeRows.length > 0,
          "No existing probe was found; no new event is permitted.",
        );
      }
      assert.ok(
        existingProbeRows.length <= 1,
        "The dedicated acceptance goal already has multiple reporting days in its seven-day window.",
      );

      if (existingProbeRows.length === 0 && !(await priorProbeAttempt())) {
        stage = "events_api_probe";
        await recordProbeAttempt("node");
        const response = await fetch("https://plausible.io/api/event", {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "user-agent": "Enough-Phase14-Acceptance/1.0",
          },
          body: JSON.stringify({
            domain: config.siteId,
            name: goalName,
            url: `https://${config.siteId}/phase14-acceptance`,
          }),
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        });
        const droppedHeader = response.headers.get("x-plausible-dropped");
        eventSubmission = {
          httpStatus: response.status,
          ...safeProbeHeaders(response.headers),
          userAgentProvided: true,
          forwardedClientIp: false,
        };
        await retainProbeResponse("server", eventSubmission);
        await response.body?.cancel().catch(() => undefined);
        assert.equal(
          response.status,
          202,
          "Plausible Events API did not accept the probe request.",
        );
        assert.notEqual(
          droppedHeader,
          "1",
          "Plausible reported that the acceptance event was dropped; HTTP 202 is not ingestion evidence.",
        );
      } else {
        eventSubmission = {
          httpStatus: null,
          droppedHeader: "not-applicable-existing-probe-or-recorded-attempt",
          userAgentProvided: false,
          forwardedClientIp: false,
        };
      }

      stage = "events_api_ingestion_poll";
      let acceptedDailyRows = existingProbeRows;
      const pollStatuses = [];
      for (let attempt = 0; attempt < 10 && acceptedDailyRows.length === 0; attempt += 1) {
        if (attempt > 0) await delay(5000);
        const query = await statsQuery();
        pollStatuses.push(query.status);
        if (query.status === 200) acceptedDailyRows = positiveDailyRows(query.results);
        else if (![429, 500, 502, 503, 504].includes(query.status)) {
          throw new Error("Plausible rejected the Stats API query while polling for ingestion.");
        }
      }
      assert.equal(
        acceptedDailyRows.length,
        1,
        "Plausible did not return exactly one positive daily goal bucket after bounded polling.",
      );

      stage = "provider_adapter_normalization";
      const { integrationProviderAdapter } = await import(
        "../apps/api/src/integration-provider-adapters.ts"
      );
      const plausibleAdapter = integrationProviderAdapter("PLAUSIBLE");
      assert.ok(plausibleAdapter);
      const adapterEvents = await plausibleAdapter({
        provider: "PLAUSIBLE",
        accessToken: config.statsApiKey,
        configuration: { siteId: config.siteId, eventMap },
      });
      assert.equal(adapterEvents.length, 1);
      assert.equal(adapterEvents[0].eventType, normalizedType);
      assert.equal(adapterEvents[0].occurredAt, `${acceptedDailyRows[0].day}T00:00:00.000Z`);
      assert.equal(adapterEvents[0].providerOriginVerified, true);
      assert.equal(adapterEvents[0].automaticVerificationEligible, false);

      stage = "live_catalog";
      const catalog = await getIntegrations();
      const plausibleEntry = catalog.catalog.find((item) => item.provider === "PLAUSIBLE");
      assert.equal(
        plausibleEntry?.available,
        true,
        "Plausible API-token catalog entry is unavailable.",
      );
      const activeAccounts = catalog.accounts.filter(
        (item) =>
          item.provider === "PLAUSIBLE" &&
          item.status === "ACTIVE" &&
          item.displayName === displayName,
      );
      assert.ok(
        activeAccounts.length <= 1,
        "More than one active Plausible acceptance connection exists.",
      );

      stage = "enough_connection";
      if (activeAccounts.length === 1) {
        integrationId = activeAccounts[0].id;
        const storedConfig = await pool.query(
          "SELECT configuration FROM enough.integration_provider_configs WHERE integration_account_id = $1",
          [integrationId],
        );
        const storedToken = await pool.query(
          "SELECT access_token_ciphertext FROM enough.integration_tokens WHERE integration_account_id = $1",
          [integrationId],
        );
        const saved = storedConfig.rows[0]?.configuration;
        const { decryptIntegrationSecret } = await import("../packages/auth/src/index.ts");
        assert.ok(
          saved?.siteId === config.siteId &&
            JSON.stringify(saved?.eventMap) === JSON.stringify(eventMap) &&
            storedToken.rowCount === 1 &&
            decryptIntegrationSecret(storedToken.rows[0].access_token_ciphertext) ===
              config.statsApiKey,
          "The existing Plausible connection does not match the local acceptance settings.",
        );
      } else {
        const { response, result } = await enoughRequest("POST", "/integrations/credentials", {
          productId: account.productId,
          provider: "PLAUSIBLE",
          displayName,
          apiToken: config.statsApiKey,
          siteId: config.siteId,
          eventMap,
        });
        assert.equal(
          response.status,
          201,
          "Enough Plausible credential route rejected the connection.",
        );
        assert.equal(result?.status, "ACTIVE");
        assert.ok(typeof result?.integrationId === "string");
        integrationId = result.integrationId;
      }

      const { decryptIntegrationSecret } = await import("../packages/auth/src/index.ts");
      const encryptedToken = await pool.query(
        "SELECT access_token_ciphertext FROM enough.integration_tokens WHERE integration_account_id = $1",
        [integrationId],
      );
      assert.equal(encryptedToken.rowCount, 1);
      assert.notEqual(
        encryptedToken.rows[0].access_token_ciphertext.toString(),
        config.statsApiKey,
      );
      assert.equal(
        decryptIntegrationSecret(encryptedToken.rows[0].access_token_ciphertext),
        config.statsApiKey,
      );

      stage = "enough_sync";
      const first = await enoughRequest("POST", `/integrations/${integrationId}/sync`);
      assert.equal(first.response.status, 200, "Enough Plausible sync failed.");
      assert.ok(Number.isInteger(first.result?.eventsReceived));
      const persisted = await pool.query(
        `SELECT event_type, occurred_at, provider_origin_verified
         FROM enough.integration_events WHERE integration_account_id = $1
         ORDER BY received_at ASC`,
        [integrationId],
      );
      assert.equal(persisted.rowCount, 1, "Expected one persisted Plausible normalized event row.");
      assert.equal(persisted.rows[0].event_type, normalizedType);
      assert.equal(persisted.rows[0].provider_origin_verified, true);
      assert.equal(
        persisted.rows[0].occurred_at.toISOString(),
        `${acceptedDailyRows[0].day}T00:00:00.000Z`,
      );
      syncResult = {
        normalizedEventType: persisted.rows[0].event_type,
        providerEventRows: persisted.rowCount,
        providerOriginVerified: persisted.rows[0].provider_origin_verified,
        automaticVerificationEligible: false,
        utcDayMarker: persisted.rows[0].occurred_at.toISOString(),
      };

      stage = "immediate_resync";
      const second = await enoughRequest("POST", `/integrations/${integrationId}/sync`);
      assert.equal(second.response.status, 200, "Immediate Enough Plausible resync failed.");
      assert.equal(
        second.result?.eventsReceived,
        0,
        "Immediate Plausible resync returned a duplicate.",
      );
      const countAfterResync = await pool.query(
        "SELECT count(*)::int AS count FROM enough.integration_events WHERE integration_account_id = $1",
        [integrationId],
      );
      assert.equal(countAfterResync.rows[0]?.count, 1);

      stage = "disconnect";
      await disconnectLocal();
      const providerAfterDisconnect = await statsQuery();
      directQueryStatusAfterDisconnect = providerAfterDisconnect.status;
      assert.equal(
        directQueryStatusAfterDisconnect,
        200,
        "Local Disconnect unexpectedly changed Plausible provider key state.",
      );
      stage = "post_disconnect_sync";
      const local = await localRevocationChecks();
      providerRevocation = {
        status: "MANUAL_REQUIRED",
        apiRevocationAvailable: false,
        preUiDeletionQueryHttpStatus: directQueryStatusAfterDisconnect,
        apiHost: "plausible.io",
        nextStep:
          "Delete only the dedicated Stats API key in the owning team's API Keys settings, then run --verify-provider-revocation.",
      };

      console.info(
        JSON.stringify({
          plausibleApi: {
            statsApiHttpStatus: preflight.status,
            siteIdentityHttpStatus: siteIdentity.status,
            siteIdMatched: siteIdentity.matched,
            goalVerified: true,
            eventQueryHttpStatuses: pollStatuses,
            eventRetrieved: true,
            reportingDayBuckets: 1,
            paginationRequired: false,
            eventsApi: eventSubmission,
          },
          sync: {
            ...syncResult,
            firstNewEvents: first.result.eventsReceived,
            secondNewEvents: second.result.eventsReceived,
            rowsAfterResync: countAfterResync.rows[0].count,
          },
          credential: { encryptedAtRest: true },
          fixture: { migrationPrecheckPassed: true, latestMigration: migrationLatest },
          disconnect: disconnectResult,
          localPostDisconnect: local,
          providerRevocation,
          credentialValuesPrinted: false,
        }),
      );
    }
  } catch {
    if (integrationId && !localDisconnected) {
      try {
        await disconnectLocal();
      } catch {
        // Keep provider and credential diagnostics out of acceptance output.
      }
    }
    console.error(
      JSON.stringify({
        phase14PlausibleAcceptance: "FAILED",
        stage,
        eventSubmission,
        credentialValuesPrinted: false,
      }),
    );
    process.exitCode = 1;
  } finally {
    try {
      if (requestHeaders && sessionCookies) {
        await fetch(new URL("/auth/logout", apiUrl), {
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
    await pool?.end().catch(() => undefined);
    await stopOwnedFixture();
  }
}
