import { describe, expect, it } from "vitest";

const plan = await import(new URL("./phase16-fixture-plan.mjs", import.meta.url).href);
describe("Phase 16 fixture ownership/environment safety", () => {
  const fixture = plan.phase16Fixture;
  const valid = {
    resolvedDirectory: fixture.directory,
    symbolicLink: false,
    marker: { fixture: fixture.owner, version: fixture.markerVersion },
    activePorts: [],
  };
  it("accepts only the dedicated marked, stopped root", () => {
    expect(() => plan.assertPhase16Ownership(valid)).not.toThrow();
  });
  it.each([
    ["wrong path", { resolvedDirectory: `${fixture.directory}-other` }],
    ["linked root", { symbolicLink: true }],
    ["unmarked root", { marker: null }],
    ["wrong owner", { marker: { fixture: "unrelated", version: 1 } }],
    ["occupied listener", { activePorts: [4442] }],
  ])("refuses %s before deletion/start", (_label, override) => {
    expect(() => plan.assertPhase16Ownership({ ...valid, ...override })).toThrow();
  });
  it("does not inherit provider/root dotenv or migration-stop configuration", () => {
    const env = plan.phase16Environment(
      {
        PATH: process.env.PATH,
        OPENAI_API_KEY: "synthetic-forbidden",
        DATABASE_URL: "synthetic-forbidden",
        NODE_OPTIONS: "synthetic-forbidden",
        ENOUGH_MIGRATION_STOP_AFTER: "0011",
      },
      { app: "a".repeat(64), auth: "b".repeat(64) },
    );
    expect(env.OPENAI_API_KEY).toBe("");
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.ENOUGH_MIGRATION_STOP_AFTER).toBeUndefined();
    expect(new URL(env.DATABASE_URL).port).toBe("55952");
    expect(new URL(env.DATABASE_URL).pathname).toBe("/enough_phase16_reports");
  });
  it("requires exactly the current full migration chain", async () => {
    const files = await plan.phase16MigrationFiles();
    expect(files).toHaveLength(20);
    await plan.assertPhase16MigrationLedger(files);
    await expect(plan.assertPhase16MigrationLedger(files.slice(0, 11))).rejects.toThrow();
    await expect(plan.assertPhase16MigrationLedger([...files, files[19]])).rejects.toThrow();
  });
});
