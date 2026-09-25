#!/usr/bin/env bash
set -euo pipefail
root=$1
node=$2
[[ $EUID -eq 0 ]] || exit 1
getent passwd depot-db >/dev/null || useradd --system --home-dir "$root/database" --shell /usr/sbin/nologin depot-db
# Separate database identity; the application cannot alter cluster files or owner credentials.
chmod 0711 "$root"
chown -R depot-db:depot-db "$root/database"
chmod 0700 "$root/database"
unit=/etc/systemd/system/depot-database.service
if [[ -e "$unit" ]] && ! grep -Fq "# Depot installation: $root" "$unit"; then
  echo 'Another installation owns depot-database' >&2; exit 1
fi
cat > "$unit" <<EOF
# Depot installation: $root
[Unit]
Description=ProAnima Depot database
After=network.target
StartLimitIntervalSec=0
[Service]
Type=exec
User=depot-db
Group=depot-db
ExecStart="$node" "$root/launcher.mjs" "$root" database
Restart=on-failure
RestartSec=10
KillMode=mixed
TimeoutStopSec=120
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths="$root/database"
UMask=0077
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now depot-database
