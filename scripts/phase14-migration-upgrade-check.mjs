import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = join(tmpdir(), "enough-phase14");
const marker = JSON.parse(await readFile(join(fixture, "phase14-fixture.json"), "utf8"));
assert.deepEqual(marker, { fixture: "enough-phase14", version: 1 });
const dataDirectory = join(fixture, "pgdata");
const pgPort = "55946";
const phaseFlag = "--phase14";
const pgStatus = spawnSync("pg_ctl", ["-D", dataDirectory, "status"], {
  windowsHide: true,
  stdio: "ignore",
});
const wasRunning = pgStatus.status === 0;
if (!wasRunning) {
  execFileSync(
    process.execPath,
    [join(root, "scripts", "phase1-postgres.mjs"), "start", phaseFlag],
    {
      windowsHide: true,
      stdio: "inherit",
    },
  );
}

const fixtureEnvironment = parseEnv(await readFile(join(fixture, "fixture.env"), "utf8"));
const credentials = JSON.parse(await readFile(join(fixture, "credentials.json"), "utf8"));
const databaseName = `enough_phase14_upgrade_${randomUUID().replaceAll("-", "")}`;
const requireFromDb = createRequire(join(root, "packages", "db", "package.json"));
const { Client } = requireFromDb("pg");
const admin = new Client({
  connectionString: `postgresql://enough_phase14_admin:${credentials.admin}@127.0.0.1:${pgPort}/postgres`,
});
const dbRoot = join(root, "packages", "db");
const environment = {
  ...process.env,
  ...fixtureEnvironment,
  NODE_ENV: "test",
};

function runMigration(script, env = environment) {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    cwd: dbRoot,
    env,
    windowsHide: true,
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${script} exited with status ${result.status}`);
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

let adminConnected = false;
let databaseCreated = false;
try {
  await admin.connect();
  adminConnected = true;
  await admin.query(`CREATE DATABASE "${databaseName}" OWNER enough_phase14`);
  databaseCreated = true;
  const databaseUrl = new URL(fixtureEnvironment.DATABASE_URL);
  databaseUrl.pathname = `/${databaseName}`;
  const upgradeEnvironment = { ...environment, DATABASE_URL: databaseUrl.toString() };
  delete upgradeEnvironment.ENOUGH_MIGRATION_STOP_AFTER;
  const oldSchemaEnvironment = {
    ...upgradeEnvironment,
    ENOUGH_MIGRATION_STOP_AFTER: "0019_evidence_object_storage_finalize.sql",
  };

  runMigration("src/migrate.ts", oldSchemaEnvironment);
  const pending = runMigration("src/migration-precheck.ts", oldSchemaEnvironment);
  assert.match(pending, /Pending migrations: 0020_provider_integrations\.sql/);

  const oldSchemaClient = new Client({ connectionString: databaseUrl.toString() });
  await oldSchemaClient.connect();
  const userId = randomUUID();
  const productId = randomUUID();
  const integrationId = randomUUID();
  const eventId = randomUUID();
  try {
    await oldSchemaClient.query(
      `INSERT INTO enough.auth_users (id, email, email_normalized, display_name)
       VALUES ($1, $2, $2, 'Migration fixture')`,
      [userId, `${userId}@example.test`],
    );
    await oldSchemaClient.query(
      `INSERT INTO enough.products
         (id, user_id, name, target_customer, problem_statement, product_stage)
       VALUES ($1, $2, 'Upgrade fixture', 'Small teams', 'Migration compatibility', 'IDEA')`,
      [productId, userId],
    );
    await oldSchemaClient.query(
      `INSERT INTO enough.integration_accounts (id, user_id, product_id, provider, display_name)
       VALUES ($1, $2, $3, 'GMAIL', 'Legacy Gmail')`,
      [integrationId, userId, productId],
    );
    await oldSchemaClient.query(
      `INSERT INTO enough.integration_events
         (id, integration_account_id, user_id, product_id, provider_event_id, event_type,
          occurred_at, payload_hash)
       VALUES ($1, $2, $3, $4, 'legacy-event', 'email.outreach_sent', now(), repeat('a', 64))`,
      [eventId, integrationId, userId, productId],
    );
  } finally {
    await oldSchemaClient.end();
  }

  runMigration("src/migrate.ts", upgradeEnvironment);
  const finalPrecheck = runMigration("src/migration-precheck.ts", upgradeEnvironment);
  assert.match(finalPrecheck, /No pending migrations\./);

  const upgradedClient = new Client({ connectionString: databaseUrl.toString() });
  await upgradedClient.connect();
  try {
    const preserved = await upgradedClient.query(
      `SELECT event.event_type, event.provider_origin_verified,
              (SELECT count(*)::text FROM enough.schema_migrations) AS pending_migrations
       FROM enough.integration_events event WHERE event.id = $1`,
      [eventId],
    );
    expectRow(preserved.rows[0]);
  } finally {
    await upgradedClient.end();
  }
  console.info(
    "Migration upgrade from the accepted 0019 schema preserved legacy integration data.",
  );
} finally {
  if (adminConnected && databaseCreated)
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await admin.end().catch(() => undefined);
  if (!wasRunning) {
    execFileSync(
      process.execPath,
      [join(root, "scripts", "phase1-postgres.mjs"), "stop", phaseFlag],
      { windowsHide: true, stdio: "inherit" },
    );
  }
}

function expectRow(row) {
  assert.deepEqual(row, {
    event_type: "email.outreach_sent",
    provider_origin_verified: false,
    pending_migrations: "20",
  });
}
