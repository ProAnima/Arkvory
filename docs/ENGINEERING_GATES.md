# Архитектура, комментарии и гейты

## Команды

Node.js 24, npm 11. Установка: npm ci --ignore-scripts.

| Команда                     | Состав                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------- |
| npm run gate:list           | Доступные профили и отдельные гейты                                                   |
| npm run gate -- quick       | Политики, форматирование, TS, lint, границы, сборка, unit + governance                |
| npm run gate -- verify      | quick + audit + PostgreSQL/HTTP + браузер + упаковка/службы/контейнеры/native install |
| npm run gate -- release     | verify + full и multipart передача 5 GiB с отказами                                   |
| npm run gate -- integration | Политики, сборка, PostgreSQL/HTTP                                                     |
| npm run gate -- browser     | Политики, сборка, консоль, скачивания, обновления и Remote Setup                      |
| npm run gate -- large       | Политики, сборка, оба сценария 5 GiB                                                  |
| npm run gate -- security    | npm audit, high/critical блокируют                                                    |

Отдельные гейты поставки: `deployment`, `deployment-services`, `deployment-containers`, `native-package`, `native-install`, `deployment-stand`, `deployment-nas`, `deployment-ha`, `deployment-ha-power`, `deployment-ha-operations`, `deployment-ha-three`, `large-full`, `large-multipart` (требования к хосту — в таблице ниже). Можно передать несколько имён: npm run gate -- unit integration. Зависимости выполняются один раз, задания — последовательно. Старые npm test, test:integration, test:browser, test:large и check вызывают тот же runner. npm run build остаётся командой сборки для разработки, без заявления о прохождении тестов.

### Быстрый цикл разработки

Во время работы запускайте нужный функциональный gate, затем один `quick` после законченного изменения. Объединяйте независимые наборы одной командой, например `npm run gate -- quick integration browser`: policy и чистая сборка выполняются один раз. Повторный полный прогон нужен после новых изменений, ошибки или незакрытого риска; уже успешные проверки без причины не дублируем. Обязательные `verify`/`release` перед merge/выпуском сохраняются.

Unit-файлы выполняются в двух изолированных Node-процессах; coverage, JUnit, deadlines и ошибки сохраняются. Параметр `concurrency` задаётся в реестре гейтов, допускает 1–4 процесса только для node-test. Наборы с общей БД допускают только 1: standalone advisory lock запрещает параллельное использование. Увеличение параллелизма требует проверки изоляции файлов, портов и ресурсов, а не привязки к числу CPU.

В CI `large-full` и `large-multipart` работают одновременно на отдельных runner’ах с собственными PostgreSQL и дисками. Обе строки матрицы обязательны для результата `large`; governance проверяет точный состав и запрещает обход через exclude/условный шаг. Локальный `large` остаётся последовательным. Это уменьшает время ожидания, но добавляет одну подготовку runner’а и сборку к расходу CI-минут.

