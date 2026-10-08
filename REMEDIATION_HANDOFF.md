# Remediation Handoff

Last updated: 2026-10-08   
Active plan: [REMEDIATION_IMPLEMENTATION_PLAN.md](REMEDIATION_IMPLEMENTATION_PLAN.md)  
Historical detail: [IMPLEMENTATION_HANDOFF.md](IMPLEMENTATION_HANDOFF.md)  
Current launch decision: **NO-GO**

## Objective

Close the incomplete work from Phases 1–26 in dependency order, run the required automated, database, client, security, release, and operational checks, and repeat Phase 27 only after evidence is accepted. Do not restart feature implementation that already exists in source unless verification finds a defect or a launch requirement is missing.

## Current active work

**Phase 0 complete; Phase 1 / Wave 0 environment acceptance is in progress and incomplete.** The user delegated routine engineering choices based on scaling, maintainability, security and compatibility. All seven contract documents are frozen; `PHASE_0_REVIEW.md` records decisions and tradeoffs. Establish the reproducible test environment and begin Phase 1 runtime acceptance.

Routine engineering choices proceed autonomously under this authorization. Record decisions and validate them. Ask only for missing external/business/legal facts, credentials or actions outside existing authorization. No repeated architecture preference questionnaire is needed.

### Latest work and next step

**2026-10-08 update (supersedes the older environment bullets below):** Approved execution resolved the sandbox startup/package failures. PostgreSQL 18 fixture at `127.0.0.1:55432/enough_phase1` and Redis 8.10.2 in Ubuntu WSL at port 56379 are working. All 15 migrations applied to the isolated database, checksum precheck passed, and rerun was a no-op. Web/API/worker health and readiness all returned 200 with healthy dependencies. A database transaction/least-privilege check and BullMQ worker round trip passed using `apps/api/src/phase1-smoke.ts`. The original application database was not touched.

Fixed shared package `.js` imports that Next.js could not resolve to TypeScript source; web readiness passed after explicit `.ts` imports. Adjusted PostgreSQL startup stdio to prevent inherited Windows pipe handles holding the launcher open. Frozen install, formatter, lint, typecheck, all 65 tests, extension builds and desktop source build passed after the import fix. Final checks and full evidence are in `PHASE_1_ACCEPTANCE.md`.

Git is now initialized on unborn `main` with remote `https://github.com/mignoncharly/enough.git`; `git ls-remote origin HEAD` succeeded with no refs. No identifiable source commit exists and nothing was committed or pushed. **Phase 1 remains incomplete for source provenance; do not advance the tracker yet.** Next safe action is recording a reviewed canonical snapshot/revision, followed by Phase 2 authentication runtime acceptance using only the isolated fixture environment. Services were left running for continued acceptance; check readiness before reuse. Package/runtime commands need approved execution outside this sandbox.

The following bullets are the prior 2026-10-07 record, retained for context:

- Phase 1 evidence: [PHASE_1_ACCEPTANCE.md](PHASE_1_ACCEPTANCE.md). Current tool versions: Node v24.19.0, pnpm 11.20.0, Git 2.51.0.windows.2. Workspace has no Git repository; authoritative source location requested from the user.
- Frozen installation passed. Safe source formatting/import cleanup and Biome schema/exclusion fixes made formatter and lint pass. Lint still reports 147 warnings and 12 informational diagnostics.
- Fixed OAuth nullable account handling, paginated activity rendering in Today/Growth, admin-role/currency typing, button types, label associations and extension fieldset styling. Full regression acceptance remains pending.
- Initial suite passed all 65 tests. Later reruns failed on recurring package-access `EPERM` (TypeScript and `pg`) and unresolved Fastify `ajv`; do not claim the final source passes tests or typecheck. Stop package-dependent checks until access is stable.
- Chrome/Firefox extension and desktop source builds passed; generated output rebuilt after formatting cleanup.
- Added `scripts/phase1-postgres.mjs` and ignored `.runtime/`. PostgreSQL 18 initialized a separate cluster at `.runtime/phase1/pgdata`, but startup failed with restricted-token error 87/server-start error 3. Application role/database and fixture.env are not yet provisioned. No migrations or existing database changes were made.
- Redis 3.0.504 is the only discovered local Redis; unsuitable for the worker. WSL listing was denied. A supported runtime/Redis target is needed; do not bypass version or host restrictions.
- Reserved isolated ports: PostgreSQL 55432, Redis 56379, web 3301, API 4400, worker 4401. Credentials stay under ignored `.runtime/phase1`.
- Next safe action once runtime is available: `node scripts/phase1-postgres.mjs start`; then establish supported Redis, restore stable package access and rerun the baseline checks. Apply migrations only after verifying the isolated database URL. Remain in Phase 1 until provenance, migrations and service readiness are accepted.
- Phase 0 contract decisions remain recorded in `PHASE_0_REVIEW.md`; subsequent scope is unchanged by this evidence update.

