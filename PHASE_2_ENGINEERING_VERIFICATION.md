# Phase 2 isolated engineering verification

Date: 2026-10-09. Base revision: `0b3df3a65ffef936409cc03c7493923f92a61b9c`.
Environment: Windows, Node 24.19.0, pnpm 11.20.0, PostgreSQL 18, Redis 8.10.2
in Ubuntu WSL. Evidence applies to the uncommitted working tree, not just HEAD.
Phase 2 PASS after final review below; Phase 3 ready after user review but not
started; launch NO-GO. Earlier pending statements are historical.

## Final closure verification — 2026-10-09

Desktop D1–D3 and Chrome/Firefox E1–E3 PASS by the user's explicit combined
report. Real Google/GitHub evidence remains accepted. No manual test was repeated.

Added three meaningful automated security cases:

- Identity disconnection requires authentication and CSRF, is scoped to its
  owner, exposes no provider subject, and concurrent disconnect requests cannot
  remove both remaining sign-in methods.
- Concurrent consumption of one browser-bound OAuth exchange creates exactly
  one session; the second request fails.
- The real Next.js proxy rejects hostile and opaque origins without cookies or
  credential disclosure, and rejects web-origin desktop/extension impersonation
  without issuing a session.

The Phase 2 manual fixture was still running. Read-only listener/process
inspection identified `phase2-runtime.mjs serve`, PostgreSQL in the Phase 2
cluster, API 4402 and copied web 3302. Reviewed target guards pin PostgreSQL
55433 / role and database `enough_phase2` and Redis 56381. Provider flags were
confirmed disabled by the live HTTP suite. Cleanup deletes only each suite's
random synthetic users and OAuth states; outage simulation mocks only the test
process's Redis method, and no global flush occurs. Under the user's instruction
to finish automated verification, the guarded test subprocess was run directly
against this verified disposable fixture. The service-owning runner was not
restarted or invoked on occupied ports. No manual account or installed client
was operated. Fixture listeners retained the same PIDs after verification:
PostgreSQL 33424, relay/runner 33528, API 18952, web 31132. Services remain running.
The original application runtime and root `.env` were not used by these tests.

| Command / check | Final result |
| --- | --- |
| `node scripts/phase2-auth-tests.mjs` (existing verified fixture only) | **PASS**, exit 0; 49/49 tests, 18.93 s; `.runtime/phase2/integration-closure.log` |
| `$env:ENOUGH_PHASE2_INTEGRATION='0'; pnpm test` | **PASS**, exit 0; 68 passed / 49 deliberately skipped, 6.38 s; `unit-final-review.log`; integrations pass separately |
| `pnpm typecheck` | **PASS**, exit 0; all applicable workspace checks; `typecheck-final-review.log` |
| `pnpm format:check` / `pnpm lint` | **PASS**, both exit 0; lint 124 warnings / 1 info; `format-final-review.log`, `lint-final-review.log` |
| `pnpm exec biome check apps/api/src/auth-http.integration.test.ts packages/auth/src/auth.integration.test.ts` | **PASS**, exit 0 after final assertion correction; no fixes |
| `pnpm audit --json` | Exit 1, 18 entries: 3 critical / 8 high / 7 moderate; `audit-final-review.json` |
| `pnpm audit --prod --json` | Exit 1, 12 tar entries: 1 critical / 8 high / 3 moderate; `audit-final-prod.json`; optional native installer chain remains present |
| Registry patch/parent checks | get-windows latest 9.3.0 still has old optional installer parents; sprintf-js latest 1.1.3; Vitest 4.1.11 and tinypool 2.1.2 available; no dependency mutations in this review |
| Limited current-file credential scan | 236 tracked/nonignored files, six high-confidence credential formats, zero matches; ignored `final-source-review.mjs` / `final-source-review.json`; not a history/entropy scan or proof of absence of all secrets |
| `git check-ignore` | `.env`, manual credentials, fixture environment and raw review evidence remain ignored |
| `git diff --check` | PASS, exit 0; existing CRLF normalization notices only |

