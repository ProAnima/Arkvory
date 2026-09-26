#!/usr/bin/env bash
set -euo pipefail
root=$1
node=$2
prefix=${3:-arkvory}
[[ "$prefix" =~ ^[a-z][a-z0-9-]{0,40}$ ]] || exit 1
[[ $EUID -eq 0 ]] || { echo 'Run native installation as root' >&2; exit 1; }
command -v systemctl >/dev/null
[[ "$root" != *$'\n'* && "$root" != *'%'* && "$node" != *'"'* ]] || exit 1
getent passwd arkvory >/dev/null || useradd --system --home-dir "$root/data" --shell /usr/sbin/nologin arkvory
if [[ -f "$root/github-token.txt" ]]; then
  chown root:root "$root/github-token.txt"
  chmod 0600 "$root/github-token.txt"
fi
chown root:arkvory "$root" "$root/config"
chmod 0750 "$root" "$root/config"
if [[ -d "$root/database" ]]; then chmod 0711 "$root"; fi
chown -R arkvory:arkvory "$root/data" "$root/logs"
chmod 0750 "$root/data" "$root/logs"
chown root:arkvory "$root/config/runtime.json" "$root/config/keys.json"
if [[ -d "$root/updates/inbox" ]]; then
  chown arkvory:arkvory "$root/updates/inbox"
  chmod 0700 "$root/updates/inbox"
fi
chmod 0640 "$root/config/runtime.json" "$root/config/keys.json"
chmod 0600 "$root/config/bootstrap-token.txt" "$root/config/postgres.env"
for role in api worker; do
  unit="/etc/systemd/system/$prefix-$role.service"
  if [[ -e "$unit" ]] && ! grep -Fq "# Arkvory installation: $root" "$unit"; then
    echo 'A different Arkvory installation owns this service' >&2; exit 1
  fi
  cat > "$unit" <<EOF
# Arkvory installation: $root
[Unit]
Description=ProAnima Arkvory $role
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=0
[Service]
Type=exec
User=arkvory
Group=arkvory
ExecStart="$node" "$root/launcher.mjs" "$root" "$role"
WorkingDirectory=$root
Restart=always
RestartSec=10
TimeoutStopSec=120
KillSignal=SIGTERM
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths="$root/data" "$root/logs"
ReadWritePaths="-$root/updates/inbox"
UMask=0027
StandardOutput=journal
StandardError=journal
[Install]
WantedBy=multi-user.target
EOF
done
systemctl daemon-reload
systemctl enable "$prefix-api" "$prefix-worker"
