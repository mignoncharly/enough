import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const phase4 = process.env.ENOUGH_PHASE4_INTEGRATION === "1";
const phase = phase4 ? "phase4" : "phase3";
const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.deepEqual(
  [target.hostname, target.port, target.pathname, target.username],
  ["127.0.0.1", phase4 ? "55435" : "55434", `/enough_${phase}`, `enough_${phase}`],
);
assert.equal(process.env.API_BASE_URL, phase4 ? "http://127.0.0.1:4406" : "http://127.0.0.1:4404");
assert.equal(
  process.env.REDIS_URL,
  phase4 ? "redis://127.0.0.1:56385/0" : "redis://127.0.0.1:56383/0",
);
const { pool } = await import("../packages/db/src/index.ts");
const { hashPassword } = await import("../packages/auth/src/crypto.ts");
try {
  const id = randomUUID();
  const email = `${phase}-manual-${id}@example.test`;
  const password = randomBytes(24).toString("base64url");
  await pool.query(
    "INSERT INTO enough.auth_users (id, email, email_normalized, password_hash, email_verified_at) VALUES ($1, $2, $2, $3, now())",
    [id, email, await hashPassword(password)],
  );
  if (phase4) {
    const { createSession } = await import("../packages/auth/src/session.ts");
    const session = await createSession(id, "web", "Phase 4 fixture setup", "magic_link");
    const headers = {
      cookie: `enough_session=${session.token}; enough_csrf=${session.csrfToken}`,
      "x-csrf-token": session.csrfToken,
      origin: process.env.APP_BASE_URL,
      "content-type": "application/json",
    };
    const saved = await fetch(`${process.env.API_BASE_URL}/onboarding`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        productDescription: "Clinic scheduling assistant",
        targetCustomer: "Independent clinics",
        problemStatement: "Appointment reminders take too much staff time",
        productStage: "IDEA",
        hasLaunched: false,
        userCount: 10,
        payingUserCount: 2,
        currentRevenue: "10.00",
        revenueCurrency: "EUR",
        nextGoal: "Interview five clinic owners",
        buildTools: ["Terminal"],
      }),
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(saved.status, 200, "Phase 4 synthetic onboarding preparation failed");
    const logout = await fetch(`${process.env.API_BASE_URL}/auth/logout`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(logout.status, 204, "Fixture setup session logout failed");
    console.info("Phase 4 synthetic product prepared; setup session revoked.");
  }
  await writeFile(
    join(tmpdir(), `enough-${phase}`, "manual-account.json"),
    `${JSON.stringify({ email, password, webBaseUrl: process.env.APP_BASE_URL }, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.info(
    `New disposable account saved to TEMP/enough-${phase}/manual-account.json; no credentials printed.`,
  );
} finally {
  await pool.end();
}
