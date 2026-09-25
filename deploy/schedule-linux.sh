#!/usr/bin/env bash
set -euo pipefail
root=$1
node=$2
[[ $EUID -eq 0 ]] || { echo 'Scheduling requires root and systemd' >&2; exit 1; }
unit=/etc/systemd/system/depot-update.service
if [[ -e "$unit" ]] && ! grep -Fq "# Depot installation: $root" "$unit"; then
  echo 'Another installation owns the updater' >&2; exit 1
fi
cat > "$unit" <<EOF
# Depot installation: $root
[Unit]
Description=ProAnima Depot stable release update
Wants=network-online.target
After=network-online.target
[Service]
Type=oneshot
ExecStart="$node" "$root/manage.mjs" update --root "$root" --scheduled
TimeoutStartSec=1800
UMask=0077
EOF
cat > /etc/systemd/system/depot-update.timer <<'EOF'
[Unit]
Description=Check Depot stable releases daily
[Timer]
OnCalendar=*-*-* 03:00:00 UTC
RandomizedDelaySec=1800
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now depot-update.timer
