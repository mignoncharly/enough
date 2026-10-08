# Phase 1 — Foundation Acceptance

Status: **COMPLETE** (accepted 2026-10-08). Canonical repository: `C:\Enough`.
Verified source revision: `7e78c9d87ea993c7e95530b56dc5db9da1f8d4e7`.
`main` is synchronized with `origin/main`; the working tree was clean before these documentation updates. The initial source snapshot was pushed successfully.
Migration/checksum/idempotent rerun, all service health/readiness endpoints, database/queue smoke checks, frozen install, formatting, typecheck, 65 tests, Chrome/Firefox builds and desktop source build passed. Lint passed with **124 non-blocking warnings and one informational diagnostic**. Product launch remains **NO-GO**.
Phase 1 is closed; reopen it only for a demonstrated regression. Active work is Phase 2; no Docker, GitHub Actions or production deployment is authorized.

## Resume evidence — 2026-10-08

The checks below supersede the historical environment failures recorded later in this document. Source provenance is now accepted at the exact revision above; Phase 1 is **COMPLETE** and launch remains **NO-GO**. Earlier provenance notes below are historical.

- The workspace now has a Git repository on unborn `main` with `origin` set to `https://github.com/mignoncharly/enough.git`. An approved `git ls-remote origin HEAD` exited 0 with no refs. No commit was created or pushed.
- Approved execution outside the sandbox resolved package reads and PostgreSQL restricted-token startup. Node v24.19.0 and pnpm 11.20.0 remain in use. Ubuntu WSL is accessible and provides Redis 8.10.2.
- PostgreSQL 18 is running exclusively for this fixture at loopback port 55432. The verified database/user is `enough_phase1`; its role has no superuser, database-creation or role-creation privileges. Credentials remain under ignored `.runtime/phase1`.
- Disposable Redis runs in Ubuntu WSL on loopback port 56379 with persistence disabled. Redis reports a host memory-overcommit warning; durability and host operations are outside this disposable smoke acceptance.
- All 15 migrations applied to the fresh isolated database. A subsequent precheck verified checksums with no pending migrations, and a second migration run reported the database up to date. The original application database was not modified.
- Web health/readiness at `3301/api/health` and `3301/api/ready`, API at `4400/health` and `4400/ready`, and worker at `4401/health` and `4401/ready` returned 200. All readiness dependencies reported `ok`.
- Web compilation exposed `.js` re-exports pointing at TypeScript-only shared source. Changed shared index and policy imports to explicit `.ts`, supported by the existing `allowImportingTsExtensions` configuration. Web health/readiness passed after the fix.
- Corrected the PostgreSQL fixture startup to avoid inherited captured pipes holding the Windows launcher open. Server diagnostics remain in the fixture's `postgres.log`.
- `apps/api/src/phase1-smoke.ts` checks the isolated target before work, verifies the 15-row migration ledger and role privileges, exercises a temporary-table transaction with rollback, and sends a healthcheck through Redis/BullMQ to the live worker. Both database and queue checks passed; the test job was removed.
- Frozen installation passed. Formatting passed after normalization of 20 source files and import organization. Final lint passed with 124 warnings and one informational diagnostic. Typecheck and all 65 tests passed after the shared import fix; final typecheck also passed with the smoke script included. Chrome/Firefox extension builds and desktop source build passed.

Exact fixture commands (run from the relevant application/package directory):

```powershell
node scripts/phase1-postgres.mjs start
wsl -d Ubuntu --exec redis-server --bind 127.0.0.1 --port 56379 --save '' --appendonly no --daemonize no
# packages/db:
node --env-file=C:/Enough/.runtime/phase1/fixture.env --import tsx src/migration-precheck.ts
node --env-file=C:/Enough/.runtime/phase1/fixture.env --import tsx src/migrate.ts
# apps/api and apps/worker:
node --env-file=C:/Enough/.runtime/phase1/fixture.env --import tsx src/server.ts
# apps/web:
node --env-file=C:/Enough/.runtime/phase1/fixture.env scripts/run-next.mjs dev
# apps/api:
node --env-file=C:/Enough/.runtime/phase1/fixture.env --import tsx src/phase1-smoke.ts
```

Services were left running for continued local acceptance. They may need restarting in a new session. No production deployment, provider call, account test, signing or store acceptance was performed. Next: establish the reviewed source snapshot/revision and then start Phase 2 authentication acceptance against this fixture. Runtime readiness alone does not accept the later product phases.

## Historical evidence — 2026-10-07

Date: 2026-10-07  
Workspace: `C:\Enough` on Windows  
Status: **INCOMPLETE — environment and source provenance blockers**  
Launch decision: **NO-GO**

## Changes made

