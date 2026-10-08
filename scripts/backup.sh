#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${ENOUGH_APP_ROOT:-/home/enough/apps/enough}"
ENV_FILE="$APP_ROOT/shared/.env"
BACKUP_SCRIPT="$APP_ROOT/current/scripts/backup-database.mjs"
if [[ ! -r "$ENV_FILE" || ! -r "$BACKUP_SCRIPT" ]]; then
  echo "Enough environment or current release is missing." >&2
  exit 1
fi
exec /usr/bin/node --env-file-if-exists="$ENV_FILE" "$BACKUP_SCRIPT"
