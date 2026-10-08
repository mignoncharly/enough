import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { env } from "@enough/config";
import { pool } from "@enough/db";
import { createMainQueue } from "@enough/queue";

const target = new URL(env.DATABASE_URL);
assert.equal(target.hostname, "127.0.0.1");
assert.equal(target.port, "55432");
assert.equal(target.pathname, "/enough_phase1");
assert.equal(target.username, "enough_phase1");
assert.equal(env.REDIS_URL, "redis://127.0.0.1:56379/0");

const client = await pool.connect();
const queue = createMainQueue();
let job: Awaited<ReturnType<typeof queue.add>> | undefined;
try {
  const ledger = await client.query("SELECT count(*)::int AS count FROM enough.schema_migrations");
  assert.equal(ledger.rows[0].count, 15);
  const role = await client.query(
    "SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user",
  );
  assert.deepEqual(role.rows[0], { rolsuper: false, rolcreatedb: false, rolcreaterole: false });
  await client.query("BEGIN");
  await client.query("CREATE TEMP TABLE phase1_smoke (id integer PRIMARY KEY) ON COMMIT DROP");
  await client.query("INSERT INTO phase1_smoke VALUES (1)");
  const row = await client.query("SELECT id FROM phase1_smoke");
  assert.equal(row.rows[0].id, 1);
  await client.query("ROLLBACK");
  console.info("Database ledger, least-privilege role and transaction smoke checks passed.");

  job = await queue.add("healthcheck", {}, { jobId: `phase1-smoke-${randomUUID()}` });
  const deadline = Date.now() + 15_000;
  let completed = false;
  while (Date.now() < deadline) {
    const state = await job.getState();
    assert.notEqual(state, "failed", "Worker healthcheck job failed");
    if (state === "completed") {
      assert.ok(job.id, "Healthcheck job has no ID");
      const stored = await queue.getJob(job.id);
      assert.deepEqual(stored?.returnvalue, { healthy: true });
      completed = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(completed, "Worker did not complete healthcheck within 15 seconds");
  console.info("Redis/BullMQ worker round trip passed.");
} finally {
  if (job) await job.remove();
  await queue.close();
  client.release();
  await pool.end();
}
