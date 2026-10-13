import { createHash, createHmac } from "node:crypto";
import { env } from "@enough/config";
import { z } from "zod";
import type {
  IntegrationProvider,
  NormalizedIntegrationEvent,
  VerifiedEventType,
} from "./integration-adapters.js";

export interface ProviderSyncEvent extends NormalizedIntegrationEvent {
  providerOriginVerified: true;
  automaticVerificationEligible: false;
}

export interface ProviderSyncInput {
  provider: IntegrationProvider;
  accessToken: string;
  configuration: Record<string, unknown>;
  now?: Date;
  fetcher?: typeof fetch;
}

export class ProviderApiError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("The connected provider could not complete the sync request.");
    this.name = "ProviderApiError";
    this.code = code;
  }
}

const analyticsEventTypes = [
  "analytics.user_signup",
  "analytics.user_activated",
  "analytics.trial_started",
  "analytics.conversion_completed",
  "analytics.user_retained",
  "analytics.user_churned",
] as const satisfies readonly VerifiedEventType[];

const eventMapSchema = z
  .record(z.string().trim().min(1).max(100), z.enum(analyticsEventTypes))
  .refine((value) => Object.keys(value).length > 0 && Object.keys(value).length <= 20);
const defaultCalendarCategories: Array<[RegExp, VerifiedEventType]> = [
  [/\b(interview|user research)\b/i, "calendar.interview_completed"],
  [/\b(demo|product demonstration)\b/i, "calendar.demo_completed"],
  [/\b(sales call|sales meeting)\b/i, "calendar.sales_call_completed"],
  [/\b(onboarding|customer setup)\b/i, "calendar.onboarding_completed"],
  [/\b(feedback|customer feedback)\b/i, "calendar.feedback_call_completed"],
  [/\b(retention|renewal)\b/i, "calendar.retention_call_completed"],
];

function opaqueReference(provider: string, value: string): string {
  return createHmac("sha256", env.AUTH_SECRET)
    .update(provider)
    .update("\0")
    .update(value)
    .digest("hex");
}

function providerEventId(provider: string, value: string): string {
  return `${provider.toLowerCase()}-${opaqueReference(provider, value)}`;
}

function normalizedEvent(input: {
  provider: string;
  id: string;
  eventType: VerifiedEventType;
  occurredAt: string | Date;
  userReference?: string | null;
}): ProviderSyncEvent | null {
  const occurredAt = new Date(input.occurredAt);
  if (!Number.isFinite(occurredAt.getTime())) return null;
  const normalizedTime = occurredAt.toISOString();
  const internalReference = input.userReference
    ? opaqueReference(input.provider, input.userReference.trim().toLowerCase())
    : undefined;
  return {
    eventId: providerEventId(input.provider, input.id),
    eventType: input.eventType,
    occurredAt: normalizedTime,
    ...(internalReference ? { userReference: internalReference } : {}),
    providerOriginVerified: true,
    automaticVerificationEligible: false,
  };
}

function uniqueEvents(events: ProviderSyncEvent[], limit = 100): ProviderSyncEvent[] {
  const seen = new Set<string>();
  return events
    .filter((event) => {
      if (seen.has(event.eventId)) return false;
      seen.add(event.eventId);
      return true;
    })
    .slice(0, limit);
}

