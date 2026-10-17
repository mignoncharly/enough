# Remediation Implementation Plan

## Current roadmap clarification — 2026-10-17

This file remains the canonical phase sequence. **Phase 15 is AI Layer**, Phase 16 is Reports, and Phases 24–27 retain distribution/infrastructure/verification/launch scope. Release-hardening checkpoint `35f18280231613a890d10e340160e62604ccb2d8` (commit message labelled “Phase 15A”) is retained as completed supporting work for Phase 25; it is not AI Layer acceptance and does not complete Phase 25.

Phase 14 is checkpointed at `59ac406fd4be5639346f67eb01ffcacc27a1d4b4` with explicit preserved external exceptions: GA4 clean Realtime ingestion PASS, standard reporting/normalization/cleanup DEFERRED; Microsoft PERSONAL_MSA provider-side revocation BLOCKED by provider behavior. Stripe, Google, PostHog and Plausible acceptance remains preserved. Do not reopen these items while working on AI Layer acceptance.

**Phase 15 — AI Layer: COMPLETE (2026-10-17).** Passes 1–3, accepted provider/data-handling review, USER-REPORTED P15-1–P15-6 and final read-only verification pass; the fixture is stopped with evidence retained. Account controls remain NOT VERIFIED without special-control claims. See `AI_COACH.md`. Phase 11 remains ACTIVE with existing blockers; Phase 14 exceptions are preserved. Phase 16 is NOT STARTED; the user authorized the Phase 15 checkpoint commit and push only. Production remains **NO-GO**; the dependency baseline remains **21 findings (3 critical / 9 high / 9 moderate)** with no upgrade or new audit. The October 14 consolidation below is historical where superseded by this status and later acceptance records.

Last consolidated: 2026-10-14 (Phase 13 baseline checkpoint `d86670bc83b6aab56b76860ee623e6a5831bc215`; Phase 10 remains checkpointed at `6a6110205276b839534427a05b60f4c1044a3c0e`; Phase 11 ACTIVE, P11-1–P11-3 PASS, P11-4–P11-5 BLOCKED; Phase 12 COMPLETE; Phase 13 COMPLETE; Phase 14 deterministic provider, local browser, Google external, and Stripe external acceptance PASS, four external real-provider gates open; production NO-GO with all 18 dependency-security findings open)
Source of truth for implementation order: this file. The historical scope remains in `ENOUGH_COMPLETE_IMPLEMENTATION_PLAN.md`; historical implementation detail and evidence remain in `IMPLEMENTATION_HANDOFF.md`.

## Objective and current decision 

Use this plan to close the incomplete work from Phases 1–26, then repeat Phase 27's launch gate. The current decision is **NO-GO**. Most features have source implementations, but runtime, database, client, production, security, release, and cross-service acceptance is missing. Some requirements are not implemented at all.

Do not count source presence, a successful build, or a unit test as production acceptance. Every critical path needs test evidence at the level where it runs: unit/property, database, API, browser/desktop, provider sandbox, and production-like operations as applicable.

Phase 0 contract is complete under user-delegated engineering authority; decisions and tradeoffs are recorded in `PHASE_0_REVIEW.md`. Architecture, shared state-machine target, platforms, evidence trust and engineering privacy boundaries are frozen. Implementation and runtime acceptance remain open.

## Severity definitions

- **Critical:** security, privacy, data integrity, billing, policy enforcement, disaster recovery, or a Phase 27 required capability can fail. Block public launch until accepted.
- **High:** a required capability or supported client flow is incomplete or materially unreliable. Block general availability unless scope is explicitly changed and users are not misled.
- **Medium:** important edge cases, accessibility, observability, scale, or recovery details need acceptance; may be staged only with an explicit owner and rollout limit.
- **Nice to have:** explicitly deferred or optional work that is outside the frozen launch contract. Keep it out of launch scope unless Phase 0 re-adds it.

These are launch priorities, not code-quality judgments. A task may move only through an explicit scope/security decision with a recorded reason.

## Execution order

| Wave | Work | Exit condition |
| --- | --- | --- |
| 0 | Establish a reproducible source/test environment and freeze launch scope. | Canonical source and package access work; safe disposable PostgreSQL/Redis test targets and provider test accounts are available. |
| 1 | Phases 1–9: platform, migrations, identity, product data, activity, classification, rules, credits, web. | Migrations 0001–0008 and core web/API journeys pass database and browser acceptance. |
| 2 | Phases 10–13: browser/desktop clients, tasks, evidence. | Client sync/enforcement and evidence-gated rewards pass on the declared support matrix. |
| 3 | Phases 14–17: providers, coach, reports, notifications. | Required providers and user-facing flows pass sandbox and runtime tests; optional providers are explicitly scoped. |
| 4 | Phases 18–22: billing, privacy, security, edge cases, admin. | Migrations 0013–0015 and all high-risk authorization, privacy, billing, and policy scenarios pass. |
| 5 | Phases 23–24: quality and distribution. | Critical-path automated coverage, signed packages, store submissions, and real install/update acceptance pass. |
| 6 | Phase 25: production infrastructure. | Configured Ubuntu deployment survives restart/reboot and off-host restore is proven. |
| 7 | Phase 26: production integration verification. | All applicable service/provider/client flows pass together with retained evidence. |
| 8 | Phase 27: launch gate. | Every required capability has accepted evidence and the launch decision is GO. |

Dependencies run forward: do not test later phases against an unapplied or unverified schema. Use synthetic accounts and disposable databases before provider sandboxes or production-like systems. Never point a migration, restore, destructive test, load test, or security test at production without a separate reviewed runbook and approval.

## Phase-by-phase remediation

### Phase 0 — Product Contract and Scope Freeze

**Critical prerequisite**

- [x] Prepare product, architecture, domain, rule, privacy, event and threat-model documents.
- [x] Compare current source with the original contract and record missing credit/session integration and documentation corrections.
- [x] Record decisions using the user's delegated authority in `PHASE_0_REVIEW.md`; freeze terminology, architecture, state-machine target and privacy boundaries.

### Phase 1 — Repository and Core Foundation

**Critical**

- [x] Canonical repository `C:\Enough`, verified commit `7e78c9d87ea993c7e95530b56dc5db9da1f8d4e7`; main synchronized with origin/main and clean at acceptance. Initial snapshot pushed.
- [x] Approved execution resolved package access; Node/pnpm versions and frozen installation accepted.
- [x] Isolated PostgreSQL, Redis, web, API and worker passed migrations, checksum/idempotent rerun, health/readiness, database and queue smoke checks.
- [x] Isolated ports and credentials recorded in `PHASE_1_ACCEPTANCE.md`. **Phase 1 COMPLETE**; formatting/typecheck/65 tests/client builds passed; lint has 124 non-blocking warnings and one informational diagnostic; launch remains **NO-GO**.

