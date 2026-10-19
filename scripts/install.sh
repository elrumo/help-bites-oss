#!/bin/sh
# Writes a ready-to-run .env with freshly generated secrets, then
# `docker compose up -d` is all that is left.
#
#   scripts/install.sh                  trial on this machine: http://localhost:3100
#   scripts/install.sh help.example.com production: HTTPS on that domain through the bundled
#                                       Caddy (also serves files.help.example.com for uploads);
#                                       point both DNS records at this server first
set -eu
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo ".env already exists; leaving it alone. Delete it to start over." >&2
  exit 1
fi
command -v openssl >/dev/null || { echo "openssl is required to generate secrets" >&2; exit 1; }

domain="${1:-}"
cp .env.example .env

set_var() { # KEY VALUE: replace KEY= in .env, or append it
  if grep -q "^$1=" .env; then
    sed "s|^$1=.*|$1=$2|" .env > .env.tmp && mv .env.tmp .env
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}
secret() { openssl rand -hex 32; }

set_var PARSE_MASTER_KEY "$(secret)"
set_var MEILI_MASTER_KEY "$(secret)"
set_var HELPBITES_SECRET "$(secret)"
S3_SECRET="$(secret)"
set_var S3_ACCESS_KEY helpbites
set_var S3_SECRET_KEY "$S3_SECRET"
# Uploads go to the bundled RustFS bucket.
set_var S3_ENDPOINT sb-rustfs
set_var S3_PORT 9000
set_var S3_USE_SSL false
set_var S3_BUCKET help-bites

if [ -n "$domain" ]; then
  set_var APP_URL "https://$domain"
  set_var ADMIN_URL "https://$domain"
  set_var TRUST_PROXY_HOPS 1
  set_var S3_PUBLIC_URL "https://files.$domain/help-bites"
  set_var HELPBITES_DOMAIN "$domain"
  set_var COMPOSE_PROFILES proxy,rustfs
  SETUP_TOKEN_VALUE="$(secret)"
  set_var SETUP_TOKEN "$SETUP_TOKEN_VALUE"
  next="Open https://$domain once DNS for $domain and files.$domain points here. The sign-up form asks for the setup token: $SETUP_TOKEN_VALUE"
else
  set_var APP_URL http://localhost:3100
  set_var ADMIN_URL http://localhost:3100
  set_var S3_PUBLIC_URL http://localhost:9000/help-bites
  set_var COMPOSE_PROFILES rustfs
  set_var COMPOSE_FILE docker-compose.yml:docker-compose.local.yml
  next="Open http://localhost:3100"
fi

echo "Wrote .env. Next:"
echo "  docker compose up -d"
echo "  $next and create the first operator account."
if [ -z "$domain" ]; then echo "Whoever opens that page first becomes the owner, so do it right away."; fi
echo "Email (Mailgun) and AI replies stay off until you fill in MAILGUN_* / LITELLM_* in .env."
