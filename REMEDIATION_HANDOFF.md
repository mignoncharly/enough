# Remediation Handoff

Last updated: 2026-10-10
Active plan: [REMEDIATION_IMPLEMENTATION_PLAN.md](REMEDIATION_IMPLEMENTATION_PLAN.md)  
Historical detail: [IMPLEMENTATION_HANDOFF.md](IMPLEMENTATION_HANDOFF.md)  
Current launch decision: **NO-GO**

## Objective

Close the incomplete work from Phases 1–26 in dependency order, run the required automated, database, client, security, release, and operational checks, and repeat Phase 27 only after evidence is accepted. Do not restart feature implementation that already exists in source unless verification finds a defect or a launch requirement is missing.

## Current active work

**Phase 4 formally COMPLETE — 2026-10-10; checkpoint approval pending.**
The user explicitly reported the consolidated browser session completed
successfully: **P4-1 PASS; P4-2 PASS; P4-3 PASS; P4-4 PASS; P4-5 PASS**, with no
browser acceptance failures. These are accepted user-reported results, not
assistant observations. All five checks are closed; do not reopen or repeat them.
Accepted Phase 1–3 evidence remains unchanged. Full evidence is in
[PHASE_4_ACCEPTANCE.md](PHASE_4_ACCEPTANCE.md).

The accepted scope includes products, all nine stages and guidance/ratios/tasks,
history, goals, metrics, onboarding synchronization, export, ownership,
deletion/cascades and stale/invalid updates. Prior 44 integration checks (26 product
and 18 onboarding), 68 default tests, quality checks and optimized web build remain
valid. Closure fingerprint verification confirms all 11 source/manifest/lockfile
anchors match. Accepted Phase 1–3 records and the lockfile have no diff. This is
a documentation-only closure; no further formatting/lint/typecheck/test/build
run is needed for unchanged tested source. Final commands/results are recorded
in the acceptance record. Sandbox startup failures required approved retries.

No Phase 4 blocker remains. **Next safe action: wait for explicit Phase 4
checkpoint approval before any staging, commit or push.** Suggested message:
`fix: complete phase 4 product and stage acceptance`. Do not start Phase 5 here.
HEAD and recorded origin/main remain `e07f502a90aaa85a22ad2f70647b8ca9bd234a4d`
on `main`; inventory is 13 modified tracked files and two untracked, nothing
staged. All 15 paths to commit are listed in the acceptance record. No credentials,
protected configuration/runtime or browser profiles were read or modified.
Current fixture service state after the user's session is not inferred or changed.

All **18 dependency-security findings remain OPEN** at their existing release
gates (3 critical / 8 high / 7 moderate); no upgrade, suppression, waiver or
production action. Production launch remains **NO-GO**.

### Historical Phase 4 implementation pass (superseded by closure above)

**Phase 4 resume reconciliation and implementation pass — 2026-10-09:**
Implementation and automated verification are complete; **Phase 4 remains ACTIVE**
until one consolidated browser session is accepted. See
[PHASE_4_ACCEPTANCE.md](PHASE_4_ACCEPTANCE.md) for scope, commands, failures,
retained/fresh evidence, source fingerprints and the P4-1–P4-5 session.

Final continuation check, 2026-10-10: `git diff --check` PASS (exit 0),
status/inventory unchanged, index empty, HEAD and recorded origin/main still
match the Phase 3 checkpoint. No new manual acceptance report has arrived;
P4-1–P4-5 remain pending. No further implementation change or test rerun was needed.

The disconnect left 12 modified tracked files and the new product integration
suite. Inspection found the completed 44-test integration log (26 product + 18
onboarding, 15.33 s), earlier 68-test default-suite PASS and quality logs. Source
timestamps precede the final integration run; no source changes were needed in
this resume. The earlier runs and their failures are recorded as retained
evidence, not newly executed tests. Final test corrections postdated the earlier
format/typecheck logs, so those two checks were rerun and passed (exit 0).
The new isolated optimized web build passed (exit 0, all 29 static pages).
`node scripts/phase2-runtime.mjs prepare --phase4` passed (exit 0), creating only
a synthetic TEMP account/product and revoking its setup session before shutdown.
No existing credentials were read or printed.

Scope fixes already present and reviewed: transactional product-to-onboarding
metric/primary-goal/recommendation synchronization; completed-goal preservation;
stale stage/status/metric checks sent by the dashboard; duplicate-name conflicts;
equivalent-decimal observation deduplication; primary-goal UI and stage-selector
refresh. All nine stages, history, guidance/ratios/tasks, multiple products,
export, ownership, atomic validation, concurrency and deletion/cascades have
automated coverage. Phase 1–3 accepted behavior/records are preserved.

No implementation or provider blocker remains. Browser runtime setup reported
`No browser is available`; documented read-only discovery returned `[]`. No UI,
browser profile or client was touched. The only acceptance gap is P4-1–P4-5,
delivered as ONE session after automation. No repeated Phase 1–3 manual checks.
**Next safe action:** run `pnpm test:products:serve` and follow that consolidated
session, then record the combined results. Do not mark Phase 4 complete before
acceptance evidence; do not commit or push until explicit checkpoint approval.

HEAD and recorded origin/main remain `e07f502a90aaa85a22ad2f70647b8ca9bd234a4d`
on `main`. The working tree is deliberately uncommitted; exact inventory is in
the acceptance record. No staging, commit, push, dependency change or production
action. All 18 dependency findings remain OPEN; launch remains NO-GO.
Final `git diff --check` passed; accepted Phase 1–3 records and lockfile have no
diff, and the index is empty. Inventory: 13 tracked modifications and two new
files. Fresh shutdown check found no Windows listeners on 55435/56385/4406/3304;
a WSL bind probe confirmed Redis 56386 free. All fixture services are stopped.
Repeated `helper_unknown_error` sandbox startup failures were resolved by
approved retries. These were execution-environment failures before commands ran.

### Phase 4 initial activation (superseded by the resume result above)

**Phase 4 ACTIVE — 2026-10-09.** Phase 3 is accepted and checkpointed at
`e07f502a90aaa85a22ad2f70647b8ca9bd234a4d`; initial inspection confirms clean
`main` and matching recorded `origin/main`. This supersedes historical Phase 3
checkpoint-pending directions below. Phase 1–3 acceptance remains closed.

Scope and order follow the Phase 4 remediation checklist: products, all nine
stages/history, goals/status/primary goals, metrics, ratios/task guidance,
onboarding synchronization, export, ownership, deletion/cascades and invalid/stale
updates. Existing source is being verified, not restarted. No architecture or
policy-enforcement expansion. No external blocker found; source review identifies
missing product-to-onboarding metric/primary-goal synchronization for regression
verification. A dedicated TEMP/enough-phase4 fixture will use PostgreSQL 55435,
Redis 56385/WSL 56386, API 4406 and web 3304. Protected configuration, `.runtime/`,
credentials and profiles are not test targets. Windows-first, no Docker,
GitHub Actions, production or unrelated dependency updates. All 18 findings
remain OPEN and launch NO-GO. One consolidated browser session follows completed
implementation/automation. Do not commit or push without Phase 4 approval.

