# Phase 3 onboarding acceptance

Date: 2026-10-09. Base: `fd9bc2467bf4daeca9e80e1287029310d4ee2f7c`.
Evidence applies to the uncommitted Phase 3 working tree. **Phase 3 COMPLETE**:
the user reported all six consolidated browser checks PASS with no observed
failures. Phase 1/2 accepted evidence is preserved. Checkpoint approval remains
pending; no commit or push is authorized. Launch remains **NO-GO**.

## Scope and reconciliation

Read the remediation handoff/plan first, then the implementation tracker,
canonical Phase 3 scope, historical implementation map and Phase 2 acceptance,
engineering and dependency-security records. HEAD and locally recorded
origin/main both match the accepted checkpoint; no fetch was needed.

The resumed workspace already contained ten modified files and two new files:
onboarding fixes, 18 integration cases and a TEMP fixture option. The trackers
already marked Phase 2 complete and Phase 3 active. TEMP contained a migrated
database and web copy but no retained integration-result log. These were
inspected and reused, not credited as a successful previous test run.

Scope remains the original ten onboarding questions, generated initial
recommendations and a usable configured dashboard without manual policy
creation. The remediation exits add save/reload/edit/export, all nine stages,
ownership and validation. Existing migration 0004 supplies canonical products;
the current account export depends on later existing tables. Applying/verifying
all 15 existing migrations does not accept Phases 4–26 or expand this phase.

Execution order: reconcile source → isolated migration/checksum verification →
live API/web-proxy onboarding checks → workspace quality/regression checks and
web build → one browser session. No product, provider or credential blocker was
found for local implementation.

## Implemented changes

- The onboarding response includes its linked `productId`; successful wizard
  submission opens `/dashboard?productId=...`, selecting the saved product even
  when another product was created more recently.
- Recommendations use the same normalized launch status as stored answers.
  A launched stage with an unchecked launch box now produces consistent advice.
- The dashboard displays the onboarding first action and an edit link for the
  linked product. Existing stage guidance, priorities, tasks and ratios remain.
- Failed profile loading displays a retry state instead of a blank editable
  wizard. Numeric input maxima match the API/database, and Back is disabled
  while saving.
- Added opt-in live onboarding tests and Windows-first disposable fixture
  commands. Existing Phase 1/2 fixture defaults remain unchanged; Phase 3 uses
  TEMP and separate ports. No dependency or historical migration changed.

## Isolation

| Resource | Phase 3 target |
| --- | --- |
| Files | `$env:TEMP/enough-phase3` |
| PostgreSQL 18 | Loopback 55434, database/role `enough_phase3` |
| Redis 8.10.2 | Windows loopback 56383 → WSL Ubuntu loopback 56384; no persistence |
| API / web | `http://127.0.0.1:4404` / `http://127.0.0.1:3303` |
| Web files | Copied source and separate generated configuration/build output in TEMP |
| Accounts | Random synthetic `@example.test` users; suite removes only its own IDs |

Runner refuses occupied ports, verifies PostgreSQL cluster identity and Redis
run ID, and stops its owned services. Test guards assert database, role, port,
Redis and base URLs before mutation. Real providers/email are disabled. Existing
`.env`, `.runtime/`, credentials and local browser profiles were not read or
changed. New synthetic fixture credentials stay in TEMP and are never printed.
No Docker, GitHub Actions, deployment, production data or global reset was used.

## Automated evidence

Windows; Node v24.19.0; pnpm 11.20.0. Raw logs below are relative to
`$env:TEMP/enough-phase3`. PowerShell redirects stdout/stderr to each log and
captures `$LASTEXITCODE`; its `NativeCommandError` rendering of stderr command
banners is not the native exit status.

