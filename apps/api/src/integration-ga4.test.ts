import { describe, expect, it, vi } from "vitest";
import { integrationProviderAdapter } from "./integration-provider-adapters.js";

const headers = {
  metadata: { timeZone: "UTC" },
  dimensionHeaders: [{ name: "date" }, { name: "eventName" }],
  metricHeaders: [{ name: "eventCount" }],
};
const row = (date = "20261016", event = "phase14_acceptance_probe", count = "1") => ({
  dimensionValues: [{ value: date }, { value: event }],
  metricValues: [{ value: count }],
});
const config = {
  propertyId: "123456",
  eventMap: { phase14_acceptance_probe: "analytics.user_signup" },
};
async function sync(
  body: unknown,
  configuration: Record<string, unknown> = config,
  fetcher?: typeof fetch,
) {
  const adapter = integrationProviderAdapter("GA4");
  if (!adapter) throw new Error("GA4 adapter missing");
  return adapter({
    provider: "GA4",
    configuration,
    accessToken: "synthetic-token",
    now: new Date("2026-10-16T12:00:00Z"),
    fetcher: fetcher ?? (async () => new Response(JSON.stringify(body), { status: 200 })),
  });
}
describe("GA4 provider report contract", () => {
  it("keeps an ahead-of-UTC property's current reporting date without creating a future event instant", async () => {
    const events = await sync({
      ...headers,
      metadata: { timeZone: "Pacific/Auckland" },
      rows: [row("20261017")],
    });
    expect(events[0].occurredAt).toBe("2026-10-16T11:00:00.000Z");
  });
  it("includes today in the property timezone, authenticates read-only reports, and normalizes a stable daily marker", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe(
        "https://analyticsdata.googleapis.com/v1beta/properties/123456:runReport",
      );
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-token");
      expect(JSON.parse(String(init?.body))).toEqual({
        dateRanges: [{ startDate: "6daysAgo", endDate: "today" }],
        dimensions: [{ name: "date" }, { name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        dimensionFilter: {
          filter: {
            fieldName: "eventName",
            inListFilter: { values: ["phase14_acceptance_probe"], caseSensitive: true },
          },
        },
        limit: "500",
      });
      return new Response(
        JSON.stringify({
          ...headers,
          metadata: { timeZone: "Pacific/Auckland" },
          rows: [
            row(),
            row(),
            row("20261016", "unknown"),
            row("20261016", "phase14_acceptance_probe", "0"),
          ],
        }),
      );
    });
    const first = await sync(null, config, fetcher);
    const second = await sync(null, config, fetcher);
    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    expect(first[0]).toMatchObject({
      eventType: "analytics.user_signup",
      occurredAt: "2026-10-15T11:00:00.000Z",
      providerOriginVerified: true,
      automaticVerificationEligible: false,
    });
    expect(first[0].userReference).toBeUndefined();
  });
  it("rejects invalid property IDs and event maps before any provider request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const configuration of [
      { ...config, propertyId: "0" },
      { ...config, propertyId: "properties/123456" },
      { ...config, eventMap: {} },
      { ...config, eventMap: { "bad-event": "analytics.user_signup" } },
      { ...config, eventMap: { probe: "revenue.payment_received" } },
    ])
      await expect(sync(null, configuration, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("accepts a valid empty report but rejects malformed success bodies, dates, metrics, and truncated results", async () => {
    expect(await sync(headers)).toEqual([]);
    for (const body of [
      {},
      { ...headers, metadata: { timeZone: "Invalid/Zone" } },
      { ...headers, dimensionHeaders: [{ name: "eventName" }, { name: "date" }] },
      { ...headers, rows: null },
      { ...headers, rows: [row("20260230")] },
      { ...headers, rows: [row("20261016", "phase14_acceptance_probe", "NaN")] },
      { ...headers, rowCount: 1 },
    ])
      await expect(sync(body)).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE" });
    await expect(sync({ ...headers, rows: [row()], rowCount: 501 })).rejects.toMatchObject({
      code: "PROVIDER_RESPONSE_LIMIT",
    });
  });
  it("does not silently discard valid daily events beyond the shared default cap of 100", async () => {
    const eventMap = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`probe_${i}`, "analytics.user_signup"]),
    );
    const rows = Array.from({ length: 7 }, (_, day) =>
      Array.from({ length: 20 }, (_, i) => row(`202610${10 + day}`, `probe_${i}`)),
    ).flat();
    expect(
      await sync({ ...headers, rows, rowCount: 140 }, { propertyId: "123456", eventMap }),
    ).toHaveLength(140);
  });
});
