# Phase 16 — Reports audit

Audit date: 2026-10-17. Source baseline: `cb80d92a9161f967d6e622b1ec7f29d361afaddd`.

## Pass 2 follow-up — 2026-10-17

**Pass 2 PASS; Phase 16 ACTIVE; production NO-GO.** `PHASE_16_ACCEPTANCE.md` supersedes the earlier missing-runtime evidence: fresh isolated full 0001–0020 chain, exact ledger/order/checksums/precheck/idempotency, 18 actual PostgreSQL/HTTP tests and 93 successful responses checked against independent raw-row truth. Empty/currency/volume/mixed verification, ownership, UTC/ranges, quota/auth/errors, wallets, malformed data, funnels and stage history pass. The first two canonical gates are complete; consolidated hydrated manual Pass 3 remains NOT RUN.

Controlled concurrent completion writes demonstrated different daily/weekly snapshots. The existing independent-query architecture is retained; `REPORTS.md` and API/UI trust notes now explicitly disclose best-effort sections and refresh-after-settling behavior. No atomic snapshot guarantee is claimed. Stable repeated reports and restart facts match database truth. Owned services are stopped; synthetic browser data, logs and credentials remain only in the separate Phase 16 TEMP root. No provider or earlier-phase state was touched. See the acceptance record for the exact proposed single manual session.

## Pass 1 follow-up — 2026-10-17

**Pass 1 PASS — deterministic hardening complete; Phase 16 remains ACTIVE, production NO-GO.** The original audit below is a checkpoint snapshot, including its original missing-test/defect statements. This follow-up supersedes those statements only for the deterministic work described here. No PostgreSQL/runtime fixture, hydrated/manual browser acceptance or external provider was run. Phase 14/15 state was not accessed.

| Audit finding | Pass 1 resolution and direct coverage |
| --- | --- |
| Stale content and obsolete 401 redirects | Page-local `report-session` generations synchronously invalidate selection; latest request alone may publish content, errors, loading or redirect. Product/range switches, late success, stale/current 401, failure after success and cleanup are tested. The page also masks mismatched context before effects run. |
| UTC label on local stage time | Explicit UTC formatter with fixed readable locale/hour cycle; midnight/leap/year/offset and machine-timezone regressions |
| Money precision / unsupported currencies | Keep current safe-integer `amountMinor` JSON contract. BigInt integer/remainder display preserves every minor unit through MAX_SAFE_INTEGER; supported Intl currency exponents retained. Unsupported identifiers display exact minor units; no guessed decimals, FX or combined currency total. Negative payment amounts remain invalid; credit refunds remain separate. |
| Unsafe derived totals | Validate integer domains, safe bounds and proportions; exact BigInt sums/percentage intermediates, checked daily/weekly and displayed 14-day credit totals; corrupt/overflow rows return generic 503. Missing daily rows zero-fill, malformed numeric fields in present rows fail. Failure logging retains a category, not raw error details. |
| Refund-only false empty | Activity predicate includes refunds and signed adjustments without adding amounts; chart descriptions/totals disclose those movements while bars remain earned/spent. Tests cover earned, spent, refunds, reversal adjustments, mixed and empty. |
| Stage-history reason | SQL selects persisted `change_reason AS reason`; response consistently returns nullable `reason`, matching the existing browser type. No speculative extra UI was added. |
| Trust distinctions | Combined verified labels identify owner/automatic statuses; trust notes explain owner review versus automatic verification, normalized records versus unique people and provider reporting-day markers. No new separate counts or calculation semantics were invented. |
| Missing metric contract | Added concise current `REPORTS.md`; existing references remain valid. |

Dedicated deterministic tests:

- `apps/api/src/reports.contract.test.ts`: injects the real route with mocked auth/quota/database rows; exact serialized field/type/null contract checked against the browser interface; 7/30/90 empty data, snapshot, signals, focus, payments, credits, statuses, stage reason, funnels, weekly review, trust copy and numeric failures. Query arguments/linked-reference clauses are checked, but this does not execute PostgreSQL or prove SQL aggregation correctness. Error-log canary coverage prevents raw database details from being retained.
- `apps/web/app/reports/report-session.test.ts`: request/context races and lifecycle behavior.
- `apps/web/app/reports/report-presentation.test.ts`: exact currency, unsupported/negative/unsafe inputs, UTC and credit presentation.
- `apps/web/app/reports/report-loader.test.ts`: same-origin context, credentials/no-store and unauthorized status propagation.
- `packages/shared/src/report-numbers.test.ts`: integer domains, exact sums, overflow and proportions. Existing shared stage guidance tests remain relevant.

