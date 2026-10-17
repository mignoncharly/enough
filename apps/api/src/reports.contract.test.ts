import {
  PRODUCT_STAGE_GUIDANCE,
  PRODUCT_STAGE_LABELS,
  PRODUCT_STAGES,
  REPORT_ANALYTICS_NOTE,
  REPORT_VERIFICATION_NOTE,
} from "@enough/shared";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ProductReport } from "../../web/app/workspace-data";

const mocks = vi.hoisted(() => ({ query: vi.fn(), session: vi.fn(), limit: vi.fn() }));
vi.mock("@enough/db", () => ({ pool: { query: mocks.query } }));
vi.mock("@enough/auth", () => ({ checkRateLimit: mocks.limit }));
vi.mock("./api-auth.js", () => ({ requireSession: mocks.session }));

import { registerReportRoutes } from "./reports.js";

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const signed = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
// Assert the real serialized response, including exact keys and nullable fields,
// against the browser contract. SQL execution/aggregation remains a Pass 2 gate.
const contract: z.ZodType<ProductReport> = z
  .object({
    product: z
      .object({
        id: z.string(),
        name: z.string(),
        productStage: z.enum(PRODUCT_STAGES),
        productStageLabel: z.string(),
        hasLaunched: z.boolean(),
        userCount: integer,
        payingUserCount: integer,
        currentRevenue: z.string().nullable(),
        revenueCurrency: z.string(),
      })
      .strict(),
    period: z
      .object({
        days: integer,
        startDate: z.string(),
        endDate: z.string(),
        timezone: z.literal("UTC"),
      })
      .strict(),
    stageGuidance: z
      .object({ buildPercent: integer, marketPercent: integer, priorities: z.array(z.string()) })
      .strict(),
    days: z.array(
      z
        .object({
          day: z.string(),
          activityEvents: integer,
          buildSeconds: integer,
          growSeconds: integer,
          marketSignals: integer,
          signals: z
            .object({
              outreach: integer,
              replies: integer,
              interviews: integer,
              demos: integer,
              feedbackCalls: integer,
              salesCalls: integer,
              onboardingCalls: integer,
              retentionCalls: integer,
              signups: integer,
              activations: integer,
              retained: integer,
              payments: integer,
            })
            .strict(),
          payments: z.array(
            z
              .object({ currency: z.string(), amountMinor: integer, paymentCount: integer })
              .strict(),
          ),
          credits: z
            .object({ earned: integer, spent: integer, refunded: integer, adjusted: signed })
            .strict(),
          tasksCompleted: integer,
          tasksVerified: integer,
        })
        .strict(),
    ),
    weeklyReview: z
      .object({
        startDate: z.string(),
        endDate: z.string(),
        buildSeconds: integer,
        growSeconds: integer,
        buildShare: integer.nullable(),
        growShare: integer.nullable(),
        marketSignals: integer,
        tasksCompleted: integer,
        tasksVerified: integer,
        tasksAwaitingReview: integer,
        creditsEarned: integer,
        creditsSpent: integer,
        highestSignalTask: z
          .object({ title: z.string(), signalStrength: integer })
          .strict()
          .nullable(),
        recommendation: z.string(),
      })
      .strict(),
    conversionFunnels: z.array(
      z
        .object({
          key: z.string(),
          label: z.string(),
          started: integer,
          converted: integer,
          conversionPercent: z.number().min(0).max(100).nullable(),
        })
        .strict(),
    ),
    stageHistory: z.array(
      z
        .object({
          id: z.string(),
          fromStage: z.enum(PRODUCT_STAGES).nullable(),
          fromStageLabel: z.string().nullable(),
          toStage: z.enum(PRODUCT_STAGES),
          toStageLabel: z.string(),
          reason: z.string().nullable(),
          changedAt: z.string().datetime(),
        })
        .strict(),
    ),
    trustNotes: z.array(z.string()),
  })
  .strict();

