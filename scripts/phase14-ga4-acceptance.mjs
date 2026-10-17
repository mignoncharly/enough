import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { GA4_PROBE_NAME, ga4ReportRequest, readPhase14Ga4Config } from "./phase14-ga4-config.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url))),
  dir = join(tmpdir(), "enough-phase14"),
  name = GA4_PROBE_NAME,
  markerPath = join(dir, "ga4-clean-mp-attempt.json"),
  statusFile = join(dir, "ga4-clean-standard-status.json");
if (process.argv.length !== 3 || process.argv[2] !== "--resume-only") {
  console.info(
    "Use --resume-only to check the existing clean probe. This command never emits events or starts OAuth.",
  );
  process.exit(1);
}
let pool,
  stage = "config",
  headers,
  base = "http://127.0.0.1:4426",
  s = {
    standard: "WAITING",
    normalization: "NOT_RUN",
    dedup: "NOT_RUN",
    disconnect: "NOT_RUN",
    providerRevocation: "NOT_RUN",
    combinedGate: "BLOCKED",
    eventSent: false,
    browserSeedSent: false,
    newAttemptMarkerCreated: false,
  };
const save = async (extra) => {
  s = { ...s, ...extra, stage };
  await writeFile(statusFile, JSON.stringify(s));
};
const request = (u, o = {}) =>
  fetch(u, { ...o, redirect: "error", signal: AbortSignal.timeout(20000) });
