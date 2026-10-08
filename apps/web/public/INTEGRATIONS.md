# Signed Event API

Enough currently supports Generic webhook and Public Event API connections. Create a connection in **Workspace → Integrations**, then copy its API key and signing secret into your server-side secret manager. The credentials are shown once. The API key is hashed and the signing secret is encrypted at rest.

## Request authentication

Send `POST /v1/events` with `Content-Type: application/vnd.enough.event+json` and `Authorization: Bearer <API key>`. Set `X-Enough-Timestamp` to the current Unix timestamp in seconds. Set `X-Enough-Signature` to `sha256=` followed by the lowercase hexadecimal HMAC-SHA256 of:

```text
timestamp + "." + exact request body bytes
```

Node.js example:

```js
import { createHmac } from "node:crypto";

const event = {
  eventId: "evt_01J9F4W6KQ",
  eventType: "analytics.user_activated",
  occurredAt: new Date().toISOString(),
  userReference: "customer_4821",
};
const body = Buffer.from(JSON.stringify(event));
const timestamp = Math.floor(Date.now() / 1000).toString();
const signature = createHmac("sha256", process.env.ENOUGH_SIGNING_SECRET)
  .update(timestamp).update(".").update(body).digest("hex");

const response = await fetch(`${process.env.ENOUGH_API_URL}/v1/events`, {
  method: "POST",
  redirect: "error",
  headers: {
    authorization: `Bearer ${process.env.ENOUGH_API_KEY}`,
    "content-type": "application/vnd.enough.event+json",
    "x-enough-timestamp": timestamp,
    "x-enough-signature": `sha256=${signature}`,
  },
  body,
});
if (!response.ok) throw new Error(`Enough returned ${response.status}`);
console.log(await response.json());
```

Reuse the same `eventId` on retries. An identical retry returns the saved event; reusing an ID with different normalized event data returns `409 Conflict`.

## Event schema

Bodies reject extra fields and free-form metadata. Required fields are `eventId` (1–255 allowed characters; use an opaque identifier without personal information), `eventType` (one of the types below), and `occurredAt` (ISO 8601 with a time zone, within the past year and no more than five minutes in the future). Optional `completionId` links the event to a completed task in this product and creates evidence pending owner review. Optional `userReference` must be an opaque identifier, not an email or direct personal information; Enough HMAC-hashes it before storage. Optional `amountMinor` and `currency` must be provided together.

Supported types:

- `email.outreach_sent`, `email.reply_received`
- `calendar.interview_completed`, `calendar.demo_completed`, `calendar.sales_call_completed`, `calendar.onboarding_completed`, `calendar.feedback_call_completed`, `calendar.retention_call_completed`
- `revenue.payment_received`, `revenue.subscription_created`
- `analytics.user_signup`, `analytics.user_activated`, `analytics.trial_started`, `analytics.conversion_completed`, `analytics.user_retained`, `analytics.user_churned`

Requests are limited to 16 KiB, 120 per minute per integration, and 300 per minute per client IP. Signatures expire after five minutes.

## Trust boundary

`verificationStatus` confirms the API key and signature for this connection. The workspace owner controls the signing source, so this does not prove that a vendor produced the event or that its claim is true. Linked task evidence stays pending for owner review, and the event alone does not grant task credits.

Gmail, Google Calendar, Outlook, Microsoft Calendar, Stripe, PostHog, Plausible, and GA4 adapters remain planned until their OAuth scopes, sync behavior, and provider-specific signature checks are implemented.
