import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = join(tmpdir(), "enough-phase5");
const dbRoot = join(root, "packages", "db");
const fixtureEnvironment = parseEnv(await readFile(join(fixture, "fixture.env"), "utf8"));
const applicationUrl = new URL(fixtureEnvironment.DATABASE_URL);
assert.deepEqual(
  [applicationUrl.hostname, applicationUrl.port, applicationUrl.pathname, applicationUrl.username],
  ["127.0.0.1", "55436", "/enough_phase5", "enough_phase5"],
);

const credentials = JSON.parse(await readFile(join(fixture, "credentials.json"), "utf8"));
assert.match(credentials.admin, /^[a-f0-9]{64}$/);
const adminUrl = new URL(applicationUrl);
adminUrl.pathname = "/postgres";
adminUrl.username = "enough_phase5_admin";
adminUrl.password = credentials.admin;

const require = createRequire(join(root, "packages", "db", "package.json"));
const { Client } = require("pg");
const admin = new Client({ connectionString: adminUrl.toString() });
const databaseName = `enough_phase5_migration_${randomUUID().replaceAll("-", "")}`;
let created = false;

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${databaseName} OWNER enough_phase5`);
  created = true;

  const targetUrl = new URL(applicationUrl);
  targetUrl.pathname = `/${databaseName}`;
  const environment = {
    ...process.env,
    ...fixtureEnvironment,
    DATABASE_URL: targetUrl.toString(),
    NODE_ENV: "test",
  };

  for (const script of ["src/migrate.ts", "src/migration-precheck.ts"]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", script], {
      cwd: dbRoot,
      env: environment,
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    assert.equal(result.status, 0, `${script} exited with ${result.status ?? result.error}`);
  }

  const migrated = new Client({ connectionString: targetUrl.toString() });
  await migrated.connect();
  try {
    const applied = await migrated.query("SELECT id FROM enough.schema_migrations ORDER BY id");
    const expected = (await readdir(join(dbRoot, "migrations")))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    assert.deepEqual(
      applied.rows.map((row) => row.id),
      expected,
      "Fresh database must contain every migration in filename order",
    );
    assert.ok(expected.includes("0005_activity_event_platform.sql"));
    const activityTables = await migrated.query(
      "SELECT to_regclass('enough.activity_events')::text AS events, to_regclass('enough.activity_event_aggregates')::text AS aggregates",
    );
    assert.deepEqual(activityTables.rows[0], {
      events: "enough.activity_events",
      aggregates: "enough.activity_event_aggregates",
    });
    console.info(
      `Fresh migration check passed: ${applied.rowCount} migrations applied in order, including 0002–0005.`,
    );
  } finally {
    await migrated.end();
  }
} finally {
  try {
    if (created) await admin.query(`DROP DATABASE ${databaseName}`);
  } finally {
    await admin.end();
  }
}
