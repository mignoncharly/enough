#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${ENOUGH_APP_ROOT:-/home/enough/apps/enough}"
RESTORE_ENV="$APP_ROOT/shared/restore.env"
if [[ ! -r "$RESTORE_ENV" || ! -r "$APP_ROOT/current/scripts/restore-test.mjs" ]]; then
  echo "Protected restore environment or current release is missing." >&2
  exit 1
fi
RESTORE_MODE="$(stat -c '%a' "$RESTORE_ENV")"
if (( (8#$RESTORE_MODE & 0777) != 8#600 )); then
  echo "Set restore.env permissions to 0600 before continuing." >&2
  exit 1
fi
export ENOUGH_APP_ROOT="$APP_ROOT"
exec /usr/bin/node --env-file="$RESTORE_ENV" \
  "$APP_ROOT/current/scripts/restore-test.mjs" "$@"
