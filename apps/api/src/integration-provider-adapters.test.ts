import { describe, expect, it, vi } from "vitest";
import { integrationProviderAdapter, ProviderApiError } from "./integration-provider-adapters.js";

const now = new Date("2026-10-13T12:00:00.000Z");
const emailSent = Date.parse("2026-10-12T10:00:00.000Z");

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sync(
  provider: Parameters<typeof integrationProviderAdapter>[0],
  fetcher: typeof fetch,
  configuration: Record<string, unknown> = {},
  syncNow = now,
) {
  const adapter = integrationProviderAdapter(provider);
  if (!adapter) throw new Error(`Missing provider adapter: ${provider}`);
  const guardedFetcher: typeof fetch = async (input, init) => {
    expect(init?.redirect).toBe("error");
    return fetcher(input, init);
  };
  return adapter({
    provider,
    accessToken: "opaque-test-token",
    configuration,
    now: syncNow,
    fetcher: guardedFetcher,
  });
}

describe("provider sync contracts", () => {
  it("syncs Gmail metadata without bodies and hashes recipients while detecting continued threads", async () => {
    const urls: URL[] = [];
    const fetcher: typeof fetch = async (value) => {
      const url = new URL(String(value));
      urls.push(url);
      if (url.searchParams.has("labelIds")) {
        return json({
          messages:
            url.searchParams.get("labelIds") === "SENT"
              ? [{ id: "message-sent" }]
              : [{ id: "reply-one" }, { id: "reply-two" }],
        });
      }
      if (url.pathname.endsWith("/message-sent"))
        return json({
          id: "message-sent",
          threadId: "thread-opaque",
          internalDate: String(emailSent),
          payload: { headers: [{ name: "To", value: "Alice@example.com, alice@example.com" }] },
        });
      const suffix = url.pathname.endsWith("/reply-one") ? "one" : "two";
      return json({
        id: `reply-${suffix}`,
        threadId: "thread-opaque",
        internalDate: String(emailSent + 3600_000),
        payload: { headers: [{ name: "From", value: "Alice@example.com" }] },
      });
    };
    const events = await sync("GMAIL", fetcher);
    expect(events.map((event) => event.eventType)).toEqual([
      "email.outreach_sent",
      "email.reply_received",
      "email.reply_received",
      "email.conversation_continued",
    ]);
    expect(events[0].userReference).not.toContain("alice@example.com");
    expect(events[0].eventId).not.toContain("message-sent");
    expect(
      events.every((event) => event.providerOriginVerified && !event.automaticVerificationEligible),
    ).toBe(true);
    expect(urls.filter((url) => url.searchParams.get("format") === "metadata")).toHaveLength(3);
    expect(
      urls.every(
        (url) => !url.searchParams.has("format") || url.searchParams.get("format") === "metadata",
      ),
    ).toBe(true);
    expect(urls.some((url) => url.searchParams.has("attachments"))).toBe(false);
  });

  it("syncs Outlook metadata with duplicate recipient suppression and continued conversation signals", async () => {
    const urls: URL[] = [];
    const fetcher: typeof fetch = async (value) => {
      const url = new URL(String(value));
      urls.push(url);
      if (url.pathname.endsWith("/sentitems/messages"))
        return json({
          value: [
            {
              id: "outlook-sent",
              conversationId: "conversation-opaque",
              sentDateTime: "2026-10-12T10:00:00Z",
              toRecipients: [
                { emailAddress: { address: "alice@example.com" } },
                { emailAddress: { address: "ALICE@example.com" } },
              ],
            },
          ],
        });
      return json({
        value: ["reply-a", "reply-b"].map((id) => ({
          id,
          conversationId: "conversation-opaque",
          receivedDateTime: "2026-10-12T11:00:00Z",
          from: { emailAddress: { address: "alice@example.com" } },
        })),
      });
    };
    const events = await sync("OUTLOOK", fetcher);
    expect(events.map((event) => event.eventType)).toEqual([
      "email.outreach_sent",
      "email.reply_received",
      "email.reply_received",
      "email.conversation_continued",
    ]);
    expect(events[0].userReference).not.toContain("alice@example.com");
    expect(urls.every((url) => !url.searchParams.get("$select")?.includes("body"))).toBe(true);
    const repeatedEvents = await sync("OUTLOOK", fetcher, {}, new Date(now.getTime() + 60_000));
    expect(repeatedEvents).toEqual(events);
  });

  it("skips out-of-window Outlook messages without failing valid mail normalization", async () => {
    const fetcher: typeof fetch = async (value) => {
      const url = new URL(String(value));
      if (url.pathname.endsWith("/sentitems/messages"))
        return json({
          value: [
            {
              id: "outlook-too-old",
              conversationId: "old-conversation",
              sentDateTime: "2024-01-01T10:00:00Z",
              toRecipients: [{ emailAddress: { address: "old@example.test" } }],
            },
            {
              id: "outlook-future",
              conversationId: "future-conversation",
              sentDateTime: "2026-10-13T12:06:00Z",
              toRecipients: [{ emailAddress: { address: "future@example.test" } }],
            },
            {
              id: "outlook-current",
              conversationId: "current-conversation",
              sentDateTime: "2026-10-12T10:00:00Z",
              toRecipients: [{ emailAddress: { address: "current@example.test" } }],
            },
          ],
        });
      return json({
        value: [
          {
            id: "reply-too-old",
            conversationId: "old-conversation",
            receivedDateTime: "2024-01-02T10:00:00Z",
            from: { emailAddress: { address: "old@example.test" } },
          },
          {
            id: "reply-future",
            conversationId: "future-conversation",
            receivedDateTime: "2026-10-13T12:06:00Z",
            from: { emailAddress: { address: "future@example.test" } },
          },
          ...["reply-current-a", "reply-current-b"].map((id) => ({
            id,
            conversationId: "current-conversation",
            receivedDateTime: "2026-10-12T11:00:00Z",
            from: { emailAddress: { address: "current@example.test" } },
          })),
        ],
      });
    };
    const events = await sync("OUTLOOK", fetcher);
    expect(events.map((event) => event.eventType)).toEqual([
      "email.outreach_sent",
      "email.reply_received",
      "email.reply_received",
      "email.conversation_continued",
    ]);
    expect(events.some((event) => /too-old|future/.test(event.eventId))).toBe(false);
  });

  it("only emits completed, categorized calendar events and never makes them automatically eligible", async () => {
    const google = await sync("GOOGLE_CALENDAR", async () =>
      json({
        items: [
          {
            id: "interview-done",
            status: "confirmed",
            summary: "Customer interview",
            end: { dateTime: "2026-10-12T10:00:00Z" },
          },
          {
            id: "interview-done",
            status: "confirmed",
            summary: "Customer interview",
            end: { dateTime: "2026-10-12T10:00:00Z" },
          },
          {
            id: "sales-call-done",
            status: "confirmed",
            summary: "Sales call",
            end: { dateTime: "2026-10-12T10:00:00Z" },
          },
          {
            id: "onboarding-done",
            status: "confirmed",
            summary: "Customer onboarding",
            end: { dateTime: "2026-10-12T10:00:00Z" },
          },
          {
            id: "feedback-done",
            status: "confirmed",
            summary: "Customer feedback",
            end: { dateTime: "2026-10-12T10:00:00Z" },
          },
          {
            id: "retention-done",
            status: "confirmed",
            summary: "Renewal meeting",
            end: { dateTime: "2026-10-12T10:00:00Z" },
          },
          {
            id: "interview-future",
            status: "confirmed",
            summary: "Interview",
            end: { dateTime: "2026-10-14T10:00:00Z" },
          },
          {
            id: "interview-cancelled",
            status: "cancelled",
            summary: "Interview",
            end: { dateTime: "2026-10-12T10:00:00Z" },
          },
          {
            id: "uncategorized",
            status: "confirmed",
            summary: "Private meeting",
            end: { dateTime: "2026-10-12T10:00:00Z" },
          },
        ],
      }),
    );
    expect(google.map((event) => event.eventType)).toEqual([
      "calendar.interview_completed",
      "calendar.sales_call_completed",
      "calendar.onboarding_completed",
      "calendar.feedback_call_completed",
      "calendar.retention_call_completed",
    ]);
    expect(
      google.filter((event) => event.eventType === "calendar.interview_completed"),
    ).toHaveLength(1);
    const microsoft = await sync("MICROSOFT_CALENDAR", async () =>
      json({
        value: [
          {
            id: "demo-done",
            subject: "Customer demo",
            end: { dateTime: "2026-10-12T10:00:00Z" },
            isCancelled: false,
            showAs: "busy",
          },
          {
            id: "demo-free",
            subject: "Demo",
            end: { dateTime: "2026-10-12T10:00:00Z" },
            isCancelled: false,
            showAs: "free",
          },
          {
            id: "demo-cancelled",
            subject: "Demo",
            end: { dateTime: "2026-10-12T10:00:00Z" },
            isCancelled: true,
            showAs: "busy",
          },
          {
            id: "demo-future",
            subject: "Demo",
            end: { dateTime: "2026-10-14T10:00:00Z" },
            isCancelled: false,
            showAs: "busy",
          },
        ],
      }),
    );
    expect(microsoft.map((event) => event.eventType)).toEqual(["calendar.demo_completed"]);
    expect([...google, ...microsoft].every((event) => !event.automaticVerificationEligible)).toBe(
      true,
    );
  });

  it("uses aggregated PostHog data with stable daily event IDs and safe retry behavior", async () => {
    const queries: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer opaque-test-token");
      const body = JSON.parse(String(init?.body)) as { query: { query: string } };
      queries.push(body.query.query);
      return json({ results: [["signup", "2026-10-12", queries.length === 1 ? 3 : 8]] });
    });
    const configuration = {
      projectId: "12345",
      region: "eu",
      eventMap: { signup: "analytics.user_signup" },
    };
    const first = await sync("POSTHOG", fetcher, configuration);
    const second = await sync("POSTHOG", fetcher, configuration);
    expect(first[0].eventId).toBe(second[0].eventId);
    expect(first[0].eventType).toBe("analytics.user_signup");
    expect(queries[0]).toContain("count()");
    expect(queries[0]).toContain("event IN ('signup')");
    expect(JSON.stringify(first)).not.toContain("distinct_id");

    const temporaryFailure = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({ results: [] }));
    await expect(sync("POSTHOG", temporaryFailure, configuration)).resolves.toEqual([]);
    expect(temporaryFailure).toHaveBeenCalledTimes(2);
  });

  it("uses aggregated Plausible and GA4 events without raw identifiers and stable daily IDs", async () => {
    const plausibleFetcher: typeof fetch = async (url, init) => {
      expect(String(url)).toBe("https://plausible.io/api/v2/query");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer opaque-test-token");
      expect(String(init?.body)).not.toContain("user_id");
      return json({ results: [{ dimensions: ["2026-10-12"], metrics: [5] }] });
    };
    const plausibleConfiguration = {
      siteId: "example.test",
      eventMap: { Signup: "analytics.user_signup" },
    };
    const plausible = await sync("PLAUSIBLE", plausibleFetcher, plausibleConfiguration);
    const plausibleReplay = await sync("PLAUSIBLE", plausibleFetcher, plausibleConfiguration);
    expect(plausible[0].eventType).toBe("analytics.user_signup");
    expect(plausibleReplay[0].eventId).toBe(plausible[0].eventId);

    const ga4Fetcher: typeof fetch = async (url, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer opaque-test-token");
      expect(String(url)).toBe(
        "https://analyticsdata.googleapis.com/v1beta/properties/987654:runReport",
      );
      expect(String(init?.body)).not.toContain("userId");
      return json({
        rows: [
          {
            dimensionValues: [{ value: "20261012" }, { value: "purchase" }],
            metricValues: [{ value: "12" }],
          },
        ],
      });
    };
    const ga4Configuration = {
      propertyId: "987654",
      eventMap: { purchase: "analytics.conversion_completed" },
    };
    const ga4 = await sync("GA4", ga4Fetcher, ga4Configuration);
    const ga4Replay = await sync("GA4", ga4Fetcher, ga4Configuration);
    expect(ga4[0].eventType).toBe("analytics.conversion_completed");
    expect(ga4Replay[0].eventId).toBe(ga4[0].eventId);
    expect(plausible[0].userReference).toBeUndefined();
    expect(ga4[0].userReference).toBeUndefined();
    expect(ga4[0].automaticVerificationEligible).toBe(false);
    await expect(
      sync("POSTHOG", async () => json({ results: [] }), {
        projectId: "12345",
        region: "us",
        eventMap: { payment: "revenue.payment_received" },
      }),
    ).rejects.toThrow();
    const invalidConfigFetcher = vi.fn<typeof fetch>();
    await expect(
      sync("POSTHOG", invalidConfigFetcher, {
        projectId: "not-a-project",
        region: "eu",
        eventMap: { signup: "analytics.user_signup" },
      }),
    ).rejects.toThrow();
    await expect(
      sync("PLAUSIBLE", invalidConfigFetcher, {
        siteId: "https://example.test/path",
        eventMap: { Signup: "analytics.user_signup" },
      }),
    ).rejects.toThrow();
    await expect(
      sync("GA4", invalidConfigFetcher, {
        propertyId: "not-a-property",
        eventMap: { purchase: "analytics.conversion_completed" },
      }),
    ).rejects.toThrow();
    expect(invalidConfigFetcher).not.toHaveBeenCalled();
  });

  it("records provider error codes without returning provider response content", async () => {
    await expect(
      sync("GMAIL", async () => json({ error: "private provider diagnostic" }, 401)),
    ).rejects.toMatchObject({ code: "PROVIDER_HTTP_401" });
    try {
      await sync("GMAIL", async () => json({ error: "secret" }, 401));
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderApiError);
      expect((error as Error).message).not.toContain("secret");
    }
  });
});
