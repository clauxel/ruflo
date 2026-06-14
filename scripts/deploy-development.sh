#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
Start the local Multica development environment.

This script is the recommended way to start development. It will:
  1. Create the dev tunnel for the router and model proxy
  2. Read development values from .env.development
  3. Ensure QS_KEY is available before starting the dev server
  4. Stop the dev tunnel automatically when the script exits

Optional overrides:
  DEV_ENV_FILE                 default: .env.development
  MULTICA_DEV_TUNNEL_DISABLE=1
                              skip automatic tunnel setup
  MULTICA_MODEL_PROXY_INTERNAL_BASE_URL
                              override the internal model proxy base URL

Examples:
  scripts/deploy-development.sh
  QS_KEY=... scripts/deploy-development.sh
  MULTICA_DEV_TUNNEL_DISABLE=1 scripts/deploy-development.sh
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$PROJECT_ROOT/scripts/dev-tunnel-lib.sh"

log() {
  printf '[dev-deploy] %s\n' "$*"
}

fail() {
  printf '[dev-deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

MANAGED_TUNNEL=0
CLEANUP_DONE=0
cleanup() {
  if [[ "$CLEANUP_DONE" == "1" ]]; then
    return 0
  fi
  CLEANUP_DONE=1

  if [[ "$MANAGED_TUNNEL" != "1" ]]; then
    return 0
  fi

  log "Stopping managed dev tunnel"
  "$PROJECT_ROOT/scripts/dev-tunnel-down.sh" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

multica_dev_tunnel_load_config || exit 1
multica_dev_tunnel_ensure_command curl || exit 1
multica_dev_tunnel_ensure_command npm || exit 1

[[ -n "$DEV_QS_KEY" ]] || fail "QS_KEY is required. Set it in $DEV_ENV_FILE or export it in the shell"
export QS_KEY="$DEV_QS_KEY"
export MULTICA_MODEL_PROXY_INTERNAL_BASE_URL="${MULTICA_MODEL_PROXY_INTERNAL_BASE_URL:-http://127.0.0.1:${REMOTE_MODEL_PROXY_PORT}/api/internal/model-proxy}"

if [[ "${MULTICA_DEV_TUNNEL_DISABLE:-0}" != "1" ]]; then
  log "Starting managed dev tunnel"
  "$PROJECT_ROOT/scripts/dev-tunnel-up.sh"
  MANAGED_TUNNEL=1

  if [[ "$LOCAL_ROUTER_HOST" == "127.0.0.1" ]]; then
    multica_dev_tunnel_check_local_router || fail "Managed dev tunnel is not healthy on http://${LOCAL_ROUTER_HOST}:${LOCAL_ROUTER_PORT}"
  fi
fi

log "Starting local development server via npm run dev"
(cd "$PROJECT_ROOT" && npm run dev)
