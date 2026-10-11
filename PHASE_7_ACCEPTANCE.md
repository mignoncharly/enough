# Phase 7 Acceptance — Rule Engine

Date: 2026-10-11
Status: **COMPLETE — automated and user-reported browser acceptance passed**
Canonical scope: `ENOUGH_COMPLETE_IMPLEMENTATION_PLAN.md`, Phase 7
Base checkpoint: `236b1b1585d29900a3b6e509254a8114e3f19f5a`

## Scope and current state

The repository's Rule Engine scope is conditions, actions, priorities,
time-zone schedules, product/device scopes, rule versions, temporary overrides,
and deterministic decisions. The evaluator, `0007_rule_engine.sql`, authenticated
API, rules workspace, and shared client evaluator existed before this pass.
This pass added deterministic and live acceptance coverage and fixed rule
evaluation to issue transaction reads sequentially on its repeatable-read
connection, eliminating the `pg` concurrent-query deprecation without changing
the decision snapshot.

All automated and manual Phase 7 acceptance items pass. The user reported the
consolidated browser review results on 2026-10-11. No browser/version was
provided. Do not repeat the accepted manual checks.

## Automated evidence

Environment: Node.js `v24.19.0`, pnpm `11.20.0`, PostgreSQL `18`, Redis
`8.10.2`, Windows-first disposable fixture. The fixture owns
`%TEMP%\enough-phase7`, PostgreSQL `55438`, Redis `56391` (Windows relay) / `56394`
(WSL), API `4412`, and web `3307`. It does not read root `.env` or use
`.runtime/`, production services, Docker, GitHub Actions, credentials, or
browser profiles.

| Command | Result |
| --- | --- |
| `pnpm test -- packages/shared/src/policy-rules.test.ts` | PASS, 16/16; condition conjunction, scopes, priorities/ties, defaults, schedule bounds, overnight/DST behavior, override expiry/revocation, and byte-for-byte fixed-snapshot decisions. |
| `pnpm test:rules:integration` | PASS, 5/5 live API/runtime checks; disposable PostgreSQL migration precheck found no pending migrations. The initial fresh fixture applied `0001`–`0015` in order; the Phase 7 test verifies migration IDs `0001`–`0007` and all three rule tables. |
| `pnpm test` | PASS, 72 passed; 131 database/runtime integration tests skipped by the default non-fixture run. |
| `pnpm typecheck` | PASS across all 11 participating workspace projects, including API and web. |
| `pnpm format:check` | PASS, 160 files checked. |
| `pnpm lint` | Exit 0; 124 repository warnings and one informational diagnostic remain; no Phase 7 lint error. |
| `node scripts/phase2-runtime.mjs prepare --phase7` | PASS; generated one synthetic account at `%TEMP%\enough-phase7\manual-account.json`, did not print credentials, and stopped the fixture services. |

Live coverage verifies unauthenticated and CSRF rejection; rule CRUD; concurrent
and stale expected-version conflicts; archived version history; product/device
ownership and account isolation; schedule and context matching; API decisions
equal to the shared evaluator for the returned timestamp; override precedence,
expiration, and revocation; account export isolation; product/account deletion
cascades; and serving the rules page and its client bundle. The desktop and
extension source both import the same `evaluatePolicyRules` implementation.

### Superseded fixture attempts

- An early `pnpm test:rules:integration` selected Phase 3–6 integration files
  whose fixtures assert their own fixed ports and incorrectly expected an
  evaluation against another member's product to succeed. The Phase 7 runner
  now selects its own rule integration file; the test uses a second product
  owned by the same member for a non-match and separately asserts foreign-scope
  requests return `404`.
- A retry found WSL port `56392` unavailable due to TCP `TIME_WAIT`, despite no
  Redis listener. The fixture now uses verified-free WSL port `56394` and an
  `SO_REUSEADDR` availability probe. A probe against a known active Redis
  listener still rejects the bind; no process was stopped or modified.
- The initial web smoke assertion expected client-rendered headings in static
  HTML. The isolated page correctly returns its loading shell; the final check
  verifies the route and fetched client bundle contain the expected rules UI.