Native jobs в check/release кэшируют только `.cache/native-downloads`: архивы внешних зависимостей, ключ — OS/архитектура/хеш списка закреплённых зависимостей. SHA-256 проверяется при каждом использовании, включая cache hit; повреждение завершает gate ошибкой. Кэш не содержит секретов, БД, результатов тестов или готового Arkvory. При cache miss выполняется обычная загрузка. Установка, обновление и удаление каждый раз проверяются заново. Механизм кэша: [actions/cache](https://github.com/actions/cache).

Базовый замер до оптимизации: [CI 36175085277](https://github.com/ProAnima/Arkvory/actions/runs/36175085277), commit `adeaa81`, GitHub-hosted runners, 2026-09-25: large — 445 с, Windows native — 399 с, Linux native — 279 с, integration — 150 с. Локальный Windows/Node 24.13: quick около 63 с, из них unit около 18 с. Это отдельные наблюдения; время runner’ов и внешних загрузок меняется. Эффект кэша оценивается отдельно на холодном и прогретом запуске; timestamps каждого gate сохраняются в отчётах.

Для локальной БД: npm run test:db:up, скопировать .env.test.example в .env.test, затем npm run test:browser:install и npm run gate -- verify. Docker Compose открывает отдельную БД только на 127.0.0.1:54329. Остановка: npm run test:db:stop; том сохраняется. Никогда не направлять тесты на production. Гейты читают .env.test, существующие переменные окружения имеют приоритет. ARKVORY_BROWSER_CHANNEL=msedge допускается для явной локальной проверки Edge; CI использует Chromium из зафиксированной версии Playwright.

Мастер Remote Setup проверяется существующими unit/browser/deployment/native-install gates. В browser добавлен отдельный сценарий форм и обеих тем; native-install проверяет реальный shell/stdin, готовность служб и консоль через loopback SSH на одноразовых Windows/Linux runner’ах. Это не заменяет приёмку с настоящим OpenSSH и сетевой инфраструктурой площадки.

### Локальный запуск на Windows и Linux

Команды одинаковы на обеих ОС; на Windows запускайте их из PowerShell через npm. Отсутствие указанного ресурса — ошибка gate, не пропуск.

| Gate                    | Windows                                                                                                                        | Linux                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `quick`, `security`     | Node.js 24, npm 11; security — доступ к npm registry                                                                           | то же                                                                                                                                                                          |
| `integration`           | `npm run test:db:up` (Docker), `.env.test` из `.env.test.example`                                                              | то же                                                                                                                                                                          |
| `browser`               | как integration + `npm run test:browser:install`                                                                               | то же (`--with-deps` ставит системные библиотеки)                                                                                                                              |
| `large`                 | как integration + ≥ 11 GiB свободного temp                                                                                     | то же                                                                                                                                                                          |
| `deployment`            | Windows PowerShell 5, Git for Windows (`%ProgramFiles%\Git\bin\bash.exe` для `bash -n`), `%SystemRoot%\System32\tar.exe`       | tar, bash, pwsh                                                                                                                                                                |
| `deployment-services`   | PowerShell от администратора                                                                                                   | systemd и passwordless sudo                                                                                                                                                    |
| `deployment-containers` | Docker Desktop в режиме Linux containers, запуск от пользователя Docker Desktop (повышение прав не нужно), свободный порт 8080 | Docker Engine + Compose v2, пользователь группы docker, curl, python3, свободный порт 8080                                                                                     |
| `native-package`        | загрузка закреплённых зависимостей в `.cache/native-downloads`                                                                 | то же + dpkg-deb, rpmbuild                                                                                                                                                     |
| `native-install`        | только одноразовый runner: ставит службы и пакеты                                                                              | то же                                                                                                                                                                          |
| `deployment-stand`      | не выполняется (Linux-контейнеры с systemd)                                                                                    | Docker Engine, привилегированные контейнеры с systemd, сеть до GitHub (последний релиз для обновления)                                                                         |
| `deployment-nas`        | не выполняется                                                                                                                 | только одноразовый runner: модули ядра `cifs`, `nfs`, `nfsd` и привилегированные контейнеры с systemd                                                                          |
| `deployment-ha*`        | не выполняется                                                                                                                 | только одноразовый runner с KVM: libvirt, гостевые ВМ с DRBD 9 и Pacemaker, `fence_virsh` через SSH к хосту; базовый образ гостя строит `scripts/ha-base-image.mjs` (ADR 0072) |

`deployment-containers` требует, чтобы на движке не было проекта `proanima-arkvory` (контейнеров и volumes): gate удаляет свои volumes и не трогает чужую установку. Он скачивает проверенный Node.js 24.21.0 с nodejs.org, как поставляемый установщик. Пример для Windows: `npm run gate -- quick deployment deployment-containers`; для Linux CI-эквивалент Quality — `npm run gate -- quick deployment deployment-services`.

Для large нужно не менее 11 GiB свободного temp. Suites с одной БД не запускать одновременно даже из разных checkout: standalone advisory lock действует на всю БД. Локальный lock .cache/gates.lock содержит PID; после аварии сначала убедиться, что процесс завершён, затем удалить только этот файл. При ошибке гейт останавливается; не делает retry, skip или карантин.

## Расширение

1. Unit-тесты: `tests/*.test.mjs`; PostgreSQL: `tests/integration/**/*.test.mjs`. Новые файлы подхватываются автоматически. Исполняемые тесты пишутся только как `.mjs`: policy отклоняет `.js`, `.cjs`, `.ts` и другие файлы в tests вне `tests/fixtures/` (кроме `.md`), потому что ни один gate их не запустит.
2. Новый scenario зарегистрировать entries/kind/needs/timeoutSeconds в config/gates.json. Добавить в обязательные профили и соответствующее CI-задание. Если helper запускается дочерним процессом, вне графа import, внести его в spawnedHelpers с объяснением в review. Policy требует, чтобы имя такого helper встречалось в коде, достижимом из gate; иначе запись в реестре считается сокрытием сироты. Любой `tests/**/*.mjs`, не достижимый из gate через import или spawnedHelpers, блокирует policy.
3. Новое рабочее пространство зарегистрировать в config/architecture.json, разрешить минимальные зависимости и публичный index; порядок обязан быть топологическим.
4. Проверить не только успешный путь, но наблюдаемую ошибку, отмену, повтор, конфликт и освобождение ресурсов, применимые к сценарию. Контрактные тесты должны использовать реальную реализацию порта.

Новое CI-задание должно входить в needs итогового verdict и по умолчанию обязательно. Итог проверяет все полученные результаты, включая будущие задания. Все обязательные CI-гейты должны входить и в локальный verify; release охватывает весь реестр. Единственное условное задание — large, обязательное при выпуске.

Отчёты: test-results/architecture.json, test-results/gates/*.json (commit, dirty, платформа, время и статусы), JUnit для Node suites, stdout coverage, browser screenshots и отчёты large. CI всегда публикует отчёт гейта в logs и job summary, включая failed/not_run. Архив test-results со скриншотами и JUnit включается repository variable ARKVORY_UPLOAD_ARTIFACTS=true и хранится семь дней даже при ошибке тестов. На 2026-09-25 квота GitHub Artifact storage исчерпана; архивирование оставлено выключенным, тесты и сводки обязательны. При включённой опции ошибка архивирования не скрывается. Не включать секреты, реальные пользовательские данные или дампы окружения в артефакты.

## Лимиты и комментарии

Лимиты 500/300/100 относятся к строкам с кодом в файле/классе/функции, включая вложенные конструкции. Один перенос не должен маскировать несколько ответственностей. При превышении сначала выделить сценарий, адаптер или связную функцию, сохранив смысл и тесты. Избегать механического дробления и передачи скрытого mutable context.

Комментарии объясняют причину и инвариант: границу транзакции, ownership ресурса, порядок lock/cleanup, почему повтор безопасен, поведение при отмене, совместимость с legacy. Для публичного порта описывать неоднозначные гарантии и обязанности вызывающего кода. Не требуются комментарии, повторяющие имя простого метода.

Отступление требует ADR, owner, точного потолка, регрессии, срока ≤90 дней и рядом с кодом arkvory-exception ARCH-NNN -- причина. config/architecture-exceptions.json — временный реестр, не средство автоматического принятия роста. Просроченные, безымянные, неиспользуемые или выросшие исключения блокируют гейт. Не ослаблять правила и не обновлять fixtures ради зелёной сборки.

## CI и merge

Required check для main: Arkvory merge gate. Он проверяет quality на Ubuntu 22.04/24.04 и Windows Server 2022/2025, native install на Ubuntu 24.04/Windows Server 2022, integration, browser, security и deployment-containers. Missing/failed/cancelled/skipped любого обязательного задания блокирует итог, включая отсутствие контейнерной lane. Все jobs работают на образах с явной версией; `*-latest` запрещён policy. Состав lanes и текущее состояние биллинга Actions: [CI](CI.md). Большие передачи обязательны для main push, v-тегов, merge queue и еженедельной проверки (понедельник 02:20 UTC); ручной запуск поддерживает large_transfers. Обычный PR может пропустить только large. Публикация v-тега не является публикацией релиза/артефакта. Настройки branch protection живут в GitHub и проверяются отдельно от YAML.

На 2026-09-25 API GitHub для закрытого ProAnima/Arkvory возвращает 403 на branch protection и rulesets с требованием GitHub Pro. Поэтому запрет merge через настройки сервера пока недоступен; зелёный Arkvory merge gate — обязательное правило процесса. После включения подходящего тарифа назначить его required status для main и требовать актуальную ветку. Публичность проприетарного репозитория ради обхода ограничения менять нельзя.

Изменения config, CI, policy scripts и исключений должны получать архитектурный review. PR описывает поведение, инварианты, фактически выполненные гейты и невыполненные проверки. Система не заменяет review и не гарантирует отсутствие будущего рефакторинга.

## Проверки поставки и служб

В verify/release обязательны deployment (переносимый production artifact), deployment-services (реальный restart трёх изолированных служб — API, worker, агент резервных копий — после crash, Linux/systemd + sudo либо Windows Administrator) и deployment-containers (настоящий Docker install/update с сохранением volume). Quality CI запускает упаковку и службы на Windows/Linux, отдельная обязательная lane проверяет контейнеры. Локально отсутствующие права/движок — непройденный gate; нельзя выдавать quick за полный verify. Подробности и ограничения: [развёртывание](../deploy/README.md).

Quality вызывается одной командой `npm run gate -- quick deployment deployment-services`: общие зависимости выполняются один раз, отчёт охватывает весь набор. Deployment проверяет целостность комплектов автоматизации и синтаксис PowerShell/Bash. Для проверки пакетов нужны tar, Bash и PowerShell (pwsh на Linux; Windows PowerShell 5 и Git Bash на Windows). На Windows упаковка и проверки вызывают `%SystemRoot%\System32\tar.exe` (bsdtar) по абсолютному пути: GNU tar из Git читает `C:\...` как удалённый `host:path`, поэтому порядок PATH не влияет на результат (`scripts/tar.mjs`).

Контейнерная приёмка запускает поставляемый установщик из распакованного комплекта, включая загрузку проверенного Node.js: на Linux `install.sh --mode compose` из `Arkvory-Linux.tar.gz`, на Windows `install.ps1 -Mode compose` из `Arkvory-Windows.zip` (Docker Desktop, Linux containers). Далее одинаково: migrate, round-trip mailbox updater, `configure --backup-vault` с bind mount и копия через API, crash/restart API/worker/backup/PostgreSQL по restart policy, обновление с сохранением volume и vault, `down --volumes`. Windows-прогон без повышения прав не регистрирует SYSTEM updater; при повышенных правах gate удаляет задачу `ProAnimaArkvoryUpdate`, только если она указывает на его временный корень. [ADR 0050](adr/0050-windows-compose-engine-user.md).

Обязательная native lane: `npm run gate -- native-install`. Зависимость `native-package` собирает реальные EXE/DEB/RPM с проверенными компонентами; установка разрешена только на одноразовых Actions runners. Проверяются readiness, непривилегированная роль БД, Windows owner login, повторная установка без замены секретов, удаление с сохранением кластера. Linux дополнительно проверяет RPM в Fedora 44 с systemd. Для локальной проверки без установки служб: `npm run gate -- native-package`. Это не заменяет native-install. [ADR 0033](adr/0033-native-installers-and-guided-setup.md).

Release workflow разделён на read-only build, read-only acceptance четырёх ОС и отдельный publish с contents:write. Candidate собирается один раз; `ARKVORY_RELEASE_ARTIFACT` указывает гейтам проверять переданный артефакт вместо новой сборки. Publisher проверяет полный manifest хешей и тот же commit, не устанавливает зависимости и не исполняет candidate. Квота Actions artifacts необходима для передачи между jobs: при её исчерпании выпуск блокируется. Обычные диагностические архивы CI по-прежнему включаются через ARKVORY_UPLOAD_ARTIFACTS; отчёты всегда остаются в логах/summary. [ADR 0032](adr/0032-tested-release-bundles.md).