| Command / check | Result | Log |
| --- | --- | --- |
| `pnpm test:onboarding:integration` | PASS, exit 0; 18/18, 22.73 s, none skipped; services stopped | `integration-resume.log` |
| Migration runner + precheck (inside fixture command) | PASS; existing database up to date, PostgreSQL 18, no pending migrations; live test verifies all 15 IDs, source checksums and applied order | `integration-resume.log` |
| `pnpm format:check` | PASS, exit 0; 153 files, 592 ms | `format.log` |
| `pnpm typecheck` | PASS, exit 0; all applicable workspace packages | `typecheck.log` |
| `pnpm test` with both integration flags `0` | PASS, exit 0; 68 passed, 67 opt-in skipped, 5.19 s | `unit.log` |
| `pnpm lint` | PASS, exit 0; 158 files, 512 ms; 124 existing warnings / 1 info | `lint.log` |
| Isolated `next build --webpack` | PASS, exit 0; optimized compilation, TypeScript and all 29 static pages | `web-build-final.log` |
| `node scripts/phase2-runtime.mjs prepare --phase3` | PASS, exit 0; ready API/web, synthetic account created without credential output, services stopped | `manual-prepare.log` |
| `git diff --check` | PASS, exit 0; CRLF normalization notices only | Tool result |
| Final Windows listeners + WSL bind probe | Zero listeners on 55434/56383/4404/3303; Redis 56384 free | Tool result |

Integration coverage: empty profile; all answers save/reload/edit/export and
optional clearing; each of nine stages and its linked product/primary goal;
normalized launch/traction advice; forged owner/product IDs and cross-account
reads/exports; unauthenticated, CSRF and hostile-origin writes; 17 invalid input
cases without mutation; upper numeric bounds/whitespace/tool deduplication;
concurrent first saves/retries without duplicate products/goals; HTTP rendering
of onboarding/dashboard pages. No policies are created by onboarding.

The page HTTP check verifies compilation/initial HTML, not hydrated browser
interactions. Those are accepted from the user report below. The 49 accepted Phase 2
integration checks were deliberately not rerun against protected `.runtime/`.
Auth/client source and dependencies are unchanged; accepted installed-client and
real-provider evidence is preserved. No duplicate Phase 2 manual session is needed.
Existing Phase 1 fresh-migration evidence is preserved; this run reused the
already-migrated Phase 3 cluster and does not claim a new migration-from-zero run.

Failure record: repeated sandbox process-creation failures
(`helper_unknown_error`) occurred before commands ran; approved retries worked.
The first isolated optimized web build compiled and typechecked, then failed
page-data collection because production configuration correctly rejected missing
auth/email settings and HTTP URLs. The retry supplies only build placeholders,
HTTPS `.example.test` URLs and disposable loopback database/Redis targets.
Production validation was not weakened. Redis retains the known WSL memory
overcommit warning; no host tuning changed.

Build reproduction: after the integration command has copied current web source,
run the following in a separate PowerShell process (all values are synthetic):

```powershell
$env:NEXT_TELEMETRY_DISABLED='1'
$env:APP_BASE_URL='https://phase3.example.test'
$env:API_BASE_URL='https://api.phase3.example.test'
$env:AUTH_SECRET='phase3-build-only-placeholder-never-deploy'
$env:RESEND_API_KEY='re_phase3_build_only_placeholder'
$env:AUTH_EMAIL_FROM='Enough <noreply@example.test>'
$env:AUTH_DEV_SHOW_EMAIL_LINKS='false'
$env:DATABASE_URL='postgresql://enough_phase3:build-only@127.0.0.1:55434/enough_phase3'
$env:REDIS_URL='redis://127.0.0.1:56383/0'
foreach ($phase3Key in @('GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID','GITHUB_CLIENT_SECRET','OPENAI_API_KEY','STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRETS','STRIPE_PRICE_MONTHLY','STRIPE_PRICE_ANNUAL')) {
  [Environment]::SetEnvironmentVariable($phase3Key,'','Process')
}
Push-Location (Join-Path $env:TEMP 'enough-phase3/web')
try {
  node C:/Enough/apps/web/node_modules/next/dist/bin/next build --webpack
} finally { Pop-Location }
```

## Consolidated browser acceptance — PASS

Accepted 2026-10-09 from the user's explicit combined report, not assistant
browser observation. The user reported no browser acceptance failures.

| Check | Result |
| --- | --- |
| P3-1: new founder / configured dashboard | PASS — user report |
| P3-2: edit/reload | PASS — user report |
| P3-3: account export | PASS — user report |
| P3-4: correct product selection | PASS — user report |
| P3-5: validation, keyboard and narrow layout | PASS — user report |
| P3-6: load failure/recovery | PASS — user report |

