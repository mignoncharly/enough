#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${1:-}" != "--apply" ]]; then
  echo "Review infra/README.md, then rerun with --apply to install Ubuntu packages and host templates." >&2
  exit 2
fi
if [[ "$EUID" -ne 0 ]]; then
  echo "Run this host bootstrap with sudo." >&2
  exit 1
fi
if [[ ! -r /etc/os-release ]]; then
  echo "Cannot identify this operating system." >&2
  exit 1
fi
# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  echo "This bootstrap supports Ubuntu only." >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd -P)"
APP_HOME="/home/enough"
APP_ROOT="$APP_HOME/apps/enough"

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install --yes \
  age ca-certificates certbot curl git nginx postgresql postgresql-client \
  python3-certbot-nginx redis-server rclone sudo

if ! id enough >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$APP_HOME" --shell /usr/sbin/nologin enough
elif [[ "$(getent passwd enough | cut -d: -f6)" != "$APP_HOME" ]]; then
  echo "The existing enough account has a different home directory; stopping without changing it." >&2
  exit 1
fi

install -d -o enough -g enough -m 0750 \
  "$APP_ROOT" "$APP_ROOT/releases" "$APP_ROOT/scripts" \
  "$APP_ROOT/shared" "$APP_ROOT/shared/backups" "$APP_ROOT/shared/logs"
install -d -o root -g root -m 0755 /var/www/letsencrypt/.well-known/acme-challenge

for unit in enough-api.service enough-web.service enough-worker.service \
  enough-monitor.service enough-monitor.timer enough-backup.service enough-backup.timer; do
  install -o root -g root -m 0644 "$REPO_ROOT/infra/systemd/$unit" "/etc/systemd/system/$unit"
done
install -D -o root -g root -m 0644 "$REPO_ROOT/infra/redis/enough-production.conf" \
  /etc/redis/enough-production.conf
install -D -o root -g root -m 0644 "$REPO_ROOT/infra/systemd/journald-enough.conf" \
  /etc/systemd/journald.conf.d/enough.conf
install -D -o root -g root -m 0755 "$REPO_ROOT/infra/certbot/enough-reload-nginx" \
  /etc/letsencrypt/renewal-hooks/deploy/enough-reload-nginx
for tool in deploy.sh rollback.sh; do
  install -o enough -g enough -m 0750 "$REPO_ROOT/scripts/$tool" "$APP_ROOT/scripts/$tool"
done
install -D -o root -g root -m 0440 "$REPO_ROOT/infra/sudoers/enough-deploy" \
  /etc/sudoers.d/enough-deploy
visudo --check --file=/etc/sudoers.d/enough-deploy
systemctl daemon-reload
systemctl restart systemd-journald

echo "Ubuntu packages and host templates installed. Configure Node.js 22+, pnpm 11.20.0, PostgreSQL, Redis ACL, TLS, the shared environment file, and firewall before enabling application services."