async function enough(method, path, body) {
  const r = await request(base + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
try {
  assert.deepEqual(
    process.argv.slice(2),
    ["--resume-only"],
    "Use --resume-only after explicitly authorizing a clean acceptance resume.",
  );
  const config = await readPhase14Ga4Config(join(dir, "ga4-clean.env"));
  assert.equal(config.fileExists, true);
  const c = { GA4_PROPERTY_ID: config.propertyId };
  const markerBytes = await readFile(markerPath);
  assert.equal(JSON.parse(markerBytes).eventName, name);
  const prior = JSON.parse(await readFile(join(dir, "ga4-clean-mp-status.json"), "utf8"));
  assert.equal(prior.realtime, "PASS");
  assert.equal(prior.markerCreated, true);
  Object.assign(process.env, parseEnv(await readFile(join(dir, "fixture.env"), "utf8")));
  const requireApi = createRequire(join(root, "apps/api/package.json"));
  const { register } = await import(pathToFileURL(requireApi.resolve("tsx/esm/api")).href);
  register();
  ({ pool } = await import(pathToFileURL(join(root, "packages/db/src/index.ts")).href));
  const { decryptIntegrationSecret: decrypt, encryptIntegrationSecret: encrypt } = await import(
    pathToFileURL(join(root, "packages/auth/src/index.ts")).href
  );
  const account = JSON.parse(await readFile(join(dir, "manual-account.json"), "utf8"));
  stage = "saved_connection";
  const found = await pool.query(
    "SELECT a.id,a.user_id,a.status,t.access_token_ciphertext,t.refresh_token_ciphertext,t.expires_at,t.scopes,c.configuration FROM enough.integration_accounts a JOIN enough.integration_tokens t ON t.integration_account_id=a.id JOIN enough.integration_provider_configs c ON c.integration_account_id=a.id WHERE a.product_id=$1 AND a.provider='GA4' AND a.status='ACTIVE' AND a.display_name='Phase 14 GA4 acceptance' AND c.configuration->>'propertyId'=$2",
    [account.productId, c.GA4_PROPERTY_ID],
  );
  assert.equal(found.rowCount, 1);
  const row = found.rows[0],
    id = row.id;
  assert.ok(row.scopes.includes("https://www.googleapis.com/auth/analytics.readonly"));
  let token = decrypt(row.access_token_ciphertext);
  if (new Date(row.expires_at).getTime() < Date.now() + 300000) {
    const { readPhase14GoogleIntegrationConfig } = await import(
      pathToFileURL(join(root, "scripts/phase14-google-config.mjs")).href
    );
    const { refreshProviderAccessToken } = await import(
      pathToFileURL(join(root, "apps/api/src/integration-oauth.ts")).href
    );
    const g = await readPhase14GoogleIntegrationConfig(join(dir, "google-oauth.env"));
    const refresh = decrypt(row.refresh_token_ciphertext);
    const t = await refreshProviderAccessToken({
      provider: "GA4",
      runtime: { google: { clientId: g.clientId, clientSecret: g.clientSecret } },
      refreshToken: refresh,
      scopes: row.scopes,
    });
    token = t.accessToken;
    await pool.query(
      "UPDATE enough.integration_tokens SET access_token_ciphertext=$2,refresh_token_ciphertext=$3,expires_at=$4,scopes=$5,refreshed_at=now(),updated_at=now() WHERE integration_account_id=$1",
      [id, encrypt(token), encrypt(t.refreshToken ?? refresh), t.expiresAt, t.scopes],
    );
  }
  async function report(access = token) {
    const r = await request(
      `https://analyticsdata.googleapis.com/v1beta/properties/${c.GA4_PROPERTY_ID}:runReport`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
        body: JSON.stringify(ga4ReportRequest()),
      },
    );
    const b = await r.json().catch(() => null);
    if (r.status !== 200) return { status: r.status, count: null };
    assert.ok(
      b &&
        Array.isArray(b.dimensionHeaders) &&
        Array.isArray(b.metricHeaders) &&
        (!b.rows || Array.isArray(b.rows)),
    );
    const index = b.dimensionHeaders.findIndex((h) => h.name === "eventName");
    assert.ok(index >= 0);
    assert.ok((b.rows ?? []).every((r) => r.dimensionValues?.[index]?.value === name));
    const count = (b.rows ?? []).reduce((n, r) => n + Number(r.metricValues?.[0]?.value ?? NaN), 0);
    assert.ok(Number.isSafeInteger(count) && count >= 0);
    return { status: 200, count };
  }
  stage = "standard_polling";
  const standardReport = await report();
  await save({
    standardHttpStatus: standardReport.status,
    standardCount: standardReport.count,
    pollsCompleted: 1,
    lastPollAt: new Date().toISOString(),
    standard:
      standardReport.status !== 200 ? "BLOCKED" : standardReport.count > 0 ? "PASS" : "WAITING",
  });
  if (s.standard === "PASS") {
    stage = "acceptance_mapping";
    const map = { [name]: "analytics.user_signup" };
    const existing = await pool.query(
      "SELECT count(*)::int AS count FROM enough.integration_events WHERE integration_account_id=$1",
      [id],
    );
    const mappingAlreadyCorrect =
      JSON.stringify(row.configuration.eventMap) === JSON.stringify(map);
    assert.ok(existing.rows[0].count === 0 || mappingAlreadyCorrect);
    await pool.query(
      "UPDATE enough.integration_provider_configs SET configuration=jsonb_set(configuration,'{eventMap}',$2::jsonb),updated_at=now() WHERE integration_account_id=$1",
      [id, JSON.stringify(map)],
    );
    const { integrationProviderAdapter } = await import(
      pathToFileURL(join(root, "apps/api/src/integration-provider-adapters.ts")).href
    );
    const normalized = await integrationProviderAdapter("GA4")({
      provider: "GA4",
      accessToken: token,
      configuration: { propertyId: c.GA4_PROPERTY_ID, eventMap: map },
    });
    assert.equal(normalized.length, 1);
    assert.equal(normalized[0].eventType, "analytics.user_signup");
    assert.equal(normalized[0].providerOriginVerified, true);
    assert.equal(normalized[0].automaticVerificationEligible, false);
    stage = "fixture_login";
    const origin = "http://127.0.0.1:3315",
      cookieString = (r) =>
        r.headers
          .getSetCookie()
          .map((v) => v.split(";", 1)[0])
          .join("; ");
    const csrf = await request(`${base}/auth/csrf`, { headers: { origin } }),
      csrfBody = await csrf.json();
    const login = await request(`${base}/auth/login`, {
      method: "POST",
      headers: {
        origin,
        cookie: cookieString(csrf),
        "content-type": "application/json",
        "x-csrf-token": csrfBody.csrfToken,
      },
      body: JSON.stringify({
        email: account.email,
        password: account.password,
        clientType: "web",
        deviceName: "Phase 14 GA4 clean verification",
      }),
    });
    assert.equal(login.status, 200);
    const cookies = cookieString(login);
    headers = {
      origin,
      cookie: cookies,
      "content-type": "application/json",
      "x-csrf-token": cookies
        .split("; ")
        .find((x) => x.startsWith("enough_csrf="))
        ?.slice(12),
    };
    stage = "normalization";
    const first = await enough("POST", `/integrations/${id}/sync`, {});
    assert.equal(first.status, 200);
    const events = await pool.query(
      "SELECT event_type,occurred_at,provider_origin_verified,evidence_id,completion_id FROM enough.integration_events WHERE integration_account_id=$1",
      [id],
    );
    assert.equal(events.rowCount, 1);
    assert.equal(events.rows[0].event_type, "analytics.user_signup");
    assert.equal(events.rows[0].occurred_at.toISOString(), normalized[0].occurredAt);
    assert.equal(events.rows[0].provider_origin_verified, true);
    assert.equal(events.rows[0].evidence_id, null);
    assert.equal(events.rows[0].completion_id, null);
    await save({
      normalization: "PASS",
      persistedRows: 1,
      providerOriginVerified: true,
      automaticVerificationEligible: false,
      firstNewEvents: first.body.eventsReceived,
    });
    stage = "dedup";
    const second = await enough("POST", `/integrations/${id}/sync`, {});
    assert.equal(second.status, 200);
    assert.equal(second.body.eventsReceived, 0);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM enough.integration_events WHERE integration_account_id=$1",
          [id],
        )
      ).rows[0].count,
      1,
    );
    await save({ dedup: "PASS", secondNewEvents: 0 });
    stage = "encrypted_tokens";
    const saved = await pool.query(
      "SELECT access_token_ciphertext,refresh_token_ciphertext FROM enough.integration_tokens WHERE integration_account_id=$1",
      [id],
    );
    assert.equal(saved.rowCount, 1);
    token = decrypt(saved.rows[0].access_token_ciphertext);
    assert.ok(token && decrypt(saved.rows[0].refresh_token_ciphertext));
    assert.notEqual(saved.rows[0].access_token_ciphertext.toString(), token);
    await save({ encryptedTokens: "PASS" });
    stage = "google_grant_safety";
    const conflicts = await pool.query(
      "SELECT a.provider,count(*)::int AS count FROM enough.integration_accounts a JOIN enough.integration_provider_configs c ON c.integration_account_id=a.id JOIN enough.integration_tokens t ON t.integration_account_id=a.id WHERE a.provider IN ('GMAIL','GOOGLE_CALENDAR','GA4') AND a.status<>'REVOKED' AND a.id<>$1 AND c.provider_account_hash=(SELECT provider_account_hash FROM enough.integration_provider_configs WHERE integration_account_id=$1) GROUP BY a.provider",
      [id],
    );
    if (conflicts.rowCount) {
      await save({
        providerRevocation: "BLOCKED",
        disconnect: "BLOCKED_BY_SHARED_GRANT",
        conflicts: conflicts.rows.map((r) => ({ provider: r.provider, count: r.count })),
      });
    } else {
      const pre = await report(token);
      assert.equal(pre.status, 200);
      await save({ revocationSafety: "PASS", preRevocationHttpStatus: pre.status });
      stage = "disconnect";
      const disconnected = await enough("POST", `/integrations/${id}/revoke`, {});
      assert.equal(disconnected.status, 200);
      const local = (
        await pool.query("SELECT status FROM enough.integration_accounts WHERE id=$1", [id])
      ).rows[0].status;
      const tokenRows = (
        await pool.query(
          "SELECT 1 FROM enough.integration_tokens WHERE integration_account_id=$1",
          [id],
        )
      ).rowCount;
      const after = await enough("POST", `/integrations/${id}/sync`, {});
      assert.equal(local, "REVOKED");
      assert.equal(tokenRows, 0);
      assert.equal(after.status, 409);
      await save({
        disconnect: "PASS",
        disconnectHttpStatus: 200,
        localStatus: local,
        localTokenRows: tokenRows,
        postDisconnectSyncHttpStatus: after.status,
      });
      const audit = await pool.query(
        "SELECT metadata FROM enough.auth_audit_events WHERE event_type='integration.provider_revocation_result' AND metadata->>'integrationId'=$1 ORDER BY created_at DESC LIMIT 1",
        [id],
      );
      const officialStatus = audit.rows[0]?.metadata?.httpStatus ?? null;
      await save({
        officialGoogleRevokeHttpStatus: officialStatus,
        providerRevocationResult: disconnected.body.providerRevocation,
      });
      stage = "post_revocation";
      const statuses = [];
      for (let i = 0; i < 5; i++) {
        const probe = await report(token);
        statuses.push(probe.status);
        if (probe.status === 401) break;
        if (i < 4) await delay(2000);
      }
      const passed =
        officialStatus === 200 &&
        disconnected.body.providerRevocation === "REVOKED" &&
        statuses.at(-1) === 401;
      await save({
        sameAccessTokenHttpStatuses: statuses,
        providerRevocation: passed ? "PASS" : "BLOCKED",
        combinedGate: passed ? "PASS" : "BLOCKED",
      });
    }
  }
  assert.ok(markerBytes.equals(await readFile(markerPath)));
  stage = "stopped";
  await save({ markerPreserved: true, resumable: s.standard === "WAITING" });
  console.log(JSON.stringify(s));
} catch {
  await save({ safeFailureStage: stage });
  console.log(JSON.stringify(s));
  process.exitCode = 1;
} finally {
  if (headers)
    try {
      await enough("POST", "/auth/logout", {});
    } catch {}
  await pool?.end();
}