Failures recorded rather than hidden: sandbox process creation intermittently
failed before execution; escalated retries succeeded. Two initial expanded runs
returned 48 PASS / 1 FAIL because the new proxy test expected HTTP 403 for a
client-type guard whose intentional contract is HTTP 400, `Invalid client type.`
Adding an optional device name did not change that result. Source inspection and
the existing database/API regression confirmed the contract; the assertion was
corrected to check the exact error and absence of sessions. No product fix was
needed. Logs: `integration-final-review.log` and
`integration-final-review-pass.log` (the latter filename does not imply success).
An exploratory read of a nonexistent catch-all proxy route also failed; the
actual proxy is configured in `apps/web/next.config.ts`.

Earlier successful frozen installation and client builds remain applicable:
this review changed tests/docs only, with no manifest, lockfile or client source
change relative to those recorded checks. No unrelated full-build rerun was
needed. Source SHA-256 anchors (full changed-source inventory retained in
`final-source-review.json`):

| File | SHA-256 |
| --- | --- |
| `packages/auth/src/oauth.ts` | `b208e41b4e8cfb923a48a9ef618880a28d6413676adc685cf81e076569cdc1e7` |
| `apps/desktop/src/main.mjs` | `779e64dfa581d1119bdb68a23404f755bc0d8071427c96032a0cf2e94ea7f9dd` |
| `pnpm-lock.yaml` | `868bfe826636b2562127f2c6625bee4f00d4d460c63899a92fdb99a470ff0e7f` |
| `apps/api/src/auth-http.integration.test.ts` | `2849dd20d0e2b0c84ed183e7a082b71a55d8a6447af57c5a1a8f0d0c3e604a82` |
| `packages/auth/src/auth.integration.test.ts` | `dbee699492ad7f49692e47eb3f6b86d716205759d9153e614f55fc87788b47eb` |

**Decision: Phase 2 PASS; no remaining Phase 2 blocker.** Open dependency risk
is explicitly assigned below in the dependency report; Phase 3 can begin after
the user's final review, but remains unstarted here. Launch remains NO-GO.
No commit, push, staging, dependency override, provider credential operation,
production action or Phase 3 implementation occurred.

## Reconciliation with the handoff

Initial `git status --short` showed work beyond the handoff: modified PostgreSQL
fixture helper, integration runner, auth/HTTP tests and Vitest excludes, plus an
untracked `scripts/phase2-runtime.mjs`. The isolated cluster and web copy and audit
JSON already existed under `.runtime/phase2`. These were reviewed, not recreated
or credited as passing. First migrations reported “Database is up to date”; the
checksum precheck confirmed PostgreSQL 18 and no pending migrations. Fresh
migration-from-zero evidence remains the accepted Phase 1 evidence; this run did
not reset a database to manufacture a new first-run result.

Preserved: existing desktop updater import fix; accepted desktop token/identity,
D2 persistence/logout/re-login, D3 revocation and explicitly accepted recovery;
real Google/GitHub happy paths. No installed client was launched by this work.

## Isolation and repeatability

`pnpm test:auth:integration` now provisions/starts, verifies, tests and stops only
the Phase 2 fixture. It refuses occupied fixture ports before startup. Its raw
test subprocess runner is `scripts/phase2-auth-tests.mjs`; do not run that helper
against arbitrary existing services.

| Resource | Disposable target |
| --- | --- |
| PostgreSQL | Loopback 55433; database/role `enough_phase2`; cluster `.runtime/phase2/pgdata` |
| Redis | Windows loopback 56381 relayed to WSL loopback 56382; persistence disabled; server run ID checked across the relay |
| API | `http://127.0.0.1:4402` |
| Web | `http://127.0.0.1:3302`; copied sources and `.next` in `.runtime/phase2/web` |
| Provider credentials | Synthetic in mocked-provider tests; real API/web providers and email delivery disabled in the fixture |
| Accounts | Random `@example.test` accounts; each automated suite removes only its own recorded fixture IDs/emails |
| Client state | VM execution of actual client source with memory-only OS/browser adapters; no actual Electron/browser profile access |

The root `.env`, active database 55432, Redis 56379, API 4400 and web 3301 were
not used as mutating test targets or restarted. No production, Docker, CI,
real email, external OAuth request, destructive reset or database flush was used.
Redis reports the existing host memory-overcommit warning; no host tuning changed.

## Automated coverage

**46 integration checks passed, none skipped**, in 34.22 seconds:

