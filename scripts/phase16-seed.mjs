import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { phase16Fixture as fixture } from "./phase16-fixture-plan.mjs";

assert.equal(process.env.ENOUGH_PHASE16_RUNTIME, "1");
assert.equal(process.env.OPENAI_API_KEY, "");
const url = new URL(process.env.DATABASE_URL);
assert.deepEqual(
  [url.hostname, url.port, url.pathname, url.username],
  [fixture.host, String(fixture.ports.postgres), `/${fixture.database}`, fixture.role],
);
const { pool } = await import("../packages/db/src/index.ts");
const { createSession } = await import("../packages/auth/src/session.ts");
const { hashPassword } = await import("../packages/auth/src/crypto.ts");
export const id = (n) => `16000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const anchor = new Date(process.env.ENOUGH_PHASE16_NOW);
const at = (seconds) => new Date(anchor.getTime() + seconds * 1000);
const hash = (text) => createHash("sha256").update(text).digest("hex");
let sequence = 10000;
const next = () => id(sequence++);
const names = {
  10: "Product Empty",
  11: "Product Single Currency",
  12: "Product Multi Currency",
  13: "Product Mixed Verification",
  14: "Product UTC Boundary / Focus",
  15: `Product Volume - ${"long synthetic label for narrow report selector ".repeat(4)}`,
  16: "Product Build Only",
  17: "Product Grow Only",
  18: "Product Refund Only",
  19: "Product Adjustment Only",
  20: "Product Spent Only",
  21: "Product Earned Only",
  22: "Product Linked Funnels",
  23: "Product Numeric Safety",
  90: "Foreign Owner Product",
};
const owner = (p) => (p === 90 ? id(2) : id(1));
async function activity(p, date, attrs = {}, type = "focus.session_ended") {
  const event = next();
  await pool.query(
    `INSERT INTO enough.activity_events
    (id,user_id,product_id,client_event_id,event_type,client_sequence,client_occurred_at,effective_at,attributes,event_hash,batch_id)
    VALUES($1,$2,$3,$1,$4,$5,$6,$6,$7,$8,$1)`,
    [event, owner(p), id(p), type, sequence, date, attrs, hash(event)],
  );
}
async function signal(p, type, date = at(-3600), options = {}) {
  const event = next();
  await pool.query(
    `INSERT INTO enough.integration_events
    (id,integration_account_id,user_id,product_id,provider_event_id,event_type,user_reference_hash,amount_minor,currency,occurred_at,payload_hash,verification_status,provider_origin_verified)
    VALUES($1,$2,$3,$4,$13,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      event,
      id(300 + p),
      owner(p),
      id(p),
      type,
      options.link ? hash(options.link) : null,
      options.amount ?? null,
      options.currency ?? null,
      date,
      hash(event),
      options.rejected ? "REJECTED" : "AUTHENTICATED",
      options.provider ?? false,
      event,
    ],
  );
  return event;
}
const balances = new Map();
async function ledger(p, action, amount, date = at(-3600), adjustment = amount) {
  const wallet = p === null ? id(999) : id(500 + p);
  const user = p === null ? id(1) : owner(p);
  const balance = balances.get(wallet) ?? { available: 0, reserved: 0 };
  const delta =
    action === "SPEND" || action === "RESERVE"
      ? -amount
      : action === "EXPIRE"
        ? 0
        : action === "ADJUST"
          ? adjustment
          : amount;
  const reserved = action === "RESERVE" ? amount : action === "RELEASE" ? -amount : 0;
  balance.available += delta;
  balance.reserved += reserved;
  const event = next();
  await pool.query(
    `INSERT INTO enough.credit_transactions
    (id,account_id,user_id,action,amount,available_delta,reserved_delta,balance_after_available,balance_after_reserved,idempotency_key,request_hash,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$12,$10,$11)`,
    [
      event,
      wallet,
      user,
      action,
      amount,
      delta,
      reserved,
      balance.available,
      balance.reserved,
      hash(event),
      date,
      event,
    ],
  );
  balances.set(wallet, balance);
  await pool.query(
    "UPDATE enough.credit_accounts SET available_balance=$2,reserved_balance=$3 WHERE id=$1",
    [wallet, balance.available, balance.reserved],
  );
}
async function task(p, status, n) {
  const taskId = next(),
    completion = next();
  const reviewed = ["VERIFIED", "AUTOMATICALLY_VERIFIED", "REJECTED"].includes(status);
  await pool.query(
    `INSERT INTO enough.growth_tasks (id,user_id,product_id,series_id,title,status,completed_at,reward_credits,signal_strength)
    VALUES($1,$2,$3,$1,$4,'COMPLETED',$5,0,$6)`,
    [
      taskId,
      owner(p),
      id(p),
      `Synthetic task ${n} ${status} ${p === 13 ? "with a deliberately long readable task label for the report review" : ""}`,
      at(-3600),
      (n % 5) + 1,
    ],
  );
  await pool.query(
    `INSERT INTO enough.growth_task_completions
    (id,task_id,product_id,user_id,verification_status,reward_credits,completed_at,reviewed_at,reviewed_by_user_id)
    VALUES($1,$2,$3,$4,$5,0,$6,$7,$8)`,
    [
      completion,
      taskId,
      id(p),
      owner(p),
      status,
      at(-3600),
      reviewed ? at(-1800) : null,
      reviewed && status !== "AUTOMATICALLY_VERIFIED" ? owner(p) : null,
    ],
  );
  if (status !== "AWAITING_EVIDENCE") {
    const automatic = status === "AUTOMATICALLY_VERIFIED";
    const evidenceId = next();
    await pool.query(
      `INSERT INTO enough.task_evidence_items
      (id,completion_id,task_id,product_id,user_id,evidence_type,title,note,integration_provider,integration_reference,verification_status,reviewed_at,reviewed_by_user_id,verification_method,provenance)
      VALUES($1,$2,$3,$4,$5,$6,'Synthetic evidence',$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        evidenceId,
        completion,
        taskId,
        id(p),
        owner(p),
        automatic ? "INTEGRATION" : "NOTE",
        automatic ? null : "P16_PRIVATE_EVIDENCE_CANARY",
        automatic ? "stripe" : null,
        automatic ? `synthetic-reference-${n}` : null,
        status === "REJECTED" ? "REJECTED" : reviewed ? "VERIFIED" : "PENDING",
        reviewed ? at(-1800) : null,
        reviewed && !automatic ? owner(p) : null,
        automatic ? "AUTOMATIC" : "MANUAL",
        automatic ? "SERVER_VERIFIED" : "USER_SUBMITTED",
      ],
    );
    if (automatic) {
      const event = await signal(p, "revenue.payment_received", at(-3600), {
        amount: 100,
        currency: "EUR",
        provider: true,
      });
      await pool.query(
        "UPDATE enough.integration_events SET completion_id=$2,task_id=$3,evidence_id=$4 WHERE id=$1",
        [event, completion, taskId, evidenceId],
      );
    }
  }
}
try {
  assert.deepEqual((await pool.query("SELECT current_user,current_database()")).rows[0], {
    current_user: fixture.role,
    current_database: fixture.database,
  });
  // Reproduction is explicit and confined to deterministic synthetic owners in this DB.
  await pool.query("DELETE FROM enough.auth_users WHERE id=ANY($1::uuid[])", [
    [id(1), id(2), id(3)],
  ]);
  const password = `P16-${randomBytes(20).toString("hex")}!`;
  const passwordHash = await hashPassword(password);
  for (const n of [1, 2, 3])
    await pool.query(
      `INSERT INTO enough.auth_users
    (id,email,email_normalized,email_verified_at,password_hash) VALUES($1,$2,$2,now(),$3)`,
      [id(n), `phase16-account-${n}@example.test`, passwordHash],
    );
  for (const [key, name] of Object.entries(names)) {
    const p = Number(key);
    await pool.query(
      `INSERT INTO enough.products
      (id,user_id,name,target_customer,problem_statement,product_stage,has_launched,user_count,paying_user_count,current_revenue,revenue_currency)
      VALUES($1,$2,$3,'Synthetic teams','Synthetic reporting workflow','EARLY_USERS',true,$4,$5,$6,'GBP')`,
      [id(p), owner(p), name, p === 10 ? 0 : 42, p === 10 ? 0 : 7, p === 10 ? null : "1234.56"],
    );
    await pool.query("INSERT INTO enough.credit_accounts(id,user_id,product_id) VALUES($1,$2,$3)", [
      id(500 + p),
      owner(p),
      id(p),
    ]);
    if (p !== 10) {
      await pool.query(
        `INSERT INTO enough.integration_accounts(id,user_id,product_id,provider,display_name)
        VALUES($1,$2,$3,'STRIPE','Synthetic normalized source; no connection')`,
        [id(300 + p), owner(p), id(p)],
      );
      await ledger(p, "EARN", 10000, new Date("2023-01-01T00:00:00Z"));
    }
  }
  await pool.query("INSERT INTO enough.credit_accounts(id,user_id) VALUES($1,$2)", [
    id(999),
    id(1),
  ]);
  await ledger(null, "EARN", 9000);
  await activity(11, at(-3600), { mode: "BUILD", duration_seconds: 3600 });
  await activity(11, at(-3500), { mode: "GROWTH", duration_seconds: 1800 });
  for (const type of [
    "email.outreach_sent",
    "email.reply_received",
    "calendar.interview_completed",
    "calendar.demo_completed",
    "calendar.feedback_call_completed",
    "calendar.sales_call_completed",
    "calendar.onboarding_completed",
    "calendar.retention_call_completed",
    "analytics.user_signup",
    "analytics.user_activated",
    "analytics.user_retained",
  ])
    await signal(11, type);
  await signal(11, "revenue.payment_received", at(-3600), {
    amount: 12345,
    currency: "EUR",
    provider: true,
  });
  await signal(11, "revenue.payment_received", at(-3500), { amount: 0, currency: "EUR" });
  await ledger(11, "EARN", 20);
  await ledger(11, "SPEND", 7);
  await ledger(11, "REFUND", 3);
  await ledger(11, "ADJUST", 2, at(-3600), -2);
  await ledger(11, "RESERVE", 2);
  await ledger(11, "RELEASE", 2);
  await ledger(11, "EXPIRE", 0);
  await task(11, "VERIFIED", 1);
  await task(11, "AWAITING_REVIEW", 2);
  for (const [currency, amount] of [
    ["EUR", 12345],
    ["JPY", 12345],
    ["KWD", 12345],
    ["EUR", 0],
    ["ZZZ", 123],
  ])
    await signal(12, "revenue.payment_received", at(-3600), { currency, amount });
  await signal(12, "revenue.payment_received"); // Signal without an amount.
  await signal(12, "revenue.payment_refunded", at(-3600), { currency: "EUR", amount: 50 }); // Excluded type, never negative.
  await pool.query(
    `INSERT INTO enough.integration_events
    (id,integration_account_id,user_id,product_id,provider_event_id,event_type,amount_minor,currency,occurred_at,payload_hash)
    SELECT md5('p16-money-'||i)::uuid,$1,$2,$3,'synthetic-money-'||i,'revenue.payment_received',
      LEAST(1000000000000::numeric,9007199254740991::numeric-(i-1)*1000000000000::numeric)::bigint,'USD',$4,md5(i::text)||md5(i::text)
    FROM generate_series(1,9008) i`,
    [id(312), id(1), id(12), at(-3600)],
  );
  for (const [n, status] of [
    "AWAITING_EVIDENCE",
    "AWAITING_REVIEW",
    "VERIFIED",
    "AUTOMATICALLY_VERIFIED",
    "SELF_REPORTED",
    "REJECTED",
  ].entries())
    await task(13, status, n);
  const boundaryDates = [];
  for (const days of [7, 30, 90]) {
    const start = new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - (days - 1)),
    );
    boundaryDates.push(new Date(start.getTime() - 1), start);
  }
  boundaryDates.push(
    new Date("2024-02-29T23:59:59Z"),
    new Date("2024-03-01T00:00:00Z"),
    at(-0.001),
    anchor,
    at(0.001),
  );
  for (const [n, date] of boundaryDates.entries()) {
    await activity(14, date, { mode: n % 2 ? "BUILD" : "GROWTH", duration_seconds: 60 });
    await signal(14, "email.reply_received", date);
  }
  for (const attrs of [
    { duration_seconds: -1, mode: "BUILD" },
    { duration_seconds: 2.5, mode: "BUILD" },
    { duration_seconds: 21601, mode: "BUILD" },
    { duration_seconds: "bad", mode: "BUILD" },
    { duration_seconds: { bad: 1 }, mode: "GROWTH" },
    { duration_seconds: 10, mode: "invalid" },
    {},
  ])
    await activity(14, at(-7200), attrs);
  await activity(16, at(-3600), { mode: "BUILD", duration_seconds: 3600 });
  await activity(17, at(-3600), { mode: "GROWTH", duration_seconds: 3600 });
  await ledger(18, "REFUND", 5);
  await ledger(19, "ADJUST", 4, at(-3600), -4);
  await ledger(20, "SPEND", 6);
  await ledger(21, "EARN", 8);
  await ledger(90, "EARN", 777);
  await activity(90, at(-3600), { mode: "BUILD", duration_seconds: 21600 });
  await signal(90, "revenue.payment_received", at(-3600), { amount: 999999, currency: "EUR" });
  // Three funnels, same-source hashes; unlinked/rejected/foreign records cannot improve them.
  for (const [link, types] of [
    [
      "person-a",
      [
        "email.outreach_sent",
        "email.reply_received",
        "calendar.demo_completed",
        "analytics.user_signup",
        "revenue.payment_received",
      ],
    ],
    ["person-b", ["email.outreach_sent", "calendar.demo_completed", "analytics.user_signup"]],
  ]) {
    for (const [n, type] of types.entries()) await signal(22, type, at(-7200 + n * 60), { link });
  }
  for (const type of [
    "email.reply_received",
    "analytics.user_signup",
    "revenue.subscription_created",
  ])
    await signal(22, type);
  await signal(22, "email.reply_received", at(-3000), { link: "person-b", rejected: true });
  await signal(22, "analytics.user_churned");
  // Representative bounded volume. Raw duration records intentionally differ from rollups/metering.
  await pool.query(
    `INSERT INTO enough.activity_events
    (id,user_id,product_id,client_event_id,event_type,client_sequence,client_occurred_at,effective_at,attributes,event_hash,batch_id)
    SELECT md5('p16-volume-'||i)::uuid,$1,$2,md5('p16-volume-'||i)::uuid,'focus.session_ended',i,$3,$3,
      jsonb_build_object('mode',CASE WHEN i%2=0 THEN 'BUILD' ELSE 'GROWTH' END,'duration_seconds',60),md5(i::text)||md5(i::text),md5('p16-batch')::uuid
    FROM generate_series(1,10000) i`,
    [id(1), id(15), at(-3600)],
  );
  await pool.query(
    `INSERT INTO enough.activity_event_aggregates(product_id,event_type,bucket_start,event_count,last_event_at)
    VALUES($1,'focus.session_ended',$2,999999,$2)`,
    [id(15), at(-3600)],
  );
  await pool.query(
    `INSERT INTO enough.integration_events
    (id,integration_account_id,user_id,product_id,provider_event_id,event_type,occurred_at,payload_hash)
    SELECT md5('p16-signal-'||i)::uuid,$1,$2,$3,'synthetic-signal-'||i,
      CASE WHEN i%2=0 THEN 'email.reply_received' ELSE 'analytics.user_signup' END,$4,md5(i::text)||md5(i::text)
    FROM generate_series(1,2000) i`,
    [id(315), id(1), id(15), at(-3600)],
  );
  for (let n = 0; n < 200; n++) await task(15, n % 2 ? "AWAITING_REVIEW" : "VERIFIED", n);
  for (let n = 0; n < 500; n++)
    await ledger(15, ["EARN", "SPEND", "REFUND", "ADJUST"][n % 4], (n % 10) + 1);
  for (let n = 0; n < 50; n++) {
    const reservation = next();
    await pool.query(
      `INSERT INTO enough.credit_reservations(id,account_id,user_id,status,amount,remaining_amount)
      VALUES($1,$2,$3,'SPENT',1,0)`,
      [reservation, id(515), id(1)],
    );
    await pool.query(
      `INSERT INTO enough.build_sessions
      (id,account_id,user_id,product_id,reservation_id,status,reserved_minutes,active_milliseconds,last_heartbeat_at,expires_at,ended_at)
      VALUES($1,$2,$3,$4,$5,'COMPLETED',1,60000,$6,$7,$6)`,
      [next(), id(515), id(1), id(15), reservation, at(-3600), at(3600)],
    );
  }
  for (const [n, reason, date] of [
    [1, null, "2023-01-01T00:00:00Z"],
    [2, "Synthetic persisted stage reason", "2024-03-01T00:00:01Z"],
  ])
    await pool.query(
      `INSERT INTO enough.product_stage_history(id,product_id,from_stage,to_stage,change_reason,changed_by,changed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        next(),
        id(11),
        n === 1 ? null : "IDEA",
        n === 1 ? "IDEA" : "EARLY_USERS",
        reason,
        id(1),
        date,
      ],
    );
  await pool.query(
    `INSERT INTO enough.product_stage_history(id,product_id,to_stage,change_reason,changed_at)
    VALUES($1,$2,'IDEA','Foreign history excluded',$3)`,
    [next(), id(90), at(-100)],
  );
  const accounts = [];
  for (const n of [1, 2, 3])
    accounts.push({
      id: id(n),
      email: `phase16-account-${n}@example.test`,
      session: await createSession(
        id(n),
        "web",
        "Synthetic Phase 16 browser acceptance",
        "password",
      ),
    });
  await writeFile(
    path.join(fixture.directory, "seed.json"),
    JSON.stringify({
      fixture: fixture.owner,
      version: 1,
      anchor: anchor.toISOString(),
      accounts,
      products: Object.entries(names).map(([n, name]) => ({
        id: id(Number(n)),
        name,
        owner: owner(Number(n)),
      })),
      counts: {
        volumeActivity: 10000,
        volumeSignals: 2000,
        volumeTasks: 200,
        volumeLedger: 500,
        volumeSessions: 50,
      },
      canaries: ["P16_PRIVATE_EVIDENCE_CANARY"],
    }),
    { mode: 0o600 },
  );
  await writeFile(
    path.join(fixture.directory, "manual-account.json"),
    JSON.stringify({ email: accounts[0].email, password, noProductsEmail: accounts[2].email }),
    { mode: 0o600 },
  );
  const facts = (
    await pool.query(`SELECT p.id,p.name,
    (SELECT count(*) FROM enough.activity_events a WHERE a.product_id=p.id)::text AS activity,
    (SELECT count(*) FROM enough.integration_events e WHERE e.product_id=p.id)::text AS signals,
    (SELECT count(*) FROM enough.growth_task_completions c WHERE c.product_id=p.id)::text AS completions,
    (SELECT md5(string_agg(currency||':'||amount_minor::text,',' ORDER BY e.id)) FROM enough.integration_events e WHERE e.product_id=p.id) AS payment_fingerprint,
    (SELECT count(*) FROM enough.credit_transactions t JOIN enough.credit_accounts w ON w.id=t.account_id WHERE w.product_id=p.id)::text AS ledger
    FROM enough.products p ORDER BY p.id`)
  ).rows;
  // Hash ordered currency/amount pairs, never add unlike currencies.
  await writeFile(
    path.join(fixture.directory, "seed-proof.json"),
    JSON.stringify({ fingerprint: hash(JSON.stringify(facts)), products: facts.length }),
    { mode: 0o600 },
  );
  console.info(
    "Phase 16 deterministic synthetic seed ready; private sign-in material stays in the owned TEMP root.",
  );
} catch (error) {
  console.error(
    JSON.stringify({
      category: "P16_SEED_FAILED",
      code: error.code,
      source: error.stack?.match(/phase16-seed\.mjs:\d+:\d+/g),
      table: error.table,
      column: error.column,
      constraint: error.constraint,
    }),
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
