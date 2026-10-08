# Enough browser extension

Phase 10 browser extension source for Chrome, Edge, Brave, and a Firefox compatibility build. It is a Manifest V3 TypeScript application bundled by Vite.

## Build

From the monorepo root:

```sh
pnpm install
pnpm extension:build
```

Load `apps/extension/dist/chrome` as an unpacked extension in Chrome, Edge, or Brave. Load `apps/extension/dist/firefox` temporarily in Firefox. The Firefox build uses the same browser API compatibility layer and a generated Manifest V3 background-script entry.

For store upload archives, run `pnpm extension:release:artifacts`. This creates Chrome Web Store, Edge Add-ons, and Firefox Add-ons ZIPs under `apps/extension/dist/store-packages/`. Publisher account setup, listing IDs, store review, and submission remain release-owner tasks.

## Connect the extension

1. Start the API and web services and apply migrations `0002` through `0008` in a local development environment.
2. Copy the extension origin shown on the browser's extensions page. Add that exact origin to `AUTH_ALLOWED_ORIGINS`, restart the API, then open the extension settings.
3. Enter the API origin (`http://127.0.0.1:4000` is allowed for local loopback development; remote API addresses must use HTTPS) and use either email/password or an extension access token generated once from the signed-in account page. Password sign-in requires a verified email.
4. The extension asks for host permission only for that API origin. Sign-in creates a distinct `extension` device and bearer session.
5. Open the popup and sync policy. Select the product whose device/product rules should apply.

Chrome uses an origin such as `chrome-extension://<extension-id>`. Firefox uses the installed add-on's `moz-extension://...` origin. Keep the configured origin exact; `AUTH_ALLOWED_ORIGINS` is not a wildcard list.

## Runtime behavior

- Policy and domain classification data are cached in extension storage and synchronized every five minutes. The extension evaluates the shared policy and classification code locally. Dynamic rules block top-level navigations before content loads; blocked navigation opens the extension's focus page.
- Domain patterns come from the seeded catalog, account mappings, active rule keys, overrides, and the initial developer-domain list. The browser policy supports up to 900 domain candidates per sync; the popup reports when that bound is reached. Top-level page navigations are covered; embedded frames are not.
- Build Mode applies the selected account/product/device rules. Growth Mode lasts 60 minutes and adds a local market-tool allowlist for Gmail, Outlook, LinkedIn, X, Reddit, Calendar, Analytics, HubSpot, and Salesforce.
- Domain tracking is off by default. When enabled, the extension queues `browser.domain_visited` activity and uploads only the hostname, mode, and policy action. It does not collect path, query, page title, or content. Offline events are retained for at most seven days and at most 1,000 queued events; overflow and expired-event counts are shown in the popup.
- The popup reports policy sync, blocking-rule, queued-event, and native-agent status. Native messaging checks `com.enough.agent` and polls the desktop tray agent's heartbeat; a heartbeat older than 20 seconds is reported as degraded. See `apps/desktop/README.md` for local setup.
- A synced cached policy remains active while the API is unreachable for up to 24 hours. The extension detects a material wall-clock jump while its worker is running and a backward change compared with its last stored clock observation; either condition expires the local policy. It clears its owned dynamic rules and pauses enforcement until policy sync succeeds. Forward clock changes while the browser is stopped cannot always be distinguished from real offline time; large jumps still expire the cache. If the extension is disabled, it cannot enforce policy; stale rules are cleared when its worker next starts. The popup shows the last sync and connection error; server-side policy changes take effect after a successful sync.

The Chromium and Firefox source builds and Chrome/Edge/Firefox store ZIP generation succeed. Browser installation, store review, offline and policy-parity behavior, and runtime acceptance remain pending. Verify the API-origin CORS allowlist and native host installation before release.
