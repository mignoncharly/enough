import { describe, expect, it, vi } from "vitest";
import { ga4ProbePayload } from "./phase14-ga4-config.mjs";
import { createGtagSeedFixture, receiveGtagSeedHandoff } from "./phase14-ga4-gtag-seed.mjs";

describe("local GA4 gtag seed bridge (no Google network calls)", () => {
  it("allows an authenticated loopback handoff while rejecting remote or invalid handoffs", async () => {
    const nonce = "00000000-0000-4000-8000-000000000000";
    const fetcher = vi.spyOn(globalThis, "fetch");
    try {
      await expect(
        receiveGtagSeedHandoff({ url: "https://example.invalid/identity", nonce }),
      ).rejects.toThrow("Invalid local");
      expect(fetcher).not.toHaveBeenCalled();
      fetcher.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ source: "gtag_callback", clientId: "12345.67890", sessionId: 67890 }),
          { status: 200 },
        ),
      );
      const identity = await receiveGtagSeedHandoff({
        url: "http://127.0.0.1:4431/identity",
        nonce,
      });
      expect(ga4ProbePayload(identity).events[0].name).toBe("phase14_clean_mp_probe");
      expect(fetcher).toHaveBeenCalledWith(
        "http://127.0.0.1:4431/identity",
        expect.objectContaining({ headers: { "x-seed-handoff": nonce }, redirect: "error" }),
      );
      fetcher.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ source: "synthetic", clientId: "12345.67890", sessionId: 67890 }),
          { status: 200 },
        ),
      );
      await expect(
        receiveGtagSeedHandoff({ url: "http://127.0.0.1:4431/identity", nonce }),
      ).rejects.toThrow("Invalid local");
    } finally {
      fetcher.mockRestore();
    }
  });
  it("disables automatic pageviews, exposes no MP secret, and accepts exactly one same-origin seed handoff", async () => {
    let claims = 0;
    const fixture = await createGtagSeedFixture({
      measurementId: "G-SYNTHETIC1",
      port: 0,
      claimSeed: async () => {
        claims++;
      },
    });
    try {
      const response = await fetch(fixture.url);
      expect(response.headers.get("referrer-policy")).toBe("same-origin");
      const page = await response.text();
      expect(page).toContain("send_page_view:false");
      expect(page).toContain("cookie_expires:0");
      expect(page).toContain("phase14_clean_client_seed");
      expect(page).toContain("gtag('get',target,'client_id'");
      expect(page).toContain("gtag('get',target,'session_id'");
      expect(page).not.toContain("api_secret");
      expect(page).not.toContain("/mp/collect");
      const nonce = page.match(/nonce="([a-f0-9-]+)"/)?.[1];
      expect(nonce).toBeTruthy();
      const headers = {
        origin: fixture.url,
        "x-seed-nonce": nonce ?? "",
        "content-type": "application/json",
      };
      const value = { clientId: "12345.67890", sessionId: 67890, seedCompleted: true };
      expect(
        (
          await fetch(`${fixture.url}/identity`, {
            method: "POST",
            headers,
            body: JSON.stringify(value),
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await fetch(`${fixture.url}/seed-claim`, {
            method: "POST",
            headers: { ...headers, origin: "https://example.invalid" },
          })
        ).status,
      ).toBe(403);
      expect((await fetch(`${fixture.url}/seed-claim`, { method: "POST", headers })).status).toBe(
        204,
      );
      expect((await fetch(`${fixture.url}/seed-claim`, { method: "POST", headers })).status).toBe(
        409,
      );
      expect(
        (
          await fetch(`${fixture.url}/identity`, {
            method: "POST",
            headers,
            body: JSON.stringify({ ...value, seedCompleted: false }),
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await fetch(`${fixture.url}/identity`, {
            method: "POST",
            headers,
            body: JSON.stringify(value),
          })
        ).status,
      ).toBe(204);
      const identity = await fixture.waitForIdentity();
      const payload = ga4ProbePayload(identity);
      expect(payload.events).toEqual([
        {
          name: "phase14_clean_mp_probe",
          params: { session_id: 67890, engagement_time_msec: 1 },
        },
      ]);
      expect(payload).not.toHaveProperty("user_id");
      expect(payload).not.toHaveProperty("ip_override");
      expect(claims).toBe(1);
      expect(
        (
          await fetch(`${fixture.url}/identity`, {
            method: "POST",
            headers,
            body: JSON.stringify(value),
          })
        ).status,
      ).toBe(409);
      await fixture.close();
      expect(() => ga4ProbePayload(identity)).toThrow("gtag seed fixture");
    } finally {
      await fixture.close();
    }
  });

  it("fails closed when the durable seed attempt cannot be claimed", async () => {
    const fixture = await createGtagSeedFixture({
      measurementId: "G-SYNTHETIC1",
      port: 0,
      claimSeed: async () => {
        throw new Error("Synthetic already claimed marker");
      },
    });
    try {
      const response = await fetch(fixture.url);
      expect(response.headers.get("referrer-policy")).toBe("same-origin");
      const page = await response.text();
      const nonce = page.match(/nonce="([a-f0-9-]+)"/)?.[1];
      const headers = {
        origin: fixture.url,
        "x-seed-nonce": nonce ?? "",
        "content-type": "application/json",
      };
      expect((await fetch(`${fixture.url}/seed-claim`, { method: "POST", headers })).status).toBe(
        503,
      );
      expect(
        (
          await fetch(`${fixture.url}/identity`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              clientId: "12345.67890",
              sessionId: 67890,
              seedCompleted: true,
            }),
          })
        ).status,
      ).toBe(409);
    } finally {
      await fixture.close();
    }
  });
});
