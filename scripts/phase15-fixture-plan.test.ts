import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertPhase15MigrationLedger,
  assertPhase15Ownership,
  phase15Environment,
  phase15Fixture,
  phase15MigrationFiles,
} from "./phase15-fixture-plan.mjs";

describe("Phase 15 runtime preparation (no services or credential access)", () => {
  it("has independent ports, paths and provider-disabled default", () => {
    expect(path.basename(phase15Fixture.directory)).toBe("enough-phase15-ai");
    expect(Object.values(phase15Fixture.ports)).toEqual([55950, 56411, 56412, 4440, 4441, 3320]);
    expect(new Set(Object.values(phase15Fixture.ports)).size).toBe(6);
    expect(phase15Fixture.providerEnabledByDefault).toBe(false);
  });
  it("requires the complete current chain through 0020 and prechecks before/after", async () => {
    const files = await phase15MigrationFiles();
    expect(files).toHaveLength(20);
    expect(files).toContain("0014_privacy.sql");
    expect(files).toContain("0015_admin_console.sql");
    expect(files).toContain("0019_evidence_object_storage_finalize.sql");
    expect(phase15Fixture.migrationSteps).toEqual([
      "src/migration-precheck.ts",
      "src/migrate.ts",
      "src/migration-precheck.ts",
    ]);
    await expect(assertPhase15MigrationLedger(files)).resolves.toBeUndefined();
    await expect(assertPhase15MigrationLedger(files.slice(0, 11))).rejects.toThrow();
    await expect(assertPhase15MigrationLedger([...files, "unknown.sql"])).rejects.toThrow();
  });
  it.each(["path", "link", "owner", "active"])("refuses unsafe fixture %s", (issue) => {
    expect(() =>
      assertPhase15Ownership({
        resolvedDirectory:
          issue === "path" ? path.dirname(phase15Fixture.directory) : phase15Fixture.directory,
        symbolicLink: issue === "link",
        marker: {
          fixture: issue === "owner" ? "different-fixture" : phase15Fixture.owner,
          version: 1,
        },
        activePorts: issue === "active" ? [4440] : [],
      }),
    ).toThrow();
  });
  it("accepts only its own stopped fixture metadata", () => {
    expect(() =>
      assertPhase15Ownership({
        resolvedDirectory: phase15Fixture.directory,
        symbolicLink: false,
        marker: { fixture: phase15Fixture.owner, version: 1 },
        activePorts: [],
      }),
    ).not.toThrow();
  });
  it.each([undefined, {}, { fixture: phase15Fixture.owner, version: 2 }])(
    "refuses missing or obsolete ownership metadata",
    (marker) => {
      expect(() =>
        assertPhase15Ownership({
          resolvedDirectory: phase15Fixture.directory,
          symbolicLink: false,
          marker,
          activePorts: [],
        }),
      ).toThrow();
    },
  );
  it("drops inherited credentials and provider overrides without mutating the parent", () => {
    const parent = {
      PATH: "synthetic-tool-path",
      OPENAI_API_KEY: "synthetic-parent-only",
      OPENAI_MODEL: "synthetic-parent-model",
      DATABASE_URL: "synthetic-parent-db",
      REDIS_URL: "synthetic-parent-redis",
      AUTH_SECRET: "synthetic-parent-auth",
      GOOGLE_INTEGRATION_CLIENT_SECRET: "synthetic-google",
      MICROSOFT_INTEGRATION_CLIENT_SECRET: "synthetic-microsoft",
      EVIDENCE_S3_SECRET_ACCESS_KEY: "synthetic-storage",
      POLICY_SNAPSHOT_SIGNING_PRIVATE_KEY: "synthetic-signing",
      ENOUGH_MIGRATION_STOP_AFTER: "0011",
      NODE_OPTIONS: "--env-file=never-load-this",
    };
    const before = { ...parent };
    const child = phase15Environment(parent, {
      app: "synthetic-fixture-db",
      auth: "synthetic-fixture-auth",
    });
    expect(child.OPENAI_API_KEY).toBe("");
    expect(child.PATH).toBe(parent.PATH);
    expect(child.AUTH_SECRET).toBe("synthetic-fixture-auth");
    expect(new URL(child.DATABASE_URL ?? "").port).toBe("55950");
    for (const key of [
      "OPENAI_MODEL",
      "GOOGLE_INTEGRATION_CLIENT_SECRET",
      "MICROSOFT_INTEGRATION_CLIENT_SECRET",
      "EVIDENCE_S3_SECRET_ACCESS_KEY",
      "POLICY_SNAPSHOT_SIGNING_PRIVATE_KEY",
      "ENOUGH_MIGRATION_STOP_AFTER",
      "NODE_OPTIONS",
    ])
      expect(child[key]).toBeUndefined();
    expect(parent).toEqual(before);
  });
});
