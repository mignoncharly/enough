// Preparation only: importing this module never starts services, reads credentials,
// creates a directory/marker, or touches an earlier fixture.
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isolatedEnvironment } from "./subprocess-environment.mjs";

export const phase15Fixture = Object.freeze({
  directory: path.resolve(tmpdir(), "enough-phase15-ai"),
  markerFile: "phase15-fixture.json",
  owner: "enough-phase15-ai",
  markerVersion: 1,
  database: "enough_phase15_ai",
  role: "enough_phase15_ai",
  host: "127.0.0.1",
  ports: Object.freeze({
    postgres: 55950,
    redis: 56411,
    wslRedis: 56412,
    api: 4440,
    worker: 4441,
    web: 3320,
  }),
  migrationSteps: Object.freeze([
    "src/migration-precheck.ts",
    "src/migrate.ts",
    "src/migration-precheck.ts",
  ]),
  providerEnabledByDefault: false,
});

export async function phase15MigrationFiles() {
  const files = (await readdir(new URL("../packages/db/migrations/", import.meta.url)))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  // Require the complete current chain. Never inherit ENOUGH_MIGRATION_STOP_AFTER.
  assert.deepEqual(
    files.map((name) => name.slice(0, 4)),
    Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(4, "0")),
    "Review the Phase 15 fixture plan when the migration chain changes",
  );
  assert.equal(files.at(-1), "0020_provider_integrations.sql");
  return files;
}

export async function assertPhase15MigrationLedger(appliedIds) {
  assert.deepEqual(
    [...appliedIds].sort(),
    await phase15MigrationFiles(),
    "Phase 15 requires all migrations through 0020 and no pending/unknown migrations",
  );
}

export function phase15Environment(source, credentials) {
  return isolatedEnvironment(source, {
    NODE_ENV: "development",
    ENOUGH_PHASE15_RUNTIME: "1",
    ENOUGH_PHASE15_INTEGRATION: "1",
    CI: "true",
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: `postgresql://${phase15Fixture.role}:${credentials.app}@127.0.0.1:${phase15Fixture.ports.postgres}/${phase15Fixture.database}`,
    REDIS_URL: `redis://127.0.0.1:${phase15Fixture.ports.redis}/0`,
    AUTH_SECRET: credentials.auth,
    AUTH_DEV_SHOW_EMAIL_LINKS: "false",
    APP_BASE_URL: `http://127.0.0.1:${phase15Fixture.ports.web}`,
    API_BASE_URL: `http://127.0.0.1:${phase15Fixture.ports.api}`,
    API_PORT: String(phase15Fixture.ports.api),
    WORKER_PORT: String(phase15Fixture.ports.worker),
    OPENAI_API_KEY: "",
    LOG_LEVEL: "debug",
  });
}

// The launcher/cleanup must obtain these facts from lstat/realpath and
// actual listener/process checks. This pure guard is not permission to delete.
export function assertPhase15Ownership({ resolvedDirectory, symbolicLink, marker, activePorts }) {
  assert.equal(
    path.resolve(resolvedDirectory),
    phase15Fixture.directory,
    "Wrong fixture directory",
  );
  assert.equal(symbolicLink, false, "Fixture must not be a link");
  assert.deepEqual(
    marker,
    { fixture: phase15Fixture.owner, version: phase15Fixture.markerVersion },
    "Wrong fixture owner",
  );
  assert.deepEqual(activePorts, [], "Stop owned services before preparing or cleaning the fixture");
}