### Historical Phase 3 closure and checkpoint preparation

**Phase 3 formally COMPLETE — 2026-10-09.** The user reported the consolidated
browser session completed successfully, with no acceptance failures:
**P3-1 PASS; P3-2 PASS; P3-3 PASS; P3-4 PASS; P3-5 PASS; P3-6 PASS.** These are
accepted user-reported results, not assistant browser observations. All six checks
are closed; do not reopen or repeat them. Phase 1/2 accepted evidence is preserved.
The user previously closed Phase 2 and authorized Phase 3. Verified clean `main`,
HEAD and recorded `origin/main` at
`fd9bc2467bf4daeca9e80e1287029310d4ee2f7c` before edits. This supersedes all
historical review/commit/Phase 3 hold directions below. Do not commit or push
Phase 3 until the user explicitly approves its checkpoint.

Read the current remediation guides first, implementation tracker, canonical
Phase 3 scope, Phase 2 acceptance/engineering/dependency-security records and
security status. Existing onboarding source is present; no feature restart.
Scope: ten answers, save/reload/edit/export, nine-stage recommendations,
configured dashboard, authenticated ownership and validation. Existing canonical
product linkage requires migration 0004; full current migrations support account
export. These dependencies do not close Phase 4 or later acceptance.

Verification uses a dedicated Phase 3 fixture under OS TEMP/enough-phase3,
PostgreSQL 55434, Redis relay 56383/WSL 56384, API 4404, web 3303. Existing `.env`,
`.runtime/`, credentials and browser profiles are not read or changed. Reuses
Windows-first fixture code with an explicit Phase 3 option; no Docker, CI or
production. Synthetic fixture credentials are newly generated only under TEMP.
Sandbox startup repeatedly failed with `helper_unknown_error`; approved retries
succeeded. Resume inspection found the prior source changes and migrated TEMP
fixture, but no retained integration-result log. Do not infer that the prior
attempt passed. Fresh `pnpm test:onboarding:integration` passed 18/18 checks
(22.73 s, exit 0), with migrations/checksums verified and fixture shutdown.
Fresh default suite passed 68 tests (67 opt-in skipped, 5.19 s); formatting,
lint (124 existing warnings / 1 info) and workspace typecheck passed. The isolated
optimized web build passed with synthetic build-only configuration, after the
first attempt correctly failed production-environment validation. Manual fixture
preparation passed (exit 0), created only a synthetic TEMP account, and stopped
its services. Full commands, failures, logs, source hashes and the single browser
session are in `PHASE_3_ACCEPTANCE.md`. `git diff --check` passed.

All 18 dependency findings remain OPEN at their Phase 20/23/24 gates. No
dependency upgrade, lockfile mutation, suppression or release waiver. Production
launch remains **NO-GO**; Phase 3 completion does not close any release obligation.

**Next safe action:** wait for explicit user Phase 3 checkpoint approval before
commit/push. Implementation, automated verification and P3-1–P3-6 browser
acceptance are complete; no Phase 3 blocker remains. Do not repeat Phase 2
provider/installed-client or Phase 3 manual acceptance. Phase 4 is not started
by this closure. Suggested checkpoint message:
`fix: complete phase 3 onboarding acceptance`.
HEAD and recorded origin/main still match `fd9bc2467bf4daeca9e80e1287029310d4ee2f7c`.
Working tree: 11 modified tracked files, 3 untracked; nothing staged. Exact
inventory is in the acceptance record. Protected runtime/configuration and
existing browser profiles were untouched. At the end of automated preparation,
fixture services were stopped. That shutdown check found zero listeners via
`Get-NetTCPConnection -State Listen`
on 55434/56383/4404/3303; a WSL loopback bind probe confirmed 56384 is free.
Final `git diff --check` and status/revision reads passed; no staged changes.
These service observations precede the user's browser session; current service
state is not inferred or changed during closure. Final closure is documentation
only: all nine recorded source/lockfile hashes match; package changes remain only
the two previously tested onboarding scripts. `git diff --check` PASS (exit 0);
Phase 1/2 acceptance/security evidence and lockfile diff are empty; current
trackers consistently record COMPLETE. No formatting/lint/typecheck rerun was
needed for Markdown-only closure with unchanged tested source/configuration.
Commands/results are in `PHASE_3_ACCEPTANCE.md`. Sandbox helper startup failures
were resolved by approved retries; no manual checks were repeated. The complete
14-file working tree is ready for checkpoint commit after explicit user approval.

### Historical Phase 2 record (superseded by the current Phase 3 state above)

**Phases 0 and 1 COMPLETE; Phase 2 PASS after final engineering review.** Phase 1 accepted at `7e78c9d87ea993c7e95530b56dc5db9da1f8d4e7`. Phase 2 evidence covers the tested uncommitted working tree over `0b3df3a65ffef936409cc03c7493923f92a61b9c`; HEAD and locally recorded origin/main still match. Phase 3 is technically ready after the user's final review and has not begun. Launch remains **NO-GO**. Do not reopen accepted installed-client or provider tests.

Canonical repository: `C:\Enough`; Windows development, no Docker, no GitHub Actions, no production deployment. Preserve architecture and passing functionality. Phase 2 scope and exits are defined by `IMPLEMENTATION_PLAN.md` and `ENOUGH_COMPLETE_IMPLEMENTATION_PLAN.md`.

Routine engineering choices proceed autonomously under this authorization. Record decisions and validate them. Ask only for missing external/business/legal facts, credentials or actions outside existing authorization. No repeated architecture preference questionnaire is needed.

### Latest work and next step

**Final Phase 2 review — 2026-10-09: PASS; no true Phase 2 blockers.**
Desktop D1–D3, Chrome E1–E3, Firefox E1–E3 and real Google/GitHub happy paths are
accepted from user reports. Fresh automated checks: **49/49 integration PASS**
(18.93 s), **68 default PASS / 49 opt-in skipped** (6.38 s), workspace typecheck,
format and lint PASS; existing 124 lint warnings / one info remain. The three
new checks cover identity-disconnect ownership/CSRF/last-method concurrency,
concurrent OAuth exchange replay and hostile origins/bearer impersonation through
the real web proxy. Prior client builds and frozen install remain valid for their
unchanged sources/dependencies. Limited current-file credential scan: 236 files,
six recognizable secret patterns, zero matches; no history/entropy claim.

