# Implementation Handoff

Historical implementation record. The active remediation plan and current execution handoff are now [REMEDIATION_IMPLEMENTATION_PLAN.md](REMEDIATION_IMPLEMENTATION_PLAN.md) and [REMEDIATION_HANDOFF.md](REMEDIATION_HANDOFF.md).

Last updated: 2026-10-07
Current phase: Phase 27 - Full Product Launch Gate
Status: Phase 27 is partial and the launch decision is NO-GO. The capability-by-capability assessment is recorded in `LAUNCH_READINESS.md`. Phases 25 and 26 remain partial: there is no configured production host and no production integration verification. Phase 24 remains partial with signed desktop installers and store/runtime acceptance outstanding.

## Current objective

Continue the implementation plan in `ENOUGH_COMPLETE_IMPLEMENTATION_PLAN.md`. The Phase 27 launch decision is NO-GO until the blockers in `LAUNCH_READINESS.md` are resolved and verified. Source through Phase 25 is present, but runtime acceptance for Phases 2 through 26 remains pending. Migrations `0002_authentication.sql` through `0015_admin_console.sql` have not been applied. Provider, web, extension, desktop, packaging, native-host, task-reward, evidence privacy, event signature, verification, AI provider, report aggregation, notification delivery, Stripe billing, privacy, security, edge-case, admin, and production infrastructure flows remain unverified. The API does not yet issue signed policy snapshots, so encrypted desktop cache freshness is advisory rather than cryptographically verifiable. Offline policy is usable for at most 24 hours after sync; a stale or clock-inconsistent cache pauses local enforcement. Phase 14 currently authenticates owner-controlled event sources; provider-specific OAuth and vendor signature adapters remain follow-up work. Phase 15 provides an optional advisory interface; model behavior and the local fallback have not been accepted at runtime. Phase 16 reports use reported focus duration, source-supplied integration events, and the product wallet ledger; their browser and database behavior has not been accepted. Phase 17 supports persisted web inbox items, desktop alert polling, and opt-in Resend delivery; notification runtime behavior has not been accepted. Phase 18 adds configurable Stripe subscriptions; live/test account setup, pricing and feature mapping, webhooks, and runtime behavior remain unaccepted. Phase 19 adds user privacy controls, but its migration, external Stripe deletion path, retention scheduler, consent gates, and UI have not been accepted against a running environment.
Phase 22's Admin Console source is present; migration `0015_admin_console.sql` and admin runtime acceptance remain pending. Phase 23 has 65 passing unit/property/contract tests and successful desktop/extension source builds; live database, runtime, concurrency, load, and broad security acceptance remain pending. Phase 24 adds installer/update configuration and extension store archive generation. `pnpm install --frozen-lockfile` now succeeds with the reviewed `electron-winstaller` install hook enabled, but local electron-builder packaging stops when Node receives `EPERM` reading the linked `dotenv` package. No signed desktop installers, browser store submissions, or end-user update installation have been accepted.

Do not restart Phase 1 implementation. Its baseline work is complete; only its runtime acceptance remains unresolved in this environment.

Phase 21 is not fully accepted: its source checklist is checked, but live edge-case scenarios, builds, and runtime acceptance remain outstanding. Phase 22 source is now present; migration `0015_admin_console.sql` has not been applied.

## Phase 1 record

- Created the pnpm workspace, TypeScript/Biome/Vitest setup, shared config/cache/database/queue packages, web/API/worker services, health/readiness endpoints, SQL migration runner, and local systemd/Nginx templates.
- Installed and resolved workspace dependencies with pnpm 11.20.0 and created `pnpm-lock.yaml`.
- Created the local development role/database and applied the initial SQL migration/checksum directly through `psql`.
- PostgreSQL at port 5433 and Redis at port 6379 accepted connections. The web, API, and worker health endpoints did not respond during the earlier acceptance attempt; a pre-existing process on port 3000 was left untouched.
- `pnpm db:migrate` stopped at pnpm's `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. Direct execution reached the TypeScript loader but failed with `EPERM` reading the pnpm-linked `pg` package file. The sandbox denies access to package files even though workspace links exist.
- No app services from this workspace were confirmed running. Phase 1 runtime acceptance remains pending.

## Phase 2 implementation map

- `packages/db/migrations/0002_authentication.sql`: users, OAuth identities, devices, sessions, one-use auth tokens, OAuth states, and audit events.
- `packages/auth`: password/token cryptography, Redis-backed rate limits, transactional email, browser/bearer sessions, CSRF checks, auth/account routes, and Google/GitHub OAuth.
- `apps/api/src/server.ts`: auth route registration, exact-origin CORS allowlist, loopback-only proxy trust, request size cap, and sensitive request-log redaction.
- `infra/nginx/enough.conf`: `/auth/*`, `/onboarding*`, and `/products*` route to Fastify; forwarded client IP headers reach the API through the loopback proxy.
- `apps/web/app/auth-panel.tsx`, `page.tsx`, `login/page.tsx`, `oauth/complete/page.tsx`, `verify-email/page.tsx`, `reset-password/page.tsx`: browser sign-in, verification, reset, and account/session/device management.
- `apps/web/next.config.ts`: same-origin `/api/auth/*` proxy to the API.
- `packages/auth/README.md`: browser/native client contract and provider/email setup.
- `IMPLEMENTATION_PLAN.md`, `SECURITY_STATUS.md`, `KNOWN_LIMITATIONS.md`, and `README.md`: updated status and setup notes.

## Phase 3 implementation map

- `packages/db/migrations/0003_product_onboarding.sql`: user-owned onboarding profile with validated stage, traction, revenue, goal, tools, and generated recommendation fields.
- `apps/api/src/onboarding.ts`: authenticated, CSRF-protected profile read/save routes and deterministic recommendations tailored to the nine product stages.
- `apps/web/app/onboarding/page.tsx`: three-step wizard for all ten plan questions, with editable answers on repeat visits.
- `apps/web/app/dashboard/page.tsx`: product workspace with stage focus, priorities, signals, launch status, users, and revenue.
- `apps/web/app/workspace-data.ts`: shared onboarding types and same-origin API calls.
- `apps/web/next.config.ts`: same-origin `/api/onboarding/*` proxy.
- Account export now includes the onboarding profile and generated configuration.

The recommendation is deterministic guidance from stage and answers. It does not create or enforce app-blocking policies; those are planned for later phases.

## Phase 4 implementation map

- `packages/db/migrations/0004_product_stage_engine.sql`: products, stage history, user-owned goals, metric observations, onboarding-to-product linkage, and backfill from existing onboarding profiles.
- `packages/shared/src/product-stage.ts`: nine stage definitions with distinct priorities, signals, suggested tasks, and build/customer-learning ratios.
- `apps/api/src/products.ts`: authenticated product listing/creation/detail, stage updates, goal management, metric recording, ownership checks, and audit events.
- `apps/api/src/onboarding.ts`: creates or synchronizes the canonical product, stage history, initial goal, and metric observations in the onboarding transaction.
- `apps/api/src/server.ts`, `apps/web/next.config.ts`, and `infra/nginx/enough.conf`: product API registration, no-store responses, same-origin rewrite, PATCH CORS support, and reverse-proxy routing.
- `apps/web/app/dashboard/page.tsx` and `apps/web/app/workspace-data.ts`: product selector and creation, editable stage, guidance, goals, metric history, and stage history.
- Account export includes product details, stage history, goals, and metrics alongside onboarding answers.

Stage ratios, priorities, and tasks are recommendations only; policy enforcement is not part of Phase 4.

## Phase 5 implementation map

- `packages/db/migrations/0005_activity_event_platform.sql`: append-only activity events with per-user idempotency, per-device/product sequence uniqueness, event ordering indexes, and hourly aggregate counters.
- `apps/api/src/activity.ts`: authenticated, CSRF-protected `POST /activity/events` and `POST /activity/batch` routes, product ownership checks, bounded event attributes, idempotency hash checks, batch deduplication, clock-skew correction, offline timestamp support, transactional aggregation, and Redis-backed per-user request/event-volume limits.
- Client event sequence is monotonic per device and product. Past timestamps are preserved for offline uploads; timestamps more than five minutes in the future are retained as client timestamps but use server time for effective ordering and aggregation.
- Batch uploads accept up to 100 events. Replaying the same event IDs and content is safe; reusing an ID with different content or reusing a sequence returns a conflict.
- `apps/api/src/server.ts`, `apps/web/next.config.ts`, and `infra/nginx/enough.conf`: activity route registration, no-store responses, same-origin rewrite, and reverse-proxy routing.
- Account export includes submitted activity events and hourly aggregates; audit metadata records only accepted/duplicate counts.

Event attributes are limited to 16 scalar fields and 2 KB per event. Clients must not send personal or secret values.

Event payload contract:

```json
{
  "eventId": "client-generated UUID",
  "productId": "owned product UUID",
  "eventType": "focus.session_started",
  "eventVersion": 1,
  "clientSequence": 42,
  "occurredAt": "2026-10-06T12:00:00.000Z",
  "attributes": { "duration_seconds": 900 }
}
```

The batch route accepts `{ "events": [...] }` with 1–100 events. It returns per-event acceptance/duplicate status, normalized effective timestamps, and aggregate counts. Clients should persist event IDs and per-product sequence counters across offline retries.

## Phase 6 implementation map

- `packages/db/migrations/0006_tool_classification.sql`: seeded default application/domain catalog plus user-owned mappings. Product-scoped mappings reference `(product_id, user_id)` and cascade when the product or account is deleted. Unique indexes reject duplicate keys for the same scope and context.
- `packages/shared/src/tool-classification.ts`: supported labels and kinds, application/domain key normalization, wildcard domain matching, and the deterministic resolver.
- `apps/api/src/classification.ts`: authenticated catalog and mapping reads, CSRF-protected create/update/delete and preview-resolution routes. Product ownership is checked before scoped changes or resolution.
- `apps/api/src/server.ts`, `apps/web/next.config.ts`, and `infra/nginx/enough.conf`: API registration, no-store responses, same-origin rewrite, and reverse-proxy route.
- `apps/web/app/tools/page.tsx`: browse defaults, add/edit/remove account or product mappings, define context pairs, and preview resolution. The dashboard links to this page.
- Account export includes user-defined tool mappings. Account and product deletion remove mappings through database cascades.

