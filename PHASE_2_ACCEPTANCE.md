# Phase 2 — Authentication, Users, Sessions, Devices

Date: 2026-10-09. Status: **PASS — Phase 2 scope verified**. Product launch: **NO-GO**.
Canonical repository: `C:\Enough`. Phase 1 is COMPLETE at `7e78c9d87ea993c7e95530b56dc5db9da1f8d4e7`. HEAD and the locally recorded origin/main both remain `0b3df3a65ffef936409cc03c7493923f92a61b9c`. This acceptance covers the reviewed, tested **uncommitted working tree** over that revision; it does not claim a clean committed snapshot. Windows development only; no Docker, GitHub Actions or production deployment. Phase 3 is technically ready to begin after the user's final review and remains on hold in this continuation.

## Final engineering decision — 2026-10-09

All Phase 2 authentication exits are met: web, desktop and both extensions
authenticate, and sessions/devices can be revoked. Real Google/GitHub happy paths
and installed clients are accepted from user reports. Automated security and
account lifecycle verification passed **49/49 integrations**, with **68 default
tests** also passing. Formatting, lint and workspace typecheck pass; lint retains
124 warnings / one informational diagnostic. Earlier successful desktop and
Chrome/Firefox builds remain applicable; their product source did not change in
this final review. The prior Drizzle upgrade and OAuth takeover fix are included
in the tested working tree. See the engineering record for commands and failures.

**True Phase 2 blockers: none.** Dependency disposition is complete, remediation
is not: the refreshed audit still has **18 open entries (3 critical, 8 high,
7 moderate)**. The reviewed paths concern native installation/build and test
tooling, with no exposed Phase 2 auth path found. They remain explicitly owned
release/security work with closure gates in `PHASE_2_DEPENDENCY_SECURITY.md`;
this is no clean-audit claim or launch waiver. The Phase 2 exit contract does not
require all later distribution/toolchain work to be completed first.

No further manual interaction is required for Phase 2. Real email delivery,
signed Firefox installation/full restart and signed distribution remain their
existing later-phase acceptance obligations. Phase 3 was not started; launch
remains NO-GO. Commit the source, tests, fixture scripts, manifests/lockfile and
evidence documents listed in the final handoff; exclude all ignored credentials,
profiles, generated bundles and raw runtime logs.

## Installed-client acceptance complete — 2026-10-09

The user's latest explicit report accepts **Desktop D1–D3 PASS, Chrome E1–E3
PASS and Firefox E1–E3 PASS**. These are user-performed results, not assistant
observations. Do not request duplicate installed-client tests.

Firefox passed token sign-in, matching disposable identity, policy sync, popup
and reload persistence, sign-out persistence, server-side logout revocation,
password re-login, remote session revocation clearing extension authentication,
recovery/re-login and continued web-account usability. The combined report
accepts Chrome E1–E3 and preserves desktop D1–D3 and real Google/GitHub acceptance.

Firefox evidence is for popup/reload persistence in the temporary installation;
full restart of a persistent signed installation was not tested. The user's
explicit acceptance closes Phase 2 installed-client scope. Persistent signed
installation/restart remains distribution acceptance in Phase 24, not another
Phase 2 manual request. This supersedes the older instruction below that kept
Phase 2 pending for that check. Phase 3 stays on hold for the final review.

## Current Phase 2 plan and acceptance session — 2026-10-09

The user's consolidated review supersedes the former manual-pause/table instructions
below. Security and account-lifecycle permutations are **automated engineering work**.
Current evidence applies to the working tree over `0b3df3a`, not a clean committed
revision. See [engineering results](PHASE_2_ENGINEERING_VERIFICATION.md) and
[all 19 dependency dispositions](PHASE_2_DEPENDENCY_SECURITY.md).

| Item | Current status |
| --- | --- |
| D1 desktop verified password sign-in | **PASS — explicit user report, 2026-10-09**; isolated API 4402, verified disposable account, matching identity/workspace, no auth error |
| D2 desktop persistence/logout/re-login | **PASS — preserve prior user evidence** |
| D3 desktop remote revocation/recovery | **PASS — preserve the user's accepted recovery reference below** |
| E1–E3 installed extension | **PASS — explicit combined user report, 2026-10-09** for Chrome and Firefox; Firefox popup/reload persistence as detailed above |
| C1 invalid credentials and renewal | **PASS isolated**; actual desktop/extension handlers against real fixture API, memory-only platform adapters |
| W1 signup/verification, magic-link and password security | **PASS isolated**; no additional manual web happy-path requested |
| W2 deletion/export/session invalidation | **PASS isolated** for the requested local account lifecycle; prior desktop listing/revocation evidence preserved |
| O1/O2 OAuth failures, state/PKCE/replay, verified email and identity | **PASS isolated**; real Google/GitHub happy paths already accepted; preregistration password flaw fixed |
| Dependency audit triage | **DONE** for all 19 original entries; Drizzle fixed; **18 findings remain open**, risky upgrades documented |
| V1 phase closure | **PASS**; final engineering review complete, no Phase 2 blockers; Phase 3 ready after user review, not started |

### Historical installed-client procedure — complete, do not repeat

The following preparation instructions are retained as history only. All D1–D3
and Chrome/Firefox E1–E3 checks are accepted above; their pending/next-step
statements no longer apply.

**D1 PASS — explicit user report, 2026-10-09:** Using
`http://127.0.0.1:4402` and the verified disposable account from ignored
`.runtime/phase2/manual-account.json`, the Enough Desktop App connected
successfully, showed the matching disposable account, loaded the workspace and
displayed no authentication error. **No products yet** appeared as expected.
Credentials are omitted. This accepts D1 email/password sign-in; D2/D3 remain
accepted from prior evidence. Do not repeat any of these desktop checks. Last
observed desktop state in this report: connected to the disposable fixture.
Chrome/Firefox installation, origins and E1–E3 results are not inferred from D1.
Continue only their remaining steps below, reusing the running fixture where
possible; do not restart it or create another account solely to repeat D1.

