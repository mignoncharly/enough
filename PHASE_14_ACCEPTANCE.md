# Phase 14 — Integrations Acceptance

**Status: ACTIVE — deterministic provider acceptance PASS; local browser acceptance PASS; Google and Stripe external acceptance PASS; four external real-provider gates remain pending.**

The canonical exit criterion is: **Meaningful real-world events can be verified automatically.** The Generic webhook and Public Event API authenticate only the workspace owner's configured source. Provider OAuth/API connections now authenticate to Gmail, Google and Microsoft calendars/mail, Stripe, PostHog, Plausible, and GA4. Provider sync evidence remains pending owner review. Stripe events are checked against the connected Stripe account; only a confirmed payment event with a matching task completion ID can automatically verify a task and issue its reward.

## Automated provider acceptance — PASS — 2026-10-13

Migration `0020_provider_integrations.sql` passed on a fresh chain through `0020` and as an upgrade from the accepted `0019` schema. Migration precheck reported no pending migrations. Account export, deletion, privacy, and credential non-disclosure behavior passed with the provider state present.

The isolated automated suites passed: 18/18 provider-focused tests, 29/29 Phase 14 PostgreSQL/API runtime tests, and 121/121 default tests. Deterministic Google and Microsoft OAuth protocol coverage passed. Provider adapter contracts passed for Gmail, Google Calendar, Outlook, Microsoft Calendar, Stripe customer revenue, PostHog, Plausible, GA4, Generic webhook, and Public Event API.

- Google OAuth: authorization URL, one-use state/PKCE, least-privilege scopes, token exchange/refresh/expiry, changed or missing scopes, revocation/disconnect, credential-bearing redirect rejection, encrypted persistence/non-disclosure, sync success/failure, and normalized Gmail/Calendar events passed.
- Microsoft OAuth: `offline_access` issuance behavior, API-scope validation, refresh responses without returned `offline_access`, missing required Graph permissions, token rotation/preservation, expiry, revocation/disconnect, redirect rejection, and sync failure passed.
- Gmail/Outlook and both calendars: outreach/reply and supported event semantics, duplicate protection, no rewards from raw volume or scheduled-only events, completion/category/time requirements, and no persisted email bodies passed.
- Stripe customer revenue remains separate from Enough subscription billing. Signature/forgery/replay handling, supported webhook events, normalization, cancellation/refund behavior, and duplicate-credit protection passed deterministically.
- PostHog, Plausible, and GA4: configuration/auth validation, supported normalized mappings, privacy minimization, replay protection, ownership isolation, and failure/health recording passed.
- Provider-origin evidence passed the vendor-authenticated verification path and granted the product-scoped Build Credit exactly once. Generic webhook and Public Event API remain owner-controlled, pending evidence sources and grant no automatic reward. Phase 13 transaction/idempotency rules remain intact.

## Consolidated local browser acceptance — PASS — user-reported — 2026-10-13

The user completed the single consolidated browser session and reported PASS for the provider catalog; Google/Microsoft setup controls and disabled OAuth actions; Stripe customer-revenue setup and its separation from Enough billing; GA4 setup entry; seeded healthy, degraded, and revoked states; sync/history privacy and recoverable error state; and the 390px responsive layout. No raw provider errors, tokens, keys, secrets, stack traces, or local paths were exposed. The one-time credential display and secret disappearance after reload passed.

The seeded Stripe vendor-authenticated event appeared as automatically verified task evidence and produced exactly one +5 product-scoped Build Credit reward. Generic webhook and Public Event API evidence stayed pending and produced no automatic reward. Offline setup failure/recovery passed. Phase 14 fixtures were cleaned after the session.

## External provider acceptance — Google — PASS — user-reported — 2026-10-14

- **Gmail:** real Google OAuth and Gmail metadata API sync passed. Outreach, reply, and conversation-continuation events were provider authenticated; immediate re-sync produced no duplicate events. Email bodies were not required or displayed by Enough.
- **Google Calendar:** real Google OAuth and Calendar API sync passed. A past customer interview normalized as one completed interview; a future event and unrelated entries produced no completed event. Re-sync produced no duplicates, and real token refresh succeeded while preserving the existing refresh token when Google returned no replacement.
- **Shared revocation:** one real Calendar connection had encrypted access and refresh credentials, and its access token was usable before disconnect. Enough's normal Disconnect returned HTTP 200; Google's revoke endpoint returned HTTP 200 with audit result `REVOKED`; the local integration became `REVOKED` and its token row was removed. The same pre-disconnect access token then received HTTP 401 from Google. Exactly one active non-fixture Calendar connection existed before revocation; the seeded test fixture row was not a second real connection.
- **OAuth security:** tampered state, missing authorization code, callback replay, and insufficient granted scope were rejected by automated coverage. Provider failures remain sanitized.

The fixture issue found during acceptance is also closed: cleanup had removed `google-oauth.env`, and its absence was previously treated as empty configuration. Manual Google fixture startup now fails clearly when that configuration is required. The loader accepts only the two Google integration client settings, verifies their presence in the API child environment before application modules initialize, and never logs credential values. Synthetic configured/unconfigured catalog regression coverage confirms Gmail, Google Calendar, and GA4 availability behavior without contacting Google.

