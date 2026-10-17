// Bounded login diagnosis: secrets stay in memory; output is safe metadata only.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import {
  assertPhase16Ownership,
  phase16Fixture as fixture,
  phase16Environment,
} from "./phase16-fixture-plan.mjs";

let db, redis;
try {
  assertPhase16Ownership({
    resolvedDirectory: await realpath(fixture.directory),
    symbolicLink: (await lstat(fixture.directory)).isSymbolicLink(),
    marker: JSON.parse(await readFile(path.join(fixture.directory, fixture.markerFile), "utf8")),
    activePorts: [],
  });
  async function json(name) {
    const file = path.join(fixture.directory, name);
    assert.equal((await lstat(file)).isSymbolicLink(), false);
    return JSON.parse(await readFile(file, "utf8"));
  }
  const env = await json("runtime.env.json"),
    credentials = await json("credentials.json"),
    manual = await json("manual-account.json"),
    seed = await json("seed.json");
  const expected = phase16Environment(process.env, credentials);
  for (const name of [
    "AUTH_SECRET",
    "DATABASE_URL",
    "REDIS_URL",
    "APP_BASE_URL",
    "API_BASE_URL",
    "OPENAI_API_KEY",
  ])
    assert.equal(env[name] === expected[name], true, "Runtime configuration mismatch");
  assert.equal(env.OPENAI_API_KEY, "");
  const { Client } = createRequire(new URL("../packages/db/package.json", import.meta.url))("pg");
  const Redis = createRequire(new URL("../packages/cache/package.json", import.meta.url))(
    "ioredis",
  );
  db = new Client({ connectionString: env.DATABASE_URL });
  await db.connect();
  redis = new Redis(env.REDIS_URL, { lazyConnect: true, retryStrategy: null });
  redis.on("error", () => {});
  await redis.connect();
  assert.equal(await redis.ping(), "PONG");
  const account = (
    await db.query(
      `SELECT id, email_verified_at IS NOT NULL AS verified,
    password_hash IS NOT NULL AND length(password_hash)>0 AS password_present
    FROM enough.auth_users WHERE email_normalized=$1`,
      [manual.email.toLowerCase()],
    )
  ).rows;
  assert.equal(account.length, 1);
  assert.equal(account[0].id === seed.accounts[0].id, true);
  assert.equal(account[0].verified && account[0].password_present, true);
  const sessions = (
    await db.query(
      `SELECT count(*)::int AS active FROM enough.auth_sessions s
    JOIN enough.auth_devices d ON d.id=s.device_id WHERE s.user_id=$1
    AND s.revoked_at IS NULL AND d.revoked_at IS NULL AND s.expires_at>clock_timestamp()`,
      [account[0].id],
    )
  ).rows[0];
  assert.ok(sessions.active > 0);
  console.info(
    "Phase 16 account verified/password record present/active session present; PostgreSQL and Redis ready; retained runtime configuration matches generated credentials.",
  );
  const base = env.APP_BASE_URL;
  assert.equal((await fetch(`${base}/login`)).status, 200);
  const csrf = await fetch(`${base}/api/auth/csrf`);
  assert.equal(csrf.status, 200);
  const preCookie = csrf.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const { csrfToken } = await csrf.json();
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: base,
      cookie: preCookie,
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify({ email: manual.email, password: manual.password, clientType: "web" }),
  });
  if (process.argv.includes("--expect-session-failure")) {
    assert.equal(login.status, 500);
    console.info(
      "Phase 16 reproduction: GET /login=200; CSRF=200; POST login=500 at session creation (server-side constraint diagnosis recorded separately).",
    );
  } else {
    assert.equal(login.status, 200);
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    for (const route of ["/api/auth/me", "/api/auth/sessions", "/api/auth/devices", "/reports"])
      assert.equal((await fetch(`${base}${route}`, { headers: { cookie } })).status, 200);
    const reportResponse = await fetch(
      `${base}/api/reports?productId=${seed.products[0].id}&days=7`,
      { headers: { cookie } },
    );
    assert.equal(reportResponse.status, 200);
    const report = await reportResponse.json();
    assert.equal(report.product.id === seed.products[0].id, true);
    assert.equal(report.days.length, 7);
    assert.equal(report.days.at(-1).day, "2024-03-01");
    const facts = (
      await db.query(`SELECT p.id,p.name,
      (SELECT count(*) FROM enough.activity_events a WHERE a.product_id=p.id)::text AS activity,
      (SELECT count(*) FROM enough.integration_events e WHERE e.product_id=p.id)::text AS signals,
      (SELECT count(*) FROM enough.growth_task_completions c WHERE c.product_id=p.id)::text AS completions,
      (SELECT md5(string_agg(currency||':'||amount_minor::text,',' ORDER BY e.id)) FROM enough.integration_events e WHERE e.product_id=p.id) AS payment_fingerprint,
      (SELECT count(*) FROM enough.credit_transactions t JOIN enough.credit_accounts w ON w.id=t.account_id WHERE w.product_id=p.id)::text AS ledger
      FROM enough.products p ORDER BY p.id`)
    ).rows;
    assert.equal(
      createHash("sha256").update(JSON.stringify(facts)).digest("hex") ===
        (await json("seed-proof.json")).fingerprint,
      true,
    );
    assert.equal(
      (await readFile(path.join(fixture.directory, "egress-blocked.log"), "utf8")).trim(),
      "",
    );
    console.info(
      "Phase 16 login PASS: original account authenticated once; session/me/devices/reports=200; historical report clock preserved; retained seed fingerprint unchanged; external attempts=0.",
    );
  }
} catch {
  console.error("Phase 16 bounded login check failed; private diagnostics withheld.");
  process.exitCode = 1;
} finally {
  if (redis) redis.disconnect();
  if (db) await db.end().catch(() => {});
}