- Original 26 database/Redis auth checks and eight real HTTP/Next.js proxy checks.
- Ten added Google/GitHub cases: S256 verifier/challenge and callback binding;
  wrong provider/state; one-use callback and browser-bound exchange replay;
  cancellation, expired state and upstream failure without sessions; unverified
  provider emails; stable identity ownership after provider email changes;
  unverified preregistration password takeover prevention.
- Two checks bundle and execute actual desktop/extension auth handlers against
  the live disposable API. Both reject incorrect passwords/invalid tokens,
  sign in, renew near-expiry credentials without changing identity/session,
  persist the replacement token, reject old tokens at the real API and clear
  persisted authentication after remote revocation. Browser permissions and
  native storage adapters are simulated; installed runtime acceptance stays manual.

Signup/verification permutations, magic-link expiry/one-use/concurrency,
reset/change-password invalidation and races, deletion/fresh-auth/ownership,
session rotation and revocation are covered by the original suite. The web
happy-path evidence includes real cookie/CSRF login, `/me`, logout and invalidated
cookie checks through the isolated Next.js proxy, plus rendered auth routes.
Together with accepted real provider UI logins, this avoids another manual web
happy-path request. This does not claim a browser click test for every account form.

## Defect and failure record

1. Initial sandbox commands failed before execution (`helper_unknown_error`).
   Approved retries read the guides and inspected the workspace.
2. Two initial `node scripts/phase2-runtime.mjs test` attempts failed on Windows
   access to WSL Redis despite an internal PONG. No integration tests ran. A
   bounded reconnect attempt also failed. Replaced reliance on implicit WSL
   forwarding with a fixture-owned loopback byte relay; verified Redis run ID.
3. First successful runtime run: **42 passed / 2 failed** (44 total, 37.45 s).
   Both OAuth preregistration tests returned password-login 200 instead of 401.
   **High authentication defect, engineering owner, fixed 2026-10-09:** provider
   verification previously activated an unverified preregistration password.
   Under the account transaction lock, OAuth now clears that password, consumes
   pending tokens and revokes prior sessions before verification. Already verified
   accounts retain their password. Tests prove old password/token rejection and
   successful legitimate OAuth exchange for both providers.
4. Expanded client run: **45 passed / 1 failed** (46 total, 45.03 s), retained in
   `.runtime/phase2/integration-after.log`. Extension correctly throws after
   clearing revoked auth; the test expected a return value. Corrected the test
   to assert rejection and persisted clearing; no extension product change.
5. Typecheck initially failed because generated ignored web `tsc` launchers
   traversed five parent directories and resolved to `C:/node_modules`.
   Frozen install passed but did not repair these files. Corrected only the three
   ignored `apps/web/node_modules/.bin/tsc{,.cmd,.ps1}` relative paths to four
   parents. Then fixed the new VM adapter's TypeScript export interface.
   Workspace `pnpm typecheck` subsequently passed.
6. `npm view ...` was rejected by repository `devEngines.packageManager` before
   registry lookup. Reissued read-only metadata queries with `pnpm view`.
7. Manual fixture helper initially used `.ts` at a CommonJS package root, so tsx
   rejected top-level await before account creation. Changed helper to `.mjs`;
   its provider/account operations remain restricted by explicit target guards.

## Command and result record

All log paths below are relative to ignored `.runtime/phase2/`. PowerShell stdout
and stderr were redirected there, preserving each native command's exit code.
Its `NativeCommandError` wrapper can accompany a script's stderr command banner;
the native exit status and actual test summary determine success.

