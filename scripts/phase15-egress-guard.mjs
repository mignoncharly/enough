// Opt-in fixture preload only. No product configuration or provider endpoints change.
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { phase15Fixture as fixture } from "./phase15-fixture-plan.mjs";

assert.equal(process.env.ENOUGH_PHASE15_RUNTIME, "1");
assert.equal(process.env.OPENAI_API_KEY, "");
assert.equal(new URL(process.env.DATABASE_URL).port, String(fixture.ports.postgres));
assert.equal(new URL(process.env.DATABASE_URL).pathname, `/${fixture.database}`);
// The current provider abstraction uses fetch. Even an accidental attempt cannot
// leave this API process. Never retain URL, headers, body or exception details.
globalThis.fetch = async () => {
  appendFileSync(path.join(fixture.directory, "egress-blocked.log"), "OUTBOUND_FETCH_BLOCKED\n");
  throw new Error("Phase 15 external fetch disabled");
};