Resolution precedence is product-scoped mapping, matching context, most-specific matching domain key, custom mapping over catalog at equal specificity, catalog default, then `NEUTRAL` fallback. Exact domain keys match only that hostname; `*.example.com` matches subdomains but not the apex. Application identifiers are trimmed and case-folded; domain URLs normalize to hostnames. `BLOCKED` and `ALLOWED` are labels only; Phase 6 does not enforce access policy.

## Phase 7 implementation map

- `packages/db/migrations/0007_rule_engine.sql`: user-owned policy rules, per-rule version snapshots, product/device scopes with ownership-safe foreign keys, and expiring/revocable ALLOW/BLOCK overrides.
- `packages/shared/src/policy-rules.ts`: pure policy evaluator, rule condition matching, time-zone schedules, scope and priority ordering, deterministic tie-breaking, override resolution, and default ALLOW decision.
- `apps/api/src/rules.ts`: authenticated rule CRUD/archive and version history, temporary override CRUD, and evaluation API. Rule edits use expected-version conflict detection; product/device scopes are checked against the signed-in account.
- `apps/api/src/server.ts`, `apps/web/next.config.ts`, and `infra/nginx/enough.conf`: rule route registration, no-store responses, same-origin rewrites, and API proxy routing.
- `apps/web/app/rules/page.tsx`: rule editor for conditions/actions/scopes/schedules, version history, temporary overrides, and decision preview. Product dashboard and tool page link to rules.
- Account export includes rules, version snapshots, and overrides. Rules/overrides and history are removed on account deletion; product/device-scoped records cascade when those scopes are deleted.

Rule conditions are conjunctive across supplied fields; multiple classifications or tool keys within a field use OR. Schedule times use the stored IANA time zone, selected local weekdays, and half-open intervals (`start <= local time < end`). If start and end are equal, the rule covers the full selected local day. Evaluation uses a single database timestamp and a repeatable-read policy snapshot. Active matching overrides outrank rules; more specific product/device/tool overrides win, then newest creation, then BLOCK on an otherwise equal tie. Rules order by priority descending, scope/condition specificity descending, action restrictiveness (`BLOCK`, `REQUIRE_OVERRIDE`, `WARN`, `ALLOW`), then rule ID ascending. `WARN` permits with a warning decision; `REQUIRE_OVERRIDE` denies unless an active override applies. No matching rule defaults to ALLOW. Deterministic test cases and runtime verification remain outstanding.

## Phase 8 implementation map

- `packages/db/migrations/0008_credit_engine.sql`: global and product-scoped accounts, an append-oriented transaction ledger with refund totals, expiring grant lots, reservations with per-lot allocations, spend allocations, and refund allocation history. Product/account deletion cascades through the wallet data.
- `apps/api/src/credits.ts`: authenticated wallet reads and earn, spend, reserve, release, reserved spend, refund, expire, and adjust operations. Writes require cookie-session CSRF validation and an idempotency key; all devices for a user and wallet share an account-row lock. Available credits are allocated from earliest-expiring lots first.
- Expiration is reconciled on wallet reads and before credit mutations. Expired grant allocations leave balances; reservation expiry returns unexpired held credits and expires portions whose grant has already expired. Refunds return credits to their original grant lots, retaining the original expiration.
- `apps/api/src/server.ts`, `apps/web/next.config.ts`, and `infra/nginx/enough.conf`: no-store API registration, same-origin rewrite, and reverse-proxy routing.
- `apps/web/app/credits/page.tsx` and `apps/web/app/workspace-data.ts`: wallet selector, balances, ledger, reservations, and controls for each operation. The dashboard links to the wallet.
- Account export includes credit accounts, transactions, lots, reservations, and allocation records.

The current earn and credit-adjust APIs are owner-authenticated manual controls, not verified reward issuance. Do not treat them as billing or task-completion evidence; trusted reward issuance and production entitlement integration remain future work. Atomicity and multi-device behavior have not passed concurrency or runtime acceptance.

Credit amounts are positive integer units, capped at one billion per request. Omit `productId` (or pass `null`) for the account-wide wallet; pass an owned product UUID for a product wallet. Every write body carries an `idempotencyKey` (8–120 characters). Routes are `GET /credits`, `POST /credits/earn`, `/spend`, `/reserve`, `/refund`, `/adjust`, `/expire`, and `POST /credits/reservations/:reservationId/release` or `/spend`. Refunds require the original spend transaction ID and cannot exceed its unrefunded allocation. Reservation release/spend consumes the reservation's current remaining amount; partial expiration can reduce that amount while leaving the rest active.

## Phase 9 implementation map

- `apps/web/app/workspace-header.tsx`, `workspace-frame.tsx`, and `theme-sync.tsx`: shared responsive navigation, active-page indication, persistent light/dark/system preference, and app-wide theme application. Navigation uses native details/summary controls and visible keyboard focus styles.
- `apps/web/app/today`, `activity`, `growth`, `tasks`, `reports`, `notifications`, `devices`, and `settings`: product summary, event history, stage guidance, goal-backed actions, bounded activity/metric reports, notification inbox and preferences, session/device management, and appearance/account settings.
- `apps/api/src/activity.ts` and `apps/web/app/workspace-data.ts`: authenticated, user-scoped `GET /activity/events` read API, product ownership filtering, bounded result count, and same-origin client helper.
- `/products` routes to product selection and editing on `/dashboard`. Phase 14 now supplies signed inbound Generic webhook and Public Event API connections; Phase 18 provides a separate Stripe Billing flow for Enough subscriptions.
- The navigation links to existing tools, rules, and credit pages. API authorization remains the access boundary; client-side login redirects are presentation behavior only.

No schema migration was added in Phase 9. Evidence and subscription billing were future-phase surfaces at that point; Phase 13 added evidence and Phase 14 added signed inbound integrations. The web UI, keyboard flow, responsive layouts, error/empty/permission states, and activity read API have not passed browser or runtime acceptance.

## Phase 10 implementation map

- `apps/extension/manifest.base.json`, `build.mjs`, and `src/`: Manifest V3 builds for Chromium browsers and Firefox, with a browser API compatibility layer and bundled shared policy/classification evaluation.
- `apps/extension/src/options.ts` and `src/background.ts`: API-origin permission, extension bearer sign-in, session rotation/revocation, product selection, five-minute policy sync, offline cache, and dynamic top-level navigation rules.
- `apps/extension/src/block.ts` and `src/popup.ts`: policy block page, 60-minute Growth Mode allowlist, opt-in hostname-only event recording, queue/health reporting, and native-host probe.
- `apps/extension/README.md`, `packages/auth/README.md`, and `.env.example`: build/load instructions, exact `AUTH_ALLOWED_ORIGINS` setup, extension token handling, and privacy behavior.

No migration was added. The extension requests access only to its configured API origin; blocking uses `declarativeNetRequest` and does not request access to every site. It caches policy data and evaluates the shared policy logic locally. Activity capture is opt-in and stores only hostnames and policy metadata. Phase 11 now supplies a source native host; installation and browser health reporting remain unverified. Extension compilation, browser installation, policy parity, and offline behavior have not been verified.

Implemented flows include email/password signup and login, email verification, magic links, password reset, Google/GitHub OAuth, browser cookies, bearer sessions, session rotation, session/device revocation, password change, account export, account deletion, and audit events. Passkeys were deferred as impractical for this phase. The extension and desktop app use the bearer API contract; their end-to-end acceptance is pending.

## Phase 2 acceptance checklist

- [x] Add authentication schema migration and package/API/web implementation.
- [x] Add setup guidance for local email preview, Resend, OAuth callbacks, and exact-origin allowlisting.
- [ ] Apply migration `0002_authentication.sql` through `pnpm db:migrate` in a normal local runtime.
- [ ] Start web, API, PostgreSQL, and Redis; confirm health/readiness and verify the migration result.
- [ ] Exercise browser signup, verification, password login, magic link, password reset, logout, rotation, account export, and account deletion.
- [ ] Exercise Google and GitHub sign-in with configured provider credentials.
- [ ] Verify email delivery with Resend or confirm the opt-in local link preview.
- [ ] Exercise extension bearer login and session/device revocation; desktop-client acceptance remains for Phase 11.
- [ ] Review implementation and run the project's requested quality checks before marking Phase 2 complete. No tests or typechecks were run during this handoff.

## Phase 3 acceptance checklist

- [x] Add the onboarding data migration, authenticated API, wizard, and starting dashboard.
- [x] Generate stage-specific initial priorities and signals; include user answers in account export.
- [ ] Apply migrations `0002_authentication.sql` and `0003_product_onboarding.sql` in order.
- [ ] Confirm an authenticated founder can save, reload, and edit every onboarding answer.
- [ ] Confirm each stage produces its matching recommendation and the dashboard loads after setup.
- [ ] Verify account export contains onboarding answers and the generated recommendation.
- [ ] Review implementation and run the project's requested quality checks before marking Phase 3 complete. No tests or typechecks were run during this handoff.

## Phase 4 acceptance checklist

- [x] Add canonical product, stage history, goal, and metric schema plus onboarding backfill.
- [x] Add user-scoped product APIs with stage, goal, metric, and audit updates.
- [x] Make onboarding create/update its canonical product and record stage/metric history.
- [x] Add stage-specific priorities, signals, tasks, and recommended build/customer-learning ratios.
- [x] Add the product workspace dashboard and include product data in account export.
- [ ] Apply migrations `0002_authentication.sql` through `0004_product_stage_engine.sql` in order.
- [ ] Confirm onboarding creates a product and edits synchronize product data, primary goal, stage history, and changed metrics.
- [ ] Confirm all nine stages return distinct guidance and stage changes update the dashboard and history.
- [ ] Exercise product creation, multiple-product selection, goal status changes, metric recording, and account export.
- [ ] Review implementation and run the project's requested quality checks before marking Phase 4 complete. No tests or typechecks were run during this handoff.

