#!/usr/bin/env bash
# Opens one backup vault for the arkvory-backup unit, or none with "-" (ADR 0057).
set -euo pipefail
root=$1
vault=$2
prefix=${3:-arkvory}
[[ "$prefix" =~ ^[a-z][a-z0-9-]{0,40}$ ]] || exit 1
[[ $EUID -eq 0 ]] || { echo 'Configure the backup vault as root' >&2; exit 1; }
[[ "$root" != *$'\n'* && "$root" != *'%'* ]] || exit 1
unit="/etc/systemd/system/$prefix-backup.service"
directory="/etc/systemd/system/$prefix-backup.service.d"
dropin="$directory/arkvory-vault.conf"
if ! grep -Fq "# Arkvory installation: $root" "$unit"; then
  echo 'The backup service of this installation is not registered' >&2; exit 1
fi
if [[ "$vault" == - ]]; then
  rm -f -- "$dropin"
else
  case "$vault" in
    /*) ;;
    *) echo 'The vault must be an absolute path' >&2; exit 1 ;;
  esac
  if [[ "$vault" == *[[:cntrl:]]* || "$vault" == *'"'* || "$vault" == *'\'* || "$vault" == *'%'* ]]; then
    echo 'Unsupported vault path' >&2; exit 1
  fi
  [[ -d "$vault" && ! -L "$vault" ]] || { echo 'The vault must be an existing directory' >&2; exit 1; }
  # The vault holds catalogue exports, password hashes and content: only the service account.
  chown -R --no-dereference arkvory:arkvory -- "$vault"
  chmod 0700 -- "$vault"
  mkdir -p -m 0755 -- "$directory"
  cat > "$dropin.tmp" <<EOF
# Arkvory installation: $root
# ProtectSystem=strict keeps storage read-only for the agent; only the vault is writable.
[Service]
ReadWritePaths="-$vault"
EOF
  chmod 0644 -- "$dropin.tmp"
  mv -f -- "$dropin.tmp" "$dropin"
fi
systemctl daemon-reload
