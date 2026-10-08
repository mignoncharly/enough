# Enough

Enough helps technical founders balance building with customer learning. This repository is the product monorepo described in `ENOUGH_COMPLETE_IMPLEMENTATION_PLAN.md`.

## Current implementation

Phase 9 adds shared workspace navigation and themes, Today, Activity, Growth, goal-backed Tasks, Reports, Notifications, Devices, Billing, and Settings. Phase 13 adds private evidence submission and review. Phase 14 adds signed Generic webhook and Public Event API connections; Gmail, calendars, Stripe revenue ingestion, and analytics vendor adapters remain planned. Phase 15 adds an optional advisory AI Coach. Phase 16 adds reports, and Phase 17 adds the notification inbox, desktop alerts, opt-in email, preferences, and quiet hours. Phase 18 adds configurable Stripe subscription checkout, the Customer Portal, VAT/tax collection, invoices, webhook reconciliation, and paid-feature entitlement state. Runtime and browser acceptance for these surfaces is pending.

Phase 10 adds a Chromium and Firefox Manifest V3 extension for policy sync, top-level domain blocking, a focus page, a timed Growth Mode allowlist, and opt-in hostname-only activity tracking. Phase 11 adds the desktop tray agent and native messaging host. Phase 21 defines stale/offline policy behavior, bounded event queues, duplicate and multi-device handling, agent health reporting, integration revocation, and evidence-gated task rewards. Phase 24 configures desktop installers and updates and creates browser-store archives; signed releases and runtime acceptance are still pending. See [`RELEASES.md`](RELEASES.md), [`apps/extension/README.md`](apps/extension/README.md), and [`apps/desktop/README.md`](apps/desktop/README.md).

Phase 12 adds stage-specific and custom growth tasks. Phase 13 adds private task evidence and manual review; new task rewards enter the product wallet only after evidence is verified. Evidence review is performed by the product owner and is not independent verification. Phase 14 events authenticate the configured source signature; linked task evidence remains pending for owner review, and these connections do not prove a vendor-originated event.

For signed event setup and the normalized event contract, see [`INTEGRATIONS.md`](INTEGRATIONS.md).

For optional OpenAI setup, request data, and the Coach's trust boundaries, see [`AI_COACH.md`](AI_COACH.md).

For notification event sources, channel behavior, quiet hours, and delivery limits, see [NOTIFICATIONS.md](NOTIFICATIONS.md).

The workspace includes a Next.js web app, a Fastify API, a BullMQ worker, shared TypeScript packages, PostgreSQL/Drizzle migration plumbing, Redis connectivity, and local systemd/Nginx templates. Phases 2–7 add authentication, onboarding, product/stage guidance, activity ingestion, tool classifications, and policy rules. Phase 8 adds global and product-scoped credit wallets with expiring grants, reservation/spend/refund operations, atomic per-wallet locking, and a web wallet page. See [`IMPLEMENTATION_HANDOFF.md`](IMPLEMENTATION_HANDOFF.md) for acceptance status and [`packages/auth/README.md`](packages/auth/README.md) for the auth client contract.

## Local development

Requirements: Node.js 22 or newer, pnpm 11, PostgreSQL, and Redis. Docker is not used.

1. Copy `.env.example` to `.env` and adjust database credentials if needed.
2. In a local development database only, `psql -U postgres -f infra/postgres/dev-setup.sql` creates the example role/database. Start PostgreSQL and Redis. If you use the development email preview, set `AUTH_DEV_SHOW_EMAIL_LINKS=true` in `.env`; otherwise set `RESEND_API_KEY` and `AUTH_EMAIL_FROM`.
3. Run `pnpm install`.
4. Apply the database migrations with `pnpm db:migrate`.
5. Start all services with `pnpm dev`.

The default ports are web 3000, API 4000, and worker health server 4001; `.env` may override them. The development command checks that PostgreSQL and Redis accept TCP connections before launching the apps. To start a single app, use `pnpm dev:web`, `pnpm dev:api`, or `pnpm dev:worker`.

