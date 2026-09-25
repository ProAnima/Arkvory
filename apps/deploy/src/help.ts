export function deploymentHelp(): string {
  return `ProAnima Depot · Installation & lifecycle / Установка и обслуживание

depot <command> --root <absolute-directory> [options]

install        Install a verified stable release / Установить проверенный релиз
finish-install Resume saved installation / Продолжить сохранённую установку
status         Show installed version and update policy / Состояние
update         Update within the same database schema / Обновить код
upgrade        Schema maintenance; --backup-record required / Обновить схему
recover        Recover interrupted code switch / Восстановить переключение
configure      --enable-updates | --disable-updates | --pin --version X.Y.Z | --unpin

Installation options:
  --artifact <directory>  Verified local release (offline)
  --mode windows|systemd|compose
  --config <json>         External database and runtime configuration
  --database-bin <path>   Dedicated local database; cannot combine with external DB
  --owner-file <json>     Private {name,password}; deleted after creating first owner
  --automatic            Opt in to stable automatic updates

Examples:
  depot status --root /opt/proanima-depot
  depot update --root /opt/proanima-depot --artifact /media/release
  depot configure --root /opt/proanima-depot --disable-updates

Console / Консоль: http://127.0.0.1:8080/console/#onboarding
API: /api/v1/capabilities, /api/v1/operations (authenticated / с авторизацией)
API reference and integration recipes: Console → Help / Консоль → Справка
Recovery key: <root>/config/bootstrap-token.txt (administrator only)
Never put passwords or tokens in command arguments / Не передавайте секреты аргументами.
`;
}
