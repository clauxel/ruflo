#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
Deploy Multica to the production server.

This script deploys code only. It intentionally does not upload .env.production
or any local secret file. Production secrets stay on the server in:
  /data/multica/multica.env

Environment overrides:
  DEPLOY_HOST        default: 203.0.113.10
  DEPLOY_USER        default: root
  DEPLOY_KEY         default: ${HOME}/.ssh/multica_prod_key
  APP_ROOT           default: /data/multica
  SERVICE_NAME       default: multica.service
  NODE_BIN           default: ${HOME}/.nvm/versions/node/v20.19.5/bin/node when present
  SKIP_BUILD=1       skip local TypeScript/Vite build and package current dist/
  DRY_RUN=1          build/package locally, then stop before upload

Examples:
  scripts/deploy-production.sh
  SKIP_BUILD=1 scripts/deploy-production.sh
  DRY_RUN=1 scripts/deploy-production.sh
  DEPLOY_HOST=1.2.3.4 DEPLOY_KEY=/path/to/key scripts/deploy-production.sh
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_HOST="${DEPLOY_HOST:-203.0.113.10}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_KEY="${DEPLOY_KEY:-${HOME}/.ssh/multica_prod_key}"
APP_ROOT="${APP_ROOT:-/data/multica}"
SERVICE_NAME="${SERVICE_NAME:-multica.service}"
RELEASE_ID="${RELEASE_ID:-$(date +%Y%m%d-%H%M%S)}"
ARCHIVE_NAME="multica-${RELEASE_ID}.tar.gz"
LOCAL_ARCHIVE="${TMPDIR:-/tmp}/${ARCHIVE_NAME}"
REMOTE_ARCHIVE="/tmp/${ARCHIVE_NAME}"
REMOTE_SCRIPT="/tmp/multica-deploy-${RELEASE_ID}.sh"
SSH_OPTS=(
  -o StrictHostKeyChecking=no
  -o ConnectTimeout=12
  -o ConnectionAttempts=1
  -o BatchMode=yes
  -i "$DEPLOY_KEY"
)

log() {
  printf '[deploy] %s\n' "$*"
}

fail() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

run_local_build() {
  if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
    log "Skipping local build because SKIP_BUILD=1"
    [[ -d "$PROJECT_ROOT/dist" ]] || fail "dist/ does not exist; run a build first or unset SKIP_BUILD"
    return
  fi

  local default_node="${HOME}/.nvm/versions/node/v20.19.5/bin/node"
  if [[ -z "${NODE_BIN:-}" && -x "$default_node" ]]; then
    NODE_BIN="$default_node"
  fi

  log "Building frontend locally"
  if [[ -n "${NODE_BIN:-}" && -x "$NODE_BIN" && -f "$PROJECT_ROOT/node_modules/typescript/bin/tsc" ]]; then
    (cd "$PROJECT_ROOT" && "$NODE_BIN" node_modules/typescript/bin/tsc -b)
    (cd "$PROJECT_ROOT" && "$NODE_BIN" node_modules/vite/bin/vite.js build)
  else
    (cd "$PROJECT_ROOT" && npm run build)
  fi
}

