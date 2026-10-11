# Phase 8 Acceptance — Build Credit Engine

Date: 2026-10-11
Status: **COMPLETE — automated and consolidated user-reported acceptance PASS**
Canonical scope: `ENOUGH_COMPLETE_IMPLEMENTATION_PLAN.md`, Phase 8
Base checkpoint: `f6e42b66a1c78c50317a4584258e40accff90ee8`

## Scope and reconciliation

Canonical Phase 8 operations are earn, spend, reserve, release, refund, expire,
and adjust, with atomic multi-device safety; the exit criterion is that credits
cannot double-spend. The remediation acceptance additionally requires
PostgreSQL retry/concurrency evidence, the existing ordered migration chain
through `0008`, complete wallet-operation coverage, product isolation,
export/deletion, and a server-authoritative product-minute build-session
lifecycle. Existing wallet schema/API/UI were present at the checkpoint, but no
credit integration suite or build-session table/API existed.

## Implemented contract

- Migrations `0016_build_session_lifecycle.sql` and
  `0017_precise_build_session_meter.sql` add reservation allocation remainder,
  durable build sessions/command idempotency, and preserve old allocation rows
  while converting prior session seconds to precise milliseconds.
- Authenticated, CSRF-protected product wallet operations serialize on the
  PostgreSQL wallet account lock and use idempotency keys. A session reserves
  1–60 minutes, is tied to the authenticated user/product, and permits only one
  open session per product account.
- Session start, heartbeat, resume, settle, reservation spend/release, and
  expiry reconciliation are server-authoritative. A stale device lease cannot
  mutate a recovered session. Settlement bills `ceil(activeMilliseconds / 60s)`
  capped by its reservation and atomically releases unused minutes.
- Heartbeat gaps over 90 seconds pause metering. Reservations expire within
  60 minutes. Offline work is explicitly not authorized; offline allowance is
  zero until the later signed, scoped policy/reservation work exists.
- Manual earn/adjust controls remain prototype-only, default off, and rejected
  in production configuration. The isolated Phase 8 fixture alone opts in;
  these operations are not verified rewards or billing.
- `POST /credits/build-sessions/start` accepts `productId`, `reserveMinutes`,
  and `idempotencyKey`; `POST /credits/build-sessions/:id/heartbeat`,
  `/:id/resume`, and `/:id/settle` accept the current `leaseVersion` and an
  `idempotencyKey`. All reads/writes retain authenticated account/product
  ownership checks; the UI is not an authorization boundary.

## Acceptance status

The canonical exit criterion, **credits cannot double-spend**, has passing
isolated PostgreSQL concurrency evidence. Automated acceptance and the user's
consolidated P8-1–P8-5 browser review are complete. The user reported all five
checks PASS on 2026-10-11. These are user-reported results, not assistant browser
observations. Phase 8 is COMPLETE; do not reopen or repeat these checks.

### Consolidated manual acceptance

The user reports completing the consolidated review in the isolated Phase 8
fixture with synthetic data. The review is closed; do not start the fixture or
repeat any manual checks.

- [x] **P8-1 — Wallet scope and privacy:** open the wallet selector (initially
  **Account-wide**) and select the fixture's sole synthetic product. Initial
  available balance is 10 and reserved balance is 0. The
  page explains one credit equals one build minute and that offline work is not
  authorized. No credentials or another account's data appear.
- [x] **P8-2 — Prototype control boundary:** fixture-only grant and adjustment
  forms are visible. Add `2` credits with reason `Phase 8 UI smoke grant`; the
  page confirms the grant and shows available `12`. This is disposable fixture
  data only; production configuration rejects enabling these controls.
- [x] **P8-3 — Reserve and start:** enter `3` in **Product minutes to reserve**
  and select **Reserve and start session**. The page shows an ACTIVE session,
  available `9`, reserved `3`, lease version `1`, and the 60-minute maximum.
- [x] **P8-4 — Heartbeat and settlement:** the initial attempt crossed the
  60-second billing boundary and charged two minutes. On the immediate retest,
  a fresh three-minute reservation, heartbeat after about 2–3 seconds, and
  immediate settlement charged one minute (ceiling rounding), released the
  remaining two reserved minutes, closed the session, and left reserved at `0`.
- [x] **P8-5 — Adjustment and usable layout:** select **Remove available
  credits**, enter `1`, reason `Phase 8 UI debit smoke`, and select **Apply
  adjustment**; the then-current available balance decreases by exactly one
  and the ledger shows the adjustment.
  At approximately 390px wide, all controls remain readable/reachable; tab
  navigation has a visible focus indicator and no horizontal overflow blocks
  the actions.

**P8-4 timing observation and accepted retest:** On the first attempt, the
session remained active long enough to cross the 60-second billing boundary;
settlement charged two minutes, which correctly reflects server-observed time
and ceiling rounding. This was a timing observation against the checklist's
one-minute expectation, not a product defect. The user immediately retested
with a fresh three-minute reservation, recorded a heartbeat after about 2–3
seconds, and settled immediately. The retest charged exactly one minute and
released the remaining two reserved minutes. This retest is the accepted P8-4
evidence.

Automated integration already covers auth/CSRF, cross-product IDOR, all wallet
mutation classes, expiration/refund/export, concurrent spend/start, idempotent
replay/misuse, device lease recovery/staleness, metering/rounding, account
export and migration compatibility. Do not repeat those API/database checks
manually.

### Automated evidence

Recorded on Node.js `v24.19.0` and pnpm `11.20.0`:

- `pnpm test`: **80 passed, 137 skipped**; integration files are opt-in.
- `pnpm test:credits:integration`: **6/6 passed** on isolated PostgreSQL 18,
  Redis, API and web services. Migration precheck reported no pending
  migrations; the migration upgrade script verified Phase 7 allocation
  backfill and legacy session-seconds-to-milliseconds conversion. Fixture
  services stopped successfully.
- `pnpm typecheck`: PASS across 11 workspace projects.
- `pnpm format:check`: PASS, 166 files checked.
- `pnpm lint`: PASS; 124 existing repository warnings and one informational
  diagnostic remain; no lint errors.
- `git diff --check`: PASS (exit 0); Git emitted only CRLF-to-LF normalization
  notices for the remediation Markdown files.

No dependency was added/upgraded, no secret scan waiver is claimed, and the 18
known dependency-security findings remain release obligations. Production
launch remains **NO-GO**. No production service, Docker, GitHub Actions, or
protected runtime/configuration was used.

## Checkpoint state

Phase 8 is COMPLETE based on automated evidence and the user's report of
P8-1–P8-5 PASS. No manual browser checks were performed by the agent; the
accepted user checks must not be repeated. No commit or push was performed. The 18 known
dependency-security findings remain open release obligations; production launch
remains **NO-GO**. No production deployment, Docker, GitHub Actions, dependency
upgrade, or protected local configuration was used.
