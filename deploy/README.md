# Установка Depot

Самостоятельная установка одного API и completion worker: Linux/systemd, Windows desktop/Server и Docker Compose. Поддерживаются стабильные опубликованные GitHub Releases, фиксация версии и отключаемые автоматические обновления. Готовые артефакты создаёт workflow `Prepare stable release`; **до публикации первого релиза сетевой installer не сможет скачать Depot**. Из исходников можно установить локальный артефакт.

## Быстрый запуск

Для установки **на другую машину** откройте Depot Remote Setup из клиентского пакета: адрес SSH → проверка ключа и платформы → одна кнопка установки → готовая консоль через автоматически созданный приватный туннель. Поддержаны нативные Windows/Linux, RU/EN и обе темы. [Шаги, требования и ограничения сети](../docs/REMOTE_DEPLOYMENT.md).

### Нативные установщики

Основной вариант Windows — **Depot-Setup-x64.exe**: настоящий мастер RU/EN со светлой/тёмной темой, готовыми Node.js/PostgreSQL/WinSW/VC++ runtime, созданием владельца и открытием onboarding. Интернет при установке не требуется. UAC и ввод пароля владельца выполняются пользователем.

Linux — **Depot-amd64.deb** / **Depot-x86_64.rpm**. Node.js и Depot включены, PostgreSQL и системные зависимости устанавливает пакетный менеджер. Откройте пакет в менеджере приложений или используйте apt/dnf. После установки откройте Depot из меню приложений. Не обещаем двойной щелчок на headless сервере или одинаковый GUI во всех дистрибутивах.

База Depot изолирована на loopback:54329; существующие кластеры не изменяются. Данные сохраняются при удалении. Подробности, ограничения платформ, CLI и восстановление: [native/README](native/README.md), [ADR 0033](../docs/adr/0033-native-installers-and-guided-setup.md).

ZIP/tar-комплекты остаются для операторской автоматизации и Compose. CMD-launchers удалены; эти архивы не являются графическими установщиками. Docker engine устанавливается отдельно.

### Командные установщики

