import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.deepEqual(
  [target.hostname, target.port, target.pathname, target.username],
  ["127.0.0.1", "55437", "/enough_phase6", "enough_phase6"],
);
assert.equal(process.env.API_BASE_URL, "http://127.0.0.1:4410");
assert.equal(process.env.APP_BASE_URL, "http://127.0.0.1:3306");
assert.equal(process.env.REDIS_URL, "redis://127.0.0.1:56389/0");

const { pool } = await import("../packages/db/src/index.ts");
const { hashPassword } = await import("../packages/auth/src/crypto.ts");
const { createSession } = await import("../packages/auth/src/session.ts");
try {
  const id = randomUUID();
  const email = `phase6-manual-${id}@example.test`;
  const password = randomBytes(24).toString("base64url");
  await pool.query(
    "INSERT INTO enough.auth_users (id, email, email_normalized, password_hash, email_verified_at) VALUES ($1, $2, $2, $3, now())",
    [id, email, await hashPassword(password)],
  );
  const session = await createSession(id, "web", "Phase 6 browser acceptance", "magic_link");
  const headers = {
    cookie: `enough_session=${session.token}; enough_csrf=${session.csrfToken}`,
    "x-csrf-token": session.csrfToken,
    origin: process.env.APP_BASE_URL,
    "content-type": "application/json",
  };
  const onboarding = await fetch(`${process.env.API_BASE_URL}/onboarding`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      productDescription: "Phase 6 synthetic workspace",
      targetCustomer: "Test teams",
      problemStatement: "Validate tools-page mappings",
      productStage: "IDEA",
      hasLaunched: false,
      userCount: 0,
      payingUserCount: 0,
      currentRevenue: null,
      revenueCurrency: "EUR",
      nextGoal: "Verify the classification preview",
      buildTools: ["Terminal"],
    }),
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(onboarding.status, 200, "Phase 6 synthetic product preparation failed");
  const logout = await fetch(`${process.env.API_BASE_URL}/auth/logout`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(logout.status, 204, "Phase 6 fixture setup session logout failed");
  await writeFile(
    join(tmpdir(), "enough-phase6", "manual-account.json"),
    `${JSON.stringify({ email, password, webBaseUrl: process.env.APP_BASE_URL }, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.info(
    "Synthetic Phase 6 account saved in TEMP/enough-phase6/manual-account.json; credentials not printed.",
  );
} finally {
  await pool.end();
}