async function providerJson(
  input: ProviderSyncInput,
  url: string,
  init: RequestInit = {},
  retryable = false,
): Promise<unknown> {
  const fetcher = input.fetcher ?? fetch;
  for (let attempt = 0; attempt < (retryable ? 2 : 1); attempt += 1) {
    let response: Response;
    try {
      response = await fetcher(url, {
        ...init,
        headers: {
          authorization: `Bearer ${input.accessToken}`,
          accept: "application/json",
          ...init.headers,
        },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      if (attempt + 1 < (retryable ? 2 : 1)) continue;
      throw new ProviderApiError("PROVIDER_UNAVAILABLE");
    }
    if (response.status === 429) throw new ProviderApiError("PROVIDER_RATE_LIMITED");
    if ([502, 503, 504].includes(response.status) && attempt + 1 < (retryable ? 2 : 1)) continue;
    if (!response.ok) throw new ProviderApiError(`PROVIDER_HTTP_${response.status}`);
    if (response.status === 204) return {};
    try {
      return await response.json();
    } catch {
      throw new ProviderApiError("PROVIDER_INVALID_RESPONSE");
    }
  }
  throw new ProviderApiError("PROVIDER_UNAVAILABLE");
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function listValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function eventMap(value: unknown): Record<string, VerifiedEventType> {
  return eventMapSchema.parse(value);
}

function emailAddresses(value: string): string[] {
  const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return [...new Set(matches.map((item) => item.trim().toLowerCase()))].slice(0, 20);
}

function headerValue(headers: unknown, name: string): string {
  const list = listValue(headers);
  const found = list.find(
    (item) => objectValue(item)?.name?.toString().toLowerCase() === name.toLowerCase(),
  );
  const value = objectValue(found)?.value;
  return typeof value === "string" ? value : "";
}

async function syncGoogleEmail(input: ProviderSyncInput): Promise<ProviderSyncEvent[]> {
  const result: ProviderSyncEvent[] = [];
  const sentThreads = new Set<string>();
  const incomingByThread = new Map<string, number>();
  const base = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
  async function messages(labelId: "SENT" | "INBOX"): Promise<unknown[]> {
    const listUrl = new URL(base);
    listUrl.searchParams.set("maxResults", "25");
    listUrl.searchParams.append("labelIds", labelId);
    const list = objectValue(await providerJson(input, listUrl.toString(), {}, true));
    const summaries = listValue(list?.messages).slice(0, 25);
    const rows: unknown[] = [];
    for (const summary of summaries) {
      const id = objectValue(summary)?.id;
      if (typeof id !== "string" || id.length > 512) continue;
      const url = new URL(`${base}/${encodeURIComponent(id)}`);
      url.searchParams.set("format", "metadata");
      for (const header of ["To", "From", "Date", "In-Reply-To", "References"]) {
        url.searchParams.append("metadataHeaders", header);
      }
      rows.push(await providerJson(input, url.toString(), {}, true));
    }
    return rows;
  }

  const sent = await messages("SENT");
  for (const value of sent) {
    const row = objectValue(value);
    const id = typeof row?.id === "string" ? row.id : null;
    const thread = typeof row?.threadId === "string" ? row.threadId : null;
    if (!id) continue;
    if (thread) sentThreads.add(thread);
    const recipients = emailAddresses(
      headerValue(row?.payload && objectValue(row.payload)?.headers, "To"),
    );
    const occurredAt = row?.internalDate ? new Date(Number(row.internalDate)) : new Date(NaN);
    for (const recipient of recipients) {
      const event = normalizedEvent({
        provider: input.provider,
        id: `${id}:${opaqueReference("recipient", recipient)}`,
        eventType: "email.outreach_sent",
        occurredAt,
        userReference: recipient,
      });
      if (event) result.push(event);
    }
  }

  const inbox = await messages("INBOX");
  for (const value of inbox) {
    const row = objectValue(value);
    if (!row) continue;
    const id = typeof row?.id === "string" ? row.id : null;
    const thread = typeof row?.threadId === "string" ? row.threadId : null;
    if (!id || !thread || !sentThreads.has(thread)) continue;
    const headers = objectValue(row.payload)?.headers;
    const sender = emailAddresses(headerValue(headers, "From"))[0];
    const occurredAt = row.internalDate ? new Date(Number(row.internalDate)) : new Date(NaN);
    const event = normalizedEvent({
      provider: input.provider,
      id,
      eventType: "email.reply_received",
      occurredAt,
      userReference: sender,
    });
    if (event) result.push(event);
    incomingByThread.set(thread, (incomingByThread.get(thread) ?? 0) + 1);
  }
  for (const [thread, count] of incomingByThread) {
    if (count < 2) continue;
    const event = normalizedEvent({
      provider: input.provider,
      id: `${thread}:continued`,
      eventType: "email.conversation_continued",
      occurredAt: input.now ?? new Date(),
    });
    if (event) result.push(event);
  }
  return uniqueEvents(result);
}

async function syncMicrosoftEmail(input: ProviderSyncInput): Promise<ProviderSyncEvent[]> {
  const now = input.now ?? new Date();
  const urlFor = (folder: "sentitems" | "inbox") => {
    const url = new URL(`https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages`);
    url.searchParams.set("$top", "25");
    url.searchParams.set(
      "$select",
      folder === "sentitems"
        ? "id,conversationId,sentDateTime,toRecipients"
        : "id,conversationId,receivedDateTime,from",
    );
    return url.toString();
  };
  const sentBody = objectValue(await providerJson(input, urlFor("sentitems"), {}, true));
  const sent = listValue(sentBody?.value).slice(0, 25);
  const sentConversations = new Set<string>();
  const incomingByConversation = new Map<string, number>();
  const result: ProviderSyncEvent[] = [];
  for (const value of sent) {
    const row = objectValue(value);
    if (!row || typeof row.id !== "string") continue;
    if (typeof row.conversationId === "string") sentConversations.add(row.conversationId);
    const recipients = [
      ...new Set(
        listValue(row.toRecipients)
          .map((item) => objectValue(objectValue(item)?.emailAddress)?.address)
          .filter((item): item is string => typeof item === "string")
          .flatMap(emailAddresses),
      ),
    ].slice(0, 20);
    for (const recipient of recipients) {
      const event = normalizedEvent({
        provider: input.provider,
        id: `${row.id}:${opaqueReference("recipient", recipient)}`,
        eventType: "email.outreach_sent",
        occurredAt: typeof row.sentDateTime === "string" ? row.sentDateTime : now,
        userReference: recipient,
      });
      if (event) result.push(event);
    }
  }
  const inboxBody = objectValue(await providerJson(input, urlFor("inbox"), {}, true));
  for (const value of listValue(inboxBody?.value).slice(0, 25)) {
    const row = objectValue(value);
    if (
      !row ||
      typeof row.id !== "string" ||
      typeof row.conversationId !== "string" ||
      !sentConversations.has(row.conversationId)
    )
      continue;
    const sender = objectValue(objectValue(row.from)?.emailAddress)?.address;
    const event = normalizedEvent({
      provider: input.provider,
      id: row.id,
      eventType: "email.reply_received",
      occurredAt: typeof row.receivedDateTime === "string" ? row.receivedDateTime : now,
      userReference: typeof sender === "string" ? sender : null,
    });
    if (event) result.push(event);
    incomingByConversation.set(
      row.conversationId,
      (incomingByConversation.get(row.conversationId) ?? 0) + 1,
    );
  }
  for (const [conversation, count] of incomingByConversation) {
    if (count < 2) continue;
    const event = normalizedEvent({
      provider: input.provider,
      id: `${conversation}:continued`,
      eventType: "email.conversation_continued",
      occurredAt: now,
    });
    if (event) result.push(event);
  }
  return uniqueEvents(result);
}

function categoryEvent(summary: string, categories: unknown): VerifiedEventType | null {
  const values = listValue(categories).filter(
    (value): value is string => typeof value === "string",
  );
  for (const [pattern, eventType] of defaultCalendarCategories) {
    if (pattern.test(summary) || values.some((value) => pattern.test(value))) return eventType;
  }
  return null;
}

async function syncGoogleCalendar(input: ProviderSyncInput): Promise<ProviderSyncEvent[]> {
  const now = input.now ?? new Date();
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("showDeleted", "true");
  url.searchParams.set("maxResults", "100");
  url.searchParams.set("timeMin", new Date(now.getTime() - 90 * 86400_000).toISOString());
  url.searchParams.set("timeMax", now.toISOString());
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("fields", "items(id,status,summary,start,end),nextPageToken,nextSyncToken");
  const response = objectValue(await providerJson(input, url.toString(), {}, true));
  const result: ProviderSyncEvent[] = [];
  for (const value of listValue(response?.items).slice(0, 100)) {
    const row = objectValue(value);
    const id = typeof row?.id === "string" ? row.id : null;
    const summary = typeof row?.summary === "string" ? row.summary : "";
    const end = objectValue(row?.end);
    const occurredAt = end?.dateTime ?? end?.date;
    if (!id || row?.status !== "confirmed" || typeof occurredAt !== "string") continue;
    if (new Date(occurredAt).getTime() > now.getTime()) continue;
    const mapped = categoryEvent(summary, null);
    if (!mapped) continue;
    const event = normalizedEvent({ provider: input.provider, id, eventType: mapped, occurredAt });
    if (event) result.push(event);
  }
  return uniqueEvents(result);
}

async function syncMicrosoftCalendar(input: ProviderSyncInput): Promise<ProviderSyncEvent[]> {
  const now = input.now ?? new Date();
  const url = new URL("https://graph.microsoft.com/v1.0/me/calendarView");
  url.searchParams.set("startDateTime", new Date(now.getTime() - 90 * 86400_000).toISOString());
  url.searchParams.set("endDateTime", now.toISOString());
  url.searchParams.set("$top", "100");
  url.searchParams.set("$select", "id,subject,start,end,isCancelled,showAs,categories");
  const response = objectValue(await providerJson(input, url.toString(), {}, true));
  const result: ProviderSyncEvent[] = [];
  for (const value of listValue(response?.value).slice(0, 100)) {
    const row = objectValue(value);
    const id = typeof row?.id === "string" ? row.id : null;
    const subject = typeof row?.subject === "string" ? row.subject : "";
    const end = objectValue(row?.end);
    const occurredAt = typeof end?.dateTime === "string" ? end.dateTime : null;
    if (!id || row?.isCancelled || row?.showAs === "free" || !occurredAt) continue;
    if (new Date(occurredAt).getTime() > now.getTime()) continue;
    const mapped = categoryEvent(subject, row?.categories);
    if (!mapped) continue;
    const event = normalizedEvent({ provider: input.provider, id, eventType: mapped, occurredAt });
    if (event) result.push(event);
  }
  return uniqueEvents(result);
}

function configuredEventMap(
  configuration: Record<string, unknown>,
): Record<string, VerifiedEventType> {
  return eventMap(configuration.eventMap);
}

async function syncPostHog(input: ProviderSyncInput): Promise<ProviderSyncEvent[]> {
  const projectId = z
    .string()
    .regex(/^\d{1,12}$/)
    .parse(input.configuration.projectId);
  const region = z.enum(["us", "eu"]).parse(input.configuration.region);
  const mapping = configuredEventMap(input.configuration);
  const names = Object.keys(mapping);
  if (names.some((name) => !/^[A-Za-z0-9_.:-]{1,100}$/.test(name)))
    throw new ProviderApiError("INVALID_CONFIGURATION");
  const sqlNames = names.map((name) => `'${name}'`).join(", ");
  const sql = `SELECT event, toDate(timestamp) AS event_date, count() AS total FROM events WHERE event IN (${sqlNames}) AND timestamp >= now() - INTERVAL 7 DAY GROUP BY event, event_date ORDER BY event_date LIMIT 500`;
  const response = objectValue(
    await providerJson(
      input,
      `https://${region}.posthog.com/api/projects/${projectId}/query/`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: { kind: "HogQLQuery", query: sql } }),
      },
      true,
    ),
  );
  const result: ProviderSyncEvent[] = [];
  for (const row of listValue(response?.results).slice(0, 500)) {
    const [name, day, count] = listValue(row);
    if (typeof name !== "string" || typeof day !== "string" || !(name in mapping)) continue;
    if (!Number.isFinite(Number(count)) || Number(count) <= 0) continue;
    const event = normalizedEvent({
      provider: input.provider,
      id: `${day}:${name}`,
      eventType: mapping[name],
      occurredAt: `${day}T23:59:59.000Z`,
    });
    if (event) result.push(event);
  }
  return uniqueEvents(result);
}

