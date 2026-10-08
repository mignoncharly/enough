import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { stripeSignatureMatches } from "./billing-webhook.js";

describe("Stripe webhook signature verification", () => {
  const now = Date.parse("2026-05-01T12:00:00.000Z");
  const timestamp = String(now / 1000);
  const body = Buffer.from('{"id":"evt_test_123","type":"invoice.paid"}', "utf8");
  const signatureFor = (secret: string, signedBody = body, signedAt = timestamp) =>
    createHmac("sha256", secret)
      .update(Buffer.concat([Buffer.from(`${signedAt}.`), signedBody]))
      .digest("hex");

  it("accepts valid payload signatures from configured rotation secrets", () => {
    const current = signatureFor("whsec_current");
    const previous = signatureFor("whsec_previous");
    expect(stripeSignatureMatches(body, `t=${timestamp},v1=${current}`, "whsec_current", now)).toBe(
      true,
    );
    expect(
      stripeSignatureMatches(
        body,
        `t=${timestamp},v1=${previous}`,
        "whsec_current, whsec_previous",
        now,
      ),
    ).toBe(true);
  });

  it("rejects missing, malformed, and invalid-hex signatures", () => {
    const signature = signatureFor("whsec_current");
    expect(stripeSignatureMatches(body, undefined, "whsec_current", now)).toBe(false);
    expect(stripeSignatureMatches(body, `t=${timestamp},v1=${signature}`, undefined, now)).toBe(
      false,
    );
    expect(stripeSignatureMatches(body, `t=abc,v1=${signature}`, "whsec_current", now)).toBe(false);
    expect(stripeSignatureMatches(body, `t=${timestamp},v1=not-hex`, "whsec_current", now)).toBe(
      false,
    );
    expect(stripeSignatureMatches(body, `v1=${signature}`, "whsec_current", now)).toBe(false);
  });

  it("rejects replayed timestamps outside the five-minute window", () => {
    for (const offsetSeconds of [-301, 301]) {
      const replayTimestamp = String(now / 1000 + offsetSeconds);
      const replaySignature = signatureFor("whsec_current", body, replayTimestamp);
      expect(
        stripeSignatureMatches(
          body,
          `t=${replayTimestamp},v1=${replaySignature}`,
          "whsec_current",
          now,
        ),
      ).toBe(false);
    }
  });

  it("rejects altered payloads and signatures from unknown secrets", () => {
    const signature = signatureFor("whsec_current");
    expect(
      stripeSignatureMatches(
        Buffer.from(`${body.toString()} `),
        `t=${timestamp},v1=${signature}`,
        "whsec_current",
        now,
      ),
    ).toBe(false);
    expect(
      stripeSignatureMatches(body, `t=${timestamp},v1=${signature}`, "whsec_unknown", now),
    ).toBe(false);
  });
});