The canonical three acceptance gates remain open: these tests cover contract/state/presentation deterministically, not PostgreSQL ownership, SQL ranges/UTC grouping, quota infrastructure, performance, concurrent snapshot consistency or hydrated accessibility. No upstream task/credit/activity accounting source was modified, so its live regressions are not repeated in Pass 1.

Pass 2 plan remains `%TEMP%\enough-phase16-reports\`, PostgreSQL 55952, Redis 56413 / WSL 56414, API 4442, web 3322; fresh full 0001–0020. Add exact MAX_SAFE_INTEGER display/failure cases, persisted stage reasons, unsupported currency fallback, derived totals and refund-only UI data to the existing dataset plan. Recheck all port availability/ownership immediately before a separately authorized execution. No fixture or credentials are created by Pass 1.

Validation: **105 tests PASS in six files** (36 route contract, 10 controller, 34 presentation, 2 loader, 21 numeric and 2 existing stage-guidance tests); workspace `pnpm typecheck` PASS; scoped Biome lint/format for all 11 changed/new TypeScript files PASS; `git diff --check` PASS; full-content secret-pattern scan of all 16 changed/new files plus manual changed-text privacy review PASS. Dependencies, lockfile, migrations, fixture scripts and upstream task/activity/credit/evidence producers unchanged. No dependency audit rerun. Native proposed ports were rechecked without collisions; the proposed TEMP root remains absent. Recheck native/WSL availability and ownership before Pass 2; ports are not reserved. All later sections retain the original audit's source/evidence baseline.

## Original audit snapshot

**Phase 16 ACTIVE — audit only; acceptance NOT COMPLETE. Production NO-GO.** No application source, dependency, migration or test was changed. No fixture, report API, browser acceptance, worker or provider was run. This is source inspection, existing-evidence inventory and a proposed acceptance plan, not a runtime PASS.

Phase 15 remains COMPLETE. Phase 11 remains ACTIVE with its existing blockers. Phase 14 Microsoft PERSONAL_MSA revocation BLOCKED and GA4 standard reporting/normalization/cleanup DEFERRED remain preserved. No Phase 14/15 TEMP state or credentials were accessed. The dependency baseline remains 21 findings: 3 critical / 9 high / 9 moderate. Release-hardening checkpoint `35f18280231613a890d10e340160e62604ccb2d8` supports Phase 25 only. No Phase 17+ work, Docker, Actions, deployment, commit or push occurred.

## Architecture and existing behavior

- `apps/web/app/reports/page.tsx`: hydrated client page, loads owned products, maintains product/range/day selection and renders the report. There is no separate report controller.
- `apps/web/app/workspace-data.ts`: `ProductReport`/`ProductReportDay` contracts and `loadProductReport`; `/api/reports` GET includes credentials and disables browser caching. Shared loader reads safe API error text and attaches HTTP status; TypeScript casting is not runtime response validation.
- `apps/web/next.config.ts`: same-origin `/api/reports` rewrite to API `/report-data`. `/reports` remains the web page. Nginx proxies web and API hosts separately; it does not implement report calculations.
- `apps/api/src/reports.ts`: session, quota, strict query validation, owned-product lookup, then nine parallel database queries for activity, signals, payments, credits, completions, stage history, funnels, weekly task summary and highest-signal task. Queries use `pool.query`, without one shared transaction/snapshot. No provider, task creation, evidence review or credit mutation occurs.
- `apps/api/src/server.ts`: registers the route and adds no-store headers. `packages/auth/src/rate-limit.ts`: shared Redis-backed rate-limit infrastructure.
- Upstream producers: `activity.ts`, product/task/evidence/credit routes, integration ingestion/provider adapters and build-session routes. Reports read raw activity events rather than hourly activity rollups or metered Build Credit allocations.

Request: `GET /report-data?productId=<uuid>&days=7|30|90`; default days 30; unknown query keys rejected. Session is required before quota; authenticated account quota is `reports:read`, 60 requests per 60 seconds. Validation failure is 400, foreign/missing product 404, missing session 401, quota exhaustion 429, limiter unavailability 503. Query errors return a generic report-unavailable 503. Report-specific behavior is not yet tested.

Ownership is checked on `products.id + user_id`. Activity, integration, task and credit queries additionally constrain product/account. Stage history is transitively scoped through the owned product. Product-wallet ledger joins constrain both wallet owner and transaction owner; global wallets and other product wallets are excluded.

## Exact response contract

This describes existing source, including returned fields not separately displayed. Numbers below are JSON numbers; dates are date-only UTC strings unless specified.

```ts
type ProductReportDay = {
  day: string;
  activityEvents: number;
  buildSeconds: number;
  growSeconds: number;
  marketSignals: number;
  signals: {
    outreach: number; replies: number; interviews: number; demos: number;
    feedbackCalls: number; salesCalls: number; onboardingCalls: number;
    retentionCalls: number; signups: number; activations: number;
    retained: number; payments: number;
  };
  payments: Array<{ currency: string; amountMinor: number; paymentCount: number }>;
  credits: { earned: number; spent: number; refunded: number; adjusted: number };
  tasksCompleted: number;
  tasksVerified: number;
};
type ProductReport = {
  product: {
    id: string; name: string; productStage: ProductStage; productStageLabel: string;
    hasLaunched: boolean; userCount: number; payingUserCount: number;
    currentRevenue: string | null; revenueCurrency: string;
  };
  period: { days: number; startDate: string; endDate: string; timezone: "UTC" };
  stageGuidance: { buildPercent: number; marketPercent: number; priorities: string[] };
  days: ProductReportDay[];
  weeklyReview: {
    startDate: string; endDate: string; buildSeconds: number; growSeconds: number;
    buildShare: number | null; growShare: number | null; marketSignals: number;
    tasksCompleted: number; tasksVerified: number; tasksAwaitingReview: number;
    creditsEarned: number; creditsSpent: number;
    highestSignalTask: { title: string; signalStrength: number } | null;
    recommendation: string;
  };
  conversionFunnels: Array<{
    key: string; label: string; started: number; converted: number;
    conversionPercent: number | null;
  }>;
  stageHistory: Array<{
    id: string; fromStage: ProductStage | null; fromStageLabel: string | null;
    toStage: ProductStage; toStageLabel: string; changedAt: string;
  }>;
  trustNotes: string[];
};
```

`ProductStage` is the existing shared nine-stage enum. `stageHistory.changedAt` is an ISO instant. This is the actual API response model: the browser's shared `ProductStageHistoryItem` additionally requires `reason: string | null`, but the report route omits it. The UI does not currently read that field; the type/API mismatch still needs contract coverage. No evidence bodies, anonymous reference hashes, provider credentials, raw integration payloads or per-event records are returned.

| Fields | Source and scope | Time basis / snapshot | Trust, empty and currency behavior |
| --- | --- | --- | --- |
| `product.*` | Owned `products` row; shared stage labels | Current snapshot, independent of selected period | Owner-maintained users/paying users/revenue; revenue decimal string or null; product currency is not a payment conversion currency |
| `period.*` | Requested range and one captured server `now` | Start UTC midnight today minus days−1; end label today; actual end exclusive request instant | Exactly 7/30/90 dense daily rows; no explicit `asOf` timestamp returned |
| `stageGuidance.*` | Shared guidance for current product stage | Current stage snapshot | Configured guidance, not measured ratio; priorities also feed recommendation |
| `day`, `activityEvents` | `activity_events`, product/user | `effective_at`, explicit UTC day; `[start, now)` | All raw event types count, including duplicates only if ingestion allowed distinct IDs; absent 0 |
| `buildSeconds`, `growSeconds` | Same raw events, `focus.session_ended`, mode BUILD/GROWTH | Entire duration on effective/end day; not split across midnight | Reported duration, not verified focus or metered wallet time; digit-string duration 0–21600 only, malformed/excess ignored; absent 0 |
| `signals.*` | `integration_events`, product/user, AUTHENTICATED | `occurred_at`, explicit UTC day | Counts normalized records of recognized types, not necessarily people/outcomes; absent 0 |
| `marketSignals` | Sum of recognized signal counts except outreach | Daily range aggregate | Does not include every newer normalized event type; no provider-origin breakdown |
| `payments[]` | Authenticated `revenue.payment_received` with non-null `amount_minor` | UTC occurred day, grouped by currency | Separate currency buckets; sum of integer minor units, count of amount-bearing records; absent []; no FX or product-currency substitution |
| `credits.*` | `credit_accounts` + `credit_transactions`, owned product wallet only | `created_at`, UTC day | EARN/SPEND/REFUND sum amount; ADJUST sums available delta; reserve/release/expire omitted; zero when absent; credit units, not money |
| `tasksCompleted`, `tasksVerified` | `growth_task_completions`, product/user | `completed_at`, UTC day | All completion statuses vs only VERIFIED/AUTOMATICALLY_VERIFIED; current review status applied to historical completion date; absent 0 |
| Weekly focus/signals/credits | Last seven rows of `days` | Always seven UTC dates including partial today, even with 30/90 selection | Sum of daily values; no weekly payment total; no focus gives null shares |
| Weekly task counts | Separate completions query | Last seven dates, `[weekStart, now)` | Awaiting counts AWAITING_EVIDENCE/AWAITING_REVIEW only; legacy SELF_REPORTED and REJECTED included in completed, neither verified nor awaiting |
| `highestSignalTask` | Completions joined to current task title/signal strength | Last seven dates; rating descending, then completion recency | Any completion status eligible; configured signal rating, not proven evidence quality; null if none |
| `recommendation` | Deterministic stage/focus/signal rules | Seven-day review + current stage | No AI/provider. No focus → unavailable; no signals → stage action; excess Build share → paired action; otherwise review prompt |
| `conversionFunnels` | Authenticated integration records with user reference hash | Selected range; grouped by integration account + hash | Three funnels; unlinked excluded; participant counts, not event totals; 0 denominator → null percentage |
| `stageHistory` | `product_stage_history` after owned-product gate | Most recent 100, descending; NOT range-limited | Transition record, not historical user/revenue snapshots; empty [] |
| `trustNotes` | Static server strings | Not historical data | Reported focus, authenticated-source limits, linked-only funnels and prototype wallet controls |

Signal mapping: `email.outreach_sent`, `email.reply_received`, `calendar.interview_completed`, `calendar.demo_completed`, `calendar.feedback_call_completed`, `calendar.sales_call_completed`, `calendar.onboarding_completed`, `calendar.retention_call_completed`, `analytics.user_signup`, `analytics.user_activated`, `analytics.user_retained`, `revenue.payment_received`. Newer types such as refund/invoice/checkout are not silently included. A payment with null amount may count as a signal while not appearing in amount-bearing payment buckets.

Funnels are outreach→reply, demo→signup, signup→payment-or-subscription. Each uses earliest event per type, within the same integration account/reference/range, converted only when earliest destination time is at or after earliest origin. An earlier destination can mask a later valid one under this existing first-event definition. Different integration accounts cannot form a cohort together. Percentages round to one decimal. Do not change to cross-provider identity resolution as part of this audit.

Build/Grow shares: both nonzero → rounded Build percentage and complementary Grow; Build only 100/0; Grow only 0/100; both zero null/null. Recommendations compare against current stage guidance, not a historical-stage average. Trend data reuse daily rows; the UI shows only the final 14 rows for 30/90-day selections.

## Schema reconciliation

| Dependency | Historical/current relevance |
| --- | --- |
| `0002` | Sessions/accounts |
| `0004` | Current product metrics and stage history |
| `0005` | Raw activity and aggregates; report uses raw records |
| `0008` | Product wallets and ledger |
| `0009`–`0011` | Tasks, evidence-review completion statuses, integration accounts/events, automatic verification |
| `0012`–`0015` | Current registered API and producer dependencies, including notifications, billing, privacy/consent and AI usage; not new report acceptance scope |
| `0016`–`0017` | Current focus/credit session producers; metered milliseconds do not replace report duration source |
| `0018`–`0019` | Current evidence/storage producer and deletion dependencies |
| `0020` | Current integration producer provenance/configuration and expanded types; report does not yet select `provider_origin_verified` |

**Minimum historical schema and current direct report-read SQL floor: `0011`.** The present report SQL does not itself require a post-0011 column. This differs from the full current application and current producers needed for representative acceptance, which use later accepted schema. **Recommended fresh fixture: full `0001`–`0020`, exact order/checksums, migration ledger, precheck and idempotent rerun.** Do not stop at 0011 and then run current producers. Applying later migrations does not accept their phases.

No report-specific migration is currently evidenced as necessary. Determine that from failing schema/contract tests rather than adding one speculatively. Integration currency constraints enforce three uppercase letters, not supported ISO currency semantics. Payment amounts are nullable nonnegative bigint, bounded per event to 1,000,000,000,000; product revenue is a separate nullable `numeric(14,2)` snapshot. Tasks/completions, wallets and normalized events have owner/product relationships and replay constraints. Products have hard deletion rather than a report archive filter.

## Confirmed defects and contract gaps

These are source findings, not runtime reproductions. Tiny local JavaScript formatter/arithmetic probes were used where stated; they are not a test-suite PASS.

| Finding | Evidence and impact | Proposed bounded correction/test |
| --- | --- | --- |
| Stale displayed report | Report effect sets loading/error but does not clear old `report` when product/range changes or fails. Render still shows it. Old A data can remain under B selection. `active` prevents late success overwrite but not retained display; stale 401 catch redirects before checking `active`. | Invalidate displayed request context and ignore inactive errors; controller/state tests for product/range/in-flight failure/401 races |
| Local stage time labelled UTC | Stage history calls `toLocaleString()` without `timeZone: "UTC"`, then appends UTC. | Explicit UTC formatting; non-UTC browser/timezone regression |
| Large-money minor-unit loss | `formatPayment` divides safe integer minor units by a power of ten before Intl formatting. Probe: USD 9007199254740991 minor units should end `.91`, renders `.90`. This total can arise from many valid events. | Exact minor-unit formatting within existing contract, bounds coverage; no FX |
| Unknown currency accepted | Schema accepts any three uppercase letters; Intl accepts `ZZZ` without throwing and applies a default exponent. Its catch branch cannot establish currency support. | Define supported-code handling; unsupported codes must remain explicit minor units or be rejected at the appropriate boundary; no guessed exponent |
| Refund-only credit data shown as empty | Credit chart empty predicate includes earned, spent and absolute adjustment, omits refunded; refund-only data claim no transactions. Adjustment-only data show zero earned/spent bars. | Honest ledger/no-chart-data wording or relevant presentation; tests for refund/adjustment-only records |
| Derived sum safety incomplete | SQL scalar conversion checks safe integers, but daily market-signal additions and weekly reductions/total-focus addition do not recheck. Safe leaves can produce an unsafe total. | Check derived bounds consistently and test safe/unsafe boundaries; explicit safe failure, not silent rounding |
| Report provenance/count disclosure incomplete | Current provider analytics adapters can normalize a positive provider day bucket into ONE event, without retaining source count. Reports count rows. Provider day labels are normalized to UTC midnight markers and may originate in provider reporting timezone. Route ignores `provider_origin_verified`; manual and automatic task verification share one displayed verified count. | Explain normalized-record counts, provider date markers and owner-vs-provider trust; assess minimal safe breakdown needed, without reopening adapters or Phase 14 acceptance |
| Missing metric document | `IMPLEMENTATION_HANDOFF.md` references `REPORTS.md`, but that file does not exist at the checkpoint. | Restore a current metric contract or point the reference to the accepted replacement documentation |
| History type/API mismatch | Browser `ProductReport.stageHistory` uses `ProductStageHistoryItem[]` with required `reason`; report API does not return `reason`. No current rendered field depends on it. | Reconcile the report-specific type or intentionally return the field; add response contract coverage |

Additional risks requiring tests, not confirmed runtime failures:

- Parallel queries have no consistent database snapshot; concurrent completion/review/ledger writes can produce internally different slices. Verify required consistency before choosing transaction changes.
- Nine queries, raw activity scans and funnel grouping need bounded PostgreSQL volume/query-plan/latency checks; do not infer adequate performance from indexes.
- Query error handler logs `{ err: error }`; test database fault canaries for prohibited content before accepting report-log privacy. Safe HTTP errors alone do not prove safe internal logs.
- Out-of-range leaf aggregates fail the whole report with 503 via `safeInteger`; test this explicitly rather than claiming arbitrary-size support. No silent fallback to another currency is present.
- Raw-event retention/deletion changes report history. Hourly aggregates do not retain the report's full focus-duration contract. Test retained/deleted data expectations; do not promise immutable historical snapshots.

## Currency, UTC and trust assessment

**Currency:** SQL groups by UTC day and event currency and does not add USD to EUR, assume product currency, or convert using FX. Common USD/EUR two-digit, JPY zero-digit and KWD three-digit formatter probes behaved as intended at small values. Unknown currency and very large precision defects above remain. Null amount, zero amount, count-vs-amount differences, mixed same-day/range buckets and aggregate overflow have no dedicated report tests. Product revenue snapshot remains separate from payment flow totals. Do not introduce conversion or redefine revenue.

**UTC/range:** Explicit SQL `AT TIME ZONE 'UTC'` and UTC-midnight start computation are present. Bounds are start-inclusive/request-time-exclusive, not through a future end-of-day. Today is included as a partial row. Activity uses corrected `effective_at`; integration uses occurred time; credits creation and completions completion time. Stage history instants are UTC in API but mislabeled local in UI. Focus crossing midnight is assigned wholly to its end event. Provider daily reporting markers cannot prove exact underlying event UTC dates. No PostgreSQL report boundary test exists; source presence is not PASS. Test exact bounds, different DB/client timezones, 7/30/90, leap/month/year changes and provider-day semantics separately.

**Trust:** Pending/unverified completions are not counted verified merely because completed. VERIFIED includes owner review; AUTOMATICALLY_VERIFIED is a separate source status but merged in report totals. Neither equals universal independent outcome proof. Highest-signal task uses configured rating and can be pending/rejected. Activity is reported behavior, authenticated integration records establish source control, and provider-origin records require their own provenance semantics. Analytics buckets are not people counts. Credit ledger records include prototype manual operations; reports never award credits. Preserve Phase 13/14 evidence boundaries and do not treat a payment event as current revenue snapshot.

## UI and accessibility source audit

Existing UI: owned-product, 7/30/90 range and daily selectors; current stage/users/paying users/revenue; weekly review and ratios; selected-day counters/payment buckets; last-14-day focus/signal/credit charts; three funnels; recent stage history and expandable trust notes. No-product onboarding link, initial loading message, API-error text and 401 login redirect already exist.

| Area | Source evidence / limitation | Phase 16 evidence |
| --- | --- | --- |
| Headings/labels | Workspace h1 and section h2; labelled native Product, Trend range and Report date selects | PARTIAL; semantic source inspected, no new assistive-tech session |
| Keyboard/focus | Native controls, links and details; global visible focus styling on standard controls. Summary relies on native focus behavior. | PARTIAL; Phase 9 broad keyboard result only |
| Charts/screen readers | `role="img"` and textual series aria-labels; no semantic data table | PARTIAL; verify label completeness and long-series usability |
| Desktop / ~390px | Two-column toolbar/details collapse below 520px, responsive shell; numeric stats wrap anywhere | PARTIAL; no current rich-data visual result |
| Horizontal scrolling | Chart wrappers overflow-x auto, chart minimum width 620px; fixed 14-column chart layout even for 7 days | PARTIAL; scroll keyboard reachability/region naming need actual verification |
| Loading/error | Loading role=status; error section role=alert with generic API error text and sign-in link; retained stale report defect | PARTIAL; announcement and stale-data behavior need tests/correction |
| Empty/no-products | Separate initial-empty/no-product link, zero-data report and chart-empty text | PARTIAL; refund-only false-empty defect; no dedicated tests |
| Unauthorized | Product/report loader 401 redirects; stale 401 issue above | PARTIAL; no report controller coverage |
| Long labels / large numbers | Text wrapping exists in stats/details; native selects and charts need stress data; large-money precision defect | MISSING report-specific stress/visual coverage |

No manual browser acceptance was performed. Screen-reader chart descriptions are present; their presence does not establish complete accessibility. Do not repeat all Phase 9 tests; later use one focused report acceptance session with representative data and corrected context behavior.

## Existing test inventory

No dedicated report unit, report API/service, PostgreSQL report-query, report web/controller or automated report browser test was found. Searches for the route registration, route path, report loader, response type, report quota key, weekly review and funnels in tests found none. The following are adjacent evidence, not substitutes for report assertions. Inventory describes existing tests; none were rerun during this audit.

| File / record | Classification | Relevant existing coverage and limits |
| --- | --- | --- |
| `scripts/phase2-runtime.mjs` phase9 web-page smoke | API/service HTTP shell smoke | Includes `/reports` HTTP 200 among pages; no hydrated report interaction or aggregate assertions |
| `PHASE_9_ACCEPTANCE.md` | Browser/manual, historical accepted | General desktop/~390px, keyboard/theme, report product switching, general state coverage; not Phase 16 rich datasets/SQL/currency proof |
| `apps/api/src/activity.integration.test.ts` | PostgreSQL integration + API | Ingestion ownership/consent/CSRF, malformed attrs, duplicate/concurrent batches, corrected timestamps and UTC-hour bucketing; no report focus/day sums |
| `apps/api/src/products.integration.test.ts` | PostgreSQL integration + API | Owner scoping, metrics/stages, decimal snapshot representation, update/replay behavior; no report snapshot/range composition |
| `apps/api/src/tasks.integration.test.ts` | PostgreSQL integration + API | Task creation/scoping, recurring completion and pending evidence; no report status totals |
| `apps/api/src/evidence.integration.test.ts` | PostgreSQL integration + API | Pending/manual review, exactly-once credits, rollback, privacy/deletion; no report trust breakdown |
| `apps/api/src/evidence-storage-migration.integration.test.ts` | PostgreSQL integration | Current evidence schema/storage migration support; not report reads |
| `apps/api/src/credits.integration.test.ts` | PostgreSQL integration + API | Owner/wallet scoping, ledger actions, idempotency/concurrency, metering/expiry; no report wallet joins/day sums |
| `apps/api/src/integrations.integration.test.ts` | PostgreSQL integration + API | Event ownership/signature/time/schema/replay, manual-vs-automatic evidence boundary and quota; no report grouping/funnels |
| `apps/api/src/integration-provider-routes.integration.test.ts` | PostgreSQL integration + API, mocked provider HTTP | Current provenance/sync dedupe and Stripe trust behavior; no report display/count/provenance assertions |
| `apps/api/src/integration-adapters.test.ts` | Deterministic unit | Normalization/schema, money restricted to revenue, HMAC source control; no report aggregates |
| `apps/api/src/integration-provider-adapters.test.ts` | Deterministic unit | Provider mappings including analytics daily markers; no report row-count interpretation |
| `apps/api/src/integration-stripe.test.ts` | Deterministic unit, mocked provider API | Payment normalization/confirmation and automatic eligibility; no report currencies or UI formatting |
| `apps/api/src/integration-ga4.test.ts` | Deterministic unit, mocked provider API | Provider reporting contract/day markers; name refers to GA4 reports, not Enough `/report-data` |
| `apps/api/src/integration-oauth.test.ts` | Deterministic unit | Provider OAuth credential/state boundary; not report calculations |
| `packages/auth/src/rate-limit.test.ts` | Deterministic unit, mocked Redis | Shared quota infrastructure; not report 60/min/account behavior or real Redis |

Other accepted task/credit/activity/AI tests remain their original phase evidence. There is no reason to duplicate all of them or invoke provider acceptance to test a read-only report.

## Canonical coverage matrix

Definitions: COVERED means direct accepted evidence at the required layer; PARTIAL means source and/or adjacent accepted tests/history only; MISSING means no direct scenario test or acceptance evidence. No canonical Phase 16 gate is COVERED yet.

| Canonical gate | Status | Required evidence |
| --- | --- | --- |
| Schema and empty/single/multi-currency/volume/mixed verification | PARTIAL | Full isolated current chain + actual report SQL results; upstream schema already accepted elsewhere |
| Ownership/ranges/quota/UTC/malformed attrs/funnels/wallet against PostgreSQL | PARTIAL | Dedicated live local PostgreSQL report API assertions; existing producer tests insufficient |
| Desktop/mobile/keyboard/loading/empty/error/unauthorized | PARTIAL | Correct context behavior, focused deterministic state coverage, then consolidated report browser acceptance |

| Required scenario | Status | Existing evidence / gap |
| --- | --- | --- |
| Empty product report | MISSING | Zero-fill source only, no report assertion |
| Single currency | MISSING | Upstream money validation does not prove report totals |
| Same-day and range multi-currency | MISSING | Separate SQL buckets present, untested |
| Unknown/invalid currency | PARTIAL | Regex input/schema checks; supported-code semantics missing and defect found |
| Very large money / precision | MISSING | Defect reproduced by local formatter probe, no regression suite |
| Large activity/event volume | PARTIAL | Ingestion concurrency/batch tests; report latency/plan/counts missing |
| Mixed verified/pending/unverified/rejected evidence | PARTIAL | Evidence/status upstream tests; report totals/status wording missing |
| Product isolation | PARTIAL | Owner predicates and upstream tests; report query proof missing |
| Cross-account isolation | PARTIAL | Same; test every response slice, not just route status |
| Product/global/foreign wallet scoping | PARTIAL | Wallet upstream tests; report joins and actions missing |
| UTC day boundaries | PARTIAL | Activity hourly test; no report day/client timezone proof |
| 7/30/90 boundaries and partial today | MISSING | No direct report exact-boundary tests |
| Malformed activity attributes | PARTIAL | Ingestion bounded scalar validation; report semantic duration handling untested |
| Malformed/null/zero payment attributes | PARTIAL | Upstream schemas; report counts/buckets/safe failure untested |
| Linked/unlinked event ratios | MISSING | No direct report cohorts, denominator or first-event tests |
| Build/Grow both/only/neither | MISSING | Source formulas only |
| Rate limiting and limiter failure | PARTIAL | Shared unit/upstream route tests; report live quota missing |
| Deleted/revoked/stale records | PARTIAL | Upstream deletion/revoke tests; report retained/deleted/current snapshot semantics missing |
| Concurrent/replayed events | PARTIAL | Ingestion/ledger idempotency tested; report dedupe effects and snapshot consistency untested |
| Integer overflow/rounding | MISSING | Leaf checks exist; formatter and derived-sum defects found |

## Proposed isolated fixture — NOT EXECUTED

Root: `%TEMP%\enough-phase16-reports\`. It did not exist when checked. Do not reuse or inspect Phase 14/15 fixture roots.

| Service | Proposed loopback port | Notes |
| --- | --- | --- |
| PostgreSQL | 55952 | Dedicated cluster/database/role `enough_phase16_reports` |
| Redis | 56413 | Dedicated instance; API session/quota infrastructure requires it |
| Redis WSL fallback | 56414 | Dedicated fallback only if native Redis unavailable |
| API | 4442 | Development/test configuration, providers disabled |
| Web | 3322 | Local API rewrite only |
| Optional worker reservation | 4443 | Do not start worker; report acceptance does not require background provider sync |

Windows listener inventory for native service candidates and WSL loopback connection probes for all proposed ports found no collisions. Windows excluded port ranges did not cover native candidates. Repository fixture-port search found no prior assignment. This is a point-in-time availability check, not a reservation; recheck all ports and ownership immediately before any later authorized start. No existing service was stopped or contacted at its fixture port.

Plan safeguards: validated ownership marker, resolved dedicated root with no symlink escape, owned PID/child-process/port records; refuse foreign services. Fresh checksum-verified full 0001–0020 chain, precheck and idempotency. Generate synthetic local credentials later without tracked config. Explicit environment allowlist, no inherited provider/production credentials or root `.env`, provider-disabled settings and outbound provider-fetch deny/count guard. No timers/sync jobs. Capture safe logs and assert no egress, secrets or raw evidence bodies. Preserve acceptance state; clean shutdown only owned services. This audit creates no fixture files.

### Deterministic synthetic data plan

Use account A with multiple owned products, account B with a foreign product, and account C with no products. At least A-empty, A-single, A-multi and A-volume products; additional ratio-only cases can be reset within isolated test transactions. Freeze the clock in tests, not the real machine clock. Use explicit UTC timestamps; repeat database timezone checks under a non-UTC session timezone.

| Dataset | Contents and assertions |
| --- | --- |
| Empty | No activity, integrations, completions or ledger; null revenue; distinguish existing empty product from no-products account |
| Single currency | EUR amounts including zero and null amount events; current revenue snapshot intentionally different from payment total |
| Multiple currencies | EUR + USD on same UTC day and different days; JPY and KWD; product snapshot currency GBP to expose accidental substitution; explicit separate buckets, no FX |
| Invalid/large money | Unsupported three-letter code vs malformed code rejection; per-event maximum; aggregate at safe-integer boundary and just beyond; exact display cents; no contaminated normal dataset |
| Task trust | SELF_REPORTED, AWAITING_EVIDENCE, AWAITING_REVIEW, VERIFIED by owner, AUTOMATICALLY_VERIFIED and REJECTED; complete in range/review later; current configured highest signal vs proof distinction |
| UTC/ranges | Anchor e.g. 2024-03-01T12:34:56Z; start−1ms/start, 23:59:59.999/00:00, now−1ms/now/now+1ms; 7/30/90, leap day/month/year boundaries; direct synthetic DB seeding where ingestion time correction would rewrite historical fixtures |
| Focus | Both modes, each alone, neither; midnight-crossing session; 21600/21601, negative/fraction/missing/bad mode/invalid text attributes; report source vs metered Build-session data distinguished |
| Volume | Bounded 10,000-event default, separately budgeted 100,000-event case if needed; independently computed counts, explain plans and explicit local latency budget |
| Event trust / linkage | AUTHENTICATED and REJECTED; owner-source and provider-origin flags; each recognized type and newer excluded types; linked/unlinked, same/different integration account, before/equal/after, first-event masking, missing origin, duplicate/conflicting event IDs |
| Wallets | Product A earn/spend/refund/adjust/reserve/release/expire; product B, account-global and foreign wallets with matching dates; refund-only/adjust-only cases; independent ledger sums |
| Ownership/deletion | B's matching timestamps/labels must not leak; missing/foreign product IDs; deleted source records, retained events from revoked accounts, current mutable task/stage snapshots; report GET leaves all baselines unchanged |
| UI stress | Long product/task labels, unsupported currency labels, large numbers; loading/empty/error/401/no-products; desktop/~390px, keyboard and chart scrollability |

No real provider calls are needed to seed provider-origin categories. Use clearly synthetic database/API records. Do not spend OpenAI calls or reopen Phase 14 normalization acceptance to construct report scenarios.

## Recommended first implementation/test slice

1. Add focused report route/service tests for owned query contract, exact range clock, empty response, mixed currencies and mixed verification; test pure money formatting and displayed request-context state. Use existing test infrastructure and realistic query results; mocks do not substitute for the later SQL gate.
2. Fix only confirmed report defects: context invalidation/inactive errors, UTC formatting, exact monetary display/unknown currency fallback, credit empty wording and checked derived totals. Clarify normalized-record counts and owner/provider verification wording without FX, new identity matching or provider redesign. Restore/document the missing metric contract.
3. After separate runtime authorization, implement the owned fixture above and run real PostgreSQL report assertions, quota checks, volume and privacy fault tests. Decide snapshot consistency requirements from explicit concurrent scenarios. No provider calls or unrelated dependency audit.
4. Then prepare one consolidated report browser session. Keep all three canonical criteria unchecked until the corresponding direct evidence is accepted.

## Audit validation and changes

Validation scope: source/schema/test/document inspection; local Intl/arithmetic examples; proposed-port/root availability checks only. No runtime tests, typecheck or manual UI run were needed for documentation-only changes. Final whitespace and changed-document privacy checks are recorded in the audit handoff response.

Changed files: this new audit plus current Phase 16 status/schema-reconciliation notes in `REMEDIATION_IMPLEMENTATION_PLAN.md`, `REMEDIATION_HANDOFF.md` and `IMPLEMENTATION_HANDOFF.md`. Application source, migrations, manifests and lockfile unchanged. Phase 16 acceptance remains pending; production NO-GO.
