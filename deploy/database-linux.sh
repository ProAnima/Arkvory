#!/usr/bin/env bash
set -euo pipefail
root=$1
node=$2
[[ $EUID -eq 0 ]] || exit 1
getent passwd arkvory-db >/dev/null || useradd --system --home-dir "$root/database" --shell /usr/sbin/nologin arkvory-db
# Separate database identity; the application cannot alter cluster files or owner credentials.
chmod 0711 "$root"
chown -R arkvory-db:arkvory-db "$root/database"
chmod 0700 "$root/database"
unit=/etc/systemd/system/arkvory-database.service
if [[ -e "$unit" ]] && ! grep -Fq "# Arkvory installation: $root" "$unit"; then
  echo 'Another installation owns arkvory-database' >&2; exit 1
fi
cat > "$unit" <<EOF
# Arkvory installation: $root
[Unit]
Description=ProAnima Arkvory database
After=network.target
StartLimitIntervalSec=0
[Service]
Type=exec
User=arkvory-db
Group=arkvory-db
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
systemctl enable --now arkvory-database
