#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
Stop the standalone Multica development SSH tunnel.

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

TUNNEL_PID="$(multica_dev_tunnel_find_pid || true)"
if [[ -z "$TUNNEL_PID" && -f "$DEV_TUNNEL_PID_FILE" ]]; then
  TUNNEL_PID="$(cat "$DEV_TUNNEL_PID_FILE" 2>/dev/null || true)"
fi

if [[ "$TUNNEL_PID" =~ ^[0-9]+$ ]] && kill -0 "$TUNNEL_PID" >/dev/null 2>&1; then
  multica_dev_tunnel_log "Stopping tunnel process $TUNNEL_PID"
  kill "$TUNNEL_PID" >/dev/null 2>&1 || true
  sleep 1
fi

rm -f "$DEV_TUNNEL_PID_FILE"
multica_dev_tunnel_log "Tunnel stopped"
