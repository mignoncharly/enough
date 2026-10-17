# Production infrastructure

This is a single Ubuntu VPS deployment. Nginx terminates TLS, Next.js serves the app on loopback, Fastify serves the API on loopback, the worker runs under systemd, and PostgreSQL and Redis remain local. No containers are used. Runtime and deployment steps below are templates; this workspace has not deployed to a host.

## Host layout and prerequisites

**PRODUCTION NO-GO.** `REMEDIATION_IMPLEMENTATION_PLAN.md` is the canonical roadmap: Phase 15 is the AI Layer; Phases 24–27 retain their distribution/infrastructure/verification/launch meanings. Release-hardening checkpoint `35f18280231613a890d10e340160e62604ccb2d8`, previously labelled “15A”, is supporting work for Phase 25, not AI Layer acceptance or Phase 25 completion. Releases are operator-controlled on a local/release host, with no Docker or GitHub Actions.

The release-hardening checkpoint covers configuration, subprocess isolation and callback logging only. Remaining gates: dependency audit (21 findings: 3 critical, 9 high, 9 moderate), migration/evidence-storage orchestration, coordinated database/object backup and restore, monitoring/alerting, hosted staging/device acceptance, external security approval and upload risk decision, legal/publication approval, and operator/recovery approval. GA4 standard-report normalization/cleanup stays deferred; Microsoft PERSONAL_MSA provider revocation stays blocked by provider behavior. Neither Phase 14 exception is reopened here.

The bootstrap script requires an explicit `--apply` and root access. It installs Ubuntu packages and the systemd, Redis, journald, sudoers, and Certbot reload-hook templates. It does not set up Node.js, pnpm, DNS, secrets, TLS certificates, or firewall rules, and it does not enable the app services.

```sh
sudo bash infra/ubuntu/bootstrap.sh --apply
```

Install Node.js 22 or newer and pnpm 11.20.0 using the approved package sources for the host. The unit files expect pnpm at `/usr/bin/pnpm`. Confirm `node --version`, `pnpm --version`, and `command -v pnpm`; either provide the expected path or update the unit files and deploy script together.

The script creates this layout:

```text
/home/enough/apps/enough/
├── current -> releases/<approved-release>
├── releases/
├── scripts/
└── shared/
    ├── .env
    ├── backups/
    └── logs/
```

The `enough` service account owns application releases and shared data. Put a read-only SSH deploy key and `known_hosts` file in that account's home. The checked-in sudoers rule permits it to restart only the three Enough application units.

## PostgreSQL and Redis

Follow [postgres/production.md](postgres/production.md) to create the non-superuser app role and database. Keep PostgreSQL on loopback and use SCRAM authentication.

The Redis snippet enables loopback binding, protected mode, and AOF persistence. Review `/etc/redis/redis.conf`, install the snippet from `/etc/redis/enough-production.conf`, and configure a dedicated Redis ACL user before restarting Redis. Generate a random hexadecimal password and store only its SHA-256 hash in `/etc/redis/users.acl`:

```text
user default off
user enough on #<sha256-of-random-password> ~* &* +@all
```

Set that same password in `REDIS_URL` as `redis://enough:<password>@127.0.0.1:6379/0`. Protect the ACL file as `root:redis`, mode `0640`. Do not expose Redis or PostgreSQL through the host firewall.

## Environment and TLS

### Production configuration contract

Runtime validation lives in `packages/config/src/index.ts`; evidence operations additionally use `packages/evidence-storage/src/index.ts`. The template contains every runtime config key. Empty optional provider groups remain disabled. No acceptance TEMP files belong in a production release.

