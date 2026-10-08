# Event contracts

Status: agreed Phase 0 contract, 2026-10-07. Current activity contract is in `apps/api/src/activity.ts`; signed inbound contract is described in `INTEGRATIONS.md`. They are separate transports and identities.

## Activity envelope (current)

| Field | Validation |
| --- | --- |
| eventId | UUID, stable across delivery retries |
| productId | Owned product UUID; user/device derived from authenticated session |
| eventType | Lowercase key matching `^[a-z][a-z0-9_.-]{1,79}$` |
| eventVersion | Integer 1..32767, default 1 |
| clientSequence | Non-negative safe integer, ordered within device/product |
| occurredAt | ISO timestamp with timezone offset |
| attributes | At most 16 scalar fields, 2,048 serialized UTF-8 bytes; string max 256 characters; restricted field names |

Batch maximum 100, strict envelope. Normalize before hashing. Identical retries reuse the stored event; conflicting event-ID/sequence reuse rejects atomically and never increments aggregates. Preserve occurrence/receipt/effective timestamps. More than five minutes future or seven days old uses server effective time with clock-adjusted metadata. Test races and replay, not only sequential examples.

Target improvement: versioned event-type allowlists for keys, meaning and privacy. Bounded arbitrary strings are not sufficient privacy enforcement. Unknown types/versions need an explicit reject or compatibility policy. Specify app duration, focus mode, hostname, consent revision and policy-event contracts before extending collection.

## Signed integration envelope (current)

`POST /v1/events` with `application/vnd.enough.event+json`, hashed API-key credential, timestamp header and HMAC-SHA256 of `timestamp + '.' + exact request bytes`. Body limit 16 KiB; timestamp within five minutes. See `INTEGRATIONS.md` for fields and allowed types.

Fields: stable source eventId, enumerated eventType, occurredAt; optional owned completionId, opaque userReference, amountMinor/currency pair. Reject extra arbitrary metadata. Hash external user references before storage. Identical normalized replay returns prior result; conflicting ID returns conflict. Revoke credentials and serialize revocation/ingestion. The owner controls this signing source; a matching signature does not establish a vendor claim's truth.

Types cover email outreach/reply, calendar interviews/demos/sales/onboarding/feedback/retention calls, revenue payment/subscription, and analytics signup/activation/trial/conversion/retention/churn. Vendor adapters must independently authenticate provider origin and emit normalized permitted facts; generic events cannot self-upgrade verification provenance.

## Future session/policy events

Define start/reserve, usage checkpoint, settle/release, policy warning/limit, emergency bypass and sync outcome schemas with device/product/session IDs, stable idempotency key and scoped policy version. Usage must be bounded by the server reservation; client timestamps and claimed outcomes are untrusted. Reward and ledger mutations belong to transactions, not best-effort analytics listeners.