## Phase 5 acceptance checklist

- [x] Add persistent activity events with per-user deduplication, per-device/product ordering, and hourly aggregates.
- [x] Add authenticated single-event and batch ingestion with product ownership checks and CSRF protection for cookie sessions.
- [x] Support offline event timestamps and adjust future timestamps beyond five minutes for effective ordering while preserving client timestamps.
- [x] Make batch retries idempotent and reject event ID or sequence reuse with conflicting data.
- [x] Include activity events and aggregates in account export; keep responses no-store and audit metadata limited to counts.
- [ ] Apply migrations `0002_authentication.sql` through `0005_activity_event_platform.sql` in order.
- [ ] Confirm duplicate/replayed batches do not increment aggregates and conflicting event/sequence reuse is rejected atomically.
- [ ] Confirm offline ordering, future clock adjustment, and hourly aggregation against a development database.
- [ ] Exercise product ownership isolation and account export for activity data.
- [ ] Review implementation and run the project's requested quality checks before marking Phase 5 complete. No tests or typechecks were run during this handoff.

## Phase 6 acceptance checklist

- [x] Seed default application/domain classifications and define all six supported labels.
- [x] Add custom application/domain mappings, product scope, context pairs, uniqueness, and account export support.
- [x] Add deterministic resolution with wildcard domain matching and neutral fallback; expose preview in the workspace UI.
- [x] Keep `BLOCKED` and `ALLOWED` descriptive only; do not enforce policy in this phase.
- [ ] Apply migrations `0002_authentication.sql` through `0006_tool_classification.sql` in order.
- [ ] Confirm catalog items, account/product mappings, context matches, wildcard domains, and unknown keys resolve as expected.
- [ ] Confirm duplicate mappings conflict, product ownership boundaries hold, and product/account deletion removes scoped mappings.
- [ ] Confirm account export includes mappings and the tools page can create, edit, remove, and preview mappings at runtime.
- [ ] Review implementation and run the project's requested quality checks before marking Phase 6 complete. No tests or typechecks were run during this implementation turn.

## Phase 7 acceptance checklist

- [x] Add actions, JSON conditions, numeric priorities, product/device scopes, IANA time-zone schedules, version snapshots, and temporary overrides.
- [x] Add deterministic shared evaluation for a fixed input, policy snapshot, and evaluation timestamp, with explicit tie-breaking and neutral classifier integration.
- [x] Add authenticated rule create/update/archive, version history, override create/revoke, and policy-evaluation routes with CSRF protection on writes.
- [x] Add workspace UI for rules, schedules, conditions, version history, overrides, and decision previews; include rule data in account export.
- [ ] Add deterministic test cases for condition combinations, scope selection, priorities/ties, schedules/time zones, override expiry/revocation, version conflicts, and default decisions.
- [ ] Apply migrations `0002_authentication.sql` through `0007_rule_engine.sql` in order.
- [ ] Confirm repeated evaluation against the same input, policy snapshot, and timestamp produces byte-for-byte equivalent decision fields.
- [ ] Exercise user/product/device isolation, stale-version conflicts, archive history, schedule boundaries, and temporary override expiry/revocation against a development database.
- [ ] Confirm account export/deletion includes/removes rule data and the workspace works after migrations are applied.
- [ ] Review implementation and complete the project's quality checks before marking Phase 7 complete. No tests or typechecks were run during this implementation turn.

## Phase 8 acceptance checklist

- [x] Add global and product-scoped credit accounts, immutable transaction records, expiring grant lots, and reservation/spend/refund allocations.
- [x] Add authenticated earn, spend, reserve, release, reserved spend, refund, expire, and adjust operations with per-wallet idempotency keys.
- [x] Serialize wallet mutations by locking the shared account row; allocate only unexpired credits and preserve original lot expiry through refunds.
- [x] Add the wallet page and include all credit state in account export.
- [ ] Add deterministic and database concurrency cases proving two devices cannot double-spend and retries do not duplicate ledger effects.
- [ ] Apply migrations `0002_authentication.sql` through `0008_credit_engine.sql` in order.
- [ ] Exercise earn/spend, partial and full reservations, release, reserved spend, partial refunds, expiry, adjustments, product isolation, and account export against PostgreSQL.
- [ ] Confirm concurrent spends never produce a negative balance or consume the same credit lot twice.
- [ ] Review implementation and complete the project's quality checks before marking Phase 8 complete. No tests or typechecks were run during this implementation turn.

## Phase 9 acceptance checklist

- [x] Add shared navigation across workspace pages, including links to existing tools, rules, and credit controls.
- [x] Add Today, Activity, Growth, Tasks, Reports, Devices, Settings, and product navigation surfaces; keep event reads user-scoped and bounded.
- [x] Add a persistent system/light/dark theme preference and app-wide theme application.
- [x] Add explicit future-phase states for Evidence (Phase 13), Integrations (Phase 14), and Billing (Phase 18).
- [ ] Apply migrations `0002_authentication.sql` through `0008_credit_engine.sql` and start the full local stack.
- [ ] Verify each route in a browser at desktop and mobile widths, including keyboard navigation, theme persistence, and loading/empty/error/unauthorized states.
- [ ] Confirm activity filtering, product ownership isolation, device/session revocation, goal actions, report limits, and account export links at runtime.
- [ ] Review implementation and complete the project's quality checks before marking Phase 9 complete. No tests or typechecks were run during this implementation turn.

## Phase 10 acceptance checklist

- [x] Add Chromium and Firefox Manifest V3 build definitions and a browser API compatibility layer.
- [x] Add extension bearer sign-in, local policy/classification cache, product selection, and periodic policy synchronization.
- [x] Add dynamic top-level domain blocking, focus page, timed Growth Mode allowlist, and persisted offline policy.
- [x] Add opt-in hostname-only activity capture with bounded offline queue and extension health status.
- [x] Add a native messaging connection probe; Phase 11 now supplies the host source, with installation acceptance tracked there.
- [ ] Install dependencies, build both packages, and inspect generated manifests/assets in Chromium and Firefox.
- [ ] Add the installed extension origin to `AUTH_ALLOWED_ORIGINS`; apply migrations and exercise auth, revocation, sync, ownership, block/allow precedence, schedules, overrides, Growth Mode expiry, offline use, and event ingestion.
- [ ] Confirm page paths/content are never captured and test policy updates and revoked sessions across browser restarts.
- [ ] Review implementation and complete the project's quality checks before marking Phase 10 complete. No tests, builds, or typechecks were run during this implementation turn.

## Phase 11 implementation map

- `apps/desktop/src/main.mjs`: Electron tray and app windows, desktop bearer login, encrypted `safeStorage` cache, five-minute product/rule/classification sync, shared local application classification and policy evaluation, Build/Growth session timer, idle/lock handling, active-app time aggregation, offline event queue, notifications, and emergency application overrides.
- `apps/desktop/src/preload.cjs` and `renderer/`: isolated IPC surface, desktop controls, local classification editor, tracking consent, grace-period settings, and full-screen restricted-app reminder. App names and active seconds are synced only after the user opts in; window titles and browser URLs are not read or uploaded.
- `apps/desktop/src/native-host.cjs` and `scripts/install-native-host.mjs`: bounded length-prefixed native messaging protocol, freshness-checked desktop heartbeat, Chromium/Firefox host manifests, and per-user browser registration.
- `apps/desktop/scripts/build.mjs`, `package.json`, and `README.md`: cross-platform Electron packaging targets, source build commands, local setup, privacy behavior, and platform limitations.
- `apps/extension/src/background.ts`: waits for the host health response and reports the desktop agent as connected only while its heartbeat is fresh.

No migration was added. Source implements local cached evaluation and offline event queuing, but the cache signature required by the plan has no matching signed-snapshot API yet. Linux Wayland active-app monitoring is unsupported; Linux screen-lock reporting depends on the desktop environment. The development native host uses the Node runtime and source path, so a production installer still needs a standalone host executable. Update feed and platform signing are not configured. No build, test, or typecheck was run.

## Phase 11 acceptance checklist

- [x] Add the desktop tray app, Build/Growth controls, startup preference, active-app and idle monitoring, encrypted cache, local shared-policy evaluation, notifications, grace period, lock reminder, emergency bypass, sync, and updater integration source.
- [x] Keep desktop event collection opt-in; omit window titles, tab URLs, and window contents; cap offline activity queue at 1,000 events with seven-day retention.
- [x] Supply the native messaging host and extension health handshake source.
- [ ] Resolve and install workspace dependencies; build the app and installers for Windows, macOS, and Linux.
- [ ] Apply migrations `0002_authentication.sql` through `0008_credit_engine.sql`; exercise desktop login, token revocation, product selection, policy sync, and event ingestion.
- [ ] Verify active-app identifiers/classification for Cursor, VS Code, GitHub Desktop, Docker Desktop, Claude, IntelliJ, Android Studio, and terminals on each supported OS; verify idle, lock, suspend/resume, grace expiry, emergency bypass, and offline recovery.
- [ ] Install the native host in Chrome/Edge/Brave/Firefox, confirm heartbeat behavior while the desktop agent starts/stops, and verify browser restarts and per-user permissions.
- [ ] Add signed, expiring policy snapshots and verify signature validation before relying on offline policy. Current cache is encrypted but the API policy is unsigned.
- [ ] Configure release feeds and code signing; exercise update discovery, download, verification, and restart on packaged platforms.
- [ ] Review implementation and complete requested quality checks before marking Phase 11 complete. No tests, builds, or typechecks were run during this implementation turn.