create_archive() {
  local include_paths=(
    package.json
    package-lock.json
    server.mjs
    index.html
    deploy
    scripts
    server-lib
    shared
    src
    public
    dist
    tsconfig.json
    tsconfig.app.json
    tsconfig.node.json
    vite.config.ts
    vercel.json
    README.md
    DEPLOYMENT.md
  )
  local existing_paths=()

  for path in "${include_paths[@]}"; do
    if [[ -e "$PROJECT_ROOT/$path" ]]; then
      existing_paths+=("$path")
    fi
  done

  [[ ${#existing_paths[@]} -gt 0 ]] || fail "No deployable paths found"

  log "Creating deploy archive: $LOCAL_ARCHIVE"
  rm -f "$LOCAL_ARCHIVE"
  (
    cd "$PROJECT_ROOT"
    COPYFILE_DISABLE=1 tar \
      --no-xattrs \
      --exclude='.env.*' \
      --exclude='.git' \
      --exclude='node_modules' \
      --exclude='data' \
      --exclude='exports' \
      --exclude='*.log' \
      --exclude='*.tsbuildinfo' \
      -czf "$LOCAL_ARCHIVE" \
      "${existing_paths[@]}"
  )
}

write_remote_script() {
  cat > "$LOCAL_REMOTE_SCRIPT" <<'REMOTE_SCRIPT_BODY'
#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  printf '[remote-deploy] %s\n' "$*"
}

fail() {
  printf '[remote-deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

: "${APP_ROOT:?APP_ROOT is required}"
: "${RELEASE_ID:?RELEASE_ID is required}"
: "${ARCHIVE_PATH:?ARCHIVE_PATH is required}"
: "${SERVICE_NAME:?SERVICE_NAME is required}"

ENV_FILE="$APP_ROOT/multica.env"
RELEASES_DIR="$APP_ROOT/releases"
BACKUPS_DIR="$APP_ROOT/backups"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_ID"
CURRENT_APP="$APP_ROOT/app"
BACKUP_DIR="$BACKUPS_DIR/app-predeploy-$RELEASE_ID"

[[ -f "$ARCHIVE_PATH" ]] || fail "Archive not found: $ARCHIVE_PATH"
[[ -f "$ENV_FILE" ]] || fail "Production env file not found: $ENV_FILE"

mkdir -p "$RELEASES_DIR" "$BACKUPS_DIR"
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

log "Extracting archive into $RELEASE_DIR"
tar -xzf "$ARCHIVE_PATH" -C "$RELEASE_DIR"
[[ -f "$RELEASE_DIR/server.mjs" ]] || fail "Release is missing server.mjs"
[[ -f "$RELEASE_DIR/dist/index.html" ]] || fail "Release is missing dist/index.html"

if command -v npm >/dev/null 2>&1; then
  log "Installing production dependencies"
  (cd "$RELEASE_DIR" && npm ci --omit=dev --no-audit --no-fund)
else
  fail "npm is not installed on the server"
fi

if id multica >/dev/null 2>&1; then
  chown -R multica:multica "$RELEASE_DIR"
fi

if [[ -e "$CURRENT_APP" && ! -L "$CURRENT_APP" ]]; then
  log "Backing up existing app directory to $BACKUP_DIR"
  rm -rf "$BACKUP_DIR"
  mv "$CURRENT_APP" "$BACKUP_DIR"
fi

log "Switching current app symlink"
ln -sfn "$RELEASE_DIR" "$CURRENT_APP"

log "Restarting $SERVICE_NAME"
systemctl daemon-reload
systemctl restart "$SERVICE_NAME"
systemctl is-active --quiet "$SERVICE_NAME" || {
  systemctl status "$SERVICE_NAME" --no-pager || true
  fail "$SERVICE_NAME did not become active"
}

APP_PORT="$(awk -F= '/^PORT=/{print $2}' "$ENV_FILE" | tail -n1)"
APP_PORT="${APP_PORT:-5175}"

log "Checking local health endpoint on port $APP_PORT"
if command -v curl >/dev/null 2>&1; then
  for attempt in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${APP_PORT}/api/runtime" >/dev/null; then
      break
    fi

    if [[ "$attempt" -eq 30 ]]; then
      systemctl status "$SERVICE_NAME" --no-pager || true
      fail "Health check failed after ${attempt} attempts"
    fi

    sleep 2
  done
else
  log "curl not found; skipping HTTP health check"
fi

rm -f "$ARCHIVE_PATH"
log "Deployment complete: $RELEASE_DIR"
REMOTE_SCRIPT_BODY
}

require_command ssh
require_command scp
require_command tar
[[ -f "$DEPLOY_KEY" ]] || fail "SSH key not found: $DEPLOY_KEY"

LOCAL_REMOTE_SCRIPT="${TMPDIR:-/tmp}/multica-deploy-${RELEASE_ID}.sh"
trap 'rm -f "$LOCAL_ARCHIVE" "$LOCAL_REMOTE_SCRIPT"' EXIT

run_local_build
create_archive
write_remote_script

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  log "Dry run complete; archive and remote script were generated locally and will now be cleaned up"
  exit 0
fi

log "Uploading archive and remote script to ${DEPLOY_USER}@${DEPLOY_HOST}"
scp "${SSH_OPTS[@]}" "$LOCAL_ARCHIVE" "${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_ARCHIVE}"
scp "${SSH_OPTS[@]}" "$LOCAL_REMOTE_SCRIPT" "${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_SCRIPT}"

log "Running remote deployment"
ssh "${SSH_OPTS[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" \
  "APP_ROOT='$APP_ROOT' RELEASE_ID='$RELEASE_ID' ARCHIVE_PATH='$REMOTE_ARCHIVE' SERVICE_NAME='$SERVICE_NAME' bash '$REMOTE_SCRIPT'"

log "Done"
