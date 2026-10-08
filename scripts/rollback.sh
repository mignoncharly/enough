#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_ROOT="/home/enough/apps/enough"
RELEASES="$APP_ROOT/releases"
CURRENT="$APP_ROOT/current"

if [[ "$(id -un)" != "enough" ]]; then
  echo "Run rollback as the unprivileged enough account." >&2
  exit 1
fi
exec 9>"$APP_ROOT/deploy.lock"
if ! flock -n 9; then
  echo "Another deployment or rollback is already running." >&2
  exit 1
fi
if [[ "$#" -ne 1 ]]; then
  echo "Usage: rollback.sh <release-directory>" >&2
  exit 2
fi
if [[ ! -L "$CURRENT" ]]; then
  echo "No current release symlink exists." >&2
  exit 1
fi

CURRENT_TARGET="$(readlink -f "$CURRENT")"
ROLLBACK_TARGET="$(readlink -f -- "$1")"
case "$CURRENT_TARGET" in "$RELEASES"/*) ;; *) echo "Current target is outside managed releases." >&2; exit 1 ;; esac
case "$ROLLBACK_TARGET" in "$RELEASES"/*) ;; *) echo "Rollback target is outside managed releases." >&2; exit 1 ;; esac
if [[ "$CURRENT_TARGET" == "$ROLLBACK_TARGET" || ! -f "$ROLLBACK_TARGET/package.json" || ! -f "$ROLLBACK_TARGET/scripts/verify.sh" ]]; then
  echo "Rollback target must be a different, complete managed release." >&2
  exit 1
fi

swap_current() {
  local target="$1"
  local link="$APP_ROOT/current.swap.$$"
  ln -s "$target" "$link"
  mv -Tf -- "$link" "$CURRENT"
}

swap_current "$ROLLBACK_TARGET"
if ! sudo /usr/bin/systemctl restart enough-api.service enough-web.service enough-worker.service || ! /usr/bin/bash "$ROLLBACK_TARGET/scripts/verify.sh"; then
  echo "Rollback target did not become ready; restoring the release active before rollback." >&2
  swap_current "$CURRENT_TARGET"
  sudo /usr/bin/systemctl restart enough-api.service enough-web.service enough-worker.service || true
  /usr/bin/bash "$CURRENT_TARGET/scripts/verify.sh" || true
  exit 1
fi

echo "Application code rolled back to $ROLLBACK_TARGET. Database migrations were not reversed."
