#!/usr/bin/env bash
# Runs on the server. Creates one Wheelhouse instance: its folder and .env under ~/wheelhouse,
# and the server's nginx site for its domain. From a checkout, without copying anything first:
#
#   ssh <server> 'bash -s' -- family home.example.com Family < deploy/new-instance.sh
#
# The instance starts on the next release. It never touches an instance that already exists.
set -euo pipefail

usage="usage: new-instance.sh <name> <domain> <Demo|Family>, for example: new-instance.sh demo wheelhouse.example.com Demo"
name="${1:?$usage}"
domain="${2:?$usage}"
mode="${3:?$usage}"

if [[ ! "$name" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "The name becomes a folder and a Compose project, so use lowercase letters, digits and dashes: $name" >&2
  exit 1
fi
if [[ ! "$domain" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo "Not a domain name: $domain" >&2
  exit 1
fi
if [[ "$mode" != Demo && "$mode" != Family ]]; then
  echo "The mode is Demo or Family, not $mode" >&2
  exit 1
fi

root="${WHEELHOUSE_ROOT:-$HOME/wheelhouse}"
dir="$root/$name"
site="/etc/nginx/sites-available/$domain"

if [[ -e "$dir/.env" ]]; then
  echo "$dir/.env already exists. Edit it instead of creating the instance again." >&2
  exit 1
fi
if [[ -e "$site" ]]; then
  echo "$site already exists. Another instance may already use $domain." >&2
  exit 1
fi

# The next loopback port after every other instance's, starting at 8610.
port=8610
shopt -s nullglob
for env_file in "$root"/*/.env; do
  used="$(grep '^WHEELHOUSE_HTTP_PORT=' "$env_file" | cut -d= -f2 || true)"
  if [[ "$used" =~ ^[0-9]+$ ]] && (( used >= port )); then
    port=$((used + 1))
  fi
done

mkdir -p "$dir"
# The .env holds the database password and, on a family instance, the Google client secret,
# so only its owner can read it.
(
  umask 077
  {
    echo "WHEELHOUSE_MODE=$mode"
    echo "WHEELHOUSE_HTTP_PORT=$port"
    echo "WHEELHOUSE_DB_PASSWORD=$(openssl rand -hex 24)"
    if [[ "$mode" == Family ]]; then
      echo "# Google sign-in: see deploy/README.md#google-sign-in. Until these are set, nobody can sign in."
      echo "WHEELHOUSE_GOOGLE_CLIENT_ID="
      echo "WHEELHOUSE_GOOGLE_CLIENT_SECRET="
      echo "WHEELHOUSE_PARENT_EMAILS="
    fi
  } > "$dir/.env"
)
echo "Created $dir/.env ($mode, port $port)"

sudo tee "$site" > /dev/null <<EOF
# Wheelhouse instance "$name", written by deploy/new-instance.sh. certbot adds the HTTPS half.
server {
    listen 80;
    server_name $domain;

    location / {
        proxy_pass http://127.0.0.1:$port;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # SignalR keeps a WebSocket open, so pass the upgrade through and allow long-lived reads.
    location /hubs/ {
        proxy_pass http://127.0.0.1:$port;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }
}
EOF
sudo ln -s "$site" "/etc/nginx/sites-enabled/$domain"
sudo nginx -t
sudo systemctl reload nginx
echo "Created the nginx site for $domain"

echo
echo "Next, once $domain points at this server, add HTTPS:"
echo "  sudo certbot --nginx -d $domain"
if [[ "$mode" == Family ]]; then
  echo "Then fill in the Google sign-in lines in $dir/.env."
fi
echo "The instance starts on the next release."
