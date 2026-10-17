import { createHmac } from "node:crypto";
import { lstat, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { creditTrendSummary, formatPayment } from "../../web/app/reports/report-presentation";
import { createReportSession } from "../../web/app/reports/report-session";
import type { ProductReport, ProductReportDay } from "../../web/app/workspace-data";

const id = (n: number) => `16000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const signalKeys: Record<string, keyof ProductReportDay["signals"]> = {
  "email.outreach_sent": "outreach",
  "email.reply_received": "replies",
  "calendar.interview_completed": "interviews",
  "calendar.demo_completed": "demos",
  "calendar.feedback_call_completed": "feedbackCalls",
  "calendar.sales_call_completed": "salesCalls",
  "calendar.onboarding_completed": "onboardingCalls",
  "calendar.retention_call_completed": "retentionCalls",
  "analytics.user_signup": "signups",
  "analytics.user_activated": "activations",
  "analytics.user_retained": "retained",
  "revenue.payment_received": "payments",
};
type Account = { id: string; session: { token: string; csrfToken: string; sessionId: string } };
type Seed = {
  anchor: string;
  accounts: Account[];
  canaries: string[];
  products: { id: string; name: string; owner: string }[];
};

describe.skipIf(process.env.ENOUGH_PHASE16_INTEGRATION !== "1")(
  "Phase 16 actual PostgreSQL + report HTTP acceptance",
  () => {
    let pool: typeof import("@enough/db").pool;
    let redis: ReturnType<typeof import("@enough/cache").getRedis>;
    let directory: string;
    let seed: Seed;
    const api = "http://127.0.0.1:4442",
      web = "http://127.0.0.1:3322";
    const privateTokens: string[] = [];
    let proofCount = 0;
    beforeAll(async () => {
      const plan = await import(
        new URL("../../../scripts/phase16-fixture-plan.mjs", import.meta.url).href
      );
      directory = plan.phase16Fixture.directory;
      plan.assertPhase16Ownership({
        resolvedDirectory: await realpath(directory),
        symbolicLink: (await lstat(directory)).isSymbolicLink(),
        marker: JSON.parse(
          await readFile(path.join(directory, plan.phase16Fixture.markerFile), "utf8"),
        ),
        activePorts: [],
      });
      const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
      expect([target.hostname, target.port, target.pathname, target.username]).toEqual([
        "127.0.0.1",
        "55952",
        "/enough_phase16_reports",
        "enough_phase16_reports",
      ]);
      expect(process.env.OPENAI_API_KEY).toBe("");
      for (const key of [
        "GOOGLE_CLIENT_SECRET",
        "MICROSOFT_INTEGRATION_CLIENT_SECRET",
        "RESEND_API_KEY",
        "STRIPE_SECRET_KEY",
      ])
        expect(process.env[key]).toBeUndefined();
      ({ pool } = await import("@enough/db"));
      redis = (await import("@enough/cache")).getRedis();
      expect((await pool.query("SELECT current_user,current_database()")).rows[0]).toEqual({
        current_user: "enough_phase16_reports",
        current_database: "enough_phase16_reports",
      });
      expect((await pool.query("SHOW timezone")).rows[0].TimeZone).toBe("America/Los_Angeles");
      seed = JSON.parse(await readFile(path.join(directory, "seed.json"), "utf8"));
    });
    beforeEach(async () => {
      for (const account of seed.accounts) {
        const fingerprint = createHmac("sha256", process.env.AUTH_SECRET ?? "")
          .update(account.id)
          .digest("hex");
        await redis.del(`enough:auth:rate:reports:read:${fingerprint}`);
      }
    });
    afterAll(async () => {
      if (!pool) return;
      await unlink(path.join(directory, "query-control.json")).catch(() => {});
      await writeFile(
        path.join(directory, "report-acceptance.json"),
        JSON.stringify({ directTruthReports: proofCount, providerCalls: 0 }),
        { mode: 0o600 },
      );
      await pool.end();
      await (await import("@enough/cache")).closeRedis();
    });
    function headers(account = seed.accounts[0]) {
      return {
        cookie: `enough_session=${account.session.token}; enough_csrf=${account.session.csrfToken}`,
        "x-csrf-token": account.session.csrfToken,
        origin: web,
        "content-type": "application/json",
      };
    }
    function http(route: string, account: Account | undefined = seed.accounts[0], proxy = false) {
      return fetch(`${proxy ? web : api}${route}`, {
        headers: account ? headers(account) : {},
        signal: AbortSignal.timeout(45000),
      });
    }
    function start(days: number) {
      const now = new Date(seed.anchor);
      return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)),
      );
    }
    async function report(
      p: number,
      days: 7 | 30 | 90 = 7,
      account = seed.accounts[0],
      proxy = false,
    ) {
      const response = await http(
        `${proxy ? "/api/reports" : "/report-data"}?productId=${id(p)}&days=${days}`,
        account,
        proxy,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const value: ProductReport = await response.json();
      await truth(value, account.id);
      return value;
    }
    // Independent raw-row oracle: no reuse of production aggregate SQL, number
    // helpers, bucket builder or funnel implementation. Compare each response day.
    async function truth(report: ProductReport, owner: string) {
      const args = [report.product.id, owner, start(report.period.days), new Date(seed.anchor)];
      const [activity, events, credits, completions, product] = await Promise.all([
        pool.query(
          "SELECT effective_at,event_type,attributes FROM enough.activity_events WHERE product_id=$1 AND user_id=$2 AND effective_at >= $3 AND effective_at < $4",
          args,
        ),
        pool.query(
          "SELECT * FROM enough.integration_events WHERE product_id=$1 AND user_id=$2 AND occurred_at >= $3 AND occurred_at < $4",
          args,
        ),
        pool.query(
          `SELECT t.* FROM enough.credit_transactions t WHERE t.account_id IN
        (SELECT id FROM enough.credit_accounts WHERE product_id=$1 AND user_id=$2) AND t.user_id=$2 AND t.created_at >= $3 AND t.created_at < $4`,
          args,
        ),
        pool.query(
          "SELECT * FROM enough.growth_task_completions WHERE product_id=$1 AND user_id=$2 AND completed_at >= $3 AND completed_at < $4",
          args,
        ),
        pool.query("SELECT * FROM enough.products WHERE id=$1 AND user_id=$2", args.slice(0, 2)),
      ]);
      const expected: ProductReportDay[] = [];
      for (let i = 0; i < report.period.days; i++) {
        const day = new Date(start(report.period.days).getTime() + i * 86400000)
          .toISOString()
          .slice(0, 10);
        const sameDay = (date: Date) => date.toISOString().startsWith(day);
        const signals = {
          outreach: 0,
          replies: 0,
          interviews: 0,
          demos: 0,
          feedbackCalls: 0,
          salesCalls: 0,
          onboardingCalls: 0,
          retentionCalls: 0,
          signups: 0,
          activations: 0,
          retained: 0,
          payments: 0,
        };
        const money = new Map<string, { amount: bigint; count: number }>();
        const ev = events.rows.filter(
          (row) => sameDay(row.occurred_at) && row.verification_status === "AUTHENTICATED",
        );
        for (const row of ev) {
          const key = signalKeys[row.event_type];
          if (key) signals[key]++;
          if (row.event_type === "revenue.payment_received" && row.amount_minor !== null) {
            const code = row.currency.trim(),
              bucket = money.get(code) ?? { amount: 0n, count: 0 };
            bucket.amount += BigInt(row.amount_minor);
            bucket.count++;
            money.set(code, bucket);
          }
        }
        let build = 0,
          grow = 0;
        const act = activity.rows.filter((row) => sameDay(row.effective_at));
        for (const row of act) {
          const duration = String(row.attributes.duration_seconds);
          if (
            row.event_type !== "focus.session_ended" ||
            !/^\d{1,6}$/.test(duration) ||
            Number(duration) > 21600
          )
            continue;
          if (row.attributes.mode === "BUILD") build += Number(duration);
          if (row.attributes.mode === "GROWTH") grow += Number(duration);
        }
        const credit = { earned: 0, spent: 0, refunded: 0, adjusted: 0 };
        for (const row of credits.rows.filter((row) => sameDay(row.created_at))) {
          if (row.action === "EARN") credit.earned += Number(row.amount);
          if (row.action === "SPEND") credit.spent += Number(row.amount);
          if (row.action === "REFUND") credit.refunded += Number(row.amount);
          if (row.action === "ADJUST") credit.adjusted += Number(row.available_delta);
        }
        const tasks = completions.rows.filter((row) => sameDay(row.completed_at));
        expected.push({
          day,
          activityEvents: act.length,
          buildSeconds: build,
          growSeconds: grow,
          marketSignals: Object.entries(signals)
            .filter(([key]) => key !== "outreach")
            .reduce((sum, [, n]) => sum + n, 0),
          signals,
          payments: [...money]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([currency, bucket]) => ({
              currency,
              amountMinor: Number(bucket.amount),
              paymentCount: bucket.count,
            })),
          credits: credit,
          tasksCompleted: tasks.length,
          tasksVerified: tasks.filter((row) =>
            ["VERIFIED", "AUTOMATICALLY_VERIFIED"].includes(row.verification_status),
          ).length,
        });
      }
      expect(report.days).toEqual(expected);
      expect(report.product).toMatchObject({
        id: product.rows[0].id,
        name: product.rows[0].name,
        currentRevenue: product.rows[0].current_revenue,
        revenueCurrency: product.rows[0].revenue_currency.trim(),
        userCount: product.rows[0].user_count,
        payingUserCount: product.rows[0].paying_user_count,
      });
      const week = expected.slice(-7),
        weekDate = week[0].day;
      const sum = (field: "buildSeconds" | "growSeconds" | "marketSignals") =>
        week.reduce((total, day) => total + day[field], 0);
      const build = sum("buildSeconds"),
        grow = sum("growSeconds");
      const weeklyTasks = completions.rows.filter(
        (row) => row.completed_at.toISOString().slice(0, 10) >= weekDate,
      );
      expect(report.weeklyReview).toMatchObject({
        buildSeconds: build,
        growSeconds: grow,
        marketSignals: sum("marketSignals"),
        buildShare: build + grow ? Math.round((build / (build + grow)) * 100) : null,
        growShare: build + grow ? 100 - Math.round((build / (build + grow)) * 100) : null,
        tasksCompleted: weeklyTasks.length,
        tasksVerified: weeklyTasks.filter((row) =>
          ["VERIFIED", "AUTOMATICALLY_VERIFIED"].includes(row.verification_status),
        ).length,
        tasksAwaitingReview: weeklyTasks.filter((row) =>
          ["AWAITING_EVIDENCE", "AWAITING_REVIEW"].includes(row.verification_status),
        ).length,
        creditsEarned: week.reduce((n, day) => n + day.credits.earned, 0),
        creditsSpent: week.reduce((n, day) => n + day.credits.spent, 0),
      });
      const people = new Map<string, Record<string, number>>();
      for (const event of events.rows) {
        if (event.verification_status !== "AUTHENTICATED" || !event.user_reference_hash) continue;
        const key = `${event.integration_account_id}/${event.user_reference_hash}`,
          person = people.get(key) ?? {};
        const type = ["revenue.payment_received", "revenue.subscription_created"].includes(
          event.event_type,
        )
          ? "customer"
          : event.event_type;
        person[type] = Math.min(person[type] ?? Infinity, event.occurred_at.getTime());
        people.set(key, person);
      }
      for (const [index, from, to] of [
        [0, "email.outreach_sent", "email.reply_received"],
        [1, "calendar.demo_completed", "analytics.user_signup"],
        [2, "analytics.user_signup", "customer"],
      ] as const) {
        const starts = [...people.values()].filter((person) => person[from] !== undefined);
        const converted = starts.filter(
          (person) => person[to] !== undefined && person[to] >= person[from],
        ).length;
        expect(report.conversionFunnels[index]).toMatchObject({
          started: starts.length,
          converted,
          conversionPercent: starts.length
            ? Math.round((converted / starts.length) * 1000) / 10
            : null,
        });
      }
      const history = (
        await pool.query(
          "SELECT id,change_reason,changed_at FROM enough.product_stage_history WHERE product_id=$1 ORDER BY changed_at DESC LIMIT 100",
          [report.product.id],
        )
      ).rows;
      expect(
        report.stageHistory.map((row) => ({
          id: row.id,
          reason: row.reason,
          changedAt: row.changedAt,
        })),
      ).toEqual(
        history.map((row) => ({
          id: row.id,
          reason: row.change_reason,
          changedAt: row.changed_at.toISOString(),
        })),
      );
      expect(report.days.length).toBe(report.period.days);
      expect(report.period.startDate).toBe(expected[0].day);
      expect(report.period.endDate).toBe(seed.anchor.slice(0, 10));
      proofCount++;
    }

    it("accepts full checksum-verified migrations and deterministic seed evidence", async () => {
      const evidence = JSON.parse(
        await readFile(path.join(directory, "fresh-migration-evidence.json"), "utf8"),
      );
      expect(evidence).toMatchObject({
        fresh: true,
        count: 20,
        checksumMatch: true,
        noPending: true,
        idempotent: true,
      });
      expect(
        JSON.parse(await readFile(path.join(directory, "seed-reproduction.json"), "utf8")),
      ).toEqual({ deterministic: true });
    });
    it.each([7, 30, 90] as const)(
      "proves empty and exact %i-day UTC ranges against raw rows",
      async (days) => {
        const empty = await report(10, days);
        expect(
          empty.days.every(
            (day) =>
              day.activityEvents === 0 &&
              day.marketSignals === 0 &&
              !day.payments.length &&
              day.tasksCompleted === 0,
          ),
        ).toBe(true);
        expect(empty.weeklyReview.buildShare).toBeNull();
        const value = await report(14, days);
        const startAt = start(days);
        const before = (
          await pool.query(
            "SELECT count(*)::int n FROM enough.activity_events WHERE product_id=$1 AND effective_at=$2",
            [id(14), new Date(startAt.getTime() - 1)],
          )
        ).rows[0].n;
        expect(before).toBeGreaterThan(0);
        expect(
          (
            await pool.query(
              "SELECT count(*)::int n FROM enough.activity_events WHERE product_id=$1 AND effective_at=$2",
              [id(14), startAt],
            )
          ).rows[0].n,
        ).toBeGreaterThan(0);
        expect(value.days[0].activityEvents).toBeGreaterThan(0);
        expect(
          (
            await pool.query(
              "SELECT count(*)::int n FROM enough.activity_events WHERE product_id=$1 AND effective_at >= $2",
              [id(14), seed.anchor],
            )
          ).rows[0].n,
        ).toBe(2);
        expect(value.days.find((day) => day.day === "2024-02-29")?.activityEvents).toBeGreaterThan(
          0,
        );
        expect(value.days.find((day) => day.day === "2024-03-01")?.activityEvents).toBeGreaterThan(
          0,
        );
      },
    );
    it("proves normal single-currency snapshot/activity/status/credits and explicit ratio cases", async () => {
      const single = await report(11);
      expect(single.weeklyReview).toMatchObject({
        buildShare: 67,
        growShare: 33,
        tasksCompleted: 2,
        tasksVerified: 1,
        tasksAwaitingReview: 1,
        creditsEarned: 20,
        creditsSpent: 7,
      });
      expect(single.days.at(-1)?.payments).toEqual([
        { currency: "EUR", amountMinor: 12345, paymentCount: 2 },
      ]);
      expect((await report(16)).weeklyReview.buildShare).toBe(100);
      expect((await report(17)).weeklyReview.growShare).toBe(100);
    });
    it("keeps all currencies, zero/null distinction, unsupported codes and MAX_SAFE_INTEGER exact", async () => {
      const value = await report(12, 30),
        payments = value.days.at(-1)?.payments ?? [];
      expect(payments).toEqual([
        { currency: "EUR", amountMinor: 12345, paymentCount: 2 },
        { currency: "JPY", amountMinor: 12345, paymentCount: 1 },
        { currency: "KWD", amountMinor: 12345, paymentCount: 1 },
        { currency: "USD", amountMinor: Number.MAX_SAFE_INTEGER, paymentCount: 9008 },
        { currency: "ZZZ", amountMinor: 123, paymentCount: 1 },
      ]);
      const formatted = payments.map((row) =>
        formatPayment(row.amountMinor, row.currency, "en-US"),
      );
      expect(formatted).toEqual([
        "€123.45",
        "¥12,345",
        "KWD 12.345",
        "$90,071,992,547,409.91",
        "123 minor units ZZZ",
      ]);
      expect(value.product.revenueCurrency).toBe("GBP");
      expect(value.days.at(-1)?.signals.payments).toBe(
        payments.reduce((n, row) => n + row.paymentCount, 0) + 1,
      );
    });
    it("proves mixed review states, owner/automatic combination, evidence methods and no trust upgrade", async () => {
      const value = await report(13);
      expect(value.weeklyReview).toMatchObject({
        tasksCompleted: 6,
        tasksVerified: 2,
        tasksAwaitingReview: 2,
      });
      const methods = (
        await pool.query(
          "SELECT verification_method,count(*)::int n FROM enough.task_evidence_items WHERE product_id=$1 GROUP BY verification_method ORDER BY verification_method",
          [id(13)],
        )
      ).rows;
      expect(methods).toEqual([
        { verification_method: "AUTOMATIC", n: 1 },
        { verification_method: "MANUAL", n: 4 },
      ]);
      expect(value.trustNotes.join(" ")).toContain("owner-reviewed and automatically verified");
      expect(value.trustNotes.join(" ")).toContain("not necessarily unique people");
    });
    it("proves product/global/foreign wallet exclusion including refund-only and adjustment-only activity", async () => {
      for (const p of [18, 19, 20, 21]) {
        const value = await report(p);
        expect(creditTrendSummary(value.days).hasActivity).toBe(true);
        expect(value.days.at(-1)?.credits).toEqual({
          earned: p === 21 ? 8 : 0,
          spent: p === 20 ? 6 : 0,
          refunded: p === 18 ? 5 : 0,
          adjusted: p === 19 ? -4 : 0,
        });
      }
      const empty = await report(10);
      expect(creditTrendSummary(empty.days).hasActivity).toBe(false);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM enough.credit_transactions WHERE account_id=$1",
            [id(999)],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("proves all three linked funnels, unlinked/rejected exclusions and replay uniqueness", async () => {
      const value = await report(22);
      expect(
        value.conversionFunnels.map((f) => [f.started, f.converted, f.conversionPercent]),
      ).toEqual([
        [2, 1, 50],
        [2, 2, 100],
        [2, 1, 50],
      ]);
      const replay = await pool.query(
        `INSERT INTO enough.integration_events(id,integration_account_id,user_id,product_id,provider_event_id,event_type,occurred_at,payload_hash)
      SELECT $2,integration_account_id,user_id,product_id,provider_event_id,event_type,occurred_at,payload_hash FROM enough.integration_events
      WHERE product_id=$1 LIMIT 1 ON CONFLICT(integration_account_id,provider_event_id) DO NOTHING`,
        [id(22), id(800001)],
      );
      expect(replay.rowCount).toBe(0);
      expect((await report(22)).conversionFunnels).toEqual(value.conversionFunnels);
    });
    it("returns ordered actual persisted reasons and raw UTC timestamps outside the selected period", async () => {
      const value = await report(11);
      expect(value.stageHistory.map((row) => row.reason)).toEqual([
        "Synthetic persisted stage reason",
        null,
      ]);
      expect(value.stageHistory.map((row) => row.changedAt)).toEqual([
        "2024-03-01T00:00:01.000Z",
        "2023-01-01T00:00:00.000Z",
      ]);
    });
    it("matches bounded volume truth, ignores hourly/metered substitutes and repeats identically", async () => {
      const begun = performance.now();
      const a = await report(15, 90),
        b = await report(15, 90);
      expect(b).toEqual(a);
      expect(a.weeklyReview).toMatchObject({
        buildSeconds: 300000,
        growSeconds: 300000,
        buildShare: 50,
        marketSignals: 2000,
        tasksCompleted: 200,
        tasksVerified: 100,
        tasksAwaitingReview: 100,
      });
      expect(a.days.at(-1)?.activityEvents).toBe(10000);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM enough.build_sessions WHERE product_id=$1",
            [id(15)],
          )
        ).rows[0].n,
      ).toBe(50);
      expect(performance.now() - begun).toBeLessThan(15000);
    });
    it("rejects malformed amounts, currencies, scopes and links at PostgreSQL boundaries", async () => {
      for (const [field, value, code] of [
        ["amount_minor", "-1", "23514"],
        ["amount_minor", "1.5", "22P02"],
        ["amount_minor", "NaN", "22P02"],
        ["currency", "EURO", "22001"],
        ["currency", "eur", "23514"],
        ["user_reference_hash", "bad-link", "23514"],
        ["event_type", "unsupported.event", "23514"],
        ["product_id", null, "23502"],
        ["product_id", id(90), "23503"],
      ]) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await expect(
            client.query(
              `UPDATE enough.integration_events SET ${field}=$2 WHERE id=(SELECT id FROM enough.integration_events WHERE product_id=$1 LIMIT 1)`,
              [id(11), value],
            ),
          ).rejects.toMatchObject({ code });
        } finally {
          await client.query("ROLLBACK");
          client.release();
        }
      }
      await report(11);
      await report(14);
    });
    it("fails unsafe payment/credit aggregates safely without rounding or exposing SQL details", async () => {
      try {
        await pool.query(
          `INSERT INTO enough.integration_events(id,integration_account_id,user_id,product_id,provider_event_id,event_type,amount_minor,currency,occurred_at,payload_hash)
        SELECT md5('p16-overflow-'||i)::uuid,$1,$2,$3,'overflow-'||i,'revenue.payment_received',
        LEAST(1000000000000::numeric,9007199254740992::numeric-(i-1)*1000000000000::numeric)::bigint,'USD',$4,md5(i::text)||md5(i::text)
        FROM generate_series(1,9008) i`,
          [id(323), id(1), id(23), new Date(new Date(seed.anchor).getTime() - 1000)],
        );
        expect(
          (
            await pool.query(
              "SELECT SUM(amount_minor)::text total FROM enough.integration_events WHERE product_id=$1",
              [id(23)],
            )
          ).rows[0].total,
        ).toBe("9007199254740992");
        const response = await http(`/report-data?productId=${id(23)}&days=7`);
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: "The report is temporarily unavailable." });
      } finally {
        await pool.query("DELETE FROM enough.integration_events WHERE product_id=$1", [id(23)]);
      }
      const wallet = id(523),
        transaction = id(800050);
      const baseline = (
        await pool.query("SELECT available_balance FROM enough.credit_accounts WHERE id=$1", [
          wallet,
        ])
      ).rows[0].available_balance;
      try {
        await pool.query(
          `INSERT INTO enough.credit_transactions
          (id,account_id,user_id,action,amount,available_delta,reserved_delta,balance_after_available,balance_after_reserved,idempotency_key,request_hash,created_at)
          VALUES($1,$2,$3,'EARN',9007199254740992,9007199254740992,0,$4,0,'phase16-unsafe-credit',repeat('a',64),$5)`,
          [
            transaction,
            wallet,
            id(1),
            (BigInt(baseline) + 9007199254740992n).toString(),
            new Date(new Date(seed.anchor).getTime() - 1000),
          ],
        );
        await pool.query(
          "UPDATE enough.credit_accounts SET available_balance=available_balance+9007199254740992 WHERE id=$1",
          [wallet],
        );
        expect(
          (
            await pool.query(
              "SELECT SUM(amount)::text total FROM enough.credit_transactions WHERE account_id=$1 AND created_at >= $2",
              [wallet, start(7)],
            )
          ).rows[0].total,
        ).toBe("9007199254740992");
        expect((await http(`/report-data?productId=${id(23)}&days=7`)).status).toBe(503);
      } finally {
        await pool.query("DELETE FROM enough.credit_transactions WHERE id=$1", [transaction]);
        await pool.query("UPDATE enough.credit_accounts SET available_balance=$2 WHERE id=$1", [
          wallet,
          baseline,
        ]);
      }
    });
    it("enforces no-session, invalid/revoked session, foreign owner and malformed ranges", async () => {
      expect((await fetch(`${api}/report-data?productId=${id(10)}&days=7`)).status).toBe(401);
      const invalid = {
        ...seed.accounts[0],
        session: { ...seed.accounts[0].session, token: "synthetic-invalid-session" },
      };
      expect((await http(`/report-data?productId=${id(10)}`, invalid)).status).toBe(401);
      const { createSession } = await import("../../../packages/auth/src/session");
      const revoked = await createSession(id(1), "web", "Phase 16 revoked test", "password");
      privateTokens.push(revoked.token, revoked.csrfToken ?? "");
      await pool.query("UPDATE enough.auth_sessions SET revoked_at=now() WHERE id=$1", [
        revoked.sessionId,
      ]);
      expect(
        (
          await http(`/report-data?productId=${id(10)}`, {
            id: id(1),
            session: { ...revoked, csrfToken: revoked.csrfToken ?? "" },
          })
        ).status,
      ).toBe(401);
      expect((await http(`/report-data?productId=${id(11)}`, seed.accounts[1])).status).toBe(404);
      expect((await http(`/report-data?productId=${id(90)}`, seed.accounts[0])).status).toBe(404);
      await report(90, 7, seed.accounts[1]);
      for (const range of ["8", "0", "-1", "7.5", "NaN", "999999999999999999999999999999"])
        expect((await http(`/report-data?productId=${id(11)}&days=${range}`)).status).toBe(400);
      expect((await http("/report-data?productId=not-a-uuid&days=7")).status).toBe(400);
    });
    it("exhausts the real account-scoped Redis report quota and preserves other accounts", async () => {
      for (let n = 0; n < 60; n++) {
        const response = await http(`/report-data?productId=${id(10)}&days=7`);
        expect(response.status).toBe(200);
        await truth(await response.json(), seed.accounts[0].id);
      }
      const limited = await http(`/report-data?productId=${id(10)}&days=7`);
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(await limited.json()).toEqual({ error: "Too many requests. Try again later." });
      await report(90, 7, seed.accounts[1]);
    });
    it("wires web reports/proxy and live HTTP controller states without manual hydration", async () => {
      expect((await fetch(`${web}/reports`)).status).toBe(200);
      for (const days of [7, 30, 90] as const) await report(11, days, seed.accounts[0], true);
      const products = await http("/products", seed.accounts[2]);
      expect((await products.json()).products).toEqual([]);
      let release!: (value: ProductReport) => void;
      const stale = new Promise<ProductReport>((resolve) => {
        release = resolve;
      });
      const first = await report(11, 30),
        second = await report(12, 7);
      let calls = 0;
      let redirected = "";
      const controller = createReportSession({
        request: async () => (++calls === 1 ? stale : second),
        unauthorized: () => {
          redirected = "/login";
        },
      });
      const pending = controller.request({ productId: id(11), days: 30 });
      controller.select({ productId: id(12), days: 7 });
      await controller.request({ productId: id(12), days: 7 });
      release(first);
      await pending;
      expect(controller.getSnapshot().report?.product.id).toBe(id(12));
      expect(redirected).toBe("");
      await writeFile(path.join(directory, "query-control.json"), JSON.stringify({ mode: "fail" }));
      try {
        const failure = await http(`/report-data?productId=${id(11)}&days=7`);
        expect(failure.status).toBe(503);
        expect(await failure.json()).toEqual({ error: "The report is temporarily unavailable." });
        const errorController = createReportSession({
          request: async () => {
            const r = await http(`/report-data?productId=${id(11)}`);
            if (!r.ok) throw { status: r.status };
            return r.json();
          },
          unauthorized: () => {
            redirected = "/login";
          },
        });
        await errorController.request({ productId: id(11), days: 7 });
        expect(errorController.getSnapshot()).toMatchObject({
          report: null,
          error: "The product report could not be loaded. Try again.",
        });
      } finally {
        await unlink(path.join(directory, "query-control.json"));
      }
      const unauthorized = createReportSession({
        request: async () => {
          const r = await fetch(`${api}/report-data?productId=${id(11)}`);
          throw { status: r.status };
        },
        unauthorized: () => {
          redirected = "/login";
        },
      });
      await unauthorized.request({ productId: id(11), days: 7 });
      expect(redirected).toBe("/login");
    });
    it("observes/document best-effort concurrent slices and stable coherent reads after commit", async () => {
      const base = await report(13),
        task = id(800100),
        completion = id(800101);
      await pool.query(
        `INSERT INTO enough.growth_tasks(id,user_id,product_id,series_id,title,reward_credits) VALUES($1,$2,$3,$1,'Concurrent synthetic completion',0)`,
        [task, id(1), id(13)],
      );
      for (const name of ["daily-query-paused.json", "weekly-query-read.json"])
        await unlink(path.join(directory, name)).catch(() => {});
      await writeFile(
        path.join(directory, "query-control.json"),
        JSON.stringify({ mode: "pause" }),
      );
      const pending = http(`/report-data?productId=${id(13)}&days=7`);
      try {
        for (let i = 0; i < 300; i++) {
          if (await lstat(path.join(directory, "weekly-query-read.json")).catch(() => null)) break;
          await delay(20);
        }
        expect(
          await lstat(path.join(directory, "daily-query-paused.json"))
            .then(() => true)
            .catch(() => false),
        ).toBe(true);
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            "UPDATE enough.growth_tasks SET status='COMPLETED',completed_at=$2 WHERE id=$1",
            [task, new Date(new Date(seed.anchor).getTime() - 1000)],
          );
          await client.query(
            `INSERT INTO enough.growth_task_completions(id,task_id,user_id,product_id,verification_status,reward_credits,completed_at)
          VALUES($1,$2,$3,$4,'AWAITING_EVIDENCE',0,$5)`,
            [completion, task, id(1), id(13), new Date(new Date(seed.anchor).getTime() - 1000)],
          );
          await client.query("COMMIT");
        } finally {
          client.release();
        }
        await unlink(path.join(directory, "query-control.json"));
        const response = await pending;
        expect(response.status).toBe(200);
        const concurrent: ProductReport = await response.json();
        expect(concurrent.days.at(-1)?.tasksCompleted).toBe(base.weeklyReview.tasksCompleted + 1);
        expect(concurrent.weeklyReview.tasksCompleted).toBe(base.weeklyReview.tasksCompleted);
        expect(concurrent.trustNotes.join(" ")).toContain(
          "best-effort reads, not one transactional snapshot",
        );
        const stable = await report(13);
        expect(stable.weeklyReview.tasksCompleted).toBe(base.weeklyReview.tasksCompleted + 1);
        await writeFile(
          path.join(directory, "concurrency-evidence.json"),
          JSON.stringify({ mode: "best-effort", skewObserved: true, stableReadVerified: true }),
          { mode: 0o600 },
        );
      } finally {
        await unlink(path.join(directory, "query-control.json")).catch(() => {});
        await pending.catch(() => {});
        await pool.query("DELETE FROM enough.growth_tasks WHERE id=$1", [task]);
      }
      expect(await report(13)).toEqual(base);
    });
    it("retains no fixture credentials, session material, evidence bodies or SQL diagnostics in logs", async () => {
      const credentials = JSON.parse(
        await readFile(path.join(directory, "credentials.json"), "utf8"),
      );
      const manual = JSON.parse(
        await readFile(path.join(directory, "manual-account.json"), "utf8"),
      );
      const secrets = [
        ...(Object.values(credentials) as string[]),
        manual.password,
        ...seed.accounts.flatMap((a) => [a.session.token, a.session.csrfToken]),
        ...privateTokens,
        ...seed.canaries,
        "P16_SQL_PRIVATE_CANARY",
      ];
      for (const name of [
        "api.log",
        "web.log",
        "postgres.log",
        "seed.log",
        "seed-reproduced.log",
        "migrate.log",
        "migrate-idempotent.log",
      ]) {
        const log = await readFile(path.join(directory, name), "utf8");
        for (const secret of secrets.filter(Boolean)) expect(log.includes(secret)).toBe(false);
        expect(/authorization\s*[:=]\s*["']?(Bearer|Basic)\s+/i.test(log)).toBe(false);
        expect(/enough_session=|enough_csrf=|postgres(?:ql)?:\/\/[^\s]+:[^\s]+@/i.test(log)).toBe(
          false,
        );
      }
      expect((await readFile(path.join(directory, "egress-blocked.log"), "utf8")).trim()).toBe("");
    });
  },
);