## Phase 12 implementation map

- `packages/db/migrations/0009_growth_task_engine.sql`: stage-specific task templates, user/product-owned tasks, recurrence series and occurrences, completion records, signal strength, priority, time estimates, due dates, and reward amounts.
- `apps/api/src/tasks.ts`: authenticated template/task reads, custom and template task creation, cancellation, idempotent completion responses, recurring occurrence creation, and task audit events. New completion rows await evidence; reward grants run from the Phase 13 review transaction.
- `apps/api/src/credits.ts`: internal transaction-scoped task reward grant reuses wallet locking, grant lots, and the credit ledger. Phase 13 calls it only after evidence verification and records the evidence ID in transaction metadata.
- `apps/api/src/server.ts`, `apps/web/next.config.ts`, and `infra/nginx/enough.conf`: no-store API registration, same-origin rewrite, and `/growth-tasks` API proxy path that does not shadow the web `/tasks` page.
- `apps/web/app/tasks/page.tsx` and `apps/web/app/workspace-data.ts`: stage recommendation templates, custom task configuration, priority/signal/time/reward settings, due dates, recurring tasks, completion/cancellation, and task history.
- `packages/auth/src/routes.ts`: account export now includes growth tasks and completion records. Account and product deletion cascade through task data.

The task catalog is stage-specific and seeded from the current product-growth recommendations. Completing a recurring task creates the next occurrence due after its recurrence interval. Since Phase 13, new reward issuance waits for an evidence decision; legacy Phase 12 rewards already in the ledger remain marked `SELF_REPORTED` and are not issued again. Migration, browser, database, and reward behavior have not been accepted at runtime. No tests or typechecks were run during the Phase 12 implementation turn.

## Phase 12 acceptance checklist

- [x] Add task templates for all nine product stages, plus custom tasks with priority, signal strength, estimated minutes, due date, and reward settings.
- [x] Add recurring task series that generate the next due occurrence when the current occurrence is completed.
- [x] Add configured reward amounts and ledger integration; Phase 13 now gates new grants on manual evidence verification.
- [x] Add authenticated task APIs and workspace UI; apply ownership checks, CSRF protection on writes, rate limits, audit events, and account export coverage.
- [ ] Apply migrations `0002_authentication.sql` through `0009_growth_task_engine.sql` in order.
- [ ] Exercise stage template filtering, custom task creation, ownership isolation, cancellation, completion retries, recurrence generation, and credit ledger updates against PostgreSQL.
- [ ] Confirm the task page and API work after migration, including mobile/keyboard use, empty/error states, credit history, and account export/deletion.
- [ ] Review implementation and complete requested quality checks before marking Phase 12 complete. No tests or typechecks were run during this implementation turn.

## Phase 13 implementation map

- `packages/db/migrations/0010_evidence_system.sql`: completion review states and audit fields, private task-evidence records, supported evidence types, file metadata/content constraints, upload integrity fields, ownership-safe completion foreign key, and recent-evidence indexes. Existing unpaid completions move to `AWAITING_EVIDENCE`; Phase 12 rewards already issued remain `SELF_REPORTED`.
- `apps/api/src/tasks.ts` and `apps/api/src/credits.ts`: new task completions no longer issue rewards directly. A verified evidence decision grants the configured product-wallet reward through the existing credit ledger inside the evidence-review transaction.
- `apps/api/src/evidence.ts`: user-scoped evidence listing and creation for self-reports, notes, HTTP(S) URLs, file uploads, screenshots, and user-submitted integration references; authenticated file retrieval; manual evidence decisions; upload signature checks, per-file/account limits, rate limits, audit events, and reward idempotency.
- `apps/api/src/server.ts`, `apps/web/next.config.ts`, and `infra/nginx/enough.conf`: no-store route registration, same-origin API rewrites, and private API proxy routing.
- `apps/web/app/evidence/page.tsx`, `apps/web/app/tasks/page.tsx`, `apps/web/app/credits/page.tsx`, and `apps/web/app/globals.css`: evidence submission/review workspace, task-completion link, responsive evidence history, and credit-wallet explanation.
- `apps/web/app/workspace-data.ts` and `packages/auth/src/routes.ts`: typed evidence API helpers and account export including evidence metadata and base64 file content.

Uploaded files are stored in PostgreSQL and served only through authenticated ownership-checked routes. Files are limited to 2 MiB each and 20 MiB per account; accounts can hold up to 200 evidence items. Only PNG, JPEG, WebP, and PDF uploads are accepted, with screenshot evidence restricted to images. Integration references remain user-submitted until Phase 14 supplies authenticated connectors. Manual review is performed by the product owner using the same account, so it is auditable but not independent verification. New rewards are granted only when evidence is verified; manual wallet earn/adjust controls remain prototype controls. Browser, database, and security behavior have not been accepted at runtime.

## Phase 13 acceptance checklist

- [x] Add self-report, note, URL, upload, screenshot, and user-submitted integration-reference evidence types with private file retrieval.
- [x] Require an explicit manual decision and record reviewer, time, decision note, evidence state, and audit event.
- [x] Gate new task rewards on verified evidence and grant them atomically through the credit ledger.
- [x] Preserve already-issued Phase 12 rewards as `SELF_REPORTED` and prevent duplicate issuance.
- [x] Include evidence and uploaded content in account export; enforce file size, account quota, content signature, ownership, and rate limits in source.
- [ ] Apply migrations `0002_authentication.sql` through `0010_evidence_system.sql` in order.
- [ ] Exercise private upload/retrieval, ownership isolation, evidence rejection/retry, review idempotency, verified reward creation, wallet balance, account export, and account deletion against PostgreSQL.
- [ ] Confirm evidence, task, and credits pages work across mobile/keyboard use, error/empty states, and supported file types.
- [ ] Review implementation and complete requested quality checks before marking Phase 13 complete. No tests, builds, or typechecks were run during this implementation turn.

## Phase 14 implementation map

- `packages/db/migrations/0011_integration_platform.sql`: integration accounts, API credential hashes, encrypted token/signing-secret storage, sync runs, safe errors, normalized events, replay uniqueness, product/user ownership foreign keys, and automatic-vs-manual evidence method tracking.
- `apps/api/src/integration-adapters.ts` and `apps/api/src/integrations.ts`: shared adapter/catalog contract; signed Generic webhook and Public Event API account creation, revocation, source health, strict normalized event validation, raw-body HMAC verification, timestamp replay bounds, event-ID idempotency, IP/account rate limits, privacy-minimized storage, and audit records.
- `apps/api/src/server.ts`, `apps/web/next.config.ts`, and `infra/nginx/enough.conf`: custom raw-body event content type, no-store responses, same-origin workspace API rewrite, and public API proxy routing.
- `apps/api/src/evidence.ts`, `apps/api/src/credits.ts`, and `apps/web/app/evidence/page.tsx`: integration evidence records the source signature as authenticated, but linked task evidence stays pending for owner review; event receipt itself does not grant credits.
- `apps/web/app/integrations/page.tsx`, `apps/web/app/workspace-data.ts`, and `apps/web/app/globals.css`: create/revoke controls, one-time credentials, connection health, recent events, pending evidence links, and explicit trust-boundary text.
- `packages/auth/src/routes.ts`: account export includes safe integration account/event/sync/error data; credential hashes, encrypted secrets, and token values are not exported.
- `INTEGRATIONS.md` and `apps/web/public/INTEGRATIONS.md`: event API schema, signing example, retry behavior, limits, and trust boundary.

Only Generic webhook and Public Event API are available. The workspace owner controls their signing source; a valid HMAC proves control of the source, not that an outside vendor originated the claim. Linked task evidence is pending manual owner review and cannot directly issue credits. Gmail, Google Calendar, Outlook, Microsoft Calendar, Stripe, PostHog, Plausible, and GA4 OAuth/API adapters and provider-specific signature checks are not implemented. Migration, browser, database, signature, replay, isolation, export/deletion, and reward acceptance remain pending. No tests, builds, or typechecks were run during this implementation turn.

## Phase 14 acceptance checklist

- [x] Add the shared integration account, encrypted credential/token, normalized event, sync-run, and error model with ownership constraints.
- [x] Add Generic webhook and Public Event API creation/revocation with one-time credentials, exact-body HMAC verification, timestamp freshness, event validation, idempotency, rate limits, audit records, and workspace controls.
- [x] Keep event receipt from issuing task credits; linked evidence remains pending for the existing owner-review flow.
- [x] Include integration account/event/health/error data in account export without exporting secrets.
- [ ] Implement provider-specific Gmail, Google Calendar, Outlook, Microsoft Calendar, Stripe, PostHog, Plausible, and GA4 authentication/sync/signature checks.
- [ ] Apply migrations `0002_authentication.sql` through `0011_integration_platform.sql` in order.
- [ ] Exercise HMAC success/failure, timestamp expiry, identical retry, conflicting event-ID reuse, rate limits, revocation race, ownership isolation, evidence review, reward gating, export/deletion, and the integrations/evidence pages.
- [ ] Review implementation and complete requested quality checks before marking Phase 14 complete. No tests, builds, or typechecks were run during this implementation turn.

## Phase 15 implementation map

- `apps/api/src/ai.ts`: authenticated, CSRF-protected, per-user rate-limited Coach endpoint; product/task/evidence ownership checks; context selection by capability; optional OpenAI Responses request with strict JSON Schema output; deterministic stage-guidance fallback when no provider key is configured.
- `packages/config/src/index.ts` and `.env.example`: optional `OPENAI_API_KEY` and `OPENAI_MODEL` settings; the API does not require an AI provider to start.
- `apps/api/src/server.ts`, `apps/web/next.config.ts`, and `infra/nginx/enough.conf`: no-store API responses, same-origin rewrite, and API proxy routing.
- `apps/web/app/coach/page.tsx`, `workspace-header.tsx`, `workspace-data.ts`, and `globals.css`: Coach action selector, product/task/evidence selection, request-time privacy disclosure, advisory output, and explicit user-controlled task creation through the existing task API with zero credit reward.
- `AI_COACH.md`: provider setup, action-specific data sent, privacy boundaries, and acceptance status.