async function syncPlausible(input: ProviderSyncInput): Promise<ProviderSyncEvent[]> {
  const siteId = z.string().trim().min(1).max(255).parse(input.configuration.siteId);
  if (/[/\s]/.test(siteId)) throw new ProviderApiError("INVALID_CONFIGURATION");
  const mapping = configuredEventMap(input.configuration);
  const result: ProviderSyncEvent[] = [];
  for (const [goal, eventType] of Object.entries(mapping)) {
    const response = objectValue(
      await providerJson(
        input,
        "https://plausible.io/api/v2/query",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            site_id: siteId,
            metrics: ["events"],
            date_range: "7d",
            dimensions: ["time:day"],
            filters: [["is", "event:goal", [goal]]],
          }),
        },
        true,
      ),
    );
    for (const value of listValue(response?.results).slice(0, 10)) {
      const row = objectValue(value);
      const dimensions = listValue(row?.dimensions);
      const metrics = listValue(row?.metrics);
      const day = dimensions[0];
      const count = Number(metrics[0]);
      if (typeof day !== "string" || !Number.isFinite(count) || count <= 0) continue;
      const event = normalizedEvent({
        provider: input.provider,
        id: `${goal}:${day}`,
        eventType,
        occurredAt: `${day}T23:59:59.000Z`,
      });
      if (event) result.push(event);
    }
  }
  return uniqueEvents(result);
}

