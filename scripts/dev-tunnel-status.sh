#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
Show the status of the standalone Multica development SSH tunnel.

Options:
  -h, --help      show this help message
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$PROJECT_ROOT/scripts/dev-tunnel-lib.sh"

multica_dev_tunnel_load_config
multica_dev_tunnel_ensure_command ssh
multica_dev_tunnel_build_ssh_base_args
multica_dev_tunnel_cleanup_stale_state

MANAGED="no"
if multica_dev_tunnel_pid_alive; then
  MANAGED="yes"
fi

ROUTER_HEALTH="down"
if [[ "$LOCAL_ROUTER_HOST" == "127.0.0.1" ]] && multica_dev_tunnel_check_local_router; then
  ROUTER_HEALTH="ok"
fi

PID_VALUE=""
if [[ -f "$DEV_TUNNEL_PID_FILE" ]]; then
  PID_VALUE="$(cat "$DEV_TUNNEL_PID_FILE" 2>/dev/null || true)"
fi
if [[ -z "$PID_VALUE" ]]; then
  PID_VALUE="$(multica_dev_tunnel_find_pid || true)"
fi

printf 'project=multica\n'
printf 'managed=%s\n' "$MANAGED"
printf 'target=%s\n' "$DEV_TUNNEL_TARGET"
printf 'router_entry=http://%s:%s\n' "$LOCAL_ROUTER_HOST" "$LOCAL_ROUTER_PORT"
printf 'router_health=%s\n' "$ROUTER_HEALTH"
printf 'local_app_port=%s\n' "$LOCAL_APP_PORT"
printf 'remote_model_proxy_port=%s\n' "$REMOTE_MODEL_PROXY_PORT"
printf 'pid=%s\n' "${PID_VALUE:-}"
printf 'pid_file=%s\n' "$DEV_TUNNEL_PID_FILE"
printf 'stdout_log=%s\n' "$DEV_TUNNEL_STDOUT_LOG"
printf 'stderr_log=%s\n' "$DEV_TUNNEL_STDERR_LOG"

if [[ "$MANAGED" == "yes" ]] || [[ "$ROUTER_HEALTH" == "ok" ]]; then
  exit 0
fi

exit 1
