export function deploymentHelp(): string {
  return `ProAnima Arkvory · Installation & lifecycle / Установка и обслуживание

arkvory <command> --root <absolute-directory> [options]

install        Install a verified stable release / Установить проверенный релиз
finish-install Resume saved installation / Продолжить сохранённую установку
status         Show installed version and update policy / Состояние
updates-connect Connect console notifications and host scheduler / Подключить обновления в UI
updates-poll    Process one update-control tick / Проверка и обработка очереди
updates-reset   Clear an interrupted request after reconciliation / Снять запрос после проверки
update         Update within the same database schema / Обновить код
upgrade        Schema maintenance; --backup-record required / Обновить схему
recover        Recover interrupted code switch / Восстановить переключение
configure      --enable-updates | --disable-updates | --pin --version X.Y.Z | --unpin
               --tls-cert <pem> --tls-key <pem> [--listen-host <addr>] | --tls-off
               Built-in HTTPS; restarts, verifies, rolls back on failure / HTTPS с откатом

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

Console / Консоль: http://127.0.0.1:8080/console/#onboarding
API: /api/v1/capabilities, /api/v1/operations (authenticated / с авторизацией)
API reference and integration recipes: Console → Help / Консоль → Справка
Recovery key: <root>/config/bootstrap-token.txt (administrator only)
Never put passwords or tokens in command arguments / Не передавайте секреты аргументами.
`;
}
