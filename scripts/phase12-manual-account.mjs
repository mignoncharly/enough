import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

assert.equal(process.env.ENOUGH_PHASE12_MANUAL_ACCOUNT, "1");
const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.deepEqual(
  [target.hostname, target.port, target.pathname, target.username],
  ["127.0.0.1", "55943", "/enough_phase12", "enough_phase12"],
);
assert.equal(process.env.APP_BASE_URL, "http://127.0.0.1:3313");
assert.equal(process.env.API_BASE_URL, "http://127.0.0.1:4422");
assert.equal(process.env.REDIS_URL, "redis://127.0.0.1:56405/0");

const { pool } = await import("../packages/db/src/index.ts");
const { hashPassword } = await import("../packages/auth/src/crypto.ts");
const { createSession } = await import("../packages/auth/src/session.ts");
try {
  const id = randomUUID();
  const email = `phase12-manual-${id}@example.test`;
  const password = randomBytes(24).toString("base64url");
  await pool.query(
    "INSERT INTO enough.auth_users (id, email, email_normalized, password_hash, email_verified_at) VALUES ($1, $2, $2, $3, now())",
    [id, email, await hashPassword(password)],
  );
  const session = await createSession(id, "web", "Phase 12 manual acceptance", "magic_link");
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
      name: "Phase 12 task acceptance",
      targetCustomer: "Synthetic product teams",
      problemStatement: "Verify stage-specific next actions",
      productStage: "IDEA",
      initialGoal: "Speak with a prospective customer",
    }),
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(created.status, 201, "Phase 12 product setup failed.");
  const product = (await created.json()).product;
  await writeFile(
    join(tmpdir(), "enough-phase12", "manual-account.json"),
    `${JSON.stringify({ email, password, webBaseUrl: process.env.APP_BASE_URL, productId: product.id }, null, 2)}\n`,
    { mode: 0o600, flag: "wx" },
  );
  console.info(
    "Disposable Phase 12 account and IDEA-stage product prepared in TEMP; credentials were not printed.",
  );
} finally {
  await pool.end();
}
