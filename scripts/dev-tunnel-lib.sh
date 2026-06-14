#!/usr/bin/env bash

multica_dev_tunnel_log() {
  printf '[dev-tunnel] %s\n' "$*"
}

multica_dev_tunnel_fail() {
  printf '[dev-tunnel] ERROR: %s\n' "$*" >&2
  return 1
}

multica_dev_tunnel_read_env_value() {
  local key="$1"
  local file="$2"
  [[ -f "$file" ]] || return 1

  local line
  line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  [[ -n "$line" ]] || return 1

  line="${line#*=}"
  line="${line%$'\r'}"
  printf '%s' "$line"
}

multica_dev_tunnel_ensure_command() {
  command -v "$1" >/dev/null 2>&1 || multica_dev_tunnel_fail "Missing required command: $1"
}

multica_dev_tunnel_load_config() {
  if [[ "${MULTICA_DEV_TUNNEL_CONFIG_LOADED:-0}" == "1" ]]; then
    return 0
  fi

  PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  DEV_ENV_FILE="${DEV_ENV_FILE:-$PROJECT_ROOT/.env.development}"
  DEFAULT_NODE_BIN="${HOME}/.nvm/versions/node/v20.19.5/bin"

  [[ -f "$DEV_ENV_FILE" ]] || multica_dev_tunnel_fail "Development env file not found: $DEV_ENV_FILE" || return 1

  DEV_DEPLOY_HOST="${MULTICA_DEV_ROUTER_REMOTE_HOST:-$(multica_dev_tunnel_read_env_value MULTICA_DEPLOY_HOST "$DEV_ENV_FILE" || true)}"
  DEV_DEPLOY_PORT="$(multica_dev_tunnel_read_env_value MULTICA_DEPLOY_PORT "$DEV_ENV_FILE" || true)"
  DEV_DEPLOY_USERNAME="$(multica_dev_tunnel_read_env_value MULTICA_DEPLOY_USERNAME "$DEV_ENV_FILE" || true)"
  DEV_DEPLOY_KEY="${MULTICA_AGENT_DEPLOY_PRIVATE_KEY_PATH:-${MULTICA_DEPLOY_PRIVATE_KEY_PATH:-}}"
  if [[ -z "$DEV_DEPLOY_KEY" ]]; then
    DEV_DEPLOY_KEY="$(multica_dev_tunnel_read_env_value MULTICA_AGENT_DEPLOY_PRIVATE_KEY_PATH "$DEV_ENV_FILE" || true)"
  fi
  if [[ -z "$DEV_DEPLOY_KEY" ]]; then
    DEV_DEPLOY_KEY="$(multica_dev_tunnel_read_env_value MULTICA_DEPLOY_PRIVATE_KEY_PATH "$DEV_ENV_FILE" || true)"
  fi

  DEV_ROUTER_BASE_URL="$(multica_dev_tunnel_read_env_value MULTICA_ROUTER_BASE_URL "$DEV_ENV_FILE" || true)"
  DEV_ROUTER_SHARED_TOKEN="${MULTICA_ROUTER_SHARED_TOKEN:-$(multica_dev_tunnel_read_env_value MULTICA_ROUTER_SHARED_TOKEN "$DEV_ENV_FILE" || true)}"
  DEV_QS_KEY="${QS_KEY:-$(multica_dev_tunnel_read_env_value QS_KEY "$DEV_ENV_FILE" || true)}"
  LOCAL_APP_PORT="$(multica_dev_tunnel_read_env_value PORT "$DEV_ENV_FILE" || true)"

  [[ -n "$DEV_DEPLOY_HOST" ]] || multica_dev_tunnel_fail "MULTICA_DEPLOY_HOST is missing in $DEV_ENV_FILE" || return 1
  [[ -n "$DEV_DEPLOY_USERNAME" ]] || multica_dev_tunnel_fail "MULTICA_DEPLOY_USERNAME is missing in $DEV_ENV_FILE" || return 1
  [[ -n "$DEV_DEPLOY_KEY" ]] || multica_dev_tunnel_fail "MULTICA_AGENT_DEPLOY_PRIVATE_KEY_PATH is missing in $DEV_ENV_FILE" || return 1
  [[ -f "$DEV_DEPLOY_KEY" ]] || multica_dev_tunnel_fail "Deploy key not found: $DEV_DEPLOY_KEY" || return 1
  [[ -n "$DEV_ROUTER_BASE_URL" ]] || multica_dev_tunnel_fail "MULTICA_ROUTER_BASE_URL is missing in $DEV_ENV_FILE" || return 1
  [[ -n "$DEV_ROUTER_SHARED_TOKEN" ]] || multica_dev_tunnel_fail "MULTICA_ROUTER_SHARED_TOKEN is missing in $DEV_ENV_FILE" || return 1

  DEV_ROUTER_BASE_URL="${DEV_ROUTER_BASE_URL#http://}"
  DEV_ROUTER_BASE_URL="${DEV_ROUTER_BASE_URL#https://}"
  DEV_ROUTER_BASE_URL="${DEV_ROUTER_BASE_URL%%/*}"
  LOCAL_ROUTER_HOST="${DEV_ROUTER_BASE_URL%%:*}"
  LOCAL_ROUTER_PORT="${DEV_ROUTER_BASE_URL##*:}"
  REMOTE_ROUTER_PORT="${MULTICA_DEV_ROUTER_REMOTE_PORT:-$LOCAL_ROUTER_PORT}"
  LOCAL_APP_PORT="${LOCAL_APP_PORT:-5175}"
  REMOTE_MODEL_PROXY_PORT="${MULTICA_DEV_MODEL_PROXY_REMOTE_PORT:-15175}"

  [[ -n "$LOCAL_ROUTER_HOST" && -n "$LOCAL_ROUTER_PORT" ]] || multica_dev_tunnel_fail "Unable to parse MULTICA_ROUTER_BASE_URL from $DEV_ENV_FILE" || return 1

  DEV_TUNNEL_STATE_DIR="${MULTICA_DEV_TUNNEL_STATE_DIR:-$HOME/Library/Application Support/OpenClawLaunch/dev-tunnels/multica}"
  DEV_TUNNEL_PID_FILE="$DEV_TUNNEL_STATE_DIR/ssh.pid"
  DEV_TUNNEL_STDOUT_LOG="$DEV_TUNNEL_STATE_DIR/ssh.log"
  DEV_TUNNEL_STDERR_LOG="$DEV_TUNNEL_STATE_DIR/ssh.err.log"
  DEV_TUNNEL_TARGET="${DEV_DEPLOY_USERNAME}@${DEV_DEPLOY_HOST}"

  mkdir -p "$DEV_TUNNEL_STATE_DIR"

  if [[ -d "$DEFAULT_NODE_BIN" ]]; then
    export PATH="$DEFAULT_NODE_BIN:$PATH"
  fi

  MULTICA_DEV_TUNNEL_CONFIG_LOADED=1
}