All six checks are closed. Do not reopen or repeat them. Browser/version was not
provided and is not inferred; no additional evidence request is needed for the
user's explicit acceptance. Current fixture service state was not rechecked or
changed during this documentation-only closure.

### Accepted session protocol (historical; do not rerun)

The session instructions were: from PowerShell in `C:\Enough`, run:

```powershell
pnpm test:onboarding:serve
```

Wait for the fixture-serving message. It creates a new verified disposable
account; read its email/password locally from
`$env:TEMP\enough-phase3\manual-account.json` without sending them to chat.
Use a private browser window, visit `http://127.0.0.1:3303/login`, and sign in
with that account. No existing browser profile or application account is needed.

| Check | Actions and expected result |
| --- | --- |
| P3-1: new founder | Open `/onboarding`. Enter the first column below across the three steps; use Back/Continue once and confirm entries persist within the wizard. Click **Prepare my workspace** once. The dashboard selects the new product, shows Idea guidance, next goal, ratios, and a recommended next action. No policy setup is requested. Refresh: the same product remains selected. |
| P3-2: edit/reload | Click **Edit onboarding answers**. Check all saved values, then use the edited column below and save. The same product is updated, not duplicated; the dashboard shows First Revenue, 30 users, 7 paying, USD 1,234.56, updated goal and paying-customer advice. Reopen onboarding and confirm all edits persisted. |
| P3-3: export | From **Account** → **Export account data**, inspect the synthetic export: `onboarding` has the edited answers/tools/currency and `recommended_config`; its linked product matches the dashboard. Keep the export local. |
| P3-4: correct selection | On the dashboard create a second disposable product with a distinct name using **Add product**. Open `/onboarding` and save the existing onboarding answers again. Confirm it returns to the original onboarding product, even though the second product is newer. |
| P3-5: validation and layout | In onboarding, try more paying users than total users; save is rejected with a useful message and no saved-data change. Restore valid values. Check the three steps and dashboard with keyboard navigation and a narrow window (~390 px): labels, focus, Back/Continue/save, errors and content remain usable without clipping. |
| P3-6: load failure/recovery | In browser DevTools, block only `http://127.0.0.1:3303/api/onboarding*`, then reload `/onboarding`. Expect **Workspace unavailable** and **Try again**, with no blank editable wizard. Remove the block and choose **Try again**; the saved answers return. |

| Question | First save | Edited save |
| --- | --- | --- |
| What are you building? | A scheduling tool for clinics | A booking assistant |
| Who is it for? | Independent clinics | Dental practices |
| What problem does it solve? | Staff spend hours following up missed appointments | Receptionists need fewer manual reminder calls |
| Stage | Idea | First Revenue |
| Launched? | Unchecked | Checked |
| Users | 0 | 30 |
| Paying users | 0 | 7 |
| Revenue / currency | Empty / EUR | 1234.56 / USD |
| Next goal | Interview five clinic owners | Retain the first seven paying clinics |
| Tools | VS Code, Terminal | Cursor, Terminal, Figma |

The combined P3-1–P3-6 PASS report above closes this protocol. The nine-stage/API/
security matrix is already automated; no manual permutation or session repeat is
required. The previously documented Ctrl+C cleanup applies only to the fixture;
the user's current service state is not inferred from the acceptance report.

## Security, release and acceptance decision

All **18 dependency findings remain OPEN** (accepted Phase 2 audit: 3 critical,
8 high, 7 moderate), owned/gated in `PHASE_2_DEPENDENCY_SECURITY.md`. No fresh
audit is claimed here; no dependency update, lockfile change, suppression or
release waiver occurred. Guidance remains advisory, not enforced policy.

**Phase 3 formally COMPLETE.** Implementation, automated verification and all six
browser acceptance checks are accepted; no Phase 3 blocker remains. The next safe
action is explicit user checkpoint approval before any commit/push. Phase 4 is
not started by this closure. Production launch remains NO-GO while the 18
dependency-security findings and later release gates remain open.

## Final closure consistency review — 2026-10-09

This closure changes documentation only. All nine SHA-256 source/lockfile
fingerprints below still match the tested files. The package manifest diff still
contains only the two reviewed onboarding scripts; dependencies are unchanged.
Formatting/lint/typecheck and automated/manual tests were not repeated because
the tested source/configuration is unchanged and this closure only edits Markdown.

