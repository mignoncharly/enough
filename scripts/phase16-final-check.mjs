// Read-only closure check. Seed SQL is intercepted and evaluated as SELECTs;
// no seed writer, session issuer, DELETE, INSERT or UPDATE reaches PostgreSQL.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { assertPhase16Ownership, phase16Fixture as fixture } from "./phase16-fixture-plan.mjs";

let db;
try {
  const directory = fixture.directory;
  assertPhase16Ownership({
    resolvedDirectory: await realpath(directory),
    symbolicLink: (await lstat(directory)).isSymbolicLink(),
    marker: JSON.parse(await readFile(path.join(directory, fixture.markerFile), "utf8")),
    activePorts: [],
  });
  const json = async (name) => JSON.parse(await readFile(path.join(directory, name), "utf8"));
  const env = await json("runtime.env.json");
  const target = new URL(env.DATABASE_URL);
  assert.deepEqual(
    [target.hostname, target.port, target.pathname, target.username],
    [fixture.host, String(fixture.ports.postgres), `/${fixture.database}`, fixture.role],
  );
  assert.equal(env.OPENAI_API_KEY, "");
  assert.equal(await lstat(path.join(directory, "query-control.json")).catch(() => null), null);
  const { Client } = createRequire(new URL("../packages/db/package.json", import.meta.url))("pg");
  db = new Client({ connectionString: env.DATABASE_URL });
  await db.connect();
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal((await db.query("SHOW transaction_read_only")).rows[0].transaction_read_only, "on");
  const seed = await json("seed.json");
  const expected = new Map();
  const literal = (value) =>
    value === null
      ? "NULL"
      : `'${(value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value)).replaceAll("'", "''")}'`;
  const pool = {
    async query(sql, args = []) {
      if (sql.startsWith("SELECT")) return db.query(sql, args);
      if (sql.startsWith("DELETE FROM enough.auth_users")) return { rows: [] };
      if (/INSERT INTO enough.auth_users/.test(sql)) return { rows: [] };
      if (sql.startsWith("UPDATE enough.credit_accounts")) {
        Object.assign(
          expected.get("credit_accounts").find((row) => row.id === args[0]),
          {
            available_balance: args[1],
            reserved_balance: args[2],
          },
        );
        return { rows: [] };
      }
      if (sql.startsWith("UPDATE enough.integration_events")) {
        Object.assign(
          expected.get("integration_events").find((row) => row.id === args[0]),
          {
            completion_id: args[1],
            task_id: args[2],
            evidence_id: args[3],
          },
        );
        return { rows: [] };
      }
      const match = sql.match(/^\s*INSERT INTO enough\.(\w+)\s*\(([^)]+)\)\s*([\s\S]+)$/);
      assert.ok(match, "Unrecognized seed statement; review read-only checker");
      const [, table, columns, expression] = match;
      const bound = expression.replace(/\$(\d+)/g, (_, n) => literal(args[Number(n) - 1]));
      const rows = (
        await db.query(
          `WITH expected(${columns}) AS (${bound}) SELECT row_to_json(expected) AS row FROM expected`,
        )
      ).rows.map((item) => item.row);
      if (!expected.has(table)) expected.set(table, []);
      expected.get(table).push(...rows);
      return { rows: [] };
    },
    async end() {},
  };
  // Run the current deterministic scenario specification in memory. Imports,
  // fixture assertions/configuration, private file writes and auth are replaced.
  const source = await readFile(new URL("./phase16-seed.mjs", import.meta.url), "utf8");
  const body = source
    .slice(source.indexOf("export const id ="))
    .replace("export const id =", "const id =");
  let seedFailed = false;
  const run = new (Object.getPrototypeOf(async () => {}).constructor)(
    "assert",
    "createHash",
    "randomBytes",
    "writeFile",
    "path",
    "fixture",
    "pool",
    "createSession",
    "hashPassword",
    "process",
    "console",
    body,
  );
  await run(
    assert,
    createHash,
    randomBytes,
    async () => {},
    path,
    fixture,
    pool,
    async () => ({}),
    async () => "synthetic-unused",
    {
      env: { ENOUGH_PHASE16_NOW: seed.anchor },
      set exitCode(_) {
        seedFailed = true;
      },
    },
    {
      info() {},
      error() {
        seedFailed = true;
      },
    },
  );
  assert.equal(seedFailed, false, "Seed specification replay failed");
  const tables = {};
  for (const [table, rows] of expected) {
    const result = await db.query(`SELECT to_jsonb(t) AS row FROM enough.${table} t`);
    assert.equal(result.rows.length, rows.length, `Unexpected ${table} row count`);
    // Cast through the table's real types, preserving bigint/numeric exactness.
    const normalized = await db.query(
      `SELECT to_jsonb(t) AS row FROM jsonb_populate_recordset(NULL::enough.${table},$1::jsonb) t`,
      [JSON.stringify(rows)],
    );
    const key = (row) => row.id ?? `${row.product_id}/${row.event_type}/${row.bucket_start}`;
    const actual = new Map(result.rows.map(({ row }) => [key(row), row]));
    for (let i = 0; i < rows.length; i++) {
      const want = normalized.rows[i].row;
      const got = actual.get(key(want));
      assert.ok(got, `Missing ${table} row`);
      for (const column of Object.keys(rows[i])) {
        if (
          typeof rows[i][column] === "string" &&
          ["attributes", "provenance"].includes(column) &&
          rows[i][column].startsWith("{")
        )
          want[column] = JSON.parse(rows[i][column]);
        try {
          assert.deepEqual(got[column], want[column]);
        } catch {
          throw new Error(`Changed ${table}.${column}`);
        }
      }
    }
    tables[table] = rows.length;
  }
  const facts = (
    await db.query(`SELECT p.id,p.name,
    (SELECT count(*) FROM enough.activity_events a WHERE a.product_id=p.id)::text AS activity,
    (SELECT count(*) FROM enough.integration_events e WHERE e.product_id=p.id)::text AS signals,
    (SELECT count(*) FROM enough.growth_task_completions c WHERE c.product_id=p.id)::text AS completions,
    (SELECT md5(string_agg(currency||':'||amount_minor::text,',' ORDER BY e.id)) FROM enough.integration_events e WHERE e.product_id=p.id) AS payment_fingerprint,
    (SELECT count(*) FROM enough.credit_transactions t JOIN enough.credit_accounts w ON w.id=t.account_id WHERE w.product_id=p.id)::text AS ledger
    FROM enough.products p ORDER BY p.id`)
  ).rows;
  const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  assert.equal(hash(facts), (await json("seed-proof.json")).fingerprint);
  // Range fingerprints cover every seeded input column used by reports. Pass 2
  // retained a seed-fact hash, not serialized responses for every product/range.
  const ranges = [];
  for (const product of seed.products)
    for (const days of [7, 30, 90]) {
      const end = new Date(seed.anchor),
        start = new Date(end);
      start.setUTCHours(0, 0, 0, 0);
      start.setUTCDate(start.getUTCDate() - days + 1);
      const inputs = {};
      for (const [table, rows] of expected) {
        const date = {
          activity_events: "effective_at",
          integration_events: "occurred_at",
          credit_transactions: "created_at",
          growth_task_completions: "completed_at",
        }[table];
        inputs[table] = rows.filter((row) => {
          const scoped =
            row.product_id === product.id ||
            (table === "credit_transactions" &&
              expected
                .get("credit_accounts")
                .some((w) => w.product_id === product.id && w.id === row.account_id));
          return scoped && (!date || (new Date(row[date]) >= start && new Date(row[date]) < end));
        });
      }
      ranges.push({ productId: product.id, days, fingerprint: hash(inputs) });
    }
  await db.query("ROLLBACK");
  const acceptance = await json("report-acceptance.json");
  assert.equal(acceptance.directTruthReports, 93);
  assert.equal(acceptance.providerCalls, 0);
  assert.equal((await readFile(path.join(directory, "egress-blocked.log"), "utf8")).trim(), "");
  const evidence = {
    readOnly: true,
    seedFingerprintMatch: true,
    allSpecifiedSeedColumnsMatch: true,
    tables,
    productRanges: ranges,
    queryControlsAbsent: true,
    pass2DirectTruthReports: 93,
  };
  await writeFile(path.join(directory, "final-read-only-evidence.json"), JSON.stringify(evidence), {
    mode: 0o600,
  });
  console.info(
    `Phase 16 final read-only PASS: ${Object.keys(tables).length} tables; ${ranges.length} product/range fingerprints; seed proof unchanged; no report-data mutation; query controls absent.`,
  );
} catch (error) {
  console.error(
    JSON.stringify({
      category: "P16_FINAL_CHECK_FAILED",
      code: error.code,
      source: error.stack?.match(/phase16-final-check\.mjs:\d+:\d+/g),
    }),
  );
  if (/^Changed \w+\.\w+$/.test(error.message)) console.error(error.message);
  console.error("Phase 16 final read-only check failed; private details withheld.");
  process.exitCode = 1;
} finally {
  if (db) await db.end().catch(() => {});
}