| Variables | Classification | Contract |
| --- | --- | --- |
| `NODE_ENV` | Required non-secret configuration | `production` for services and trusted release preflight. |
| `DATABASE_URL`, `REDIS_URL` | Required production secret | Explicit protected connection URLs; URL-encode passwords. Runtime and release preflight require explicit production connections; defaults are for development/test only. |
| `WEB_PORT`, `API_PORT`, `WORKER_PORT`, `LOG_LEVEL` | Required non-secret configuration | Defaults 3000/4000/4001/info; keep proxy and service ports aligned. |
| `APP_BASE_URL`, `API_BASE_URL` | Required non-secret configuration | HTTPS origins without credentials/path/query/fragment. API origin is embedded in Next rewrites at build time. |
| `AUTH_SECRET` | Required production secret | Unique random value, at least 32 characters. Also underpins encrypted integration credentials; custody/recovery and rotation need a reviewed data/key plan. |
| `POLICY_SNAPSHOT_SIGNING_PRIVATE_KEY` | Required production secret | Operator-custodied Ed25519 PKCS#8 PEM. Single-quoted single-line PEM with literal `\n` separators; runtime expands them. Never generate a production key during builds or store it in source. Protect recovery material and plan public-key rotation. |
| `RESEND_API_KEY` | Required production secret | Required by production validator. |
| `AUTH_EMAIL_FROM` | Required non-secret configuration | Production sender; quote display names containing spaces. |
| `AUTH_SESSION_DAYS`, `AUTH_DEV_SHOW_EMAIL_LINKS`, `CREDITS_MANUAL_CONTROLS_ENABLED` | Required non-secret configuration | Defaults 30/false/false. Both switches must stay false in production. |
| `AUTH_ALLOWED_ORIGINS` | Required non-secret configuration | Empty or comma-separated additional exact reviewed client origins. App origin is automatically allowed. CSRF remains enabled; API trusts loopback proxies in code, with no separate trusted-host env knob. |
| `ADMIN_EMAILS` | Required non-secret configuration | Empty default; private operational identity list for verified bootstrap administrators. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Optional provider configuration | Sign-in ID/secret pairs, all-or-none per provider. IDs non-secret; secrets protected. |
| `GOOGLE_INTEGRATION_CLIENT_ID`, `GOOGLE_INTEGRATION_CLIENT_SECRET`, `MICROSOFT_INTEGRATION_CLIENT_ID`, `MICROSOFT_INTEGRATION_CLIENT_SECRET` | Optional provider configuration | Integration ID/secret pairs, separate from sign-in settings. IDs non-secret; secrets protected. |
| `EVIDENCE_STORAGE_BUCKET`, `EVIDENCE_STORAGE_REGION`, `EVIDENCE_STORAGE_ENDPOINT`, `EVIDENCE_STORAGE_ACCESS_KEY_ID`, `EVIDENCE_STORAGE_SECRET_ACCESS_KEY` | Optional provider configuration | All-empty startup is supported with file operations unavailable. Bucket/region/access ID/access secret required together for storage; endpoint optional. Both credentials protected; other fields non-secret. |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Optional provider configuration | Key secret; model non-secret, defaults to `gpt-6-astra`. Empty key disables the provider. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRETS`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL` | Optional provider configuration | Billing secret/webhook secrets together; prices require that pair. Secrets protected, price IDs non-secret. Webhook secrets comma-separated. |
| `STRIPE_TRIAL_DAYS`, `BILLING_GRACE_DAYS`, `STRIPE_AUTOMATIC_TAX` | Optional provider configuration | Non-secret billing defaults 0/3/true. |
| `BACKUP_AGE_RECIPIENT`, `BACKUP_RCLONE_DEST`, `BACKUP_RETENTION_DAYS` | Required non-secret configuration (backup tools only) | Public age recipient, destination without embedded credentials, local retention default 14 days. Not application startup requirements. |
| `RESTORE_ADMIN_DATABASE_URL`, `BACKUP_AGE_IDENTITY_FILE`; rclone credential file; SSH deploy key; TLS private key; desktop signing/notarization credentials | Operator/bootstrap-only secret | Separate protected custody, never inherited by install/check/web build commands. Restore identity variable points to a protected private-key file. Not app env requirements. |
| `ENOUGH_APP_ROOT`, `VERIFY_ATTEMPTS`, `VERIFY_DELAY_MS`, `VERIFY_TIMEOUT_MS` | Required non-secret configuration (operator tool defaults) | Defaults `/home/enough/apps/enough`, 12, 5000 ms, 5000 ms; override only for approved operator commands. |
| OAuth state/codes, access/refresh tokens, per-connection API credentials, session values and provider account IDs | Generated/runtime value | Sensitive runtime state; per-account provider credentials encrypted in the database, never shared production env fields or logs. |

**Storage:** omit endpoint for regional AWS S3; otherwise use an HTTPS S3-compatible endpoint (path-style requests). No embedded credentials, query or fragment. HTTP is supported only for loopback fixtures. Credentials need bucket-scoped list/read/write/copy/delete capabilities. Require private buckets, blocked public access, TLS and provider-side encryption at rest. The SDK does not configure bucket encryption/lifecycle. Downloads remain owner-scoped API reads. Never expire live `obj-` objects independently of metadata; coordinate staging cleanup, deletion outbox, backup retention and privacy erasure. Production file acceptance requires storage configuration and bucket-policy evidence despite all-empty startup being valid.

