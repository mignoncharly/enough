# Phase 16 — Reports Acceptance

2026-10-17; baseline `cb80d92a9161f967d6e622b1ec7f29d361afaddd` plus uncommitted Pass 1/2 changes.

**PHASE 16 — REPORTS: COMPLETE (2026-10-17). PRODUCTION: NO-GO.** Passes 1–2 PASS; USER-REPORTED browser P16-1–P16-7 PASS with no failures reported; final read-only verification and necessary final checks PASS. Owned services stopped; fixture/evidence retained without reseeding. Phase 17 NOT STARTED. Phase 15 remains COMPLETE. Phase 11 ACTIVE blockers, Phase 14 Microsoft PERSONAL_MSA revocation BLOCKED / GA4 standard reporting-normalization-cleanup DEFERRED, dependency baseline 21 findings (3 critical / 9 high / 9 moderate), and `35f18280231613a890d10e340160e62604ccb2d8` as Phase 25 support remain unchanged. No earlier fixture/provider state, production data, external provider, Docker, Actions, dependency upgrade, deployment, commit or push was involved. Earlier preparation narratives below are historical where superseded by final closure.

## Final closure — 2026-10-17

### USER-REPORTED browser results

These are the user's browser acceptance results, not browser observations independently performed by Codex. No browser acceptance failures were reported.

| Check | USER-REPORTED result and accepted coverage |
| --- | --- |
| P16-1 | PASS — desktop report; product selector; 7/30/90 ranges; report date selector; stale-content behavior acceptable |
| P16-2 | PASS — multi-currency presentation; large monetary values readable; stage history ordered; UTC timestamps; persisted reasons |
| P16-3 | PASS — mixed-verification/trust wording understandable; no overclaim of verified customer outcomes; normalized records distinguished from unique people; snapshot/payment distinctions visible |
| P16-4 | PASS — approximately 390px layout; long product labels; keyboard/focus; chart scrolling; large numbers; no blocking overflow |
| P16-5 | PASS — refund-only credit activity visible; empty product truthful |
| P16-6 | PASS — loading under throttling; stale content cleared; safe offline error; recovery after reconnect |
| P16-7 | PASS — no-products state; unauthorized redirect to login |

The persisted stage-reason result is recorded as user-reported; the implementation's existing response-only reason contract is unchanged. Pass 2 separately verified persisted reasons against PostgreSQL.

### Final read-only data, privacy and lifecycle verification

`node scripts/phase16-final-check.mjs` PASS against the retained fixture before shutdown. A repeatable-read, READ ONLY PostgreSQL transaction evaluated the deterministic seed specification as SELECTs, with seed writes, authentication/session creation and seed file writes intercepted. It did not execute the seed writer or reseed. Actual row counts and every explicitly seeded column matched across 13 tables: products, credit accounts, integration accounts, credit transactions, activity events/aggregates, integration events, growth tasks/completions, task evidence, credit reservations, Build sessions and stage history. This includes wallet balances, credit deltas, task status/rewards, verification/provenance and persisted reasons; no unexpected report/Build Credit/task/evidence mutation was found. Browser authentication/session changes are expected and excluded from report-fact equality.

The original retained Pass 2 seed-fact SHA-256 fingerprint still matches exactly. The final check additionally retained 45 product/range input fingerprints (15 products including the foreign product × 7/30/90). Pass 2 retained 93 SQL-vs-API truth comparisons and a seed-fact hash, not serialized per-range response hashes: these new input fingerprints are not presented as a comparison with nonexistent earlier response hashes. Full seeded input equality and unchanged report implementation preserve the accepted range evidence. Evidence: `%TEMP%\enough-phase16-reports\final-read-only-evidence.json`; original seed/migration/runtime evidence remains retained.

`query-control.json` was absent: fixture fault/pause modes were inactive in ordinary serve mode. Old pause-observation marker files are retained evidence and cannot activate controls. Production has no fixture-control endpoint. The fixture-only login clock correction followed Pass 2; application report SQL, UI and shared/controller source predate the accepted Pass 2 run. No application source changed during closure, so the expensive mutating PostgreSQL/runtime suite was not repeated.

