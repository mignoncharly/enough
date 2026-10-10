# Phase 5 Activity Event Platform — Engineering Acceptance

Date: 2026-10-10 | Repository: `C:\Enough` | Base revision:
`7d1e532ee7cfc9769bbe8268a78e0ad62e81cd89` | Status: **COMPLETE (engineering
acceptance); checkpoint commit/push not authorized**

## Scope

This record covers the repository-defined Phase 5 Activity Event Platform.
Authentication remains the already-accepted Phase 2 scope.

## Implementation

- Ingestion revalidates the authenticated device and session inside the write
  transaction, including revocation, rotation, and expiry, while holding locks
  in the device-then-session order.
- Invalid PostgreSQL text (NUL and malformed Unicode) is rejected as input
  validation. Unexpected database failures log only a validated SQLSTATE and
  never event attributes or raw database diagnostics.
- Disposable integration coverage exercises single and batched ingestion,
  replay and conflict atomicity, per-device/product ordering, timestamp
  correction, UTC-hour aggregates, account/product export and deletion,
  consent, CSRF, ownership, payload bounds, and concurrent invalidation.
- `scripts/phase5-migration-check.mjs` verifies a fresh migration chain in a
  random scratch database owned by the isolated Phase 5 PostgreSQL cluster; it
  verifies the migration ledger and activity tables, then drops only that
  scratch database.

## API and privacy contract

- `POST /activity/events` accepts one authenticated event; `POST
  /activity/batch` accepts 1–100 events with a 300 KiB request limit. Attributes
  are scalar-only and capped at 2,048 UTF-8 bytes. User and device identity are
  taken from the authenticated session.
- Activity collection requires the member's `ACTIVITY_COLLECTION` consent.
  Cookie-session writes retain origin and CSRF enforcement. Product ownership,
  session validity, and device validity are checked server-side.
- Replays are idempotent. Conflicting event IDs or device/product sequence
  reuse reject atomically. Future events beyond five minutes and events older
  than seven days use server time for effective ordering while preserving the
  submitted timestamp.
- `GET /activity/events` returns only the authenticated member's events with
  bounded pagination. `/auth/account/export` includes owned events and
  aggregates without event hashes. `DELETE /privacy-activity` deletes the
  member's event and aggregate data; account and product deletion cascades were
  exercised in the disposable database.

## Verification evidence

Runtime was Node `v24.19.0`, pnpm `11.20.0`, PostgreSQL `18`, and Redis
`8.10.2`. The fixture used TEMP `enough-phase5`, PostgreSQL `55436`, Redis
`56387`/WSL `56388`, API `4408`, and web proxy `3305`. It never loaded the root
`.env` and touched no production service.

| Command | Result |
| --- | --- |
| `pnpm test:activity:integration` | PASS, exit 0: 72/72 checks across 28 activity, 26 product, and 18 onboarding integration tests; Vitest duration 21.64 s. Migration precheck passed on PostgreSQL 18 with no pending migrations in the fixture database. |
| `pnpm db:phase5:migration-check` | PASS, exit 0: fresh scratch database applied all 15 migrations in filename order, including `0002`–`0005`; checksum precheck passed with no pending migrations and both activity tables present. The scratch database was dropped afterward. |
| `pnpm test` | PASS, exit 0: 68 passed, 121 opt-in integration tests skipped; 16 test files (10 passed, 6 skipped), 5.56 s. |
| `pnpm typecheck` | PASS, exit 0: all 11 participating workspace projects typechecked. |
| `pnpm format:check` | PASS, exit 0: 156 files checked. |
| `pnpm lint` | PASS, exit 0: no errors; 124 existing warnings and one informational diagnostic remain. |
| `pnpm audit --json` | Exit 1: 18 advisories remain open (3 critical, 8 high, 7 moderate). No dependencies or lockfile changed; this remains a security/release gate. |
| `pnpm security:secrets` | Not available: no such package script or installed `gitleaks`, `trufflehog`, or `detect-secrets` executable. A limited filename-only scan for private-key, AWS, Stripe, and GitHub token patterns found no matches; `.env`, `.env.*`, `.runtime`, dependencies, and logs were excluded. This is not a full secret-scanner result. |
| `git diff --check` | PASS, exit 0, after the final documentation edits. |

The first integration run reported 71/72: the expiry-race test tried to move
`expires_at` before `created_at`, correctly triggering the existing database
constraint before reaching the assertion. The synthetic test row now moves
`created_at` two seconds and `expires_at` one second into the past. The full
integration suite then passed 72/72. The first lint run found import ordering in
the new migration verifier; the import was corrected and the final lint run had
no errors.

The disposable runner stopped API, web, Redis, and PostgreSQL after the run. A
post-run PostgreSQL `status` returned the expected `pg_ctl: no server running`;
the independent fresh-migration check also stopped PostgreSQL successfully.
Redis emitted non-fatal local-fixture memory-overcommit and no-auth warnings;
it remained loopback-only.

## Remaining gates

- The audit findings remain open and production launch remains **NO-GO**.
- No Playwright runner/configuration was found; this API/data phase made no
  browser UI change, and no browser acceptance is claimed.
- No deployment, production access, commit, or push occurred.

## Next safe item

Proceed to Phase 6, Tool Classification Engine, using the current remediation
plan. Keep the Phase 5 working tree uncommitted until explicit checkpoint
approval.
