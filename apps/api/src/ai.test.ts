import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  authenticate: vi.fn(),
  csrf: vi.fn(),
  limit: vi.fn(),
  env: { OPENAI_API_KEY: "synthetic-provider-key", OPENAI_MODEL: "synthetic-model" },
}));
vi.mock("@enough/config", () => ({ env: mocks.env }));
vi.mock("@enough/db", () => ({ pool: { query: mocks.query, connect: mocks.connect } }));
vi.mock("@enough/auth", () => ({
  authenticate: mocks.authenticate,
  validateSessionCsrf: mocks.csrf,
  checkRateLimit: mocks.limit,
}));

import { registerAiRoutes } from "./ai.js";
import { requestLoggerOptions } from "./logging.js";
import { registerPrivacyRoutes } from "./privacy.js";
import { registerTaskRoutes } from "./tasks.js";

const capabilities = [
  "ONBOARDING_ANALYSIS",
  "TASK_GENERATION",
  "SCOPE_CHALLENGE",
  "WEEKLY_DIAGNOSIS",
  "NEXT_ACTION",
  "OVERBUILDING_EXPLANATION",
  "EVIDENCE_CLASSIFICATION",
] as const;
const userId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const selectionId = "33333333-3333-4333-8333-333333333333";
const privateText = "synthetic-private-context-canary";
const task = {
  title: "Interview one tester",
  description: "synthetic-response-canary",
  priority: 3,
  signalStrength: 3,
  estimatedMinutes: 30,
};
const advice = {
  headline: "Choose a small action",
  diagnosis: "synthetic-response-canary",
  nextAction: "Ask one question",
  rationale: "Limited evidence",
  scopeChallenge: "",
  overbuildingExplanation: "",
  tasks: [task],
  evidenceClassification: {
    category: "UNCLEAR",
    confidence: "LOW",
    rationale: "Human review required",
    missingInformation: [],
  },
  caveat: "Advisory only",
};
function complete(text = JSON.stringify(advice)) {
  return {
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text }],
      },
    ],
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}
function body(capability: (typeof capabilities)[number]) {
  return {
    productId,
    capability,
    ...(capability === "SCOPE_CHALLENGE" ? { taskId: selectionId } : {}),
    ...(capability === "EVIDENCE_CLASSIFICATION" ? { evidenceId: selectionId } : {}),
  };
}
let app: FastifyInstance;
let logs: string[];
let consent: boolean | undefined;
let fetcher: ReturnType<typeof vi.fn>;
async function query(sql: string, args: unknown[] = []) {
  if (sql.includes("privacy_consents")) {
    expect(args).toEqual([userId]);
    return { rows: consent === undefined ? [] : [{ enabled: consent }] };
  }
  if (sql.includes("FROM enough.products")) {
    expect(sql).toContain("user_id = $2");
    expect(args).toEqual([productId, userId]);
    return {
      rows: [
        {
          product_stage: "IDEA",
          target_customer: privateText,
          problem_statement: privateText,
          has_launched: false,
          user_count: 1,
          paying_user_count: 0,
          current_revenue: null,
          revenue_currency: "EUR",
        },
      ],
    };
  }
  if (sql.includes("product_goals")) {
    expect(args).toEqual([productId, userId]);
    return { rows: [{ title: privateText }] };
  }
  if (sql.includes("FROM enough.growth_tasks")) {
    expect(sql).toContain("user_id");
    expect(args).toEqual(
      sql.includes("estimated_minutes") ? [selectionId, productId, userId] : [productId, userId],
    );
    return { rows: [{ title: privateText, description: privateText, estimated_minutes: 30 }] };
  }
  if (sql.includes("task_evidence_items")) {
    expect(args).toEqual([selectionId, productId, userId]);
    expect(sql).toContain("deleted_at IS NULL");
    return { rows: [{ evidence_type: "NOTE", title: privateText, note: privateText }] };
  }
  if (sql.includes("activity_event_aggregates")) {
    expect(args).toEqual([productId]);
    return { rows: [{ event_count: "2" }] };
  }
  if (sql.includes("INSERT INTO enough.admin_ai_usage_events")) return { rows: [] };
  throw new Error("Unexpected synthetic query");
}
beforeEach(async () => {
  vi.resetAllMocks();
  consent = true;
  logs = [];
  mocks.env.OPENAI_API_KEY = "synthetic-provider-key";
  mocks.authenticate.mockResolvedValue({ id: userId, deviceId: null });
  mocks.csrf.mockReturnValue(true);
  mocks.limit.mockResolvedValue(true);
  mocks.query.mockImplementation(query);
  fetcher = vi.fn(async () => new Response(JSON.stringify(complete()), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  app = Fastify({
    logger: {
      ...requestLoggerOptions("debug"),
      stream: {
        write(line: string) {
          logs.push(line);
        },
      },
    },
  });
  await registerAiRoutes(app);
  await registerTaskRoutes(app);
  await registerPrivacyRoutes(app);
});
afterEach(async () => {
  await app?.close();
  vi.unstubAllGlobals();
});
function post(capability: (typeof capabilities)[number]) {
  return app.inject({
    method: "POST",
    url: "/ai/coach",
    payload: body(capability),
    headers: { authorization: "Bearer synthetic-auth-canary" },
  });
}
function assertPrivateLogs() {
  for (const canary of [
    privateText,
    "synthetic-response-canary",
    "synthetic-provider-key",
    "synthetic-auth-canary",
    "synthetic-refusal-canary",
  ])
    expect(logs.join("")).not.toContain(canary);
}
function assertNoSideEffects() {
  const writes = mocks.query.mock.calls.filter(([sql]) =>
    /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql),
  );
  expect(writes.every(([sql]) => sql.includes("admin_ai_usage_events"))).toBe(true);
  expect(mocks.connect).not.toHaveBeenCalled();
  assertPrivateLogs();
}

describe.each(capabilities)("Coach %s", (capability) => {
  it("accepts completed advice with scoped minimal context, metadata only and no rewards", async () => {
    const response = await post(capability);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      source: "OPENAI",
      advice: { ...advice, tasks: capability === "TASK_GENERATION" ? [task] : [] },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({
      authorization: "Bearer synthetic-provider-key",
      "content-type": "application/json",
    });
    const payload = JSON.parse(String(init.body));
    expect(payload).toMatchObject({
      store: false,
      max_output_tokens: 1600,
      text: { format: { type: "json_schema", strict: true } },
    });
    const input = JSON.parse(payload.input[1].content[0].text);
    expect(input.capability).toBe(capability);
    expect(Object.keys(input.context).sort()).toEqual(
      {
        ONBOARDING_ANALYSIS: ["stage", "problemContext", "activeGoalTitles"],
        TASK_GENERATION: ["stage", "problemContext", "activeGoalTitles", "activeTaskTitles"],
        SCOPE_CHALLENGE: ["stage", "activeGoalTitles", "selectedTask"],
        WEEKLY_DIAGNOSIS: ["stage", "activeGoalTitles", "traction", "activityEventsLast7Days"],
        NEXT_ACTION: [
          "stage",
          "activeGoalTitles",
          "activeTaskTitles",
          "traction",
          "activityEventsLast7Days",
        ],
        OVERBUILDING_EXPLANATION: ["stage"],
        EVIDENCE_CLASSIFICATION: ["selectedEvidence"],
      }[capability].sort(),
    );
    if (input.context.stage)
      expect(Object.keys(input.context.stage).sort()).toEqual([
        "buildPercent",
        "headline",
        "key",
        "label",
        "marketPercent",
        "priorities",
        "signals",
      ]);
    if (input.context.problemContext)
      expect(Object.keys(input.context.problemContext).sort()).toEqual([
        "problemStatement",
        "targetCustomer",
      ]);
    if (input.context.selectedTask)
      expect(Object.keys(input.context.selectedTask).sort()).toEqual([
        "description",
        "estimatedMinutes",
        "title",
      ]);
    if (input.context.traction)
      expect(Object.keys(input.context.traction).sort()).toEqual([
        "currentRevenue",
        "hasLaunched",
        "payingUsers",
        "revenueCurrency",
        "users",
      ]);
    if (input.context.selectedEvidence)
      expect(Object.keys(input.context.selectedEvidence).sort()).toEqual(["note", "title", "type"]);
    expect(String(init.body)).not.toContain(mocks.env.OPENAI_API_KEY);
    expect(String(init.body)).not.toContain("synthetic-auth-canary");
    expect(response.body).not.toContain(mocks.env.OPENAI_API_KEY);
    for (const id of [userId, productId, selectionId]) expect(String(init.body)).not.toContain(id);
    const usage = mocks.query.mock.calls.find(([sql]) => sql.includes("INSERT"));
    expect(usage?.[1].slice(1, 7)).toEqual([
      userId,
      capability,
      "synthetic-model",
      "SUCCEEDED",
      10,
      20,
    ]);
    assertNoSideEffects();
  });
  it.each([undefined, false, true])(
    "uses deterministic local guidance only when provider disabled (consent=%s)",
    async (enabled) => {
      mocks.env.OPENAI_API_KEY = "";
      consent = enabled;
      const first = await post(capability);
      const second = await post(capability);
      expect(first.statusCode).toBe(200);
      expect(second.json()).toEqual(first.json());
      expect(first.json().source).toBe("STAGE_GUIDANCE");
      expect(first.json().advice.headline).toBeTruthy();
      if (capability !== "TASK_GENERATION") expect(first.json().advice.tasks).toEqual([]);
      expect(fetcher).not.toHaveBeenCalled();
      assertNoSideEffects();
    },
  );
  it.each([
    ["timeout", "TIMEOUT"],
    ["transport", "PROVIDER_ERROR"],
    ["http", "PROVIDER_ERROR"],
    ["incomplete", "INCOMPLETE"],
    ["in_progress", "NOT_COMPLETED"],
    ["queued", "NOT_COMPLETED"],
    ["cancelled", "NOT_COMPLETED"],
    ["failed", "PROVIDER_ERROR"],
    ["missing-status", "MALFORMED"],
    ["invalid-json", "MALFORMED"],
    ["invalid-advice", "MALFORMED"],
    ["invalid-envelope", "MALFORMED"],
  ])("safely classifies %s with no invented advice/fallback", async (scenario, category) => {
    if (scenario === "timeout")
      fetcher.mockRejectedValue(new DOMException(privateText, "TimeoutError"));
    else if (scenario === "transport") fetcher.mockRejectedValue(new Error(privateText));
    else if (scenario === "http")
      fetcher.mockResolvedValue(new Response(privateText, { status: 429 }));
    else {
      const value =
        scenario === "missing-status"
          ? { output: complete().output }
          : scenario === "invalid-json"
            ? complete("not json")
            : scenario === "invalid-advice"
              ? complete('{"headline":"incomplete schema"}')
              : scenario === "invalid-envelope"
                ? { status: "completed", output: {} }
                : { ...complete(), status: scenario };
      fetcher.mockResolvedValue(new Response(JSON.stringify(value)));
    }
    const response = await post(capability);
    expect(response.statusCode).toBe(502);
    expect(response.json().code).toBe(`AI_${category}`);
    expect(response.json()).not.toHaveProperty("advice");
    expect(response.json()).not.toHaveProperty("source");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(logs.join("")).toContain(category);
    assertNoSideEffects();
  });
  it("treats mixed refusal/text as refusal, not outage or usable advice", async () => {
    const value = complete();
    value.output[0].content.push({ type: "refusal", text: "synthetic-refusal-canary" });
    fetcher.mockResolvedValue(new Response(JSON.stringify(value)));
    const response = await post(capability);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ source: "OPENAI", outcome: "REFUSED" });
    expect(response.json()).not.toHaveProperty("advice");
    expect(response.body).not.toContain("synthetic-refusal-canary");
    expect(fetcher).toHaveBeenCalledTimes(1);
    assertNoSideEffects();
  });
  it.each([undefined, false])(
    "denies absent/revoked consent=%s before context/provider",
    async (enabled) => {
      consent = enabled;
      const response = await post(capability);
      expect(response.statusCode).toBe(403);
      expect(fetcher).not.toHaveBeenCalled();
      expect(mocks.query.mock.calls).toHaveLength(1);
      assertNoSideEffects();
    },
  );
  it("rejects a product owned by another account", async () => {
    mocks.query.mockImplementation((sql, args) =>
      sql.includes("FROM enough.products") ? Promise.resolve({ rows: [] }) : query(sql, args),
    );
    const response = await post(capability);
    expect(response.statusCode).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
    assertNoSideEffects();
  });
});

