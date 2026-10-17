// Preparation only: importing this module never starts services, reads credentials,
// creates a directory/marker, or touches an earlier fixture.
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isolatedEnvironment } from "./subprocess-environment.mjs";

export const phase16Fixture = Object.freeze({
  directory: path.resolve(tmpdir(), "enough-phase16-reports"),
  markerFile: "phase16-fixture.json",
  owner: "enough-phase16-reports",
  markerVersion: 1,
  database: "enough_phase16_reports",
  role: "enough_phase16_reports",
  host: "127.0.0.1",
  ports: Object.freeze({
    postgres: 55952,
    redis: 56413,
    wslRedis: 56414,
    api: 4442,
    worker: 4443,
    web: 3322,
  }),
  migrationSteps: Object.freeze([
    "src/migration-precheck.ts",
    "src/migrate.ts",
    "src/migration-precheck.ts",
  ]),
  providerEnabledByDefault: false,
});

export async function phase16MigrationFiles() {
  const files = (await readdir(new URL("../packages/db/migrations/", import.meta.url)))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  // Require the complete current chain. Never inherit ENOUGH_MIGRATION_STOP_AFTER.
  assert.deepEqual(
    files.map((name) => name.slice(0, 4)),
    Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(4, "0")),
    "Review the Phase 16 fixture plan when the migration chain changes",
  );
  assert.equal(files.at(-1), "0020_provider_integrations.sql");
  return files;
}

export async function assertPhase16MigrationLedger(appliedIds) {
  assert.deepEqual(
    [...appliedIds].sort(),
    await phase16MigrationFiles(),
    "Phase 16 requires all migrations through 0020 and no pending/unknown migrations",
  );
}

export function phase16Environment(source, credentials) {
  return isolatedEnvironment(source, {
    NODE_ENV: "development",
    ENOUGH_PHASE16_RUNTIME: "1",
    ENOUGH_PHASE16_INTEGRATION: "1",
    CI: "true",
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: `postgresql://${phase16Fixture.role}:${credentials.app}@127.0.0.1:${phase16Fixture.ports.postgres}/${phase16Fixture.database}`,
    REDIS_URL: `redis://127.0.0.1:${phase16Fixture.ports.redis}/0`,
    AUTH_SECRET: credentials.auth,
    AUTH_DEV_SHOW_EMAIL_LINKS: "false",
    APP_BASE_URL: `http://127.0.0.1:${phase16Fixture.ports.web}`,
    API_BASE_URL: `http://127.0.0.1:${phase16Fixture.ports.api}`,
    API_PORT: String(phase16Fixture.ports.api),
    WORKER_PORT: String(phase16Fixture.ports.worker),
    OPENAI_API_KEY: "",
    LOG_LEVEL: "info",
    ENOUGH_PHASE16_NOW: "2024-03-01T12:34:56.000Z",
  });
}

// The launcher/cleanup must obtain these facts from lstat/realpath and
// actual listener/process checks. This pure guard is not permission to delete.
export function assertPhase16Ownership({ resolvedDirectory, symbolicLink, marker, activePorts }) {
  assert.equal(
    path.resolve(resolvedDirectory),
    phase16Fixture.directory,
    "Wrong fixture directory",
  );
  assert.equal(symbolicLink, false, "Fixture must not be a link");
  assert.deepEqual(
    marker,
    { fixture: phase16Fixture.owner, version: phase16Fixture.markerVersion },
    "Wrong fixture owner",
  );
  assert.deepEqual(activePorts, [], "Stop owned services before preparing or cleaning the fixture");
}