| Final command / review | Result |
| --- | --- |
| `git diff --check` | PASS, exit 0; CRLF normalization notices only |
| `Get-FileHash -Algorithm SHA256` compared with all nine recorded anchors | PASS; no source/lockfile drift |
| `git diff -- package.json` and dependency-object comparison with HEAD | PASS; only the two already-tested onboarding script entries |
| `git diff --exit-code -- PHASE_1_ACCEPTANCE.md PHASE_2_ACCEPTANCE.md PHASE_2_ENGINEERING_VERIFICATION.md PHASE_2_DEPENDENCY_SECURITY.md pnpm-lock.yaml` | PASS, exit 0; accepted evidence and lockfile unchanged |
| Current acceptance/tracker/security status readback | All six PASS results recorded; Phase 3 COMPLETE; checkpoint approval pending; 18 findings OPEN / launch NO-GO |
| `git status --short --branch`, `git diff --cached --stat`, `git rev-parse HEAD origin/main` | PASS; inventory below unchanged; nothing staged; HEAD and recorded upstream match |

Initial sandbox reads/checks failed before execution with `helper_unknown_error`;
approved retries succeeded. No service, credential or browser action was taken.
The working tree is ready for checkpoint commit after explicit user approval.
Suggested message: `fix: complete phase 3 onboarding acceptance`.

## Git inventory and verification fingerprints

Branch `main`; HEAD and locally recorded `origin/main` both
`fd9bc2467bf4daeca9e80e1287029310d4ee2f7c`. Nothing staged, committed or pushed.
Eleven modified tracked files and three untracked files:

```text
 M IMPLEMENTATION_PLAN.md
 M REMEDIATION_HANDOFF.md
 M REMEDIATION_IMPLEMENTATION_PLAN.md
 M SECURITY_STATUS.md
 M apps/api/src/onboarding.ts
 M apps/web/app/dashboard/page.tsx
 M apps/web/app/onboarding/page.tsx
 M apps/web/app/workspace-data.ts
 M package.json
 M scripts/phase1-postgres.mjs
 M scripts/phase2-runtime.mjs
?? PHASE_3_ACCEPTANCE.md
?? apps/api/src/onboarding.integration.test.ts
?? scripts/phase3-manual-account.mjs
```

`git diff --cached --stat` is empty. `git diff --name-only -- pnpm-lock.yaml
packages/auth apps/desktop apps/extension .github` is empty. No auth/client
implementation, dependency version, workflow or lockfile changed in this pass.
SHA-256 source anchors captured after verification:

| File | SHA-256 |
| --- | --- |
| `apps/api/src/onboarding.ts` | `55F7349528435747868AB904D5B07E68135BC9C8553AD25EFA9ABF534B83CA5B` |
| `apps/api/src/onboarding.integration.test.ts` | `23088D762D33CCA2AB8157AC411A8276322FF0D2361298FE69461B6A7F4D8CF1` |
| `apps/web/app/onboarding/page.tsx` | `3A2416DBF9580CE22C12EB64B5591B28A03DAF242F4EDBAF74EF4A2CC7FB57C5` |
| `apps/web/app/dashboard/page.tsx` | `216FEF7A454808E1BE4A2AF769F5CFB6E0DF1CD8928461CCB3F99E89DFB32467` |
| `apps/web/app/workspace-data.ts` | `8FDAE171F221B988B9E0A92105AE0F9F8A4E1DFD89C7C2BE8F57B962459CB609` |
| `scripts/phase1-postgres.mjs` | `A4D5EADE84C9961B3A86328D0464FFE25917F0F1AD3EF59D61DE993B463CAB90` |
| `scripts/phase2-runtime.mjs` | `BE5DCB6AEBCEBA1E97752A4622044B8FE2A009968375D346244095FD3FDF2B53` |
| `scripts/phase3-manual-account.mjs` | `F8CC503EA667056E7CE7DF7AF536684D12CAE08AE9E726854C503082F9857FA6` |
| `pnpm-lock.yaml` (unchanged from accepted Phase 2) | `868BFE826636B2562127F2C6625BEE4F00D4D460C63899A92FDB99A470FF0E7F` |