**Integration callbacks:** register exactly `${API_BASE_URL}/integrations/oauth/google/callback` and `${API_BASE_URL}/integrations/oauth/microsoft/callback`. Authorization/token exchange use the same URI. Local Entra localhost compatibility is fixture-only. Google covers Gmail/Calendar/GA4; Microsoft covers Outlook/Calendar. Scopes remain unchanged. PostHog/Plausible and Stripe revenue verification use encrypted per-connection credentials; Stripe billing env keys are separate. GA4 runtime uses Google OAuth, never an acceptance Measurement Protocol secret.

### Release subprocess boundary

`scripts/subprocess-environment.mjs` allowlists OS/tool plumbing for install, checks and tests; all other inherited variables are dropped, including future provider secrets, `NODE_OPTIONS`, npm authentication and proxy settings. `--test` sets test mode. Trusted fixture code can explicitly inject fixture values after sanitization without mutating the parent. The release CLI exposes no arbitrary fixture override.

`--build` passes only validated public app/API origins and disposable synthetic module-evaluation credentials, allowing Next to evaluate production config without production auth/signing/provider/storage credentials. Build database/cache endpoints use loopback port 1. Services load actual runtime values anew. Never use build-only values as deployment credentials. `--runtime` explicitly preserves credentials only for trusted preflight/runtime/migration/backup commands.

Isolated commands refuse root/web dotenv files in a release checkout so Next/test loaders cannot reload stripped credentials. Use an approved clean checkout; do not delete developer env files to bypass the guard. Use `--clean` for typecheck/lint/static tools. Trusted preflight uses the actual runtime validator, requires explicit database/cache URLs and rejects the fixture-only Microsoft localhost override. It reports only PASS/BLOCKED without network calls; it is not deployment approval.

Environment isolation is not a filesystem sandbox. Release-host account separation, protected credential files, npm user configuration and lifecycle-script trust remain operator/security gates. Signing/distribution commands require separately approved credential-scoped execution.

### Callback logging

Nginx's path map excludes generic sign-in/integration callbacks, including web `/api/` aliases, on HTTP and HTTPS servers. Ordinary API traffic remains logged. Callback proxy error logs are suppressed because upstream errors may include query strings. Safe API request IDs/status and fixed failure messages remain in journald; never enable callback URL/query/body logging for diagnosis.

Copy [env/enough.env.example](env/enough.env.example) to `/home/enough/apps/enough/shared/.env`, replace every placeholder, and set owner `enough:enough` with mode `0600`. Keep `.env` values compatible with both Node's env-file parser and systemd `EnvironmentFile`; quote values containing whitespace or `#`.

Use `https://enough.example.com` for `APP_BASE_URL` and `https://api.enough.example.com` for `API_BASE_URL`. Point both DNS records to the VPS. Register the Google and GitHub callback URLs as `${API_BASE_URL}/auth/oauth/google/callback` and `${API_BASE_URL}/auth/oauth/github/callback`. Add exact installed extension origins to `AUTH_ALLOWED_ORIGINS` after publisher IDs exist.

Before installing the final Nginx file, install [nginx/enough-acme.conf](nginx/enough-acme.conf) temporarily as `/etc/nginx/sites-available/enough.conf` and serve its HTTP ACME challenge location for both names. Obtain one certificate covering both names with Certbot's webroot authenticator, for example `sudo certbot certonly --webroot -w /var/www/letsencrypt -d enough.example.com -d api.enough.example.com --agree-tos --email OPS_EMAIL`. Then replace the temporary site with [nginx/enough.conf](nginx/enough.conf), disable the default site after checking it is not used by another application, enable the Enough site, and run `nginx -t` before reloading Nginx. The installed Certbot deploy hook reloads Nginx after successful renewal. Verify renewal with `certbot renew --dry-run`.

Only expose SSH, HTTPS and HTTP for ACME/HTTPS redirects in the firewall. Before changing firewall rules remotely, confirm the SSH rule and keep the current session open. The app and API listen on loopback; API `/ready` is restricted to loopback and OAuth callback queries are excluded from Nginx access logs.

## Release, migrations, and rollback

Keep a reviewed production environment file in `shared/.env`, then create the first release through the persistent release launcher installed at bootstrap. The command requires an SSH Git repository, a full approved ref, and explicit migration approval:

