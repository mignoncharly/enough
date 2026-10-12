import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyPolicySnapshot } from "../packages/shared/src/signed-policy-snapshot.ts";

const fixture = join(tmpdir(), "enough-phase11");
assert.equal(process.env.ENOUGH_PHASE11_MANUAL_ACCOUNT, "1");
const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.deepEqual(
  [target.hostname, target.port, target.pathname, target.username],
  ["127.0.0.1", "55942", "/enough_phase11", "enough_phase11"],
);
assert.equal(process.env.API_BASE_URL, "http://127.0.0.1:4420");
assert.equal(process.env.APP_BASE_URL, "http://127.0.0.1:3312");
assert.equal(process.env.REDIS_URL, "redis://127.0.0.1:56403/0");

const accountFile = join(fixture, "manual-account.json");

async function apiRequest(route, session, method = "GET", body, expectedStatus = 200) {
  const response = await fetch(`${process.env.API_BASE_URL}${route}`, {
    method,
    headers: {
      authorization: `Bearer ${session.token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(
    response.status,
    expectedStatus,
    `Phase 11 fixture setup failed at ${route} (${response.status}).`,
  );
  return response.status === 204 ? null : response.json();
}

async function verifySession(token) {
  const response = await fetch(`${process.env.API_BASE_URL}/auth/me`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  return response.status === 200;
}

async function verifySignedPolicy({ token, userId, deviceId, productIds }) {
  const response = await fetch(`${process.env.API_BASE_URL}/desktop/policy-snapshot`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200, "The isolated API must return a signed desktop snapshot.");
  const snapshot = await response.json();
  const publicKey = await readFile(join(fixture, "policy-snapshot-public.pem"), "utf8");
  const verified = verifyPolicySnapshot(snapshot, publicKey, { userId, deviceId });
  assert.ok(
    verified,
    "The desktop verifier must accept the API snapshot for this account and device.",
  );
  assert.deepEqual(new Set(verified.productIds), new Set(productIds));
  assert.ok(verified.rules.some((rule) => rule.name === "Phase 11 Notepad focus rule"));
  assert.ok(
    verified.mappings.some(
      (mapping) => mapping.toolKey === "notepad" && mapping.classification === "GROWTH",
    ),
  );
}

if (existsSync(accountFile)) {
  const existing = JSON.parse(readFileSync(accountFile, "utf8"));
  assert.equal(existing.fixture, "enough-phase11");
  assert.equal(existing.apiBaseUrl, process.env.API_BASE_URL);
  assert.ok(await verifySession(existing.desktopAccessToken));
  assert.ok(await verifySession(existing.recoveryAccessToken));
  await verifySignedPolicy({
    token: existing.desktopAccessToken,
    userId: existing.userId,
    deviceId: existing.deviceId,
    productIds: [existing.productId, existing.alternateProductId],
  });
  console.info("Reused the disposable Phase 11 account; fixture tokens were not printed.");
} else {
  const { pool } = await import("../packages/db/src/index.ts");
  const { createSession } = await import("../packages/auth/src/session.ts");
  try {
    const userId = randomUUID();
    const email = `phase11-${userId}@example.test`;
    await pool.query(
      `INSERT INTO enough.auth_users (id, email, email_normalized, email_verified_at)
       VALUES ($1, $2, $2, now())`,
      [userId, email],
    );
    const desktopSession = await createSession(
      userId,
      "desktop",
      "Phase 11 disposable desktop",
      "magic_link",
    );
    const recoverySession = await createSession(
      userId,
      "desktop",
      "Phase 11 recovery desktop",
      "magic_link",
    );
    const controlSession = await createSession(
      userId,
      "web",
      "Phase 11 disposable revocation control",
      "magic_link",
    );
    const product = async (name) => {
      const response = await apiRequest(
        "/products",
        desktopSession,
        "POST",
        {
          name,
          targetCustomer: "Fixture users",
          problemStatement: "Exercise desktop policy sync in an isolated fixture.",
          initialGoal: "Verify the Phase 11 desktop acceptance path.",
          productStage: "IDEA",
        },
        201,
      );
      return response.product;
    };
    const primary = await product("Phase 11 Desktop Policy");
    const alternate = await product("Phase 11 Desktop Alternate");
    await apiRequest(
      "/classification/mappings",
      desktopSession,
      "POST",
      {
        toolKind: "APPLICATION",
        toolKey: "notepad",
        displayName: "Notepad",
        classification: "GROWTH",
        productId: primary.id,
      },
      201,
    );
    await apiRequest(
      "/rules",
      desktopSession,
      "POST",
      {
        name: "Phase 11 Notepad focus rule",
        enabled: true,
        priority: 100,
        action: "BLOCK",
        productId: primary.id,
        deviceId: null,
        conditions: { toolKind: "APPLICATION", toolKeys: ["notepad"] },
        schedule: null,
      },
      201,
    );
    await apiRequest("/privacy-consents/ACTIVITY_COLLECTION", desktopSession, "PUT", {
      enabled: true,
    });
    await verifySignedPolicy({
      token: desktopSession.token,
      userId,
      deviceId: desktopSession.deviceId,
      productIds: [primary.id, alternate.id],
    });

    await writeFile(
      accountFile,
      `${JSON.stringify(
        {
          fixture: "enough-phase11",
          apiBaseUrl: process.env.API_BASE_URL,
          userId,
          deviceId: desktopSession.deviceId,
          email,
          desktopAccessToken: desktopSession.token,
          desktopSessionId: desktopSession.sessionId,
          recoveryAccessToken: recoverySession.token,
          recoverySessionId: recoverySession.sessionId,
          controlSessionToken: controlSession.token,
          controlSessionCsrf: controlSession.csrfToken,
          productId: primary.id,
          productName: primary.name,
          alternateProductId: alternate.id,
          alternateProductName: alternate.name,
          applicationName: "Notepad",
        },
        null,
        2,
      )}\n`,
      { mode: 0o600, flag: "wx" },
    );
    console.info("Prepared disposable Phase 11 products, policy, consent, and desktop sessions.");
    console.info(
      "Temporary token values were saved in TEMP/enough-phase11/manual-account.json and were not printed.",
    );
  } finally {
    await pool.end();
  }
}