| Command | Result / evidence |
| --- | --- |
| `git status --short`, `git log -3 --oneline`, focused `git diff`, `rg` and UTF-8 reads | Reconciled existing unrecorded work and preserved desktop fix; only web `AGENTS.md` applies under apps/web (no source edits there) |
| `pnpm view drizzle-orm@0.45.2 version`; `pnpm view get-windows@latest version dependencies optionalDependencies --json`; `pnpm view vitest@3 version`; `pnpm view tinypool@2.1.2 engines --json`; `pnpm view sprintf-js versions --json` | Registry availability and parent/version constraints verified; sprintf-js 1.1.4 is not published |
| `pnpm install --ignore-scripts` | PASS, exit 0, 25.9 s; +1/-1 package, only Drizzle changes |
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS, exit 0, 0.785 s; lockfile up to date |
| `pnpm test:auth:integration` | PASS, exit 0; 46/46, 34.22 s; `integration-final.log` |
| `pnpm typecheck` | PASS, exit 0 after the documented fixes; `typecheck-final.log` |
| `pnpm format:check` | PASS, exit 0; 151 files, 0.861 s; `format.log` |
| `pnpm lint` | PASS, exit 0; 156 files, 0.622 s; unchanged 124 warnings / 1 info; `lint.log` |
| `$env:ENOUGH_PHASE2_INTEGRATION='0'; pnpm test` | PASS; 68 passed / 46 deliberately skipped, 5.28 s; `unit.log` (integration passes recorded separately) |
| `pnpm audit --json` before/after | Both exit 1 with findings; 19 → 18 entries, high 9 → 8, critical 3 and moderate 7 unchanged; full disposition in `PHASE_2_DEPENDENCY_SECURITY.md` |

## Final preparation/build evidence recovered on resume — 2026-10-09

The following retained evidence was inspected on resume; these commands were
not rerun. The previous handoff recorded successful exits, but this appendix had
not been filled. Log text alone does not independently recover shell exit codes.

| Previous command | Retained evidence inspected |
| --- | --- |
| `node scripts/phase2-runtime.mjs prepare` | `manual-prepare-final.log`, last written 09:42:38 local: migration precheck passes on PostgreSQL 18, no pending migrations, API/web ready on 4402/3302, verified disposable credentials saved without printing, preparation complete and PostgreSQL stopped |
| `pnpm desktop:build` | `desktop-build.log`, last written 09:42:38 local: invokes the desktop build script; current `apps/desktop/dist/main.mjs` exists. PASS remains the prior handoff's recorded result, not a new execution |
| `pnpm extension:build` | `extension-build.log`, last written 09:42:41 local: all four Chrome/Firefox Vite build stages finish successfully; current manifests and bundles remain under `apps/extension/dist` |

Read-only resume inspection also found `integration-final.log` reporting 46/46
passes in 34.22 s and shutdown, `typecheck-final.log` ending with workspace checks
Done, and `unit.log` reporting 68 passes / 46 skipped in 5.28 s. Source diffs
still contain the documented OAuth fix, isolated targets, client tests and only
the Drizzle lockfile upgrade. This reconciles the prior record; it is not a new
test run or proof of an immutable tested revision.

Current SHA-256 fingerprints captured with `Get-FileHash -Algorithm SHA256`
(paths relative to the repository; hashes captured on resume, not at test time):

| Artifact / retained log | SHA-256 |
| --- | --- |
| `apps/desktop/dist/main.mjs` | `CC1DAFD198F18BDBB81F22F9781BD0FFBBF84B6958401E73A7C9659DA3D3DE47` |
| `apps/extension/dist/chrome/background.js` | `9062A775830073ED22DED272DCA75B25C56CA59B3F47CF4B8A926617276A0C8C` |
| `apps/extension/dist/firefox/background.js` | `9062A775830073ED22DED272DCA75B25C56CA59B3F47CF4B8A926617276A0C8C` |
| `.runtime/phase2/integration-final.log` | `F9ED58D99BE058248EBC9473B0632A7D564AD6F393401A778A44A6993D812022` |
| `.runtime/phase2/manual-prepare-final.log` | `497CBE89DA0EEEA21602EAC49E26DF361EF2BC5EC4C38970587C996CC20EAF21` |

Current `Get-NetTCPConnection` inspection found only the original loopback
55432/56379/4400/3301 listeners among the original and fixture Windows ports;
55433/56381/4402/3302 were absent. WSL listener state was not newly probed.
`git check-ignore` confirmed the manual credential file remains ignored.
No test service, account or production state changed on resume.

Installed-client continuation was attempted through the Computer Use skill:
`@oai/sky` initialization followed by `sky.list_apps()` returned native pipe
unavailable (Windows os error 2), before any app selection or input. No D1/E1–E3
acceptance is claimed. User results or an accessible installed-client session
with exact test-profile extension origins remain required. Phase 2 stays PARTIAL;
Phase 3 stays on hold and launch stays NO-GO.