### Known environment state

- `C:\Enough` is not a Git repository and has no recorded canonical remote. No approved commit/ref can be deployed from this workspace yet.
- This workspace is Windows. A read-only probe on 2026-10-07 found ports 80, 443, 3000, 3001, 4000, 4001, 5433, and 6379 closed; web/API/worker readiness requests were unavailable.
- Earlier package operations succeeded for `pnpm install --frozen-lockfile` after the `electron-winstaller` build hook was allowlisted. Node still hit `EPERM` reading linked `pg`, TypeScript, and `dotenv` package files in migration, typecheck, and desktop packaging attempts.
- The recorded local database has only baseline migration `0001_create_enough_schema.sql`; migrations `0002`–`0015` remain unapplied. No production database or Ubuntu host is configured.
- The earlier Phase 23 record reports 65 passing unit/property/contract tests and successful extension/desktop source builds. This is historical evidence; rerun on the current commit in the supported environment. Database, browser/Electron, multi-device, load, broad security, and production integration coverage is still missing.
- Extension store archives were generated. Signed desktop installers, store publication, end-user install/update acceptance, provider credentials, Stripe pricing, production email, backup keys/remotes, and external alerting are not configured.
- Gmail, Outlook, Google Calendar, and Microsoft Calendar vendor adapters are not implemented. The Generic webhook/Public Event API authenticates an owner-controlled source and is not vendor verification.

## First execution sequence

1. Confirm the authoritative source location and create/use a clean Git checkout. Do not invent a remote or deploy ref. Preserve the current workspace as a source snapshot until the authoritative checkout is confirmed.
2. Use a supported Node/pnpm environment with readable workspace package links. Record `node --version`, `pnpm --version`, OS, commit, and whether the working tree is clean. Stop if package reads still produce `EPERM`; do not delete package stores or reset databases to work around it.
3. Provision disposable PostgreSQL and Redis instances with clearly named test databases and non-production credentials. Confirm the application `DATABASE_URL` points only at the disposable database before migrations or destructive integration tests.
4. Run the baseline source checks from the plan, in order: frozen install, formatter, linter, typecheck, unit/property/contract tests, extension build, and desktop source build. Record exact commands, versions, exit codes, and redacted logs. Resolve environmental failures separately from code failures.
5. Apply migrations `0001`–`0015` to a fresh disposable database, verify migration checksums and constraints, then start web/API/worker and confirm health/readiness plus core DB/Redis operations.
6. Work through Phases 2–22, adding tests for each uncovered failure before moving on. Use provider sandbox credentials and synthetic accounts only.
7. Complete Phases 23–26: CI/regression coverage, signed distribution and update acceptance, Ubuntu host/recovery, and the production verification matrix. Reassess the Phase 27 launch gate last.

Never point migration, restore, load, deletion, replay, or security tests at production. Never put secrets, personal data, OAuth codes, session cookies, or full webhook signatures in this handoff or evidence logs. Production changes require an explicit target, reviewed change, backup, and rollback plan.

## Test and security runbook