## Consolidated browser review — PASS

These session labels are local to this record; the canonical roadmap does not
define Phase 7 browser check IDs. The user completed the session using the
isolated fixture and synthetic account, then confirmed the fixture stopped.

1. In PowerShell at `C:\Enough`, run `pnpm test:rules:serve`. Wait for
   `Fixture serving`. The command starts only the Phase 7 TEMP/loopback fixture
   and writes fresh credentials to `%TEMP%\enough-phase7\manual-account.json`.
   Open that file locally; do not paste its contents into chat. In a private
   window, open `http://127.0.0.1:3307/login`, sign in with those credentials,
   then click **Workspace menu → Rules**.
2. **P7-1 — Create and schedule:** Confirm the Rules page and empty rule set
   load. Create a rule with name `Phase 7 manual rule`, action `BLOCK`, priority
   `80`, enabled, product scope **All products**, device scope **All devices**;
   select classification `BUILD`; tool type `APPLICATION`; identifier
   `com.microsoft.vscode`; context name `purpose`; context value `work`. Enable
   **Limit to a schedule**, set time zone `Europe/Berlin`, select all seven
   days, set both local start and end to `00:00`, and leave absolute begin/end
   blank. Click **Create rule**. Expect the row to show version 1, priority 80,
   BLOCK, all-product/all-device scope, and the Europe/Berlin schedule.
3. **P7-2 — Preview and version:** In **Decision preview**, enter tool type
   `APPLICATION`, identifier `com.microsoft.vscode`, **No product**, **No
   device**, context `purpose` / `work`, then click **Evaluate current policy**.
   Expect `BLOCK · Not allowed`, source `RULE`, and rule version 1. Edit the
   rule, rename it `Phase 7 manual rule edited`, change action to `WARN` and
   priority to `90`, and click **Save new version**. Click **Versions**; expect
   versions 2 and 1. Re-evaluate and expect `WARN · Allowed`, source `RULE`,
   matched rule version 2.
4. **P7-3 — Temporary override:** Create an override for `APPLICATION` /
   `com.microsoft.vscode`, action `ALLOW`, all products/devices, reason
   `Manual acceptance override`, expiry two hours after the current local time.
   Expect it in the override list. Re-evaluate and expect `ALLOW · Allowed`,
   source `OVERRIDE`. Click **Revoke**, re-evaluate, and expect the version-2
   `WARN · Allowed` rule decision again.
5. **P7-4 — Archive and fallback:** Click **Archive** on the rule and confirm
   it remains visible as archived with history retained. Re-evaluate the same
   input; expect `ALLOW · Allowed`, source `DEFAULT`, because no active rule or
   override matches.
6. **P7-5 — Usability:** At approximately 390 px viewport width, use keyboard
   navigation through the rule and preview controls. Confirm labels, focus,
   feedback, history, and action buttons remain readable and usable without
   clipping; restore normal width.

**User-reported result, 2026-10-11:** P7-1 PASS, P7-2 PASS, P7-3 PASS, P7-4
PASS, P7-5 PASS. Rule creation/schedule, BLOCK v1 and WARN v2 previews,
temporary ALLOW override precedence and revocation, archive/history retention,
DEFAULT fallback, narrow layout, and keyboard/focus usability all passed. The
fixture stopped successfully; no manual failures were observed. Browser/version
was not supplied. These are user-reported results; no browser checks were
rerun.

Recorded report:

```text
Browser/version: Not supplied
P7-1 PASS
P7-2 PASS
P7-3 PASS
P7-4 PASS
P7-5 PASS
Failure details: None reported
Fixture stopped: YES
```

## Security and release status

Server-side session, CSRF, owner, and product/device scope checks pass in the
isolated integration suite. This phase does not establish production
enforcement acceptance or prove end-to-end extension/desktop policy sync. The
18 dependency findings remain open release obligations (3 critical, 8 high, 7
moderate); production launch remains **NO-GO**. No dependency, lockfile,
production service, or protected configuration was changed. No commit or push
is authorized.
