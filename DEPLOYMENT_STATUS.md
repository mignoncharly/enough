# Deployment Status

Phase 15 closure — 2026-10-17: AI Layer acceptance is **COMPLETE**; production remains **NO-GO**. USER-REPORTED P15-1–P15-6 and final read-only verification pass; the provider-disabled Phase 15 fixture is stopped with evidence retained. This is not deployment or later-phase acceptance. The dependency baseline remains 21 findings (3 critical / 9 high / 9 moderate), with unchanged versions/lockfile and no repeated audit. See `AI_COACH.md`; the user authorized the Phase 15 checkpoint commit/push only, with no deployment or Phase 16 start.

## Phase 25 supporting release-hardening checkpoint

**PRODUCTION NO-GO.** Releases are operator-controlled on a local/release host, with no Docker or GitHub Actions. Checkpoint `35f18280231613a890d10e340160e62604ccb2d8` reconciles production configuration, isolates install/test/build environments and protects integration OAuth callback logs. Its earlier “15A” label was a numbering mistake: the canonical `REMEDIATION_IMPLEMENTATION_PLAN.md` defines Phase 15 as AI Layer and Phase 25 as Production Infrastructure. The accepted release-hardening work is retained; it does not complete either phase. See [infra/README.md](infra/README.md) for the current contract and remaining gates. No deployment, credential change or host operation occurred.

Phases 24–27 below retain their canonical numbering. Their old claims that provider adapters are absent or migrations through 0015 remain locally unaccepted are historical, superseded by Phase 12–14 records. They do not establish production deployment acceptance. GA4 standard reporting/normalization/cleanup stays deferred; Microsoft PERSONAL_MSA revocation stays blocked by provider behavior.

## Historical deployment record

Last updated: 2026-10-07

Phase 25 adds a release-based Ubuntu VPS deployment layout under `/home/enough/apps/enough`, dedicated `enough` services, TLS Nginx templates for separate app/API hosts, database/Redis setup notes, systemd service and timer units, encrypted off-host PostgreSQL backups, isolated restore verification, a migration precheck, and deployment/rollback scripts. See [infra/README.md](infra/README.md) for setup and operations.

Phase 25 remains partial until a real Ubuntu host is configured and accepted. This workspace has not installed the bootstrap packages, configured Node.js/pnpm, created production database credentials or Redis ACLs, set hostnames/secrets, issued TLS certificates, opened a firewall, deployed the application, enabled services/timers, verified remote backups, restored a backup, or tested reboot recovery. Monitoring writes readiness failures to journald but does not send external alerts. Code rollback does not reverse database migrations; migrations must be backward-compatible.

Phase 26 is partial. The production verification matrix is in [infra/production-verification.md](infra/production-verification.md). A read-only workspace check on 2026-10-07 found no local listeners on TCP ports 80, 443, 3000, 3001, 4000, 4001, 5433, or 6379; web/API/worker readiness requests were unavailable. No production integration, provider, backup/restore, or reboot scenarios have been exercised. Gmail, Outlook, and calendar vendor sync adapters and signed Phase 24 release artifacts are also outstanding prerequisites for their applicable checks.

Phase 27's current launch decision is **NO-GO**. The complete capability assessment and release blockers are in [LAUNCH_READINESS.md](LAUNCH_READINESS.md). Source presence and earlier unit-test results do not establish production acceptance.

Phase 24 remains partial: extension store archives exist and desktop release configuration is present, but signed installers, store submissions, and end-user install/update acceptance remain open. Phases 2 through 24 still require their recorded runtime acceptance; migrations `0002` through `0015` have not been applied in the recorded local database.

Use the production environment sample at [infra/env/enough.env.example](infra/env/enough.env.example). Keep `ADMIN_EMAILS` limited to verified bootstrap administrator emails before granting operational access. Phase 22 migration `0015_admin_console.sql`, admin actions, and queue/health reporting remain unverified.
