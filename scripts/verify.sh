#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${ENOUGH_APP_ROOT:-/home/enough/apps/enough}"
ENV_FILE="$APP_ROOT/shared/.env"
VERIFY_SCRIPT="$APP_ROOT/current/scripts/verify-services.mjs"

if [[ ! -r "$ENV_FILE" || ! -r "$VERIFY_SCRIPT" ]]; then
  echo "Enough environment or current release is missing." >&2
  exit 1
fi

exec /usr/bin/node --env-file-if-exists="$ENV_FILE" "$VERIFY_SCRIPT"
