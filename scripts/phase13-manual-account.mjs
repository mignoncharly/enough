import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

assert.equal(process.env.ENOUGH_PHASE13_MANUAL_ACCOUNT, "1");
const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.deepEqual(
  [target.hostname, target.port, target.pathname, target.username],
  ["127.0.0.1", "55944", "/enough_phase13", "enough_phase13"],
);
assert.equal(process.env.APP_BASE_URL, "http://127.0.0.1:3314");
assert.equal(process.env.API_BASE_URL, "http://127.0.0.1:4424");
assert.equal(process.env.REDIS_URL, "redis://127.0.0.1:56407/0");

const { hashPassword } = await import("../packages/auth/src/crypto.ts");
const { pool } = await import("../packages/db/src/index.ts");
const { createSession } = await import("../packages/auth/src/session.ts");
try {
  const id = randomUUID();
  const email = `phase13-manual-${id}@example.test`;
  const password = randomBytes(24).toString("base64url");
  await pool.query(
    "INSERT INTO enough.auth_users (id, email, email_normalized, password_hash, email_verified_at) VALUES ($1, $2, $2, $3, now())",
    [id, email, await hashPassword(password)],
  );
  const session = await createSession(id, "web", "Phase 13 manual acceptance", "magic_link");
  const headers = {
    cookie: `enough_session=${session.token}; enough_csrf=${session.csrfToken}`,
    "x-csrf-token": session.csrfToken ?? "",
    origin: process.env.APP_BASE_URL,
    "content-type": "application/json",
  };
  const created = await fetch(`${process.env.API_BASE_URL}/products`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Phase 13 evidence acceptance",
      targetCustomer: "Synthetic product teams",
      problemStatement: "Verify evidence-gated rewards",
      productStage: "IDEA",
      initialGoal: "Complete a task and verify its evidence",
    }),
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(created.status, 201, "Phase 13 product setup failed.");
  const product = (await created.json()).product;
  const taskResponse = await fetch(`${process.env.API_BASE_URL}/growth-tasks`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      productId: product.id,
      title: "Phase 13 evidence acceptance task",
      priority: 4,
      signalStrength: 4,
      estimatedMinutes: 20,
      rewardCredits: 5,
    }),
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(taskResponse.status, 201, "Phase 13 task setup failed.");
  const task = (await taskResponse.json()).task;
  const completed = await fetch(`${process.env.API_BASE_URL}/growth-tasks/${task.id}/complete`, {
    method: "POST",
    headers,
    body: "{}",
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(completed.status, 200, "Phase 13 task completion setup failed.");
  const completion = (await completed.json()).completion;
  assert.equal(completion.verificationStatus, "AWAITING_EVIDENCE");
  assert.equal(completion.creditTransactionId, null);
  await writeFile(
    join(tmpdir(), "enough-phase13", "manual-account.json"),
    `${JSON.stringify(
      { email, password, webBaseUrl: process.env.APP_BASE_URL, productId: product.id },
      null,
      2,
    )}\n`,
    { mode: 0o600, flag: "wx" },
  );
  console.info(
    "Disposable Phase 13 login and completed task prepared in TEMP; credentials were not printed.",
  );
} finally {
  await pool.end();
}
