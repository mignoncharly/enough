# Signed Event API

Enough currently supports two inbound connection types: Generic webhook and Public Event API. Create either from **Workspace → Integrations**. Each connection has its own API key and signing secret; copy both when they are shown because the workspace does not show them again. Store the values in your server-side secret manager.

The API key is stored as a one-way hash. The signing secret is encrypted at rest. Disconnecting a connection revokes both credentials and removes its stored OAuth tokens.

## Send an event

Send `POST /v1/events` to the API base URL with this content type:

```http
Content-Type: application/vnd.enough.event+json
Authorization: Bearer enp_live_...
X-Enough-Timestamp: 1791288000
X-Enough-Signature: sha256=<hex HMAC>
```

The signature is HMAC-SHA256 over the exact request bytes, prefixed by the timestamp and a period:

```text
HMAC_SHA256(signing_secret, timestamp + "." + exact_request_body_bytes)
```

Example using Node.js:

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
  .update(timestamp)
  .update(".")
  .update(body)
  .digest("hex");

const response = await fetch(`${process.env.ENOUGH_API_URL}/v1/events`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${process.env.ENOUGH_API_KEY}`,
    "content-type": "application/vnd.enough.event+json",
    "x-enough-timestamp": timestamp,
    "x-enough-signature": `sha256=${signature}`,
  },
  body,
});
if (!response.ok) throw new Error(`Enough returned ${response.status}: ${await response.text()}`);
console.log(await response.json());
```

Keep and reuse the same `eventId` for delivery retries. Replaying an identical event returns the existing record and does not create another record. Reusing an event ID with different normalized data returns `409 Conflict`.

## Event fields

The JSON body is strict; extra fields and free-form metadata are rejected.

| Field | Required | Meaning |
| --- | --- | --- |
| `eventId` | Yes | Stable opaque source event identifier, 1–255 characters using letters, numbers, `.`, `_`, `:`, or `-`. Do not include personal information. |
| `eventType` | Yes | One of the normalized event types below. |
| `occurredAt` | Yes | ISO 8601 timestamp with a time zone. Must be within the past year and no more than five minutes in the future. |
| `completionId` | No | UUID of a completed task in the integration's product. Creates pending evidence for owner review. |
| `userReference` | No | Opaque external identifier, up to 128 characters. Do not send an email address or other direct personal information. It is HMAC-hashed before storage. |
| `amountMinor` | No | Non-negative integer amount in the currency's minor unit, such as cents. Must be sent with `currency`. |
| `currency` | No | Three uppercase ISO-style currency letters. Must be sent with `amountMinor`. |

Supported event types:

- Email: `email.outreach_sent`, `email.reply_received`
- Calendar: `calendar.interview_completed`, `calendar.demo_completed`, `calendar.sales_call_completed`, `calendar.onboarding_completed`, `calendar.feedback_call_completed`, `calendar.retention_call_completed`
- Revenue: `revenue.payment_received`, `revenue.subscription_created`
- Product analytics: `analytics.user_signup`, `analytics.user_activated`, `analytics.trial_started`, `analytics.conversion_completed`, `analytics.user_retained`, `analytics.user_churned`

The request body is limited to 16 KiB. Rate limits are 300 requests per minute per client IP and 120 per minute per integration. Signatures older or newer than five minutes are rejected. Retry later after `429`; preserve the event ID when retrying.

## What signature verification means

The response's `verificationStatus` confirms that the request matched this connection's API key and signing secret. It does not prove that a vendor produced the event or that the event claim is true. The workspace owner controls this signing source. A linked task receives pending integration evidence and remains in the owner review queue; the event alone does not grant task credits.

Gmail, Google Calendar, Outlook, Microsoft Calendar, Stripe, PostHog, Plausible, and GA4 are listed as planned adapters. Their provider-specific OAuth scopes, sync behavior, and vendor signature checks are not implemented yet. Do not treat a Generic webhook or Public Event API connection as a vendor-authenticated source.