### Phase 2 — Authentication, Users, Sessions, Devices

**Critical**

- [x] Apply migration `0002_authentication.sql` through the migration runner; accepted in Phase 1, checksum precheck reconfirmed 2026-10-08.
- [x] Exercise signup, verification, password login/reset, magic link, logout, session rotation, export, and deletion; verify one-use tokens, expiry, replay rejection, and session/device revocation at database/API level. 34 integration checks pass; interactive acceptance is tracked separately below.
- [x] Preserve accepted real Google/GitHub login/logout/re-login evidence. Verify negative state/PKCE/callback/replay, verified-email and account-linking cases with isolated provider responses and real disposable PostgreSQL/Redis; ten additional OAuth cases passed 2026-10-09. Preregistration-password takeover regression fixed and retested.
- [x] Verify the explicitly enabled local link preview; ensure production disables preview. Real Resend delivery is not claimed.
- [x] Exercise extension and desktop bearer login/revocation at real HTTP/API-contract level.
- [x] D1 verified disposable email/password desktop sign-in: explicit user report 2026-10-09, isolated API 4402, Connected, matching account, loaded workspace, no authentication error; No products yet expected. Evidence: `PHASE_2_ACCEPTANCE.md`. Preserve D2/D3; no repeat desktop checks.
- [x] Desktop D1–D3, Chrome E1–E3 and Firefox E1–E3 PASS by explicit combined user report, 2026-10-09. Token/password sign-in, persistence, logout/revocation and recovery accepted. Firefox evidence covers popup/reload persistence; persistent signed-install/full restart stays Phase 24 distribution scope under the user's completed Phase 2 acceptance. Do not request duplicate tests. Real OAuth happy paths remain accepted.
- [x] Review auth behavior and run requested formatting, lint, typecheck, unit, integration and client-build checks. 68 default tests and 34 integration tests passed; seven defects fixed, including derived-session freshness and revocation races. Evidence: `PHASE_2_ACCEPTANCE.md`.

**User-approved revised Phase 2 plan — 2026-10-09:** Remaining invalid credentials, renewal/old-credential rejection, signup verification, magic-link internals, reset/change-password security, deletion/invalidation and OAuth security/identity edge cases are automated engineering verification, not a manual click-through table. Use the separate Phase 2 runtime (PostgreSQL 55433, Redis Windows 56381 / WSL 56382, API 4402, web 3302), synthetic accounts and a separate `.next` directory. Never reuse the active account/runtime. The original 34 integration tests plus 12 additional cases passed; see `PHASE_2_ENGINEERING_VERIFICATION.md` for current commands and evidence. No additional Web UI happy-path request is required by the present evidence.

- [x] Triage all 19 original dependency audit entries for path, surface, reachability, patch availability and remediation risk in `PHASE_2_DEPENDENCY_SECURITY.md`; apply only the narrow Drizzle 0.45.2 fix. Eighteen findings remain explicitly open; risky upgrades are documented, not silently waived.
- [x] V1: installed-client evidence accepted; final review complete. 49/49 integration checks, 68 default tests, typecheck, format and lint PASS. Three added tests verify identity disconnect safety, concurrent OAuth exchange replay and live proxy origin/client-type rejection. Audit disposition is complete: 18 open findings assigned to security/toolchain/distribution gates in `PHASE_2_DEPENDENCY_SECURITY.md`; no launch waiver.

**Phase 2 COMPLETE, checkpoint `fd9bc2467bf4daeca9e80e1287029310d4ee2f7c`.** HEAD and recorded origin/main matched and the tree was clean at Phase 3 start. Real providers and installed clients remain accepted. Existing credentials and runtime are protected. Dependency remediation remains open for Phases 20/23/24; launch remains NO-GO. Do not commit or push the Phase 3 checkpoint without explicit user approval.

### Phase 3 — Product Onboarding

**High — COMPLETE, checkpoint `e07f502a90aaa85a22ad2f70647b8ca9bd234a4d`.**

Completed execution: reconcile existing source; verify ordered migrations on a separate
TEMP fixture; exercise all ten answers and nine stages through the live web/API;
fix demonstrated onboarding defects; run automated quality/regression checks;
then one consolidated browser acceptance session. Current product linkage and
export require the already-existing later tables; applying their migrations
does not accept those later phases. No architecture expansion or new policies.

- [x] Apply migrations `0002`–`0003` in order. The dedicated TEMP fixture has all 15 existing migrations; source checksums and ordered history verified 2026-10-09. This is not later-phase acceptance or a new migration-from-zero claim.
- [x] Verify every onboarding answer saves, reloads, edits, and appears in account export at live API/web-proxy level. Fresh 18/18 integration checks PASS; evidence in `PHASE_3_ACCEPTANCE.md`.
- [x] Verify each product stage produces its intended recommendation and opens the correct dashboard. All nine stage API cases and page compilation PASS; hydrated wizard navigation/product selection accepted in P3-1/P3-2/P3-4 by explicit user report, 2026-10-09.
- [x] Check authenticated ownership boundaries and validation errors. Cross-account read/write/export, CSRF/origin rejection, invalid values and numeric bounds PASS on disposable services.
- [x] Complete and record the single browser session in `PHASE_3_ACCEPTANCE.md`: P3-1, P3-2, P3-3, P3-4, P3-5 and P3-6 all PASS by explicit user report; no failures observed. Do not reopen or repeat these checks.

Phase 3 is formally COMPLETE and checkpointed with no remaining phase blocker.
Phase 1/2 evidence remains accepted; Phase 4 is now authorized. All 18 dependency findings remain open
release obligations; production launch remains NO-GO.

### Phase 4 — Product and Stage Engine

**High — COMPLETE and checkpointed at `f6e42b66a1c78c50317a4584258e40accff90ee8`; accepted 2026-10-10.**

Sequence: inspect existing scope/source and accepted evidence; apply migrations
in a new disposable TEMP fixture; test products, nine stages/history, goals,
metrics, onboarding synchronization, export, ownership, cascades and invalid/stale
writes; fix demonstrated defects; verify regressions/quality/build; then one
consolidated browser session. Existing notification/export dependencies require
later tables but do not accept those phases. Stage guidance remains advisory
under the accepted architecture; policy enforcement is not added here. No
external blocker found. No commit/push until explicit Phase 4 checkpoint approval.

