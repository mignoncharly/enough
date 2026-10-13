import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  integrationAdapter,
  integrationAdapters,
  integrationCatalog,
} from "./integration-adapters.js";

describe("integration adapter contracts", () => {
  it("keeps owner-controlled event adapters separate from vendor sync adapters", () => {
    expect([...integrationAdapters.keys()].sort()).toEqual(["PUBLIC_API", "WEBHOOK"]);
    expect(
      integrationCatalog
        .filter((provider) => provider.available)
        .map((provider) => provider.provider),
    ).toEqual(["WEBHOOK", "PUBLIC_API"]);
    for (const provider of [
      "GMAIL",
      "GOOGLE_CALENDAR",
      "OUTLOOK",
      "MICROSOFT_CALENDAR",
      "STRIPE",
      "POSTHOG",
      "PLAUSIBLE",
      "GA4",
    ] as const) {
      expect(integrationAdapter(provider)).toBeNull();
      expect(integrationCatalog.find((item) => item.provider === provider)?.available).toBe(false);
      expect(integrationCatalog.find((item) => item.provider === provider)?.implemented).toBe(true);
    }
  });

  it("accepts only normalized events and limits monetary values to revenue events", () => {
    const adapter = integrationAdapter("WEBHOOK");
    expect(adapter).not.toBeNull();
    const event = {
      eventId: "payment-1",
      eventType: "revenue.payment_received",
      occurredAt: "2026-10-13T10:00:00Z",
      amountMinor: 500,
      currency: "EUR",
    };
    expect(adapter?.parseEvent(event)).toMatchObject(event);
    expect(() =>
      adapter?.parseEvent({
        ...event,
        eventType: "email.outreach_sent",
      }),
    ).toThrow();
    expect(() => adapter?.parseEvent({ ...event, arbitraryPayload: "not allowed" })).toThrow();
    expect(() => adapter?.parseEvent({ ...event, currency: undefined })).toThrow();
  });

  it("verifies signatures over the exact request bytes and reports account health", () => {
    const adapter = integrationAdapter("PUBLIC_API");
    expect(adapter).not.toBeNull();
    const secret = "fixture-only-secret";
    const timestamp = "1791885600";
    const rawBody = Buffer.from('{"eventId":"evt-1","eventType":"analytics.user_signup"}');
    const signature = `sha256=${createHmac("sha256", secret)
      .update(timestamp)
      .update(".")
      .update(rawBody)
      .digest("hex")}`;
    expect(adapter?.verifyRequest({ secret, timestamp, signature, rawBody })).toBe(true);
    expect(
      adapter?.verifyRequest({ secret, timestamp, signature, rawBody: Buffer.from(`${rawBody} `) }),
    ).toBe(false);
    expect(adapter?.verifyRequest({ secret, timestamp: "bad", signature, rawBody })).toBe(false);
    expect(adapter?.getHealth({ status: "ACTIVE", lastReceivedAt: null })).toBe("IDLE");
    expect(adapter?.getHealth({ status: "ACTIVE", lastReceivedAt: new Date() })).toBe("CONNECTED");
    expect(adapter?.getHealth({ status: "ERROR", lastReceivedAt: null })).toBe("ERROR");
    expect(adapter?.getHealth({ status: "REVOKED", lastReceivedAt: new Date() })).toBe("REVOKED");
  });
});