Fresh dependency audit: **18 OPEN (3 critical / 8 high / 7 moderate)**; production
filter: 12 optional native-install tar findings (1 critical / 8 high / 3 moderate).
Drizzle 0.45.2 remains fixed. Disposition is complete, remediation is not. No
reviewed Phase 2 auth exposure was found; the native installer, test-runner,
schema-tooling and packaging findings remain owned and gated in
`PHASE_2_DEPENDENCY_SECURITY.md` for Phases 20/23/24. They block security/release
acceptance, not local Phase 3 onboarding work. No audit suppression, blind major
override, new dependency change or launch waiver was made.

The existing disposable Phase 2 fixture was verified by process/listener and
target guards, then reused only for random synthetic test accounts via
`node scripts/phase2-auth-tests.mjs`. No service restart, global reset, manual
account mutation, installed-client action, real provider request or production
operation. Fixture services remain running on 55433/56381/4402/3302 with the same
PIDs. The root `.env` and original application runtime were not test targets.
Full commands, retained logs, source hashes and two new-test assertion failures
(48/49 before matching the existing HTTP 400 contract) are documented in
`PHASE_2_ENGINEERING_VERIFICATION.md`.

**Next safe action:** review this final acceptance and commit the complete
Phase 2 working-tree set below. Suggested commit title:
`fix: complete phase 2 authentication acceptance`. Phase 3 remains on hold for
the user's final review; no Phase 3 implementation was started. No commit, push
or staging was performed. All older pending/manual-session directions below
are historical and superseded.

Commit inventory (all 20 files; 15 modified, 5 new):

- Evidence/trackers: `IMPLEMENTATION_PLAN.md`, `PHASE_2_ACCEPTANCE.md`,
  `PHASE_2_DEPENDENCY_SECURITY.md` (new), `PHASE_2_ENGINEERING_VERIFICATION.md`
  (new), `REMEDIATION_HANDOFF.md`, `REMEDIATION_IMPLEMENTATION_PLAN.md`,
  `SECURITY_STATUS.md`.
- Product fixes: `apps/desktop/src/main.mjs`, `packages/auth/src/oauth.ts`.
- Regression coverage: `apps/api/src/auth-http.integration.test.ts`,
  `packages/auth/src/auth.integration.test.ts`,
  `packages/auth/src/client-auth.integration.test.ts` (new), `vitest.config.ts`.
- Repeatable disposable fixtures: `scripts/phase1-postgres.mjs`,
  `scripts/phase2-auth-tests.mjs`, `scripts/phase2-manual-account.mjs` (new),
  `scripts/phase2-runtime.mjs` (new), `package.json`.
- Reviewed Drizzle fix: `packages/db/package.json`, `pnpm-lock.yaml`.

Keep `.env`, `.runtime/`, credentials, browser profiles, raw logs, generated
client bundles and `node_modules` out of the commit. The complete inventory
includes earlier uncommitted engineering work preserved in this continuation.

**Installed-client acceptance COMPLETE — explicit user report, 2026-10-09:**
Desktop D1–D3, Chrome E1–E3 and Firefox E1–E3 are PASS. Firefox passed token
sign-in, disposable identity, policy sync, popup/reload persistence, persisted
sign-out, server logout revocation, password re-login, remote revocation clearing
authentication, recovery and web-account continuity. Do not request duplicate
installed-client tests. Firefox signed-install/full-restart behavior belongs to
Phase 24 distribution acceptance; the latest user report closes Phase 2 manual
scope without claiming that unperformed check. Prior Google/GitHub evidence
remains accepted. All older manual-pending and next-session instructions below
are superseded. Final automated/engineering and dependency-security review is
complete above; Phase 3 remains on hold for the user review. Launch remains NO-GO.

**D1 desktop password sign-in PASS — explicit user report, 2026-10-09:**
The Enough Desktop App successfully signed in with the verified disposable account
from `.runtime/phase2/manual-account.json` against `http://127.0.0.1:4402`.
It showed Connected, the matching disposable account, loaded workspace and no
authentication error. No products yet appeared as expected. D1 is accepted;
D2 persistence/logout/re-login and D3 revocation/recovery remain accepted. Do not
repeat desktop checks. This supersedes earlier D1 pending statements. Desktop's
last reported state is connected to the fixture; no logout or later state inferred.

Next: only remaining Chrome/Firefox E1–E3 steps in the consolidated session in
`PHASE_2_ACCEPTANCE.md`. Do not infer installed extensions or their origins from
the D1 report; install first, then obtain origins. Reuse the current disposable
session where possible; do not restart services/create accounts merely to repeat
desktop acceptance. Firefox full restart acceptance remains pending under the
temporary-install limitation. **Phase 2 PARTIAL; Phase 3 on hold; launch NO-GO.**

Recording commands/results: initial sandbox read failed before execution with
`helper_unknown_error`; approved UTF-8 handoff/plan/acceptance reads and
`git status --short` succeeded. Updated only this handoff, the acceptance record
and the remediation plan's D1 checkbox. Preserved existing source changes.
No credentials read, clients operated, services restarted or tests run; this is
user-performed manual evidence, not assistant observation. Documentation
validation: `git diff --check` PASS, exit 0; existing CRLF normalization warnings only.

**Consolidated manual session prepared — 2026-10-09:** The user's latest
instruction supersedes waiting for origins: install both extensions first, then
read the browser-generated origins and start one disposable fixture session.
The complete click/run/expected-result/report sequence is now in
`PHASE_2_ACCEPTANCE.md` under **One compact installed-client session**. Desktop
requires only D1 password sign-in and identity/workspace; D2/D3 remain accepted.
Chrome and Firefox each exercise token sign-in, permission/sync, persistence,
logout with server confirmation, password re-login and one remote session
revocation/recovery. Use separate tokens so Chrome logout cannot invalidate
Firefox. No extra web acceptance or Phase 3 onboarding is requested.

Read current built manifests/UI and source handlers: both builds are 0.1.0;
Chrome folder `apps/extension/dist/chrome`, Firefox folder
`apps/extension/dist/firefox`. Firefox's fixed add-on ID `enough@example.com`
is distinct from its generated Internal UUID/CORS origin. Official Chrome and
Mozilla documentation checked for install/profile/origin behavior. Firefox
temporary installation cannot establish ordinary browser-restart persistence;
the session records popup/reload persistence and explicitly leaves full restart
acceptance pending for a persistent signed install. No acceptance criterion is
silently waived. Phase 2 PARTIAL; Phase 3 on hold; launch NO-GO.

Commands/results: UTF-8 reads and `rg` inspected acceptance/handoff, extension
manifests/options/popup/background and web account/session controls plus desktop
sign-in labels; `git status --short` confirmed existing changes. Sandbox startup
failures required approved read-only retries. Initial reads incorrectly assumed
HTML files under `apps/extension/src` and a web `/account` source path; those
failed and were corrected to the built HTML/root extension files and
`apps/web/app/auth-panel.tsx` using `rg --files`. Documentation only in this
continuation: acceptance checklist and handoff; no builds/tests, services,
accounts, installs, origins requests, production changes or source edits.
Next safe action is user installation from the two existing build folders,
followed by the single documented fixture command after origins exist.
Documentation validation: `git diff --check` PASS (exit 0; existing CRLF
normalization warnings only). No manual result has been accepted by preparation.

