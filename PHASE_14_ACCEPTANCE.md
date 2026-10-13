# Phase 14 — Integrations Acceptance

**Status: ACTIVE — partial common-path acceptance; not ready for final acceptance.**

The canonical exit criterion is: **Meaningful real-world events can be verified automatically.** The implemented Generic webhook and Public Event API authenticate a workspace owner's configured source. They do not establish that a Gmail, calendar, Stripe, or analytics vendor originated an event. Any task evidence linked to these sources stays pending for owner review, and event receipt does not grant credits.

## Canonical scope audited

- Common integration account lifecycle, connect/disconnect state, protected credential storage, health, event ingest, sync/error schema, audit, ownership, replay/idempotency, rate limiting, privacy/export, deletion, evidence linkage, and reward idempotency.
- Gmail and Outlook messages; Google and Microsoft calendar events; Stripe customer revenue; PostHog, Plausible, and GA4 normalized analytics events.
- Generic signed webhooks and the authenticated Public Event API, including payload validation, provider/source authentication, idempotency, scoping, and failure boundaries.
- Integration-originated Phase 13 evidence and credit rewards.

## Existing adapters and verified behavior

Only **Generic webhook** (`WEBHOOK`) and **Public Event API** (`PUBLIC_API`) have executable adapters. The catalog contains Gmail, Google Calendar, Outlook, Microsoft Calendar, Stripe, PostHog, Plausible, and GA4 entries marked unavailable. Google/GitHub login is a separate authentication capability. The existing Stripe billing webhook handles Enough subscription events; it is not a founder's Stripe customer-revenue integration. The default suite also passed its 4 Stripe webhook tests and 3 billing-route contract tests for Enough subscriptions; these do not prove customer-revenue integration behavior.

The Phase 14 fixture applied and prechecked migrations `0001`–`0019` in a disposable PostgreSQL database and started isolated Redis, API, worker, and web services. `/integrations` returned HTTP 200. The final isolated run is `pnpm test:integrations:integration`; it runs 3 adapter contract tests and 7 PostgreSQL/API cases.

| Area | Result |
| --- | --- |
| Catalog honesty | Only `WEBHOOK` and `PUBLIC_API` are available; named vendor entries remain unavailable. |
| Lifecycle and authorization | Connect/list/disconnect, unauthenticated rejection, CSRF rejection, cross-account product/list/revoke isolation, and health states. |
| Workspace API path | Connection create/list/revoke were exercised through the same-origin `/api/integrations` Next.js rewrite; the public signed event endpoint was exercised directly. |
| Credential privacy | API keys are SHA-256 hashed; signing secrets are encrypted and round-trip only through the configured application secret; list/export omit credentials and hashes. |
| Signed event contract | Exact raw-body HMAC, invalid signature rejection, stale and future request timestamp rejection, event-time bounds, malformed JSON/schema rejection, and non-revenue amount rejection. |
| Replay and limits | Identical event retries return the existing event; conflicting event-ID reuse is rejected; account rate limit returns 429; revocation is serialized against in-flight ingestion. |
| Privacy and ownership | User references are HMAC-hashed before persistence; completion links are product/account scoped; audit events record connect, disconnect, and authenticated ingest. |
| Evidence and rewards | A linked event creates pending `MANUAL` evidence. Owner verification grants one reward, repeated review/event delivery does not grant again, and the pre-review event grants none. |
| Export and deletion | Account export includes safe integration records without credentials; account deletion cascades accounts, tokens, sync records, safe error records, and normalized events. |

## Gaps and remaining gates

- Gmail, Google Calendar, Outlook, Microsoft Calendar, Stripe customer-revenue, PostHog, Plausible, and GA4 adapters are not implemented. No provider OAuth/API-token setup, least-privilege scopes, token refresh, provider-side disconnect/revocation, sync executor, or vendor-origin verification currently exists.
- `integration_sync_runs` and `integration_errors` are schema and export models only. Provider sync execution and safe provider failure recording remain unimplemented.
- Stripe's existing Enough billing webhook is not customer revenue proof. Refund/cancellation handling for a founder's customer payments is not implemented in Phase 14.
- Email recipient uniqueness and reply qualification, calendar event-category/completion criteria, and analytics privacy-minimized provider mapping cannot be accepted until those adapters exist. The generic event type list is not a substitute.
- Generic/Public API events remain pending owner review. They do not meet automatic real-world vendor verification and cannot prove external origin or automatically award credits.
- No provider sandbox or real-provider end-to-end acceptance was run. This pass did not use or request personal accounts or credentials. The immediate blocker is absent provider adapter functionality; later provider acceptance will require isolated vendor sandbox/test credentials where available.

## Fixes made

- Reject `amountMinor`/`currency` on non-revenue event types, preserving the required pair check for revenue events.
- Stop logging raw integration exceptions, which could contain provider responses, database details, or credential fragments. User responses remain generic.
- Add a marked Phase 14 TEMP fixture on dedicated PostgreSQL/Redis/API/worker/web ports and a cleanup command that verifies its marker, confirms services are stopped, then removes only `TEMP/enough-phase14`.

## Manual acceptance

No browser/manual session was run in this partial pass. The current UI is unchanged, its route returned HTTP 200 in the isolated runtime, and the current common API flow is covered by automated tests. A single consolidated browser session should follow provider adapter implementation, when vendor-backed UI behavior exists to accept.

## Final checks

- `pnpm test:integrations:integration`: PASS. Fresh migrations `0001`–`0019` applied; migration precheck and runtime readiness passed; 3 adapter tests and 7 PostgreSQL/API tests passed; `/integrations` returned HTTP 200.
- `pnpm test`: PASS, 106 passed and 157 opt-in integration tests skipped across 31 files. The Phase 14 opt-in cases ran separately above.
- `pnpm typecheck`: PASS across 12 workspace projects.
- `pnpm format:check`: PASS, 196 files checked.
- `pnpm lint`: PASS with 124 repository-wide warnings and no errors.
- `git diff --check`: PASS; Git printed only line-ending normalization notices for two existing CRLF Markdown trackers.
- `pnpm test:integrations:clean`: PASS. The services were stopped, then only the marked `TEMP/enough-phase14` fixture was removed.

## Security and release status

The common signed-source flow remains authenticated and owner/product scoped. The signing secret is encrypted at rest; API keys are stored as hashes; event user references are hashed; raw provider/backend exceptions are no longer logged. A valid owner HMAC establishes control of the configured source only. It does **not** establish vendor origin. Do not mark integration evidence automatically verified or award automatic credits through this owner-controlled path.

Phase 11 remains ACTIVE with P11-1, P11-2, P11-3 PASS and P11-4/P11-5 BLOCKED. Phase 13 remains COMPLETE. Production remains **NO-GO** while all 18 dependency-security findings are open. No production deployment, Docker, GitHub Actions, external provider account, or provider credential was used.
