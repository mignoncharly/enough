# Phase 4 — Product and Stage Engine acceptance

Implementation evidence: 2026-10-09. Accepted: 2026-10-10.
Status: **Phase 4 formally COMPLETE — implementation, automation and P4-1–P4-5 PASS**.
Base/HEAD and recorded origin/main:
`e07f502a90aaa85a22ad2f70647b8ca9bd234a4d` on `main`.
Evidence covers the uncommitted working tree, not a new checkpoint. No commit or
push is authorized. Phase 1–3 acceptance remains closed; launch remains **NO-GO**.

Final documentation/git review: 2026-10-10. `git diff --check` passed (exit 0),
inventory and revisions remain as recorded below, and nothing is staged.
The user explicitly reported P4-1, P4-2, P4-3, P4-4 and P4-5 PASS, with no
browser acceptance failures. These are accepted user-reported results, not
assistant browser observations. No Phase 4 acceptance blocker remains.

## Canonical scope and dependencies

Read REMEDIATION_HANDOFF.md and REMEDIATION_IMPLEMENTATION_PLAN.md first, then
IMPLEMENTATION_PLAN.md, SECURITY_STATUS.md and accepted Phase 1–3 evidence.
The tracker points to ENOUGH_COMPLETE_IMPLEMENTATION_PLAN.md, Phase 4: products,
product stages, stage history, goals, metrics, recommended ratios and
stage-specific task recommendations. Its exit is: “Different stages produce
meaningfully different guidance and rules.” Existing architecture keeps stage
guidance advisory; policy enforcement belongs to subsequent phases and is not
introduced or claimed here.

Remediation adds bidirectional onboarding/profile synchronization, nine-stage
coverage, multiple products, goal status, metrics, export, ownership,
deletion/cascades, invalid input and stale writes. Dependency order: accepted
identity/onboarding → migrations 0002–0004 → product/stage/goals/metrics → sync,
export and integrity → regression/quality/build → one browser session. Current
notification and export code requires the existing later tables, so the fixture
applies all 15 migrations; this does not accept later phases. No architecture
change, new migration, dependency upgrade or unrelated refactor.

## Reconciliation and changes

The resumed workspace contained 12 modified files plus products.integration.test.ts.
TEMP held migration, before/after/final integration and quality logs. The final
integration log records 44 passes and fixture shutdown. Reviewed source timestamps
precede that run; no additional product code was changed during this continuation.
Do not count the earlier failed runs as passes, or claim the retained runs were
executed again. The last correction to the test file came after the earlier quality
checks; formatting and workspace typechecking were therefore rerun.

Implemented and verified:

- Product writes synchronize the linked onboarding answers, primary-goal title,
  traction, currency and recommendations within the same transaction. Writes take
  account then product locks, matching onboarding and preventing inconsistent
  concurrent updates.
- Completing/cancelling a primary goal clears its primary flag. Saving unchanged
  onboarding answers does not recreate a completed goal. Equivalent decimal
  revenue answers do not add duplicate observations.
- Stage/status/canonical metric endpoints accept optional expected values and
  return 409 on stale writes. The dashboard supplies them, permits primary-goal
  creation, disables product selection during saves and refreshes the stage form
  when the selected product/stage changes. Existing callers remain compatible.
  This is expected-value checking, not global versioning or an ABA-proof protocol.
- Case-insensitive duplicate product names return a useful 409; conflicting
  onboarding renames roll back all changes.
- Added 26 opt-in product integrations and a dedicated Phase 4 option in the
  existing Windows fixture. The existing 18 onboarding cases run against the
  same isolated Phase 4 services; prior fixture defaults remain intact.

## Isolation and verification evidence

Windows-first, Node v24.19.0, pnpm 11.20.0; PostgreSQL 18 and WSL Ubuntu Redis
8.10.2. No Docker, GitHub Actions or production. Fixture only:

| Resource | Target |
| --- | --- |
| Files/build/logs | `$env:TEMP/enough-phase4` |
| PostgreSQL | Loopback 55435, role/database `enough_phase4` |
| Redis | Windows loopback 56385 → WSL loopback 56386, no persistence |
| API/web | `http://127.0.0.1:4406` / `http://127.0.0.1:3304` |
| Accounts/data | Random synthetic `@example.test` users, only test-owned IDs deleted |

The runner refuses occupied ports, verifies cluster identity and Redis run ID,
blanks provider credentials, copies web source/builds to TEMP and shuts down its
owned services. Integration guards check the exact role/database/ports before
mutations. Existing `.env`, `.runtime/`, credentials, browser profiles and protected
local configuration were not read or modified. New disposable credentials remain
in TEMP and were not printed. Product deletion is a direct, owned fixture SQL test
of database cascades; this phase does not add or claim a product-delete UI/API.
Account deletion is exercised through the real authenticated API.

