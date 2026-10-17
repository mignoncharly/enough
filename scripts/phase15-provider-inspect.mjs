// Read-only post-run privacy check and provider-disabled recovery probe.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstat, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { assertPhase15Ownership, phase15Fixture as fixture } from "./phase15-fixture-plan.mjs";
import { isolatedEnvironment } from "./subprocess-environment.mjs";

let db;
let phase = "OWNERSHIP";
try {
  const root = fileURLToPath(new URL("../", import.meta.url));
  assertPhase15Ownership({
    resolvedDirectory: await realpath(fixture.directory),
    symbolicLink: (await lstat(fixture.directory)).isSymbolicLink(),
    marker: JSON.parse(await readFile(path.join(fixture.directory, fixture.markerFile), "utf8")),
    activePorts: [],
  });
  const credentials = JSON.parse(
    await readFile(path.join(fixture.directory, "credentials.json"), "utf8"),
  );
  const supplied = parseEnv(await readFile(path.join(fixture.directory, "openai.env"), "utf8"));
  const seed = JSON.parse(await readFile(path.join(fixture.directory, "seed.json"), "utf8"));
  const needles = [
    supplied.OPENAI_API_KEY,
    ...Object.values(credentials),
    ...Object.values(seed.canaries),
    ...seed.accounts.flatMap((account) => [account.session.token, account.session.csrfToken]),
  ];
  const credentialNeedles = [
    supplied.OPENAI_API_KEY,
    ...Object.values(credentials),
    ...seed.accounts.flatMap((account) => [account.session.token, account.session.csrfToken]),
  ];
  phase = "DATABASE_CONNECTION";
  const { Client } = createRequire(path.join(root, "packages/db/package.json"))("pg");
  db = new Client({
    host: fixture.host,
    port: fixture.ports.postgres,
    user: fixture.role,
    password: credentials.app,
    database: fixture.database,
  });
  await db.connect();
  assert.deepEqual((await db.query("SELECT current_user,current_database()")).rows[0], {
    current_user: fixture.role,
    current_database: fixture.database,
  });
  for (const row of (
    await db.query(
      "SELECT title,description FROM enough.growth_tasks UNION ALL SELECT title,note AS description FROM enough.task_evidence_items",
    )
  ).rows)
    needles.push(row.title, row.description);
  const check = (text) => {
    assert.ok(
      !needles
        .filter((value) => typeof value === "string" && value.length >= 16)
        .some((value) => text.includes(value) || text.includes(JSON.stringify(value).slice(1, -1))),
    );
    assert.ok(
      !/authorization|bearer\s|enough_session=|enough_csrf=|"(?:input|output_text|diagnosis|nextAction|note)"\s*:/i.test(
        text,
      ),
    );
  };
  phase = "LOG_PRIVACY";
  const logs = (await readdir(fixture.directory)).filter((name) => name.endsWith(".log"));
  for (const name of logs) check(await readFile(path.join(fixture.directory, name), "utf8"));
  const git = (args) =>
    execFileSync("git", args, {
      cwd: root,
      env: isolatedEnvironment(process.env),
      encoding: "utf8",
      windowsHide: true,
    })
      .split("\0")
      .filter(Boolean);
  phase = "DIFF_PRIVACY";
  const changed = [
    ...new Set([
      ...git(["diff", "--name-only", "-z"]),
      ...git(["ls-files", "--others", "--exclude-standard", "-z"]),
    ]),
  ];
  for (const name of changed) {
    phase = `DIFF_PRIVACY:${name}:VALUE_CHECK`;
    assert.ok(!/phase14|ga4/i.test(name));
    const content = await readFile(path.join(root, name), "utf8");
    let baseline = "";
    try {
      baseline = execFileSync("git", ["show", `HEAD:${name}`], {
        cwd: root,
        env: isolatedEnvironment(process.env),
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      /* New files have no baseline. */
    }
    assert.ok(
      !credentialNeedles
        .filter((v) => typeof v === "string" && v.length >= 16)
        .some((v) => content.includes(v)),
    );
    // Source legitimately mentions header/input field names; compare actual secret values only.
    assert.ok(
      !needles
        .filter(
          (v) =>
            typeof v === "string" &&
            v.length >= 32 &&
            !v.startsWith("Synthetic ") &&
            !baseline.includes(v),
        )
        .some((v) => content.includes(v)),
    );
    phase = `DIFF_PRIVACY:${name}:KEY_PATTERN`;
    assert.ok(!/sk-(?:proj-)?[A-Za-z0-9_-]{32,}/.test(content));
  }
  phase = "USAGE_SCHEMA";
  const usage = (await db.query("SELECT * FROM enough.admin_ai_usage_events")).rows;
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
  assert.ok(usage.every((row) => Object.keys(row).every((name) => allowed.includes(name))));
  const ledgerPath = path.join(fixture.directory, "provider-ledger.json");
  const ledgerBefore = await readFile(ledgerPath, "utf8");
  const session = seed.accounts[0].session;
  const headers = {
    cookie: `enough_session=${session.token}; enough_csrf=${session.csrfToken}`,
    "x-csrf-token": session.csrfToken,
    origin: `http://127.0.0.1:${fixture.ports.web}`,
    "content-type": "application/json",
  };
  const base = `http://127.0.0.1:${fixture.ports.api}`;
  phase = "DISABLED_LOCAL_PATH";
  const status = await fetch(`${base}/ai/status`, { headers, signal: AbortSignal.timeout(5000) });
  assert.equal(status.status, 200);
  assert.equal((await status.json()).providerConfigured, false);
  const fallback = await fetch(`${base}/ai/coach`, {
    method: "POST",
    headers,
    body: JSON.stringify({ productId: seed.products[0].id, capability: "NEXT_ACTION" }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(fallback.status, 200);
  assert.equal((await fallback.json()).source, "STAGE_GUIDANCE");
  assert.equal(await readFile(ledgerPath, "utf8"), ledgerBefore);
  assert.equal(
    (await readFile(path.join(fixture.directory, "egress-blocked.log"), "utf8")).trim(),
    "",
  );
  for (const name of logs) check(await readFile(path.join(fixture.directory, name), "utf8"));
  const result = {
    privacy: "PASS",
    logs: logs.length,
    changedFiles: changed.length,
    usageSchema: "PASS",
    providerDisabled: true,
    localFallback: true,
    outboundAttemptsAfterDisable: 0,
  };
  await writeFile(
    path.join(fixture.directory, "provider-inspection.json"),
    JSON.stringify(result, null, 2),
    { mode: 0o600 },
  );
  console.info(JSON.stringify(result));
} catch (error) {
  console.error(
    `Phase 15 post-run inspection BLOCKED at ${phase}; category=${["EPERM", "EACCES", "ECONNREFUSED"].includes(error?.code) ? error.code : "SAFE_ASSERTION"}; raw details withheld.`,
  );
  process.exitCode = 1;
} finally {
  if (db) await db.end();
}