Prepared 2026-10-09 under the user's latest instruction. Install both extensions
first, then obtain their origins and start the fixture once. Do not request origins
before installation. Steps below describe the prepared session; D1 is now accepted
above, while extension steps remain pending until their results are reported.
Existing desktop D2/D3 and real OAuth results remain accepted and are not repeated.

**Install Chrome:** The verified unpacked folder is
`C:\Enough\apps\extension\dist\chrome` (manifest version 0.1.0, Chrome >=120).
In PowerShell run the following to open a separate test browser data directory:

```powershell
Start-Process chrome.exe -ArgumentList '--user-data-dir=C:\Enough\.runtime\phase2\chrome-profile','--no-first-run','--no-default-browser-check'
```

Do not sign into Chrome or import personal data. In that window open
`chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and
select the folder above. Expect **Enough 0.1.0** without a load error. On its card
copy **ID** (32 letters); its origin is `chrome-extension://` plus that ID, with
no trailing slash. Record the browser version at `chrome://version`.
Pin Enough from the puzzle-piece menu. These are the official
[Chrome unpacked-install steps](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world).

**Install Firefox:** The verified folder is
`C:\Enough\apps\extension\dist\firefox` (version 0.1.0, Firefox >=128).
Open `about:profiles`, click **Create a New Profile**, name it `Enough Phase 2`,
finish, then **Launch profile in new browser** for that profile. Do not sign in,
import personal data or change the normal default profile. In the new window open
`about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and choose
`C:\Enough\apps\extension\dist\firefox\manifest.json`. Expect **Enough** listed.
Copy its **Internal UUID**; the API origin is `moz-extension://` plus that UUID.
The manifest's **Extension ID** is `enough@example.com`; this is NOT the CORS
origin. If needed, **Manifest URL** shows `moz-extension://<UUID>/manifest.json`:
copy only its scheme and UUID. Record Firefox version from `about:support`.
See [Mozilla profile steps](https://support.mozilla.org/en-US/kb/profile-manager-create-remove-switch-firefox-profiles)
and [temporary installation](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/).

**Shared fixture setup, after both installations:** In PowerShell at `C:\Enough`,
replace both placeholders with the just-installed origins and run once:

```powershell
pnpm test:auth:serve 'chrome-extension://<CHROME-ID>,moz-extension://<FIREFOX-INTERNAL-UUID>'
```

Keep that terminal running. Expect API/web ready at 4402/3302 and the message that
verified disposable credentials were saved. Open
`C:\Enough\.runtime\phase2\manual-account.json` locally in an editor. Use its
`email`, `password`, `apiBaseUrl` and `extensionToken`; do not report their secret
values. This command creates a fresh verified test account each time, so do not
restart it between clients. No root `.env` edit, wildcard CORS or active account.
If startup fails, report the error and stop before client sign-in.

In the Chrome test window, open `http://127.0.0.1:3302/login`, sign in with that
disposable email/password and leave the account page open for session controls.
Use **Sessions and devices → Refresh** to inspect sessions. This is preparation
for extension revocation, not another web acceptance test. Never open the fixture
web account in the personal browser profile: cookies do not isolate localhost ports.

**1. Desktop D1 — PASS; retained procedure, do not repeat**

1. Open Enough if already running; otherwise run `pnpm desktop:start` from a
   second PowerShell window at `C:\Enough`.
2. Enter API address `http://127.0.0.1:4402`, disposable email/password, then
   **Sign in** under **Email and password**.
3. Expect **Connected**, the exact disposable email, loaded workspace and no auth
   error. **No products yet** is valid for this fresh account; do not onboard it.

Report: `D1 PASS/FAIL; Connected; disposable identity matches; workspace loaded;
auth error: none/<exact text>`. No restart, sign-out or remote revocation check:
desktop persistence/logout/re-login (D2) and revocation/recovery (D3) already pass.

**2. Chrome E1–E3 — use the prepared extension token**

1. Open Enough popup → **Open extension settings**. Enter API address 4402 and
   paste the JSON file's `extensionToken` into **Extension access token (optional)**.
   Click **Grant API access and sign in**, allowing the requested API host access.
   Expect **Connected as <disposable email>** and a successful policy sync. Record
   permission behavior and any error; a successful flow demonstrates the installed
   host-access/CORS path without extra console inspection.
2. Close/reopen popup: identity persists. Close all windows of this isolated Chrome
   instance, rerun its launch command, open Enough: same identity without credentials.
   Keep the fixture terminal and Firefox running; do not exit personal Chrome.
3. Popup → **Sign out**. Expect **Not connected**; reopen popup to confirm it stays
   signed out. In the test web account, Refresh: **Phase 2 manual extension token**
   session shows **Revoked**. The device row may remain; do not revoke it.
4. Open extension settings, leave the token blank, enter disposable email/password
   and click **Grant API access and sign in**. Expect connected and synced. Refresh
   web sessions: the active password session is **Enough Chromium extension**.
5. In the test web account click **Revoke** for that active extension session only.
   Click extension **Sync policy**; expect **Not connected** and sign-in controls.
   Sign in again with disposable email/password: connected and synced. Web account
   Refresh still works. This is the sole Chrome remote-revocation variant.

Report: Chrome version + extension version/origin; E1 token/permission/sync result;
E2 popup persistence, full restart persistence, logout + server Revoked,
signed-out popup persistence, password re-login; E3 remote clearing, recovery and
web continuity. Give PASS/FAIL per observation and exact errors if any.

**3. Firefox E1–E3 — use its own token**

1. In the same disposable web account choose **Register a desktop app or extension**:
   Client name `phase2-firefox`, Type **Browser extension**, **Create token**.
   Copy the token shown once into Firefox Enough → **Open extension settings**,
   with API address 4402. Click **Grant API access and sign in** and allow the API
   host prompt if shown. Expect connected with matching email and successful sync.
   Do not reuse Chrome's token: its logout revoked it.
2. Close/reopen popup, then click **Reload** for Enough in Firefox `about:debugging`.
   Reopen popup: same identity without credentials. Keep Firefox open.
3. Popup → **Sign out**, then reopen popup: **Not connected** persists. Web Refresh:
   **phase2-firefox** session is **Revoked**. Leave token blank and sign in with
   email/password in extension settings: connected and synced.
4. Web Refresh → **Revoke** for the active **Enough Firefox extension** session.
   Extension **Sync policy** clears authentication. Sign in with email/password
   again: connected and synced; web Refresh remains usable.

Report the same E1/E2/E3 observations as Chrome, using **popup/reload persistence**
instead of full restart. Also report Firefox version, extension version,
Internal UUID/origin, and whether a host prompt appeared or access was already
granted. Firefox temporary installs disappear on browser restart and do not fully
reproduce signed-install permission behavior. This session cannot establish normal
Firefox browser-restart persistence; keep that acceptance item explicitly pending
for a persistent signed install, with no phase-completion claim or silent waiver.
Do not disable signature checks or remove/reinstall merely to simulate a restart.

Leave activity tracking off; native desktop connection, policy enforcement,
onboarding, invalid credentials and OAuth permutations are outside this session.
Return one combined report, without passwords/tokens. If blocked, stop that client
at the failing step and report it instead of repeating accepted work. After all
observations are recorded, Ctrl+C in the fixture terminal stops its services.
Post-shutdown disconnected clients are not evidence of an auth failure.

## Historical manual acceptance and supporting verification

Recorded 2026-10-08 from the user's explicit manual report, not assistant browser interaction:

| Provider | Availability reported by user | First login | Logout | Second login |
| --- | --- | --- | --- | --- |
| Google | `google=true` | PASS — manual | PASS — manual | PASS — manual |
| GitHub | `github=true` | PASS — manual | PASS — manual | PASS — manual |

Both real-provider successful login/logout/re-login requirements are accepted on that evidence. No cancellation, tampered callback, unverified-email, replay, account-linking, desktop or extension browser action is implied by these results. OAuth secrets remain only in gitignored `C:\Enough\.env`; no secret values were read, copied or printed for this update. Providers remain configured.

The user also reports migrations 0002–0015 applied, `pnpm db:precheck` with no pending migrations, web at 3301, API at 4400, and worker at 4001 using Redis/Memurai. These reports supersede the earlier fixture runtime description for the user's active runtime. Independent read-only probes in this continuation could not reach any of the three readiness URLs; API curl returned connection failure (HTTP 000), and no listeners on those ports were returned by `Get-NetTCPConnection`. This is a current reachability prerequisite, not evidence that the reported manual OAuth results failed. Do not replace the user's configured runtime with the old provider-disabled fixture.

Supporting checks on commit `0b3df3a`:

| Check | Current result |
| --- | --- |
| `pnpm test` | PASS; 68 passed, 34 opt-in integration tests skipped; Vitest duration 5.34 seconds |
| `pnpm desktop:build` | PASS; source build |
| `pnpm extension:build` | PASS; Chrome and Firefox bundles |
| `git status --short` before edits | Clean |
| HEAD / recorded upstream | Both `0b3df3a65ffef936409cc03c7493923f92a61b9c`; user reports origin/main current; no fetch/push performed |
| `git check-ignore .env` | PASS; ignored |
| Current service readiness/provider flags | Unreachable from this session; live flags above are user-reported |

The historical 34-test integration pass below remains evidence for the committed security changes; it was not rerun here. `pnpm test:auth:integration` is tied to the old PostgreSQL/Redis fixture and its live HTTP test expects both providers disabled on ports now assigned to the user's configured runtime. Do not run it blindly, disable providers, or point its mutations at the manual acceptance database. No database or service configuration was changed in this continuation.

## Desktop startup blocker discovered and remediated

During D1 manual acceptance on Windows, the user ran `pnpm desktop:start` and observed `SyntaxError: Named export 'autoUpdater' not found` because the ESM desktop entry imported a named export from CommonJS `electron-updater`. This is a High Phase 2 client-startup blocker; the earlier successful bundle build did not exercise Node/Electron module loading.

Remediation in `apps/desktop/src/main.mjs`: use `import electronUpdater from "electron-updater"` and `const { autoUpdater } = electronUpdater`. The ordinary build regenerated `dist/main.mjs`; no generated file was patched. The bundled import/destructuring were verified, along with the existing updater event handlers and `checkForUpdates()` call. Updater behavior, release configuration, dependencies and lockfile were not changed.

Verification on Windows after the fix:

- `pnpm --filter @enough/desktop build`: PASS (exit 0).
- `pnpm exec biome check apps/desktop/src/main.mjs`: PASS (exit 0, no diagnostics).
- `pnpm desktop:start`: rebuilt and launched Electron without the reported module-import exception; process inspection showed a responding window titled `Enough` from this repository's Electron executable. This is startup evidence, not sign-in or full visual acceptance. The Computer Use helper was unavailable (`native pipe` connection failure), so no screenshot/UI interaction was claimed.
- `pnpm test`: PASS, 68 passed and 34 opt-in integration tests skipped (7.11 seconds). The desktop `.mjs` package has no TypeScript check script; its build and focused lint are the relevant source checks.

After observation, the assistant deliberately stopped only the main desktop process it launched (PID 6912) so the user's next run can start fresh. Consequently the long-running `pnpm desktop:start` command ended with status 4294967295; this was caused by test cleanup, not a recurrence of the startup exception. A clean interactive quit was not tested.

Status updated 2026-10-08: startup import defect **resolved; user visual retest PASS**. The user already reran `pnpm desktop:start`, confirmed that the desktop opens to the SIGN-IN SCREEN and reported no remaining JavaScript startup error. The subsequent token authentication result is PASS as recorded below. Do not repeat launch acceptance or the updater fix. Phase 2 remains PARTIAL; Phase 3 is on hold.

### Desktop API address clarification and accepted token authentication

Source inspection confirms manual API entry (option A). Phase 2 requires desktop authentication and revocation but does not require local desktop configuration inheritance. `apps/desktop/src/main.mjs:48` initializes `apiBaseUrl: ""`; the renderer HTML's `http://127.0.0.1:4000` is only a placeholder. `renderer/app.js:61` restores a saved address or preserves the actual input; both submit handlers (`:173`, `:182`) pass `.value`. Main-process login/token handlers normalize the supplied origin; an untouched empty field fails `normalizeApiOrigin` with `Enter a valid API origin.` Desktop start/build/main code does not consume `API_BASE_URL` or load root `.env`. No product code change is required for this acceptance.

**Manual token authentication PASS — user report, 2026-10-08:** entered API address `http://127.0.0.1:4400`; created a Desktop token from the web account; connected successfully. Desktop displays **Connected**, the correct account (personal email omitted), and the loaded workspace. Active application detection is working; no authentication error is visible. Account displays **No products yet**. These observations accept token connection and identity/workspace rendering only; they do not establish full monitoring behavior, persistence, sign-out, revocation, password login or onboarding. Explicit web session/device listing evidence remains pending.

**D2 session persistence PASS — user report, 2026-10-08:** after quitting Enough from the Windows system tray and restarting with `pnpm desktop:start`, the desktop returned as **Connected** with the same account and workspace, without re-entering the API address or token. This accepts session persistence only; sign-out and session invalidation are still pending.

**D2 sign-out persistence PASS — recorded 2026-10-09 from user report:** after signing out, quitting via the Windows tray and restarting with `pnpm desktop:start`, the desktop remained signed out and displayed **Not connected / the sign-in screen**. This accepts local sign-out persistence. Source review shows `logout()` catches `/auth/logout` failures before clearing/persisting local state, so server-side session invalidation remains a separate pending check.

**D2 server-side session revocation PASS — user report, 2026-10-09:** after desktop sign-out and web **Sessions and devices → Refresh**, the tested desktop session showed **Revoked**. The registered desktop device remained listed separately with **Revoke device**, which the user did not click. No new token was created. Personal device label omitted. This is accepted server-state evidence for logout and explicit D1 session/device listing evidence. It supersedes the earlier pending logout-invalidation status; it does not establish D3 remote revocation while the desktop is connected.

**D2 reconnect after sign-out PASS — user report, 2026-10-09:** created a fresh Desktop token named `desktop-relogin-test`, entered `http://127.0.0.1:4400` in the desktop and connected with it. Desktop returned to **Connected** with the same account and workspace; no authentication error appeared. Desktop was left connected. **D2 COMPLETE:** accumulated manual evidence accepts session persistence, sign-out persistence, server-side logout revocation and subsequent legitimate sign-in. Earlier pending D2 statements are superseded. Phase 2 remains PARTIAL; D1 password login and D3 remote revocation are still pending.

**D3 remote session revocation PASS — user report, 2026-10-09:** after revoking the active `desktop-relogin-test` session in the web app, the desktop returned to **Not connected / sign-in** when syncing policy and displayed **Authentication required**. The web app remained usable after **Refresh**. This accepts remote session revocation and unrelated web-session continuity, superseding the earlier pending session-revocation status. Recovery and device revocation remain pending; D3 is PARTIAL.

<a id="d3-accepted-recovery-evidence"></a>

**D3 recovery after remote session revocation PASS — user report, 2026-10-09:** a fresh Desktop token named `desktop-device-revoke-test` restored connection to `http://127.0.0.1:4400`. Desktop displayed **Connected**, the same account and workspace, without authentication errors. The user left it connected for the device-revocation test. This supersedes the earlier pending session-revocation recovery status. The user subsequently accepted this same evidence for the final D3 recovery requirement, as recorded below.

**D3 remote device revocation PASS — user report, 2026-10-09:** the `desktop-device-revoke-test` session shows **Revoked** and the registered device shows **desktop · revoked** in the web app. Desktop is **Not connected** and was left signed out. The web app remains usable with its current web session still active. This accepts device/session revocation, desktop disconnection and unrelated web-session continuity, superseding the earlier pending device-revocation status. The exact desktop error and manual-versus-automatic sync timing were not reported and are not inferred. D3 remains PARTIAL only for recovery after device revocation.

**D3 PASS — explicit user acceptance decision, 2026-10-09:** the user accepts the [existing fresh-token recovery evidence](#d3-accepted-recovery-evidence) as satisfying the final D3 recovery requirement for both revocation cases. Separate session revocation, device revocation and unrelated web-session continuity already passed. A second recovery after device revocation was not executed and is not claimed; the user explicitly judged the existing evidence sufficient and instructed that the duplicate test not be requested. This closes D3 and supersedes all earlier pending D3 recovery statements and the proposed `desktop-device-recovery-test` step. Last reported desktop state: signed out.

**Manual acceptance paused for consolidated review — user instruction, 2026-10-09:** D3 remains PASS. D1 email/password manual verification is PENDING; do not start it or create another disposable account. No further manual tests are requested until the user reviews the [consolidated list](#consolidated-manual-phase-2-review). Preserve desktop signed out and the current web session. Phase 2 remains PARTIAL; Phase 3 remains on hold until that review; launch NO-GO.

Inspection commands/results are recorded in `REMEDIATION_HANDOFF.md`. HEAD remains `0b3df3a`; the existing updater change was inspected and preserved. No desktop restart, tests, service changes, database operations or production actions were performed in this clarification; documentation only.

## Scope and accepted local behavior

Scope follows Phase 2 in `ENOUGH_COMPLETE_IMPLEMENTATION_PLAN.md` and the tracker in `IMPLEMENTATION_PLAN.md`. Existing authentication architecture is retained. Passkeys remain deferred under the previously accepted practical-scope exception.

| Requirement | Local evidence | Status |
| --- | --- | --- |
| Authentication migration | `0002_authentication.sql` already applied through the runner during accepted Phase 1; no migration rewrite | Accepted; no new schema change |
| Signup and verification | Real database signup, generic duplicate response, normalized email, unverified-login rejection, verification replacement/replay/expiry | Passed |
| Password login and password reset/change | Correct/incorrect password, reset invalidation of existing sessions/pending magic links, replay rejection and concurrent credential changes | Passed |
| Passwordless option | Local preview and concurrent one-use magic-link consumption | Passed locally |
| Local email option | Explicit development preview intercepted only in process memory; URLs use fragments; production preview rejected | Passed; no Resend delivery claim |
| Web authentication | HTTP cookie/proxy and CSRF checks; user manually verified real Google/GitHub login, logout and second login | Web OAuth happy paths passed; remaining account UI journeys below |
| Desktop/extension authentication | Both bearer types register devices, authenticate and revoke over real HTTP and real DB/Redis route tests | Passed at API-contract level; installed-client acceptance pending |
| Session/device management | Own-account lists, cross-account rejection, individual session/device revocation and old-token rejection | Passed locally |
| Rotation and derived sessions | Cookie rotation invalidates the previous credential; concurrent bearer rotation has exactly one winner; rotation and derived web/desktop/extension sessions retain original authentication time; issuance rejects concurrently revoked/rotated parents | Passed locally |
| Export/deletion | Owner-only export without password/token hashes, password confirmation, passwordless fresh-auth requirement, cascading account deletion | Passed for synthetic local accounts without external billing |
| Security controls | Production cookie flags, CSRF origin/session binding, CORS, no-store responses, hashed credentials, credential-free audit metadata, Redis limits and fail-closed outage | Passed locally |
| Google and GitHub login | User reports real credentials configured and first login/logout/second login passed for each provider | **PASS — user-performed manual acceptance** |
| OAuth security and failure cases | Source state/PKCE/verified-email review; synthetic exchange binding/expiry/replay tests; live happy paths manually passed | Targeted negative/provider identity cases remain unverified; see O1/O2 below |

## Defects fixed

Each defect was demonstrated by a failing regression test before the fix:

1. Two concurrent rotations both returned success; one caller received an already-invalid token. Rotation now compares the authenticated token hash in the SQL update and rejects revoked/expired sessions or revoked devices.
2. Rotation reset `created_at`, bypassing the five-minute fresh-authentication requirement for passwordless deletion. Rotation now preserves the original session creation/authentication timestamp.
3. Password login could issue a new session after a concurrent password replacement. Session creation checks verified-account state and the password hash under the existing account-row lock; stale login is rejected.
4. A stale password change could overwrite a concurrent replacement. Password change now compares the previously verified hash in its SQL update and rejects a changed credential.
5. Cookie handling manually appended existing `Set-Cookie` values although Fastify already appends them. Each cookie is now emitted once, with production host/secure/HTTP-only flags verified.
6. Creating a derived session from an old passwordless session reset authentication freshness and allowed account deletion (204 instead of 403). Derived sessions now inherit the parent's original `created_at`, used as authentication time. Separate web/desktop/extension regressions reject deletion through rotated and derived sessions and accept it after a genuine new magic-link sign-in, without bypassing rate limits.
7. A pending derived-session request could issue a usable credential after parent session revocation, device revocation or token rotation. Three deterministic database-lock regressions reproduced 201 instead of 401. Issuance now revalidates and locks the parent session within the issuance transaction, checking owner, token hash, expiry and device/session revocation before inserting anything. Invalidated requests return 401 and create no device.

No migration, schema, dependency, lockfile, architecture, CI, deployment or client-source changes are required for these fixes.

## Tests and reproducible commands

- `packages/auth/src/auth.integration.test.ts`: 26 opt-in checks with real PostgreSQL/Redis. The fixture target is asserted before mutation; only tracked synthetic accounts are removed. Local previews are captured without printing links or tokens. External HTTP is disabled; no OAuth credentials are stored or providers enabled.
- `packages/auth/src/session.security.test.ts`: three default-suite cookie, CSRF and configuration checks, including production restrictions.
- `apps/api/src/auth-http.integration.test.ts`: eight opt-in checks against the live isolated API and Next.js proxy. Verified synthetic accounts are seeded explicitly for these transport checks; signup/email behavior is covered separately by the route integration suite.
- `scripts/phase2-auth-tests.mjs` and `pnpm test:auth:integration`: load only the existing gitignored fixture environment, assert database/Redis/base-URL targets, clear external-provider variables, and run the local integration files sequentially. Services must already be running; the command does not initialize databases or start providers.

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:auth:integration
pnpm extension:build
pnpm desktop:build
```

Default `pnpm test` intentionally skips the opt-in integration files; skipped checks do not count as acceptance.

## Historical isolated-fixture verification — 2026-10-08

All final checks below exited 0 against the uncommitted Phase 2 working tree based on `7e78c9d87ea993c7e95530b56dc5db9da1f8d4e7`. Environment: Windows, Node v24.19.0, pnpm 11.20.0, PostgreSQL 18, Redis 8.10.2 in Ubuntu WSL. No dependency/lockfile changes, commit, push or production action was made during this continuation.

| Check | Result |
| --- | --- |
| `pnpm format:check` | Passed; 148 files |
| `pnpm lint` | Passed; 124 existing warnings and one informational diagnostic |
| `pnpm typecheck` | Passed across workspace packages |
| `pnpm test` | 68 passed; 34 opt-in integration tests skipped; 4.70 seconds |
| `pnpm test:auth:integration` | 34 passed, none skipped; 26 database/Redis and 8 live HTTP checks; 32.16 seconds |
| `pnpm extension:build` | Chrome and Firefox bundles passed |
| `pnpm desktop:build` | Source build passed; no installer/runtime acceptance claimed |
| Fixture `src/migration-precheck.ts` from `packages/db` | PostgreSQL 18 checksum precheck passed; no pending migrations |
| `git diff --check` | Passed |
| `git check-ignore .env` | Confirmed `.env` is ignored |

Initial integration execution failed because PostgreSQL/API/web had stopped between sessions. Restarted only the existing fixture; Redis already running returned PONG. The next run exposed defect 6, and targeted review/tests exposed defect 7. An intermediate expanded regression hit the intentional three-per-hour deletion limit; using independent accounts per client fixed the test without changing that limit. Final successful runs above supersede those failures. API was restarted after the final source fix. API on 4400 and web on 3301 are left running with fixture credentials and providers disabled; PostgreSQL 55432 and Redis 56379 are local-only. Worker was not needed or restarted for Phase 2.

Source fingerprints (SHA-256; generated build artifacts remain ignored):

| File | SHA-256 |
| --- | --- |
| `packages/auth/src/routes.ts` | `EC30400EA8E8FFCBA11F2240002EE53845280407B260A90D25BF73BAC20BCD7B` |
| `packages/auth/src/session.ts` | `3FB2C6D57018119E57167B5451A38BE50CAC7B78D63BC8E161EEBE7049264A3B` |
| `packages/auth/src/auth.integration.test.ts` | `1B62E674E48E6FE47CEFF639E804E2F58479BC6C195A264802DDE19A960CF2E8` |
| `packages/auth/src/session.security.test.ts` | `4977A252E6C7D81DEE11D5D2732E075EB7A9FE80587B414AC509BA5883C703C8` |
| `apps/api/src/auth-http.integration.test.ts` | `74FADDE0B17F432948D53527D68ABF6FCD6F89E7917E55FFA922DE8D327051A0` |
| `scripts/phase2-auth-tests.mjs` | `D50DF9D61851209E2EE58AA65C2860A279E72278A988E0CFFFA8C18CD5C168F4` |

## Exact OAuth registration values

The code constructs callbacks from `API_BASE_URL` and the routes in `packages/auth/src/oauth.ts`. For the isolated Phase 2 runtime:

| Setting | Exact value |
| --- | --- |
| `APP_BASE_URL` | `http://127.0.0.1:3301` |
| `API_BASE_URL` | `http://127.0.0.1:4400` |
| `WEB_PORT` | `3301` |
| `API_PORT` | `4400` |
| Google callback | `http://127.0.0.1:4400/auth/oauth/google/callback` |
| GitHub callback | `http://127.0.0.1:4400/auth/oauth/github/callback` |

Expected credential variable **names only**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`. The config requires each ID/secret pair together; blank pairs disable that provider. `.env.example` keeps the pairs blank and uses ordinary default API port 4000, so its default callback differs from this fixture's port 4400. Do not register a Next.js `/api/auth/...` URL as the provider callback.

Code read locations:

- `packages/config/src/index.ts:32`: base URL schema; `:50`: four OAuth variable declarations; `:92`: paired-credential validation; `:179`: reads `process.env`; `:190`: base URL defaults from web/API ports.
- `packages/auth/src/oauth.ts:26`: provider availability; `:32`: provider credential selection; `:39`: exact callback construction from `API_BASE_URL`; `:102` and `:450`: callback passed as `redirect_uri` for token exchange and authorization; `:491`: successful return to `${APP_BASE_URL}/oauth/complete`.
- `apps/api/package.json:22`: API dev/start scripts load `../../.env`; root `package.json` dev script loads `.env`. Fixture commands use `--env-file=C:/Enough/.runtime/phase1/fixture.env` instead and do not read the future real credentials.

Real credentials are now configured only in gitignored `C:\Enough\.env`. Never copy them into source, examples, documentation, logs, test fixtures or Git. Preserve the user's current database/Redis settings and enabled providers. The isolated integration runner intentionally disables providers in its test subprocess and is not the real OAuth runner. Do not use its historical startup instructions to replace the current manually verified runtime.

Google requests `openid profile email`; GitHub requests `read:user user:email`. Both routes generate state and S256 PKCE, require verified provider email, then issue a short-lived exchange token bound to the browser's original pre-auth CSRF token. These security mechanisms have source/synthetic-test evidence; user-reported successful real logins do not independently demonstrate all negative cases.

## Automated verification during manual pause — 2026-10-09

Source: HEAD `0b3df3a65ffef936409cc03c7493923f92a61b9c` plus the existing desktop CommonJS updater import fix. Windows, Node `v24.19.0`, pnpm `11.20.0`. No dependency/source changes, account operations, service restarts or client launches. This fresh run supplements the earlier evidence; it does not imply UI acceptance.

| Exact command | Result |
| --- | --- |
| `pnpm format:check` | PASS, exit 0; 148 files, Biome 1.030 s, no fixes |
| `pnpm lint` | PASS, exit 0; 153 files, Biome 1.069 s; existing 124 warnings and 1 info, no fixes |
| `pnpm typecheck` | PASS, exit 0; all applicable workspace packages completed; process polled until completion |
| `$env:ENOUGH_PHASE2_INTEGRATION = '0'; pnpm test` | PASS, exit 0; 68 passed, 34 integration tests skipped; Vitest 5.69 s. Opt-out confined to this command's environment |
| `pnpm desktop:build` | PASS, exit 0; 3.52 s command wall time; source bundle only |
| `pnpm extension:build` | PASS, exit 0; 3.72 s command wall time; Chrome and Firefox artifacts |
| `pnpm audit --json` | FINDINGS, exit 1; 1.99 s command wall time; 3 critical, 9 high, 7 moderate advisories |
| `git check-ignore .env` | PASS; ignored, contents not read |
| `git status --short` / `git diff --stat` after checks | Same three modified files as before checks: desktop source plus these two acceptance/handoff records |

`pnpm test:auth:integration` was not run: its hardcoded fixture ports overlap the user's runtime, its live HTTP assertions expect disabled providers, and its tests create/delete synthetic accounts. The current instruction preserves state and prohibits creating another account. Historical 34-test acceptance remains dated 2026-10-08, not a fresh pass. No installs, migrations, database checks, provider flows, desktop launch or web build into the active `.next` directory were run. Client output paths were confirmed inside this workspace and ignored by Git; no extension was loaded or reloaded.

Generated artifact SHA-256 (`Get-FileHash ... -Algorithm SHA256`):

| Artifact | SHA-256 |
| --- | --- |
| `apps/desktop/dist/main.mjs` | `CC1DAFD198F18BDBB81F22F9781BD0FFBBF84B6958401E73A7C9659DA3D3DE47` |
| `apps/extension/dist/chrome/background.js` | `9062A775830073ED22DED272DCA75B25C56CA59B3F47CF4B8A926617276A0C8C` |
| `apps/extension/dist/firefox/background.js` | `9062A775830073ED22DED272DCA75B25C56CA59B3F47CF4B8A926617276A0C8C` |

Dependency findings remain **OPEN**, owner: engineering, recorded 2026-10-09. Registry severity is retained; application exploitability was not established. No package/lockfile updates were made under the preserve-state instruction. The audit is not a passing security check.

| Dependency path | Audit findings / reference |
| --- | --- |
| Desktop `get-windows` → optional `node-gyp` / `@mapbox/node-pre-gyp` → `tar@6.2.1` | 1 critical, 8 high, 3 moderate; critical [GHSA-23hp-3jrh-7fpw](https://github.com/advisories/GHSA-23hp-3jrh-7fpw). Extraction/traversal, parser/resource and archive-operation advisories require applicability review |
| Development `vitest` → `tinypool@1.1.1` | 2 critical: [GHSA-5gmw-xhrv-c9v3](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3), [GHSA-85c8-ppgw-ccpr](https://github.com/advisories/GHSA-85c8-ppgw-ccpr) |
| `packages/db` → `drizzle-orm@0.44.7` | 1 high: [GHSA-gpj5-g38j-94v9](https://github.com/advisories/GHSA-gpj5-g38j-94v9), identifier escaping |
| Development `drizzle-kit` → `esbuild@0.18.20` | 1 moderate: [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) |
| Development `vitest@3.2.7` and `@vitest/mocker@3.2.7` | 2 moderate entries for [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) |
| Development/optional `electron-builder` → `sprintf-js@1.1.3` | 1 moderate: [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) |

## Superseded consolidated manual Phase 2 review

Historical review only. The current reclassification and compact session above supersede this table and its pause instructions.

**All items below are PENDING review, not instructions to execute.** D1 is explicitly paused. Do not create accounts or resume manual tests until the user decides the scope. D3 remains PASS with its [accepted recovery evidence](#d3-accepted-recovery-evidence). P0, desktop launch/token connection/listing, D2, D3 and real Google/GitHub successful login/logout/re-login are accepted and excluded from repeat work.

| Area / IDs | Remaining manual evidence | Existing coverage and overlap to consider in review |
| --- | --- | --- |
| Desktop password sign-in — D1 | Verified email/password path: Connected, correct test identity, workspace, no authentication error | Backend password/bearer contracts passed historically; desktop token UI already passed. No account creation or password test now |
| Browser extension — E1–E3 | Installed Chrome/Firefox authentication: browser/version/build, exact extension origin, host permission/CORS; token and verified-password sign-in with correct identity and separate device/session; popup/browser persistence; sign-out invalidation and persistence; legitimate re-login; separate remote session/device revocation, sync rejection/state clearing, recovery and unaffected other sessions | Fresh Chrome/Firefox builds passed; backend bearer/revocation contracts passed historically. One set of extension listing/revocation evidence also covers that part of W2 and C1 |
| Client errors and renewal — C1 | Desktop/extension invalid-token and incorrect-password error UI; extension revoked-credential handling; renewal preserves connection and old credentials fail | D3 already covers desktop remote-revocation rejection/state clearing. Backend rotation is covered historically. Controlled renewal setup/assertions are engineering work and need not become user-performed clock manipulation or repeated sign-ins |
| Web account journeys — W1 | Signup/verification; verified-password success and unverified-password rejection; magic-link sign-in; reset/change password; logout and subsequent password sign-in | Backend flows, one-use/expiry/replay and password invalidation passed historically. Successful Google/GitHub login/logout/re-login already accepted. If retained later, signup/verification can also supply D1/E1 prerequisites; no account setup during pause |
| Web account data/lifecycle — W2 | Export download; deletion of an explicitly disposable account with existing-session invalidation; extension listing/revocation only as part of E1/E3 | Desktop session/device listing and revocation UI already accepted; backend ownership, export/deletion and cascades passed historically. Deletion is a distinct destructive UI check and remains paused |
| OAuth negative/identity cases — O1–O2 | For Google/GitHub: cancellation/provider failure without unintended new session; targeted live state/PKCE, tampered callback/replay, verified-email rejection and identity/account-linking behavior beyond happy paths | Happy paths accepted. Source/synthetic state/PKCE/exchange binding/expiry/replay evidence already exists. O2 needs an engineering-defined controlled test matrix/provider identities; it is not a request that the user manually repeat every backend security check |

**V1 is evidence closure, not another manual user journey:** review which gaps retain a manual requirement, record any explicit scope/evidence decisions, resolve engineering findings (including dependency audit), and attach the accepted revision and relevant final regression results. No Phase 2 completion claim follows merely from today's passing source checks. Phase 3 remains on hold until the user's review and applicable Phase 2 exit criteria are satisfied.

## Superseded acceptance and blockers

Historical checklist only. Use the current status table at the top; the expanded manual list below is no longer an execution plan.

The previous absent-credentials/live-login blockers are resolved by the manual evidence above. The remaining checklist tracks the currently documented Phase 2 acceptance gaps; actual results or explicit user acceptance decisions must support closure. Builds/API tests do not substitute for client UI evidence. Manual execution is paused for the user's consolidated review; do not issue further one-at-a-time test requests.

| ID | Remaining acceptance item | Status / required evidence |
| --- | --- | --- |
| P0 | Confirm the configured local runtime is available for manual client testing | PASS — user subsequently opened `/login` successfully and reconfirmed web, API and worker running normally. Earlier assistant probe failures remain recorded as a tool-side observation; no service restart required |
| D1 | Launch Windows desktop and authenticate | Email/password manual verification PENDING — paused by user; do not start or create another account. Existing launch, token connection, identity/workspace and session/device listing remain PASS |
| D2 | Desktop persistence and sign-out | COMPLETE — user-reported session persistence, sign-out persistence and server-side logout revocation PASS; fresh `desktop-relogin-test` token restored Connected, same account/workspace and no authentication error on 2026-10-09. Desktop left connected |
| D3 | Desktop remote revocation | PASS — session and device revocations plus unrelated web-session continuity accepted by user reports on 2026-10-09. User explicitly accepts the [existing fresh-token recovery evidence](#d3-accepted-recovery-evidence) for the final recovery requirement; no duplicate recovery test required or claimed. Last reported desktop state: signed out |
| E1 | Load browser extension and authenticate | Pending; record browser/version and build, exact extension origin, API host permission and exact CORS allowlist; test extension-token and verified email/password paths, correct identity and separate extension device/session |
| E2 | Extension persistence and sign-out | Pending; reopen popup/browser retains valid connection; sign-out invalidates session and remains signed out; subsequent legitimate login succeeds |
| E3 | Extension remote revocation | Pending; separately revoke session and device via web UI, sync and verify old credential is rejected and connection cleared; reconnect succeeds without invalidating unrelated web/desktop sessions |
| C1 | Client error and renewal behavior | PENDING review — invalid-token and incorrect-password UI errors, extension revoked-credential handling (shared with E3), client renewal continuity and old-token rejection. Desktop remote-revocation rejection/state clearing already accepted under D3; do not repeat. Backend rotation already tested; controlled renewal is engineering work requiring an isolated fixture, currently not run |
| W1 | Non-OAuth account UI journeys | Pending interactive evidence; disposable-account signup, verification, verified/unverified password login, magic link, reset/change password, logout and subsequent sign-in. Backend coverage already passes |
| W2 | Web account/session/device UI and destructive account lifecycle | PENDING review — export download, disposable-account deletion and resulting session invalidation; extension listing/revocation shared with E1/E3. Desktop/web listing and desktop revocation already accepted under D1/D3; do not repeat. Backend ownership/export/deletion tests already pass. No account creation/deletion during this pause |
| O1 | Google and GitHub cancellation/error paths | Pending; cancellation returns safely without establishing a new session; no codes/tokens shared in evidence |
| O2 | Targeted OAuth negative/identity acceptance | Pending evidence for live state/PKCE/verified-email and identity handling beyond happy-path login; retain existing synthetic exchange binding/expiry/replay coverage and do not claim these were manually tested. Use approved provider test accounts/controlled checks; never record secrets |
| V1 | Close evidence and regression checks | Pending after interactive results/fixes; retain accepted commit, fresh relevant automated results, final diff/git status and final PASS/PARTIAL report |

No new browser automation or desktop interaction was performed by the assistant in this continuation. Manual testing is paused at the user's instruction; the consolidated list below is for review, not an execution request.
- Passkeys remain intentionally deferred; real Resend delivery is not claimed because the explicitly enabled local preview satisfies the local email option. TLS deployment, installer signing, update acceptance and external Stripe-account cleanup belong to later acceptance and were not exercised here.
- Local concurrency tests use deterministic database locks to exercise the identified races; they do not constitute broad load or formal security assurance.

**Phase 2 acceptance is not fully satisfied. Keep Phase 2 PARTIAL, Phase 3 on hold and launch NO-GO.**
