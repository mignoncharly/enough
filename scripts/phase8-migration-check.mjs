import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = join(tmpdir(), "enough-phase8");
const dbRoot = join(root, "packages", "db");
const fixtureEnvironment = parseEnv(await readFile(join(fixture, "fixture.env"), "utf8"));
const applicationUrl = new URL(fixtureEnvironment.DATABASE_URL);
assert.deepEqual(
  [applicationUrl.hostname, applicationUrl.port, applicationUrl.pathname, applicationUrl.username],
  ["127.0.0.1", "55439", "/enough_phase8", "enough_phase8"],
);
const credentials = JSON.parse(await readFile(join(fixture, "credentials.json"), "utf8"));
assert.match(credentials.admin, /^[a-f0-9]{64}$/);
const adminUrl = new URL(applicationUrl);
adminUrl.pathname = "/postgres";
adminUrl.username = "enough_phase8_admin";
adminUrl.password = credentials.admin;

const require = createRequire(join(root, "packages", "db", "package.json"));
const { Client } = require("pg");
const admin = new Client({ connectionString: adminUrl.toString() });
const databaseName = `enough_p8mig_${randomUUID().replaceAll("-", "")}`;
const migrationFiles = (await readdir(join(dbRoot, "migrations")))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const finalMigration = "0017_precise_build_session_meter.sql";
const allocationMigration = "0016_build_session_lifecycle.sql";
const legacyFiles = migrationFiles.filter((name) => name < allocationMigration);
let created = false;

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${databaseName} OWNER enough_phase8`);
  created = true;
  const targetUrl = new URL(applicationUrl);
  targetUrl.pathname = `/${databaseName}`;
  const target = new Client({ connectionString: targetUrl.toString() });
  await target.connect();
  try {
    await target.query("CREATE SCHEMA IF NOT EXISTS enough");
    await target.query(`
      CREATE TABLE enough.schema_migrations (
        id text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    for (const name of legacyFiles) {
      const sql = await readFile(join(dbRoot, "migrations", name), "utf8");
      await target.query("BEGIN");
      try {
        await target.query(sql);
        await target.query("INSERT INTO enough.schema_migrations (id, checksum) VALUES ($1, $2)", [
          name,
          createHash("sha256").update(sql).digest("hex"),
        ]);
        await target.query("COMMIT");
      } catch (error) {
        await target.query("ROLLBACK");
        throw error;
      }
    }

    const userId = randomUUID();
    const productId = randomUUID();
    const accountId = randomUUID();
    const grantId = randomUUID();
    const lotId = randomUUID();
    const activeReservationId = randomUUID();
    const releasedReservationId = randomUUID();
    const sessionId = randomUUID();
    await target.query(
      "INSERT INTO enough.auth_users (id, email, email_normalized, email_verified_at) VALUES ($1, $2, $2, now())",
      [userId, `phase8-migration-${userId}@example.test`],
    );
    await target.query(
      `INSERT INTO enough.products (id, user_id, name, target_customer, problem_statement, product_stage)
       VALUES ($1, $2, 'Migration fixture', 'Synthetic users', 'Exercise existing credit allocation rows', 'IDEA')`,
      [productId, userId],
    );
    await target.query(
      `INSERT INTO enough.credit_accounts
         (id, user_id, product_id, available_balance, reserved_balance, lifetime_earned)
       VALUES ($1, $2, $3, 2, 5, 7)`,
      [accountId, userId, productId],
    );
    await target.query(
      `INSERT INTO enough.credit_transactions
         (id, account_id, user_id, action, amount, available_delta, reserved_delta,
          balance_after_available, balance_after_reserved, idempotency_key, request_hash)
       VALUES ($1, $2, $3, 'EARN', 7, 7, 0, 7, 0, 'legacy-grant-key', $4)`,
      [grantId, accountId, userId, "a".repeat(64)],
    );
    await target.query(
      `INSERT INTO enough.credit_lots
         (id, account_id, user_id, source_transaction_id, original_amount, available_amount, reserved_amount)
       VALUES ($1, $2, $3, $4, 7, 2, 5)`,
      [lotId, accountId, userId, grantId],
    );
    await target.query(
      `INSERT INTO enough.credit_reservations
         (id, account_id, user_id, status, amount, remaining_amount)
       VALUES ($1, $2, $3, 'ACTIVE', 5, 5), ($4, $2, $3, 'RELEASED', 2, 0)`,
      [activeReservationId, accountId, userId, releasedReservationId],
    );
    await target.query(
      `INSERT INTO enough.credit_transactions
         (id, account_id, user_id, action, amount, available_delta, reserved_delta,
          balance_after_available, balance_after_reserved, idempotency_key, request_hash, reservation_id)
       VALUES ($1, $2, $3, 'RESERVE', 5, -5, 5, 2, 5, 'legacy-reserve-key', $4, $5)`,
      [randomUUID(), accountId, userId, "b".repeat(64), activeReservationId],
    );
    await target.query(
      `INSERT INTO enough.credit_reservation_allocations
         (id, reservation_id, lot_id, account_id, user_id, amount, status)
       VALUES ($1, $2, $3, $4, $5, 5, 'ACTIVE'), ($6, $7, $3, $4, $5, 2, 'RELEASED')`,
      [
        randomUUID(),
        activeReservationId,
        lotId,
        accountId,
        userId,
        randomUUID(),
        releasedReservationId,
      ],
    );
    const allocationSql = await readFile(join(dbRoot, "migrations", allocationMigration), "utf8");
    await target.query("BEGIN");
    try {
      await target.query(allocationSql);
      await target.query("INSERT INTO enough.schema_migrations (id, checksum) VALUES ($1, $2)", [
        allocationMigration,
        createHash("sha256").update(allocationSql).digest("hex"),
      ]);
      await target.query("COMMIT");
    } catch (error) {
      await target.query("ROLLBACK");
      throw error;
    }
    const backfilled = await target.query(
      `SELECT reservation_id, status, remaining_amount::int AS remaining_amount
       FROM enough.credit_reservation_allocations ORDER BY reservation_id`,
    );
    assert.deepEqual(
      backfilled.rows,
      [
        { reservation_id: activeReservationId, status: "ACTIVE", remaining_amount: 5 },
        { reservation_id: releasedReservationId, status: "RELEASED", remaining_amount: 0 },
      ].sort((left, right) => left.reservation_id.localeCompare(right.reservation_id)),
    );

    await target.query(
      `INSERT INTO enough.build_sessions
         (id, account_id, user_id, product_id, reservation_id, status, reserved_minutes,
          active_seconds, lease_version, last_heartbeat_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 5, 2, 1, now(), now() + interval '1 hour')`,
      [sessionId, accountId, userId, productId, activeReservationId],
    );
    const meterSql = await readFile(join(dbRoot, "migrations", finalMigration), "utf8");
    await target.query("BEGIN");
    try {
      await target.query(meterSql);
      await target.query("INSERT INTO enough.schema_migrations (id, checksum) VALUES ($1, $2)", [
        finalMigration,
        createHash("sha256").update(meterSql).digest("hex"),
      ]);
      await target.query("COMMIT");
    } catch (error) {
      await target.query("ROLLBACK");
      throw error;
    }
    const preciseMeter = await target.query(
      "SELECT active_milliseconds::int AS active_milliseconds FROM enough.build_sessions WHERE id = $1",
      [sessionId],
    );
    assert.equal(preciseMeter.rows[0].active_milliseconds, 2000);
    await target.query("DELETE FROM enough.auth_users WHERE id = $1", [userId]);
    console.info(
      "Phase 8 migration upgrade passed: Phase 7 allocation rows backfilled and session meter seconds converted to milliseconds.",
    );
  } finally {
    await target.end();
  }
} finally {
  try {
    if (created) await admin.query(`DROP DATABASE ${databaseName}`);
  } finally {
    await admin.end();
  }
}
