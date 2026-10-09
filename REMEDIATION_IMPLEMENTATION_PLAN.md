# Remediation Implementation Plan

Last consolidated: 2026-10-09 (Phase 2 scope update)
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

**Phase 2 PASS; no Phase 2 blockers. Phase 3 is ready after the user's final review and remains on hold in this continuation.** Real provider happy paths and installed clients passed by user report; do not reopen those checks. Existing real credentials stay only in ignored `.env`; isolated tests use synthetic provider responses and never read/copy those credentials. Current acceptance applies to the uncommitted working tree over `0b3df3a`, pending commit. Dependency remediation remains open for Phases 20/23/24. Launch remains NO-GO.

### Phase 3 — Product Onboarding

**High**

- [ ] Apply migrations `0002`–`0003` in order.
- [ ] Verify every onboarding answer saves, reloads, edits, and appears in account export.
- [ ] Verify each product stage produces its intended recommendation and opens the correct dashboard.
- [ ] Check authenticated ownership boundaries and validation errors.

### Phase 4 — Product and Stage Engine

**High**

- [ ] Apply migrations `0002`–`0004` in order.
- [ ] Verify onboarding/profile updates stay synchronized with canonical products, primary goals, stage history, and metrics.
- [ ] Exercise all nine stages, stage changes/history, multiple products, goal status, metric updates, and account export.
- [ ] Verify ownership, deletion/cascade behavior, and invalid/stale updates against PostgreSQL.

### Phase 5 — Activity Event Platform

**Critical**

- [ ] Apply migrations `0002`–`0005` in order.
- [ ] Verify duplicate/replayed batches do not change aggregates; conflicting event IDs or sequence reuse reject atomically.
- [ ] Verify offline ordering, timestamp correction, future/old event handling, and hourly aggregates against PostgreSQL.
- [ ] Verify product/device ownership, privacy-safe payload bounds, export, and deletion.
- [ ] Add database integration coverage for transaction and concurrency behavior.

### Phase 6 — Tool Classification Engine

**High**

- [ ] Apply migrations `0002`–`0006` in order.
- [ ] Exercise catalog items, account/product mappings, context matches, wildcard domains, unknown keys, duplicate conflicts, and resolver precedence.
- [ ] Verify ownership boundaries, product/account deletion, export, and tools-page create/edit/remove/preview behavior.

### Phase 7 — Rule Engine

**Critical**

- [ ] Add deterministic unit/property cases for condition combinations, scope, priorities/ties, schedules/time zones, override expiry/revocation, version conflicts, and defaults.
- [ ] Apply migrations `0002`–`0007` in order.
- [ ] Verify byte-for-byte repeatable decisions for identical policy snapshots and timestamps.
- [ ] Exercise ownership isolation, stale-version conflicts, archive history, schedule boundaries/DST, override expiry/revocation, export, deletion, and client policy parity.

### Phase 8 — Build Credit Engine

**Critical**

- [ ] Add deterministic and PostgreSQL concurrency tests proving retries do not duplicate ledger effects and two devices cannot double-spend.
- [ ] Apply migrations `0002`–`0008` in order.
- [ ] Exercise earn/spend, partial/full reservations, release, reserved spend, partial refunds, expiry, adjustments, product isolation, and export.
- [ ] Prove balances never go negative and a credit lot cannot be consumed twice under concurrent requests.
- [ ] Connect product-specific minute credits to a server-authoritative build-session lifecycle: reserve, meter, settle/release and recover across devices. Specify rounding and bounded offline reservations. Current rules do not consume credits; manual wallet actions cannot fulfill the core product loop.
- [ ] Decide whether manual earn/adjust controls remain available at launch; they are prototypes, not trusted rewards or billing evidence.

### Phase 9 — Web Application

**High**

- [ ] Apply migrations through `0008` and start the complete local stack.
- [ ] Exercise core pages at declared desktop/mobile breakpoints, keyboard-only navigation, themes, and loading/empty/error/unauthorized states.
- [ ] Verify activity filters, product ownership, goals, reports, device/session revocation, and account-export links.
- [ ] Record accessibility and responsive defects; fix critical and high-severity issues before general availability.

### Phase 10 — Browser Extension

