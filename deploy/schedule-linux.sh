#!/usr/bin/env bash
set -euo pipefail
root=$1
node=$2
[[ $EUID -eq 0 ]] || { echo 'Scheduling requires root and systemd' >&2; exit 1; }
unit=/etc/systemd/system/arkvory-update.service
if [[ -e "$unit" ]] && ! grep -Fq "# Arkvory installation: $root" "$unit"; then
  echo 'Another installation owns the updater' >&2; exit 1
fi
cat > "$unit" <<EOF
# Arkvory installation: $root
[Unit]
Description=ProAnima Arkvory release checks and queued updates
Wants=network-online.target
After=network-online.target
[Service]
Type=oneshot
ExecStart="$node" "$root/manage.mjs" updates-poll --root "$root"
TimeoutStartSec=1800
UMask=0077
EOF
cat > /etc/systemd/system/arkvory-update.timer <<'EOF'
[Unit]
Description=Process Arkvory update requests and release notifications
[Timer]
OnCalendar=*-*-* *:*:00
RandomizedDelaySec=10
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now arkvory-update.timer
