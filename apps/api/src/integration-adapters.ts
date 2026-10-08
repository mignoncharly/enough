import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const integrationProviders = [
  "GMAIL",
  "GOOGLE_CALENDAR",
  "OUTLOOK",
  "MICROSOFT_CALENDAR",
  "STRIPE",
  "POSTHOG",
  "PLAUSIBLE",
  "GA4",
  "WEBHOOK",
  "PUBLIC_API",
] as const;
export type IntegrationProvider = (typeof integrationProviders)[number];

export const verifiedEventTypes = [
  "email.outreach_sent",
  "email.reply_received",
  "calendar.interview_completed",
  "calendar.demo_completed",
  "calendar.sales_call_completed",
  "calendar.onboarding_completed",
  "calendar.feedback_call_completed",
  "calendar.retention_call_completed",
  "revenue.payment_received",
  "revenue.subscription_created",
  "analytics.user_signup",
  "analytics.user_activated",
  "analytics.trial_started",
  "analytics.conversion_completed",
  "analytics.user_retained",
  "analytics.user_churned",
] as const;
export type VerifiedEventType = (typeof verifiedEventTypes)[number];

export const integrationCatalog: Array<{
  provider: IntegrationProvider;
  name: string;
  mode: "SIGNED_WEBHOOK" | "PUBLIC_API" | "OAUTH" | "API_TOKEN";
  available: boolean;
  eventTypes: readonly VerifiedEventType[];
}> = [
  {
    provider: "GMAIL",
    name: "Gmail",
    mode: "OAUTH",
    available: false,
    eventTypes: ["email.outreach_sent", "email.reply_received"],
  },
  {
    provider: "GOOGLE_CALENDAR",
    name: "Google Calendar",
    mode: "OAUTH",
    available: false,
    eventTypes: [
      "calendar.interview_completed",
      "calendar.demo_completed",
      "calendar.sales_call_completed",
      "calendar.onboarding_completed",
      "calendar.feedback_call_completed",
      "calendar.retention_call_completed",
    ],
  },
  {
    provider: "OUTLOOK",
    name: "Outlook",
    mode: "OAUTH",
    available: false,
    eventTypes: ["email.outreach_sent", "email.reply_received"],
  },
  {
    provider: "MICROSOFT_CALENDAR",
    name: "Microsoft Calendar",
    mode: "OAUTH",
    available: false,
    eventTypes: [
      "calendar.interview_completed",
      "calendar.demo_completed",
      "calendar.sales_call_completed",
      "calendar.onboarding_completed",
      "calendar.feedback_call_completed",
      "calendar.retention_call_completed",
    ],
  },
  {
    provider: "STRIPE",
    name: "Stripe",
    mode: "OAUTH",
    available: false,
    eventTypes: ["revenue.payment_received", "revenue.subscription_created"],
  },
  {
    provider: "POSTHOG",
    name: "PostHog",
    mode: "API_TOKEN",
    available: false,
    eventTypes: [
      "analytics.user_signup",
      "analytics.user_activated",
      "analytics.trial_started",
      "analytics.conversion_completed",
      "analytics.user_retained",
      "analytics.user_churned",
    ],
  },
  {
    provider: "PLAUSIBLE",
    name: "Plausible",
    mode: "API_TOKEN",
    available: false,
    eventTypes: [
      "analytics.user_signup",
      "analytics.user_activated",
      "analytics.conversion_completed",
    ],
  },
  {
    provider: "GA4",
    name: "Google Analytics 4",
    mode: "OAUTH",
    available: false,
    eventTypes: [
      "analytics.user_signup",
      "analytics.user_activated",
      "analytics.trial_started",
      "analytics.conversion_completed",
      "analytics.user_retained",
      "analytics.user_churned",
    ],
  },
  {
    provider: "WEBHOOK",
    name: "Generic webhook",
    mode: "SIGNED_WEBHOOK",
    available: true,
    eventTypes: verifiedEventTypes,
  },
  {
    provider: "PUBLIC_API",
    name: "Public Event API",
    mode: "PUBLIC_API",
    available: true,
    eventTypes: verifiedEventTypes,
  },
];

const eventSchema = z
  .object({
    eventId: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/^[A-Za-z0-9._:-]+$/),
    eventType: z.enum(verifiedEventTypes),
    occurredAt: z.string().datetime({ offset: true }),
    completionId: z.string().uuid().optional(),
    userReference: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/)
      .optional(),
    amountMinor: z.number().int().min(0).max(1_000_000_000_000).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
  })
  .strict()
  .superRefine((event, context) => {
    if ((event.amountMinor === undefined) !== (event.currency === undefined)) {
      context.addIssue({
        code: "custom",
        message: "Provide both amountMinor and currency, or neither.",
        path: ["amountMinor"],
      });
    }
  });

export type NormalizedIntegrationEvent = z.infer<typeof eventSchema>;

export interface IntegrationAdapter {
  readonly provider: IntegrationProvider;
  readonly mode: "SIGNED_WEBHOOK" | "PUBLIC_API";
  parseEvent(input: unknown): NormalizedIntegrationEvent;
  verifyRequest(input: {
    secret: string;
    timestamp: string;
    signature: string;
    rawBody: Buffer;
  }): boolean;
  getHealth(input: {
    status: string;
    lastReceivedAt: Date | null;
  }): "CONNECTED" | "IDLE" | "ERROR" | "REVOKED";
}

function parseEvent(input: unknown): NormalizedIntegrationEvent {
  return eventSchema.parse(input);
}

function verifyRequest(input: {
  secret: string;
  timestamp: string;
  signature: string;
  rawBody: Buffer;
}): boolean {
  if (!/^\d{10}$/.test(input.timestamp) || !/^sha256=[a-f0-9]{64}$/.test(input.signature))
    return false;
  const expected = createHmac("sha256", input.secret)
    .update(input.timestamp)
    .update(".")
    .update(input.rawBody)
    .digest();
  const supplied = Buffer.from(input.signature.slice("sha256=".length), "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function getHealth(input: {
  status: string;
  lastReceivedAt: Date | null;
}): "CONNECTED" | "IDLE" | "ERROR" | "REVOKED" {
  if (input.status === "REVOKED") return "REVOKED";
  if (input.status === "ERROR") return "ERROR";
  return input.lastReceivedAt ? "CONNECTED" : "IDLE";
}

const signedEventAdapter: IntegrationAdapter = {
  provider: "WEBHOOK",
  mode: "SIGNED_WEBHOOK",
  parseEvent,
  verifyRequest,
  getHealth,
};

const publicApiAdapter: IntegrationAdapter = {
  provider: "PUBLIC_API",
  mode: "PUBLIC_API",
  parseEvent,
  verifyRequest,
  getHealth,
};

export const integrationAdapters = new Map<IntegrationProvider, IntegrationAdapter>([
  [signedEventAdapter.provider, signedEventAdapter],
  [publicApiAdapter.provider, publicApiAdapter],
]);

export function integrationAdapter(provider: IntegrationProvider): IntegrationAdapter | null {
  return integrationAdapters.get(provider) ?? null;
}
