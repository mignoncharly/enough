import { createHmac } from "node:crypto";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const clientQuery = vi.fn(async (_query: string, _values?: unknown[]) => ({
    rowCount: 1,
    rows: [],
  }));
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query: clientQuery, release }));
  return {
    clientQuery,
    release,
    connect,
    poolQuery: vi.fn(),
    checkRateLimit: vi.fn(async () => true),
  };
});

vi.mock("@enough/db", () => ({ pool: { query: mocks.poolQuery, connect: mocks.connect } }));
vi.mock("@enough/auth", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@enough/config", () => ({
  env: {
    STRIPE_PRICE_MONTHLY: undefined,
    STRIPE_PRICE_ANNUAL: undefined,
    STRIPE_SECRET_KEY: undefined,
    STRIPE_WEBHOOK_SECRETS: "whsec_test",
    STRIPE_TRIAL_DAYS: 0,
    STRIPE_AUTOMATIC_TAX: true,
    BILLING_GRACE_DAYS: 3,
    APP_BASE_URL: "https://app.example.com",
  },
}));
vi.mock("./api-auth.js", () => ({ requireSession: vi.fn(), requireCsrf: vi.fn() }));

import { registerBillingRoutes } from "./billing.js";

describe("billing Stripe webhook route contract", () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  beforeEach(() => {
    mocks.clientQuery.mockReset();
    mocks.clientQuery.mockResolvedValue({ rowCount: 1, rows: [] });
    mocks.connect.mockClear();
    mocks.release.mockClear();
    mocks.poolQuery.mockClear();
    mocks.checkRateLimit.mockClear();
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function createApp() {
    const app = Fastify({ logger: false, bodyLimit: 16 * 1024 });
    app.removeContentTypeParser("application/json");
    app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
      (request as typeof request & { rawJsonBody?: Buffer }).rawJsonBody = Buffer.isBuffer(body)
        ? body
        : Buffer.from(body, "utf8");
      try {
        done(null, JSON.parse(body.toString("utf8")) as unknown);
      } catch {
        done(new Error("Invalid JSON request body."), undefined);
      }
    });
    apps.push(app);
    await registerBillingRoutes(app);
    return app;
  }

  function signature(body: string): string {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const digest = createHmac("sha256", "whsec_test").update(`${timestamp}.${body}`).digest("hex");
    return `t=${timestamp},v1=${digest}`;
  }

  it("rejects altered raw payloads before processing or opening a database transaction", async () => {
    const app = await createApp();
    const body = JSON.stringify({
      id: "evt_test_1",
      type: "test.ignored",
      created: Math.floor(Date.now() / 1000),
      data: { object: {} },
    });
    const response = await app.inject({
      method: "POST",
      url: "/billing/stripe-webhook",
      headers: { "content-type": "application/json", "stripe-signature": signature(body) },
      payload: `${body} `,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid webhook signature." });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("accepts a valid webhook, records it transactionally, and acknowledges the event", async () => {
    const app = await createApp();
    const body = JSON.stringify({
      id: "evt_test2",
      type: "test.ignored",
      created: Math.floor(Date.now() / 1000),
      data: { object: {} },
    });
    const response = await app.inject({
      method: "POST",
      url: "/billing/stripe-webhook",
      headers: { "content-type": "application/json", "stripe-signature": signature(body) },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true });
    expect(
      mocks.clientQuery.mock.calls.map(([query]) =>
        String(query).trim().split(/\s+/).slice(0, 2).join(" "),
      ),
    ).toEqual(["BEGIN", "INSERT INTO", "UPDATE enough.billing_webhook_events", "COMMIT"]);
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it("treats a previously recorded Stripe event as an idempotent duplicate", async () => {
    mocks.clientQuery.mockImplementation(async (query) => ({
      rowCount: String(query).includes("INSERT INTO enough.billing_webhook_events") ? 0 : 1,
      rows: [],
    }));
    const app = await createApp();
    const body = JSON.stringify({
      id: "evt_duplicate1",
      type: "test.ignored",
      created: Math.floor(Date.now() / 1000),
      data: { object: {} },
    });
    const response = await app.inject({
      method: "POST",
      url: "/billing/stripe-webhook",
      headers: { "content-type": "application/json", "stripe-signature": signature(body) },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true });
    expect(mocks.clientQuery.mock.calls.map(([query]) => String(query).trim())).toEqual([
      "BEGIN",
      expect.stringContaining("INSERT INTO enough.billing_webhook_events"),
      "COMMIT",
    ]);
  });
});