**Resume reconciliation — 2026-10-09:** Read this handoff and the remediation
plan first, then checked Git status/history/diffs, Phase 2 acceptance and engineering
records, fixture scripts, retained logs and Windows listeners. HEAD is still
`0b3df3a65ffef936409cc03c7493923f92a61b9c`; the same uncommitted engineering
changes and desktop updater fix remain. No additional completed client acceptance
or newer committed revision was found. Retained logs substantiate the previously
recorded 46 integration passes, 68 unit passes / 46 skipped, typecheck, extension
builds and successful manual preparation/shutdown. These are inspected historical
results, not fresh test executions. Do not repeat them merely to resume.

The next open item remains the compact D1 / E1–E3 installed-client session.
Attempted Computer Use initialization and `sky.list_apps()`; it failed before
any UI action with **native pipe unavailable, Windows os error 2**. No client
was launched or manipulated. Requested any client results completed since the
handoff, or the exact installed extension origins from separate test profiles.
Those results/origins are still needed; do not fabricate CORS origins or mark
manual checks passed. Once origins are known, the next safe command is
`pnpm test:auth:serve '<exact-installed-origins>'`, followed by the compact
session in `PHASE_2_ACCEPTANCE.md`. Preparation already passed; no new account
or fixture startup was performed during this reconciliation.

Commands/results: sandbox reads intermittently failed before execution with
`helper_unknown_error`; approved read-only retries succeeded. `git status --short`,
`git log -4 --oneline`, `git diff --stat`, focused `git diff`, `rg --files`, UTF-8
document/log reads, `Get-ChildItem`, `Get-Item`, `Get-FileHash` and
`git rev-parse HEAD` succeeded. `git check-ignore .runtime/phase2/manual-account.json`
confirmed the credential file is ignored; its contents were not printed.
`Get-NetTCPConnection -State Listen` showed original loopback listeners
55432/56379/4400/3301 and no Windows fixture listeners 55433/56381/4402/3302.
This is a Windows listener observation, not a fresh WSL Redis or readiness probe.
No services, accounts, dependencies, source code or production data were changed.

Filled the missing final preparation/build appendix in
`PHASE_2_ENGINEERING_VERIFICATION.md` with retained-log evidence and current
artifact/log fingerprints. Initial `git diff --check` reported trailing whitespace
on remediation-plan line 3; removed it. Changes in this continuation are limited
to that whitespace fix, this handoff and the engineering evidence appendix.
Final documentation validation: `git diff --check` PASS (exit 0; CRLF
normalization warnings only); targeted `rg -n` readback PASS; `git status --short`
confirms the pre-existing engineering changes remain, with no new source edits.
**Phase 2 PARTIAL; Phase 3 on hold; launch NO-GO.** Eighteen dependency findings
remain open; triage is not remediation or a release waiver.

**Current instruction and result — revised Phase 2 plan, 2026-10-09:** The user's
consolidated review supersedes the manual pause and extended manual tables below.
Manual acceptance is now only D1 verified disposable password desktop sign-in and
installed extension E1–E3 (including one remote-revocation/recovery path). D2/D3 and
real Google/GitHub successful login/logout/re-login remain accepted. Invalid
credentials, renewal, signup/email/password/magic-link internals, deletion/session
invalidation and OAuth negative/identity cases are automated engineering work.
No additional web happy-path request. **Phase 2 PARTIAL; Phase 3 explicitly on
hold; launch NO-GO.** Current details: `PHASE_2_ENGINEERING_VERIFICATION.md`,
`PHASE_2_DEPENDENCY_SECURITY.md` and the current section of `PHASE_2_ACCEPTANCE.md`.

Workspace reconciliation found unrecorded isolation changes already present in
the fixture scripts, tests and Vitest config, plus `.runtime/phase2` data. These
were inspected rather than assumed successful. Initial Windows-to-WSL Redis
startup failed before testing; a fixture-owned loopback relay now connects Windows
56381 to WSL 56382 and checks Redis run ID. Separate PostgreSQL 55433 / database
`enough_phase2`, API 4402 and copied web 3302 with its own `.next` are operational.
`pnpm test:auth:integration` starts/verifies/tests/stops this fixture automatically;
it refuses occupied fixture ports. It does not use root `.env` or the active account.
No active service restart, production, Docker, CI, flush or destructive reset.

**Fresh engineering evidence:** all original 34 integrations reran successfully;
expanded suite **46/46 PASS** (34.22 s), including ten OAuth and two actual-client
handler tests. The initial new OAuth regressions exposed an unverified
preregistration password surviving provider verification (200 instead of 401 for
both providers). Fixed `packages/auth/src/oauth.ts` to clear that unverified
password and invalidate pending credentials under the existing transaction lock;
verified passwords remain valid. Legitimate OAuth exchange still passes. Client
tests verify bad-credential rejection, renewal continuity/persistence, old-token
rejection and remote-revocation clearing with memory-only platform adapters.
One initial extension test assertion expected a return where the correct handler
throws; corrected the test, no extension source change. Unit suite 68 PASS / 46
intentionally skipped; integration evidence recorded separately. Formatting PASS;
lint PASS with unchanged 124 warnings / 1 info; workspace typecheck PASS after
repairing ignored web TypeScript launcher paths and the test adapter types.
Desktop and Chrome/Firefox builds PASS. Exact command/results and failures are
recorded in `PHASE_2_ENGINEERING_VERIFICATION.md`; logs stay in `.runtime/phase2`.

**Dependency disposition:** all 19 original package/advisory entries reviewed for
direct/transitive path, affected surface, Enough reachability, available patch,
upgrade risk and action. Applied only Drizzle 0.44.7 → pinned 0.45.2; install and
frozen install with lifecycle scripts disabled PASS, and lockfile changes only
Drizzle. Fresh audit **18 OPEN: 3 critical, 8 high, 7 moderate**, exit 1. Tar's
native-install chain and Vitest/tinypool require coordinated major/backport
verification; no blind overrides. sprintf-js's registry-proposed 1.1.4 is not
published. Detailed per-entry report retains registry severity and does not equate
dependency presence with a proven application exploit or waive release risk.

**Next safe action:** the one compact installed-client session at the top of
`PHASE_2_ACCEPTANCE.md`. `pnpm test:auth:serve '<exact-extension-origins>'` starts
only the isolated fixture and prepares a new verified disposable account/token in
ignored `.runtime/phase2/manual-account.json`. Preparation was executed and passed
without printing credentials; services were then stopped. Use a separate browser
profile because cookies do not isolate localhost ports. No manual acceptance is
claimed. Before pausing, Windows listener inspection showed only the original
55432/56379/4400/3301 services, not fixture listeners. Source remains uncommitted
on `0b3df3a`; do not imply an accepted new revision or reopen completed phases.

