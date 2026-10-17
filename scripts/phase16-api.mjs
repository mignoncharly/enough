// Fixture-only query fault/pause controls, with no HTTP endpoint or product UI.
// The registered route and its SQL remain the production implementation.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { phase16Fixture as fixture } from "./phase16-fixture-plan.mjs";

assert.equal(process.env.ENOUGH_PHASE16_RUNTIME, "1");
const { pool } = await import("../packages/db/src/index.ts");
const query = pool.query.bind(pool);
async function control() {
  return readFile(path.join(fixture.directory, "query-control.json"), "utf8")
    .then(JSON.parse)
    .catch((error) => {
      if (error.code === "ENOENT") return {};
      throw error;
    });
}
pool.query = async (...args) => {
  const text = typeof args[0] === "string" ? args[0] : (args[0]?.text ?? "");
  const settings = await control();
  if (
    settings.mode === "fail" &&
    text.includes("AS report_day") &&
    text.includes("FROM enough.activity_events")
  )
    throw new Error("P16_SQL_PRIVATE_CANARY");
  if (
    settings.mode === "pause" &&
    text.includes("AS report_day") &&
    text.includes("FROM enough.growth_task_completions completion")
  ) {
    await writeFile(path.join(fixture.directory, "daily-query-paused.json"), "true");
    for (let i = 0; (await control()).mode === "pause"; i++) {
      assert.ok(i < 500, "Fixture query pause timeout");
      await delay(20);
    }
  }
  const result = await query(...args);
  if (settings.mode === "pause" && /FROM enough\.growth_task_completions\s+WHERE/.test(text))
    await writeFile(path.join(fixture.directory, "weekly-query-read.json"), "true");
  return result;
};
await import("../apps/api/src/server.ts");