Logs below are relative to `$env:TEMP/enough-phase4`. Retained results are from
before the disconnect; original process exit codes were not retained separately.
PowerShell's NativeCommandError rendering of native stderr banners does not itself
mean a command failed. Fresh command results include captured exit codes.

| Command/check | Result | Evidence |
| --- | --- | --- |
| `pnpm test:products:integration` | Retained PASS: 26 product + 18 onboarding tests, 44/44, 15.33 s; shutdown recorded | `integration-final.log` |
| Fixture migration runner/precheck and live checksum/order test | Retained initial 0001–0015 application in order; final precheck PASS/no pending migrations; live source-checksum/history check PASS | `integration-before.log`, `integration-final.log` |
| `pnpm test` | Retained PASS: 68 passed, 93 opt-in skipped, 3.86 s | `unit.log` |
| `pnpm lint` | Retained PASS: 159 files, 543 ms, 124 existing warnings / one info | `lint.log` |
| `pnpm format:check` | Fresh PASS, exit 0 | `format-resume.log` |
| `pnpm typecheck` | Fresh PASS, exit 0, all applicable workspace packages | `typecheck-resume.log` |
| `node scripts/phase2-runtime.mjs prepare --phase4` | Fresh PASS, exit 0: API/proxy readiness, synthetic onboarding seed, setup-session revocation, shutdown | `manual-prepare.log` |
| Isolated `next build --webpack` | Fresh PASS, exit 0: optimized compilation, TypeScript and all 29 static pages | `web-build.log` |
| `git diff --check` | PASS before evidence edits; final check recorded below | Tool result |

Coverage includes nine distinct stages and their ratios/tasks/guidance, all stage
transitions/history and same-stage no-op, stale/concurrent stages, goals and
primaries, completion timestamps, canonical/custom metrics, stale metric/currency
checks, equivalent decimals, concurrent traction invariants, duplicate-name
rollback, multiple accounts/products, export, all mutation CSRF/auth boundaries,
invalid IDs/values, product-child cascades and account deletion/session revocation.
Phase 3's full 18-case suite also passed, including live page compilation/initial
HTML. Hydrated browser interaction is separately accepted from the user's
combined P4-1–P4-5 report below.

Accepted Phase 1–3 records and lockfile are preserved. Phase 2 auth/client code
was not changed; its protected fixture, providers and installed-client sessions
were not rerun. No fresh frozen install, dependency audit or unchanged desktop/
extension rebuild is claimed. Accepted existing evidence remains applicable to
those unchanged sources/dependencies; all open release gates remain open.

Failure record: the initial product run failed seven checks (stage advice, stale
stage writes, metric synchronization, primary synchronization, stale goal writes,
concurrent primary synchronization and duplicate-name conflict). After fixes, two
checks still failed because they expected top-level child collections;
the existing export nests stage history and metrics under each product. The assertions were corrected to
the existing contract, and the final 44 tests passed. Earlier logs are preserved
as `integration-before.log` and `integration-after.log`. Repeated sandbox startup
failures (`helper_unknown_error`) occurred before execution; approved retries
succeeded. One source read guessed `product-stages.ts`; `rg --files` confirmed
the actual singular filename. No source was changed because of that read failure.
Redis's existing WSL memory-overcommit warning remains; no host tuning changed.

Build reproduction, after the fixture has copied current web source (run in a
separate PowerShell process; all values are synthetic):

```powershell
$env:NEXT_TELEMETRY_DISABLED='1'
$env:APP_BASE_URL='https://phase4.example.test'
$env:API_BASE_URL='https://api.phase4.example.test'
$env:AUTH_SECRET='phase4-build-only-placeholder-never-deploy'
$env:RESEND_API_KEY='re_phase4_build_only_placeholder'
$env:AUTH_EMAIL_FROM='Enough <noreply@example.test>'
$env:AUTH_DEV_SHOW_EMAIL_LINKS='false'
$env:DATABASE_URL='postgresql://enough_phase4:build-only@127.0.0.1:55435/enough_phase4'
$env:REDIS_URL='redis://127.0.0.1:56385/0'
foreach ($phase4Key in @('GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID','GITHUB_CLIENT_SECRET','OPENAI_API_KEY','STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRETS','STRIPE_PRICE_MONTHLY','STRIPE_PRICE_ANNUAL')) {
  [Environment]::SetEnvironmentVariable($phase4Key,'','Process')
}
Push-Location (Join-Path $env:TEMP 'enough-phase4/web')
try {
  node C:/Enough/apps/web/node_modules/next/dist/bin/next build --webpack
} finally { Pop-Location }
```

## Consolidated browser acceptance — PASS

Accepted 2026-10-10 from the user's explicit combined report. The user reported
that the consolidated session completed successfully and no browser acceptance
failures were observed. All five checks are closed; do not reopen or repeat them.