Changed engineering files: `scripts/phase2-runtime.mjs`, `phase2-manual-account.mjs`,
`phase2-auth-tests.mjs`, `phase1-postgres.mjs`, auth integration/client tests,
HTTP integration test, OAuth implementation, Vitest config, root/package-db
manifests and lockfile. Documentation: this handoff, remediation plan, Phase 2
acceptance, engineering verification and dependency disposition. The pre-existing
desktop updater change is preserved. Historical entries below are retained as
history; conflicting pause/next-step statements are superseded by this update.

**Current instruction — manual acceptance paused for review, 2026-10-09:** D3 remains **PASS** with its accepted recovery reference intact. D1 email/password manual verification is **PENDING**; do not start it, create another disposable account, or request further manual tests. This instruction supersedes all earlier next-step prompts below. Preserve the last reported state: desktop signed out, current web session active. Automated verification completed without launching clients, changing accounts, restarting services or changing configuration/dependencies. **Phase 2 PARTIAL; Phase 3 on hold until the user's consolidated review; launch NO-GO.** Next action is review of the [consolidated remaining manual checks](PHASE_2_ACCEPTANCE.md#consolidated-manual-phase-2-review), not execution of another manual check.

**Fresh automated verification — 2026-10-09:** Windows, Node `v24.19.0`, pnpm `11.20.0`, HEAD `0b3df3a65ffef936409cc03c7493923f92a61b9c` plus the existing desktop updater import fix. `pnpm format:check` PASS (148 files, 1.030 s); `pnpm lint` PASS (153 files, 1.069 s; existing 124 warnings and 1 info); `pnpm typecheck` PASS across applicable workspace packages; `$env:ENOUGH_PHASE2_INTEGRATION = '0'; pnpm test` PASS (68 passed, 34 skipped, Vitest 5.69 s); `pnpm desktop:build` PASS (3.52 s command wall time); `pnpm extension:build` PASS (Chrome/Firefox, 3.72 s command wall time). Each command exited 0. Integration disabling applied only to the test subprocess environment. No manual check is inferred from these results.

**Dependency audit OPEN — engineering owner, recorded 2026-10-09:** `pnpm audit --json` exited 1 (1.99 s), reporting 19 advisories: 3 critical, 9 high, 7 moderate. Critical findings affect optional transitive `tar@6.2.1` under `get-windows` and development `tinypool@1.1.1` under Vitest; high findings also include `drizzle-orm@0.44.7`. Details and advisory references are in the acceptance record. These are registry findings, not demonstrated application exploits; reachability/remediation remain open. No dependency or lockfile mutation was made under the preserve-state instruction. Do not call the overall verification/security status clean.

The 34 mutating PostgreSQL/Redis/live-HTTP auth tests were **not rerun**: the existing runner uses fixed fixture URLs overlapping the active manual runtime, expects disabled OAuth providers, and creates/deletes synthetic accounts. Running it would conflict with preserving state and not creating accounts. Historical 34-test evidence remains dated 2026-10-08. No install, migration, database precheck, web build into the active `.next` directory, app launch or provider test was run.

Automated-review command record: initial sandbox inspection failed before execution (`helper_unknown_error`); approved reads succeeded. Read current handoff/plan/acceptance, root/client package scripts, `scripts/phase2-auth-tests.mjs`, integration opt-in guards, client build scripts, Biome/workspace config and `apps/web/AGENTS.md`. `rg --files -g AGENTS.md` found only that web instruction file. Search for an existing secret/security/audit script found none (exit 1, no matching files). `node --version`, `pnpm --version`, `git rev-parse HEAD`, `git status --short`, `git diff --stat`, `git check-ignore .env`, and `Get-FileHash` succeeded. Post-check status still listed only the pre-existing desktop source modification and two acceptance/handoff documents. Only those two documents were edited in this continuation; generated client artifacts were rebuilt at ignored paths. Full results, artifact hashes and the grouped review list are in `PHASE_2_ACCEPTANCE.md`.

Automated-review documentation validation: `git diff --check` PASS (exit 0; existing CRLF-to-LF normalization warning only). Targeted `rg -n` confirmed the pause, D1 PENDING, D3 PASS, audit result and consolidated review section. Final `git status --short` lists only `REMEDIATION_HANDOFF.md`, `PHASE_2_ACCEPTANCE.md` and the pre-existing `apps/desktop/src/main.mjs` modification. No new source/dependency changes; no manual acceptance performed. Await the user's scope review.

**Current desktop acceptance update — 2026-10-08:** desktop token authentication **PASS by explicit user report**. The user entered `http://127.0.0.1:4400`, created a Desktop token in the web account, connected successfully, saw **Connected** and confirmed the correct account. The workspace loaded, active application detection worked, and no authentication error was visible. The account shows **No products yet**. Personal email and token values are omitted from this record. Launch acceptance already passed; do not repeat it or the updater remediation. This result does not establish password login, persistence, sign-out, revocation, full application-monitoring acceptance, or Phase 3 onboarding.

**API address decision: A — manual entry for this Phase 2 acceptance.** The Phase 2 contract requires desktop authentication and revocation; it does not require desktop development to inherit `API_BASE_URL`. Inspection confirms `apps/desktop/src/main.mjs:48` initializes `apiBaseUrl` to an empty string; `renderer/index.html:20` shows `http://127.0.0.1:4000` only as a placeholder; `renderer/app.js:61` restores saved state or preserves the actual input, and `:173` / `:182` submit the actual input value. Both login handlers normalize that supplied value. An untouched fresh field is empty and fails with `Enter a valid API origin.` Neither the desktop start/build scripts nor its main process read `API_BASE_URL` or load the root `.env`. No default-inheritance requirement was found, so no product code change is needed for this acceptance step.

**D2 session persistence PASS — subsequent user report, 2026-10-08:** the user quit Enough from the Windows system tray, restarted with `pnpm desktop:start`, and returned to **Connected** with the same account and workspace without re-entering the API address or token. Accept persistence on this manual evidence; do not repeat this completed check. Sign-out, server-side session invalidation and subsequent sign-in have not yet been accepted.

**D2 sign-out persistence PASS — recorded 2026-10-09 from the user's explicit manual report:** after signing out, quitting Enough from the Windows tray and restarting with `pnpm desktop:start`, the desktop remained signed out and showed **Not connected / the sign-in screen**. This accepts local sign-out persistence only. Server-side session invalidation and subsequent legitimate sign-in remain pending; do not repeat the completed persistence checks.

**D2 server-side session revocation PASS — user report, 2026-10-09:** after desktop sign-out and web **Sessions and devices → Refresh**, the tested desktop session showed **Revoked**. The registered desktop device remained listed separately with **Revoke device**; the user did not click it and did not create a new token. This accepts the server-side logout result and D1's explicit session/device listing evidence. The user-supplied device name is omitted from this record. Earlier pending statements for logout invalidation are superseded by this result; D2 still requires legitimate re-login. D3 remote session/device revocation is distinct and remains untested.