Скачайте `install.sh` либо `install.ps1` из проверенного [релиза](https://github.com/ProAnima/Depot/releases), просмотрите скрипт перед запуском с правами администратора. Он скачивает закреплённый Node.js 24 LTS с проверкой SHA-256, затем проверенный runtime Depot. npm и компилятор на целевом сервере не нужны.

Linux, нативно:

```bash
sudo bash ./install.sh --automatic
```

Нужны systemd, glibc, Bash, curl, Python 3, tar/xz и доступная PostgreSQL. Архитектуры x64/arm64. Установщик скрыто запросит PostgreSQL URL; можно передать `--config /secure/depot.json` с `{"DEPOT_DATABASE_URL":"postgresql://..."}`. Базу и права создаёт администратор PostgreSQL. Путь по умолчанию — `/opt/proanima-depot`; другой путь: `sudo env DEPOT_INSTALL_ROOT=/srv/depot bash ./install.sh`. Не размещайте установку в домашнем каталоге: служба использует ProtectHome.

Windows x64, PowerShell от администратора (Windows desktop с поддержкой Node.js 24 либо Server 2022/2025):

```powershell
.\install.ps1 -AutomaticUpdates
```

Путь — `C:\ProgramData\ProAnima\Depot`; доступны `-Root`, `-Config`, `-Version` и `-Pin`. Для другого Root используйте машинный каталог вне пользовательского профиля/AppData: LocalService должен проходить по родительским каталогам при разрешении пути Node.js. PostgreSQL URL запрашивается скрыто. Службы `Depotapi` и `Depotworker` используют LocalService; WinSW 2.12.0 проверяется по закреплённому SHA-256. Пользовательский сеанс для нативных служб не нужен.

Docker, Linux:

```bash
sudo bash ./install.sh --mode compose --automatic
```

Docker, Windows с работающим Docker Desktop в режиме Linux containers:

```powershell
.\install.ps1 -Mode compose
```

Движок и Compose должны быть установлены заранее; установщик не меняет гипервизор, WSL или Docker. Образ собирается локально из скомпилированного релиза. PostgreSQL 18.4 включён, пароль генерируется; named volumes сохраняют каталог БД и файлы. Для Podman: `--engine podman` / `-Engine podman`, нужен совместимый compose provider; приёмка конкретной версии проводится отдельно. Rootless Podman и Docker Desktop требуют планировщика в контексте пользователя движка; системный updater рассчитан на системный Docker/Podman. Windows containers не поставляются.

HTTP по умолчанию доступен только через `http://127.0.0.1:8080`. Первичный ключ — в `config/bootstrap-token.txt`, в вывод установки он не попадает. После первого входа создайте ограниченные учётные записи/ключи и замените bootstrap credential. Для удалённого доступа настройте HTTPS reverse proxy: [nginx.conf.example](nginx.conf.example) не буферизует большие загрузки. Сертификаты, домен и firewall настраивает оператор.

Readiness проверяется отдельным `config/health-token.txt`: его запись `deployment-health` в keys.json не имеет repository grants и административных прав. Сохраняйте эту запись при ротации bootstrap; при замене health credential синхронно меняйте токен и его SHA-256 и перезапускайте API. Healthcheck не использует административный ключ и не снимает авторизацию с `/health/ready`.

## Приватный репозиторий

Перед сетевой установкой создайте **в выделенном каталоге установки** `github-token.txt` с токеном чтения Contents этого репозитория. Не передавайте его аргументом CLI. Linux: owner root, mode 0600, каталог 0700; Windows: только Administrators/SYSTEM. Тот же файл использует updater. Служба Depot не должна читать его. Токен, скопированный после установки, нужно защитить теми же правами. Для публичных releases он не нужен.

## Каталоги и управление

| Путь                                             | Назначение                                                    |
| ------------------------------------------------ | ------------------------------------------------------------- |
| `releases/<version>`                             | Код и production dependencies; приложение не пишет сюда       |
| `installation.json`                              | Текущая версия, режим, automatic и pin; меняется CLI под lock |
| `config/runtime.json`, `config/keys.json`        | Настройки и хеши ключей                                       |
| `config/bootstrap-token.txt`, `github-token.txt` | Раздельные секреты приложения и обновления                    |
| `data`, `logs`                                   | Данные нативной установки и логи Windows                      |
| `journal.json`, `operation.lock`                 | Состояние переключения/восстановления                         |
| `launcher.mjs`, `manage.mjs`                     | Загрузчики текущего релиза                                    |

Контейнерные данные находятся в `proanima-depot_storage` и `proanima-depot_catalog`, а не в host data. Не запускайте `down --volumes` на установленном хранилище. Профиль имеет фиксированные Compose project и порт, одна установка на container host. Нельзя подключать второго writer к той же БД/root.

Примеры используют `node`; при отсутствии в PATH укажите поставленный `runtime/node-v24.21.0-<platform>/bin/node` (Linux) либо `runtime/node-v24.21.0-win-x64/node.exe`. Выполняйте команды с правами администратора:

```bash
node /opt/proanima-depot/manage.mjs status --root /opt/proanima-depot
node /opt/proanima-depot/manage.mjs update --root /opt/proanima-depot
node /opt/proanima-depot/manage.mjs configure --root /opt/proanima-depot --disable-updates
node /opt/proanima-depot/manage.mjs configure --root /opt/proanima-depot --pin
node /opt/proanima-depot/manage.mjs configure --root /opt/proanima-depot --unpin --enable-updates
```

Новые установки подключают уведомления и минутный обработчик команд. Проверка stable GitHub Releases выполняется каждые 6 часов, даже при выключенной автоустановке. `--automatic` / `-AutomaticUpdates` включает установку в окно 03:00–03:59 UTC на всех платформах; час меняется в консоли → Обновления. Не более одной попытки за сутки UTC, без догоняющего запуска вне окна. Pin запрещает плановую смену версии. Ручной выбор: `update --version 1.2.3`; downgrade запрещён. На хостах без системного планировщика его подключает оператор. [Уведомления, подключение существующих установок, API и восстановление](../docs/UPDATES.md).

Linux: `systemctl status depot-api depot-worker`, `journalctl -u depot-api -u depot-worker`; лимиты journald задаются в ОС. Windows: Services и logs с ротацией по 20 MiB, пять архивов. Docker: Compose logs, JSON logs ограничены 20 MiB × 5. Сбой процесса вызывает restart через 10 секунд у нативных служб, у Docker — по политике движка. Неуспешная readiness сама по себе не вызывает restart: мониторинг отдельно сообщает о недоступной БД, потере ownership и дисковых ошибках.

## Обновление и восстановление

Сначала проверяется полный релиз: SHA-256, безопасные пути ZIP и лимиты распаковки; для Compose заранее строится образ. Затем останавливаются worker/API с пределом 120 секунд, переключается версия, запускаются процессы и проверяется readiness. При той же схеме миграции не запускаются, возможен автоматический rollback. Старый код, ключи, конфигурация, volumes и данные сохраняются. Это обновление с перерывом, не HA/rolling update; клиентам нужны resume/retry.

Изменение схемы требует offline backup БД и полного storage root, проверки восстановления и migration notes. После этого:

```bash
node /opt/proanima-depot/manage.mjs upgrade --root /opt/proanima-depot --version 1.2.3 --backup-record /secure/backup-2026-09-25.txt
```

`backup-record` — существующая запись оператора, **не автоматическое доказательство полноты копии**. При ошибке миграции автоматический возврат старого кода запрещён: завершите обслуживание или восстановите согласованную копию. Runtime URL пока используется и для миграций; если runtime роль лишена DDL, переключайте credential на обслуживание и возвращайте ограниченную роль после него. Автоматическое управление ролями PostgreSQL не реализовано.

После аварии updater:

1. Остановите планировщик, убедитесь, что updater завершён, сохраните journal и логи.
2. Только после этого удалите конкретный `operation.lock`. Захват «старого» lock автоматически запрещён.
3. Для обычного обновления запустите `node .../manage.mjs recover --root ...`. `maintenance-required` требует ручного восстановления/завершения обслуживания.
4. Проверьте readiness, completion queue и контрольное скачивание; включите расписание.

Если первая установка остановилась после записи installation.json, устраните причину и используйте `finish-install --root ...` через manage.mjs. Не удаляйте config/data для повтора. При более ранней ошибке сохраните секреты и диагностируйте каталог: конфигурация не перезаписывается.

Старые releases, staging и download artifacts автоматически не удаляются. После проверки можно вручную убрать неиспользуемые каталоги, оставив текущую и предыдущую версию из журнала. Node.js, WinSW, PostgreSQL major, ОС и container engine обновляются отдельным обслуживанием.

## Разработка и выпуск

```bash
npm ci --ignore-scripts
npm run gate -- quick deployment
npm run release:package -- 0.1.0
node artifacts/0.1.0/depot-setup.mjs install --root /opt/proanima-depot --mode compose --artifact artifacts/0.1.0
```

Нативная локальная установка требует --config и административных прав. Артефакты рабочего дерева — для проверки; production выпускает workflow с tested commit. `Prepare stable release` работает только с main: read-only job выполняет полный release gate и собирает один candidate; приёмка Windows/Linux и контейнеров использует именно его. Отдельный publish job проверяет SHA-256 всех assets и совпадение commit/version, не пересобирает и не запускает артефакт, затем создаёт tag и draft. Только он имеет contents:write. Публикация draft владельцем делает версию доступной автообновлению. Неполный draft после ошибки upload нельзя публиковать. Повтор с существующим tag отказывает: разберите сбой, не заменяйте опубликованную версию.

`release-checksums.json` связывает runtime, bootstrap, командные установщики и два комплекта с одной версией/коммитом. Это контроль целостности, не независимая цифровая подпись. Передача candidate между jobs требует доступной квоты GitHub Actions artifacts. При нехватке места workflow блокирует выпуск; переключения на непроверенную пересборку или пропуска приёмки нет.

Гейты `deployment`, `deployment-services`, `deployment-containers` проверяют соответственно переносимый runtime, настоящий crash/restart двух изолированных служб и Docker install/migrate/update с сохранением volume. Service gate требует Windows Administrator либо Linux/systemd и passwordless sudo; container gate — Docker/Compose без уже установленного проекта proanima-depot. Они обязательны в CI и verify/release; отсутствие инфраструктуры не считается pass. Двухсерверный HA и реальные клиенты ProGet остаются стендовыми проверками.

Архитектура: [ADR 0031](../docs/adr/0031-release-installation-and-supervision.md). Supervisor: [systemd](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html), [WinSW](https://github.com/winsw/winsw/blob/v2.12.0/doc/xmlConfigFile.md), [Docker](https://docs.docker.com/engine/containers/start-containers-automatically/).
