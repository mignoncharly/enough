import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { phase15Fixture as fixture } from "./phase15-fixture-plan.mjs";

assert.equal(process.env.ENOUGH_PHASE15_RUNTIME, "1");
assert.equal(process.env.OPENAI_API_KEY, "");
const target = new URL(process.env.DATABASE_URL);
assert.deepEqual(
  [target.hostname, target.port, target.pathname, target.username],
  [fixture.host, String(fixture.ports.postgres), `/${fixture.database}`, fixture.role],
);
const { pool } = await import("../packages/db/src/index.ts");
const { createSession } = await import("../packages/auth/src/session.ts");
const id = (n) => `15000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const canaries = {
  product: "P15_PRIVATE_PRODUCT_CANARY",
  goal: "P15_PRIVATE_GOAL_CANARY",
  task: "P15_PRIVATE_TASK_CANARY",
  evidence: "P15_PRIVATE_EVIDENCE_CANARY",
  response: "P15_PRIVATE_RESPONSE_CANARY",
};
try {
  const identity = (await pool.query("SELECT current_user, current_database()")).rows[0];
  assert.deepEqual(identity, { current_user: fixture.role, current_database: fixture.database });
  // Deterministic recreation affects only the two synthetic accounts in this owned DB.
  await pool.query("DELETE FROM enough.admin_ai_usage_events WHERE user_id = ANY($1::uuid[])", [
    [id(1), id(2)],
  ]);
  await pool.query("DELETE FROM enough.auth_users WHERE id = ANY($1::uuid[])", [[id(1), id(2)]]);
  for (const n of [1, 2])
    await pool.query(
      "INSERT INTO enough.auth_users (id,email,email_normalized,email_verified_at) VALUES ($1,$2,$2,now())",
      [id(n), `phase15-account-${n}@example.test`],
    );
  const products = [];
  for (const [n, owner, stage] of [
    [10, 1, "IDEA"],
    [11, 1, "EARLY_USERS"],
    [12, 2, "PROBLEM_VALIDATION"],
  ]) {
    await pool.query(
      `INSERT INTO enough.products (id,user_id,name,target_customer,problem_statement,product_stage,has_launched,user_count,paying_user_count,current_revenue) VALUES ($1,$2,$3,$4,$4,$5,$6,$7,0,0)`,
      [
        id(n),
        id(owner),
        `Synthetic Phase 15 product ${n}`,
        canaries.product,
        stage,
        stage === "EARLY_USERS",
        stage === "EARLY_USERS" ? 5 : 0,
      ],
    );
    await pool.query(
      `INSERT INTO enough.product_goals (id,product_id,user_id,goal_type,title,is_primary) VALUES ($1,$2,$3,'CUSTOMER_INTERVIEWS',$4,true)`,
      [id(n + 10), id(n), id(owner), canaries.goal],
    );
    await pool.query(
      `INSERT INTO enough.product_metrics (id,product_id,metric_key,display_name,value,unit) VALUES ($1,$2,'interviews','Synthetic interviews',3,'count')`,
      [id(n + 20), id(n)],
    );
    await pool.query(
      `INSERT INTO enough.activity_event_aggregates (product_id,event_type,bucket_start,event_count,last_event_at) VALUES ($1,'synthetic.phase15',now()-interval '1 day',2,now()-interval '1 day'),($1,'synthetic.phase15',now()-interval '3 days',1,now()-interval '3 days'),($1,'synthetic.phase15',now()-interval '10 days',999,now()-interval '10 days')`,
      [id(n)],
    );
    const taskId = id(n + 30),
      completedTaskId = id(n + 40),
      completionId = id(n + 50),
      evidenceId = id(n + 60);
    await pool.query(
      `INSERT INTO enough.growth_tasks (id,user_id,product_id,series_id,title,description,estimated_minutes,reward_credits) VALUES ($1,$2,$3,$1,$4,$4,35,0)`,
      [taskId, id(owner), id(n), canaries.task],
    );
    await pool.query(
      `INSERT INTO enough.growth_tasks (id,user_id,product_id,series_id,title,status,completed_at,reward_credits) VALUES ($1,$2,$3,$1,'Synthetic completed interview','COMPLETED',now(),0)`,
      [completedTaskId, id(owner), id(n)],
    );
    await pool.query(
      `INSERT INTO enough.growth_task_completions (id,task_id,product_id,user_id,verification_status,reward_credits) VALUES ($1,$2,$3,$4,'AWAITING_REVIEW',0)`,
      [completionId, completedTaskId, id(n), id(owner)],
    );
    await pool.query(
      `INSERT INTO enough.task_evidence_items (id,completion_id,task_id,product_id,user_id,evidence_type,title,note) VALUES ($1,$2,$3,$4,$5,'NOTE','Synthetic interview note',$6)`,
      [evidenceId, completionId, completedTaskId, id(n), id(owner), canaries.evidence],
    );
    products.push({ id: id(n), owner: id(owner), stage, taskId, completionId, evidenceId });
  }
  await pool.query(
    `INSERT INTO enough.onboarding_profiles (user_id,product_id,product_description,target_customer,problem_statement,product_stage,has_launched,user_count,paying_user_count,next_goal,recommended_config) VALUES ($1,$2,'Synthetic Phase 15 onboarding',$3,$3,'IDEA',false,0,0,$4,'{}')`,
    [id(1), id(10), canaries.product, canaries.goal],
  );
  // No AI consent row initially; tests exercise missing, granted and revoked states.
  const accounts = [];
  for (const n of [1, 2])
    accounts.push({
      id: id(n),
      session: await createSession(id(n), "web", "Synthetic Phase 15 acceptance", "magic_link"),
    });
  await writeFile(
    path.join(fixture.directory, "seed.json"),
    JSON.stringify({ fixture: fixture.owner, version: 1, accounts, products, canaries }),
    { mode: 0o600 },
  );
  console.info(
    "Phase 15 synthetic seed: two accounts, three products, three active tasks, three note evidence records; no AI consent; no credits issued.",
  );
} finally {
  await pool.end();
}