- [x] Apply migrations `0002`–`0004` in order. Retained fresh-fixture log records all 15 existing migrations in order; checksum/order tests and precheck pass. Later tables support existing notifications/export, not acceptance of later phases.
- [x] Verify onboarding/profile updates stay synchronized with canonical products, primary goals, stage history, and metrics. Live tests cover both directions, concurrent writes and unchanged saves after completion; recommendations now use the same calculation.
- [x] Exercise all nine stages, stage changes/history, multiple products, goal status, metric updates, and account export. 26 product + 18 onboarding integration checks PASS; 68 default tests, quality checks and isolated optimized web build PASS. Evidence: `PHASE_4_ACCEPTANCE.md`.
- [x] Verify ownership, deletion/cascade behavior, and invalid/stale updates against PostgreSQL. Stale stage/goal/canonical metric writes return 409 when expectations are supplied; current dashboard supplies them. Cross-owner/CSRF, atomic validation, account deletion and product-child cascades pass.
- [x] Single consolidated browser session P4-1, P4-2, P4-3, P4-4 and P4-5 PASS by explicit user report, 2026-10-10; no browser acceptance failures observed. Evidence: `PHASE_4_ACCEPTANCE.md`. Do not reopen or repeat these accepted checks.

Phase 4 is formally COMPLETE with no remaining phase blocker. Accepted Phase 1–3
evidence is preserved; all 11 tested source/manifest/lockfile fingerprints match
at closure. The checkpoint was subsequently accepted at
`7d1e532ee7cfc9769bbe8268a78e0ad62e81cd89`, after which Phase 5 was activated
below. No commit or push was performed in this continuation. All 18 findings
remain OPEN; launch remains NO-GO.

### Phase 5 — Activity Event Platform

**Critical — COMPLETE (engineering acceptance), 2026-10-10.** Phase 4 is
checkpointed at `7d1e532ee7cfc9769bbe8268a78e0ad62e81cd89`; Phase 5 passed its isolated
migration, live API/database, concurrency, regression, and quality checks.
Detailed evidence is in `PHASE_5_ACCEPTANCE.md`. No dependency upgrade, Docker,
GitHub Actions, production deployment, commit, or push occurred. The Phase 5
checkpoint commit/push still requires explicit approval. Overall launch remains
**NO-GO** while the existing security and production gates remain open.

- [x] Apply migrations `0002`–`0005` in order. A fresh scratch database applied all 15 current migrations in filename order; checksum precheck passed and both activity tables were verified.
- [x] Verify duplicate/replayed batches do not change aggregates; conflicting event IDs or sequence reuse reject atomically. Covered by live PostgreSQL integration tests.
- [x] Verify offline ordering, timestamp correction, future/old event handling, and hourly aggregates against PostgreSQL. Covered by live PostgreSQL integration tests.
- [x] Verify product/device ownership, privacy-safe payload bounds, export, and deletion. Covered by live API/database tests using synthetic accounts.
- [x] Add database integration coverage for transaction and concurrency behavior. Activity, product, and onboarding regressions pass 72/72; default unit/contract suite passes 68/68.

### Phase 6 — Tool Classification Engine

**High — COMPLETE, 2026-10-10.** Existing canonical source passed isolated
PostgreSQL/API verification without application-source changes. The user
accepted the consolidated tools-page session; P6-1–P6-5 all PASS. Phase 5 is
checkpointed; no dependency/security changes or production operations were in
scope. Detailed command output and results are recorded in
`PHASE_6_ACCEPTANCE.md`.

- [x] Apply migrations `0001`–`0015` in order on a disposable PostgreSQL 18 fixture; migration precheck passes with no pending migrations.
- [x] Exercise catalog items, account/product mappings, context matches, wildcard domains, unknown keys, duplicate conflicts, and resolver precedence in five live integration tests.
- [x] Verify ownership boundaries, product/account deletion, export, and CSRF/authorization boundaries in isolated API/database coverage.
- [x] Complete one consolidated tools-page browser review for create/edit/remove/preview behavior; P6-1–P6-5 PASS by explicit user report, 2026-10-10. The isolated fixture stopped successfully; no manual failures reported.

Phase 6 is formally COMPLETE with no remaining Phase 6 blocker. Phase 7 remains
the next roadmap phase; do not start it or checkpoint Phase 6 without explicit
authorization.

### Phase 7 — Rule Engine

**Critical**

**Status: COMPLETE — 2026-10-11.** Existing evaluator, migration,
authenticated API, and rules workspace passed automated acceptance and the
user-reported consolidated browser review. Phase 7 is complete; checkpoint
checkpoint `f6e42b66a1c78c50317a4584258e40accff90ee8` is accepted. Phase 8 is
COMPLETE; see the acceptance record below.

- [x] Add deterministic unit/property cases for condition combinations, scope, priorities/ties, schedules/time zones/DST, override expiry/revocation, version conflicts, defaults, and byte-for-byte repeatability.
- [x] Apply migrations `0002`–`0007` in order on an isolated PostgreSQL 18 fixture; precheck passes with no pending migrations.
- [x] Exercise ownership isolation, concurrent stale-version conflicts, archive history, schedule boundaries/DST, override expiry/revocation, export, deletion cascades, and shared-evaluator client parity.
- [x] Complete one consolidated browser review of rule creation/edit/version history, scheduled evaluation, temporary override precedence/revocation, archive/default behavior, and narrow/keyboard usability; P7-1–P7-5 PASS by explicit user report, 2026-10-11. Fixture stopped; no failures reported (`PHASE_7_ACCEPTANCE.md`).

Phase 7 is formally COMPLETE with no remaining Phase 7 blocker. All 18
dependency-security findings remain open release obligations; production
launch remains **NO-GO**. Preserve the accepted Phase 1–6 evidence.

### Phase 8 — Build Credit Engine

**Critical**

**Status: COMPLETE — 2026-10-11.** Canonical wallet operations and the
server-authoritative product build-session lifecycle pass automated
PostgreSQL/API, migration, and Node 24 checks. The user reported P8-1–P8-5 PASS
in the consolidated wallet review; evidence is in `PHASE_8_ACCEPTANCE.md`.
Follow the canonical Phase 8 scope and existing Phase 0/product/domain
contracts. No production deployment or dependency upgrade is in scope.

- [x] Add deterministic and PostgreSQL concurrency tests proving retries do not duplicate ledger effects and two devices cannot double-spend.
- [x] Apply and verify the existing ordered migration chain through `0017`, including migration compatibility for legacy Phase 7 allocation/session rows.
- [x] Exercise earn/spend, partial/full reservations, release, reserved spend, partial refunds, expiry, adjustments, product isolation, and account export in isolated fixtures.
- [x] Prove balances never go negative and a credit lot cannot be consumed twice under concurrent requests.
- [x] Connect product-specific minute credits to server-authoritative build-session reserve/start, heartbeat, settlement/release and cross-device recovery. Bill server-observed milliseconds rounded up to whole minutes; cap reservations at 60 minutes and pause after heartbeat gaps over 90 seconds.
- [x] Resolve offline-session policy for this phase: offline allowance is zero; offline work is unauthorized until later signed, scoped policy/reservation support. Do not claim that the current rules evaluator enforces wallet credits.
- [x] Keep manual earn/adjust controls disabled by default, rejected in production, and opt-in only in the isolated fixture; they are not verified rewards or billing evidence.
- [x] Complete the consolidated P8-1–P8-5 acceptance session; all five checks PASS by user report. The first P8-4 settlement crossed the 60-second billing boundary and correctly charged two minutes; the immediate fresh-reservation retest charged one minute and released two. This is a timing observation, not a product defect.

