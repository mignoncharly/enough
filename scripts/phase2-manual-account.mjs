import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.deepEqual(
  [target.hostname, target.port, target.pathname, target.username],
  ["127.0.0.1", "55433", "/enough_phase2", "enough_phase2"],
);
assert.equal(process.env.API_BASE_URL, "http://127.0.0.1:4402");
assert.equal(process.env.REDIS_URL, "redis://127.0.0.1:56381/0");
const { pool } = await import("../packages/db/src/index.ts");
const { hashPassword, verifyPassword } = await import("../packages/auth/src/crypto.ts");
const { createSession } = await import("../packages/auth/src/session.ts");
try {
  const id = randomUUID();
  const email = `phase2-manual-${id}@example.test`;
  const password = randomBytes(24).toString("base64url");
  const hash = await hashPassword(password);
  assert.equal(await verifyPassword(password, hash), true);
  await pool.query(
    "INSERT INTO enough.auth_users (id, email, email_normalized, password_hash, email_verified_at) VALUES ($1, $2, $2, $3, now())",
    [id, email, hash],
  );
  const extension = await createSession(
    id,
    "extension",
    "Phase 2 manual extension token",
    "password",
  );
  const output = fileURLToPath(new URL("../.runtime/phase2/manual-account.json", import.meta.url));
  await writeFile(
    output,
    `${JSON.stringify({ email, password, apiBaseUrl: process.env.API_BASE_URL, extensionToken: extension.token }, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.info(
    "Verified disposable account and extension token saved in ignored .runtime/phase2/manual-account.json. No credentials printed.",
  );
} finally {
  await pool.end();
}
