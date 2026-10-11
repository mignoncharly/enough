# Phase 10 Acceptance — Browser Extension

**Status: COMPLETE — 2026-10-11.** Automated verification and the single consolidated Chromium/Firefox manual session are accepted. The user reported P10-1 through P10-5 PASS with no manual acceptance failures. Do not reopen or repeat these checks.

## Canonical scope

Implement authentication, domain tracking, policy sync, blocking rules, redirect page, Growth Mode, offline cache, native communication, and health state.

**Exit criterion:** “Web development tools can be reliably controlled.”

Preserve accepted Phase 1–9 behavior and evidence. Reuse Phase 2 extension authentication/revocation evidence, Phase 5 activity API/privacy evidence, Phase 6 classification evidence, Phase 7 policy/schedule/override evidence, and Phase 8/9 session and web evidence. Do not repeat those accepted permutations.

## Automated verification

- `pnpm test`: 91 tests passed, 137 opt-in integration tests skipped; includes 11 Phase 10 extension background tests.
- Phase 10 extension background coverage: exact API host permission, token rotation, policy sync, top-level block/focus redirect, product selection, schedule/override precedence, Growth Mode duration/allowlist precedence/expiry, opt-in hostname-only activity, 900-domain candidate bound, online/offline/stale policy behavior, revocation, worker restart, cleanup without a session, and unavailable native-host health state.
- `pnpm typecheck`: passed across all 11 workspace projects, including the extension TypeScript project.
- `pnpm extension:build`: Chromium and Firefox bundles and manifests built successfully.
- `pnpm test:extension:integration`: isolated PostgreSQL/Redis/API/worker/web smoke passed; migrations `0001`–`0017`, migration precheck, and readiness passed. The fixture services stopped successfully. Fixture data remains isolated in `%TEMP%\enough-phase10`.
- `pnpm test:extension:prepare`: disposable-account preparation passed against the same isolated fixture. It created the manual account, two products, policy rules, activity consent, two extension sessions, and revocation-control session; the serving stack stopped successfully. Private tokens were stored only in `%TEMP%\enough-phase10\manual-account.json` and were not printed. Serve mode validates and reuses this account.
- `pnpm format:check`: passed for 170 files.
- `pnpm lint`: exited 0 with 124 warnings and one informational diagnostic; no lint errors.

No migration or dependency change was made. The disposable account, database credentials, and extension tokens stay under `%TEMP%\enough-phase10`; no normal account/runtime, `.env`, `.runtime`, browser profile, or production service is used.

## One consolidated manual acceptance session

Run this complete session once after building. Use only the disposable Phase 10 fixture and the two installed local extensions. Keep the fixture terminal open until the final revocation check, then stop it with Ctrl+C.

### Prepare the isolated fixture

1. Run `pnpm extension:build`.
2. Launch Chromium and Firefox in fresh disposable profiles under `%TEMP%\enough-phase10\chrome-profile` and `%TEMP%\enough-phase10\firefox-profile`. Do not use or inspect a normal browser profile; the temporary profiles hold only this disposable extension session.
3. In Chromium, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `C:\Enough\apps\extension\dist\chrome`.
4. In Firefox, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on…**, and select `C:\Enough\apps\extension\dist\firefox\manifest.json`.
5. Record the Chromium origin shown as `chrome-extension://<32-character-id>`. Open the Firefox extension Options page and record its `moz-extension://<36-character-uuid>` origin from the address bar. The Firefox manifest identity must be `enough@example.com`.
6. Start the isolated stack with the exact installed origins:

   ```powershell
   pnpm test:extension:serve -- "chrome-extension://<32-character-id>,moz-extension://<36-character-uuid>"
   ```

   The fixture uses `%TEMP%\enough-phase10`, PostgreSQL `55441`, Redis `56401`, API `4418`, worker `4419`, and web `3310`. Confirm `http://127.0.0.1:4418/ready` and `http://127.0.0.1:3310` load. The private disposable-account file is `%TEMP%\enough-phase10\manual-account.json`. It contains **Phase 10 browser fixture**, **Phase 10 alternate policy fixture**, a `BLOCK` rule for `127.0.0.1`, a separate `BLOCK` rule for `gmail.com`, and enabled account-level activity consent.