Phase 8 is formally COMPLETE with no Phase 8 blocker. The 18 dependency-security
findings remain open release obligations; production launch remains **NO-GO**.
Preserve the accepted Phase 1–8 evidence. Do not repeat P8-1–P8-5.

### Phase 9 — Web Application

**High**

**Status: COMPLETE** (2026-10-11, user-reported acceptance). Phase 8 remains complete and checkpointed; Phase 9 is accepted for its existing Enough web application scope, runtime, responsive behavior, accessibility, and user-scoped flows. No Phase 9 blocker remains. Preserve the accepted Phase 1–8 evidence and do not reopen or repeat P9-1–P9-5.

- [x] Apply migrations through `0008` and start the complete local stack. The isolated Phase 9 fixture applied the current migration chain through `0017`, passed migration precheck, and verified PostgreSQL, Redis, API, worker, and web readiness (`PHASE_9_ACCEPTANCE.md`).
- [x] Exercise the canonical Phase 9 pages at desktop and approximately 390px narrow width; keyboard navigation and visible focus, System/Light/Dark persistence, and loading/empty/error/unauthorized states passed (P9-1, P9-2, P9-5; user report, 2026-10-11).
- [x] Verify product creation/selection/stage update, goal and task creation/completion, Activity product filters, product-specific reports, prepared-target session revocation, and both account-export links (P9-3, P9-4; user report, 2026-10-11).
- [x] Review responsive/accessibility behavior and resolve acceptance: no manual failures were observed; the user reported P9-1 through P9-5 PASS. Fixture stopped successfully (`PHASE_9_ACCEPTANCE.md`).

### Phase 10 — Browser Extension

**Critical**

**Status: COMPLETE — 2026-10-11; checkpoint approval pending.** Preserve the existing Chromium/Firefox Manifest V3 implementation and accepted Phase 1–9 behavior. Focused tests cover exact-origin permission, extension session rotation, policy/cache/blocking, product selection, schedules/overrides, Growth Mode, hostname-only events, revocation, restart/stale cleanup, candidate bounds, and native-host health. Chromium/Firefox builds, workspace tests/typecheck/format/lint, and the isolated Phase 10 migration/readiness smoke pass. The user reported P10-1 through P10-5 PASS in one consolidated browser session with no failures; see `PHASE_10_ACCEPTANCE.md`. No migration/schema or dependency change was made. Preserve all accepted Phase 1–9 evidence and do not repeat Phase 10 checks. The 18 dependency-security findings remain separate open release obligations; production launch remains NO-GO.

- [x] Build Chromium and Firefox packages and verify generated manifests/assets; loading packages and recording installed IDs/exact origins remain in the consolidated manual session.
- [x] Apply and precheck the isolated current migration chain through `0017`; configure each installed exact extension origin in the Phase 10 fixture during the consolidated manual session.
- [x] Exercise sign-in/revocation, policy sync, product-specific block/allowed behavior, schedules/overrides, Growth Mode, offline behavior, and browser restart through focused automated coverage, accepted Phase 1–9 service evidence, and the P10-1–P10-5 browser session.
- [x] Verify opt-in hostname-only activity and confirm page paths/query data are not uploaded through focused automated payload checks and the accepted activity-service evidence.
- [x] Verify stale-rule cleanup and domain-evaluation bounds through focused automated coverage; verify prepared Chromium-target revocation leaves the Firefox session active in the consolidated browser session.
- [x] Record the consolidated manual result: P10-1, P10-2, P10-3, P10-4, and P10-5 PASS by user report, 2026-10-11; no manual failures observed. Do not repeat these checks.

### Phase 11 — Desktop Agent

**Critical**

**Status: ACTIVE — 2026-10-12.** Preserve the existing Electron implementation
and accepted Phase 1–10 contracts. P11-1, P11-2, and P11-3 passed in one
consolidated Windows manual session, with final automated checks passing. P11-4
is BLOCKED by the current restriction against modifying browser profiles or
protected configuration. P11-5 is BLOCKED because signed updater/package
credentials and required macOS/Linux runtime environments are unavailable.
These gates remain required before Phase 11 can be marked complete. A partial
checkpoint may record the accepted implementation and Windows results, but it
must retain the ACTIVE status. All 18 dependency-security findings remain open;
production is NO-GO.

- [x] Build the existing desktop source on Windows; P11-1–P11-3 Windows runtime acceptance passed against an isolated disposable fixture.
- [x] Verify app identity/classification, idle/lock, grace expiry, emergency bypass, and offline recovery without changing the accepted Phase 8 server-authoritative session model.
- [ ] Verify suspend/resume and opted-in app-time event ingestion; these were not part of the reported P11-1–P11-3 manual results.
- [x] Test the bounded native-host protocol and fresh/stale heartbeat using isolated temporary data; browser registration/restart acceptance is BLOCKED by restrictions on browser-profile/protected-configuration changes.
- [x] Implement and test signed, expiring policy snapshots with account/device binding and signed classification/product scope; automated checks reject altered payloads, expired/overlong validity, wrong account/device/product, and unknown keys before offline use.
- [ ] Verify updater discovery/signature handling and package/sign/install/update/rollback; P11-5 is BLOCKED by unavailable signed updater/package credentials and required macOS/Linux runtime environments.
- [ ] Document Linux Wayland/lock-state limits and executable-renaming behavior; preserve the agreed support contract and test Windows-first behavior.
- [x] Run final `pnpm test` (102 passed; 137 opt-in integration/runtime tests skipped), `pnpm typecheck`, `pnpm desktop:build`, `pnpm format:check`, scoped Biome checks, and `git diff --check`. The isolated Phase 11 prepare smoke passed fresh migrations through `0017`, API/worker/web readiness, and disposable account/policy setup; the consolidated manual fixture stopped and the marked TEMP fixture was removed. Repository-wide `pnpm lint` continues to report existing findings in unrelated files.
- [x] Complete automated verification: full default suite, workspace typecheck, desktop source build, formatter, scoped Biome checks, and the isolated Phase 11 API signed-snapshot fixture smoke.
- [x] Complete the consolidated Windows manual acceptance for P11-1 through P11-3. P11-4 remains BLOCKED by browser-profile/protected-configuration restrictions; P11-5 remains BLOCKED by unavailable signed updater/package credentials and required macOS/Linux runtime environments. Do not mark Phase 11 complete until both gates pass.

### Phase 12 — Growth Task Engine

**High**