| Check | Accepted result |
| --- | --- |
| P4-1: products, stage guidance/history, switching and reload | PASS — user report |
| P4-2: primary goal, completion/cancellation and persistence | PASS — user report |
| P4-3: metrics, onboarding synchronization and export | PASS — user report |
| P4-4: stale-tab conflict and validation feedback | PASS — user report |
| P4-5: narrow layout and keyboard usability | PASS — user report |

Browser/version and exact viewport were not supplied and are not inferred.
No additional evidence request is needed for this explicit acceptance. The
assistant did not operate a browser, inspect credentials or repeat checks.
Current fixture service state after the user's session was not reported or
rechecked; the shutdown observations below precede that session.

### Historical preparation protocol — closed; do not rerun

Browser automation was unavailable during preparation (`No browser is available`,
read-only discovery `[]`), so the session was delivered directly in chat. That
final chat checklist clarified **Workspace menu → Home → Account → Export account
data** and reused the automated same-stage retry evidence rather than asking the
user to repeat it. The earlier prepared protocol below is retained as history;
its commands and reporting directions are not current next steps.

From PowerShell in `C:\Enough`, run:

```powershell
pnpm test:products:serve
```

Wait for `Fixture serving`. The command generates a new synthetic account and
seeds **Clinic scheduling assistant** (Idea, 10 users, 2 paying, EUR 10.00).
Read its email/password locally from `$env:TEMP\enough-phase4\manual-account.json`;
do not send those values to chat. Use a private browser window, open
`http://127.0.0.1:3304/login`, sign in and open `/dashboard`.
Keep that terminal running until the entire session is done.

| Check | Actions and expected result |
| --- | --- |
| P4-1: products/stages/history | On the seeded product, confirm Idea guidance and 20% Build / 80% Customer learning. Change Stage to First revenue with reason `First paying clinics`; click **Update stage**. Expect First revenue guidance, changed priorities/tasks and 55% / 45%, plus one new history entry with that reason. Submit the same stage again: no extra history. Use **Add product** to create `Second fixture product`, customer `Design teams`, problem `Teams lose interview notes`, stage Growth, goal `Retain five teams`. Expect Growth guidance and 70% / 30%. Switch between products: stage selector, snapshot, history and goals match the selected product; refresh keeps the selected product. |
| P4-2: goal lifecycle | Select Clinic scheduling assistant. Add `Retain five clinics` with **Make this the primary goal** checked. Expect exactly one active primary. Complete it; expect completed without primary. Add `Discarded experiment` without the checkbox, then cancel it; expect cancelled. Refresh: statuses persist and neither goal becomes active/primary again. |
| P4-3: metrics/synchronization/export | On the clinic product, record `total_users` / `Total users` / `30` / `users`, then `current_revenue` / `Current revenue` / `123.45` / `USD`. Expect snapshot and metric history updated; the second product stays at its own values. **Edit onboarding answers** should show the updated stage, users, revenue/currency and next-goal text `Retain five clinics`. Save unchanged and return: the completed goal stays completed with no duplicate active goal. From **Account → Export account data**, keep the synthetic export local and confirm the two products with their nested stage history/goals/metrics and matching onboarding answers. |
| P4-4: stale tab and validation feedback | Open the clinic dashboard URL in two tabs. In tab A change stage to Growth. Without refreshing tab B, select Early users and submit: expect a useful refresh/conflict message, with no overwritten stage. Refresh B: Growth and the latest history appear. Try `paying_users` / `Paying users` / `31` / `users` while total is 30: expect a validation message and no snapshot/history mutation. |
| P4-5: usable controls/layout | With a narrow window (~390 px) and keyboard navigation, exercise the product selector, stage form, primary checkbox and metric form. Labels, focus, feedback, history and goals remain readable/usable without clipping. Restore normal width and confirm the selected product still matches its details. |

After all five checks, stop the fixture with **Ctrl+C** in its terminal and close
the private window. Report P4-1 through P4-5 together as PASS/FAIL, with a brief
description of any failure. No acceptance outcome is inferred from preparation.

## Security/release decision and git

All **18 dependency findings remain OPEN** (3 critical / 8 high / 7 moderate),
owned/gated in PHASE_2_DEPENDENCY_SECURITY.md for Phases 20/23/24. No upgrade,
lockfile mutation, suppression, release waiver or fresh clean-audit claim.
Stage guidance remains advisory; launch is **NO-GO**.

**Phase 4 is formally COMPLETE.** Implementation, automated verification and all
five browser checks are accepted. No Phase 4 blocker remains. The working tree
is ready for checkpoint commit after explicit user approval; no staging, commit
or push is authorized yet. Do not start Phase 5 as part of this closure.

Suggested checkpoint message: `fix: complete phase 4 product and stage acceptance`.