The seven capabilities are onboarding analysis, task generation, scope challenge, weekly diagnosis, next action, overbuilding explanation, and evidence classification assistance. The API sends no raw activity events or attributes, account IDs, evidence URLs, integration references, or uploaded file contents. It sends the selected evidence title/note only after an explicit classification request. Responses are not persisted by the application, and provider requests set `store: false`. AI does not change policy rules, verify/reject evidence, or issue credits. A suggested task is stored only after the user clicks Add task.

When no OpenAI key is configured, the API identifies its result as `STAGE_GUIDANCE` and uses deterministic stage recommendations. Provider calls, browser behavior, ownership isolation, rate limits, and privacy review have not been runtime-accepted. No tests, builds, or typechecks were run during this implementation turn.

## Phase 15 acceptance checklist

- [x] Add seven authenticated advisory actions with server-side product and selected-record ownership checks.
- [x] Keep AI out of policy enforcement, evidence decisions, and credit issuance; require a user action to save any suggested task.
- [x] Add a local deterministic stage-guidance response when no AI provider is configured.
- [x] Add optional OpenAI Responses integration with strict structured output, bounded response schema, timeout, provider error handling, and `store: false`.
- [x] Minimize provider context by capability and exclude raw activity details, account IDs, evidence URLs/references, and upload contents.
- [x] Add a Coach page with provider state, contextual disclosure, selected task/evidence controls, and advisory labels.
- [ ] Configure an OpenAI key in a development environment and exercise successful, incomplete, refusal, timeout, and provider error responses.
- [ ] Apply migrations `0002_authentication.sql` through `0011_integration_platform.sql`; exercise every capability, rate limits, CSRF, ownership isolation, and task creation against the API.
- [ ] Review the data disclosure and provider terms for the deployed account; verify logs do not contain prompts, evidence notes, or responses.
- [ ] Verify the Coach page across desktop/mobile, keyboard navigation, and loading/empty/error/unauthorized states; complete requested quality checks before marking Phase 15 accepted.

## Phase 16 implementation map

- `apps/api/src/reports.ts`: authenticated and rate-limited `GET /report-data`; product ownership checks; bounded 7/30/90-day UTC aggregates for focus durations, recognized integration signals, payment amounts, product-wallet ledger activity, task completions, linked conversion event ratios, and stage history; deterministic weekly review prompt.
- `apps/api/src/server.ts`, `apps/web/next.config.ts`, and `infra/nginx/enough.conf`: no-store report responses, same-origin `/api/reports` rewrite to `/report-data`, and API proxy route that does not shadow the web `/reports` page.
- `apps/web/app/reports/page.tsx`, `workspace-data.ts`, and `globals.css`: daily report selector, weekly founder review, Build/Grow, signal and credit trends, conversion ratios, current product snapshot, and stage history.
- `REPORTS.md`: metric definitions, event-source trust boundary, UTC date rules, and funnel limitations.

Focus time is derived from `focus.session_ended` duration attributes, capped at six hours per event. Market signal and payment counts use the normalized integration event table; the current available sources are owner-controlled Generic webhook and Public Event API connections. Conversion ratios count only anonymous references linked within the same integration account and date range. Product wallet amounts are ledger records; manual earning and adjustment controls remain prototype controls. Reports do not create task evidence, verify outcomes, or change rewards. No migration was added.

API database behavior, ownership isolation, timezone display, daily ranges, linked funnel calculations, responsive UI, and trust copy have not been runtime-accepted. No tests, builds, or typechecks were run during this implementation turn.

## Phase 16 acceptance checklist

- [x] Add a user-owned aggregated report API with selectable 7/30/90-day periods and UTC date bucketing.
- [x] Add a daily report for focus time, market events, payments, task completions, and product-wallet credits.
- [x] Add a seven-day founder review with Build/Grow split, market signals, task review state, credits, and a deterministic review prompt.
- [x] Add daily Build/Grow, market-signal, and credit trends plus product stage history.
- [x] Add outreach-to-reply, demo-to-signup, and signup-to-payment event ratios using anonymous linked references within an integration account.
- [x] Label reported/source-supplied data and document the limits on interpreting signatures, events, focus time, and credit ledger entries.
- [ ] Apply migrations `0002_authentication.sql` through `0011_integration_platform.sql`; exercise report queries with empty, single-currency, multi-currency, large-volume, and mixed-verification data.
- [ ] Verify ownership isolation, invalid ranges, rate limits, UTC boundaries, malformed focus attributes, linked/unlinked event ratios, and wallet scoping against PostgreSQL.
- [ ] Verify the Reports page across desktop/mobile, keyboard navigation, and loading/empty/error/unauthorized states; complete requested quality checks before marking Phase 16 accepted.

## Phase 17 implementation map

- packages/db/migrations/0012_notifications.sql: account-owned notification preferences, quiet-hour fields, persistent channel states, delivery timestamps, retry counts, rate-related indexes, and product ownership foreign keys.
- apps/api/src/notifications.ts and apps/api/src/server.ts: authenticated inbox and preference APIs, CSRF checks for writes, ownership scoping, quiet-hour checks, channel delivery acknowledgements, rate limits, and no-store responses.
- apps/api/src/products.ts, apps/api/src/evidence.ts, and apps/api/src/integrations.ts: create notifications transactionally for stage changes, verified task rewards, selected authenticated market events, and linked task evidence awaiting review.
- apps/worker/src/notifications.ts and apps/worker/src/server.ts: poll and send opted-in email, honor quiet hours, enforce three email deliveries per rolling day, retry with backoff, and use a stable Resend idempotency key.
- apps/desktop/src/main.mjs: poll pending desktop alerts once per minute, show supported OS notifications with local pacing, and acknowledge delivery to the API.
- apps/web/app/notifications/page.tsx, apps/web/app/settings/notification-preferences.tsx, workspace-data.ts, workspace-header.tsx, and globals.css: responsive inbox, read actions, channel preferences, time-zone and quiet-hour controls, and navigation.
- packages/auth/src/routes.ts: include notification preferences and records in account export; account deletion removes them through database cascades.
- NOTIFICATIONS.md: notification triggers, delivery limits, quiet-hour rules, email requirements, and trust boundaries.

Notification triggers are limited to verified task rewards, product stage changes, selected integration milestones (reply, interview, demo, payment, subscription), and signed integration evidence awaiting task review. Integration messages do not claim independent verification. Web inbox records are retained; desktop only offers pending alerts from the last seven days. Email is opt-in and requires a verified address and configured Resend credentials. The source imposes a 100-created-notifications rolling daily cap, a 10-delivered-desktop-alerts rolling hourly cap, a local 30-second desktop display interval, and a three-sent-emails rolling daily cap. Browser push is not enabled. Migration and runtime behavior remain unverified.

## Phase 17 acceptance checklist

- [x] Persist per-account channel preferences, IANA time zone, and optional overnight quiet hours.
- [x] Add a web inbox with read-one and read-all actions and include preferences and notifications in account export.
- [x] Add desktop polling, OS display, delivery acknowledgement, quiet-hour deferral, and pacing limits.
- [x] Add verified-email opt-in and worker-based Resend delivery with idempotent retries, quiet-hour deferral, and a daily cap.
- [x] Generate transactional notifications for verified task rewards, stage transitions, selected authenticated market events, and linked task evidence awaiting review.
- [x] Document notification data, channel behavior, source trust, and pacing limits.
- [ ] Apply migrations 0002 through 0012; verify empty preferences, channel toggles, ownership isolation, export, account deletion, and migration rollback expectations against PostgreSQL.
- [ ] Exercise email opt-in, invalid/unverified addresses, provider success/failure/retry, idempotency, daily limits, and quiet hours across time-zone/DST boundaries.
- [ ] Verify desktop offline recovery, duplicate acknowledgements, unsupported OS notifications, rate limits, and stale pending alerts.
- [ ] Verify the inbox and settings pages across desktop/mobile, keyboard navigation, and loading/empty/error/unauthorized states before marking Phase 17 accepted.

## Phase 18 implementation map

- `packages/db/migrations/0013_billing.sql`: account-owned Stripe customer, subscription, invoice, and entitlement state plus idempotent webhook event receipts; billing records cascade on account deletion.
- `apps/api/src/billing.ts`: configured monthly/annual Price lookup, hosted Checkout, Customer Portal sessions, promotion-code and tax options, raw-body signature verification, duplicate/out-of-order webhook handling, authoritative subscription retrieval, invoice reconciliation, grace-window entitlement calculation, and centralized `hasBillingEntitlement`.
- `packages/config/src/index.ts` and `.env.example`: server-only Stripe credentials, recurring Price IDs, optional trial length, grace duration, and automatic tax setting. Amounts are read from Stripe; the app does not hard-code prices.
- `apps/api/src/server.ts`, `apps/web/next.config.ts`, and `infra/nginx/enough.conf`: exact raw JSON retention for signed webhooks, billing route registration and same-origin requests, and Stripe webhook proxying.
- `apps/web/app/billing/page.tsx`, `workspace-data.ts`, and `globals.css`: responsive subscription status, configured checkout choices, customer portal, grace/trial/cancellation details, payment failure messaging, and invoice links.
- `packages/auth/src/routes.ts`: account export includes billing customer, subscription, entitlement, and invoice records without Stripe credentials or webhook payloads.
- `BILLING.md`: Stripe setup, webhook event list, tax/trial/grace behavior, and acceptance requirements.

The paid-feature entitlement key is intentionally generic because pricing and feature assignments must follow willingness-to-pay validation. Product feature-to-plan assignment is not guessed; future gated routes must call `hasBillingEntitlement` once that policy is decided. Trials default to zero days. When enabled, trial eligibility is reserved after Checkout successfully creates a trial session. Stripe Tax is enabled by default and requires account setup. Browser return URLs do not grant access; verified webhooks do. No Stripe calls, migrations, tests, builds, or typechecks were run during this implementation turn.

