import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  validateStripeRestrictedKey,
  verifyStripeSignature,
  verifyStripeWebhook,
} from "./integration-stripe.js";

const secret = "whsec_phase14_protocol_fixture_secret";
const now = new Date("2026-10-13T12:00:00.000Z");
const completionId = "60eeb981-2a46-4d65-96b3-b318727221f8";

function payload(type: string, object: Record<string, unknown>, id = "evt_phase14payment") {
  return {
    id,
    type,
    created: Math.floor(now.getTime() / 1000) - 15,
    livemode: false,
    data: { object },
  };
}

function signed(body: Buffer, timestamp = Math.floor(now.getTime() / 1000)): string {
  const signature = createHmac("sha256", secret)
    .update(String(timestamp))
    .update(".")
    .update(body)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Stripe customer-revenue protocol", () => {
  it("requires Events read and supports anonymous sandbox credentials without weakening standard key checks", async () => {
    const seen: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      const requestUrl = String(url);
      seen.push(requestUrl);
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("authorization")).toMatch(/^Bearer rk/);
      if (requestUrl === "https://api.stripe.com/v1/account")
        return response({ id: "acct_phase14fixture" });
      if (requestUrl === "https://api.stripe.com/v1/events?limit=1")
        return response({ object: "list", data: [] });
      throw new Error("Unexpected Stripe capability probe.");
    });
    await expect(
      validateStripeRestrictedKey({ apiKey: "rk_test_fixturekey", fetcher }),
    ).resolves.toBe("acct_phase14fixture");
    await expect(
      validateStripeRestrictedKey({ apiKey: "rk_live_fixturekey", fetcher }),
    ).resolves.toBe("acct_phase14fixture");
    expect(seen).toEqual([
      "https://api.stripe.com/v1/account",
      "https://api.stripe.com/v1/events?limit=1",
      "https://api.stripe.com/v1/account",
      "https://api.stripe.com/v1/events?limit=1",
    ]);

    const sandboxCalls: string[] = [];
    const sandboxFetcher = vi.fn<typeof fetch>(async (url, init) => {
      sandboxCalls.push(String(url));
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer rkcs_test_fixturekey");
      if (String(url) === "https://api.stripe.com/v1/account") return response({}, 403);
      return response({ object: "list", data: [] });
    });
    await expect(
      validateStripeRestrictedKey({
        apiKey: "rkcs_test_fixturekey",
        accountId: "acct_phase14sandbox",
        fetcher: sandboxFetcher,
      }),
    ).resolves.toBe("acct_phase14sandbox");
    expect(sandboxCalls).toEqual(["https://api.stripe.com/v1/events?limit=1"]);

    await expect(
      validateStripeRestrictedKey({
        apiKey: "rkcs_test_fixturekey",
        fetcher: sandboxFetcher,
      }),
    ).rejects.toMatchObject({ code: "INVALID_STRIPE_CREDENTIAL" });
    await expect(
      validateStripeRestrictedKey({
        apiKey: "rkcs_test_fixturekey",
        accountId: "acct_bad-id",
        fetcher: sandboxFetcher,
      }),
    ).rejects.toMatchObject({ code: "INVALID_STRIPE_CREDENTIAL" });
    await expect(
      validateStripeRestrictedKey({
        apiKey: "rk_test_fixturekey",
        accountId: "acct_different",
        fetcher,
      }),
    ).rejects.toMatchObject({ code: "INVALID_STRIPE_CREDENTIAL" });
    await expect(
      validateStripeRestrictedKey({ apiKey: "rkcs_live_fixturekey", accountId: "acct_phase14" }),
    ).rejects.toMatchObject({ code: "INVALID_STRIPE_CREDENTIAL" });
    await expect(
      validateStripeRestrictedKey({ apiKey: "sk_test_secret", fetcher }),
    ).rejects.toMatchObject({ code: "INVALID_STRIPE_CREDENTIAL" });
  });

  it("rejects a standard key that can read Account but cannot read Events and hides authentication details", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      if (String(url) === "https://api.stripe.com/v1/account")
        return response({ id: "acct_phase14fixture" });
      return response({ error: { message: "sensitive permission detail" } }, 403);
    });
    await expect(
      validateStripeRestrictedKey({ apiKey: "rk_test_eventsdenied", fetcher }),
    ).rejects.toMatchObject({ code: "PROVIDER_AUTHENTICATION_FAILED" });
    expect(fetcher).toHaveBeenCalledTimes(2);

    await expect(
      validateStripeRestrictedKey({
        apiKey: "rk_test_expired",
        fetcher: async () => response({ error: { message: "sensitive credential detail" } }, 401),
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_AUTHENTICATION_FAILED" });
  });

  it("requires a fresh vendor signature and confirms the event through Stripe before auto eligibility", async () => {
    const body = Buffer.from(
      JSON.stringify(
        payload("payment_intent.succeeded", {
          id: "pi_phase14payment",
          amount_received: 5000,
          currency: "eur",
          metadata: { enough_task_completion_id: completionId },
        }),
      ),
    );
    const signature = signed(body);
    expect(
      verifyStripeSignature({
        rawBody: body,
        signatureHeader: signature,
        signingSecret: secret,
        now,
      }),
    ).toBe(true);
    expect(
      verifyStripeSignature({
        rawBody: body,
        signatureHeader: signature,
        signingSecret: "owner-chosen-secret",
        now,
      }),
    ).toBe(false);
    expect(
      verifyStripeSignature({
        rawBody: body,
        signatureHeader: signed(body, Math.floor(now.getTime() / 1000) - 301),
        signingSecret: secret,
        now,
      }),
    ).toBe(false);

    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe("https://api.stripe.com/v1/events/evt_phase14payment");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer rk_test_readonlykey");
      return new Response(body);
    });
    const event = await verifyStripeWebhook({
      rawBody: body,
      signatureHeader: signature,
      signingSecret: secret,
      restrictedApiKey: "rk_test_readonlykey",
      expectedAccountId: "acct_phase14fixture",
      expectedLivemode: false,
      now,
      fetcher,
    });
    expect(event).toMatchObject({
      eventType: "revenue.payment_received",
      completionId,
      amountMinor: 5000,
      currency: "EUR",
      providerOriginVerified: true,
      automaticVerificationEligible: true,
    });
    expect(event.eventId).not.toContain("evt_phase14payment");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("never auto verifies zero, unqualified, or non-payment events and normalizes refunds/cancellations", async () => {
    const cases = [
      [
        "payment_intent.succeeded",
        {
          id: "pi_zero",
          amount_received: 0,
          currency: "usd",
          metadata: { enough_task_completion_id: completionId },
        },
        "revenue.payment_received",
      ],
      [
        "checkout.session.completed",
        {
          id: "cs_completed",
          amount_total: 1200,
          currency: "usd",
          metadata: { enough_task_completion_id: completionId },
        },
        "revenue.checkout_completed",
      ],
      [
        "customer.subscription.created",
        { id: "sub_created", currency: "usd" },
        "revenue.subscription_created",
      ],
      [
        "customer.subscription.deleted",
        { id: "sub_cancelled", currency: "usd" },
        "revenue.subscription_cancelled",
      ],
      [
        "charge.refunded",
        { id: "ch_refunded", amount_refunded: 500, currency: "usd" },
        "revenue.payment_refunded",
      ],
      [
        "invoice.paid",
        { id: "in_paid", amount_paid: 1200, currency: "usd" },
        "revenue.invoice_paid",
      ],
    ] as const;
    for (const [type, object, expectedType] of cases) {
      const raw = Buffer.from(
        JSON.stringify(payload(type, object, `evt_${type.replaceAll(/[^A-Za-z0-9]/g, "")}`)),
      );
      const event = await verifyStripeWebhook({
        rawBody: raw,
        signatureHeader: signed(raw),
        signingSecret: secret,
        restrictedApiKey: "rk_test_readonlykey",
        expectedAccountId: "acct_phase14fixture",
        expectedLivemode: false,
        now,
        fetcher: async (_url, init) => {
          expect(init?.redirect).toBe("error");
          return new Response(raw);
        },
      });
      expect(event.eventType).toBe(expectedType);
      expect(event.providerOriginVerified).toBe(true);
      expect(event.automaticVerificationEligible).toBe(false);
    }
  });

  it("rejects invalid signatures and provider-confirmation mismatches before event ingestion", async () => {
    const raw = Buffer.from(
      JSON.stringify(
        payload("payment_intent.succeeded", {
          id: "pi_phase14payment",
          amount_received: 1000,
          currency: "usd",
        }),
      ),
    );
    const fetcher = vi.fn<typeof fetch>(async () => response({}));
    await expect(
      verifyStripeWebhook({
        rawBody: raw,
        signatureHeader: "t=1,v1=bad",
        signingSecret: secret,
        restrictedApiKey: "rk_test_readonlykey",
        expectedAccountId: "acct_phase14fixture",
        expectedLivemode: false,
        now,
        fetcher,
      }),
    ).rejects.toMatchObject({ code: "INVALID_STRIPE_SIGNATURE" });
    expect(fetcher).not.toHaveBeenCalled();

    const malformed = Buffer.from("{");
    await expect(
      verifyStripeWebhook({
        rawBody: malformed,
        signatureHeader: signed(malformed),
        signingSecret: secret,
        restrictedApiKey: "rk_test_readonlykey",
        expectedAccountId: "acct_phase14fixture",
        expectedLivemode: false,
        now,
        fetcher,
      }),
    ).rejects.toMatchObject({ code: "INVALID_STRIPE_EVENT" });
    expect(fetcher).not.toHaveBeenCalled();

    const event = payload("payment_intent.succeeded", {
      id: "pi_other",
      amount_received: 1000,
      currency: "usd",
    });
    const fetchEvent = Buffer.from(
      JSON.stringify({ ...event, data: { object: { ...event.data.object, id: "pi_different" } } }),
    );
    await expect(
      verifyStripeWebhook({
        rawBody: raw,
        signatureHeader: signed(raw),
        signingSecret: secret,
        restrictedApiKey: "rk_test_readonlykey",
        expectedAccountId: "acct_phase14fixture",
        expectedLivemode: false,
        now,
        fetcher: async () => new Response(fetchEvent),
      }),
    ).rejects.toMatchObject({ code: "STRIPE_EVENT_MISMATCH" });

    const reference = payload("payment_intent.succeeded", {
      id: "pi_phase14confirmed",
      amount_received: 2500,
      currency: "usd",
      metadata: { enough_task_completion_id: completionId },
    });
    const referenceBody = Buffer.from(JSON.stringify(reference));
    const mismatches: Array<[string, Record<string, unknown>]> = [
      ["event ID", { ...reference, id: "evt_different" }],
      ["event type", { ...reference, type: "invoice.paid" }],
      ["creation time", { ...reference, created: reference.created + 1 }],
      [
        "object identity",
        { ...reference, data: { object: { ...reference.data.object, id: "pi_other" } } },
      ],
      ["live/test mode", { ...reference, livemode: true }],
      [
        "account context",
        { ...reference, account: "acct_other", data: { object: reference.data.object } },
      ],
      [
        "positive amount",
        {
          ...reference,
          data: { object: { ...reference.data.object, amount_received: 1 } },
        },
      ],
      [
        "completion metadata",
        {
          ...reference,
          data: {
            object: {
              ...reference.data.object,
              metadata: { enough_task_completion_id: "e7b46bd6-9cb1-4ddc-8c08-59e88f493661" },
            },
          },
        },
      ],
    ];
    for (const mismatch of mismatches.map(([, value]) => value)) {
      await expect(
        verifyStripeWebhook({
          rawBody: referenceBody,
          signatureHeader: signed(referenceBody),
          signingSecret: secret,
          restrictedApiKey: "rk_test_readonlykey",
          expectedAccountId: "acct_phase14fixture",
          expectedLivemode: false,
          now,
          fetcher: async () => response(mismatch),
        }),
      ).rejects.toMatchObject({ code: "STRIPE_EVENT_MISMATCH" });
    }

    await expect(
      verifyStripeWebhook({
        rawBody: referenceBody,
        signatureHeader: signed(referenceBody),
        signingSecret: secret,
        restrictedApiKey: "rk_test_readonlykey",
        expectedAccountId: "acct_phase14fixture",
        expectedLivemode: false,
        now,
        fetcher: async () => response({ error: { message: "private event denial" } }, 403),
      }),
    ).rejects.toMatchObject({ code: "STRIPE_EVENT_NOT_CONFIRMED" });

    await expect(
      verifyStripeWebhook({
        rawBody: referenceBody,
        signatureHeader: signed(referenceBody),
        signingSecret: secret,
        restrictedApiKey: "rk_test_readonlykey",
        expectedAccountId: "acct_phase14fixture",
        expectedLivemode: true,
        now,
        fetcher: async () => new Response(referenceBody),
      }),
    ).rejects.toMatchObject({ code: "STRIPE_EVENT_MISMATCH" });
  });

  it("keeps Phase 14 fixture credentials out of console output", async () => {
    const fixtureSource = await readFile(
      new URL("../../../scripts/phase14-manual-account.mjs", import.meta.url),
      "utf8",
    );
    const consoleLines = fixtureSource
      .split(/\r?\n/)
      .filter((line) => /\bconsole\.(?:info|log|warn|error)\(/.test(line));
    expect(consoleLines.join("\n")).not.toMatch(/password|session\.token|csrfToken|cookie/i);
  });
});