After the owned stop, the read-only log scanner PASS covered **61 retained runtime/archive/development logs**. No generated credentials, session/CSRF material, private evidence canary, raw SQL fault or connection URL was exposed. The browser-session API/web egress ledger remained empty; guarded services made no provider/external network connections. Next version checks remained locally suppressed. This statement covers the retained guarded fixture evidence, not unrelated browser background traffic. No Phase 14/15 state was accessed.

Owned supervisor stop PASS; status reports `supervisorActive=false`. Dedicated native ports 55952/56413/4442/4443/3322 and WSL Redis 56414 verified free. Only owned services were stopped; no destructive cleanup. Synthetic data, private sign-in material and evidence remain under the Phase 16 TEMP root.

### Canonical criterion matrix — line-by-line closure review

| Canonical requirement | Status | Evidence |
| --- | --- | --- |
| Schema; empty, single currency, multi currency, large volume, mixed verification | COMPLETE | Fresh full 0001–0020 migration chain/order/checksums/precheck/idempotency; Pass 2 actual PostgreSQL datasets and raw-row oracles; unchanged final seeded inputs |
| PostgreSQL ownership, ranges, rate limits, UTC boundaries, malformed attributes, linked/unlinked ratios, wallet scoping | COMPLETE | 18 accepted runtime tests / 93 direct truth comparisons; exact money/numeric safety; best-effort concurrent section semantics documented |
| Desktop | COMPLETE | USER-REPORTED P16-1/P16-2/P16-3 PASS |
| Mobile/narrow | COMPLETE | USER-REPORTED P16-4 PASS at approximately 390px |
| Keyboard | COMPLETE | USER-REPORTED P16-4 PASS |
| Loading | COMPLETE | USER-REPORTED P16-6 PASS; controller race/invalidation tests |
| Empty | COMPLETE | USER-REPORTED P16-5/P16-7 PASS; empty report/no-products runtime tests |
| Error | COMPLETE | USER-REPORTED P16-6 PASS; safe failure and recovery tests |
| Unauthorized | COMPLETE | USER-REPORTED P16-7 PASS; auth/ownership/runtime/controller tests |

### Final validation

- Focused deterministic report, number, presentation, loader/controller and fixture tests: **114/114 PASS**, seven files, including the three fixture clock regressions.
- Workspace `pnpm typecheck`: PASS. Changed-source Biome lint/format: PASS across 24 files; final repository format check and `git diff --check`: PASS.
- Full-content changed/new-file secret/privacy scan: PASS; generated values remain TEMP-only, with only explicit synthetic sentinels and local fixture URI templates in source. Manifests/lockfile unchanged against HEAD. No dependency audit repeated, installation or upgrade.
- Runtime acceptance retained: 18/18 PASS, 93 raw-row comparisons. Not rerun because application report source is unchanged since accepted Pass 2. The added closure checker only performs read-only database work and writes its evidence summary.
- No commit/push, deployment, Phase 17 work or later-phase status changes. Remaining production gates belong outside Phase 16: Phase 11 blockers, preserved Phase 14 exceptions, dependency baseline and other still-open canonical phases.

## Fixture and commands

