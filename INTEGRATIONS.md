# Integrations

Enough supports provider connections and two owner-controlled inbound sources: Generic webhook and Public Event API. Create connections from **Workspace → Integrations**. Generic webhook and Public Event API credentials are shown once; store them in your server-side secret manager.

## Provider connections

Google providers (Gmail, Google Calendar, and GA4) require `GOOGLE_INTEGRATION_CLIENT_ID` and `GOOGLE_INTEGRATION_CLIENT_SECRET`. Microsoft providers (Outlook and Microsoft Calendar) require `MICROSOFT_INTEGRATION_CLIENT_ID` and `MICROSOFT_INTEGRATION_CLIENT_SECRET`. Register the matching callback URLs `/integrations/oauth/google/callback` and `/integrations/oauth/microsoft/callback` on the API host. OAuth uses PKCE and requests read-only, provider-specific scopes. Disconnecting removes Enough's stored tokens and attempts provider revocation; Microsoft may require the user to revoke consent in their Microsoft account settings.

PostHog and Plausible connections use read-only API tokens and an explicit event-name mapping. GA4 uses OAuth, a numeric property ID, and an event-name mapping. Analytics events are aggregated by provider and day; Enough does not store raw user identifiers. Gmail and Outlook sync stores no message body or address; recipient references are HMAC-hashed. Calendar events are classified from their title/category and linked task evidence remains pending owner review.

Stripe customer-revenue connections are separate from Enough subscription billing. Standard `rk_test_` and `rk_live_` restricted keys must have **Account: Read** and **Events: Read** permissions; Enough checks the account identity and separately probes the Events API. For Stripe's anonymous test sandbox, `rkcs_test_` keys require the nonsecret `acct_...` account ID returned when the sandbox is created and **Events: Read** permission. Enough skips `/v1/account` for that key type because anonymous sandbox keys may not have Account: Read, but still rejects the setup unless the Events API is readable. The stored account ID identifies the configured Stripe account context; it is not proof of event origin. For direct-account events, Stripe may omit `Event.account`. Provider origin is established by validating Stripe's timestamped signature and retrieving the exact signed event with the configured key, then matching event ID, type, creation time, object ID, live/test mode, and normalized revenue fields. In Stripe, add the full webhook URL shown by Enough and subscribe to `payment_intent.succeeded`, `checkout.session.completed`, `customer.subscription.created`, `invoice.paid`, `customer.subscription.deleted`, `charge.refunded`, and `refund.created`. Use a separate test-mode connection during acceptance. Only a confirmed `payment_intent.succeeded` event with a matching task completion ID can automatically verify a task and issue its configured reward; other Stripe events are recorded, and linked evidence follows owner review.

API keys, OAuth tokens, provider account IDs, and Stripe webhook secrets are encrypted or hashed at rest and excluded from account exports. Disconnecting disables the connection in Enough; API-token providers and some OAuth providers may also require revocation in the provider's settings.

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
| `amountMinor` | No | Non-negative integer amount in the currency's minor unit, such as cents. Must be sent with `currency` and is accepted only for `revenue.*` event types. |
| `currency` | No | Three uppercase ISO-style currency letters. Must be sent with `amountMinor` and is accepted only for `revenue.*` event types. |

Supported event types:

- Email: `email.outreach_sent`, `email.reply_received`, `email.conversation_continued`
- Calendar: `calendar.interview_completed`, `calendar.demo_completed`, `calendar.sales_call_completed`, `calendar.onboarding_completed`, `calendar.feedback_call_completed`, `calendar.retention_call_completed`
- Revenue: `revenue.payment_received`, `revenue.checkout_completed`, `revenue.subscription_created`, `revenue.invoice_paid`, `revenue.subscription_cancelled`, `revenue.payment_refunded`
- Product analytics: `analytics.user_signup`, `analytics.user_activated`, `analytics.trial_started`, `analytics.conversion_completed`, `analytics.user_retained`, `analytics.user_churned`

The request body is limited to 16 KiB. Rate limits are 300 requests per minute per client IP and 120 per minute per integration. Signatures older or newer than five minutes are rejected. Retry later after `429`; preserve the event ID when retrying.

## What signature verification means

The response's `verificationStatus` confirms that the request matched this connection's API key and signing secret. It does not prove that a vendor produced the event or that the event claim is true. The workspace owner controls this signing source. A linked task receives pending integration evidence and remains in the owner review queue; the event alone does not grant task credits. Provider API sync is authenticated to the connected provider, but its task evidence also requires owner review. Stripe customer-revenue webhook events are confirmed through the connected Stripe account before the narrowly scoped automatic payment verification path can issue a reward.

Do not treat a Generic webhook or Public Event API connection as a vendor-authenticated source. Deterministic provider tests and local browser acceptance have passed. Real Google/Microsoft OAuth, dedicated PostHog/Plausible/GA4 test properties, and Stripe end-to-end customer-revenue webhook delivery still require dedicated external test configurations; see `PHASE_14_ACCEPTANCE.md`.
