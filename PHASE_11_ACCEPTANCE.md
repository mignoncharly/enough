# Phase 11 — Desktop Agent Acceptance

**Status: ACTIVE — P11-1 PASS, P11-2 PASS, P11-3 PASS, P11-4 BLOCKED, P11-5 BLOCKED.** Phase 11 is not complete. Preserve accepted Phase 1–10 behavior. Phase 11 follows the existing Enough Electron/native-host architecture and Windows-first sequence. Production remains NO-GO while all 18 dependency-security findings remain open.

## Scope and evidence

- P11-1 — Windows desktop startup, authenticated connection, policy sync, and product selection.
- P11-2 — Active-application classification and enforcement, grace period, emergency bypass, and system lock/idle handling.
- P11-3 — Signed policy cache, offline behavior, recovery, and desktop-session revocation.
- P11-4 — Native-host registration and browser heartbeat/restart behavior.
- P11-5 — Packaged updater signature/download/install/rollback and runtime acceptance on each declared supported platform.

Automated evidence: signed snapshots bind user, device, rules, overrides, application catalog/mappings, and owned product IDs; validity is capped at 24 hours. Unit tests reject changed rules/product scope, expiry/overlong validity, wrong user/device, and unknown keys. Native-host subprocess tests cover supported message framing, unsupported requests, and fresh/stale heartbeat using temporary directories. Final verification passed: `pnpm test` (102 passed; 137 opt-in integration/runtime tests skipped), `pnpm typecheck`, `pnpm desktop:build`, `pnpm format:check`, scoped Phase 11 Biome checks, and `git diff --check`. The isolated Phase 11 prepare smoke passed migrations through `0017`, service readiness, and disposable account/policy setup; the consolidated Windows manual fixture also stopped and its marked TEMP directory was removed. Full-workspace lint remains nonzero on pre-existing diagnostics in unrelated files.

P11-1 through P11-3 passed in one consolidated Windows manual session. P11-4 is BLOCKED because the current restriction prohibits modifying browser profiles or protected configuration needed to test browser registration. P11-5 is BLOCKED because signed updater/package credentials and the required macOS/Linux runtime environments are unavailable. Do not mark Phase 11 COMPLETE until P11-4 and P11-5 are resolved and accepted.

## One consolidated Windows manual session

This session was completed once. It used a disposable account, API, database, Redis, desktop user-data directory, heartbeat, and signing key under `%TEMP%\enough-phase11`. It did not load root `.env`, touch `.runtime`, register a browser host, or write the normal desktop profile.

### Fixture and desktop startup

1. In PowerShell terminal A, run:

   ```powershell
   pnpm test:desktop:serve
   ```

   Expected: isolated PostgreSQL/Redis/API/worker/web start on `55942/56403/4420/4421/3312`; the disposable account file is prepared without printing token values. Fixture files stay under `%TEMP%\enough-phase11`.

2. In PowerShell terminal B, redirect desktop state to the fixture, load only the fixture public key, and start the desktop source build:

   ```powershell
   $env:APPDATA = Join-Path $env:TEMP "enough-phase11\appdata"
   $env:ENOUGH_POLICY_SNAPSHOT_PUBLIC_KEY = Get-Content (Join-Path $env:TEMP "enough-phase11\policy-snapshot-public.pem") -Raw
   $env:ENOUGH_DESKTOP_USER_DATA_DIR = Join-Path $env:TEMP "enough-phase11\desktop-data"
   pnpm desktop:start
   ```

   Expected: Enough opens with its isolated app data. The development build reports that updater checks are available in packaged builds.

3. In the desktop login card, enter API address `http://127.0.0.1:4420`. In **Desktop access token**, use the `desktopAccessToken` value from `%TEMP%\enough-phase11\manual-account.json`, then click **Connect token**.

   Expected: the fixture account connects, its two seeded products load, and policy status is fresh. The API origin and token are fixture-only.

### P11-1 — Connect, sync, and choose a product

4. Click **Sync policy**. In the **Product** selector choose `Phase 11 Desktop Policy`, then choose `Phase 11 Desktop Alternate`, then return to `Phase 11 Desktop Policy`.

   Expected: each selection remains visible after sync; the primary product carries the seeded Notepad rule, the alternate product does not, and no policy-load error appears.

### P11-2 — Monitor, enforce, bypass, and pause on lock

5. Set **Grace period** to `30 seconds`. With `Phase 11 Desktop Policy` selected and Build mode active, open Windows Start, type `Notepad`, and launch **Notepad**. Wait 30 seconds.

   Expected: the detected application is Notepad and the restricted-app reminder appears after the configured grace period.