Verified final inventory: 13 modified tracked files, two untracked, nothing staged.
Branch `main`; HEAD and locally recorded origin/main match the Phase 3 checkpoint.
No fetch, staging, commit or push occurred. Exact final status/check results are
recorded below.

Final review commands/results: `git diff --check` PASS (CRLF normalization notices
only); `git diff --cached --stat` empty; `git diff --exit-code --
PHASE_1_ACCEPTANCE.md PHASE_2_ACCEPTANCE.md PHASE_2_ENGINEERING_VERIFICATION.md
PHASE_2_DEPENDENCY_SECURITY.md PHASE_3_ACCEPTANCE.md pnpm-lock.yaml` empty/PASS.
`git rev-parse HEAD origin/main` returned the checkpoint twice.
`Get-NetTCPConnection -State Listen` found no listeners on 55435/56385/4406/3304;
a WSL Python loopback bind probe confirmed 56386 free. These shutdown observations
were made after preparation/build and before the user's browser session; no
current service state is inferred from them.

```text
## main...origin/main
 M IMPLEMENTATION_PLAN.md
 M REMEDIATION_HANDOFF.md
 M REMEDIATION_IMPLEMENTATION_PLAN.md
 M SECURITY_STATUS.md
 M apps/api/src/onboarding.integration.test.ts
 M apps/api/src/onboarding.ts
 M apps/api/src/products.ts
 M apps/web/app/dashboard/page.tsx
 M apps/web/app/workspace-data.ts
 M package.json
 M scripts/phase1-postgres.mjs
 M scripts/phase2-runtime.mjs
 M scripts/phase3-manual-account.mjs
?? PHASE_4_ACCEPTANCE.md
?? apps/api/src/products.integration.test.ts
```

## Source fingerprints (SHA-256)

Captured after build/preparation; all 11 reconfirmed at closure on 2026-10-10.
No product code changed during closure.

| File | SHA-256 |
| --- | --- |
| apps/api/src/products.ts | A515ACE6175C937C6F7268D87B72917BD64D3849B62AA317881CB382A081936C |
| apps/api/src/onboarding.ts | AEE762DFB94B002173095375D94F4F17E82D6E8718128B167CF9BAF0AFE4F632 |
| apps/api/src/products.integration.test.ts | 9D411DDCAAA1F46249BBC1F8548D237807EE70F74A82FF623108AB63D88C9E49 |
| apps/api/src/onboarding.integration.test.ts | 624EF0B6645A4900ADF51E459672D7C0E5D11B00D2B30369A3AC6CFBC9B8F045 |
| apps/web/app/dashboard/page.tsx | 62CEC29721FC1BDE46827157D008F2BC47A851084EA073EB37F7E44CA341106D |
| apps/web/app/workspace-data.ts | 7BB9F9AFD0571AB699A55DC63244D47051471613F7EABAE10A5C2D0C3ED9AE42 |
| package.json | 7F62F9E6EAA99920F399ABDACB78E8F4D88904F954B1C9882BEF796B13DCD48B |
| pnpm-lock.yaml | 868BFE826636B2562127F2C6625BEE4F00D4D460C63899A92FDB99A470FF0E7F |
| scripts/phase1-postgres.mjs | 5D08E06BE975C897353DA45A7CBA766B9F11FE7ADAD794BCC8A5743F0C2C837A |
| scripts/phase2-runtime.mjs | DE6342153EF59F7C6FF410FE87A4A1C290C9E480B017FDF78C3ADB015F62E539 |
| scripts/phase3-manual-account.mjs | 52930DA25A00484E11504CAD5AC5C8776B3D77DDFED61878572E06150230154B |

## Final closure consistency review — 2026-10-10

This closure edits only the acceptance record, handoff, implementation/remediation
trackers and security status. All 11 recorded SHA-256 source/manifest/lockfile
fingerprints match. Accepted Phase 1–3 records and pnpm-lock.yaml have no diff.
The unchanged tested source does not require another formatting/lint/typecheck,
build or test run for these Markdown-only edits. Existing automated results and
the newly accepted manual results remain distinct evidence.

Commands: `Get-FileHash -Algorithm SHA256` compared with all 11 recorded anchors;
`git diff --exit-code -- PHASE_1_ACCEPTANCE.md PHASE_2_ACCEPTANCE.md
PHASE_2_ENGINEERING_VERIFICATION.md PHASE_2_DEPENDENCY_SECURITY.md
PHASE_3_ACCEPTANCE.md pnpm-lock.yaml`; `git diff --check`; `git status --short
--branch`; `git diff --cached --stat`; `git rev-parse HEAD origin/main`.
Read-only sandbox startup attempts failed with `helper_unknown_error` before
execution; approved retries succeeded. No services, accounts or browser profiles
were operated, and no manual checks were repeated.
