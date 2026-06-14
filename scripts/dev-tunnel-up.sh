#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
Start the standalone Multica development SSH tunnel.

By default this command starts the tunnel in the background and returns.
Use --foreground when the tunnel should stay attached to the current process,
for example when running under launchd.

Options:
  --foreground    keep the SSH tunnel in the foreground
  -h, --help      show this help message
USAGE
}

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$PROJECT_ROOT/scripts/dev-tunnel-lib.sh"

MODE="background"
if [[ "${1:-}" == "--foreground" ]]; then
  MODE="foreground"
  shift
fi

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

multica_dev_tunnel_load_config
multica_dev_tunnel_ensure_command ssh
multica_dev_tunnel_ensure_command curl
multica_dev_tunnel_cleanup_stale_state
multica_dev_tunnel_build_ssh_base_args
multica_dev_tunnel_forward_args

if multica_dev_tunnel_pid_alive; then
  multica_dev_tunnel_log "Reusing managed tunnel for ${DEV_TUNNEL_TARGET}"
  exit 0
fi

if [[ "$LOCAL_ROUTER_HOST" == "127.0.0.1" ]] && multica_dev_tunnel_check_local_router; then
  multica_dev_tunnel_log "Local router entry is already healthy at http://${LOCAL_ROUTER_HOST}:${LOCAL_ROUTER_PORT}; another tunnel may be managing it"
  exit 0
fi

if [[ "$MODE" == "foreground" ]]; then
  multica_dev_tunnel_log "Starting foreground tunnel for ${DEV_TUNNEL_TARGET}"
  printf '%s\n' "$$" > "$DEV_TUNNEL_PID_FILE"
  exec ssh \
    "${MULTICA_DEV_TUNNEL_SSH_BASE_ARGS[@]}" \
    "${MULTICA_DEV_TUNNEL_FORWARD_ARGS[@]}" \
    "$DEV_TUNNEL_TARGET"
fi

multica_dev_tunnel_log "Starting background tunnel for ${DEV_TUNNEL_TARGET}"
ssh -f \
  "${MULTICA_DEV_TUNNEL_SSH_BASE_ARGS[@]}" \
  "${MULTICA_DEV_TUNNEL_FORWARD_ARGS[@]}" \
  "$DEV_TUNNEL_TARGET" \
  >"$DEV_TUNNEL_STDOUT_LOG" \
  2>"$DEV_TUNNEL_STDERR_LOG" < /dev/null
TUNNEL_PID="$(multica_dev_tunnel_find_pid || true)"
if [[ -n "$TUNNEL_PID" ]]; then
  printf '%s\n' "$TUNNEL_PID" > "$DEV_TUNNEL_PID_FILE"
fi

if ! multica_dev_tunnel_wait_until_ready; then
  TUNNEL_PID="${TUNNEL_PID:-$(multica_dev_tunnel_find_pid || true)}"
  if [[ -n "${TUNNEL_PID:-}" ]]; then
    kill "$TUNNEL_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$DEV_TUNNEL_PID_FILE"
  exit 1
fi

multica_dev_tunnel_log "Tunnel is ready"
