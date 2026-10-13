# Integrations

Enough supports provider connections and two owner-controlled inbound sources: Generic webhook and Public Event API. Create connections in **Workspace → Integrations**. Generic webhook and Public Event API credentials are shown once; store them in your server-side secret manager.

## Provider connections

Google OAuth connections require `GOOGLE_INTEGRATION_CLIENT_ID` and `GOOGLE_INTEGRATION_CLIENT_SECRET`; Microsoft OAuth connections require `MICROSOFT_INTEGRATION_CLIENT_ID` and `MICROSOFT_INTEGRATION_CLIENT_SECRET`. Register the API callbacks `/integrations/oauth/google/callback` and `/integrations/oauth/microsoft/callback`. OAuth uses PKCE and provider-specific read scopes. Disconnecting removes stored Enough tokens and attempts provider revocation; Microsoft may require revoking consent in Microsoft account settings.

PostHog and Plausible use read-only API tokens and an explicit event mapping. GA4 uses OAuth, a property ID, and the same mapping. Analytics events are aggregated by provider and day. Gmail and Outlook sync does not store message bodies or email addresses; recipient references are HMAC-hashed. Calendar events are classified from their title/category and linked evidence remains pending owner review.

For Stripe customer revenue, connect a restricted API key with **Events: Read** permission and a webhook signing secret. Standard `rk_test_` and `rk_live_` keys also require **Account: Read**; Enough validates that account and separately probes Events access. Anonymous sandbox `rkcs_test_` keys instead require the nonsecret `acct_...` ID returned when the sandbox is created. Enough skips `/v1/account` for anonymous keys but rejects setup if the Events API cannot be read. The stored account ID identifies the configured account context; it is not proof of event origin, and direct-account Stripe events may omit `Event.account`. Enough establishes provider origin by verifying Stripe's timestamped signature and retrieving the exact event through the configured key, matching its ID, type, creation time, object identity, live/test mode, and normalized revenue fields. Add the full webhook URL shown by Enough and select `payment_intent.succeeded`, `checkout.session.completed`, `customer.subscription.created`, `invoice.paid`, `customer.subscription.deleted`, `charge.refunded`, and `refund.created`. Use Stripe test mode during acceptance. Only a confirmed `payment_intent.succeeded` with a matching task completion ID can automatically verify a task and issue its reward; other events do not bypass owner review.

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

Bodies reject extra fields and free-form metadata. Required fields are `eventId` (1–255 allowed characters; use an opaque identifier without personal information), `eventType` (one of the types below), and `occurredAt` (ISO 8601 with a time zone, within the past year and no more than five minutes in the future). Optional `completionId` links the event to a completed task in this product and creates evidence pending owner review. Optional `userReference` must be an opaque identifier, not an email or direct personal information; Enough HMAC-hashes it before storage. Optional `amountMinor` and `currency` must be provided together and are accepted only for `revenue.*` event types.

Supported types:

- `email.outreach_sent`, `email.reply_received`, `email.conversation_continued`
- `calendar.interview_completed`, `calendar.demo_completed`, `calendar.sales_call_completed`, `calendar.onboarding_completed`, `calendar.feedback_call_completed`, `calendar.retention_call_completed`
- `revenue.payment_received`, `revenue.checkout_completed`, `revenue.subscription_created`, `revenue.invoice_paid`, `revenue.subscription_cancelled`, `revenue.payment_refunded`
- `analytics.user_signup`, `analytics.user_activated`, `analytics.trial_started`, `analytics.conversion_completed`, `analytics.user_retained`, `analytics.user_churned`

Requests are limited to 16 KiB, 120 per minute per integration, and 300 per minute per client IP. Signatures expire after five minutes.

## Trust boundary

`verificationStatus` confirms the API key and signature for this connection. The workspace owner controls the signing source, so this does not prove that a vendor produced the event or that its claim is true. Linked task evidence stays pending for owner review, and the event alone does not grant task credits. Provider API sync is authenticated to the connected provider, but linked task evidence still requires owner review. Stripe events are confirmed through the connected Stripe account before the narrowly scoped automatic payment verification path.

Deterministic provider tests and local browser acceptance have passed. Real Google/Microsoft OAuth, dedicated PostHog/Plausible/GA4 test properties, and Stripe end-to-end customer-revenue webhook delivery still require dedicated external test configurations. Generic webhook and Public Event API remain owner-controlled sources, not proof of vendor origin.
