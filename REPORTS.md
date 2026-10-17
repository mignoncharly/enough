# Reports contract

Reports are read-only reflections on an owned product. `/reports` uses authenticated `GET /report-data` through `/api/reports`, with a 7/30/90-day range (default 30) and an account-wide 60-per-minute quota. A report does not submit evidence, verify an outcome, award credits or call an AI/provider API.

Report sections are **best-effort reads, not one transactional database snapshot**. The product lookup and parallel aggregates use independent query snapshots with one captured range end. A concurrent completion/review/ledger write can appear in one section before another (including daily versus weekly completion counts). Refresh after writes settle. Stable repeated reads are tested against raw database truth; no serializable or repeatable-read guarantee is claimed. This limitation is also disclosed in the report's trust notes.

| Response | Meaning |
| --- | --- |
| `product` | Current owner-maintained stage, launch flag, users, paying users and nullable decimal revenue snapshot with its own currency; not historical period totals |
| `period` | Selected UTC date labels and range length; today is partial, ending at the request instant |
| `stageGuidance` | Current-stage planning percentages and priorities, not measured historical allocation |
| `days` | Dense UTC rows with recorded activity count, reported Build/Grow seconds, recognized normalized signal counts, payment buckets, product-wallet movements and task completion/verification counts; missing facts are zero/empty |
| `weeklyReview` | Last seven UTC dates including partial today: focus proportions, signals, task status counts, earned/spent credits, configured highest-signal completed task and deterministic review prompt; absent focus gives null shares, absent task gives null |
| `conversionFunnels` | Linked-reference starts/conversions and nullable percentages for outreach→reply, demo→signup, signup→payment-or-subscription |
| `stageHistory` | Latest 100 product transitions, independent of selected range, with actual persisted `change_reason` returned as nullable `reason` and UTC instant `changedAt`; reason is retained in the response, not added as decorative report UI |
| `trustNotes` | Source, verification, focus, linkage and wallet interpretation limits |

The exact field inventory is in `PHASE_16_AUDIT.md`; browser interfaces are in `apps/web/app/workspace-data.ts`. No replacement report model was introduced for Phase 16 Pass 1.

## Time and sources

Bounds are `[UTC midnight today minus days−1, request instant)`. Daily SQL bucketing explicitly uses UTC. Activity uses corrected `effective_at`, integration records use `occurred_at`, credits use ledger `created_at` and completions use `completed_at`. A session duration is assigned to its end event's day, not split across midnight. Stage history displays an explicitly formatted UTC timestamp.

Focus comes from reported `focus.session_ended` events, not metered Build Credit allocations. Only digit durations from 0 through 21600 seconds and BUILD/GROWTH modes contribute; malformed or excessive values contribute zero. Active/unreported sessions are omitted. Retention/deletion can change historical reports.

Integration metrics count recognized AUTHENTICATED normalized records. Analytics daily buckets can become one record regardless of the provider bucket's original count; their UTC markers may represent provider-local reporting dates rather than exact event instants. Counts are not necessarily unique people or customers. Newer integration event types are not automatically added to report totals.

Funnels link only the same integration account and anonymous reference inside the selected range. They compare first matching event times; unlinked records are excluded. They do not resolve identities across providers or independently verify cohort conversion.

## Currency and numeric rules

- Each day retains separate payment-event currency buckets. There is **no FX conversion**, no addition of unlike currencies, and no substitution of the product snapshot currency.
- `amountMinor` remains a nonnegative safe integer JSON number. SQL sums beyond `Number.MAX_SAFE_INTEGER` fail safely with the report-unavailable response; they are never rounded or clamped. A database bigint sum is not automatically an accepted API value.
- Display uses exact integer/remainder arithmetic and Intl's existing currency minor-unit exponent for recognized supported currencies, including JPY (0), EUR/USD (2) and KWD (3). The browser's `Intl.supportedValuesOf("currency")` establishes recognition; an unknown/unsupported identifier displays exact minor units and its identifier, without guessing decimals.
- Refund payment rows are not currently part of payment buckets; payment amounts cannot be negative. Credit refunds are separate credit units, not negative money or FX.
- Amount-bearing payment count can differ from the payment signal count when amount data are absent. Current revenue is a separate decimal snapshot, not payment-event revenue inferred for the range.
- All integer counters/durations/credit amounts must be safe and nonnegative, except signed net credit adjustments. Derived totals are checked; percentages use exact integer arithmetic before rounding to whole percentages (focus) or one decimal (funnels). Invalid domain values fail safely. Internal errors retain only a safe log category.

## Verification and credit interpretation

Completed does not imply verified. Verified totals combine owner-reviewed VERIFIED and AUTOMATICALLY_VERIFIED statuses; the current response does not provide separate counts and must not imply all are provider-verified. Awaiting evidence/review counts only those two pending statuses. Current review status applies to the completion date, not a historical review-time snapshot. Highest signal is the task's configured rating, including potentially unverified completions, not proof of outcome quality.

Authenticated source control does not alone prove vendor origin. Preserve provider-origin and evidence trust boundaries; never treat recorded activity, normalized signals, owner review and independent verification as interchangeable.

Credit fields summarize the owned product wallet: earned, spent, refunded and signed net adjustments. Reserve/release/expire actions and account-global/other-product wallets are outside these movement totals. The chart bars show earned/spent; refund/adjustment totals are disclosed separately and count as activity. Manual wallet controls remain prototype controls. No report calculation changes the ledger.

## Acceptance status

Phase 16 remains ACTIVE and production NO-GO. Passes 1–2 pass deterministic and isolated PostgreSQL/HTTP acceptance; see `PHASE_16_ACCEPTANCE.md`. Fresh full `0001`–`0020`, representative volume, raw-row query truth and best-effort concurrent behavior are verified; this is not a throughput or atomic-snapshot guarantee. The fixture is stopped with state retained. Consolidated hydrated accessibility/browser Pass 3 remains NOT RUN. Current direct report SQL retains its historical `0011` floor.