**D2 reconnect after sign-out PASS — user report, 2026-10-09:** the user created a fresh Desktop token named `desktop-relogin-test`, entered API address `http://127.0.0.1:4400`, and connected successfully. Desktop returned to **Connected** with the same account and workspace, without an authentication error. The user left it connected. **D2 COMPLETE** on the accumulated manual evidence: session persistence, sign-out persistence, server-side logout revocation and subsequent legitimate sign-in all passed. This supersedes earlier pending D2 statements above. D1's password path and D3 remote revocation remain open; Phase 2 remains PARTIAL.

**D3 remote session revocation PASS — user report, 2026-10-09:** after revoking the active `desktop-relogin-test` session in the Enough Web App, the desktop returned to **Not connected / sign-in** when syncing policy and showed **Authentication required**. The web account remained usable after **Refresh**. Accept remote session revocation and unrelated web-session continuity on this explicit manual evidence; do not repeat them. This supersedes the pending session-revocation statements above. Recovery and the separate device-revocation case remain untested, so D3 remains PARTIAL.

**D3 recovery after remote session revocation PASS — user report, 2026-10-09:** using a fresh Desktop token named `desktop-device-revoke-test` and API address `http://127.0.0.1:4400`, the desktop reconnected successfully, displayed **Connected**, the same account and workspace, and no authentication errors. The user left it connected for the device-revocation test. This supersedes the earlier pending recovery status; do not repeat accepted session revocation or recovery. D3 remains PARTIAL pending the separate device-revocation case and recovery afterward.

**D3 remote device revocation PASS — user report, 2026-10-09:** the web app shows the `desktop-device-revoke-test` session as **Revoked** and its registered device as **desktop · revoked**. Desktop is **Not connected** and was left signed out. The web app remains usable with the current web session still active. This accepts device/session revocation, desktop disconnection and unrelated web-session continuity. No exact desktop error or manual-versus-automatic sync timing was reported; neither is inferred. This supersedes the earlier pending device-revocation status. D3 remains PARTIAL only for recovery after device revocation.