**Status: COMPLETE — 2026-10-12.** Existing task functionality passed canonical scope review, isolated migrations through `0017`, five PostgreSQL-backed API cases, API/worker/web readiness, workspace typecheck and default tests, and the consolidated browser acceptance. No Phase 12 blockers remain. Phase 11 remains ACTIVE with P11-1–P11-3 PASS and P11-4/P11-5 BLOCKED. All 18 dependency-security findings remain open; production launch remains NO-GO. See `PHASE_12_ACCEPTANCE.md`.

- [x] Apply migrations `0002`–`0009` in order; isolated PostgreSQL applied the complete ordered chain through `0017` and migration precheck found no pending migrations.
- [x] Exercise stage templates, custom tasks, ownership, cancellation, completion retries, recurrence, evidence-gated credit rewards, export, and account deletion against PostgreSQL (five integration cases passed).
- [x] Complete one consolidated task-page browser session for stage recommendations, keyboard reachability, offline error recovery, recurring custom task metadata, narrow-screen usability, completion/evidence/history state, next occurrence, and cancellation; user reported PASS with no failures. See `PHASE_12_ACCEPTANCE.md`.

### Phase 13 — Evidence System

**Critical**

- [x] Apply the isolated Phase 13 migration chain through `0019`, migrate a seeded legacy BYTEA file after checksum verification, and confirm migration precheck finds no pending migrations.
- [x] Exercise S3 upload, screenshot, private retrieval, ownership isolation, URL/note/self-report/integration references, integrity, duplicates/retries, failure recovery, evidence/account deletion, bounded orphan cleanup, export, paired restore, atomic reward rollback/retry, and exactly-once credit creation in eight PostgreSQL/API/storage cases. See `PHASE_13_ACCEPTANCE.md`.
- [x] Verify the evidence, task, and credit pages return HTTP 200; exercise unauthorized and cross-account evidence/download rejection through the web API proxy.
- [x] Verify the trust boundary: owner review is labelled as self-verification, user-submitted integration references remain pending, and no automatic provider reward is claimed in Phase 13. Uploads remain authenticated/private; the local S3-compatible fixture denies unsigned access.
- [x] Implement the private object-storage target for evidence bytes, keeping ownership/checksums/lifecycle metadata in PostgreSQL. Verify checksum-protected BYTEA migration, export/delete, private retrieval, orphan cleanup, and joint metadata/object restore.
- [x] Complete one consolidated browser acceptance session after final automated checks passed; user reported PASS with no failures. Upload and screenshot privacy/retrieval/deletion, owner self-verification, and exactly one +5 Build Credit reward were confirmed. The manual fixture uses `/growth-tasks` and `/growth-tasks/:id/complete`; its earlier `/tasks` route usage was a fixture setup defect and was corrected.
- [ ] Close the Phase 20/27 High malware-scanning/moderation risk before enabling public or unauthenticated uploads; no scanner is claimed in Phase 13.

**Status: COMPLETE.** Isolated migrations/API/runtime/storage acceptance, legacy BYTEA transfer, paired metadata/object restore, default tests, typecheck, format, lint, diff checks, and the consolidated browser session passed. The canonical exit criterion is satisfied. Malware scanning remains unimplemented; keep uploads private/authenticated and close the High Phase 20/27 decision before any public upload surface. Production object-storage backup and restore obligations remain in Phase 25. Production remains NO-GO with all 18 dependency-security findings open.

### Phase 14 — Integrations

**Critical for Phase 27-required providers; Medium for optional analytics adapters**

- [x] Implement and deterministically accept Gmail, Outlook, Google Calendar, and Microsoft Calendar provider authentication, read scopes, sync, token refresh/disconnect, and safe failure recording. Real Google acceptance passed. Microsoft real OAuth, functional/data, Calendar refresh and local disconnect passed; PERSONAL_MSA provider revocation remains an explicit external blocker.
- [x] Implement and accept a separate Stripe customer-revenue integration that confirms signed webhook events through the connected Stripe API. Enough's own subscription webhook remains separate. End-to-end Stripe anonymous sandbox delivery passed.
- [x] Apply isolated migrations `0001`–`0020` in order, pass migration precheck with no pending migrations, and verify compatibility upgrading from the accepted `0019` schema.
- [x] Exercise Generic webhook/Public Event API HMAC success/failure, exact-body signing, stale/future timestamp rejection, malformed and out-of-scope monetary payload rejection, identical retry, conflicting event ID, account rate limits, revocation races, account/product ownership, evidence review/reward gating, safe export, and account deletion against isolated PostgreSQL/Redis/API runtime.
- [x] Implement and deterministically accept PostHog, Plausible and GA4 adapters with explicit event mapping and aggregated result storage, retaining the original Phase 14 scope.
- [x] Pass migration `0020`, provider OAuth/adapter/Stripe suites (18/18 focused tests), and 29/29 Phase 14 PostgreSQL/API runtime tests in the isolated fixture; privacy/export/deletion checks passed.
- [x] Complete consolidated local browser acceptance by user report, including exactly-once Stripe-origin reward behavior and pending/no-reward owner-controlled Generic/Public API behavior.
- [x] Complete dedicated Google OAuth and Stripe customer-revenue sandbox acceptance; see `PHASE_14_ACCEPTANCE.md`.
- [x] Checkpoint Phase 14 external acceptance with the user-approved exceptions preserved in `PHASE_14_ACCEPTANCE.md`: PostHog and Plausible combined PASS; Microsoft combined BLOCKED solely on PERSONAL_MSA provider revocation; GA4 Realtime ingestion PASS with standard reporting/normalization/cleanup DEFERRED. This checkpoint is not a claim that the two exceptions passed. Generic/Public API signatures still authenticate only the workspace owner's source. Do not reopen Phase 14 as part of Phase 15.

### Phase 15 — AI Layer

**High; Phase 27 includes the AI Coach**

**COMPLETE — 2026-10-17; evidence and canonical criterion matrix in `AI_COACH.md`.** Passes 1–3 and provider/data-handling review are accepted. All seven capabilities passed completed/schema-valid real responses in exactly seven sequential calls without retries. The user reported P15-1–P15-6 PASS in one hydrated browser session; no failures were reported. Final read-only verification confirms exactly one new ACTIVE Product A task, correct owner, reward zero, route audit/POST provenance, no completion/evidence, unchanged Available/Reserved and credit ledger, final consent revoked, safe logs and no additional provider attempts. Owned services stopped cleanly and evidence was retained. Account controls remain NOT VERIFIED without special-control claims. No Phase 14/GA4 state was touched; Phase 16 is not started and production remains NO-GO.

