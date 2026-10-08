# Authentication package

`@enough/auth` registers the Phase 2 authentication and account routes on the Fastify API. The browser uses the same-origin Next.js proxy at `/api/auth/*`; native clients call the API base URL directly.

## Browser client

1. Fetch `GET /api/auth/csrf` before sending an unauthenticated state-changing request. The response includes a CSRF token and sets a short-lived pre-auth cookie.
2. Send that token in `x-csrf-token` on signup, password login, magic-link requests, password-reset requests, verification resends, and OAuth start.
3. Browser sessions use HTTP-only cookies. Send `credentials: "include"`; for authenticated state-changing requests, send the readable CSRF cookie value in `x-csrf-token`.
4. Use `GET /api/auth/me` to read the signed-in account. Session and device management is available from `/api/auth/sessions` and `/api/auth/devices`.

Email verification, password reset, and magic-link tokens are placed in URL fragments so they are not sent in HTTP requests or referrer headers. The web pages consume them and remove them from the visible URL.

## Desktop and extension clients

An installed client can call `POST /auth/login` with `clientType: "desktop"` or `"extension"` and a `deviceName`. After email verification, the response includes a one-time bearer `accessToken`, expiry, session ID, and device ID. Send the token as `Authorization: Bearer <accessToken>` and use `GET /auth/me` to validate the session. Store the token in the operating system's credential store or the extension's protected storage; do not put it in ordinary web storage or logs.

The web account page can also issue a bearer session through `POST /api/auth/sessions`; the token is returned once. Revoke individual sessions with `DELETE /auth/sessions/:sessionId`, or revoke a device and all its sessions with `DELETE /auth/devices/:deviceId`.

Rotation and derived sessions retain the original authentication time in `auth_sessions.created_at`; they do not count as a fresh sign-in for passwordless account deletion. Derived issuance rechecks the parent credential inside the transaction, rejecting a parent that has expired, been revoked, had its device revoked, or been rotated while the request waited.

The API allows cross-origin calls only from the app origin and exact origins listed in `AUTH_ALLOWED_ORIGINS` (comma-separated). Add a browser extension's actual origin there before using it. Desktop clients generally make requests without a browser Origin header. The API trusts forwarded client IP headers only from loopback, where the bundled Nginx template connects; keep the API bound to loopback and do not place an untrusted proxy in that position.

The browser extension source is in `apps/extension`. Its MV3 login flow uses `clientType: "extension"`, stores the bearer token in extension local storage restricted to trusted extension contexts where the browser supports that setting, and refreshes the session before expiry. Users can sign in with a verified email/password or paste an extension token issued once by the web account page (useful for provider-only accounts). This storage is not encrypted by the extension; protect the browser profile and revoke its device from the web account page if the browser is lost. Extension runtime acceptance remains pending. Desktop agent source is in `apps/desktop`; its runtime and packaging acceptance remains pending.

## Local email setup

For local development, set `AUTH_DEV_SHOW_EMAIL_LINKS=true` in `.env` to print verification, reset, and magic-link URLs to the API process output. This is disabled by default in the runtime config and rejected in production. Alternatively, configure `RESEND_API_KEY` and `AUTH_EMAIL_FROM` with a Resend API key and verified sender.

Production requires a unique `AUTH_SECRET` of at least 32 characters, HTTPS `APP_BASE_URL` and `API_BASE_URL`, and Resend credentials. Generate the secret with a cryptographically secure password generator and keep it in the deployment secret store.

## OAuth provider setup

Register these exact callback URLs with each provider:

```text
${API_BASE_URL}/auth/oauth/google/callback
${API_BASE_URL}/auth/oauth/github/callback
```

Set the matching `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` in the API environment. OAuth uses state, PKCE, verified provider email, and a short-lived exchange token bound to the browser's original pre-auth CSRF token. Provider credentials and callback registration are environment-specific and are not included in this repository.

Passkeys are not implemented in this phase; `/auth/providers` reports `passkeys: false`.

## Phase 2 local acceptance

Run `pnpm test:auth:integration` from `C:\Enough` after the isolated API (4400), web (3301), PostgreSQL (55432, `enough_phase1`) and Redis (56379) services are running. The runner loads `.runtime/phase1/fixture.env`, verifies its isolated targets and disables external providers. It creates/removes only synthetic test accounts. The default test suite includes production cookie/CSRF checks and intentionally skips live integration tests.

Rotation preserves the original authentication timestamp and atomically replaces only the credential that authenticated the request. Concurrent old-token rotation has one winner. Password login and password change reject a concurrent password replacement; verification and account-row locking stay inside existing transactions.

For real local OAuth acceptance, callbacks are `http://127.0.0.1:4400/auth/oauth/google/callback` and `http://127.0.0.1:4400/auth/oauth/github/callback`, with web origin `http://127.0.0.1:3301`. Load real provider pairs only from gitignored `C:\Enough\.env`; keep `.env.example` and test fixtures credential-free. The integration runner deliberately cannot enable OAuth providers. See [PHASE_2_ACCEPTANCE.md](../../PHASE_2_ACCEPTANCE.md) for scope, evidence and outstanding real-provider/installed-client checks. Phase 2 remains PARTIAL.