async function syncGa4(input: ProviderSyncInput): Promise<ProviderSyncEvent[]> {
  const propertyId = z
    .string()
    .regex(/^\d{1,20}$/)
    .parse(input.configuration.propertyId);
  const mapping = configuredEventMap(input.configuration);
  const response = objectValue(
    await providerJson(
      input,
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dateRanges: [{ startDate: "7daysAgo", endDate: "yesterday" }],
          dimensions: [{ name: "date" }, { name: "eventName" }],
          metrics: [{ name: "eventCount" }],
          dimensionFilter: {
            filter: {
              fieldName: "eventName",
              inListFilter: { values: Object.keys(mapping) },
            },
          },
          limit: "500",
        }),
      },
      true,
    ),
  );
  const result: ProviderSyncEvent[] = [];
  for (const row of listValue(response?.rows).slice(0, 500)) {
    const value = objectValue(row);
    const dimensions = listValue(value?.dimensionValues).map((item) => objectValue(item)?.value);
    const metrics = listValue(value?.metricValues).map((item) => objectValue(item)?.value);
    const rawDate = dimensions[0];
    const name = dimensions[1];
    const count = Number(metrics[0]);
    if (typeof rawDate !== "string" || typeof name !== "string" || !(name in mapping)) continue;
    if (!/^\d{8}$/.test(rawDate) || !Number.isFinite(count) || count <= 0) continue;
    const day = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
    const event = normalizedEvent({
      provider: input.provider,
      id: `${day}:${name}`,
      eventType: mapping[name],
      occurredAt: `${day}T23:59:59.000Z`,
    });
    if (event) result.push(event);
  }
  return uniqueEvents(result);
}

export type ProviderSyncAdapter = (input: ProviderSyncInput) => Promise<ProviderSyncEvent[]>;

export const integrationProviderAdapters = new Map<IntegrationProvider, ProviderSyncAdapter>([
  ["GMAIL", syncGoogleEmail],
  ["GOOGLE_CALENDAR", syncGoogleCalendar],
  ["OUTLOOK", syncMicrosoftEmail],
  ["MICROSOFT_CALENDAR", syncMicrosoftCalendar],
  ["POSTHOG", syncPostHog],
  ["PLAUSIBLE", syncPlausible],
  ["GA4", syncGa4],
]);

export function integrationProviderAdapter(
  provider: IntegrationProvider,
): ProviderSyncAdapter | null {
  return integrationProviderAdapters.get(provider) ?? null;
}

export function hashProviderAccount(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