- [x] Development OpenAI success for all seven capabilities; incomplete/refusal/timeout/provider-error/malformed branches rerun deterministically without external calls. Local fallback and consent denial consume zero calls. Bounded runner returned to disabled mode; seven-call ledger retained.
- [x] Fresh isolated Phase 15 schema through `0020`, exact migration checksums/order/ledger, precheck and idempotent rerun. AI consent uses `0014`, usage metadata `0015`, current evidence `0018`/`0019`. All seven capabilities, rate limits, CSRF, ownership, consent and explicit zero-reward tasks pass live API/database checks; later schema does not accept later phases.
- [x] Official provider-policy/payload review dated 2026-10-17, category matrix and minimization regressions in `AI_COACH.md`; Enough logs/usage remain content-free. MAM/ZDR/sharing/residency settings are ACCOUNT CONFIGURATION NOT VERIFIED; no special-control claim or production account approval. No additional provider calls.
- [x] USER-REPORTED consolidated hydrated browser P15-1–P15-6 PASS: desktop/~390px, keyboard/focus, all seven actions, consent/privacy, context-switch/in-flight invalidation, explicit zero-reward save and offline error/recovery. Refusal/missing-context and unauthorized boundaries retain automated coverage; no claim of manual provider refusal. Final read-only verification, relevant checks and clean shutdown PASS. All canonical Phase 15 criteria are satisfied; no later-phase acceptance is implied.

### Phase 16 — Reports

**Medium**

- [ ] Apply migrations through `0011`; test empty, single/multi-currency, large-volume, and mixed-verification data.
- [ ] Verify ownership, ranges, rate limits, UTC boundaries, malformed attributes, linked/unlinked ratios, and wallet scoping against PostgreSQL.
- [ ] Verify report views across desktop/mobile, keyboard, loading/empty/error/unauthorized states.

### Phase 17 — Notifications

**High**

- [ ] Apply migrations through `0012`; verify default preferences, channel toggles, ownership, export, and deletion.
- [ ] Exercise email opt-in, unverified/invalid addresses, provider success/failure/retry, idempotency, daily limits, quiet hours, time zones, and DST.
- [ ] Verify desktop duplicate acknowledgements, offline recovery, unsupported OS notifications, rate limits, and stale alerts.
- [ ] Verify inbox/settings UI and ensure production email links never expose credentials.

### Phase 18 — Billing

**Critical**

- [ ] Decide product pricing, Stripe Price IDs, trial/coupon/tax policy, and exact paid-feature entitlements.
- [ ] Configure Stripe test mode, Tax, Portal, recurring prices, webhook events, and secret rotation.
- [ ] Apply migrations `0002`–`0013` in order.
- [ ] Test duplicate/out-of-order/invalid-signature webhooks, ownership, subscription changes, grace expiry, trials, coupons, taxes, failed payments, portal, invoices, export, and deletion.
- [ ] Wire and verify each paid capability through the central entitlement check; prove fail-closed behavior for unknown/unpaid states.
- [ ] Verify Checkout and Billing UI on supported viewport/input modes.

### Phase 19 — Privacy and Data Controls

**Critical**

- [ ] Apply migrations `0002`–`0014`; verify startup, consent/retention defaults, cascades, and migration recovery on a disposable database.
- [ ] Test export, consent/revoke races, retention boundaries and rollup repair, activity erase, AI-provider block, evidence deletion/download denial/reward history, OAuth last-method protection, device revoke, Stripe cleanup success/failure, and account deletion.
- [ ] Verify the existing worker retention scheduler and Stripe deletion path; fix defects found in execution and test retries/failure handling. Both exist in source; runtime acceptance is missing.
- [ ] Complete policy text: legal entity, privacy contact, processors, regions, backup/log retention, and transfer safeguards.
- [ ] Verify the privacy/dashboard/evidence/device flows and provide an auditable deletion result.

### Phase 20 — Security Hardening

**Critical**

- [ ] In an isolated test environment, exercise hostile navigation, iframe/IPC sender validation, OAuth state replay, webhook replay/signature rejection, rate-limit exhaustion, CSRF, authorization/ownership, and extension/desktop token revocation.
- [ ] Perform a threat-model review and focused security assessment of authentication, data export/deletion, uploads, provider secrets, billing, admin, offline policy, updater, and deployment scripts.
- [ ] Triage findings by severity; fix all critical/high findings and document residual medium findings with owners and deadlines.
- [ ] Review dependency and secret scanning results; rotate any exposed credential and record remediation.

### Phase 21 — Anti-Tamper and Edge Cases

**Critical**

- [ ] Run live scenarios for offline expiry/recovery, wall-clock rollback/forward, duplicate retries, simultaneous devices, extension disable/re-enable, killed desktop agent, renamed executable, stale policy, integration-revocation race, and fake completion.
- [ ] Define and accept fail-open/fail-closed behavior for stale policy and client disablement; test emergency unlock and recovery.
- [ ] Verify bounded queue expiry/overflow and multi-device ordering with real API/database/client processes.
- [ ] Decide if executable identity and unsigned cached policy meet the launch threat model; implement stronger identity/signature checks where required.

### Phase 22 — Admin Console

**High; critical for any operational admin capability exposed at launch**

- [ ] Apply migration `0015_admin_console.sql` after migrations `0002`–`0014`.
- [ ] Exercise bootstrap allowlist, role grant/revoke, denial, CSRF, and rate limits with verified test accounts.
- [ ] Exercise account/subscription/device/integration lookup/revocation, job health/retry, template/flag edits, AI usage, audit entries, and retention boundaries.
- [ ] Verify narrow-screen and unauthorized/error/empty states. Confirm flags affect only implemented, tested consumers.

### Phase 23 — Quality Engineering

**Critical**

- [ ] Re-run the recorded 65-test suite after establishing a supported package environment; then add missing critical-path unit/property tests.
- [ ] Add live API/database/migration/transaction/authorization tests using disposable PostgreSQL and Redis.
- [ ] Test OAuth one-use state/CSRF/session exchange and Stripe test-mode Checkout/Portal/webhook/entitlement/invoice paths.
- [ ] Add browser and Electron end-to-end coverage for sign-in, policy sync, offline expiry/recovery, revocation, and core user journeys.
- [ ] Verify multi-device duplicate/order/concurrency, migration recovery/rollback expectations, representative load, and security regression behavior.
- [ ] Run lint, formatting, typecheck, all automated suites, extension/desktop builds, and package audits; retain CI artifacts and results.

### Phase 24 — Installers and Distribution

**Critical for end-user launch**

- [ ] Produce signed Windows/macOS installers and Linux packages from release CI; resolve the local electron-builder `EPERM` as needed for diagnosis.
- [ ] Install, update, downgrade/rollback, and uninstall on each supported OS; verify update metadata, signatures, and native-host registration.
- [ ] Submit Chrome, Edge, and Firefox extensions and complete store review; verify published package IDs/origins.
- [ ] Publish a reachable update feed/repository and prove a normal user can install/update without manual technical steps.

### Phase 25 — Production Infrastructure

**Critical**

- [x] Preserve supporting release-hardening checkpoint `35f18280231613a890d10e340160e62604ccb2d8`: production config contract, install/test/build secret isolation, OAuth callback log protection and offline regression coverage. Its former “15A” label does not change the canonical phase sequence. No deployment or Phase 25 completion is claimed.

