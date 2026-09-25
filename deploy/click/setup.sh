#!/usr/bin/env bash
set -euo pipefail
bundle=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
mode=${1:-systemd}
[[ "$mode" == systemd || "$mode" == compose ]] || { echo 'Invalid installation mode' >&2; exit 1; }
say() { if [[ ${LANG:-} == ru* ]]; then printf '%s\n' "$2"; else printf '%s\n' "$1"; fi; }
finish() {
  code=$?
  if ((code)); then say 'Setup failed. Keep the installation directory and inspect the error above.' 'Установка не завершена. Сохраните каталог установки и проверьте ошибку выше.'; fi
  if [[ -t 0 ]]; then read -r -p 'Enter / Ввод...' _ || true; fi
  exit "$code"
}
if (( EUID != 0 )); then
  sudo bash "$bundle/setup.sh" "$mode"
  exit $?
fi
trap finish EXIT
say 'ProAnima Depot setup' 'Установка ProAnima Depot'
for dependency in curl python3 tar xz sha256sum; do
  command -v "$dependency" >/dev/null || { echo "Missing dependency: $dependency" >&2; exit 1; }
done
if [[ "$mode" == compose ]]; then
  docker info >/dev/null
  docker compose version >/dev/null
else
  command -v systemctl >/dev/null
fi
root=/opt/proanima-depot
if [[ -f "$root/installation.json" ]]; then
  python3 - "$root/installation.json" "$mode" <<'PY'
import json, sys
if json.load(open(sys.argv[1]))['mode'] != sys.argv[2]: raise RuntimeError('Existing installation uses another mode')
PY
  case $(uname -m) in x86_64) arch=x64;; aarch64) arch=arm64;; *) exit 1;; esac
  "$root/runtime/node-v24.21.0-linux-$arch/bin/node" "$root/manage.mjs" update --root "$root" --artifact "$bundle"
else
  DEPOT_ARTIFACT_DIR="$bundle" bash "$bundle/install.sh" --mode "$mode"
fi
say 'Ready: http://127.0.0.1:8080' 'Готово: http://127.0.0.1:8080'
say "Initial key: $root/config/bootstrap-token.txt (keep private)." "Первичный ключ: $root/config/bootstrap-token.txt (храните в секрете)."
say 'Automatic updates are opt-in; see START-HERE.md.' 'Автообновление включается отдельно; см. START-HERE.md.'