```sh
sudo -u enough -H bash /home/enough/apps/enough/scripts/deploy.sh \
  git@github.com:OWNER/REPOSITORY.git refs/tags/vX.Y.Z --approve-migrations
```

The launcher resolves the approved ref to a detached checkout, runs frozen installation and tests in isolated child environments, validates runtime configuration offline, builds the web app without production credentials, performs a read-only migration/checksum precheck, creates and uploads a pre-migration backup, runs migrations, switches `current` atomically, restarts systemd, and polls web/API/worker readiness. Commands run from the staged checkout. Ref-to-approved-commit enforcement and migration/evidence-storage orchestration remain later release gates; do not execute this template while NO-GO. A failed restart or readiness check restores the prior code symlink. After an approved first deployment, enable the app units so systemd starts them after a reboot:

```sh
sudo systemctl enable enough-api.service enough-web.service enough-worker.service
```

The script requires `BACKUP_AGE_RECIPIENT` and `BACKUP_RCLONE_DEST`; configure an age public recipient and an off-host rclone destination before deployment. The corresponding rclone config must be readable by `enough` and mode `0600`. Daily backups are encrypted before writing, uploaded off-host, and local files older than the retention period are pruned while keeping at least three. Remote retention is governed by the selected storage provider and must be configured there.

The release-hardening checkpoint only narrows the environments of existing PostgreSQL/age/rclone subprocesses: PostgreSQL receives credentials from its explicit connection argument; age/rclone receive OS/tool plumbing. Rclone uses the protected default user config, not inherited `RCLONE_*` overrides. Backup/restore sequencing is unchanged and was not executed or accepted by that checkpoint.

The code rollback does not reverse database migrations. Migrations must remain backward-compatible with the previous application release; destructive schema changes require a separately reviewed recovery plan. To roll code back manually, use a known release directory:

```sh
sudo -u enough -H bash /home/enough/apps/enough/current/scripts/rollback.sh \
  /home/enough/apps/enough/releases/<release-directory>
```

Rollback switches only between managed release directories, restarts services, and verifies readiness. It never restores or drops a production database.

## Backups, restore checks, monitoring, and logs

Enable the timers after the first app release and verify they are active:

```sh
sudo systemctl enable --now enough-backup.timer enough-monitor.timer
systemctl list-timers enough-backup.timer enough-monitor.timer
```

The monitor checks web, API, worker, PostgreSQL, and Redis readiness every minute and records failures in journald. It does not send external alerts; configure host-level alerting before production. Application output goes to journald. `journald-enough.conf` retains persistent logs for up to 30 days, capped at 1 GiB.

Verify an encrypted dump in an isolated temporary database at least monthly. Use a separate database URL whose PostgreSQL role has `CREATEDB` but is not a superuser, and an age identity whose file is mode `0600`, owned by the operator account. Supply them only to the manual restore command; they are not in the app service environment:

```sh
sudo install -o enough -g enough -m 0600 /dev/null \
  /home/enough/apps/enough/shared/restore.env
sudoedit /home/enough/apps/enough/shared/restore.env
sudo -u enough -H bash /home/enough/apps/enough/current/scripts/restore-test.sh
sudo rm -- /home/enough/apps/enough/shared/restore.env
```

That temporary file should contain only `RESTORE_ADMIN_DATABASE_URL` and `BACKUP_AGE_IDENTITY_FILE`. It is not loaded by application services; remove it after the restore check.

The restore script accepts only managed backup filenames, creates a timestamp-named isolated database, decrypts and restores into it, checks the migration ledger, and drops that generated database. It does not connect to production write credentials. Review the output and confirm the off-host copy independently; a successful backup command alone is not a restore test.

Inspect service and monitor logs with `journalctl -u enough-api -u enough-web -u enough-worker -u enough-monitor`. Nginx access/error logs use Ubuntu's standard rotation. Readiness and systemd restart checks are operational signals, not external alerting or application-level monitoring for latency, queue depth, payment reconciliation, or provider failures.

## Remaining production acceptance

No deployment, host bootstrap, Nginx validation, TLS issuance, systemd start, off-host backup, restore test, or reboot-survival check has been run from this workspace. Finish these on a configured Ubuntu host, then complete Phase 26's end-to-end production verification. See [DEPLOYMENT_STATUS.md](../DEPLOYMENT_STATUS.md) and [IMPLEMENTATION_HANDOFF.md](../IMPLEMENTATION_HANDOFF.md).