6. On the reminder, enter reason `P11 emergency acceptance`, choose `5 minutes`, and click **Emergency unlock**.

   Expected: Notepad is temporarily allowed; the bounded five-minute bypass and reason are shown/recorded. Leave Notepad open until the five-minute bypass expires.

   Expected: the policy is reapplied after expiry and the restricted-app reminder returns after the 30-second grace period.

7. Press **Win+L**, unlock Windows, and return to Enough. Keep Notepad closed while locked.

   Expected: monitoring pauses while Windows is locked and resumes after unlock without a false active-app interval or a stuck reminder.

### P11-3 — Signed offline policy, recovery, and revocation

8. In terminal A press **Ctrl+C** to stop the Phase 11 fixture services. Keep the desktop app open, select the primary product, and launch Notepad again.

   Expected: the last valid signed snapshot remains usable during its unexpired offline window; the sync status reports the unavailable API while the seeded Notepad rule still applies.

9. Restart the fixture in terminal A with `pnpm test:desktop:serve`. Click **Sync policy** in Enough.

   Expected: API connectivity and the same signing key recover; the session remains connected and the signed policy returns to fresh.

10. In a third PowerShell terminal, run:

    ```powershell
    pnpm test:desktop:revoke
    ```

    Expected: the helper reports that the prepared desktop session was revoked and prints no token values. Back in Enough, click **Sync policy**.

    Expected: the revoked session is rejected and Enough returns to the signed-out state. In **Desktop access token**, use `recoveryAccessToken` from the same fixture file and click **Connect token**.

    Expected: the second fixture desktop session reconnects and policy sync succeeds.

11. In terminal A press **Ctrl+C** and wait for fixture shutdown. Then run:

    ```powershell
    pnpm test:desktop:clean
    ```

    Expected: cleanup confirms the fixture services stopped and removes only `%TEMP%\enough-phase11`. Close Enough; confirm its process exits. Set report `Fixture stopped: YES` only after both confirmations.

## Environment correction and manual results

Windows excluded TCP range `55435–55534` prevented the original Phase 11 PostgreSQL fixture port `55442` from binding; PostgreSQL reported `Permission denied`. The fixture PostgreSQL port was moved consistently to `55942` in fixture startup, cleanup, the manual-account target assertion, and this acceptance procedure. The Windows excluded-port configuration was not changed.

- **P11-1 PASS:** Desktop connected to the isolated fixture. Product switching and policy sync worked; Alternate allowed Notepad with no active rule, while Desktop Policy blocked Notepad and reported `Matched rule: Phase 11 Notepad focus rule`. No policy-load error occurred.
- **P11-2 PASS:** The 30-second grace period and restricted-app reminder worked. The first acceptance exposed the reminder-focus defect; the fix and automated regression checks passed. Focused retest confirmed the reminder stayed interactable, accepted reason `P11 emergency acceptance` and a five-minute duration, and activated Emergency unlock. Notepad remained usable during the bypass; policy reapplied after expiry and the reminder returned after the next 30-second grace period. Win+L/unlock passed without a stuck reminder or false active-app state.
- **P11-3 PASS:** With the fixture API stopped, Sync policy reported fetch failure without signing out, and the last valid signed policy continued enforcing the Notepad restriction offline. Restarting the fixture recovered sync. Revoking the prepared desktop session caused the next sync to sign out; `recoveryAccessToken` reconnected successfully and policy sync recovered. The desktop exited and `pnpm test:desktop:clean` succeeded with: “Removed only TEMP/enough-phase11 after confirming its services were stopped.”
- **P11-4 BLOCKED:** Current restrictions prohibit modifying browser profiles or protected configuration required for native-host registration and browser restart acceptance. The automated native-host protocol tests do not replace browser-registration evidence.
- **P11-5 BLOCKED:** Signed updater/package credentials and the required macOS/Linux runtime environments are unavailable, so signed package/update and cross-platform runtime acceptance cannot be performed.

P11-1 through P11-3 are accepted Windows evidence. P11-4 and P11-5 remain blocking acceptance gates; Phase 11 stays ACTIVE and must not be marked COMPLETE. The canonical plan permits recording a partial checkpoint, but not a Phase 11 completion checkpoint, while these gates remain blocked.

## Report

Browser/version: Not tested (P11-4 BLOCKED)

Windows/version: Not recorded

P11-1 PASS
P11-2 PASS
P11-3 PASS
P11-4 BLOCKED
P11-5 BLOCKED

Failure details: No remaining failures in P11-1–P11-3. The initial P11-2 reminder-focus defect was fixed and passed focused retest; P11-4 and P11-5 remain BLOCKED for the reasons above.

Fixture stopped: YES
