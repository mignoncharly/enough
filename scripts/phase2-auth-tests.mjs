import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = parseEnv(await readFile(join(root, ".runtime", "phase2", "fixture.env"), "utf8"));
const target = new URL(fixture.DATABASE_URL);
assert.deepEqual(
  [target.hostname, target.port, target.pathname, target.username],
  ["127.0.0.1", "55433", "/enough_phase2", "enough_phase2"],
);
assert.equal(fixture.REDIS_URL, "redis://127.0.0.1:56381/0");
assert.equal(fixture.APP_BASE_URL, "http://127.0.0.1:3302");
assert.equal(fixture.API_BASE_URL, "http://127.0.0.1:4402");

const environment = { ...process.env, ...fixture, ENOUGH_PHASE2_INTEGRATION: "1" };
// Local security acceptance never enables or sends requests to external providers.
for (const key of [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "RESEND_API_KEY",
  "AUTH_EMAIL_FROM",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRETS",
  "STRIPE_PRICE_MONTHLY",
  "STRIPE_PRICE_ANNUAL",
])
  environment[key] = "";
console.info(
  "Phase 2 local authentication checks target only the isolated fixture; OAuth providers remain disabled.",
);
const child = spawn(
  process.execPath,
  [
    join(root, "node_modules", "vitest", "vitest.mjs"),
    "run",
    "packages/auth/src/auth.integration.test.ts",
    "apps/api/src/auth-http.integration.test.ts",
    "packages/auth/src/client-auth.integration.test.ts",
    "--hookTimeout=60000",
    "--testTimeout=60000",
    "--maxWorkers=1",
  ],
  { cwd: root, env: environment, stdio: "inherit", windowsHide: true },
);
child.once("error", () => {
  console.error("Could not launch Phase 2 authentication tests.");
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
