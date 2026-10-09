import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.deepEqual(
  [target.hostname, target.port, target.pathname, target.username],
  ["127.0.0.1", "55434", "/enough_phase3", "enough_phase3"],
);
assert.equal(process.env.API_BASE_URL, "http://127.0.0.1:4404");
assert.equal(process.env.REDIS_URL, "redis://127.0.0.1:56383/0");
const { pool } = await import("../packages/db/src/index.ts");
const { hashPassword } = await import("../packages/auth/src/crypto.ts");
try {
  const id = randomUUID();
  const email = `phase3-manual-${id}@example.test`;
  const password = randomBytes(24).toString("base64url");
  await pool.query(
    "INSERT INTO enough.auth_users (id, email, email_normalized, password_hash, email_verified_at) VALUES ($1, $2, $2, $3, now())",
    [id, email, await hashPassword(password)],
  );
  await writeFile(
    join(tmpdir(), "enough-phase3", "manual-account.json"),
    `${JSON.stringify({ email, password, webBaseUrl: process.env.APP_BASE_URL }, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.info(
    "New disposable account saved to TEMP/enough-phase3/manual-account.json; no credentials printed.",
  );
} finally {
  await pool.end();
}