## Phase 18 acceptance checklist

- [x] Add configurable monthly/annual Stripe recurring Price IDs without inventing prices.
- [x] Add Checkout and Customer Portal session creation with CSRF protection, account ownership, request limits, and idempotency.
- [x] Support configured trials, promotion codes, billing address and VAT ID collection, and configurable automatic tax.
- [x] Verify exact-body Stripe webhook signatures with timestamp tolerance and secret rotation; store event IDs idempotently and reject stale out-of-order state updates.
- [x] Reconcile subscription state from Stripe, calculate active/trial/grace entitlement state centrally, and track cancellation and failed-payment state.
- [x] Persist invoice amounts, tax, status, retry count, bounded payment-error summary, and hosted invoice link; include billing records in account export.
- [x] Add the responsive Billing page and document Stripe setup and trust boundaries.
- [ ] Configure Stripe test mode, Tax, Customer Portal, recurring Prices, and webhook events; validate secret rotation and production setup.
- [ ] Apply migrations `0002_authentication.sql` through `0013_billing.sql`; exercise duplicate/out-of-order webhooks, ownership isolation, subscription changes, grace expiry, trial eligibility, coupon redemption, VAT, failed payments, portal actions, invoices, export, and account deletion.
- [ ] Decide paid-feature assignments after pricing validation and wire applicable API capabilities through `hasBillingEntitlement`.
- [ ] Verify Checkout redirects and the Billing page across desktop/mobile, keyboard navigation, and loading/empty/error/unauthorized states before marking Phase 18 accepted.

## Phase 19 implementation map

- `packages/db/migrations/0014_privacy.sql`: per-account activity, notification, and audit retention preferences; separately versioned activity-collection and AI-provider consents; evidence deletion tombstones and cleanup index.
- `apps/api/src/privacy.ts`: authenticated dashboard data, retention updates, consent grant/revoke audit records, full activity-history deletion, and rollup removal.
- `apps/worker/src/privacy-retention.ts` and `apps/worker/src/server.ts`: six-hour retention scheduler that prunes expired activity, notifications, and audit records and rebuilds each user's hourly activity aggregates.
- `apps/api/src/activity.ts`, `apps/api/src/ai.ts`, `apps/extension/src/background.ts`, `apps/desktop/src/main.mjs`, and `apps/api/src/privacy.ts`: block new ingestion/provider requests without separate account consent; clients refresh consent on startup and account switch, revision-check consent on sync, clear queued events after revocation, disable local tracking, and require the local toggle after re-grant.
- `apps/api/src/evidence.ts` and `apps/web/app/evidence/page.tsx`: owner-controlled evidence payload/file deletion, private-download invalidation, audit record, and minimal tombstone preserving task/reward review state.
- `packages/auth/src/oauth.ts`: list and disconnect linked Google/GitHub sign-in identities; prevent disconnecting the last sign-in method when no password exists. No provider access token is stored, so this removes the Enough login link but does not revoke the provider's own session.
- `packages/auth/src/routes.ts`: export includes privacy preferences, consent records, and deletion tombstones. Account deletion removes earlier user-linked audit records, keeps a minimal anonymous deletion receipt, and requests Stripe customer deletion before deleting local account data.
- `apps/web/app/privacy/page.tsx`, `workspace-data.ts`, `workspace-header.tsx`, `settings/page.tsx`, and `globals.css`: privacy dashboard with exact recent event attributes, retention/consent controls, OAuth disconnect, device revocation, activity erasure, evidence and account deletion, account export, and audit history. `apps/api/src/activity.ts` and `apps/web/app/activity/page.tsx` add stable cursor pagination so users can inspect the full retained event history.
- `apps/web/next.config.ts`, `apps/api/src/server.ts`, and `infra/nginx/enough.conf`: same-origin API rewrites, API registration/no-store handling, CORS method allowance, and reverse proxy routing.
- `PRIVACY.md` and `apps/web/public/privacy-policy.md`: processing record, optional processor list, purposes, data categories, retention defaults, user controls, and production owner/hosting fields to complete.
- `BILLING.md`: Stripe customer-deletion and account-removal behavior; Stripe documents deletion as cancelling active subscriptions and retaining limited deleted-customer history.

Activity collection requires both account consent and the existing local extension/desktop capture toggle. AI processing consent is used only when an OpenAI key is configured; local stage guidance remains available without provider processing. Retention applies to activity events and derived hourly aggregates, notifications, and audit history; task/reward and billing records are kept under their separate account-lifecycle rules. Evidence payloads and files are erased immediately, while a generic tombstone preserves review/reward history. OAuth disconnect removes the local identity association only. Account deletion stops if Stripe customer deletion fails. Privacy and processing documents are drafts because the legal operating entity, privacy contact, production hosting provider, region, backups, and logs are not configured in this source tree.

## Phase 19 acceptance checklist

- [x] Add a Privacy dashboard for consent, retention, activity inspection, account export, OAuth identities, devices, evidence counts, account deletion, and audit history.
- [x] Enforce activity-collection consent at event ingestion and optional AI-provider consent before assembling/sending OpenAI context.
- [x] Add user-selected retention periods for activity, notifications, and audit records; schedule cleanup and rebuild activity aggregates.
- [x] Add immediate activity-history deletion, per-evidence payload/file deletion, OAuth identity disconnect, and account-level Stripe cleanup.
- [x] Add privacy/processing records with purposes, categories, controls, defaults, subprocessors, and deployment fields.
- [ ] Apply migrations `0002_authentication.sql` through `0014_privacy.sql`; verify startup, default consent/retention, cascade behavior, and rollback against PostgreSQL.
- [ ] Exercise export, activity consent and revoke races, retention boundaries and rollup repair, activity erase, AI provider block/allow, evidence deletion/download denial/reward history, OAuth last-method protection, device revoke, Stripe cleanup failure/success, and account deletion.
- [ ] Review policy text and fill in legal entity, privacy contact, production processors, regions, backup/log retention, and applicable transfer safeguards.
- [ ] Review the dashboard and evidence/device flows across mobile, keyboard, loading, empty, error, unauthorized, and passwordless states before accepting Phase 19. No tests, builds, or typechecks were run during this implementation turn.

## Phase 20 implementation map

- `apps/desktop/src/main.mjs`: both desktop windows are limited to their exact local renderer file, reject webview attachment, and accept IPC only from top-level `file:` frames resolving to the main or lock renderer.
- `apps/desktop/src/lock-preload.cjs` and `apps/desktop/scripts/build.mjs`: the lock screen receives only state read/subscription and emergency-bypass IPC methods; the separate preload is included in desktop builds.
- `packages/auth/src/oauth.ts`: OAuth callback work has an IP-based Redis rate limit in addition to rate-limited start and token-consume routes.
- `infra/nginx/enough.conf`: OAuth callback query strings are excluded from Nginx access logs to avoid recording one-use authorization codes and state values.
- `apps/api/src/billing.ts`: paid entitlements map only from the explicitly configured monthly and annual Stripe Price IDs; unrelated recurring prices and subscription metadata no longer grant access.
- Desktop/extension API requests and server-side OAuth-provider, Stripe, OpenAI, and Resend requests reject redirects. The extension also revalidates its stored API origin before sending its bearer token.
- `apps/api/src/notifications.ts` and `apps/worker/src/notifications.ts`: notification links are restricted to same-site paths before storage, web delivery, and email rendering.
- `apps/desktop/src/native-host.cjs`: health-check messages and the local heartbeat file are size-bounded before parsing.
- API route review confirmed authenticated handlers require a valid session, cookie-session mutations check CSRF, and product/device ownership checks remain in place. Added per-user Redis limits to onboarding, product, activity reads, classification, rules, growth-task, evidence read/content, credit-wallet reads, AI status, integration reads, OAuth identity, session/device, password-change, account-export, and account-deletion paths that were previously unthrottled.
- `apps/api/src/billing.ts`: Stripe webhook requests now receive an IP-based Redis limit before signature verification and event processing.
- Electron retains context isolation, sandboxing, disabled Node integration, and restrictive renderer CSPs.

Phase 20 source review is complete for the current code snapshot. Route authorization/CSRF, webhook signatures and idempotency, native messaging bounds, desktop API use, extension permissions/storage, Redis rate-limit failure behavior, and privilege boundaries were reviewed. Browser, desktop, webhook, and migration runtime acceptance remain pending. No package/build/runtime/security tests were run for these changes.

## Phase 20 acceptance checklist

- [x] Restrict desktop renderer navigation and validate IPC senders; reduce lock-screen bridge privileges.
- [x] Rate-limit OAuth callback work and restrict paid entitlement mapping to configured Stripe Price IDs.
- [x] Review auth/OAuth token handling, webhook signature/idempotency paths, native messaging, extension permissions/storage, Redis rate-limit failure behavior, route authorization/CSRF, and privilege boundaries; add missing route and Stripe-webhook limits.
- [ ] Exercise hostile navigation, iframe IPC, OAuth state replay, webhook replay/signature rejection, rate-limit exhaustion, and extension/desktop token revocation in a normal runtime.
- [ ] Resolve or document every critical/high-severity finding before accepting Phase 20.

## Phase 21 implementation map