**D3 PASS — explicit user acceptance decision, 2026-10-09:** the user accepts the existing fresh-token recovery evidence as satisfying the final D3 recovery requirement for both revocation cases. Evidence reference: [D3 accepted recovery evidence](PHASE_2_ACCEPTANCE.md#d3-accepted-recovery-evidence), the immediately preceding successful connection with `desktop-device-revoke-test` to `http://127.0.0.1:4400`, showing **Connected**, the same account/workspace and no authentication errors. Together with the separately accepted session and device revocations and continuing web-session usability, this closes D3. A second recovery after device revocation was not executed and is not claimed; the user explicitly deemed the existing evidence sufficient. All earlier D3 PARTIAL/pending-recovery statements and the proposed `desktop-device-recovery-test` step are superseded. Do not request another duplicate manual recovery test. Desktop's last reported state remains signed out.

**D1 email/password manual verification — PENDING, paused by user:** desktop launch, token authentication, session/device listing, D2 and D3 remain accepted. No password check or account creation is authorized to proceed during this pause. Review the consolidated list before scheduling any further manual work. Phase 2 PARTIAL; Phase 3 on hold.

D3-closure recording commands/results (2026-10-09): sandbox read failed before execution (`helper_unknown_error`); approved UTF-8 handoff/plan/acceptance reads and `git status --short` succeeded. Initial read of nonexistent `apps/desktop/src/renderer/index.html` failed; `rg --files apps/desktop` located `apps/desktop/renderer/index.html`, whose corrected read succeeded. Desktop `login()` read confirmed the separate `/auth/login` password path with `clientType: desktop`. Only this handoff and `PHASE_2_ACCEPTANCE.md` were edited; existing updater source change preserved. No apps, tests, services, database or production operations were run. Documentation validation: `git diff --check` and targeted `rg -n` readback; results recorded after execution.

Device-revocation-result recording commands/results (2026-10-09): sandbox read failed before execution (`helper_unknown_error`); approved `Get-Content -Encoding UTF8` reads of the current handoff and Phase 2 plan, `rg -n 'D3|Next D3' PHASE_2_ACCEPTANCE.md` and `git status --short` succeeded (combined exit 0). Workspace still has only the two existing documentation modifications and desktop updater source modification. Only this handoff and `PHASE_2_ACCEPTANCE.md` were edited. No apps, tests, services, database or production operations were run. Documentation validation commands: `git diff --check` and targeted `rg -n` readback; results follow after execution.

Session-recovery-result recording commands/results (2026-10-09): sandbox read failed before execution (`helper_unknown_error`); approved `Get-Content -Encoding UTF8` reads of the handoff/plan, targeted `rg -n` acceptance/UI reads and `git status --short` succeeded (exit 0). The same two documentation modifications and existing desktop updater change remain. Source readback of `revokeDevice()` / the device list and `rg -n -A 34 -F` for the device route confirmed the distinct **Revoke device** control and owner-scoped revocation of the device and its sessions in one transaction. Only this handoff and `PHASE_2_ACCEPTANCE.md` were edited; no tests, apps, services, database operations or production actions were run. Documentation verification commands: `git diff --check` and targeted `rg -n` readback.

Remote-session-result recording commands/results (2026-10-09): first read `Get-Content REMEDIATION_HANDOFF.md, REMEDIATION_IMPLEMENTATION_PLAN.md` succeeded (exit 0; output truncated), followed by UTF-8 chunked reads. A batch of sandbox reads/inspection failed before execution (`helper_unknown_error`); approved retries succeeded (exit 0). `rg --files -g AGENTS.md -g PHASE_2_ACCEPTANCE.md` found only `apps/web/AGENTS.md` (no web edits). `git status --short`, `git log -3 --oneline`, `git diff --stat`, and `git diff -- apps/desktop/src/main.mjs` confirmed HEAD `0b3df3a` and the same pre-existing two documentation changes plus the updater import fix. `Get-Content -Encoding UTF8 PHASE_2_ACCEPTANCE.md` and targeted desktop/web source reads confirmed the D3 dependencies, token recovery path and 401 state clearing. Only this handoff and `PHASE_2_ACCEPTANCE.md` were edited. No app, test suite, service, database, credential or production operation was run. Documentation validation: `git diff --check` and targeted `rg -n` readback; results recorded below after execution.

D3-closure documentation validation result: `git diff --check` PASS (existing CRLF-to-LF normalization warning only); targeted `rg -n` readback confirmed D3 PASS in both records, the recovery evidence anchor/reference and next D1 password check. Combined verification command exited 0.

Device-revocation documentation validation result: `git diff --check` PASS (existing CRLF-to-LF normalization warning only); targeted `rg -n` readback confirmed both device-revocation PASS records, the next recovery step and the PARTIAL D3 row. Combined verification command exited 0.

Session-recovery documentation validation result: `git diff --check` PASS (existing CRLF-to-LF normalization warning only); targeted `rg -n` readback confirmed both recovery PASS records, the next device-revocation step and the PARTIAL D3 row. Combined verification command exited 0.

Remote-session documentation validation result: `git diff --check` PASS (no whitespace errors; Git emitted its existing CRLF-to-LF normalization warning); targeted `rg -n` readback confirmed both PASS records, the next recovery step and the PARTIAL D3 row. Combined verification command exited 0; `git status --short` still lists only the same three modified files.

Reconnect-result recording commands/results (2026-10-09): `Get-Content` read the handoff and Phase 2 remediation requirements; `rg -n` read D1–D3 and desktop `syncPolicy()` / revoked-session handling; `git status --short` confirmed the existing two documentation changes and desktop source change (combined exit 0). Only the two records were edited. No app, service, database or test command was run by the assistant. Documentation checks: `git diff --check` and targeted `rg -n` readback.

Server-revocation-result recording commands/results (2026-10-09): `Get-Content` read the current handoff and Phase 2 remediation requirements; `rg -n` read the acceptance steps/D1–D3 rows; `git status --short` confirmed the existing two documentation changes and desktop updater source change (combined command exit 0). Only the handoff and acceptance record were edited. No app, service, database or test command was run. Documentation verification: `git diff --check` and targeted `rg -n` readback.

Sign-out-result recording commands/results (2026-10-09): sandbox read failed before execution (`helper_unknown_error`); approved `Get-Content` reads of handoff/plan and `rg -n` reads of the acceptance rows and web session UI succeeded (exit 0). A quoted route regex failed to parse; corrected `rg -n -A 38 -F '/sessions' packages/auth/src/routes.ts` succeeded (exit 0), confirming the API returns revoked session rows and maps `revoked_at` to `revoked`. `git status --short` showed only the two existing documentation modifications and the existing desktop source modification. Only the two acceptance/handoff documents were edited; no app, service, database or test commands were run. Final documentation checks: `git diff --check` and targeted `rg -n` readback.

Persistence-result recording commands/results: sandbox read failed before execution (`helper_unknown_error`); approved `Get-Content` reads of the handoff and remediation plan plus targeted `rg -n` reads of D1–D3, renderer sign-out handlers and `logout()` succeeded (exit 0). Only documentation was edited. No app, service, database or test command was run by the assistant. Documentation verification uses `git diff --check` and targeted `rg -n` readback.

Token-result recording commands/results: sandbox read failed before execution (`helper_unknown_error`); approved `Get-Content` reads of this handoff and the relevant acceptance section, and `rg -n` reads of the remediation plan, D1–D3 rows and desktop quit handlers succeeded (exit 0). Source confirms **Quit Enough** calls `app.quit()` and window close hides the window. Documentation changes record only the user's actual results. No app, service, database or test command was run by the assistant. Final documentation verification: `git diff --check` and targeted `rg -n` readback.

Inspection record for this continuation: initial sandbox `Get-Content REMEDIATION_HANDOFF.md, REMEDIATION_IMPLEMENTATION_PLAN.md` failed before execution (`helper_unknown_error`); approved retry succeeded (exit 0). `Get-Content AGENTS.md` found no root file; `rg --files -g AGENTS.md` located only `apps/web/AGENTS.md` (no web edits). `git status --short`, `git log -3 --oneline`, `git diff --stat`, and `git diff -- apps/desktop/src/main.mjs` confirmed HEAD `0b3df3a` and pre-existing changes in this handoff, `PHASE_2_ACCEPTANCE.md`, and the already-fixed desktop updater import. Targeted `Get-Content` / `rg -n` reads of both remediation guides, the original Phase 2 contract, desktop README/package/build/main/renderer sources, shared `normalizeApiOrigin`, and web account token controls established the behavior above. An initial search of nonexistent `apps/web/src/app/account` returned exit 1; the corrected `apps/web/app/auth-panel.tsx` search succeeded (exit 0). No launch, build, test suite, service restart or database operation was repeated. Only this handoff and the acceptance record were updated in this continuation; existing source changes were preserved.

### Previous startup remediation (resolved; retained as history)

**Latest desktop blocker remediation:** the user's Windows `pnpm desktop:start` failed with `Named export 'autoUpdater' not found`. Fixed `apps/desktop/src/main.mjs` to default-import CommonJS `electron-updater` and destructure `autoUpdater`. Regenerated the bundle through the normal build; did not patch dist or change update behavior. `pnpm --filter @enough/desktop build`, focused Biome check and all 68 default tests passed (34 integration tests skipped). `pnpm desktop:start` launched without the import exception; Windows process metadata reported a responding `Enough` window. Computer Use's native pipe was unavailable, so no visual/sign-in acceptance is claimed. Full evidence is in `PHASE_2_ACCEPTANCE.md`.

The startup defect is remediated and the subsequent user visual retest passed as recorded above; D1 authentication remains pending. The assistant previously stopped its launched desktop main process (PID 6912) after observing the window; the resulting start-command status 4294967295 was deliberate cleanup, not another startup failure. Existing changes are the desktop source import and the two acceptance/handoff documents. Phase 2 PARTIAL; Phase 3 on hold.

**Current update — user-performed real OAuth acceptance recorded 2026-10-08.** Google reports `google=true`; first login, logout and second login all passed. GitHub reports `github=true`; first login, logout and second login all passed. These are the user's explicit manual results, not assistant browser actions. No other OAuth or client behavior is inferred. Real credentials remain only in ignored `C:\Enough\.env`; preserve enabled providers. The historical absent-credentials blocker below is resolved.

Current source is `0b3df3a65ffef936409cc03c7493923f92a61b9c`; working tree was clean and HEAD matched recorded upstream before these documentation edits. User reports origin/main current, migrations 0002–0015 applied, no pending migrations, web 3301/API 4400/worker 4001 running with Redis/Memurai. This supersedes the previous uncommitted-source and active fixture statements. No fetch, commit or push was performed here.

Fresh supporting verification: `pnpm test` exited 0 (68 passed; 34 opt-in integration tests skipped; 5.34 seconds); desktop and Chrome/Firefox extension source builds exited 0. `.env` is ignored. Read-only readiness requests to web/API/worker could not connect; curl independently reported API connection failure (HTTP 000), and no local listeners were returned for 3301/4400/4001. Keep this current reachability discrepancy separate from accepted earlier manual OAuth results. No services or configuration were changed.

**Phase 2 remains PARTIAL; Phase 3 remains on hold; launch NO-GO.** Every remaining acceptance item is enumerated with IDs P0, D1–D3, E1–E3, C1, W1–W2, O1–O2 and V1 in `PHASE_2_ACCEPTANCE.md`: runtime availability, interactive desktop/extension sign-in/persistence/logout/session and device revocation, client error/renewal, remaining non-OAuth web account UI journeys, provider negative/identity cases, and final evidence closure. OAuth happy-path manual acceptance is PASS. Current source still has historical 34-test integration evidence; it was not rerun because its hardcoded fixture/live-HTTP assumptions conflict with the user's enabled-provider runtime. Do not disable providers or repoint the live database to run it.

**P0 PASS — subsequent user confirmation:** `/login` loads successfully; web, API and worker are running normally. This clears the manual runtime prerequisite; earlier assistant probe failures do not justify restarting or replacing the user's services.

**D1 launch and token connection completed:** launch, Connected state, correct identity and workspace loading passed by user report. Continue with D2 persistence at the top of this handoff; other D1 requirements remain tracked separately. Do not request tokens, passwords, OAuth codes, complete logs or `.env` contents. Record each actual result before moving its checklist item to PASS.

### Historical previous continuation (superseded by the current update above)

**Phase 2 PARTIAL — local server acceptance passed; provider and interactive client acceptance blocked.** Evidence and the exact acceptance matrix are in [PHASE_2_ACCEPTANCE.md](PHASE_2_ACCEPTANCE.md). Final verification on 2026-10-08: formatting, lint (124 warnings and one informational diagnostic), workspace typecheck, 68 default tests, 34 PostgreSQL/Redis/live-HTTP integration tests, Chrome/Firefox extension builds, desktop source build and migration checksum precheck all passed. The 34 integration tests are intentionally skipped by the default suite and were run separately with no skips.

This continuation completed a failing regression for derived-session authentication freshness: an old passwordless session could issue a new token and delete the account without signing in again. Web/desktop/extension derived sessions now preserve the parent's original authentication timestamp. Three additional failing race tests demonstrated issuance after parent-session revocation, device revocation or rotation; session creation now revalidates and locks the parent within its transaction and returns 401 without creating a device. Earlier rotation, stale-password and cookie fixes are retained. Seven fixed defects and source SHA-256 fingerprints are recorded in the acceptance document.

Changed Phase 2 files: `packages/auth/src/session.ts`, `packages/auth/src/routes.ts`, `packages/auth/src/auth.integration.test.ts`, `packages/auth/src/session.security.test.ts`, `apps/api/src/auth-http.integration.test.ts`, `scripts/phase2-auth-tests.mjs`, root test script, auth README, acceptance document, security status and trackers. Existing Phase 1 documentation edits were preserved. Working tree remains uncommitted on base `7e78c9d87ea993c7e95530b56dc5db9da1f8d4e7`; no commit/push, dependencies, migrations, client source, Docker, CI or production changes were made in this continuation.

**Remaining High blockers:** both Google/GitHub credential pairs are absent from ignored `.env`; live provider flows remain unverified. User explicitly asked to retain these blockers and requires both successful real end-to-end logins before COMPLETE. No connected browser is available for interactive web/extension checks. Installed desktop authentication also remains unverified; Computer Use guidance prohibits automating user authentication dialogs. API contracts and builds do not satisfy interactive acceptance. Owner: developer for test execution; user for real provider setup and browser access. All blockers recorded 2026-10-08; launch remains NO-GO and Phase 3 is on hold.

The isolated PostgreSQL fixture was restarted after the initial suite found it stopped. Redis 8.10.2 was already running in Ubuntu WSL and returned PONG. API 4400 and web 3301 were restarted against `.runtime/phase1/fixture.env`; API was restarted again after the final source fix. PostgreSQL 55432, Redis 56379, API and web were left running; check readiness before reuse. Worker was not required or restarted. An intermediate expanded deletion regression exceeded the real rate limit; independent synthetic accounts corrected the test without changing security limits. Final 34-test run passed in 32.16 seconds.

**Next safe command:** `pnpm test:auth:integration` after confirming fixture API/web readiness; startup commands are in `PHASE_1_ACCEPTANCE.md`. The next acceptance work is interactive web/client testing when a supported surface is available, then both real OAuth flows when the user adds real credentials only to `C:\Enough\.env`. The exact four variable names, callbacks, local base URLs, and source read locations are in `PHASE_2_ACCEPTANCE.md`. Fixture tests intentionally keep providers disabled; the real app enables each provider when its complete real pair is configured. Do not store credentials in evidence, fixtures, source, examples or logs, and do not claim the local runner verifies live providers.

The following resume history is superseded by Phase 1 COMPLETE above:

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

### Historical environment state (superseded by current active work)

- `C:\Enough` is not a Git repository and has no recorded canonical remote. No approved commit/ref can be deployed from this workspace yet.
- This workspace is Windows. A read-only probe on 2026-10-07 found ports 80, 443, 3000, 3001, 4000, 4001, 5433, and 6379 closed; web/API/worker readiness requests were unavailable.
- Earlier package operations succeeded for `pnpm install --frozen-lockfile` after the `electron-winstaller` build hook was allowlisted. Node still hit `EPERM` reading linked `pg`, TypeScript, and `dotenv` package files in migration, typecheck, and desktop packaging attempts.
- The recorded local database has only baseline migration `0001_create_enough_schema.sql`; migrations `0002`–`0015` remain unapplied. No production database or Ubuntu host is configured.
- The earlier Phase 23 record reports 65 passing unit/property/contract tests and successful extension/desktop source builds. This is historical evidence; rerun on the current commit in the supported environment. Database, browser/Electron, multi-device, load, broad security, and production integration coverage is still missing.
- Extension store archives were generated. Signed desktop installers, store publication, end-user install/update acceptance, provider credentials, Stripe pricing, production email, backup keys/remotes, and external alerting are not configured.
- Gmail, Outlook, Google Calendar, and Microsoft Calendar vendor adapters are not implemented. The Generic webhook/Public Event API authenticates an owner-controlled source and is not vendor verification.

## Historical initial execution sequence (Phase 1 complete; do not restart this sequence)

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
| Establish canonical Git checkout and supported test environment | Complete | Verified `7e78c9d87ea993c7e95530b56dc5db9da1f8d4e7`; canonical Windows checkout, synchronized main, clean at acceptance |
| Apply/verify migrations and complete Phase 1 runtime acceptance | Complete | All 15 fixture migrations/checksums, services, database/queue, tests and builds accepted; `PHASE_1_ACCEPTANCE.md` |
| Complete Phases 2–22 runtime/security acceptance | Pending | Follow phase checklists and retain evidence |
| Complete Phase 23–26 quality, release, production, and integration acceptance | Pending | Requires CI signing, provider sandboxes, and a configured Ubuntu host |
| Repeat Phase 27 launch gate | Pending | Current decision remains NO-GO |

## Handoff rule

At each pause, update this file with the exact phase/subtask, changed files, commands run, results, unresolved severity, and the next safe command. Update the phase tracker only when evidence meets that phase's acceptance criteria. Keep the historical handoff intact as the record of prior implementation; this file is the active remediation handoff.
