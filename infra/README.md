# Production infrastructure

This is a single Ubuntu VPS deployment. Nginx terminates TLS, Next.js serves the app on loopback, Fastify serves the API on loopback, the worker runs under systemd, and PostgreSQL and Redis remain local. No containers are used. Runtime and deployment steps below are templates; this workspace has not deployed to a host.

## Host layout and prerequisites

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

Copy [env/enough.env.example](env/enough.env.example) to `/home/enough/apps/enough/shared/.env`, replace every placeholder, and set owner `enough:enough` with mode `0600`. Keep `.env` values compatible with both Node's env-file parser and systemd `EnvironmentFile`; quote values containing whitespace or `#`.

Use `https://enough.example.com` for `APP_BASE_URL` and `https://api.enough.example.com` for `API_BASE_URL`. Point both DNS records to the VPS. Register the Google and GitHub callback URLs as `${API_BASE_URL}/auth/oauth/google/callback` and `${API_BASE_URL}/auth/oauth/github/callback`. Add exact installed extension origins to `AUTH_ALLOWED_ORIGINS` after publisher IDs exist.

Before installing the final Nginx file, install [nginx/enough-acme.conf](nginx/enough-acme.conf) temporarily as `/etc/nginx/sites-available/enough.conf` and serve its HTTP ACME challenge location for both names. Obtain one certificate covering both names with Certbot's webroot authenticator, for example `sudo certbot certonly --webroot -w /var/www/letsencrypt -d enough.example.com -d api.enough.example.com --agree-tos --email OPS_EMAIL`. Then replace the temporary site with [nginx/enough.conf](nginx/enough.conf), disable the default site after checking it is not used by another application, enable the Enough site, and run `nginx -t` before reloading Nginx. The installed Certbot deploy hook reloads Nginx after successful renewal. Verify renewal with `certbot renew --dry-run`.

Only expose SSH and HTTPS in the firewall. Before changing firewall rules remotely, confirm the SSH rule and keep the current session open. The app and API listen on loopback; `/ready` is restricted to loopback and the OAuth callback query is excluded from Nginx access logs.

## Release, migrations, and rollback

Keep a reviewed production environment file in `shared/.env`, then create the first release through the persistent release launcher installed at bootstrap. The command requires an SSH Git repository, a full approved ref, and explicit migration approval:

```sh
sudo -u enough -H bash /home/enough/apps/enough/scripts/deploy.sh \
  git@github.com:OWNER/REPOSITORY.git refs/tags/vX.Y.Z --approve-migrations
```

The launcher fetches an immutable approved checkout, runs frozen installation and tests with production application secrets removed from those child processes, builds the web app, performs a read-only migration/checksum precheck, creates and uploads a pre-migration backup, runs migrations, switches `current` atomically, restarts systemd, and polls web/API/worker readiness. Commands run from the staged checkout. A failed restart or readiness check restores the prior code symlink. After the first successful deployment, enable the app units so systemd starts them after a reboot:

```sh
sudo systemctl enable enough-api.service enough-web.service enough-worker.service
```

The script requires `BACKUP_AGE_RECIPIENT` and `BACKUP_RCLONE_DEST`; configure an age public recipient and an off-host rclone destination before deployment. The corresponding rclone config must be readable by `enough` and mode `0600`. Daily backups are encrypted before writing, uploaded off-host, and local files older than the retention period are pruned while keeping at least three. Remote retention is governed by the selected storage provider and must be configured there.

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