- `apps/desktop/src/main.mjs`: detect stale cached policy and material wall-clock changes against monotonic elapsed time; pause local policy decisions when the cache is stale; expire Growth Mode safely; use monotonic time for app-use totals and restricted-app grace periods; cap offline activity at 1,000 events and seven days, count discarded events, and serialize uploads so acknowledgements preserve events added during an in-flight request.
- `apps/extension/src/background.ts`: expire cached policy after 24 hours or a detected wall-clock change, clear Enough-owned dynamic rules when stale, validate Growth Mode duration, bound and age the offline queue, report dropped activity, and serialize queue mutations with event uploads so newly queued events are retained. The popup preserves sync errors and edge-case warnings together.
- `apps/desktop/src/native-host.cjs`: poll the desktop heartbeat and report degraded status when the agent is absent or its heartbeat is older than 20 seconds.
- `apps/api/src/activity.ts`: preserve submitted timestamps for audit while replacing effective ordering time with server time for events over five minutes in the future or over seven days old.
- Existing source paths: event IDs are idempotent; activity ordering is unique per device/product sequence; wallet and task completion writes serialize on database rows; integration revocation and ingestion lock the integration account; task completion remains pending evidence/review before reward issuance.
- Desktop and extension logout clear stale Growth Mode state. Process identity still uses bundle ID, executable basename, and display name; executable signing identity is not verified.

Phase 21 source changes are implemented. While the clients are running, a wall-clock change that differs from monotonic elapsed time by more than 60 seconds is detected; a backward change is also compared with the last stored clock observation. Local policy enforcement then fails open with a visible warning until policy sync succeeds. A forward clock change while a client is stopped can be indistinguishable from real downtime; the 24-hour cache age catches larger jumps, but offline time is not cryptographically verifiable. Extension enforcement cannot run while the extension is disabled. A renamed desktop executable can resolve as a new application unless its bundle ID remains stable. These source paths have not passed runtime acceptance, and unsigned cached policy is not tamper-evident.

Event uploads are single-flight per client. After each successful batch, the client removes only the acknowledged event IDs from the latest queue state, retaining events recorded while the request was in flight. Extension queue appends and upload acknowledgements share a serialized mutation path.

## Phase 21 acceptance checklist

- [x] Define offline behavior: use a fresh cached policy for up to 24 hours; pause local policy enforcement when it expires or the clock moves before the last sync.
- [x] Bound offline event queues to 1,000 entries and seven days, and expose discarded-event counts.
- [x] Serialize client event uploads and preserve events appended while a batch is in flight.
- [x] Use idempotent event IDs and per-device/product sequences; preserve server-side wallet/task row locks for concurrent devices.
- [x] Report desktop-agent health from a recurring heartbeat; document that a disabled extension cannot enforce rules.
- [x] Keep integration events from revoked accounts rejected under the same account-row lock used by revocation.
- [x] Keep task completion in `AWAITING_EVIDENCE` until evidence review; completion claims alone do not award credits.
- [x] Document that desktop application identity is name/bundle-ID based and does not verify executable signatures.
- [ ] Exercise offline expiry and recovery, wall-clock rollback/forward changes, duplicate retries, simultaneous devices, extension disable/re-enable, killed desktop agent, renamed executable, stale policy, integration revoke races, and fake completion against running extension/desktop/API/database components.
- [ ] Confirm all Phase 21 scenarios remain predictable in a normal runtime before accepting the phase. Phase 23 now tests shared offline cache, clock, Growth Mode, queue-bound, retention, and sequencing helpers; direct runtime acceptance remains pending.

## Phase 22 implementation map

- `packages/db/migrations/0015_admin_console.sql`: stores ADMIN/SUPPORT grants, separate admin audit records, shared feature flags, admin-managed rule templates, and metadata-only AI provider usage.
- `apps/api/src/admin.ts`: verified-email bootstrap access through `ADMIN_EMAILS`, database-backed roles, rate-limited read routes, CSRF-protected write routes, account/subscription/device/integration support views, session/device/integration revocation, failed BullMQ job retry, shared growth/rule template and feature-flag management, AI usage, health, and audit APIs.
- `apps/api/src/ai.ts`: records OpenAI provider request status, model, capability, returned token counts, and latency. Prompt and response contents are not stored.
- `apps/worker/src/privacy-retention.ts`: applies each user's audit-retention preference to admin audit and AI-usage metadata, and retains anonymized events for at most 730 days.
- `apps/web/app/admin/page.tsx`, `apps/web/app/workspace-header.tsx`, and `apps/web/app/globals.css`: responsive, sectioned Admin Console with account search/detail, support actions, role management, and operational catalogs. The workspace menu shows the link only when the admin access check succeeds.
- `apps/web/next.config.ts`, `apps/api/src/server.ts`, `packages/config/src/index.ts`, and `.env.example`: same-origin API route, no-store admin responses, and optional `ADMIN_EMAILS` bootstrap configuration.
- `README.md`, `IMPLEMENTATION_PLAN.md`, `SECURITY_STATUS.md`, `DEPLOYMENT_STATUS.md`, and `KNOWN_LIMITATIONS.md`: setup, trust boundaries, migration, and acceptance status.

The console does not expose passwords, bearer/session credentials, API keys, integration secrets, or evidence contents. Session/device/integration revocation is transactional and logged. Feature flags are stored centrally but require application consumers to change runtime behavior; rule templates are catalog records and are not yet integrated into the user rule editor. AI usage metadata is captured for OpenAI requests only and follows audit-retention preferences. Migration and runtime acceptance remain pending.

## Phase 22 acceptance checklist

- [x] Add verified bootstrap administrator access and database-backed ADMIN/SUPPORT roles; require CSRF for cookie-session writes and rate-limit admin routes.
- [x] Add user, subscription, device, integration, failed-job, template, feature-flag, AI usage, health, support-action, and audit views/routes.
- [x] Add audited account-session, device, integration revocation and failed-job retry operations.
- [x] Record OpenAI usage metadata without retaining prompts or responses; apply audit retention to admin actions.
- [x] Add the responsive Admin Console and role-aware navigation.
- [ ] Apply migration `0015_admin_console.sql` after migrations `0002` through `0014` in a development database.
- [ ] Configure a verified `ADMIN_EMAILS` account and exercise bootstrap access, role grants/revocation, permission denials, CSRF, and rate limits.
- [ ] Exercise account/subscription/device/integration views and revocation, queue health and failed-job retry, template/flag edits, AI usage records, audit entries, and retention boundaries.
- [ ] Review admin surfaces in a browser at narrow widths and verify error/empty/unauthorized states. Runtime acceptance remains pending.

## Phase 23 implementation map

- `packages/shared/src/policy-rules.test.ts`, `tool-classification.test.ts`, `notification-time.test.ts`, and `product-stage.test.ts`: deterministic evaluator ordering and schedule boundaries, mapping precedence and wildcard behavior, quiet-hour/DST boundaries, and stage catalog invariants.
- `packages/shared/src/client-runtime.ts` and `client-runtime.test.ts`: shared API-origin validation, offline policy freshness, Growth Mode bounds, per-product event sequencing, bounded queues, and seven-day event retention; both desktop and extension call these helpers.
- `packages/auth/src/crypto.test.ts` and `oauth.contract.test.ts`: password/token/secret cryptography checks and Fastify OAuth provider/unknown-provider route contracts.
- `apps/api/src/billing-webhook.ts`, `billing-webhook.test.ts`, and `billing-route.contract.test.ts`: Stripe signature/replay checks plus a mocked-DB Fastify route contract for raw-body verification and duplicate event idempotency.
- `apps/extension/build.mjs`: background IIFE build separated from HTML ES-module builds, preserving Chromium module-service-worker and Firefox classic background formats.
- Desktop and extension production bundles were built successfully.

The full Vitest run passed 9 files and 65 tests. These tests cover unit logic, deterministic rule property checks, selected OAuth/billing contracts, and shared offline/client behavior. They do not establish live database integration, provider OAuth exchange/session creation, real Stripe sandbox reconciliation, migration correctness against PostgreSQL, concurrent multi-device behavior, browser/Electron E2E behavior, load capacity, or broad application security acceptance. Phase 23 remains incomplete until critical paths have automated regression coverage and runtime-dependent checks pass.

## Phase 23 acceptance checklist

- [x] Add deterministic unit coverage for shared policy evaluation, classification resolution, quiet hours, and product-stage data.
- [x] Add generated ordering/property checks for policy-rule precedence and client-side offline/cache invariants.
- [x] Add auth crypto, OAuth route-contract, Stripe signature, webhook route-contract, and duplicate webhook idempotency tests.
- [x] Build Chromium and Firefox extension packages and the desktop application bundle.
- [ ] Add/execute live API and database integration tests for critical route, transaction, authorization, and migration paths.
- [ ] Exercise configured OAuth provider callback, one-use state, CSRF binding, and session exchange end to end.
- [ ] Exercise Stripe test-mode Checkout, portal, webhook reconciliation, entitlement transitions, and invoice handling against a test database.
- [ ] Run browser and Electron end-to-end coverage for sign-in, policy sync, offline expiry/recovery, revocation, and critical user flows.
- [ ] Verify multi-device duplicate/order/concurrency behavior, database migration/rollback behavior, representative load, and broad security regressions.
- [ ] Meet the Phase 23 exit criterion: automated regression coverage for all critical paths.

## Phase 24 implementation map

- `apps/desktop/package.json`: Windows x64 NSIS, macOS x64/arm64 DMG and update ZIP, and Linux x64 AppImage/DEB targets with consistent artifact names.
- `apps/desktop/electron-builder.config.cjs`: GitHub Releases or HTTPS generic update provider selection; release builds require signing, and macOS release builds require notarization credentials. Windows signing variables are mapped to electron-builder's standard certificate variables.
- `apps/desktop/src/main.mjs`: updater checks the feed metadata generated by electron-builder and no longer expects a runtime feed URL.
- `apps/extension/scripts/package-stores.mjs`: produces Chrome Web Store, Edge Add-ons, and Firefox Add-ons ZIP files.
- `.github/workflows/release.yml` and `scripts/check-release-version.mjs`: matrix builds, signing/notarization preflight, extension archives, package/tag version check, and GitHub Release asset upload.
- `RELEASES.md` and the desktop/extension READMEs: release prerequisites and manual store submission flow.

