#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/data/multica}"
SERVICE_NAME="${SERVICE_NAME:-multica.service}"
APP_DOMAIN="${APP_DOMAIN:-genericagent.example.com}"
APP_WWW_DOMAIN="${APP_WWW_DOMAIN:-www.${APP_DOMAIN#www.}}"
APP_CANONICAL_ORIGIN="${APP_CANONICAL_ORIGIN:-https://${APP_WWW_DOMAIN}}"
APP_BARE_ORIGIN="${APP_BARE_ORIGIN:-https://${APP_DOMAIN#www.}}"
APP_ORIGIN_VALUE="${APP_ORIGIN_VALUE:-${APP_CANONICAL_ORIGIN},${APP_BARE_ORIGIN}}"
CERT_LIVE_DIR="${CERT_LIVE_DIR:-/etc/letsencrypt/live/${APP_WWW_DOMAIN}}"
NGINX_CONFIG="${NGINX_CONFIG:-/etc/nginx/sites-available/${APP_DOMAIN#www.}}"
LETSENCRYPT_ROOT="${LETSENCRYPT_ROOT:-/var/www/letsencrypt}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-yangdengkui01@gmail.com}"
CREEM_FRAGMENT="${1:-}"

log() {
  printf '[prod-config] %s\n' "$*"
}

fail() {
  printf '[prod-config] ERROR: %s\n' "$*" >&2
  exit 1
}

set_env_var() {
  local key="$1"
  local value="$2"
  local tmp_file
  tmp_file="$(mktemp)"

  awk -v key="$key" -v value="$value" '
    BEGIN { replaced = 0 }
    $0 ~ "^" key "=" {
      print key "=" value
      replaced = 1
      next
    }
    { print }
    END {
      if (!replaced) {
        print key "=" value
      }
    }
  ' "$ENV_FILE" > "$tmp_file"
  install -m 600 -o root -g root "$tmp_file" "$ENV_FILE"
  rm -f "$tmp_file"
}

write_http_nginx_config() {
  cat > "$NGINX_CONFIG" <<NGINX_HTTP
map \$http_x_forwarded_proto \$genericagent_forwarded_proto {
  default \$http_x_forwarded_proto;
  "" \$scheme;
}

server {
    listen 80;
    listen [::]:80;
  server_name ${APP_DOMAIN#www.};

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        default_type "text/plain";
    }

    location / {
    return 301 ${APP_CANONICAL_ORIGIN}\$request_uri;
    }
}

server {
    listen 80;
    listen [::]:80;
  server_name ${APP_WWW_DOMAIN};

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        default_type "text/plain";
    }

    location / {
    if (\$http_x_forwarded_proto != "https") {
      return 301 ${APP_CANONICAL_ORIGIN}\$request_uri;
        }

        proxy_pass http://127.0.0.1:5175;
        proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Proto \$genericagent_forwarded_proto;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX_HTTP
}

write_https_nginx_config() {
  cat > "$NGINX_CONFIG" <<NGINX_HTTPS
map \$http_x_forwarded_proto \$genericagent_forwarded_proto {
  default \$http_x_forwarded_proto;
  "" \$scheme;
}

server {
    listen 80;
    listen [::]:80;
  server_name ${APP_DOMAIN#www.};

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        default_type "text/plain";
    }

    location / {
    return 301 ${APP_CANONICAL_ORIGIN}\$request_uri;
    }
}

server {
    listen 80;
    listen [::]:80;
  server_name ${APP_WWW_DOMAIN};

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        default_type "text/plain";
    }

    location / {
    if (\$http_x_forwarded_proto != "https") {
      return 301 ${APP_CANONICAL_ORIGIN}\$request_uri;
        }

        proxy_pass http://127.0.0.1:5175;
        proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Proto \$genericagent_forwarded_proto;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
  server_name ${APP_DOMAIN#www.};

  ssl_certificate ${CERT_LIVE_DIR}/fullchain.pem;
  ssl_certificate_key ${CERT_LIVE_DIR}/privkey.pem;

  return 301 ${APP_CANONICAL_ORIGIN}\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
  server_name ${APP_WWW_DOMAIN};

  ssl_certificate ${CERT_LIVE_DIR}/fullchain.pem;
  ssl_certificate_key ${CERT_LIVE_DIR}/privkey.pem;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:5175;
        proxy_http_version 1.1;
    proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX_HTTPS
}

ENV_FILE="$APP_ROOT/multica.env"
BACKUP_ROOT="$APP_ROOT/backups/prod-config-$(date +%Y%m%d-%H%M%S)"

[[ "$(id -u)" -eq 0 ]] || fail "Run as root"
[[ -f "$ENV_FILE" ]] || fail "Missing env file: $ENV_FILE"
[[ -n "$CREEM_FRAGMENT" && -f "$CREEM_FRAGMENT" ]] || fail "Missing Creem env fragment argument"

set -a
# shellcheck disable=SC1090
. "$CREEM_FRAGMENT"
set +a

[[ -n "${API_PROD_KEY:-}" ]] || fail "API_PROD_KEY is required in the Creem fragment"

mkdir -p "$BACKUP_ROOT" "$LETSENCRYPT_ROOT/.well-known/acme-challenge"
cp "$ENV_FILE" "$BACKUP_ROOT/multica.env"
if [[ -f "$NGINX_CONFIG" ]]; then
  cp "$NGINX_CONFIG" "$BACKUP_ROOT/nginx-${APP_DOMAIN#www.}"
fi

log "Updating production env without printing secrets"
set_env_var APP_ORIGIN "$APP_ORIGIN_VALUE"
set_env_var PAYMENT_PROVIDER "creem"
set_env_var CREEM_ENV "live"
set_env_var API_PROD_KEY "$API_PROD_KEY"
set_env_var API_TEST_KEY ""
set_env_var PAYPAL_ENV ""

log "Writing temporary HTTP config for certificate validation"
write_http_nginx_config
nginx -t
systemctl reload nginx

if [[ ! -f "$CERT_LIVE_DIR/fullchain.pem" ]]; then
  if ! command -v certbot >/dev/null 2>&1; then
    log "Installing certbot"
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y certbot
  fi

  log "Requesting Let's Encrypt certificate"
  certbot certonly \
    --webroot \
    -w "$LETSENCRYPT_ROOT" \
    -d "$APP_WWW_DOMAIN" \
    -d "${APP_DOMAIN#www.}" \
    --email "$CERTBOT_EMAIL" \
    --agree-tos \
    --non-interactive \
    --no-eff-email
else
  log "Existing certificate found; skipping issuance"
fi

log "Writing final HTTPS Nginx config"
write_https_nginx_config
nginx -t
systemctl reload nginx

log "Restarting app service"
systemctl restart "$SERVICE_NAME"
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:5175/api/runtime >/dev/null; then
    break
  fi

  if [[ "$attempt" -eq 30 ]]; then
    systemctl status "$SERVICE_NAME" --no-pager || true
    fail "App health check failed"
  fi

  sleep 2
done

rm -f "$CREEM_FRAGMENT"
log "Production config complete. Backup: $BACKUP_ROOT"
