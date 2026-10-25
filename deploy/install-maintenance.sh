#!/usr/bin/env bash
# Install the daily storage and nightly backup timers as the deploy user. No credentials are copied into units.
set -euo pipefail
root="${WHEELHOUSE_ROOT:-$HOME/wheelhouse}"
user="$(id -un)"
# Unit paths are quoted; reject systemd expansion/control characters.
[[ "$root" =~ ^/[a-zA-Z0-9_./-]+$ && "$user" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo 'Unsupported maintenance path or user' >&2; exit 1; }
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cat > "$work/wheelhouse-storage.service" <<EOF
[Unit]
Description=Expire Wheelhouse release backups and unused images
After=docker.service

[Service]
Type=oneshot
User=$user
Environment="WHEELHOUSE_ROOT=$root"
ExecStart=/usr/bin/python3 "$root/storage.py" cleanup
UMask=0077
EOF
cat > "$work/wheelhouse-storage.timer" <<'EOF'
[Unit]
Description=Daily Wheelhouse storage retention

[Timer]
OnCalendar=daily
RandomizedDelaySec=15m
Persistent=true

[Install]
WantedBy=timers.target
EOF
cat > "$work/wheelhouse-backup.service" <<EOF
[Unit]
Description=Upload Wheelhouse database backups off the server
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$user
Environment="WHEELHOUSE_ROOT=$root"
ExecStart=/bin/bash "$root/nightly-backup.sh"
UMask=0077
EOF
cat > "$work/wheelhouse-backup.timer" <<'EOF'
[Unit]
Description=Nightly Wheelhouse off-server backup

[Timer]
# 10:00 UTC is the middle of the night across the United States.
OnCalendar=*-*-* 10:00:00 UTC
RandomizedDelaySec=15m
Persistent=true

[Install]
WantedBy=timers.target
EOF
sudo -n install -m 644 "$work/wheelhouse-storage.service" /etc/systemd/system/wheelhouse-storage.service
sudo -n install -m 644 "$work/wheelhouse-storage.timer" /etc/systemd/system/wheelhouse-storage.timer
for unit in wheelhouse-backup.service wheelhouse-backup.timer; do
  sudo -n install -m 644 "$work/$unit" "/etc/systemd/system/$unit"
done
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now wheelhouse-storage.timer wheelhouse-backup.timer