const productId = "00000000-0000-4000-8000-000000000016";
const ownerId = "00000000-0000-4000-8000-000000000001";
const now = new Date("2024-03-01T12:34:56.000Z");
const product = {
  id: productId,
  name: "Synthetic report product",
  product_stage: "IDEA",
  has_launched: false,
  user_count: 12,
  paying_user_count: 3,
  current_revenue: "125.25",
  revenue_currency: "GBP",
};
type Rows = Record<string, unknown>[][];
const emptyRows = (): Rows => [
  [{ ...product }],
  [],
  [],
  [],
  [],
  [],
  [],
  [
    { funnel_key: "outreach_reply", started: "0", converted: "0" },
    { funnel_key: "demo_signup", started: "0", converted: "0" },
    { funnel_key: "signup_customer", started: "0", converted: "0" },
  ],
  [{ completed: "0", verified: "0", awaiting_review: "0" }],
  [],
];

describe("Reports route response contract (mocked DB, no runtime fixture)", () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    mocks.query.mockReset();
    mocks.session.mockReset().mockResolvedValue({ id: ownerId });
    mocks.limit.mockReset().mockResolvedValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("External calls forbidden in report tests");
      }),
    );
  });
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  async function request(rows = emptyRows(), query = `productId=${productId}&days=7`) {
    const defaults: Record<number, Record<string, unknown>> = {
      1: { activity_events: "0", build_seconds: "0", grow_seconds: "0" },
      2: {
        outreach: "0",
        replies: "0",
        interviews: "0",
        demos: "0",
        feedback_calls: "0",
        sales_calls: "0",
        onboarding_calls: "0",
        retention_calls: "0",
        signups: "0",
        activations: "0",
        retained: "0",
        payments: "0",
      },
      3: { currency: "EUR", amount_minor: "0", payment_count: "0" },
      4: { earned: "0", spent: "0", refunded: "0", adjusted: "0" },
      5: { completed: "0", verified: "0" },
      8: { completed: "0", verified: "0", awaiting_review: "0" },
    };
    rows.forEach((result, index) => {
      mocks.query.mockResolvedValueOnce({
        rows: result.map((row) => ({ ...defaults[index], ...row })),
      });
    });
    const app = Fastify({ logger: false });
    apps.push(app);
    await registerReportRoutes(app);
    return app.inject({ method: "GET", url: `/report-data?${query}` });
  }

  it.each([7, 30, 90])(
    "returns the exact empty %i-day contract, UTC dates and null ratios",
    async (days) => {
      const rows = emptyRows();
      rows[0][0].current_revenue = null;
      const response = await request(rows, `productId=${productId}&days=${days}`);
      expect(response.statusCode).toBe(200);
      const report = contract.parse(response.json());
      expect(report.days).toHaveLength(days);
      expect(report.days.at(-1)?.day).toBe("2024-03-01");
      expect(report.days[0].day).toBe(
        new Date(now.getTime() - (days - 1) * 86400000).toISOString().slice(0, 10),
      );
      expect(report.period).toEqual({
        days,
        startDate: report.days[0].day,
        endDate: "2024-03-01",
        timezone: "UTC",
      });
      for (const day of report.days)
        expect(day).toEqual({
          day: day.day,
          activityEvents: 0,
          buildSeconds: 0,
          growSeconds: 0,
          marketSignals: 0,
          signals: {
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
          },
          payments: [],
          credits: { earned: 0, spent: 0, refunded: 0, adjusted: 0 },
          tasksCompleted: 0,
          tasksVerified: 0,
        });
      expect(report.weeklyReview).toMatchObject({
        startDate: "2024-02-24",
        endDate: "2024-03-01",
        buildSeconds: 0,
        growSeconds: 0,
        buildShare: null,
        growShare: null,
        marketSignals: 0,
        tasksCompleted: 0,
        tasksVerified: 0,
        tasksAwaitingReview: 0,
        creditsEarned: 0,
        creditsSpent: 0,
        highestSignalTask: null,
      });
      expect(report.weeklyReview.recommendation).toContain("split is unavailable");
      expect(report.product.currentRevenue).toBeNull();
      expect(report.stageHistory).toEqual([]);
      expect(
        report.conversionFunnels.map((f) => [f.started, f.converted, f.conversionPercent]),
      ).toEqual([
        [0, 0, null],
        [0, 0, null],
        [0, 0, null],
      ]);
      expect(mocks.query.mock.calls[0][1]).toEqual([productId, ownerId]);
      expect(mocks.query.mock.calls[1][1]).toEqual([
        productId,
        ownerId,
        new Date(`${report.period.startDate}T00:00:00Z`),
        now,
      ]);
      expect(mocks.limit).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        "reports:read",
        ownerId,
        60,
        60,
      );
    },
  );

  it("retains the real snapshot, review, movements, signal fields and persisted stage reason", async () => {
    const rows = emptyRows();
    rows[1] = [
      {
        report_day: "2024-03-01",
        activity_events: "9",
        build_seconds: "3600",
        grow_seconds: "1800",
      },
    ];
    rows[2] = [
      {
        report_day: "2024-03-01",
        outreach: "100",
        replies: "2",
        interviews: "1",
        demos: "3",
        feedback_calls: "1",
        sales_calls: "1",
        onboarding_calls: "1",
        retention_calls: "1",
        signups: "4",
        activations: "2",
        retained: "1",
        payments: "3",
      },
    ];
    rows[3] = [
      { report_day: "2024-03-01", currency: "EUR", amount_minor: "12345", payment_count: "2" },
    ];
    rows[4] = [
      { report_day: "2024-03-01", earned: "20", spent: "7", refunded: "3", adjusted: "-2" },
    ];
    rows[5] = [{ report_day: "2024-03-01", completed: "6", verified: "2" }];
    rows[6] = [
      {
        id: "stage-2",
        from_stage: "IDEA",
        to_stage: "PROBLEM_VALIDATION",
        changed_at: new Date("2024-03-01T00:00:01Z"),
        reason: "Synthetic persisted transition",
      },
      {
        id: "stage-1",
        from_stage: null,
        to_stage: "IDEA",
        changed_at: new Date("2024-02-01T00:00:00Z"),
        reason: null,
      },
    ];
    rows[7] = [
      { funnel_key: "outreach_reply", started: "3", converted: "1" },
      { funnel_key: "demo_signup", started: "0", converted: "0" },
      { funnel_key: "signup_customer", started: "2", converted: "2" },
    ];
    rows[8] = [{ completed: "6", verified: "2", awaiting_review: "3" }];
    rows[9] = [{ title: "Synthetic pending task", signal_strength: 5 }];
    const response = await request(rows);
    expect(response.statusCode).toBe(200);
    const report = contract.parse(response.json());
    expect(report.product).toEqual({
      id: productId,
      name: product.name,
      productStage: "IDEA",
      productStageLabel: PRODUCT_STAGE_LABELS.IDEA,
      hasLaunched: false,
      userCount: 12,
      payingUserCount: 3,
      currentRevenue: "125.25",
      revenueCurrency: "GBP",
    });
    expect(report.stageGuidance).toEqual({
      buildPercent: PRODUCT_STAGE_GUIDANCE.IDEA.buildPercent,
      marketPercent: PRODUCT_STAGE_GUIDANCE.IDEA.marketPercent,
      priorities: PRODUCT_STAGE_GUIDANCE.IDEA.priorities,
    });
    expect(report.days.at(-1)).toMatchObject({
      activityEvents: 9,
      buildSeconds: 3600,
      growSeconds: 1800,
      marketSignals: 20,
      tasksCompleted: 6,
      tasksVerified: 2,
      payments: [{ currency: "EUR", amountMinor: 12345, paymentCount: 2 }],
      credits: { earned: 20, spent: 7, refunded: 3, adjusted: -2 },
    });
    expect(report.days.at(-1)?.signals).toEqual({
      outreach: 100,
      replies: 2,
      interviews: 1,
      demos: 3,
      feedbackCalls: 1,
      salesCalls: 1,
      onboardingCalls: 1,
      retentionCalls: 1,
      signups: 4,
      activations: 2,
      retained: 1,
      payments: 3,
    });
    expect(mocks.query.mock.calls[7][0]).toContain("user_reference_hash IS NOT NULL");
    expect(mocks.query.mock.calls[7][0]).toContain(
      "GROUP BY integration_account_id, user_reference_hash",
    );
    expect(report.weeklyReview).toMatchObject({
      buildSeconds: 3600,
      growSeconds: 1800,
      buildShare: 67,
      growShare: 33,
      marketSignals: 20,
      tasksCompleted: 6,
      tasksVerified: 2,
      tasksAwaitingReview: 3,
      creditsEarned: 20,
      creditsSpent: 7,
      highestSignalTask: { title: "Synthetic pending task", signalStrength: 5 },
    });
    expect(report.weeklyReview.recommendation.length).toBeGreaterThan(20);
    expect(report.conversionFunnels.map((f) => f.conversionPercent)).toEqual([33.3, null, 100]);
    expect(report.conversionFunnels[0].started).toBe(3); // Not the 100 outreach records.
    expect(report.stageHistory[0]).toMatchObject({
      reason: "Synthetic persisted transition",
      changedAt: "2024-03-01T00:00:01.000Z",
    });
    expect(report.stageHistory[1]).toMatchObject({ reason: null, fromStageLabel: null });
    expect(mocks.query.mock.calls[6][0]).toContain("history.change_reason AS reason");
    expect(mocks.query.mock.calls[6][1]).toEqual([productId]);
    expect(report.trustNotes).toEqual(
      expect.arrayContaining([REPORT_ANALYTICS_NOTE, REPORT_VERIFICATION_NOTE]),
    );
    expect(report.trustNotes.join(" ")).toContain("not independent vendor verification");
    expect(report.trustNotes.join(" ")).toContain("owner-reviewed and automatically verified");
    expect(report.trustNotes.join(" ")).toContain("not necessarily unique people or customers");
    expect(report.trustNotes.join(" ")).toContain("one record");
  });

  it("keeps same-day and range payment currencies separate, exact and independent of snapshot currency", async () => {
    const rows = emptyRows();
    rows[3] = [
      {
        report_day: "2024-03-01",
        currency: "EUR",
        amount_minor: String(Number.MAX_SAFE_INTEGER),
        payment_count: "9008",
      },
      { report_day: "2024-03-01", currency: "USD", amount_minor: "321", payment_count: "1" },
      { report_day: "2024-03-01", currency: "ZZZ", amount_minor: "123", payment_count: "1" },
      { report_day: "2024-02-29", currency: "JPY", amount_minor: "7", payment_count: "1" },
    ];
    const report = contract.parse((await request(rows)).json());
    expect(report.days.at(-1)?.payments).toEqual([
      { currency: "EUR", amountMinor: Number.MAX_SAFE_INTEGER, paymentCount: 9008 },
      { currency: "USD", amountMinor: 321, paymentCount: 1 },
      { currency: "ZZZ", amountMinor: 123, paymentCount: 1 },
    ]);
    expect(report.days.at(-2)?.payments).toEqual([
      { currency: "JPY", amountMinor: 7, paymentCount: 1 },
    ]);
    expect(report.product.revenueCurrency).toBe("GBP");
  });

  it.each([
    [3600, 0, 100, 0],
    [0, 3600, 0, 100],
    [1, 1, 50, 50],
  ])("handles focus split %i/%i", async (build, grow, buildShare, growShare) => {
    const rows = emptyRows();
    rows[1] = [
      {
        report_day: "2024-03-01",
        build_seconds: String(build),
        grow_seconds: String(grow),
        activity_events: "2",
      },
    ];
    const report = contract.parse((await request(rows)).json());
    expect(report.weeklyReview).toMatchObject({ buildShare, growShare });
  });

  it.each([
    [1, "activity_events", "-1"],
    [1, "activity_events", null],
    [2, "replies", ""],
    [1, "build_seconds", "1.5"],
    [1, "grow_seconds", "9007199254740992"],
    [2, "replies", "-1"],
    [3, "amount_minor", "9007199254740992"],
    [3, "amount_minor", "-1"],
    [3, "payment_count", "1.5"],
    [4, "earned", "-1"],
    [4, "spent", "NaN"],
    [4, "refunded", "9007199254740992"],
    [5, "completed", "-1"],
    [8, "awaiting_review", "-1"],
    [0, "user_count", -1],
    [0, "paying_user_count", 13],
    [9, "signal_strength", 6],
  ])("fails safely for corrupt aggregate %i.%s", async (index, field, value) => {
    const rows = emptyRows();
    rows[Number(index)] = [
      { ...(rows[Number(index)][0] ?? {}), report_day: "2024-03-01", [field]: value },
    ];
    const response = await request(rows);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "The report is temporarily unavailable." });
  });

  it.each([
    "signals",
    "daily focus",
    "weekly focus",
    "weekly credit",
    "weekly spent",
    "weekly signals",
    "trend refunds",
    "trend adjustments",
  ])("rejects derived overflow: %s", async (kind) => {
    const rows = emptyRows();
    const max = String(Number.MAX_SAFE_INTEGER);
    if (kind === "signals") rows[2] = [{ report_day: "2024-03-01", replies: max, signups: "1" }];
    if (kind === "daily focus")
      rows[1] = [{ report_day: "2024-03-01", build_seconds: max, grow_seconds: "1" }];
    if (kind === "weekly focus")
      rows[1] = [
        { report_day: "2024-03-01", build_seconds: max },
        { report_day: "2024-02-29", grow_seconds: "1" },
      ];
    if (kind === "weekly credit")
      rows[4] = [
        { report_day: "2024-03-01", earned: max },
        { report_day: "2024-02-29", earned: "1" },
      ];
    if (kind === "weekly spent")
      rows[4] = [
        { report_day: "2024-03-01", spent: max },
        { report_day: "2024-02-29", spent: "1" },
      ];
    if (kind === "weekly signals")
      rows[2] = [
        { report_day: "2024-03-01", replies: max },
        { report_day: "2024-02-29", replies: "1" },
      ];
    if (kind === "trend refunds")
      rows[4] = [
        { report_day: "2024-03-01", refunded: max },
        { report_day: "2024-02-29", refunded: "1" },
      ];
    if (kind === "trend adjustments")
      rows[4] = [
        { report_day: "2024-03-01", adjusted: max },
        { report_day: "2024-02-29", adjusted: "1" },
      ];
    expect((await request(rows)).statusCode).toBe(503);
  });

  it("rejects impossible funnel/status counts instead of emitting plausible percentages", async () => {
    const rows = emptyRows();
    rows[7][0] = { funnel_key: "outreach_reply", started: "1", converted: "2" };
    expect((await request(rows)).statusCode).toBe(503);
    mocks.query.mockReset();
    const statuses = emptyRows();
    statuses[8] = [{ completed: "1", verified: "1", awaiting_review: "1" }];
    expect((await request(statuses)).statusCode).toBe(503);
  });

  it("validates query and ownership before aggregate reads", async () => {
    expect((await request([], `productId=${productId}&days=8`)).statusCode).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
    expect((await request([[]])).statusCode).toBe(404);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("retains only a safe failure category, not database error details, in logs", async () => {
    const logs: string[] = [];
    const canary = "synthetic-report-private-error-canary";
    mocks.query.mockRejectedValueOnce(new Error(canary));
    const app = Fastify({
      logger: {
        stream: {
          write: (line: string) => {
            logs.push(line);
          },
        },
      },
    });
    apps.push(app);
    await registerReportRoutes(app);
    const response = await app.inject({
      method: "GET",
      url: `/report-data?productId=${productId}`,
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain(canary);
    expect(logs.join(" ")).not.toContain(canary);
    const failure = logs
      .map((line) => JSON.parse(line))
      .find((row) => row.category === "REPORT_READ_FAILED");
    expect(failure).toMatchObject({
      category: "REPORT_READ_FAILED",
      msg: "Could not build product report",
    });
    expect(failure).not.toHaveProperty("err");
  });
});