- [ ] Configure an Ubuntu host, Node.js 22+, pnpm 11.20.0, PostgreSQL, Redis ACL, Nginx, DNS/TLS, firewall, protected secrets, SSH deploy key, and off-host backup storage.
- [ ] Validate Nginx/systemd/sudoers on the host; deploy an explicit approved ref with reviewed migration approval.
- [ ] Enable services/timers, external alerting, persistent logs, backup retention, and least-privilege operator access.
- [ ] Confirm encrypted remote backup, isolated restore, restart recovery, and host reboot survival.

### Phase 26 — Production Verification

**Critical**

- [ ] Execute the complete [production verification matrix](infra/production-verification.md), capturing redacted evidence for web/API/worker/database/cache/Nginx/TLS/email/Stripe/OAuth/integrations/activity/client sync/lock-unlock/jobs/backup/restore/reboot.
- [ ] Use synthetic accounts/data and provider test modes; verify that external secrets and personal data are absent from logs.
- [ ] Keep unsupported or missing integrations marked as gaps; do not record a generic webhook as a vendor adapter pass.
- [ ] Close the exit criterion only after the complete production system works together and incidents/recovery paths are exercised.

## Cross-cutting risks to resolve or explicitly accept

| Severity | Risk | Required action |
| --- | --- | --- |
| Critical | Migrations `0002`–`0015` and most runtime flows are unaccepted. | Apply in order to disposable/staging DBs; verify schema, data, authorization, recovery, and export/deletion. |
| Critical | Desktop policy cache is encrypted but unsigned; stale/offline policy can pause enforcement and clients can be disabled. | Sign expiring policy snapshots; define/test fail-open behavior and communicate enforcement limits. |
| Critical | Production database, provider credentials, signing keys, and update signing are not configured. | Configure isolated secrets and rotation; never store secrets in this plan/handoff. |
| High | Browser bearer token is in extension local storage; desktop identity does not verify code signature. | Threat-model and harden or accept with compensating controls before rollout. |
| High | Evidence review can be performed by the submitter; uploads are not malware-scanned. | Decide independence requirement and scanning/moderation controls. |
| High | BullMQ handles only `healthcheck`; notification and privacy timers exist but lack runtime acceptance. | Test existing timers and cleanup; implement required provider/business job handlers with retries/idempotency. |
| High | Readiness checks prove dependency connectivity, not full downstream behavior; monitor has no external alerts. | Add synthetic service checks and alert routing with tested runbooks. |
| Medium | Linux Wayland app detection and lock-state behavior vary; extension only blocks top-level navigation and caps evaluated domains. | Define platform/support limits and verify representative devices. |
| Medium | Analytics adapters are implemented in source but have no provider sandbox acceptance. | Run isolated provider API tests and verify the explicit event mapping/aggregation with test credentials. |
| Nice to have | Passkeys remain explicitly deferred under the original practical exception. | Do not expand launch scope without a recorded change. |

## Automated verification and security evidence standard

Run checks in a clean supported environment and retain commit, tool versions, exit status, duration, redacted logs, and artifact hashes. Do not claim completion from a test command alone.

1. **Source and dependency checks:** frozen install, formatter, linter, typecheck, dependency audit, secret scan, extension/desktop builds.
2. **Unit/property/contract:** policy determinism, time boundaries, queue/idempotency, authorization decisions, billing mapping, signed events, uploads/quotas, export/delete, updater verification.
3. **Database integration:** fresh migrations `0001`–`0015`, migration precheck/checksum mismatch, constraints, transactions, rollback/recovery, concurrency, retention, export/deletion.
4. **Service integration:** web/API/worker/PostgreSQL/Redis, readiness/degraded states, job retries, notifications, signed provider/webhook paths.
5. **Browser/Electron:** authentication, keyboard/accessibility, browser blocking parity, desktop native host, lock/unlock, offline expiry, revocation, updates, and supported OS matrix.
6. **Security:** threat-model review, auth/CSRF/IDOR, OAuth replay, webhook signature/replay, rate limits, injection/XSS/SSRF, upload handling, secret/log review, desktop IPC/navigation, updater signature, dependency findings, and abuse cases.
7. **Operational:** TLS, least privilege, deployment/rollback, alert test, encrypted remote backup, isolated restore, service restart, reboot, and incident/recovery drills.

The existing root scripts include `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:precheck`, and `pnpm db:migrate`; run database commands only with an explicitly disposable test database until the staging gate. Add/choose an end-to-end runner only after reviewing repository dependencies and committing its lockfile changes.

## Completion rule

Every check in a phase must have one of: accepted evidence, a linked defect with severity/owner/date, or an explicit scope change approved in the product contract. Critical and High items cannot be silently deferred. Phase 27 remains NO-GO while any required capability lacks accepted production evidence.

###

The current Windows environment has intermittent EPERM filesystem/package-manager failures.

Do not waste time repeatedly fighting Windows-specific package locking.

If the native Windows environment remains unreliable, use WSL2 with Ubuntu as the supported development environment.

Do not introduce Docker.

Do not introduce GitHub Actions.

Do not require or touch a production server.

Phase 1 must be completed entirely in the local development environment.

1. Establish a reliable Linux development environment

Prefer WSL2 Ubuntu if Windows package access remains unreliable.

Verify:

uname -a
node --version
pnpm --version
git --version
psql --version
redis-server --version

Use the Node.js version required by the repository.

If the repository defines the version in any of:

.nvmrc
.node-version
package.json engines
pnpm-workspace.yaml

respect that version.

Do not silently upgrade dependencies merely because newer versions exist.

Use the project's existing package manager and lockfile.

For pnpm:

corepack enable
pnpm --version
pnpm install --frozen-lockfile

The install must complete reliably.

Do not delete or regenerate the lockfile unless it is demonstrably invalid and the reason is documented.

2. Avoid problematic Windows-mounted paths

If running under WSL2, do not execute the Node dependency installation from /mnt/c/... if that causes filesystem or permission issues.

Prefer a Linux-native working directory such as:

~/projects/enough

Clone or copy the repository there safely.

Do not create divergent source histories.

Confirm:

git status
git remote -v
git branch --show-current

before continuing.

3. Secret and repository hygiene review

Before making the initial Git snapshot, inspect the entire repository for accidental secrets or machine-specific files.

Check for:

.env
.env.*
API keys
OAuth secrets
database passwords
Redis passwords
private keys
certificates
tokens
credentials
personal absolute paths
build artifacts
node_modules
temporary files
logs
SQLite/local runtime state
IDE files that should not be committed

Verify .gitignore.

Provide tracked templates where appropriate:

.env.example

Templates must contain only placeholder values.

Search tracked files for suspicious values using appropriate repository-safe commands.

Do not print real secrets into terminal output or documentation.