The root project currently defines these baseline commands:

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm extension:build
pnpm desktop:build
```

Run them from the authoritative checkout. The suite is not sufficient by itself. Add and run the following coverage in disposable environments:

- Database: fresh ordered migrations, migration checksum mismatch, migration failure recovery, ownership/constraints, transactions, concurrency, retention, export, deletion, and restore.
- API/provider: auth/CSRF/authorization, OAuth state/PKCE/replay, signed webhooks, idempotency, rate limits, revocation races, billing entitlement, provider sync, and failure/retry behavior.
- Web/browser/desktop: core journeys, accessibility/keyboard, policy parity, offline expiry, stale policy, lock/unlock, emergency exit, token revocation, native-host liveness, installer/update, and supported OS behavior.
- Security: threat-model review; IDOR/ownership, injection/XSS/SSRF, CSRF, upload handling, secret/log disclosure, rate-limit abuse, webhook replay, desktop IPC/navigation, update signatures, dependency findings, and secret scanning.
- Operations: least privilege, TLS/Nginx, external alert test, deployment/rollback, encrypted off-host backup, isolated restore, service restart, reboot recovery, and incident procedures.

Do not add an E2E/security dependency without reviewing it and committing the lockfile change. Run focused checks after each fix and the full relevant suite before phase acceptance. Record failures as defects with severity, evidence, owner, and retest; do not mark them accepted because a later unrelated build passes.

## Priority order

1. **Critical:** make the test environment usable; authenticate and authorize safely; prove migration/data integrity; test policy enforcement/offline behavior; prove credit/evidence/billing/privacy correctness; close critical/high security findings; produce signed supported releases; prove backup/recovery and integrated production flows.
2. **High:** complete all Phase 27 required user capabilities and cross-device/provider flows, accessibility for core journeys, admin controls, operational alerting, and install/update behavior.
3. **Medium:** supported-platform edge cases, representative load, degraded-provider behavior, observability detail, and UI state coverage not otherwise critical.
4. **Nice to have:** passkeys remain deferred under the original exception. PostHog/Plausible/GA4 remain Phase 14 scope at Medium priority after core-loop integrations.

The detailed phase-by-phase items and acceptance conditions are in [REMEDIATION_IMPLEMENTATION_PLAN.md](REMEDIATION_IMPLEMENTATION_PLAN.md). Do not proceed to production deployment while the critical migrations, security review, signed release, provider, backup, or Phase 26 checks remain open.

## Progress record

| Work item | Status | Evidence / next action |
| --- | --- | --- |
| Consolidate Phases 1–26 open work and risk priorities | Complete | `REMEDIATION_IMPLEMENTATION_PLAN.md` |
| Create current remediation handoff | Complete | This file |
| Prepare Phase 0 contract documents | Complete | Seven contract documents and `PHASE_0_REVIEW.md`; source comparison complete |
| Agree and freeze Phase 0 contract | Complete | User delegated decisions; `PHASE_0_REVIEW.md` records agreed targets and future implementation checks |
| Establish canonical Git checkout and supported test environment | In progress / blocked by environment | Versions/install recorded; package access remains intermittent, canonical source unknown; see `PHASE_1_ACCEPTANCE.md` |
| Apply/verify migrations and complete Phase 1 runtime acceptance | Incomplete | Isolated PG cluster initialized but cannot start; supported Redis unavailable; no migrations/readiness acceptance |
| Complete Phases 2–22 runtime/security acceptance | Pending | Follow phase checklists and retain evidence |
| Complete Phase 23–26 quality, release, production, and integration acceptance | Pending | Requires CI signing, provider sandboxes, and a configured Ubuntu host |
| Repeat Phase 27 launch gate | Pending | Current decision remains NO-GO |

## Handoff rule

At each pause, update this file with the exact phase/subtask, changed files, commands run, results, unresolved severity, and the next safe command. Update the phase tracker only when evidence meets that phase's acceptance criteria. Keep the historical handoff intact as the record of prior implementation; this file is the active remediation handoff.
