#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_ROOT="/home/enough/apps/enough"
RELEASES="$APP_ROOT/releases"
CURRENT="$APP_ROOT/current"
SHARED_ENV="$APP_ROOT/shared/.env"

if [[ "$(id -un)" != "enough" ]]; then
  echo "Run deployment as the unprivileged enough account." >&2
  exit 1
fi
mkdir -p "$APP_ROOT"
exec 9>"$APP_ROOT/deploy.lock"
if ! flock -n 9; then
  echo "Another deployment or rollback is already running." >&2
  exit 1
fi
if [[ "$#" -ne 3 || "$3" != "--approve-migrations" ]]; then
  echo "Usage: deploy.sh <ssh-repository> <refs/heads/name|refs/tags/name> --approve-migrations" >&2
  exit 2
fi
DEPLOY_REPOSITORY="$1"
DEPLOY_REF="$2"
case "$DEPLOY_REPOSITORY" in
  git@*:*|ssh://git@*) ;;
  *) echo "Use an SSH Git remote without embedded credentials." >&2; exit 2 ;;
esac
case "$DEPLOY_REF" in
  refs/heads/*|refs/tags/*) ;;
  *) echo "Pass a fully qualified approved branch or tag ref." >&2; exit 2 ;;
esac
git check-ref-format "$DEPLOY_REF"
if [[ ! -r "$SHARED_ENV" ]]; then
  echo "Missing protected environment file: $SHARED_ENV" >&2
  exit 1
fi
PREVIOUS_RELEASE="$(readlink -f "$CURRENT" 2>/dev/null || true)"
if [[ -n "$PREVIOUS_RELEASE" ]]; then
  case "$PREVIOUS_RELEASE" in
    "$RELEASES"/*) ;;
    *) echo "Current symlink points outside the managed releases directory." >&2; exit 1 ;;
  esac
  if [[ -r "$PREVIOUS_RELEASE/scripts/verify-services.mjs" ]]; then
    /usr/bin/bash "$PREVIOUS_RELEASE/scripts/verify.sh"
  else
    echo "Skipping the pre-deployment readiness probe; the existing release predates this verifier."
  fi
fi

mkdir -p "$RELEASES"
STAGING_DIR="$(mktemp -d "$RELEASES/.staging.XXXXXX")"
cleanup() {
  if [[ -n "${STAGING_DIR:-}" && -d "$STAGING_DIR" ]]; then
    case "$STAGING_DIR" in
      "$RELEASES"/.staging.*) rm -rf -- "$STAGING_DIR" ;;
      *) echo "Refusing to remove unexpected staging path: $STAGING_DIR" >&2 ;;
    esac
  fi
}
trap cleanup EXIT

git -C "$STAGING_DIR" init --quiet
git -C "$STAGING_DIR" remote add origin "$DEPLOY_REPOSITORY"
export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND='ssh -o BatchMode=yes -o StrictHostKeyChecking=yes'
git -C "$STAGING_DIR" fetch --quiet --depth 1 origin "$DEPLOY_REF"
git -C "$STAGING_DIR" checkout --quiet --detach FETCH_HEAD
COMMIT="$(git -C "$STAGING_DIR" rev-parse --short=12 HEAD)"
RELEASE_DIR="$RELEASES/$(date -u +%Y%m%dT%H%M%SZ)-$COMMIT"
if [[ -e "$RELEASE_DIR" ]]; then
  echo "Release directory already exists: $RELEASE_DIR" >&2
  exit 1
fi

run_with_env() {
  (
    cd -- "$STAGING_DIR"
    /usr/bin/node --env-file="$SHARED_ENV" "$STAGING_DIR/scripts/run-command.mjs" "$@"
  )
}

echo "Installing the approved revision $COMMIT."
run_with_env --clean /usr/bin/pnpm install --frozen-lockfile
run_with_env --test /usr/bin/pnpm test
run_with_env /usr/bin/pnpm --filter @enough/web build
run_with_env /usr/bin/pnpm --filter @enough/db db:precheck

echo "Creating and uploading the encrypted pre-deployment database backup."
run_with_env /usr/bin/node "$STAGING_DIR/scripts/backup-database.mjs"

echo "Applying reviewed, checksum-verified database migrations."
run_with_env /usr/bin/pnpm --filter @enough/db db:migrate

mv -- "$STAGING_DIR" "$RELEASE_DIR"
STAGING_DIR=""

CURRENT_NEXT="$APP_ROOT/current.next.$$"
ln -s "$RELEASE_DIR" "$CURRENT_NEXT"
mv -Tf -- "$CURRENT_NEXT" "$CURRENT"

restore_previous_release() {
  if [[ -n "$PREVIOUS_RELEASE" ]]; then
    local rollback_link="$APP_ROOT/current.rollback.$$"
    ln -s "$PREVIOUS_RELEASE" "$rollback_link"
    mv -Tf -- "$rollback_link" "$CURRENT"
  elif [[ -L "$CURRENT" && "$(readlink -f "$CURRENT")" == "$RELEASE_DIR" ]]; then
    rm -f -- "$CURRENT"
  fi
  sudo /usr/bin/systemctl restart enough-api.service enough-web.service enough-worker.service || true
}

if ! sudo /usr/bin/systemctl restart enough-api.service enough-web.service enough-worker.service; then
  echo "Service restart failed; restoring the previous application release." >&2
  restore_previous_release
  exit 1
fi
if ! /usr/bin/bash "$RELEASE_DIR/scripts/verify.sh"; then
  echo "Readiness failed; restoring the previous application release." >&2
  restore_previous_release
  if [[ -n "$PREVIOUS_RELEASE" ]]; then /usr/bin/bash "$PREVIOUS_RELEASE/scripts/verify.sh" || true; fi
  exit 1
fi

echo "Deployed $COMMIT successfully. Previous release: ${PREVIOUS_RELEASE:-none}."