Owned root `%TEMP%\enough-phase16-reports\`; marker `phase16-fixture.json`, owner `enough-phase16-reports`, version 1. Dedicated database/role `enough_phase16_reports`; PostgreSQL 55952; native Redis bridge 56413 to dedicated WSL Redis 56414; API 4442; web 3322. Worker 4443 is reserved but not started. API session/quota/readiness requires Redis. Native and WSL candidate ports are checked before every startup and after shutdown.

```text
node scripts/phase16-runtime.mjs test --reseed --verify-seed
node scripts/phase16-runtime.mjs serve
node scripts/phase16-runtime.mjs stop
node scripts/phase16-runtime.mjs status
node scripts/phase16-log-check.mjs
```

`start` aliases foreground `serve`. Normal serve/restart preserves data and sessions; `--reseed` explicitly recreates only this fixture's synthetic owners. `--verify-seed` independently reseeds and compares deterministic report-fact fingerprints. `clean --confirm-phase16` is available only with exact marker/realpath/tree and stopped native/WSL listener validation. Alternate-root/unknown arguments are refused. Cleanup never follows unexpected links; the isolated web copy's exact dependency junctions are validated against repository dependencies. No destructive cleanup was performed.

Only safe OS/tool environment keys plus generated fixture configuration are passed to children. No root dotenv is loaded or copied. Private generated database/auth credentials, synthetic account password and sessions stay under this owned TEMP root; none is printed or tracked. API/web preloads deny non-approved socket/HTTP/fetch destinations. Only the exact parent TSX IPC pipe is permitted. Next's optional npm version check is explicitly suppressed offline, not sent. No worker/provider sync runs; OpenAI key is empty. Report time is frozen **only in the fixture API**, at `2024-03-01T12:34:56Z`; PostgreSQL connections use `America/Los_Angeles` to prove explicit UTC grouping. Production clocks/configuration are unchanged.

## Migration and seed evidence

- Fresh complete `0001`–`0020` chain applied once; exact filenames, recorded chronological order and SHA-256 checksums verified. Ledger has exactly 20 rows, no duplicates/pending migrations; precheck clean; rerun preserves checksums and applied timestamps.
- `fresh-migration-evidence.json` retains initial fresh evidence; `migration-evidence.json` records subsequent order/checksum/once-only/no-pending/idempotency verification. Later schema supports current source, without accepting later phases.
- Account A has the six required products plus dedicated ratio/wallet/funnel/numeric cases (14 products total). Account B owns one foreign product; account C has no products. All are synthetic.
- Volume: 10,000 raw focus/activity events, 2,000 normalized signals, 200 completions, 500 in-range ledger rows and 50 metered Build sessions. Deliberately different hourly rollups/metering do not replace report duration sources. A long product label and task labels are retained for browser stress checks.
- Currency dataset retains EUR/USD/JPY/KWD/unsupported ZZZ separately, zero and null amount cases, a positive excluded refund-event type, and USD aggregate exactly `9007199254740991` minor units assembled from individually valid bounded events. Negative payment amounts are unsupported and rejected; credit refunds remain separate movements.
- UTC cases include each 7/30/90 start−1ms/start, leap-day 23:59:59/00:00, request−1ms/request/request+1ms. Six task verification states and actual manual/automatic evidence methods/provenance are represented. Linked, unlinked, rejected and foreign records are distinct.
- Two seed generations produced identical report-fact fingerprints; restart preserved those facts. Password/session randomness is intentionally excluded from deterministic data fingerprints.

## Live results

`apps/api/src/reports.runtime.test.ts`: **18 tests PASS**, actual application server, authentication, Redis and PostgreSQL. **93 successful report responses** compared against independent raw-row database truth, including quota reads. Oracles do not reuse production aggregate SQL/helpers. Exceptional auth/query/concurrent paths have explicit separate assertions.

| Area | Result |
| --- | --- |
| Empty data | Correct dense zero rows, empty buckets/history and null ratios; no fabricated activity |
| Ownership | Own products succeed; cross-owner/missing product cannot bypass lookup; foreign facts excluded |
| 7/30/90 / UTC | Exact start-inclusive/end-exclusive rows and partial today; leap/month/year boundaries; grouping remains UTC under non-UTC DB timezone |
| Build/Grow | Both 67/33, Build-only 100/0, Grow-only 0/100, neither null/null; raw ended-session duration source proven |
| Money | Currency buckets/raw integer values match PostgreSQL; JPY/KWD formatting retained, MAX_SAFE_INTEGER exact, unsupported code uses exact minor units, no FX or snapshot-currency substitution |
| Credit wallets | Earned/spent/refund/adjustment-only/mixed/empty cases match direct ledger rows; other-product, foreign and global wallets excluded |
| Task trust | Mixed product: 6 completed / 2 verified / 2 awaiting; owner-reviewed VERIFIED and AUTOMATICALLY_VERIFIED combined, SELF_REPORTED/REJECTED never upgraded; provenance/method rows checked |
| Signals/attributes | Every recognized signal type covered; activity distinct from authenticated normalized signals; malformed focus fields ignored as documented; malformed amounts/codes/types/links/scopes rejected by actual schema |
| Funnels | Three linked funnels: 2/1 (50%), 2/2 (100%), 2/1 (50%); unlinked/rejected records excluded, zero denominators null, replay uniqueness prevents inflation |
| Stage history | Actual persisted reason and null returned, correct order/raw UTC instants; all-history semantics and foreign exclusion verified |
| Volume/numeric | Stable repeated 90-day results match raw truth; two volume reports plus oracles complete below the 15-second local budget (10.4 seconds in the final run); not a load-test claim. Unsafe payment and credit aggregates return safe 503 without rounding |
| Auth/quota/errors | Missing/invalid/revoked session 401; foreign product 404; malformed/unsupported ranges 400; first 60 account requests succeed, 61st 429 with retry-after; other account unaffected. Fixture-only query failure returns generic 503 and safe category |
| Web/state wiring | `/reports` 200; same-origin web proxy 7/30/90 works; no-products account returns empty products; actual HTTP results feed controller races/error/401 redirect callback correctly. No claim of hydrated visual/keyboard acceptance |

### Concurrency decision

The existing contract did not promise a single transactional snapshot. Nine parallel queries use independent read-committed snapshots. A fixture-only pause let a weekly completion query finish, then committed an atomic task/completion write before the daily query executed: the same response had daily 7 versus weekly 6. The next stable response correctly showed 7; restoring the synthetic write returned the original report exactly.

This is now explicitly documented as **best-effort per-section reads**, with a refresh-after-changes note in the API/UI trust disclosure and `REPORTS.md`. No calculation, isolation level or serializable transaction redesign was introduced. Consumers must not assume atomic daily/weekly agreement while writes are concurrent. The fixture pause/failure controls exist only in `scripts/phase16-api.mjs`, with no production HTTP endpoint or test UI.

## Privacy, lifecycle and quality

- Live checks and the read-only post-shutdown scanner inspected **37 retained runtime/archive/development logs**: no generated database/auth passwords, session/CSRF material, authorization/cookie values, private evidence canary, raw SQL fault canary or database connection URL. Only safe error categories are retained. API/web denied-provider ledger is empty; provider calls zero. Optional tooling version checks were suppressed locally.
- Initial fixture implementation errors (UUID/text parameter inference and evidence provider casing) were corrected in seed code. Diagnostics were safe code/constraint/source-location metadata; no product calculation defect was discovered. Early TSX IPC / Next version-check blocking was resolved through exact local IPC allowance and offline suppression, without enabling external networking.
- Owned services stopped, restarted without reseeding, passed API/web/report/fingerprint checks, then stopped again. Cleanup refused active and alternate-root invocations. Reversible stopped-fixture probes proved unmarked and unexpected-linked-content cleanup refusal; marker/data restored and retained. Wrong-owner/root/link/listener pure guards also pass. No arbitrary process was stopped.
- Focused deterministic set: **113 PASS** (accepted Pass 1's 105 plus 8 fixture safety tests). Workspace typecheck PASS. Final scoped lint/format across 20 changed/new source files, `git diff --check`, and full-content secret/privacy scan across all 26 changed/new files PASS. Dynamic local fixture URI templates and explicit synthetic isolation-test sentinels are not real credentials; generated values remain TEMP-only. Manifests, lockfile and migration sources are unchanged; no dependency audit repeated. Installed dependency reads initially hit sandbox restrictions; the same checks passed outside that restriction, without installing/upgrading anything.
- Evidence retained under the owned root, including migration, seed reproduction, direct-truth count, concurrency, restart and cleanup-safety summaries. Logs are archived by supervisor nonce before restart; synthetic sign-in material is excluded from logs/repository.

## Historical Pass 3 preparation: login blocker resolved before browser acceptance

The user reported `Internal Server Error` before browser acceptance started. This is not a P16-1 failure. Bounded reproduction confirmed GET `/login` and pre-auth CSRF returned 200; POST `/api/auth/login` accepted the password but session creation failed. Safe server diagnostics: PostgreSQL `23514`, constraint `auth_sessions_check`, `createSession` at `packages/auth/src/session.ts:174`, called by `packages/auth/src/routes.ts:361`.

Root cause was fixture-only: the API-wide historical March 2024 clock calculated session expiry before PostgreSQL's current creation timestamp. Pass 2 used pre-issued synthetic sessions, so it did not exercise this password-login path. No required generated configuration was lost on restart: retained auth secret, PostgreSQL/Redis destinations, web/API origins and disabled-provider setting match the launcher environment; Redis responds and the verified manual account retains its password record and active session/device state.

The fixture preload now applies historical time only to `/report-data` request async context. Startup, login and session issuance use real time; concurrent requests retain separate clocks. Production auth and report calculations are unchanged. Three clock regressions plus eight existing fixture-safety tests pass. After a clean owned restart without reseeding, one original-account password login succeeded; authenticated account/session/device endpoints, `/reports`, and the Reports API returned 200. The report date remains the historical anchor, the retained seed fingerprint is unchanged, and no external connection attempt occurred. Retained Pass 2 report evidence remains valid; this adds the missing login-path check without repeating report acceptance.

The fixture is left running at `http://127.0.0.1:3322/login` for resuming the single manual session. No browser acceptance was performed by Codex. Post-fix privacy inspection passed across 49 retained runtime/archive/development logs; the changed/new-file secret scan passed across 29 files. Scoped lint/format and `git diff --check` passed. No generated credential or session value was printed or added to the repository.

