import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixture = join(tmpdir(), "enough-phase10");
assert.equal(process.env.ENOUGH_PHASE10_MANUAL_ACCOUNT, "1");
const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.deepEqual(
  [target.hostname, target.port, target.pathname, target.username],
  ["127.0.0.1", "55441", "/enough_phase10", "enough_phase10"],
);
assert.equal(process.env.API_BASE_URL, "http://127.0.0.1:4418");
assert.equal(process.env.APP_BASE_URL, "http://127.0.0.1:3310");
assert.equal(process.env.REDIS_URL, "redis://127.0.0.1:56401/0");
assert.ok(process.env.AUTH_ALLOWED_ORIGINS?.includes("chrome-extension://"));
assert.ok(process.env.AUTH_ALLOWED_ORIGINS?.includes("moz-extension://"));

const accountFile = join(fixture, "manual-account.json");

async function request(path, session, method, body, expectedStatus) {
  const headers = {
    cookie: `enough_session=${session.token}; enough_csrf=${session.csrfToken}`,
    "x-csrf-token": session.csrfToken,
    origin: process.env.APP_BASE_URL,
    ...(body === undefined ? {} : { "content-type": "application/json" }),
  };
  const response = await fetch(`${process.env.API_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(
    response.status,
    expectedStatus,
    `Phase 10 fixture setup failed at ${path} (${response.status}).`,
  );
  if (expectedStatus === 204) return null;
  return response.json();
}

if (existsSync(accountFile)) {
  const existing = JSON.parse(readFileSync(accountFile, "utf8"));
  assert.equal(existing.fixture, "enough-phase10");
  assert.equal(existing.apiBaseUrl, process.env.API_BASE_URL);
  for (const headers of [
    { authorization: `Bearer ${existing.chromeExtensionToken}` },
    { authorization: `Bearer ${existing.firefoxExtensionToken}` },
    {
      cookie: `enough_session=${existing.revocationControlToken}; enough_csrf=${existing.revocationControlCsrf}`,
    },
  ]) {
    const response = await fetch(`${existing.apiBaseUrl}/auth/me`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(
      response.status,
      200,
      "Existing Phase 10 account token is inactive; preserve the fixture for inspection.",
    );
  }
  console.info("Reused the existing disposable Phase 10 account; stored values were not printed.");
} else {
  const { pool } = await import("../packages/db/src/index.ts");
  const { createSession } = await import("../packages/auth/src/session.ts");

  try {
    const userId = randomUUID();
    const email = `phase10-${userId}@example.test`;
    await pool.query(
      `INSERT INTO enough.auth_users (id, email, email_normalized, password_hash, email_verified_at)
     VALUES ($1, $2, $2, NULL, now())`,
      [userId, email],
    );

    const setupSession = await createSession(userId, "web", "Phase 10 fixture setup", "magic_link");
    const created = await request(
      "/products",
      setupSession,
      "POST",
      {
        name: "Phase 10 browser fixture",
        targetCustomer: "Local acceptance only",
        problemStatement: "Validate the browser policy client",
        productStage: "IDEA",
        hasLaunched: false,
        userCount: 0,
        payingUserCount: 0,
        currentRevenue: null,
        revenueCurrency: "EUR",
        initialGoal: "Verify browser policy behavior",
      },
      201,
    );
    const productId = created.product.id;
    const alternate = await request(
      "/products",
      setupSession,
      "POST",
      {
        name: "Phase 10 alternate policy fixture",
        targetCustomer: "Local acceptance only",
        problemStatement: "Validate extension product selection",
        productStage: "IDEA",
        hasLaunched: false,
        userCount: 0,
        payingUserCount: 0,
        currentRevenue: null,
        revenueCurrency: "EUR",
        initialGoal: "Switch the browser policy product",
      },
      201,
    );

    await request(
      "/rules",
      setupSession,
      "POST",
      {
        name: "Phase 10 local host focus check",
        enabled: true,
        priority: 80,
        action: "BLOCK",
        productId,
        deviceId: null,
        conditions: { toolKind: "DOMAIN", toolKeys: ["127.0.0.1"] },
        schedule: null,
      },
      201,
    );
    await request(
      "/rules",
      setupSession,
      "POST",
      {
        name: "Phase 10 Growth Mode precedence check",
        enabled: true,
        priority: 90,
        action: "BLOCK",
        productId,
        deviceId: null,
        conditions: { toolKind: "DOMAIN", toolKeys: ["gmail.com"] },
        schedule: null,
      },
      201,
    );
    await request(
      "/privacy-consents/ACTIVITY_COLLECTION",
      setupSession,
      "PUT",
      { enabled: true },
      200,
    );

    const chromeSession = await createSession(
      userId,
      "extension",
      "Phase 10 Chromium fixture",
      "magic_link",
    );
    const firefoxSession = await createSession(
      userId,
      "extension",
      "Phase 10 Firefox fixture",
      "magic_link",
    );
    const controlSession = await createSession(
      userId,
      "web",
      "Phase 10 revocation control",
      "magic_link",
    );
    await request(
      `/auth/sessions/${setupSession.sessionId}`,
      setupSession,
      "DELETE",
      undefined,
      204,
    );

    await writeFile(
      accountFile,
      `${JSON.stringify(
        {
          fixture: "enough-phase10",
          apiBaseUrl: process.env.API_BASE_URL,
          email,
          productName: created.product.name,
          alternateProductName: alternate.product.name,
          chromeExtensionToken: chromeSession.token,
          chromeSessionId: chromeSession.sessionId,
          firefoxExtensionToken: firefoxSession.token,
          firefoxSessionId: firefoxSession.sessionId,
          revocationControlToken: controlSession.token,
          revocationControlCsrf: controlSession.csrfToken,
          revocationControlSessionId: controlSession.sessionId,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600, flag: "wx" },
    );
    console.info(
      "Prepared a disposable Phase 10 account, product, policy, consent and extension sessions.",
    );
    console.info(
      "Private values were saved to TEMP/enough-phase10/manual-account.json and were not printed.",
    );
  } finally {
    await pool.end();
  }
}
