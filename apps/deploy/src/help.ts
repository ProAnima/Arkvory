export function deploymentHelp(): string {
  return `ProAnima Arkvory · Installation & lifecycle / Установка и обслуживание

arkvory <command> --root <absolute-directory> [options]

install        Install a verified stable release / Установить проверенный релиз
finish-install Resume saved installation / Продолжить сохранённую установку
status         Show installed version and update policy / Состояние
updates-connect Connect console notifications and host scheduler; registers missing services
               (backup agent after an update from 0.2) / Подключить обновления и недостающие службы
updates-poll    Process one update-control tick / Проверка и обработка очереди
updates-reset   Clear an interrupted request after reconciliation / Снять запрос после проверки
update         Update within the same database schema / Обновить код
upgrade        Schema maintenance; --backup-record required / Обновить схему
recover        Recover interrupted code switch / Восстановить переключение
configure      --enable-updates | --disable-updates | --pin --version X.Y.Z | --unpin
               --tls-cert <pem> --tls-key <pem> [--listen-host <addr>] | --tls-off
               Built-in HTTPS; restarts, verifies, rolls back on failure / HTTPS с откатом
               --backup-vault <absolute dir> [--init-vault] | --backup-vault-off
               Vault of the backup agent: outside the root and storage, writable; --init-vault
               creates vault.json only in an empty directory; restarts the agent, requires it
               to report the vault, rolls back on failure / Vault агента копий с откатом
               --mirror <repo> --mirror-upstream <https://origin> [--mirror-source <repo>]
               --mirror-token-file <file> | --mirror-detach <repo>
               Read-only mirror of a repository of another installation; checks the source
               with the read-only key, restarts, rolls back on failure / Зеркало с откатом

Installation options:
  --artifact <directory>  Verified local release (offline)
  --mode windows|systemd|compose
  --config <json>         External database and runtime configuration
  --database-bin <path>   Dedicated local database; cannot combine with external DB
  --owner-file <json>     Private {name,password}; deleted after creating first owner
  --automatic            Opt in to stable automatic updates

Examples:
  arkvory status --root /opt/proanima-arkvory
  arkvory update --root /opt/proanima-arkvory --artifact /media/release
  arkvory configure --root /opt/proanima-arkvory --disable-updates
  arkvory configure --root /opt/proanima-arkvory --tls-cert /etc/arkvory/fullchain.pem --tls-key /etc/arkvory/privkey.pem --listen-host 0.0.0.0
  arkvory configure --root /opt/proanima-arkvory --backup-vault /mnt/backup/arkvory --init-vault
  arkvory configure --root /opt/proanima-arkvory --mirror releases --mirror-upstream https://arkvory.example --mirror-token-file /root/mirror.key
  arkvory configure --root /opt/proanima-arkvory --mirror-detach releases

Console / Консоль: http://127.0.0.1:8080/console/#onboarding
API: /api/v1/capabilities, /api/v1/operations (authenticated / с авторизацией)
API reference and integration recipes: Console → Help / Консоль → Справка
Recovery key: <root>/config/bootstrap-token.txt (administrator only)
Never put passwords or tokens in command arguments / Не передавайте секреты аргументами.
`;
}