If a real credential is discovered:

remove it from tracked source

document that rotation is required

do not commit it

do not attempt to hide the discovery

4. PostgreSQL

Use an isolated local PostgreSQL database for Enough.

Do not reuse an unrelated application database.

Create or verify:

database
application role
development credentials
test database if the repository expects one

Use the project's existing environment variable naming.

Example only:

DATABASE_URL
TEST_DATABASE_URL

Do not introduce duplicate configuration names if the project already has equivalents.

Confirm connectivity using both:

psql

and the application database layer.

5. Redis

The previously available Redis 3 installation is unsupported for this project.

Install a currently supported Redis release from the Ubuntu environment/package source appropriate for the selected Ubuntu release.

Do not continue using Redis 3.

Verify:

redis-server --version
redis-cli ping

Expected connectivity check:

PONG

Use an isolated Enough Redis namespace/database where supported by the existing configuration.

Do not expose Redis publicly.

For local development it should bind only to the local environment.

6. Environment configuration

Prepare the local development .env from the repository template.

Use only local development credentials.

Verify configuration validation.

The application must fail clearly on missing required configuration rather than silently starting in a broken state.

Do not weaken environment validation simply to make startup easier.

7. Dependency installation

Once package access is reliable:

pnpm install --frozen-lockfile

Then run repository-provided formatting commands.

If the workspace exposes scripts, use those scripts rather than inventing parallel commands.

Typical sequence:

pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build

Adapt only to scripts that actually exist.

If formatting changes are required, run the project's formatter and re-run the check.

Do not claim success based on an older run.

Every verification must be performed against the latest working tree.

8. Database migrations

Inspect the migration history before running anything.

Then apply migrations against the isolated Enough database.

Verify:

all expected migrations apply in order

schema state matches source expectations

migrations are idempotently tracked

no unrelated database is touched

If the project has migration verification/status commands, run them.

Also verify that a fresh empty database can be migrated successfully from zero.

Do not modify historical migrations casually.

If a migration is genuinely broken, explain why before repairing it.

9. Runtime acceptance

Start the local services required by Phase 1:

web
API
worker
PostgreSQL
Redis

Desktop and extension build verification should also remain passing, but they do not need to run continuously for backend runtime acceptance unless the existing specification says otherwise.

Start services using the repository's existing development scripts.

Do not introduce Docker Compose.

Do not introduce a production process manager for this local acceptance test.

Verify web health.

Verify API liveness and readiness independently if both endpoints exist.

Verify worker readiness by confirming:

process stays alive

Redis connection succeeds

database connection succeeds where required

queue initialization succeeds

no startup exception occurs

Do not treat “process is running” alone as readiness.

10. Health endpoints

Verify the existing health implementation.

Expected conceptual separation:

liveness:
process is alive

readiness:
required dependencies are usable

Readiness should verify relevant infrastructure such as:

PostgreSQL
Redis

Do not add excessive external dependency checks that would make the application unavailable unnecessarily.

Record the exact commands/URLs used to verify local health.

11. Full verification pass

After all fixes are complete, perform one clean final verification from the latest source.

At minimum run all repository-supported equivalents of:

pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build

Also verify individual applications/packages if the root command does not cover them:

web
API
worker
extension
desktop
shared packages
database package
rules engine if already present

No phase should be marked complete while a relevant check is failing.

Do not hide warnings that indicate actual correctness problems.

Separate harmless third-party build warnings from project defects.

12. Git snapshot

Only after the source passes the required checks:

git status
git diff
git diff --cached

Review the actual files going into the initial snapshot.

Confirm again that:

no .env

no credential

no private key

no local database

no build output

no node_modules

no sensitive runtime logs

are being committed.

Create the initial clean commit.

Use a descriptive commit message, for example:

chore: complete phase 1 project foundation

Do not force-push.

If a GitHub remote is already configured, push to the intended branch.

If authentication prevents the push, report the exact blocker rather than altering repository history.

After push, verify synchronization:

git status
git log -1 --oneline
git rev-parse HEAD
git rev-parse @{u}

Local HEAD and the intended upstream revision must match.

13. Do not introduce CI yet

Do not add:

GitHub Actions
GitLab CI
CircleCI
Docker-based CI

The current project decision is explicitly:

NO Docker
NO GitHub Actions

Verification remains local/manual at this phase.

14. Do not deploy

Phase 1 does not require production infrastructure.

Do not:

SSH into the production VPS

configure production Nginx

create production systemd services

create live DNS entries

create live databases

deploy the web application

provision production Redis

expose any service to the public internet

Production deployment belongs to a later phase.

15. Documentation update

Once Phase 1 is genuinely complete, update:

IMPLEMENTATION_HANDOFF.md
IMPLEMENTATION_PLAN.md
SECURITY_STATUS.md
DEPLOYMENT_STATUS.md
KNOWN_LIMITATIONS.md

Record:

development environment used
Node version
pnpm version
PostgreSQL version
Redis version
migration status
test results
lint result
typecheck result
build result
web runtime result
API health result
API readiness result
worker result
extension build result
desktop build result
Git commit hash
upstream synchronization status
remaining warnings
remaining limitations

Mark Phase 1 complete only if its documented exit criteria are actually satisfied.

Phase 1 final acceptance criteria

Phase 1 is COMPLETE only when all of the following are true:

[ ] reliable development environment established
[ ] dependency installation succeeds
[ ] frozen lockfile install succeeds
[ ] formatting passes
[ ] lint passes
[ ] typecheck passes
[ ] test suite passes
[ ] web build passes
[ ] API build passes
[ ] worker build passes
[ ] extension build passes
[ ] desktop build passes
[ ] PostgreSQL isolated and operational
[ ] supported Redis operational
[ ] migrations successfully applied
[ ] fresh-database migration verified
[ ] web starts successfully
[ ] API starts successfully
[ ] API liveness passes
[ ] API readiness passes
[ ] worker starts and connects successfully
[ ] repository reviewed for secrets
[ ] initial Git snapshot created
[ ] GitHub upstream synchronization verified
[ ] Phase 1 documentation updated

If any item remains incomplete, report Phase 1 as PARTIAL, not complete.

Final report format

Return a concise but complete report containing:

Phase 1 status

COMPLETE

or:

PARTIAL

Environment

OS:
Node:
pnpm:
PostgreSQL:
Redis:

Verification

Install:
Formatting:
Lint:
Typecheck:
Tests:
Web build:
API build:
Worker build:
Extension build:
Desktop build:
Migrations:
Fresh DB migration:
Web runtime:
API liveness:
API readiness:
Worker runtime:

Git

Branch:
Commit:
Remote:
Push:
Upstream synchronized:
Secret review:

Remaining blockers

List only genuine unresolved blockers.

Files changed

Summarize meaningful source/configuration/documentation changes.

Do not begin Phase 2.

Finish Phase 1 first.
