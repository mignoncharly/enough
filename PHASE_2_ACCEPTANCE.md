# Phase 2 — Authentication, Users, Sessions, Devices

Date: 2026-10-08. Status: **PARTIAL / IN PROGRESS**. Product launch: **NO-GO**.
Canonical repository: `C:\Enough`. Phase 1 is **COMPLETE** at verified revision `7e78c9d87ea993c7e95530b56dc5db9da1f8d4e7`; Phase 2 changes are currently uncommitted. Windows development only; no Docker, GitHub Actions or production deployment. Phase 3 has not begun and must not begin until Phase 2 is fully accepted.

## Scope and accepted local behavior

Scope follows Phase 2 in `ENOUGH_COMPLETE_IMPLEMENTATION_PLAN.md` and the tracker in `IMPLEMENTATION_PLAN.md`. Existing authentication architecture is retained. Passkeys remain deferred under the previously accepted practical-scope exception.

| Requirement | Local evidence | Status |
| --- | --- | --- |
| Authentication migration | `0002_authentication.sql` already applied through the runner during accepted Phase 1; no migration rewrite | Accepted; no new schema change |
| Signup and verification | Real database signup, generic duplicate response, normalized email, unverified-login rejection, verification replacement/replay/expiry | Passed |
| Password login and password reset/change | Correct/incorrect password, reset invalidation of existing sessions/pending magic links, replay rejection and concurrent credential changes | Passed |
| Passwordless option | Local preview and concurrent one-use magic-link consumption | Passed locally |
| Local email option | Explicit development preview intercepted only in process memory; URLs use fragments; production preview rejected | Passed; no Resend delivery claim |
| Web authentication | Real HTTP cookie login/logout via Next.js same-origin proxy; CSRF rejection; all four auth pages serve HTML | Passed at HTTP level; interactive browser acceptance pending |
| Desktop/extension authentication | Both bearer types register devices, authenticate and revoke over real HTTP and real DB/Redis route tests | Passed at API-contract level; installed-client acceptance pending |
| Session/device management | Own-account lists, cross-account rejection, individual session/device revocation and old-token rejection | Passed locally |
| Rotation and derived sessions | Cookie rotation invalidates the previous credential; concurrent bearer rotation has exactly one winner; rotation and derived web/desktop/extension sessions retain original authentication time; issuance rejects concurrently revoked/rotated parents | Passed locally |
| Export/deletion | Owner-only export without password/token hashes, password confirmation, passwordless fresh-auth requirement, cascading account deletion | Passed for synthetic local accounts without external billing |
| Security controls | Production cookie flags, CSRF origin/session binding, CORS, no-store responses, hashed credentials, credential-free audit metadata, Redis limits and fail-closed outage | Passed locally |
| Google and GitHub login | Source/config/callback review complete; both providers remain disabled | **Blocked: real local OAuth test apps and credentials absent** |
| Live OAuth state/PKCE/verified identity/exchange | Credential-free exchange binding/expiry/replay tested with synthetic tokens; no provider login accepted | **Pending real Google and GitHub flows** |

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

## Final local verification — 2026-10-08

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

Load real credentials only from gitignored `C:\Enough\.env` or another explicitly approved local secret source. Never copy them into source, examples, documentation, logs, test fixtures or Git. Before a real provider run, set the non-secret base URLs/ports above in `.env`, point its database/Redis settings at the existing disposable fixture, and run API/web with `.env`; the local integration runner intentionally disables providers and is not the real OAuth runner. Check target identity without printing the URL password or other secrets. Keep both providers disabled until complete real pairs are configured.

Google requests `openid profile email`; GitHub requests `read:user user:email`. Both routes generate state and S256 PKCE, require verified provider email, then issue a short-lived exchange token bound to the original browser CSRF token. These are source-reviewed claims; real provider acceptance remains outstanding.

## Remaining acceptance and blockers

- **High:** register both local OAuth test apps, load real pairs from `.env`, and verify Google and GitHub successful login, cancellation/error handling, state/PKCE, verified email, browser-bound exchange, replay and identity management. The user explicitly requires both successful real provider logins before Phase 2 COMPLETE.
- **High:** interactive web and installed desktop/extension authentication and revocation. Browser runtime setup succeeded but selection reported no browser available and discovery returned an empty list. HTTP contract tests do not substitute for installed-client runtime tests. No browser profile or desktop user data was modified.
- The browser-unavailable result was reconfirmed on this continuation. Windows Computer Use is not an authentication fallback: its bundled `docs/guidance.md` explicitly says "Do not automate user authentication dialogs." Desktop interactive sign-in therefore needs an available supported test surface or user-run acceptance. The relevant source is `C:/Users/migno/.codex/plugins/cache/openai-bundled/computer-use/26.818.41509/skills/computer-use/SKILL.md`, which requires following that guidance.
- User instruction on this continuation: record both live providers as blockers; later real credentials go only in gitignored `C:\Enough\.env`; do not mark Phase 2 COMPLETE until both real Google and GitHub end-to-end logins pass. Provider implementations remain intact and automatically available when complete real pairs are configured. No credentials were invented or written.
- Passkeys remain intentionally deferred; real Resend delivery is not claimed because the explicitly enabled local preview satisfies the local email option. TLS deployment, installer signing, update acceptance and external Stripe-account cleanup belong to later acceptance and were not exercised here.
- Local concurrency tests use deterministic database locks to exercise the identified races; they do not constitute broad load or formal security assurance.

**Phase 2 acceptance is not fully satisfied. Keep Phase 2 PARTIAL, Phase 3 on hold and launch NO-GO.**
