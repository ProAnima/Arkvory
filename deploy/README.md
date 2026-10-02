# Установка Arkvory

Самостоятельная установка одного API, completion worker и агента резервных копий: Linux/systemd, Windows desktop/Server и Docker Compose. Поддерживаются стабильные опубликованные GitHub Releases, фиксация версии и отключаемые автоматические обновления. Готовые артефакты создаёт workflow `Prepare stable release`; **до публикации первого релиза сетевой installer не сможет скачать Arkvory**. Из исходников можно установить локальный артефакт.

## Быстрый запуск

Для установки **на другую машину** откройте Arkvory Remote Setup из клиентского пакета: адрес SSH → проверка ключа и платформы → одна кнопка установки → готовая консоль через автоматически созданный приватный туннель. Поддержаны нативные Windows/Linux, RU/EN и обе темы. [Шаги, требования и ограничения сети](../docs/REMOTE_DEPLOYMENT.md).

### Нативные установщики

Основной вариант Windows — **Arkvory-Setup-x64.exe**: настоящий мастер RU/EN со светлой/тёмной темой, готовыми Node.js/PostgreSQL/WinSW/VC++ runtime, созданием владельца и открытием onboarding. Интернет при установке не требуется. UAC и ввод пароля владельца выполняются пользователем.

Linux — **Arkvory-amd64.deb** / **Arkvory-x86_64.rpm**. Node.js и Arkvory включены, PostgreSQL и системные зависимости устанавливает пакетный менеджер. Откройте пакет в менеджере приложений или используйте apt/dnf. После установки откройте Arkvory из меню приложений. Не обещаем двойной щелчок на headless сервере или одинаковый GUI во всех дистрибутивах.

База Arkvory изолирована на loopback:54329; существующие кластеры не изменяются. Данные сохраняются при удалении. Подробности, ограничения платформ, CLI и восстановление: [native/README](native/README.md), [ADR 0033](../docs/adr/0033-native-installers-and-guided-setup.md).

ZIP/tar-комплекты остаются для операторской автоматизации и Compose. CMD-launchers удалены; эти архивы не являются графическими установщиками. Docker engine устанавливается отдельно.

### Командные установщики