7. In Chromium, open `chrome://extensions` → **Enough** → **Details** → **Extension options**. In Firefox, open `about:addons` → **Extensions** → **Enough** → **Options**. In each browser enter API address `http://127.0.0.1:4418`, paste that browser's matching `chromeExtensionToken` or `firefoxExtensionToken` from the disposable-account file, and select **Grant API access and sign in**. Accept the browser's API-origin permission prompt.

### P10-1 — Browser packages and exact-origin connection

- **Expected:** Both browser packages load without manifest/background errors; Chromium and Firefox show Connected for the disposable account; only the exact local API origin is granted. No real account credentials are entered.

### P10-2 — Product selection and policy blocking

In both browsers, pin Enough if needed (toolbar Extensions/puzzle menu → pin Enough), then click the Enough toolbar icon → **Product** → select **Phase 10 browser fixture**. Open `http://127.0.0.1:3310` in a top-level tab.

- **Expected:** The extension replaces the navigation with its “This site is paused” focus page and identifies `127.0.0.1`.

In both browsers, click the Enough toolbar icon → **Product** → select **Phase 10 alternate policy fixture**. Reload `http://127.0.0.1:3310`.

- **Expected:** The local web fixture loads instead of the focus page.

In both browsers, click the Enough toolbar icon → **Product** → select **Phase 10 browser fixture** again. Reload `http://127.0.0.1:3310`.

- **Expected:** The focus page returns. Product selection is verified using localhost only.

### P10-3 — Growth Mode, worker restart, and native-host health

In Chromium, click the Enough toolbar icon → **Growth**; inspect the mode status, then click **Build**. Reload the extension in both browsers (`chrome://extensions` → **Enough** → **Reload**; `about:debugging#/runtime/this-firefox` → **This Firefox** → **Enough** → **Reload**). In each browser reopen the popup and click **Sync policy**.

- **Expected:** Growth Mode displays its end time within 60 minutes; Build returns to normal policy. After reload, the selected product and policy sync recover in both browsers, and `127.0.0.1` remains blocked for **Phase 10 browser fixture**. The automated test covers alarm expiry and Growth allowlist precedence without opening external sites.
- **Expected native-host state:** The popup reports **Not connected**. Click **Connect desktop agent** once. Since Phase 11's native host is not installed, a recoverable host-unavailable message appears and health remains Not connected; policy enforcement continues.

### P10-4 — Activity opt-in and privacy behavior

In the Enough popup, select **Phase 10 alternate policy fixture**. Confirm **Record visited domains in Enough** starts unchecked. Enable it, then open `http://127.0.0.1:3310/private/path?phase10=fixture` in a top-level tab. Reopen the popup and inspect **Queued activity**; turn tracking off afterward.

- **Expected:** Tracking is off by default and can be enabled only because the prepared account has activity consent. The local navigation is available for extension telemetry. Automated payload verification confirms only `hostname`, `policy_action`, and `mode` are uploaded; `/private/path` and `phase10=fixture` are absent. Tracking is off again before leaving this check.

### P10-5 — Prepared-target revocation, unaffected session, and cleanup

With both extensions connected, run `pnpm test:extension:revoke` once in a second PowerShell terminal. In Chromium, click the Enough toolbar icon → **Sync policy**. In Firefox, click the Enough toolbar icon → **Sync policy**.

- **Expected:** Chromium's prepared extension target becomes signed out and its owned blocking rules are cleared. Firefox remains connected and continues to enforce its policy. No sign-in, credits, web-session, or account-deletion permutations are repeated.
- Stop the fixture with Ctrl+C in the serving terminal.
- Close the temporary browser windows.
- **Expected:** PostgreSQL, Redis, API, worker, and web fixture processes stop; fixture data and disposable profiles remain confined to `%TEMP%\enough-phase10`.

## Manual report

Chromium/version: Not separately recorded

Firefox/version: 157.0.1

Viewport(s): Normal desktop browser windows

P10-1 PASS

P10-2 PASS

P10-3 PASS

P10-4 PASS

P10-5 PASS

Failure details: None reported

Fixture stopped: Not separately recorded in the report

## Release status

The 18 open dependency-security findings remain release obligations. Production launch remains **NO-GO** regardless of Phase 10 acceptance. Browser store signing/publication and the Phase 11 desktop native host remain later distribution/implementation work.