- Migrated Biome configuration to the installed 2.5.15 schema and excluded generated output, dependencies and `.runtime` fixtures. Applied safe formatting and import organization across source files; no blanket disabling of lint rules.
- Corrected OAuth row nullability and reject login if the resolved account is missing or unverified before committing the transaction.
- Fixed Today/Growth consumers to use the paginated activity response's `events` array.
- Fixed nullable admin-role access and optional currency precision typing.
- Set explicit submit/action button types, associated coach controls with labels, removed redundant unsupported ARIA, and used a styled fieldset for extension mode selection. Deduplicated coach missing-information text for stable list keys.
- Renamed a catalog action that incorrectly used a React hook name.
- Retained intentional control-character filtering with narrowly scoped lint explanations.
- Added `scripts/phase1-postgres.mjs` and ignored `.runtime/`. The fixture uses random SCRAM credentials, a loopback listener and a separate cluster; it verifies cluster identity before provisioning a non-superuser application role. It never reads the existing `.env`, deletes a cluster or runs migrations.
- Regenerated desktop and Chrome/Firefox extension output using their build scripts.

No source commit/remote exists to identify these changes. The workspace remains a source snapshot awaiting confirmation of its authoritative location.

## Recorded checks

| Command/check | Result |
| --- | --- |
| `node --version` | v24.19.0 |
| `pnpm --version` | 11.20.0 |
| `git --version` | 2.51.0.windows.2 |
| `git status --short` | No Git repository |
| `pnpm install --frozen-lockfile` | Passed; 12 workspace projects, already up to date |
| `pnpm format:check` | Passed after source cleanup |
| `pnpm lint` | Exit 0; 147 warnings and 12 informational diagnostics remain |
| Initial `pnpm typecheck` | Found OAuth error; next run reached web and exposed five further errors. Fixes applied. |
| Typecheck after fixes | Failed environmentally: `EPERM` reading TypeScript `_tsc.js`; full typecheck not accepted |
| Initial `pnpm test` | 9 files, 65 tests passed before the final fixes |
| Test rerun | 7 files passed, one failed suite and three failed tests: `pg` entry inaccessible (`EPERM`) and Fastify `ajv` resolution failed. 60 tests passed; final suite not accepted. |
| `pnpm extension:build` | Passed for Chrome and Firefox, including final fieldset styling |
| `pnpm desktop:build` | Passed; source build only, no installer/signing acceptance |
| `node scripts/phase1-postgres.mjs start` | `initdb` initialized PostgreSQL 18 fixture; `pg_ctl` startup failed: restricted token error 87, server start error 3 |
| Installed Redis | Windows Redis 3.0.504; unsuitable for current BullMQ worker |
| `wsl --list --quiet` | Access denied (`E_ACCESSDENIED`) |
| Migrations and web/API/worker readiness | Not run: prerequisites unavailable |

Earlier successful package reads do not resolve the recurring permission problem. Avoid deleting stores, relinking dependencies or bypassing process restrictions as a workaround. No database migration or destructive integration test touched the existing application database.

## Fixture and resume instructions

| Resource | Reserved target |
| --- | --- |
| PostgreSQL cluster | `.runtime/phase1/pgdata` |
| Database and application role | `enough_phase1` — provisioning pending startup |
| PostgreSQL | `127.0.0.1:55432` |
| Supported Redis | `127.0.0.1:56379`, DB 0 — not provisioned |
| Web/API/worker | `127.0.0.1:3301` / `4400` / `4401` — not started |
| Credentials | Ignored `.runtime/phase1/credentials.json` and admin password file; never copy into evidence |
| Application fixture environment | `.runtime/phase1/fixture.env` is generated only after successful provisioning |

On a runtime that permits PostgreSQL startup:

```powershell
node scripts/phase1-postgres.mjs start
node scripts/phase1-postgres.mjs status
# Stop only this isolated cluster when finished:
node scripts/phase1-postgres.mjs stop
```

The fixture assumes PostgreSQL binaries are on PATH. Unix file modes do not establish Windows ACL protection; use a private working directory and restrict credential-file access appropriately on the chosen host. Keep fixture credentials out of logs and shared artifacts. Provision supported Redis separately; do not disable BullMQ's version check. Do not load the existing `.env` for fixture acceptance. Review all inherited integration credentials before starting services; use synthetic accounts and disabled or sandbox providers.

Once package reads are stable, rerun frozen installation, formatting, lint, typecheck, tests and both builds. Then load the isolated fixture environment, verify the URL names `enough_phase1` at loopback port 55432, run the migration precheck and migration runner, rerun migration checksums, and validate the service readiness endpoints. Record the exact commands and results before checking off Phase 1. Migration functionality and adversarial tests continue in subsequent phases.

## Open defects and dependencies

| Priority | Item | Acceptance needed |
| --- | --- | --- |
| Critical | Recurring package-access failures | Stable package reads and complete passing typecheck/test rerun |
| Critical | PostgreSQL cannot start in current restricted process context | Disposable cluster starts and migrations/readiness pass |
| Critical | Supported Redis unavailable | Supported instance and worker queue/readiness checks pass |
| Critical | Canonical source provenance unknown | User confirms source location; reviewed Git checkout/snapshot and identifiable revision |
| Medium | 147 lint warnings | Address systematically in later quality/security remediation; warning-free status not claimed |
| High | Latest functional fixes not regression accepted | Tests after dependency-access recovery, including OAuth account handling and activity-page rendering |

Remain in Phase 1. Do not advance the tracker or treat the earlier test pass as acceptance of the final source state.