## Remaining external real-provider gates

- Microsoft real OAuth round trip with a dedicated test tenant and app.
- PostHog dedicated test project and credentials.
- Plausible dedicated test site/project and credentials.
- GA4 dedicated test property and credentials.

Do not use personal production accounts or production credentials for these gates. Deterministic local protocol coverage and browser acceptance do not substitute for the listed external account checks.

## Canonical scope audited

- Common integration account lifecycle, connect/disconnect state, protected credential storage, health, event ingest, sync/error schema, audit, ownership, replay/idempotency, rate limiting, privacy/export, deletion, evidence linkage, and reward idempotency.
- Gmail and Outlook messages; Google and Microsoft calendar events; Stripe customer revenue; PostHog, Plausible, and GA4 normalized analytics events.
- Generic signed webhooks and the authenticated Public Event API, including payload validation, provider/source authentication, idempotency, scoping, and failure boundaries.
- Integration-originated Phase 13 evidence and credit rewards.

## Earlier common-path acceptance record

At the time of the recorded common-path run, only **Generic webhook** (`WEBHOOK`) and **Public Event API** (`PUBLIC_API`) had executable adapters. The existing Stripe billing webhook handles Enough subscription events; it is separate from a founder's Stripe customer-revenue integration. The earlier billing tests covered Enough subscriptions, not customer-revenue verification.

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

## Fixes made

- Reject `amountMinor`/`currency` on non-revenue event types, preserving the required pair check for revenue events.
- Stop logging raw integration exceptions, which could contain provider responses, database details, or credential fragments. User responses remain generic.
- Add a marked Phase 14 TEMP fixture on dedicated PostgreSQL/Redis/API/worker/web ports and a cleanup command that verifies its marker, confirms services are stopped, then removes only `TEMP/enough-phase14`.
- Implement provider OAuth/API-token connections, provider sync, Stripe customer-revenue confirmation, and integration evidence linking; add migration `0020_provider_integrations.sql` and provider-focused unit/API integration coverage.
- Reject redirects on OAuth, provider API, and Stripe requests carrying bearer/client credentials; preserve Microsoft's `offline_access` grant while validating only scopes returned for its access token.
- Prevent duplicate Google connections for the same user/product/provider/identity while keeping Gmail, Google Calendar, and GA4 as distinct provider integrations; preserve an existing matching Google refresh token on reconnect when no replacement is returned; record safe callback failure and provider-revocation metadata.
- Load the dedicated Google OAuth fixture settings before API configuration initialization, fail clearly when required manual-fixture settings are missing, and test configured/unconfigured catalog availability with synthetic values only.

## Final checks

- `pnpm test`: PASS, 129/129 default tests (164 opt-in integration/runtime tests skipped). Google OAuth protocol tests passed 7/7 and Google fixture/config tests passed 4/4 in this serial run.
- `pnpm test:integrations:integration`: PASS, 36/36 Phase 14 PostgreSQL/API/runtime tests; migration chain through `0020`, migration precheck, and no-pending-migrations check passed.
- `pnpm typecheck`: PASS across the configured workspace projects.
- `pnpm format:check`: PASS, 209 files checked.
- `pnpm lint`: PASS with 129 repository warnings and no errors.
- `pnpm audit --json`: findings remain open; 21 package/advisory entries (3 critical, 9 high, 9 moderate) across `@vitest/mocker`, `dicer`, `esbuild`, `fast-xml-parser`, `sprintf-js`, `tar`, `tinypool`, and `vitest`. The 18 previously tracked entries remain unresolved; the fresh registry report adds `GHSA-wm7h-9275-46v2` (dicer) and `GHSA-x3cc-x39p-42qx` / `GHSA-gh4j-gqv2-49f6` (fast-xml-parser). No dependency or lockfile changes were made. Production remains NO-GO.
- `git diff --check`: PASS.
- Phase 14 status/documentation consistency checks: PASS. The acceptance record and current status summaries agree that Phase 14 is ACTIVE; deterministic provider and local browser acceptance are PASS; Google and Stripe external acceptance are PASS; Microsoft, PostHog, Plausible, and GA4 remain open; Phases 11–13 retain their accepted statuses; production remains NO-GO with the 18 previously tracked dependency-security findings still open and the 3 additional audit entries unresolved.

## Security and release status

The common signed-source flow remains authenticated and owner/product scoped. The signing secret is encrypted at rest; API keys are stored as hashes; event user references are hashed; raw provider/backend exceptions are not exposed. A valid owner HMAC establishes control of the configured source only. It does **not** establish vendor origin. Owner-controlled Generic webhook and Public Event API evidence remains pending and grants no automatic credits. Provider-origin evidence follows the accepted vendor-authenticated path, with automatic Build Credit exactly-once behavior verified for the Stripe fixture.

Phase 11 remains ACTIVE with P11-1, P11-2, P11-3 PASS and P11-4/P11-5 BLOCKED. Phase 12 remains COMPLETE. Phase 13 remains COMPLETE. Phase 14 remains ACTIVE until the four remaining external gates above pass. Production remains **NO-GO** while the 18 previously tracked dependency-security findings and the three additional findings from the latest audit remain unresolved. No personal or production provider account/credential was used.
