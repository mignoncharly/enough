# Phase 26 production verification

Phase 26 requires a configured Phase 25 Ubuntu deployment. Run this checklist against a production-like release with dedicated test accounts and synthetic data. Do not use real customer records or trigger real charges. Capture timestamps, release commit, service versions, outcomes, and redacted logs; never record credentials, OAuth codes, session cookies, or full webhook signatures.

## Entry conditions

- Phase 25 host, DNS, TLS, firewall, application services, timers, off-host backup, and restore check are accepted.
- The deployed release has all reviewed database migrations applied and the web, API, worker, PostgreSQL, Redis, Nginx, and systemd units are healthy.
- Email, OAuth, and Stripe test credentials are configured. Provider-specific integration credentials are available only for adapters that exist.
- A dedicated test account, second device, desktop build, and extension build are available. Use Stripe test mode and a test mailbox.
- An operator can inspect systemd/journald, queue state, database migration state, Nginx/TLS, and off-host backup storage.

If an entry condition is missing, record it and stop before changing production state. Keep the previous release available for code rollback. Database migrations are not reversed by that rollback.

## Verification matrix

| Area | Procedure and expected result | Status in this workspace |
| --- | --- | --- |
| Web, API, worker | Check `systemctl is-active enough-web enough-api enough-worker`; request the public app and API readiness endpoints; confirm internal worker readiness and dependency status. | Not run; no host or local service listeners. |
| PostgreSQL, Redis | Confirm services are active and bound only to loopback; run application readiness checks and a harmless database/cache read through the app. | Not run; local ports 5433 and 6379 are closed. |
| Nginx, TLS | Run `nginx -t`; verify HTTP redirects, ACME renewal, HTTPS certificate names/expiry, security headers, and public API routing. Confirm API `/ready` is inaccessible remotely. | Not run; no Nginx service, DNS, or certificate. |
| Email | Send a verification or magic-link email to the controlled test mailbox; follow it once, then verify expiry/replay behavior and that secrets/tokens do not appear in access logs. | Not run; no production mail credentials or host. |
| Billing webhooks | In Stripe test mode, deliver a signed subscription event; confirm signature rejection for an invalid signature, idempotent replay, correct entitlement change, and recovery from a retry. Do not create a real charge. | Not run; no Stripe test account/credentials or host. |
| OAuth callbacks | Complete Google and GitHub test sign-ins; verify state validation, account/session creation, redirect origin, and absence of callback query values in Nginx access logs. | Not run; no provider credentials or host. |
| Integration events | Send a signed Generic webhook or authenticated Public Event API event from a controlled source; verify normalization, deduplication, ownership, bounded processing, and revocation. | Not run. Gmail, Outlook, and calendar pull/sync adapters are not implemented yet; record those as product gaps rather than passing checks. |
| Activity ingestion | Submit authenticated test events twice and out of order; confirm deduplication, ordering, privacy fields, and the expected aggregate. | Not run; migrations and runtime are unavailable. |
| Desktop and extension sync | Install the reviewed desktop and browser builds, authenticate, sync policy, disconnect/reconnect, and verify the queued-event behavior. | Not run; Phase 24 signed installers/store installation remain pending. |
| Lock and unlock propagation | On two clients, apply a test block, verify both clients enforce it, then apply an authorized unlock/override/revocation and verify both converge within the documented sync interval. Also test stale/offline policy behavior. | Not run; runtime and migration acceptance remain pending. |
| Background jobs | Enqueue a harmless test job; verify worker execution, retry/idempotency behavior, queue health, and journald output without exposing payload secrets. | Not run; no worker or Redis service. |
| Backups and restore | Run an encrypted backup, confirm the remote object exists, restore it into the isolated generated test database, verify the migration ledger, and confirm the temporary database is dropped. | Not run; no age key, rclone remote, production DB, or host. |
| Restart and reboot | Restart each app service and confirm automatic recovery. In a maintenance window, reboot the host and confirm enabled services/timers, readiness, TLS, and backup scheduling recover. | Not run; no Ubuntu host. |

## Execution commands

Run service and timer checks on the Ubuntu host:

```sh
sudo systemctl --failed
sudo systemctl is-active enough-api.service enough-web.service enough-worker.service postgresql.service redis-server.service nginx.service
sudo systemctl list-timers enough-backup.timer enough-monitor.timer
curl --fail --silent --show-error https://enough.example.com/api/ready
curl --fail --silent --show-error https://api.enough.example.com/health
curl --fail --silent --show-error http://127.0.0.1:4000/ready
# From an external client, API /ready should be denied by Nginx.
curl --silent --output /dev/null --write-out '%{http_code}\n' https://api.enough.example.com/ready
sudo nginx -t
sudo certbot renew --dry-run
```

The API `/ready` route is intentionally loopback-only at Nginx; the external request should return a denial status. Check public TLS and callback behavior using the real DNS names. Use the restore procedure in [README.md](README.md), and inspect logs with `journalctl` without copying secrets into the evidence record.

## Current evidence

Checked 2026-10-07 from the Windows workspace: TCP ports 80, 443, 3000, 3001, 4000, 4001, 5433, and 6379 had no local listeners. Readiness requests to the configured local web/API/worker ports were unavailable. No production host, DNS, TLS certificate, provider credentials, production database, or backup storage is configured here. These local availability probes do not establish production acceptance.

**Phase 26 status: partial; production integration verification has not run.** The exit criterion is met only after every applicable matrix row has evidence from the configured production deployment, all current product gaps are resolved or explicitly accepted, and the critical services work together in production.

## Evidence record template

Copy one record per check. Attach only redacted output or a reference to a protected operations log.

```text
Date/time (UTC):
Release commit:
Environment/host role:
Area and scenario:
Expected result:
Observed result:
Evidence reference (redacted):
Operator:
Follow-up / incident reference:
```