The three store ZIPs were built and inspected: each contains its manifest, background script, UI pages, styles, and assets. A local unsigned Windows installer build was attempted; the desktop source bundle succeeded, then electron-builder failed before packaging because Node could not read its pnpm-linked `dotenv` dependency (`EPERM`). No installer artifact was produced.

## Phase 24 acceptance checklist

- [x] Configure Windows NSIS, macOS DMG/update ZIP, and Linux AppImage/DEB packaging targets.
- [x] Configure build-time GitHub Releases and HTTPS generic update feeds; remove runtime `setFeedURL` dependency.
- [x] Build and inspect Chrome, Edge, and Firefox store ZIP contents.
- [x] Add cross-platform release workflow, signing/notarization secret checks, and tag/package version validation.
- [ ] Produce signed installers on Windows and macOS and Linux packages from release CI.
- [ ] Install and update the desktop app on each supported platform; verify updater metadata and native-host installation.
- [ ] Submit extensions to Chrome Web Store, Edge Add-ons, and Firefox Add-ons and complete store review.
- [ ] Meet the exit criterion: normal users can install and update without manual technical steps.

## Phase 25 implementation map

- `infra/ubuntu/bootstrap.sh`: explicit Ubuntu host setup for the dedicated service account, deployment directories, systemd units, journald retention, Redis settings, Certbot renewal hook, and restricted service-restart sudoers rule.
- `infra/systemd`: hardened web/API/worker units plus daily encrypted-backup and one-minute readiness-monitor timers.
- `infra/nginx/enough.conf`: HTTP-to-HTTPS redirects, separate app/API hosts, loopback upstreams, security headers, callback query access-log suppression, and loopback-only API readiness.
- `infra/postgres/production.md`, `infra/redis`, and `infra/env/enough.env.example`: production database/ACL setup and protected environment template.
- `scripts/deploy.sh`, `rollback.sh`, `run-command.mjs`, `verify-services.mjs`, and `packages/db/src/migration-precheck.ts`: approved-ref fetch, frozen install, test/build, checksum precheck, pre-migration backup, migration, atomic release switch, readiness checks, and code-only rollback.
- `scripts/backup-database.mjs` and `restore-test.mjs`: age-encrypted PostgreSQL custom dumps, mandatory rclone off-host upload, local retention, and isolated temporary-database restore verification.
- `infra/README.md` and `DEPLOYMENT_STATUS.md`: host setup, release, backup, restore, TLS, firewall, logging, and remaining acceptance steps.

No host commands were run. The scripts, systemd units, Redis ACL configuration, PostgreSQL guidance, and Nginx TLS configuration have not been executed or validated against Ubuntu, a real domain, a PostgreSQL/Redis production host, an off-host storage account, or a reboot. The deploy script requires an SSH Git remote, a full approved ref, and an explicit `--approve-migrations` argument. Backup requires an age recipient and configured rclone destination; restore verification requires a separate CREATEDB-only database role and age identity. Readiness monitoring currently records failures to journald without paging or external alerts.

## Phase 25 acceptance checklist

- [x] Add an Ubuntu VPS bootstrap and persistent release layout without containers.
- [x] Configure loopback-only app/API/database/cache services, TLS reverse-proxy templates, systemd restart behavior, and bounded journald retention.
- [x] Add explicit-ref deployment, frozen install, test/build, read-only migration precheck, pre-migration backup, atomic symlink switch, and code rollback workflow.
- [x] Add encrypted off-host PostgreSQL backup, retention, and isolated restore-test scripts.
- [x] Add periodic readiness monitoring for web, API, worker, PostgreSQL, and Redis.
- [ ] Configure a real Ubuntu host, production secrets, DNS, TLS, database role, Redis ACL, firewall, and external alerting.
- [ ] Deploy the services, verify migration safety, backup upload/restore, systemd recovery, and survival across a host reboot.
- [ ] Meet the exit criterion: production services survive reboot and restart automatically.

## Phase 26 verification map

- `infra/production-verification.md`: entry conditions, safety rules, expected results, execution commands, and evidence record for the Phase 26 production verification matrix.
- `DEPLOYMENT_STATUS.md` and `KNOWN_LIMITATIONS.md`: current production verification status and blockers.

Read-only local availability probes were run on 2026-10-07. TCP ports 80, 443, 3000, 3001, 4000, 4001, 5433, and 6379 were closed; requests to the local web, API, and worker readiness URLs were unavailable. No production endpoint was contacted. The project has no configured production host, DNS/TLS, provider credentials, database, Redis, or backup storage. This is an environment availability result, not production integration acceptance.

## Phase 26 acceptance checklist

- [x] Document safe production verification prerequisites, expected outcomes, and evidence requirements for each Phase 26 area.
- [x] Check local loopback availability for web, API, worker, PostgreSQL, Redis, Nginx, and TLS ports; all were closed.
- [ ] Verify web, API, worker, PostgreSQL, Redis, Nginx, and TLS together on the configured host.
- [ ] Verify controlled email, Stripe test webhooks, OAuth callbacks, implemented integration sync, and activity ingestion.
- [ ] Verify desktop and extension sync, lock/unlock propagation, and background job processing with the accepted release artifacts.
- [ ] Verify off-host backups and isolated restore, then record service restart and host reboot recovery.
- [ ] Meet the exit criterion: all applicable services and product flows work together in production with recorded evidence.

## Phase 27 launch gate

- `LAUNCH_READINESS.md`: capability-by-capability assessment, current decision, release blockers, and evidence requirements.
- Current decision: **NO-GO**. Source implementation and earlier unit-test results do not replace integrated production acceptance.

### Phase 27 acceptance checklist

- [x] Assess every required Phase 27 capability against the recorded implementation and acceptance evidence.
- [x] Record a launch decision and list release-blocking gaps.
- [ ] Resolve or explicitly revise the missing Gmail, Outlook, and calendar provider requirements.
- [ ] Complete Phases 24–26 release, infrastructure, and production verification acceptance.
- [ ] Accept all critical runtime, privacy, security, billing, multi-device, offline, and recovery flows.
- [ ] Meet the exit criterion: every required capability works together in production and the evidence is accepted.

## Current environment constraints

- `.env` uses web port 3001, API port 4000, worker port 4001, PostgreSQL port 5433, and Redis port 6379. An earlier session found a pre-existing process on port 3000 and left it untouched; the read-only Phase 26 probe on 2026-10-07 found port 3000 closed.
- `.env` does not currently enable `AUTH_DEV_SHOW_EMAIL_LINKS` and has no Resend/provider credentials. For local email flows, set `AUTH_DEV_SHOW_EMAIL_LINKS=true`, or configure `RESEND_API_KEY` and `AUTH_EMAIL_FROM`. Configure OAuth client ID/secret pairs to enable those buttons.
- `.env.example` contains local defaults and opt-in email preview. Production requires a unique `AUTH_SECRET`, HTTPS `APP_BASE_URL` and `API_BASE_URL`, Resend credentials, and preview disabled.
- For provider setup, register `${API_BASE_URL}/auth/oauth/google/callback` and `${API_BASE_URL}/auth/oauth/github/callback`. See `packages/auth/README.md`.
- Migrations `0002_authentication.sql` through `0015_admin_console.sql` have not been applied. The local database currently has the Phase 1 baseline only.
- The migration ledger query confirmed only `0001_create_enough_schema.sql` is present. Applying `0002_authentication.sql` with `psql` was automatically rejected because sandbox approval is disabled for that command; no database mutation occurred.
- The declared migration runner was retried from `packages/db` against the confirmed local target (`127.0.0.1:5433/enough`), but Node stopped before connecting because the sandbox denied reading the pnpm-linked `pg` module (`EPERM`). No migrations were applied.
- Vitest completed successfully when invoked directly: 9 test files, 65 tests passed. `pnpm install --frozen-lockfile` now succeeds after reviewing and allowing `electron-winstaller`'s architecture-specific 7-Zip selection script. Typecheck remains blocked by `EPERM` reading the pnpm-linked TypeScript package. The extension source build and desktop source build succeed, but electron-builder packaging is blocked by `EPERM` reading linked `dotenv`. There is no Git repository in this workspace.
- Phase 24 generated extension store archives under `apps/extension/dist/store-packages/`. No signing certificates, Apple notarization key, store publisher credentials/listing IDs, or tested public update feed are configured. The GitHub updater path requires a public repository; a generic update feed needs its artifacts mirrored by the release owner.
- Phase 25 provides deployment templates and scripts, but there is no production Ubuntu host, SSH deploy key/remote, DNS, TLS certificate, production database/Redis credential, age recipient, rclone remote, or restore identity configured in this workspace. No host command, deployment, backup, restore, service enablement, Nginx validation, or reboot check was run. The current workspace is Windows and has no Git repository.
- Phase 26 is partial. No production integration scenarios ran. Gmail, Outlook, and calendar sync adapters have not been implemented, and Phase 24 signed desktop installers/store installation remain outstanding, so those verification rows also depend on earlier product work.

## Next actions

1. Configure an Ubuntu LTS host, install Node.js 22+ and pnpm 11.20.0, create production database/Redis credentials, DNS/TLS, firewall rules, protected `.env`, age identity/recipient, and rclone off-host storage.
2. Validate the Nginx config and systemd units on that host, deploy an approved ref with migration review, enable the services and timers, restore-test a backup, and verify restart/reboot recovery for Phase 25.
3. Complete Phase 24 signed installer/store submission/install/update acceptance and Phase 23 live database, multi-device, browser/Electron, load, and security acceptance.
4. Apply migrations `0002` through `0015` and record the Phase 2 through 22 runtime acceptance checklists, including admin, security navigation, webhook, rate-limit, revocation, and edge-case scenarios.
5. Finish Phase 26 on a configured production-like Ubuntu host using `infra/production-verification.md`; all applicable checks need recorded evidence before Phase 26 can pass.
6. Resolve the launch blockers in `LAUNCH_READINESS.md`, then repeat Phase 27's gate assessment. Keep the decision NO-GO until all required capabilities work together in production with accepted evidence.