For Google or GitHub sign-in, configure the provider client ID and secret in `.env` and register the callback URL `${API_BASE_URL}/auth/oauth/google/callback` or `${API_BASE_URL}/auth/oauth/github/callback`. Both credentials are required for a provider to appear as available. Set a unique `AUTH_SECRET` for any deployed environment; production also requires HTTPS base URLs and Resend credentials.

Migrations 0002 through 0015 and Phases 2 through 24 runtime acceptance are pending. Phase 23 has 65 passing unit/property/contract tests and successful desktop/extension source builds, but live database, concurrency, load, and broad security coverage remain incomplete. Phase 24 generated Chrome, Edge, and Firefox store archives and configured desktop installer/update builds; local electron-builder packaging is blocked by denied access to its linked `dotenv` dependency, and signed builds, store publication, and end-user update acceptance remain pending. New task rewards require reviewed evidence; Phase 12 rewards already issued remain labeled self-reported. Manual credit earning and adjustments are owner-managed prototype controls, not billing or proof of completed work. Evidence review is performed by the product owner and is not independent verification. Stage ratios and tasks are advisory guidance. Tool classifications are labels; policy rules provide the optional enforcement decision. The AI Coach uses local stage guidance when no OpenAI provider is configured; its recommendations never change enforcement or evidence decisions. Email notifications require opt-in, a verified address, and configured Resend credentials. Stripe prices and product-specific paid-feature assignments remain unset pending pricing validation; the billing entitlement state is centralized and the feature mapping still needs a product decision. Passkeys are not included.

Phase 9 and Phase 12 through 18 UI routes and accessibility behavior have not been exercised in a browser.
Phase 10 Chromium/Firefox builds and Phase 24 store archive generation succeed; browser installation and behavior have not been exercised.

Health endpoints:

- Web liveness: `http://127.0.0.1:3000/api/health`
- Web readiness: `http://127.0.0.1:3000/api/ready`
- API liveness/readiness: `http://127.0.0.1:4000/health` and `/ready`
- Worker liveness/readiness: `http://127.0.0.1:4001/health` and `/ready`

Readiness returns HTTP 503 when PostgreSQL or Redis is unavailable. Liveness only reports whether the service process is responding.

## Workspace commands

- `pnpm lint` — lint the workspace with Biome
- `pnpm format` / `pnpm format:check` — format files or check formatting
- `pnpm typecheck` — typecheck each package that defines the script
- `pnpm test` — run Vitest (test runner configured; feature tests are added with their phases)
- `pnpm db:migrate` — apply checked SQL migrations
- `pnpm db:generate` — generate SQL migrations from the Drizzle schema

Phase 25 production setup and runbooks live in [`infra/README.md`](infra/README.md), with deployment status in [`DEPLOYMENT_STATUS.md`](DEPLOYMENT_STATUS.md). Phase 26's production verification matrix is in [`infra/production-verification.md`](infra/production-verification.md). The templates use `/home/enough/apps/enough` on Ubuntu and still require a configured host, production secrets, TLS, firewall rules, and reboot/backup acceptance.

The Phase 27 launch gate currently records **NO-GO**. See [`LAUNCH_READINESS.md`](LAUNCH_READINESS.md) for the capability assessment and release blockers.

The consolidated, risk-ranked plan for closing Phases 1–26 is [`REMEDIATION_IMPLEMENTATION_PLAN.md`](REMEDIATION_IMPLEMENTATION_PLAN.md); use [`REMEDIATION_HANDOFF.md`](REMEDIATION_HANDOFF.md) to resume execution and record test/security evidence.

Phase 0's agreed contract and architecture decisions are listed in [`PHASE_0_REVIEW.md`](PHASE_0_REVIEW.md). Contract completion does not imply implementation or runtime acceptance.

## Admin Console

Phase 22 adds `/admin` and the `/api/admin/*` support API. Set `ADMIN_EMAILS` to comma-separated, verified account emails to bootstrap administrator access. Administrators can grant database-backed `ADMIN` or `SUPPORT` roles to other verified accounts. The console covers account and subscription lookup, device and integration revocation, failed-job retry, shared rule and growth templates, feature flags, AI usage, live dependency/queue health, and a separate admin audit log. Migration `0015_admin_console.sql` must be applied before using the console. Runtime acceptance remains pending.
