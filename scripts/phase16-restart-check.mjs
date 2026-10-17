import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPhase16Ownership, phase16Fixture as fixture } from "./phase16-fixture-plan.mjs";
import { isolatedEnvironment } from "./subprocess-environment.mjs";

const root = fileURLToPath(new URL("../", import.meta.url)),
  directory = fixture.directory;
assertPhase16Ownership({
  resolvedDirectory: await realpath(directory),
  symbolicLink: (await lstat(directory)).isSymbolicLink(),
  marker: JSON.parse(await readFile(path.join(directory, fixture.markerFile), "utf8")),
  activePorts: [],
});
function refuseClean() {
  let refused = false;
  try {
    execFileSync(
      process.execPath,
      [path.join(root, "scripts/phase16-runtime.mjs"), "clean", "--confirm-phase16"],
      { cwd: root, env: isolatedEnvironment(process.env), stdio: "pipe", windowsHide: true },
    );
  } catch (error) {
    refused = error.status === 1;
  }
  assert.ok(refused, "Unsafe cleanup was not refused");
}
if (process.argv.includes("--stopped")) {
  assert.equal(
    await lstat(path.join(directory, "runtime-lock.json")).catch(() => null),
    null,
    "Stop owned services before safety probes",
  );
  const marker = path.join(directory, fixture.markerFile),
    backup = path.join(directory, "marker-safety-backup.json");
  assert.equal(await lstat(backup).catch(() => null), null);
  await rename(marker, backup);
  try {
    refuseClean();
    assert.ok(await lstat(directory));
  } finally {
    await rename(backup, marker);
  }
  const target = path.join(directory, "safety-target"),
    link = path.join(directory, "safety-link");
  assert.equal(await lstat(target).catch(() => null), null);
  assert.equal(await lstat(link).catch(() => null), null);
  await mkdir(target);
  try {
    await symlink(target, link, "junction");
    try {
      refuseClean();
      assert.ok(await lstat(marker));
    } finally {
      await unlink(link);
    }
  } finally {
    await rmdir(target);
  }
  await writeFile(
    path.join(directory, "cleanup-safety-evidence.json"),
    JSON.stringify({ unmarkedRefused: true, linkedContentRefused: true, stateRetained: true }),
    { mode: 0o600 },
  );
  console.info(
    "Phase 16 stopped cleanup safety PASS: unmarked and unexpected linked paths refused; evidence retained.",
  );
  process.exit(0);
}
const environment = JSON.parse(await readFile(path.join(directory, "runtime.env.json"), "utf8"));
const seed = JSON.parse(await readFile(path.join(directory, "seed.json"), "utf8"));
assert.equal(environment.OPENAI_API_KEY, "");
const { Client } = createRequire(path.join(root, "packages/db/package.json"))("pg");
const db = new Client({ connectionString: environment.DATABASE_URL });
await db.connect();
try {
  const facts = (
    await db.query(`SELECT p.id,p.name,
    (SELECT count(*) FROM enough.activity_events a WHERE a.product_id=p.id)::text AS activity,
    (SELECT count(*) FROM enough.integration_events e WHERE e.product_id=p.id)::text AS signals,
    (SELECT count(*) FROM enough.growth_task_completions c WHERE c.product_id=p.id)::text AS completions,
    (SELECT md5(string_agg(currency||':'||amount_minor::text,',' ORDER BY e.id)) FROM enough.integration_events e WHERE e.product_id=p.id) AS payment_fingerprint,
    (SELECT count(*) FROM enough.credit_transactions t JOIN enough.credit_accounts w ON w.id=t.account_id WHERE w.product_id=p.id)::text AS ledger
    FROM enough.products p ORDER BY p.id`)
  ).rows;
  const proof = JSON.parse(await readFile(path.join(directory, "seed-proof.json"), "utf8"));
  assert.equal(
    createHash("sha256").update(JSON.stringify(facts)).digest("hex"),
    proof.fingerprint,
    "Restart changed synthetic report facts",
  );
  assert.equal((await fetch(`${environment.APP_BASE_URL}/reports`)).status, 200);
  const response = await fetch(
    `${environment.APP_BASE_URL}/api/reports?productId=${seed.products[0].id}&days=7`,
    {
      headers: { cookie: `enough_session=${seed.accounts[0].session.token}` },
    },
  );
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.product.id, seed.products[0].id);
  assert.equal(report.days.length, 7);
  assert.ok(
    report.days.every(
      (day) => day.activityEvents === 0 && day.marketSignals === 0 && day.tasksCompleted === 0,
    ),
  );
  // Actual CLI negative paths: both must refuse without removing any evidence.
  for (const args of [
    ["clean", "--confirm-phase16"],
    ["clean", "--confirm-phase16", "--root", "unexpected-root"],
  ]) {
    let refused = false;
    try {
      execFileSync(process.execPath, [path.join(root, "scripts/phase16-runtime.mjs"), ...args], {
        cwd: root,
        env: isolatedEnvironment(process.env),
        stdio: "pipe",
        windowsHide: true,
      });
    } catch (error) {
      refused = error.status === 1;
    }
    assert.ok(refused, "Unsafe cleanup was not refused");
    assert.equal((await lstat(path.join(directory, fixture.markerFile))).isFile(), true);
  }
  assert.equal((await readFile(path.join(directory, "egress-blocked.log"), "utf8")).trim(), "");
  await writeFile(
    path.join(directory, "restart-evidence.json"),
    JSON.stringify({
      preservedFacts: true,
      httpReady: true,
      activeCleanRefused: true,
      alternateRootRefused: true,
    }),
    { mode: 0o600 },
  );
  console.info(
    "Phase 16 restart PASS: source/API/web ready, report facts preserved, active/alternate-root cleanup refused, provider connections=0.",
  );
} finally {
  await db.end();
}