Скачайте `install.sh` либо `install.ps1` из проверенного [релиза](https://github.com/ProAnima/Arkvory/releases) и просмотрите скрипт перед запуском. Он скачивает закреплённый Node.js 24 LTS с проверкой SHA-256, затем проверенный runtime Arkvory. npm и компилятор на целевом сервере не нужны. Без опубликованного релиза используйте распакованный комплект `Arkvory-Linux.tar.gz` / `Arkvory-Windows.zip` (локальный artifact, см. «Docker одной командой») либо установку из исходников.

| Вариант                  | Команда                                 | Права                                           | Supervisor                                            |
| ------------------------ | --------------------------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| Linux, systemd           | `sudo bash ./install.sh --automatic`    | root                                            | systemd: `arkvory-api`, `-worker`, `-backup`          |
| Windows, нативные службы | `.\install.ps1 -AutomaticUpdates`       | PowerShell от администратора                    | WinSW: `Arkvoryapi`, `Arkvoryworker`, `Arkvorybackup` |
| Docker, Linux            | `sudo bash ./install.sh --mode compose` | root либо пользователь группы docker            | restart policy Docker                                 |
| Docker, Windows          | `.\install.ps1 -Mode compose`           | пользователь Docker Desktop, повышение не нужно | restart policy Docker Desktop                         |

Командным нативным вариантам нужна доступная PostgreSQL (URL запрашивается скрыто); графические EXE/DEB/RPM создают выделенный кластер. Docker-вариант поднимает API, worker, агента резервных копий и PostgreSQL 18.4 из `deploy/compose.yml`.

Linux, нативно:

```bash
sudo bash ./install.sh --automatic
```

Нужны systemd, glibc, Bash, curl, Python 3, tar/xz и доступная PostgreSQL. Архитектуры x64/arm64. Установщик скрыто запросит PostgreSQL URL; можно передать `--config /secure/arkvory.json` с `{"ARKVORY_DATABASE_URL":"postgresql://..."}`. Базу и права создаёт администратор PostgreSQL. Путь по умолчанию — `/opt/proanima-arkvory`; другой путь: `sudo env ARKVORY_INSTALL_ROOT=/srv/arkvory bash ./install.sh`. Не размещайте установку в домашнем каталоге: служба использует ProtectHome.

Windows x64, PowerShell от администратора (Windows desktop с поддержкой Node.js 24 либо Server 2022/2025):

```powershell
.\install.ps1 -AutomaticUpdates
```

Путь — `C:\ProgramData\ProAnima\Arkvory`; доступны `-Root`, `-Config`, `-Version` и `-Pin`. Для другого Root используйте машинный каталог вне пользовательского профиля/AppData: LocalService должен проходить по родительским каталогам при разрешении пути Node.js. PostgreSQL URL запрашивается скрыто. Службы `Arkvoryapi`, `Arkvoryworker` и `Arkvorybackup` используют LocalService; WinSW 2.12.0 проверяется по закреплённому SHA-256. Пользовательский сеанс для нативных служб не нужен.

Docker, Linux:

```bash
sudo bash ./install.sh --mode compose --automatic
```

Без root установщик работает от пользователя группы docker с доступным ему корнем: `ARKVORY_INSTALL_ROOT="$HOME/arkvory" bash ./install.sh --mode compose`. Корень получает 0700, а systemd-updater не регистрируется (см. «Планировщик updater без повышения прав»). Ограничение ProtectHome относится только к нативной службе.

Docker, Windows с работающим Docker Desktop в режиме Linux containers, обычная PowerShell **от того же пользователя, под которым запущен Docker Desktop**:

```powershell
.\install.ps1 -Mode compose
```

Повышение прав для Compose не требуется и не рекомендуется: Docker Desktop читает bind mounts с токеном своего пользователя, поэтому ACL корня — SYSTEM, Administrators и этот пользователь, без наследования ([ADR 0050](../docs/adr/0050-windows-compose-engine-user.md)). Корень по умолчанию — `C:\ProgramData\ProAnima\Arkvory`; другой задаётся `-Root`. Если PowerShell запрещает запуск скриптов, используйте `powershell -ExecutionPolicy Bypass -File .\install.ps1 -Mode compose` (политика меняется только для этого процесса). При запуске от администратора дополнительно регистрируется SYSTEM-задача updater, которая рассчитана на системный движок, а не на Docker Desktop.

Движок и Compose должны быть установлены заранее; установщик не меняет гипервизор, WSL или Docker. Образ собирается локально из скомпилированного релиза. PostgreSQL 18.4 включён, пароль генерируется; named volumes сохраняют каталог БД и файлы. Для Podman: `--engine podman` / `-Engine podman`, нужен совместимый compose provider; приёмка конкретной версии проводится отдельно. Rootless Podman и Docker Desktop требуют планировщика в контексте пользователя движка; системный updater рассчитан на системный Docker/Podman. Windows containers не поставляются.

### Docker одной командой

Стек API + worker + агент резервных копий + PostgreSQL из `deploy/compose.yml` ставится одной командой установщика. Из опубликованного релиза — команды из таблицы выше. Из распакованного комплекта без доступа к GitHub Releases (Node.js по-прежнему скачивается с проверкой SHA-256):

```bash
# Linux, в каталоге распакованного Arkvory-Linux.tar.gz
sudo env ARKVORY_ARTIFACT_DIR="$PWD" bash ./install.sh --mode compose
```

```powershell
# Windows, в каталоге распакованного Arkvory-Windows.zip
.\install.ps1 -Mode compose -Artifact $PWD.Path
```

Передавайте `-Root`/`-Artifact` абсолютными путями: .NET разрешает относительный путь от рабочего каталога процесса, а не от текущего каталога PowerShell.

Из исходников (оценка до первого релиза; нужен Node.js 24 и `npm ci --ignore-scripts`) одна команда собирает проект, упаковывает тот же комплект, что проверяют гейты, и ставит его в режиме Compose текущим Node.js:

```bash
npm run deploy:compose -- --root "$HOME/arkvory-compose"
```

```powershell
npm run deploy:compose -- --root C:\Arkvory\compose
```

Параметры: `--version 0.1.0` (по умолчанию `0.0.1` — локальная сборка, которую плановое обновление заменит первым stable-релизом), `--engine podman`. Корень должен быть новым выделенным каталогом. Production-установку выполняйте из проверенного релиза, не из рабочего дерева.

После установки консоль открывается по `http://127.0.0.1:8080/console/`, ключ — в `config/bootstrap-token.txt`. Управление Compose-проектом (Linux; на Windows те же аргументы с путями `$root\...`):

```bash
root=/opt/proanima-arkvory
version=$(node -p "require('$root/installation.json').current.version")
compose=(docker compose --project-name proanima-arkvory --project-directory "$root" --env-file "$root/config/compose.env" -f "$root/releases/$version/deploy/compose.yml")
# Настроенный vault резервных копий: без этого файла `up` пересоздаст backup без vault.
[[ -f "$root/config/compose.vault.yml" ]] && compose+=(-f "$root/config/compose.vault.yml")
"${compose[@]}" ps
"${compose[@]}" logs --tail 100 api worker backup
"${compose[@]}" stop --timeout 120 backup worker api
"${compose[@]}" up -d --wait api worker
"${compose[@]}" up -d backup
```

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
$version = (Get-Content "$root\installation.json" -Raw | ConvertFrom-Json).current.version
docker compose --project-name proanima-arkvory --project-directory $root --env-file "$root\config\compose.env" -f "$root\releases\$version\deploy\compose.yml" ps
```

Полное удаление оценочной установки вместе с данными — та же команда с `down --volumes`, затем удаление каталога root. На рабочем хранилище `down --volumes` не выполняйте.

### Планировщик updater без повышения прав

Установка Compose без root/Administrator не регистрирует системный updater и печатает указание запланировать `updates-poll` под владельцем движка. Без него консоль не применит запросы обновления. Linux (crontab пользователя группы docker):

```bash
* * * * * /path/to/root/runtime/node-v24.21.0-linux-x64/bin/node /path/to/root/manage.mjs updates-poll --root /path/to/root
```

Windows (обычная PowerShell от пользователя Docker Desktop; задача работает только в его сеансе, пока Docker Desktop запущен):

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
$node = "$root\runtime\node-v24.21.0-win-x64\node.exe"
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$root\manage.mjs`" updates-poll --root `"$root`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Action $action -Trigger $trigger -Settings $settings
```

Аргументы совпадают с системной задачей `schedule-windows.ps1`, поэтому повторная регистрация от администратора не считается чужой установкой. `npm run deploy:compose` не скачивает runtime: в обеих командах укажите путь к используемому Node.js 24.

HTTP по умолчанию доступен только через `http://127.0.0.1:8080`. Первичный ключ — в `config/bootstrap-token.txt`, в вывод установки он не попадает. После первого входа создайте ограниченные учётные записи/ключи и замените bootstrap credential. Для удалённого доступа на нативной установке включите встроенный HTTPS: `arkvory configure --root <root> --tls-cert <fullchain.pem> --tls-key <privkey.pem> --listen-host 0.0.0.0`. Команда проверит файлы, перезапустит службы и при сбое вернёт прежнюю настройку; `--tls-off` выключает HTTPS. Обновлённые файлы сертификата подхватываются без перезапуска, проверки установщика сверяют сам настроенный сертификат, см. [CORE_RUNBOOK](../docs/CORE_RUNBOOK.md). Для Compose используйте HTTPS reverse proxy (подходит и для нативной установки): [nginx.conf.example](nginx.conf.example) не буферизует большие загрузки. Сертификаты, домен и firewall настраивает оператор.

Readiness проверяется отдельным `config/health-token.txt`: его запись `deployment-health` в keys.json не имеет repository grants и административных прав. Сохраняйте эту запись при ротации bootstrap; при замене health credential синхронно меняйте токен и его SHA-256 и перезапускайте API. Healthcheck не использует административный ключ и не снимает авторизацию с `/health/ready`.

### Резервные копии

Агент резервных копий (`arkvory-backup` / `Arkvorybackup` / сервис Compose `backup`) устанавливается и запускается вместе с API и worker, но в readiness не входит. Без vault он работает и сообщает `vault_not_configured`. Vault — отдельный том или NAS, смонтированный заранее, вне корня установки. Подключение и отключение:

```bash
sudo arkvory configure --root /opt/proanima-arkvory --backup-vault /mnt/backup/arkvory --init-vault
sudo arkvory configure --root /opt/proanima-arkvory --backup-vault-off
```

Команда проверяет каталог до изменений и создаёт `vault.json` только в пустом каталоге (`--init-vault`). Затем она выдаёт доступ учётной записи службы (Linux — `arkvory`, 0700 и drop-in systemd; Windows — `NT AUTHORITY\LOCAL SERVICE`; Compose — bind mount `config/compose.vault.yml` с владельцем uid 1000) и перезапускает только агента. Изменение принимается, когда агент сам сообщил этот vault доступным; при сбое прежняя настройка возвращается. Расписание, retention и копии — в консоли, `arkvoryctl backup` и [CORE_RUNBOOK](../docs/CORE_RUNBOOK.md#резервные-копии-без-участия-оператора-b2). Решение: [ADR 0057](../docs/adr/0057-backup-agent-service.md).

Установка 0.2.x, обновлённая своим же кодом (`manage.mjs update`/`upgrade`, планировщик), службу агента не получает: после обновления выполните `arkvory updates-connect --root <root>`. Пакеты deb, rpm и exe и обновления, выполненные новой версией, регистрируют её сами. Удаление и repair vault не трогают.

## Приватный репозиторий

Перед сетевой установкой создайте **в выделенном каталоге установки** `github-token.txt` с токеном чтения Contents этого репозитория. Не передавайте его аргументом CLI. Linux: owner root (или пользователь Compose без root), mode 0600, каталог 0700; Windows: только Administrators/SYSTEM, для Compose без повышения — ещё установивший пользователь. Тот же файл использует updater. Служба Arkvory не должна читать его. Токен, скопированный после установки, нужно защитить теми же правами. Для публичных releases он не нужен.

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

Контейнерные данные находятся в `proanima-arkvory_storage` и `proanima-arkvory_catalog`, а не в host data. Не запускайте `down --volumes` на установленном хранилище. Профиль имеет фиксированные Compose project и порт, одна установка на container host. Нельзя подключать второго writer к той же БД/root.

Примеры используют `node`; при отсутствии в PATH укажите поставленный `runtime/node-v24.21.0-<platform>/bin/node` (Linux) либо `runtime/node-v24.21.0-win-x64/node.exe`. Выполняйте команды с правами администратора (для Compose без повышения — от пользователя, установившего его):

```bash
node /opt/proanima-arkvory/manage.mjs status --root /opt/proanima-arkvory
node /opt/proanima-arkvory/manage.mjs update --root /opt/proanima-arkvory
node /opt/proanima-arkvory/manage.mjs configure --root /opt/proanima-arkvory --disable-updates
node /opt/proanima-arkvory/manage.mjs configure --root /opt/proanima-arkvory --pin
node /opt/proanima-arkvory/manage.mjs configure --root /opt/proanima-arkvory --unpin --enable-updates
```

Новые установки подключают уведомления и минутный обработчик команд. Проверка stable GitHub Releases выполняется каждые 6 часов, даже при выключенной автоустановке. `--automatic` / `-AutomaticUpdates` включает установку в окно 03:00–03:59 UTC на всех платформах; час меняется в консоли → Обновления. Не более одной попытки за сутки UTC, без догоняющего запуска вне окна. Pin запрещает плановую смену версии. Ручной выбор: `update --version 1.2.3`; downgrade запрещён. На хостах без системного планировщика его подключает оператор. [Уведомления, подключение существующих установок, API и восстановление](../docs/UPDATES.md).

Linux: `systemctl status arkvory-api arkvory-worker arkvory-backup`, `journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup`, updater — `journalctl -u arkvory-update`; лимиты journald задаются в ОС. Windows: Services и logs с ротацией по 20 MiB, пять архивов; вывод задачи `ProAnimaArkvoryUpdate` (запуск без консоли) пишется в `logs/updater.log` с той же ротацией. Строки deploy CLI имеют формат `<ISO-8601> INFO|WARN|ERROR <текст>`, секреты редактируются. Поля JSON-журнала API/worker и метрики: [CORE_RUNBOOK](../docs/CORE_RUNBOOK.md#журналы-метрики-и-корреляция). Docker: Compose logs, JSON logs ограничены 20 MiB × 5. Сбой процесса вызывает restart через 10 секунд у нативных служб, у Docker — по политике движка. Неуспешная readiness сама по себе не вызывает restart: мониторинг отдельно сообщает о недоступной БД, потере ownership и дисковых ошибках. [Матрица автозапуска, восстановления и обязательных проверок](../docs/SERVICE_RECOVERY.md) отдельно описывает зависимость Docker от запуска движка и ограничения Linux без systemd.

## Обновление и восстановление

Сначала проверяется полный релиз: SHA-256, безопасные пути ZIP и лимиты распаковки; для Compose заранее строится образ. Затем останавливаются агент резервных копий, worker и API с пределом 120 секунд, переключается версия, запускаются API, worker, затем агент, и проверяется readiness API/worker. Агент в readiness не входит: если он не сообщил о себе за ~90 секунд, печатается WARN, обновление не откатывается. При той же схеме миграции не запускаются, возможен автоматический rollback. Старый код, ключи, конфигурация, volumes и данные сохраняются. Это обновление с перерывом, не HA/rolling update; клиентам нужны resume/retry.

Изменение схемы требует offline backup БД и полного storage root, проверки восстановления и migration notes. После этого:

```bash
node /opt/proanima-arkvory/manage.mjs upgrade --root /opt/proanima-arkvory --version 1.2.3 --backup-record /secure/backup-2026-09-25.txt
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
node artifacts/0.1.0/arkvory-setup.mjs install --root /opt/proanima-arkvory --mode compose --artifact artifacts/0.1.0
```

Ту же последовательность для Compose выполняет `npm run deploy:compose -- --root <dir>`. Нативная локальная установка требует --config и административных прав. Артефакты рабочего дерева — для проверки; production выпускает workflow с tested commit. `Prepare stable release` работает только с main: read-only job выполняет полный release gate и собирает один candidate; приёмка Windows/Linux и контейнеров использует именно его. Отдельный publish job проверяет SHA-256 всех assets и совпадение commit/version, не пересобирает и не запускает артефакт, затем создаёт tag и draft. Только он имеет contents:write. Публикация draft владельцем делает версию доступной автообновлению. Неполный draft после ошибки upload нельзя публиковать. Повтор с существующим tag отказывает: разберите сбой, не заменяйте опубликованную версию.

`release-checksums.json` связывает runtime, bootstrap, командные установщики и два комплекта с одной версией/коммитом. Это контроль целостности, не независимая цифровая подпись. Передача candidate между jobs требует доступной квоты GitHub Actions artifacts. При нехватке места workflow блокирует выпуск; переключения на непроверенную пересборку или пропуска приёмки нет.

Гейты `deployment`, `deployment-services`, `deployment-containers` проверяют соответственно переносимый runtime, настоящий crash/restart трёх изолированных служб (API, worker, агент резервных копий с vault через drop-in/ACL) и Docker install/migrate/копию/update с сохранением volume. Service gate требует Windows Administrator либо Linux/systemd и passwordless sudo; container gate — Docker/Compose без уже установленного проекта proanima-arkvory. На Linux он запускает `install.sh --mode compose`, на Windows-хосте с Docker Desktop (Linux containers) — `install.ps1 -Mode compose` от пользователя Docker Desktop, без повышения прав: `npm run gate -- deployment-containers`. Они обязательны в CI и verify/release; отсутствие инфраструктуры не считается pass. Двухсерверный HA остаётся стендовой проверкой.

Архитектура: [ADR 0031](../docs/adr/0031-release-installation-and-supervision.md). Supervisor: [systemd](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html), [WinSW](https://github.com/winsw/winsw/blob/v2.12.0/doc/xmlConfigFile.md), [Docker](https://docs.docker.com/engine/containers/start-containers-automatically/).