multica_dev_tunnel_build_ssh_base_args() {
  multica_dev_tunnel_load_config || return 1

  MULTICA_DEV_TUNNEL_SSH_BASE_ARGS=(
    -N
    -o BatchMode=yes
    -o ExitOnForwardFailure=yes
    -o IdentitiesOnly=yes
    -o ServerAliveInterval=30
    -o ServerAliveCountMax=3
    -o StrictHostKeyChecking=no
    -i "$DEV_DEPLOY_KEY"
  )

  if [[ -n "$DEV_DEPLOY_PORT" ]]; then
    MULTICA_DEV_TUNNEL_SSH_BASE_ARGS+=(-p "$DEV_DEPLOY_PORT")
  fi
}

multica_dev_tunnel_check_local_router() {
  multica_dev_tunnel_load_config || return 1
  curl -fsS \
    -H "x-multica-router-token: $DEV_ROUTER_SHARED_TOKEN" \
    "http://${LOCAL_ROUTER_HOST}:${LOCAL_ROUTER_PORT}/healthz" >/dev/null 2>&1
}

multica_dev_tunnel_pid_alive() {
  multica_dev_tunnel_load_config || return 1
  local pid=""

  if [[ -f "$DEV_TUNNEL_PID_FILE" ]]; then
    pid="$(cat "$DEV_TUNNEL_PID_FILE" 2>/dev/null || true)"
  fi
  if [[ ! "$pid" =~ ^[0-9]+$ ]]; then
    pid="$(multica_dev_tunnel_find_pid || true)"
  fi

  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" >/dev/null 2>&1
}

multica_dev_tunnel_find_pid() {
  multica_dev_tunnel_load_config || return 1

  [[ "$LOCAL_ROUTER_HOST" == "127.0.0.1" ]] || return 1

  local pid
  pid="$(lsof -tiTCP:"$LOCAL_ROUTER_PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1

  local command
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command" == *ssh* ]] || return 1
  [[ "$command" == *"$DEV_DEPLOY_HOST"* ]] || return 1

  printf '%s\n' "$pid"
}

multica_dev_tunnel_cleanup_stale_state() {
  multica_dev_tunnel_load_config || return 1
  if multica_dev_tunnel_pid_alive; then
    return 0
  fi

  rm -f "$DEV_TUNNEL_PID_FILE"
}

multica_dev_tunnel_wait_until_ready() {
  multica_dev_tunnel_load_config || return 1

  local attempt
  for attempt in $(seq 1 20); do
    if [[ "$LOCAL_ROUTER_HOST" == "127.0.0.1" ]]; then
      if multica_dev_tunnel_check_local_router; then
        return 0
      fi
    elif multica_dev_tunnel_pid_alive; then
      return 0
    fi
    sleep 1
  done

  if [[ "$LOCAL_ROUTER_HOST" == "127.0.0.1" ]]; then
    multica_dev_tunnel_fail "Dev router tunnel did not become healthy on http://${LOCAL_ROUTER_HOST}:${LOCAL_ROUTER_PORT}" || return 1
  fi

  multica_dev_tunnel_fail "Reverse model proxy tunnel did not become healthy for ${DEV_TUNNEL_TARGET}" || return 1
}

multica_dev_tunnel_forward_args() {
  multica_dev_tunnel_load_config || return 1
  MULTICA_DEV_TUNNEL_FORWARD_ARGS=()

  if [[ "$LOCAL_ROUTER_HOST" == "127.0.0.1" ]]; then
    MULTICA_DEV_TUNNEL_FORWARD_ARGS+=(
      -L "127.0.0.1:${LOCAL_ROUTER_PORT}:127.0.0.1:${REMOTE_ROUTER_PORT}"
    )
  fi

  MULTICA_DEV_TUNNEL_FORWARD_ARGS+=(
    -R "127.0.0.1:${REMOTE_MODEL_PROXY_PORT}:127.0.0.1:${LOCAL_APP_PORT}"
  )
}