**Critical**

- [ ] Build and install Chromium and Firefox packages; verify manifests, assets, permissions, API origin, and publisher IDs.
- [ ] Apply migrations through `0008`; configure exact extension origins.
- [ ] Exercise sign-in/revocation, policy sync, block/allow precedence, schedules, overrides, Growth Mode expiry, offline behavior, event ingestion, and browser restart.
- [ ] Verify page paths and page content are never captured; check the opt-in hostname-only event contract.
- [ ] Verify stale-rule cleanup, disabled/re-enabled behavior, rate limits, and domain-evaluation bounds.

### Phase 11 — Desktop Agent

**Critical**

- [ ] Build and run the desktop app/native host on every declared supported OS; verify login, product selection, sync, events, and revocation.
- [ ] Verify app identity/classification, idle/lock/suspend/resume, grace expiry, emergency bypass, and offline recovery across supported platforms.
- [ ] Install the native host in supported browsers; verify permissions and heartbeat as the desktop agent starts/stops and browsers restart.
- [ ] Implement signed, expiring policy snapshots and validate signatures before treating cached policy as tamper-evident.
- [ ] Verify update discovery, signature, download, installation, restart, and rollback on packaged builds.
- [ ] Decide and document Linux Wayland/lock-state limitations and executable-renaming behavior in the supported-platform contract.

### Phase 12 — Growth Task Engine

**High**

- [ ] Apply migrations `0002`–`0009` in order.
- [ ] Exercise stage templates, custom tasks, ownership, cancellation, completion retries, recurrence, and credit-ledger interactions against PostgreSQL.
- [ ] Verify task pages/API on mobile and keyboard, empty/error states, export, deletion, and reward history.

### Phase 13 — Evidence System

**Critical**

- [ ] Apply migrations `0002`–`0010` in order.
- [ ] Exercise private upload/retrieval, file types/quotas, ownership, rejection/retry, review idempotency, verified rewards, wallet balance, export, and deletion.
- [ ] Verify evidence/task/credit pages and unauthorized/download-denied behavior.
- [ ] Verify the agreed evidence model: visibly labelled owner self-review for voluntary accountability; automatic rewards only from separately authenticated provider provenance and tested idempotent verification rules. Assess malware scanning for uploaded files before public uploads.
- [ ] Implement the agreed private object-storage target for evidence bytes, keeping ownership/checksums/lifecycle metadata in PostgreSQL. Migrate existing BYTEA files with checksum, export/delete, private retrieval, orphan cleanup and joint metadata/object restore tests.

### Phase 14 — Integrations

**Critical for Phase 27-required providers; Medium for optional analytics adapters**

- [ ] Implement and verify Gmail, Outlook, Google Calendar, and Microsoft Calendar provider authentication, scopes, sync, token refresh/revocation, and vendor-origin verification.
- [ ] Verify Stripe billing and separately implement provider-authenticated customer revenue evidence required by the original integrations scope. Enough's own subscription events do not prove a founder's customer payment; owner-controlled events do not establish vendor origin.
- [ ] Apply migrations `0002`–`0011` in order.
- [ ] Exercise Generic webhook/Public Event API HMAC success/failure, timestamp expiry, identical retry, conflicting event ID, rate limits, revocation races, ownership, evidence review/reward gating, export, and deletion.
- [ ] Implement PostHog, Plausible and GA4 adapters after core-loop providers at Medium priority, retaining original Phase 14 scope; Phase 0 did not remove these requirements.

### Phase 15 — AI Layer

**High; Phase 27 includes the AI Coach**

- [ ] With a development OpenAI credential, exercise success, incomplete response, refusal, timeout, and provider errors; verify local fallback.
- [ ] Apply required migrations through `0011`; exercise all capabilities, rate limits, CSRF, ownership, and task creation.
- [ ] Review data disclosure/provider terms and confirm prompts, evidence, and responses do not enter logs.
- [ ] Verify desktop/mobile, keyboard, loading/empty/error/unauthorized UI states and user consent behavior.

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
| Medium | Analytics adapters (PostHog/Plausible/GA4) remain original Phase 14 scope. | Implement after core-loop providers; do not silently defer agreed scope. |
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