describe("Coach boundaries", () => {
  it("sends only bounded selected evidence text and type, without stage or internal evidence fields", async () => {
    const note = privateText.repeat(200);
    mocks.query.mockImplementation((sql: string, args: unknown[]) =>
      sql.includes("FROM enough.task_evidence_items")
        ? {
            rows: [
              {
                evidence_type: "NOTE",
                title: privateText,
                note,
                id: selectionId,
                user_id: userId,
                product_id: productId,
                file_data: "synthetic-file-canary",
                storage_object_key: "synthetic-storage-canary",
                url: "https://synthetic.example.test/private",
                integration_reference: "synthetic-integration-canary",
              },
            ],
          }
        : query(sql, args),
    );
    expect((await post("EVIDENCE_CLASSIFICATION")).statusCode).toBe(200);
    const submitted = JSON.parse(String(fetcher.mock.calls[0][1].body));
    expect(JSON.parse(submitted.input[1].content[0].text)).toEqual({
      capability: "EVIDENCE_CLASSIFICATION",
      context: {
        selectedEvidence: {
          type: "NOTE",
          title: privateText,
          note: note.slice(0, 1500),
        },
      },
    });
    for (const excluded of [
      userId,
      productId,
      selectionId,
      "synthetic-file-canary",
      "synthetic-storage-canary",
      "https://synthetic.example.test/private",
      "synthetic-integration-canary",
    ])
      expect(String(fetcher.mock.calls[0][1].body)).not.toContain(excluded);
    assertNoSideEffects();
  });
  it("respects actual consent grant/revoke routes on each subsequent request", async () => {
    consent = undefined;
    const client = { query: vi.fn(), release: vi.fn() };
    mocks.connect.mockResolvedValue(client);
    client.query.mockImplementation(async (sql: string, args: unknown[] = []) => {
      if (sql.includes("INSERT INTO enough.privacy_consents")) {
        expect(args[0]).toBe(userId);
        expect(args[1]).toBe("AI_PROVIDER_PROCESSING");
        expect(args[3]).toBe("2026-10-17");
        expect(sql).toContain("policy_version = EXCLUDED.policy_version");
        consent = args[2] as boolean;
        return { rows: [{ purpose: "AI_PROVIDER_PROCESSING", enabled: consent, revision: "1" }] };
      }
      return { rows: [] };
    });
    expect((await post("NEXT_ACTION")).statusCode).toBe(403);
    const grant = await app.inject({
      method: "PUT",
      url: "/privacy-consents/AI_PROVIDER_PROCESSING",
      payload: { enabled: true },
    });
    expect(grant.statusCode).toBe(200);
    expect((await post("NEXT_ACTION")).statusCode).toBe(200);
    const revoke = await app.inject({
      method: "PUT",
      url: "/privacy-consents/AI_PROVIDER_PROCESSING",
      payload: { enabled: false },
    });
    expect(revoke.statusCode).toBe(200);
    expect((await post("NEXT_ACTION")).statusCode).toBe(403);
    expect(fetcher).toHaveBeenCalledTimes(1);
    assertPrivateLogs();
  });
  it("scopes the configured rate limit to the authenticated account", async () => {
    await post("NEXT_ACTION");
    expect(mocks.limit.mock.calls[0].slice(2)).toEqual(["ai:coach", userId, 8, 60]);
  });
  it.each(["SCOPE_CHALLENGE", "EVIDENCE_CLASSIFICATION"] as const)(
    "rejects cross-product selection for %s",
    async (capability) => {
      mocks.query.mockImplementation((sql, args) =>
        sql.includes("WHERE id = $1 AND product_id")
          ? Promise.resolve({ rows: [] })
          : query(sql, args),
      );
      expect((await post(capability)).statusCode).toBe(404);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("rechecks consent after context assembly", async () => {
    mocks.query.mockImplementation(async (sql, args) => {
      const result = await query(sql, args);
      if (sql.includes("FROM enough.products")) consent = false;
      return result;
    });
    expect((await post("OVERBUILDING_EXPLANATION")).statusCode).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["consent", "context", "usage", "session"])(
    "never logs raw %s failures",
    async (path) => {
      if (path === "session") mocks.authenticate.mockRejectedValue(new Error(privateText));
      else
        mocks.query.mockImplementation((sql, args) => {
          if (
            (path === "consent" && sql.includes("privacy_consents")) ||
            (path === "context" && sql.includes("products")) ||
            (path === "usage" && sql.includes("INSERT"))
          )
            throw new Error(privateText);
          return query(sql, args);
        });
      expect((await post("NEXT_ACTION")).statusCode).toBe(path === "usage" ? 200 : 503);
      assertPrivateLogs();
    },
  );
  it.each(["auth", "csrf", "rate"])("enforces %s before context/provider", async (boundary) => {
    if (boundary === "auth") mocks.authenticate.mockResolvedValue(null);
    if (boundary === "csrf") mocks.csrf.mockReturnValue(false);
    if (boundary === "rate")
      mocks.limit.mockImplementation(async (_req, reply) => {
        reply.code(429).send({ error: "Rate limited" });
        return false;
      });
    expect((await post("NEXT_ACTION")).statusCode).toBe(
      boundary === "auth" ? 401 : boundary === "csrf" ? 403 : 429,
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("exposes consent status without keys or context", async () => {
    consent = false;
    const response = await app.inject({ url: "/ai/status" });
    expect(response.json()).toEqual({
      providerConfigured: true,
      providerConsentEnabled: false,
      model: "synthetic-model",
    });
    assertPrivateLogs();
  });
  it("rejects invalid capability/selection combinations before provider use", async () => {
    for (const payload of [
      { productId, capability: "UNKNOWN" },
      { productId, capability: "NEXT_ACTION", taskId: selectionId },
      { productId, capability: "SCOPE_CHALLENGE" },
      { productId, capability: "EVIDENCE_CLASSIFICATION" },
      { productId, capability: "NEXT_ACTION", prompt: "synthetic-extra-input" },
    ])
      expect((await app.inject({ method: "POST", url: "/ai/coach", payload })).statusCode).toBe(
        400,
      );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("filters repeated/existing task titles and invalid usage counts", async () => {
    const value = complete(
      JSON.stringify({
        ...advice,
        tasks: [
          task,
          { ...task, title: ` ${task.title.toUpperCase()} ` },
          { ...task, title: privateText },
        ],
      }),
    );
    value.usage = { input_tokens: -1, output_tokens: 2 ** 40 };
    fetcher.mockResolvedValue(new Response(JSON.stringify(value)));
    expect((await post("TASK_GENERATION")).json().advice.tasks).toEqual([task]);
    expect(mocks.query.mock.calls.find(([sql]) => sql.includes("INSERT"))?.[1].slice(5, 7)).toEqual(
      [null, null],
    );
  });
  it.each([
    "partial-message",
    "multiple-text",
    "output-text-only",
    "refusal-only",
    "invalid-json-body",
  ])("handles REST output edge case %s", async (scenario) => {
    const value = complete();
    if (scenario === "partial-message") value.output[0].status = "incomplete";
    if (scenario === "multiple-text") value.output[0].content.push(value.output[0].content[0]);
    const raw =
      scenario === "output-text-only"
        ? { status: "completed", output_text: JSON.stringify(advice) }
        : scenario === "refusal-only"
          ? {
              status: "completed",
              output: [
                {
                  type: "message",
                  role: "assistant",
                  status: "completed",
                  content: [{ type: "refusal", refusal: "synthetic-refusal-canary" }],
                },
              ],
            }
          : value;
    fetcher.mockResolvedValue(
      new Response(scenario === "invalid-json-body" ? privateText : JSON.stringify(raw)),
    );
    const response = await post("TASK_GENERATION");
    expect(response.statusCode).toBe(scenario === "refusal-only" ? 200 : 502);
    expect(response.json()).not.toHaveProperty("advice");
    assertPrivateLogs();
  });
});

describe("Coach uses the ordinary zero-reward task route", () => {
  it.each(["connect", "rollback"])("sanitizes task %s failures", async (path) => {
    if (path === "connect") mocks.connect.mockRejectedValue(new Error(privateText));
    else
      mocks.connect.mockResolvedValue({
        query: vi.fn().mockRejectedValue(new Error(privateText)),
        release: vi.fn(),
      });
    const response = await app.inject({
      method: "POST",
      url: "/growth-tasks",
      payload: { productId, ...task, rewardCredits: 0 },
    });
    expect(response.statusCode).toBe(503);
    assertPrivateLogs();
  });
  it.each([true, false])(
    "scopes explicit task creation to owner (owned=%s) without issuing credits",
    async (owned) => {
      const client = { query: vi.fn(), release: vi.fn() };
      mocks.connect.mockResolvedValue(client);
      client.query.mockImplementation(async (sql: string, args: unknown[]) => {
        if (sql.includes("FROM enough.products")) {
          expect(args).toEqual([productId, userId]);
          return { rows: owned ? [{ id: productId, product_stage: "IDEA" }] : [] };
        }
        if (sql.includes("INSERT INTO enough.growth_tasks")) {
          expect(args[1]).toBe(userId);
          expect(args[2]).toBe(productId);
          expect(args[9]).toBe(0);
          return {
            rows: [
              {
                id: selectionId,
                product_id: productId,
                title: task.title,
                reward_credits: 0,
                created_at: new Date(0),
                updated_at: new Date(0),
              },
            ],
          };
        }
        return { rows: [] };
      });
      const response = await app.inject({
        method: "POST",
        url: "/growth-tasks",
        payload: { productId, ...task, rewardCredits: 0 },
      });
      expect(response.statusCode).toBe(owned ? 201 : 404);
      if (owned) expect(response.json().task.rewardCredits).toBe(0);
      expect(
        client.query.mock.calls.some(([sql]) =>
          /credit_transactions|growth_task_completions/.test(sql),
        ),
      ).toBe(false);
      expect(client.release).toHaveBeenCalledOnce();
      assertPrivateLogs();
    },
  );
  it("sanitizes task persistence errors containing private advice", async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT")) throw new Error(privateText);
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    mocks.connect.mockResolvedValue(client);
    const response = await app.inject({
      method: "POST",
      url: "/growth-tasks",
      payload: { productId, ...task, rewardCredits: 0 },
    });
    expect(response.statusCode).toBe(503);
    assertPrivateLogs();
  });
});