## Historical Pass 3 procedure — subsequently USER-REPORTED PASS above

Services are running after the authorized login-fixture correction; use **one tab/session** at `http://127.0.0.1:3322/login`, then start at `/reports`. Keep providers disabled and preserve the seed. For a later authorized restart, use `node scripts/phase16-runtime.mjs serve` without reseeding.

Retrieve the synthetic sign-in fields privately from `%TEMP%\enough-phase16-reports\manual-account.json`; do not paste the file into chat/docs. For example, copy `.email`, then `.password`, with `(Get-Content "$env:TEMP\enough-phase16-reports\manual-account.json" | ConvertFrom-Json).password | Set-Clipboard`. Paste into **Email address / Password**, click **Sign in**, then open `/reports`. Account C uses `.noProductsEmail` and the same synthetic password. This is a proposed user procedure, not an action performed by Codex.

| Order | Exact action | Expected human-observable result |
| --- | --- | --- |
| 1 — desktop | Product → **Product Single Currency**. Trend range → **7**, **30**, **90 days**; Report date → another day and back. | Clear loading/current context, readable snapshot/review/details/charts; selectors reachable. Do not recalculate accepted totals. |
| 2 — currencies/history | Product → **Product Multi Currency**; inspect payment amounts. Return to **Product Single Currency**, scroll to **Product stage changes**. | Separate labelled currencies and readable large amount/fallback; ordered readable UTC stage timestamps. Reason remains response-only by contract. |
| 3 — trust | Product → **Product Mixed Verification**. Expand **How to read this report**. | Owner/automatic combined wording and awaiting state are clear; no unique-people/independent-proof/atomic-snapshot claim. |
| 4 — narrow/keyboard | Resize to **about 390px**. Product → long **Product Volume - …** label. Tab through Product, Trend range, Report date and links/summary; activate native controls with Enter/Space as appropriate. Scroll charts horizontally. | No blocking page overflow/overlap; visible focus, reachable controls, readable long labels/numbers, chart scrolling usable. |
| 5 — refund/empty | Still narrow: Product → **Product Refund Only**, then **Product Empty**. | Refund totals/activity disclosure visible despite zero earned/spent bars; empty product has truthful zero/no-data/null presentations. |
| 6 — loading/error/recovery | Desktop again. DevTools Network → **Slow 3G**, change range once; then **Offline**, change range again without reloading. Restore **Online/No throttling**, change range. | Understandable loading; old report clears; safe in-page error, no crash/raw diagnostics; normal recovery. |
| 7 — no products/unauthorized | Same tab → `/login`, click **Sign out**. Sign in with account C; open `/reports`. Then `/login` → **Sign out**, open `/reports` again. | No-products state offers workspace creation; final unauthenticated navigation reaches `/login` without private report content. |

The user subsequently reported this session's P16-1–P16-7 results PASS. Human results and final verification are accepted in the closure record above; do not repeat browser acceptance.
