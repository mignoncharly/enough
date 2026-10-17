import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { lstat, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { parseEnv } from "node:util";
import {
  assertPhase15Ownership,
  phase15Fixture as fixture,
  phase15Environment,
} from "./phase15-fixture-plan.mjs";
import { capabilities, createProviderBoundary } from "./phase15-provider-boundary.mjs";

const report = {
  preflight: false,
  calls: 0,
  result: "BLOCKED",
  consentDenied: false,
  fallback: false,
  taskZeroReward: false,
  privacy: false,
  usage: false,
  disabled: false,
};
let app, pool, cache, config, boundary;
const reportPath = path.join(fixture.directory, "provider-report.json");
const ledgerPath = path.join(fixture.directory, "provider-ledger.json");
const logPath = path.join(fixture.directory, "provider-route.log");
const needles = new Set();
const nativeFetch = globalThis.fetch;
let key = "";
let phase = "PREFLIGHT";
function safe(condition) {
  if (!condition) throw new Error("Phase 15 safe assertion failed");
}
function remember(value) {
  if (typeof value === "string" && value.length >= 16) {
    needles.add(value);
    needles.add(JSON.stringify(value).slice(1, -1));
  } else if (value && typeof value === "object") Object.values(value).forEach(remember);
}
function inspectText(text) {
  safe(![...needles].some((needle) => text.includes(needle)));
  safe(
    !/authorization|bearer\s|enough_session=|enough_csrf=|"(?:input|output_text|diagnosis|nextAction|note)"\s*:/i.test(
      text,
    ),
  );
}
async function inspectPrivacy(body, output) {
  if (body) {
    remember(body);
    const parsed = JSON.parse(body);
    remember(parsed.input);
  }
  if (output) {
    remember(output);
    remember(JSON.parse(output));
  }
  for (const name of await readdir(fixture.directory)) {
    if (name.endsWith(".log"))
      inspectText(await readFile(path.join(fixture.directory, name), "utf8"));
  }
}
try {
  phase = "ENVIRONMENT_AND_OWNERSHIP";
  safe(process.env.ENOUGH_PHASE15_BOUNDED_PROVIDER === "1" && process.env.OPENAI_API_KEY === "");
  assertPhase15Ownership({
    resolvedDirectory: await realpath(fixture.directory),
    symbolicLink: (await lstat(fixture.directory)).isSymbolicLink(),
    marker: JSON.parse(await readFile(path.join(fixture.directory, fixture.markerFile), "utf8")),
    activePorts: [],
  });
  const credentials = JSON.parse(
    await readFile(path.join(fixture.directory, "credentials.json"), "utf8"),
  );
  const expected = phase15Environment(process.env, credentials);
  for (const name of ["DATABASE_URL", "REDIS_URL", "AUTH_SECRET", "API_BASE_URL", "APP_BASE_URL"])
    safe(process.env[name] === expected[name]);
  safe(
    !Object.keys(process.env).some((name) =>
      /^(STRIPE|GOOGLE|MICROSOFT|RESEND|AWS|AZURE|EVIDENCE_STORAGE|OPENAI_PROJECT|OPENAI_ORG)/.test(
        name,
      ),
    ),
  );
  const credentialPath = path.join(fixture.directory, "openai.env");
  phase = "CREDENTIAL_FILE";
  safe((await lstat(credentialPath)).isFile() && !(await lstat(credentialPath)).isSymbolicLink());
  safe((await realpath(credentialPath)) === credentialPath);
  const supplied = parseEnv(await readFile(credentialPath, "utf8"));
  safe(Object.keys(supplied).every((name) => ["OPENAI_API_KEY", "OPENAI_MODEL"].includes(name)));
  key = supplied.OPENAI_API_KEY;
  safe(typeof key === "string" && key.startsWith("sk-") && !/\s/.test(key));
  remember(key);
  remember(credentials);
  const seed = JSON.parse(await readFile(path.join(fixture.directory, "seed.json"), "utf8"));
  phase = "SYNTHETIC_SEED";
  safe(seed.fixture === fixture.owner && seed.accounts.length === 2 && seed.products.length === 3);
  remember(seed.canaries);
  remember(seed.accounts);
  safe(!(await lstat(ledgerPath).catch(() => null))); // Never reset a previous budget.
  phase = "EXISTING_LOG_PRIVACY";
  await inspectPrivacy();
  // All later fetches are denied until an explicitly selected provider attempt.
  globalThis.fetch = async () => {
    throw new Error("Phase 15 fetch disabled");
  };
  phase = "RUNTIME_IMPORTS";
  ({ pool } = await import("../packages/db/src/index.ts"));
  cache = await import("../packages/cache/src/index.ts");
  ({ env: config } = await import("../packages/config/src/index.ts"));
  safe(!config.OPENAI_API_KEY);
  let consentReads = 0;
  const originalQuery = pool.query.bind(pool);
  pool.query = (...args) => {
    if (
      typeof args[0] === "string" &&
      args[0].startsWith("SELECT enabled FROM enough.privacy_consents")
    )
      consentReads++;
    return originalQuery(...args);
  };
  assert.deepEqual((await pool.query("SELECT current_user,current_database()")).rows[0], {
    current_user: fixture.role,
    current_database: fixture.database,
  });
  phase = "SYNTHETIC_ACCOUNT_OWNERSHIP";
  const users = (await pool.query("SELECT id,email FROM enough.auth_users ORDER BY id")).rows;
  safe(
    users.length === 2 &&
      users.every(
        (user, i) =>
          user.id === seed.accounts[i].id && user.email === `phase15-account-${i + 1}@example.test`,
      ),
  );
  phase = "SESSION_AND_ROUTES";
  const { createSession } = await import("../packages/auth/src/session.ts");
  const session = await createSession(
    seed.accounts[0].id,
    "web",
    "Synthetic Phase 15 bounded acceptance",
    "magic_link",
  );
  remember(session);
  const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
  const Fastify = require("fastify");
  const { requestLoggerOptions } = await import("../apps/api/src/logging.ts");
  await writeFile(logPath, "", { mode: 0o600 });
  let privacyLeak = false;
  app = Fastify({
    logger: {
      ...requestLoggerOptions("debug"),
      stream: {
        write(line) {
          try {
            inspectText(line);
            appendFileSync(logPath, line);
          } catch {
            privacyLeak = true;
          }
        },
      },
    },
  });
  const { registerAiRoutes } = await import("../apps/api/src/ai.ts");
  const { registerTaskRoutes } = await import("../apps/api/src/tasks.ts");
  const { registerPrivacyRoutes } = await import("../apps/api/src/privacy.ts");
  await registerAiRoutes(app);
  await registerTaskRoutes(app);
  await registerPrivacyRoutes(app);
  const headers = {
    cookie: `enough_session=${session.token}; enough_csrf=${session.csrfToken}`,
    "x-csrf-token": session.csrfToken,
    origin: expected.APP_BASE_URL,
  };
  const invoke = (url, payload, method = "POST") => app.inject({ method, url, payload, headers });
  const consent = async (enabled) => {
    safe(
      (await invoke("/privacy-consents/AI_PROVIDER_PROCESSING", { enabled }, "PUT")).statusCode ===
        200,
    );
  };
  const selected = seed.products[0];
  const input = (capability) => ({
    productId: selected.id,
    capability,
    ...(capability === "SCOPE_CHALLENGE" ? { taskId: selected.taskId } : {}),
    ...(capability === "EVIDENCE_CLASSIFICATION" ? { evidenceId: selected.evidenceId } : {}),
  });
  const creditSnapshot = async () =>
    JSON.stringify((await pool.query("SELECT * FROM enough.credit_transactions ORDER BY id")).rows);
  const taskCount = async () =>
    Number((await pool.query("SELECT count(*) AS n FROM enough.growth_tasks")).rows[0].n);
  const creditsBefore = await creditSnapshot();
  const tasksBefore = await taskCount();
  const usageBefore = Number(
    (await pool.query("SELECT count(*) AS n FROM enough.admin_ai_usage_events")).rows[0].n,
  );
  phase = "DISABLED_FALLBACK";
  const fallback = await invoke("/ai/coach", input("NEXT_ACTION"));
  safe(fallback.statusCode === 200 && fallback.json().source === "STAGE_GUIDANCE");
  report.fallback = true;
  const model = supplied.OPENAI_MODEL || config.OPENAI_MODEL;
  safe(typeof model === "string" && /^[a-zA-Z0-9._-]{1,100}$/.test(model));
  report.model = model;
  boundary = createProviderBoundary({
    key,
    model,
    transport: nativeFetch,
    consent: async () => {
      safe(consentReads >= 2); // Both real-route checks must precede the transport check.
      return (
        (
          await pool.query(
            "SELECT enabled FROM enough.privacy_consents WHERE user_id=$1 AND purpose='AI_PROVIDER_PROCESSING'",
            [seed.accounts[0].id],
          )
        ).rows[0]?.enabled === true
      );
    },
    inspectPrivacy: async (...args) => {
      safe(!privacyLeak);
      await inspectPrivacy(...args);
    },
    persist: async (ledger) => {
      await writeFile(ledgerPath, JSON.stringify(ledger, null, 2), { mode: 0o600 });
    },
  });
  globalThis.fetch = boundary.fetch;
  config.OPENAI_API_KEY = key;
  config.OPENAI_MODEL = model;
  phase = "LIVE_CONSENT_DENIAL";
  await consent(false);
  safe((await invoke("/ai/coach", input("NEXT_ACTION"))).statusCode === 403);
  safe(boundary.ledger.length === 0);
  report.consentDenied = true;
  await consent(true);
  safe((await invoke("/ai/status", undefined, "GET")).json().providerConsentEnabled === true);
  // Only this exact isolated Redis database; start the bounded quota window fresh.
  await cache.getRedis().flushdb();
  await inspectPrivacy();
  safe(!privacyLeak);
  report.preflight = true;
  await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  if (!process.argv.includes("--preflight")) {
    for (const capability of capabilities) {
      phase = capability;
      await consent(true); // Grant immediately before each submission.
      consentReads = 0;
      boundary.select(capability);
      const response = await invoke("/ai/coach", input(capability));
      safe(response.statusCode === 200);
      const result = response.json();
      safe(result.source === "OPENAI" && !result.outcome && result.advice);
      remember(result.advice);
      const recorded = (
        await pool.query(
          "SELECT capability,provider,model,status,input_tokens,output_tokens,latency_ms FROM enough.admin_ai_usage_events ORDER BY created_at",
        )
      ).rows.slice(usageBefore);
      safe(recorded.length === boundary.ledger.length);
      const usageRow = recorded.at(-1);
      safe(
        usageRow.capability === capability &&
          usageRow.provider === "openai" &&
          usageRow.model === model &&
          usageRow.status === "SUCCEEDED",
      );
      safe(
        [usageRow.input_tokens, usageRow.output_tokens, usageRow.latency_ms].every(
          (value) => value === null || (Number.isInteger(value) && value >= 0),
        ),
      );
      boundary.ledger.at(-1).inputTokens = usageRow.input_tokens;
      boundary.ledger.at(-1).outputTokens = usageRow.output_tokens;
      await boundary.accepted();
      report.consentRecheck = consentReads >= 3;
      safe((await creditSnapshot()) === creditsBefore);
      safe((await taskCount()) === tasksBefore + (report.taskZeroReward ? 1 : 0));
      if (capability === "TASK_GENERATION") {
        const suggestion = result.advice.tasks[0];
        safe(suggestion);
        const saved = await invoke("/growth-tasks", {
          productId: selected.id,
          ...suggestion,
          rewardCredits: 0,
        });
        safe(saved.statusCode === 201);
        const task = saved.json().task;
        const row = (
          await pool.query(
            "SELECT user_id,product_id,reward_credits,status FROM enough.growth_tasks WHERE id=$1",
            [task.id],
          )
        ).rows[0];
        safe(
          row.user_id === seed.accounts[0].id &&
            row.product_id === selected.id &&
            row.reward_credits === 0 &&
            row.status === "ACTIVE",
        );
        safe((await creditSnapshot()) === creditsBefore && (await taskCount()) === tasksBefore + 1);
        report.taskZeroReward = true;
      }
      await inspectPrivacy();
      safe(!privacyLeak);
    }
    phase = "POSTFLIGHT";
    const usage = (
      await pool.query("SELECT * FROM enough.admin_ai_usage_events ORDER BY created_at")
    ).rows.slice(usageBefore);
    const allowed = [
      "id",
      "user_id",
      "capability",
      "provider",
      "model",
      "status",
      "input_tokens",
      "output_tokens",
      "latency_ms",
      "created_at",
    ];
    safe(
      usage.length === 7 &&
        usage.every(
          (row) =>
            Object.keys(row).every((name) => allowed.includes(name)) &&
            row.user_id === seed.accounts[0].id &&
            row.status === "SUCCEEDED" &&
            row.model === model &&
            [row.input_tokens, row.output_tokens, row.latency_ms].every(
              (v) => v === null || (Number.isInteger(v) && v >= 0),
            ),
        ),
    );
    safe(usage.every((row, i) => row.capability === capabilities[i]));
    report.usage = true;
    await inspectPrivacy();
    safe(!privacyLeak);
    report.privacy = true;
    report.result = "PASS";
  } else report.result = "PREFLIGHT_PASS";
} catch (error) {
  report.errorCategory = [
    "ERR_MODULE_NOT_FOUND",
    "ERR_PACKAGE_PATH_NOT_EXPORTED",
    "ECONNREFUSED",
    "EPERM",
    "EACCES",
  ].includes(error?.code)
    ? error.code
    : error?.name === "ZodError"
      ? "CONFIG_VALIDATION"
      : "SAFE_ASSERTION_OR_RUNTIME";
  report.blockerPhase = phase;
  report.result = "BLOCKED";
  process.exitCode = 1;
} finally {
  if (config) config.OPENAI_API_KEY = "";
  boundary?.disable();
  globalThis.fetch = async () => {
    throw new Error("Phase 15 provider disabled after acceptance");
  };
  report.disabled = !config || config.OPENAI_API_KEY === "";
  report.calls = boundary?.ledger.length ?? 0;
  if (app) await app.close();
  if (pool) await pool.end();
  if (cache) await cache.closeRedis();
  key = "";
  await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
}
