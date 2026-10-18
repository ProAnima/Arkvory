# Arkvory CLI — arkvoryctl

Самостоятельный клиент удалённого Arkvory для разработчиков, операторов и CI/CD. Сервер может находиться на другой машине. Команды используют права переданного ключа; доступные операции показывает `operations`, права — `doctor`.

## Установка / Installation

| Система / System                     | Комплект / Package          | Установка / Install                                                                                                              |
| ------------------------------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Windows 10/11, Server 2019+ x64      | `Arkvory-CLI-Setup-x64.exe` | Открыть EXE, установить для текущего пользователя, открыть новый терминал / Run the per-user installer, then open a new terminal |
| Debian/Ubuntu x64                    | `Arkvory-CLI-amd64.deb`     | Открыть в менеджере пакетов либо `sudo apt install ./Arkvory-CLI-amd64.deb`                                                      |
| Fedora/RHEL-compatible x64           | `Arkvory-CLI-x86_64.rpm`    | Открыть в менеджере пакетов либо `sudo dnf install ./Arkvory-CLI-x86_64.rpm`                                                     |
| CI с Node.js 24 / CI with Node.js 24 | `arkvoryctl.mjs`            | `node ./arkvoryctl.mjs --help`                                                                                                   |

Нативные установщики включают private Node.js. CLI не устанавливает PostgreSQL или службы сервера; Linux package manager разрешает системные библиотеки. Windows EXE не требует administrator/UAC; добавляет команду в пользовательский PATH. Существующий терминал нужно открыть заново. `arkvoryctl.cmd` внутри установки — command shim, не установщик. Подпись EXE пока не настроена.

Артефакты формируются release pipeline; этот документ не означает, что публичный релиз уже опубликован. Брать их следует из доверенного релиза `ProAnima/Arkvory` и сверять SHA-256 с `release-checksums.json` / `native-*.json`. Обновление клиента: повторная установка выбранного стабильного релиза. Профили, ключи и чекпойнты не удаляются при удалении приложения. Не обновляйте runtime во время активных передач.

Native packages bundle Node.js and require no Arkvory server installation. Windows installs per user; Linux uses the package manager for system libraries. The standalone `arkvoryctl.mjs` has no npm dependencies at runtime and requires Node.js 24. Release checksums cover every client artifact. Reinstall a selected stable release to update; profiles survive uninstall. Native targets currently support x64; ARM64 is not yet packaged.

## Первое подключение / First connection

Для новой удалённой машины клиентские пакеты также включают графический **Arkvory Remote Setup**: проверка SSH, установка стабильного релиза и автоматический локальный туннель. Для уже установленного сервера мастер открывает доступ без переустановки. [Мастер и требования](REMOTE_DEPLOYMENT.md).

Получите ограниченный ключ у администратора Arkvory и сохраните в приватный файл вне репозитория. На Linux: права `0600`, на Windows: ACL только для владельца/администратора. CLI не копирует ключ в свой конфиг и не выводит его.

```powershell
arkvoryctl profile add production --server https://arkvory.example --token-file C:\Private\arkvory.key
arkvoryctl doctor --lang ru
arkvoryctl repositories
arkvoryctl list --repository releases
```

```sh
arkvoryctl profile add production --server https://arkvory.example --token-file "$HOME/.secrets/arkvory.key"
arkvoryctl doctor
arkvoryctl packages publish ./build.upack --label test
arkvoryctl download ARTIFACT_ID ./downloaded.upack
arkvoryctl put "./Build/Game Setup.exe" builds/game/1.4/GameSetup.exe
arkvoryctl get builds/game/1.4/GameSetup.exe ./GameSetup.exe
```

`put FILE PATH` загружает файл частями, с чекпойнтом рядом с файлом, и делает его следующей ревизией пути. Если по пути уже лежат те же байты, загрузки нет: повтор шага сборки ничего не стоит. Путь, изменённый кем-то другим, не перезаписывается (`revision_mismatch`). `get PATH OUTPUT` скачивает текущую ревизию с докачкой и проверкой SHA-256. Без CLI тот же путь доступен одним запросом: `curl -T file -H "Authorization: Bearer $KEY" https://…/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe` ([ADR 0064](adr/0064-raw-files-by-path.md)).

`upload` принимает обычный файл или UPack. `packages publish FILE` последовательно загружает файл и регистрирует UPack. `packages register ID` остаётся для уже загруженного артефакта. Некорректный архив остаётся доступным как обычный файл; команда публикации завершается ошибкой. Профиль по умолчанию выбирается при добавлении первого профиля, затем `profile use NAME`. Разовый выбор: `--profile NAME`; смена репозитория: `--repository NAME`. Список/удаление: `profile list`, `profile remove NAME`.

Get a scoped key from your administrator, keep it in a private file, add a profile and run `doctor`. Use `packages publish FILE` to upload and register UPack in one command, or `upload FILE` for ordinary files; `packages register ID` indexes an existing artifact. Use `--profile` and `--repository` for a single command, or `profile use NAME` to change the default. `--help --lang en|ru` explains all commands.

## Ссылка на скачивание / Download link

```sh
arkvoryctl link ARTIFACT_ID --ttl 3600
# {"url":"https://arkvory.example/api/v1/repositories/releases/artifacts/…/content?token=dtl_…","expiresAt":"…"}
curl -fL -o build.upack "$URL"
```

Ссылка открывает содержимое одного артефакта без ключа до `expiresAt` (60 с – 24 ч, по умолчанию час). Сама ссылка — секрет: передавайте её как ключ и не публикуйте; сервер её не журналирует, но журналы вашего прокси и история браузера могут сохранить. Отозвать раньше срока нельзя — выдавайте короткие ссылки ([ADR 0062](adr/0062-download-links.md)).

A link downloads one artifact without a key until `expiresAt` (60 s to 24 h, one hour by default). Treat it as a secret; it cannot be revoked early.

## CI/CD и формат вывода

```sh
# Значения поступают из secret store CI; не печатать их в логи.
export ARKVORY_BASE_URL=https://arkvory.example
export ARKVORY_TOKEN_FILE=/run/secrets/arkvory-key
node ./arkvoryctl.mjs packages publish ./build.upack --state ./job-state/upload.json --json
```

Каталог `job-state` нужно создать заранее и сохранять между повторами job вместе с исходным файлом. Содержимое/полный путь исходного файла, endpoint, репозиторий и параметры публикации должны совпадать. `ARKVORY_TOKEN` имеет приоритет над файлом; `ARKVORY_TOKEN_FILE` — над ссылкой в профиле. При `ARKVORY_BASE_URL` CLI **не использует** token file профиля: передайте CI-ключ явно через окружение. `ARKVORY_CLI_HOME` меняет каталог профилей (по умолчанию `~/.config/arkvory`).

`--json`: один JSON-результат в stdout, JSON-ошибка в stderr, exit code определяет успех. stdout не содержит прогресса. Без JSON результат форматируется, прогресс появляется только в интерактивном stderr. Ответы постраничные: `next` передаётся через `--after`; клиент не накапливает весь каталог в памяти. Опции не повторяются, неизвестные/неподходящие опции отклоняются. Имена файлов с дефисом передавайте после `--`.

Для медленных сетей: `--attempt-timeout 300000` задаёт окно одной попытки передачи в миллисекундах (1..1800000); `--retries 20` — общий бюджет сетевых повторов операции (0..100). `--timeout 60000` ограничивает запросы управления (1..3600000 мс). Общего ограничения по времени всего файла нет; синхронное завершение upload имеет отдельное окно SDK до 30 минут. `--retries 0` отключает автоматические сетевые повторы, сохраняя возможность повторить команду вручную.

### Коды выхода

| Exit code | Значение / Meaning                                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 0         | Успех / Success                                                                                                               |
| 2         | Аргументы или конфигурация / Usage or configuration                                                                           |
| 3         | Нет ключа, 401/403 (`unauthorized`, `forbidden`) / Missing credential or access denied                                        |
| 4         | HTTP, сеть, request timeout, перегрузка (`busy`, `rate_limited`, `unavailable`, `internal`, 404) / HTTP, network or busy      |
| 5         | Целостность: SHA-256 скачивания или `integrity_mismatch` (422) / Integrity failure                                            |
| 6         | Конфликт ревизии, состояния, блокировки, существующий файл (`conflict`, 409); курсор событий истёк (`gone`, 410) / Conflict   |
| 7         | Локальный I/O или недопустимый протокол / Local I/O or protocol error                                                         |
| 8         | Лимит ёмкости сервера: квота, диск, учётные записи, ключи, очередь (`capacity_exceeded`, 507) / Server capacity limit reached |
| 9         | `backup status`: активно критическое предупреждение резервирования / A critical backup warning is active                      |
| 130       | Прерывание / Interrupted                                                                                                      |

Код выхода выбирается по `code` ответа сервера, а для ответа без конверта Arkvory (прокси) — по HTTP-статусу. Exit 8 введён в [ADR 0051](adr/0051-error-contract.md); раньше 507 и 422 давали 4. При 429/503 CLI печатает задержку из `Retry-After`; автоматически повторяются только сетевые сбои и 408/429/502/503/504 в пределах `--retries`.

Ошибка без `--json` — одна строка stderr: код CLI, HTTP-статус, `code/reason` и сообщение сервера (без управляющих символов, до 200 знаков), что делать дальше, «Retry after N s» и ID запроса для обращения к администратору. С `--json` stderr содержит `{"error": {...}}`: прежние `code` (`http_error` для ответов сервера), `status`, `exitCode`, `stage`, `artifactId` и добавленные `serverCode`, `reason`, `message`, `requestId`, `details` (`[{field, problem}]`) и `retryAfterSeconds`. Неизвестные будущие `serverCode`/`reason` нужно обрабатывать по `exitCode`.

`--verbose` пишет в stderr строку на каждый HTTP-обмен: `arkvoryctl: GET /api/v1/... 200 12 ms request <id>` (или `network-error`). Заголовки, query, тела и ключи не выводятся.

The error line on stderr carries the server code/reason, its sanitized message, the next step, Retry-After and the request ID; `--json` keeps the previous fields and adds `serverCode`, `reason`, `message`, `requestId`, `details` and `retryAfterSeconds`. Exit code 8 means a server capacity limit (507); 422 integrity mismatches exit with 5. `--verbose` logs method, path, status, duration and request ID per request, never headers or credentials.

CI should inject `ARKVORY_BASE_URL` and `ARKVORY_TOKEN_FILE` (or `ARKVORY_TOKEN`) through its secret store. Never pass a key as a command argument. Preserve the upload checkpoint and source file across retries. JSON output is machine-readable; diagnostics use stderr. Pagination is explicit with `--after`. HTTPS is mandatory except for loopback; TLS verification cannot be disabled.

## Публикация UPack одной командой

`arkvoryctl packages publish ./build.upack --label test --state ./job-state/build.json --json` выполняет resumable upload и регистрацию сервером. Параметры `--file`, `--repository`, timeout/retries и прогресс совпадают с `upload`. Архив уже должен содержать `upack.json`; команда не создаёт ZIP и не переписывает байты.

Успех возвращает `{ artifactId, package, checkpoint }` только после подтверждения регистрации. Это два шага, а не общая транзакция: при отказе регистрации загруженный артефакт сохраняется. JSON-ошибка содержит `stage: "register"`, `artifactId` и исходный exit code/HTTP status. Повторите **ту же команду с теми же параметрами**: checkpoint возвращает прежний upload, а повтор регистрации того же artifact ID идемпотентен. Потеря ответа после регистрации не создаёт новую версию. Конфликт другой публикации той же версии возвращает 409; она не перезаписывается.

`packages publish FILE` uploads and registers an existing UPack archive. Keep the checkpoint and repeat the same command after interruption or a lost response. A registration error identifies the already uploaded artifact; it is not automatically deleted. The command succeeds only when both stages are confirmed. Archive creation and manifest editing remain separate operations.

## Резервные копии / Backups

Команды требуют системного права `backup.read` (`status`, `jobs`, `points`) или `backup.manage` (`run`, `verify`, `pin`): их имеет администратор учётных записей (сессия) или файловый ключ владельца/bootstrap; ключ репозитория получает 403 и exit 3. Выполняет копии агент сервера ([ADR 0056](adr/0056-unattended-backups.md)); CLI только ставит задания и читает состояние.

| Команда                          | Результат                                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `backup status`                  | Vault, агент, план, последняя точка, следующий запуск, текущее задание, предупреждения; exit 9 при critical |
| `backup run`                     | Ставит копию; новый ключ идемпотентности на каждый вызов; вывод — задание `{id, kind, state}`               |
| `backup jobs [--after CURSOR]`   | Задания новыми первыми; `next` для следующей страницы                                                       |
| `backup points [--after CURSOR]` | Точки новейшим T первым: размер, проверка, закрепление                                                      |
| `backup verify POINT_ID`         | Ставит глубокую проверку точки (читаются все байты)                                                         |
| `backup pin POINT_ID [--off]`    | Закрепляет точку сверх retention или снимает закрепление                                                    |

Без `--json` вывод — строки для человека на языке `--lang` (байты в двоичных единицах, время ISO UTC); с `--json` stdout содержит ровно объект ответа API (`BackupStatus`, `{items, next}`, задание или точку). Пример мониторинга: `arkvoryctl backup status --json || alert` — exit 9 означает активное critical-предупреждение (`agent_offline`, `backup_stale`, `vault_unavailable`, `verify_failed`), остальные коды — как в таблице выше.

`backup status|run|jobs|points|verify ID|pin ID [--off]` reads and queues instance backups through `client.backup`; the server's backup agent executes them. Text output is human-readable, `--json` prints the API object. `backup status` exits 9 while a critical warning is active.

## События / Events

`arkvoryctl events tail [--after ID] [--types T,PREFIX.*] [--repository R] [--limit N] [--follow] [--cursor-file PATH]` читает ленту событий установки ([ADR 0080](adr/0080-event-integrations.md)): по CloudEvent в строке stdout (JSON Lines), без итогового объекта. Начало — `--after`, иначе курсор из `--cursor-file`, иначе самое старое хранимое событие. Курсор (`{"cursor": "<epoch>:<position>"}`) пишется атомарно после каждого события и в конце страницы, поэтому повтор команды продолжает без пропусков; событие может повториться, если процесс прервали между выводом и записью курсора. Без `--follow` команда завершается, дойдя до новейшего события; с `--follow` ждёт новых до Ctrl+C (exit 130). `--repository` здесь фильтр, а не репозиторий профиля. Курсор старше `oldest` (410) или прежней эпохи после восстановления сервера (409) — exit 6, `reason` в stderr.

`events tail` prints the installation's events as JSON lines and keeps the cursor in `--cursor-file`; `--follow` waits for new ones until Ctrl+C. An expired cursor or a restored server exits with 6.

## Продвижение и выбор версии / Promotion and version selection

`promote ID --to REPOSITORY [--move] [--stage S1,S2] [--comment TEXT]` публикует артефакт в другом репозитории без повторной передачи байтов; повтор возвращает ту же копию. `stages list|add|remove|artifacts` управляет стадиями, `promotions history ID` и `promotions journal [--after N]` читают журнал. `packages resolve NAME` и `packages download NAME OUTPUT` выбирают версию по `--exact`, `--range`, `--stage`, `--prerelease` и `--order promoted`; скачивание идёт по выбранному artifact ID с проверкой SHA-256 и продолжением. Права и правила: [PROMOTION](PROMOTION.md).

`promote` publishes an artifact in another repository without re-sending bytes; repeating it returns the same copy. `packages download app ./app.upack --range ^1.4 --stage release` resolves the version first and then performs a verified, resumable download by artifact ID.

## Поиск / Search

`search --query TEXT` ищет регистронезависимую подстроку в имени и значениях актуальных метаданных. `%` и `_` — обычные символы, не wildcard. Дополнительные метки/коллекции объединяются через AND.

```sh
arkvoryctl search --query build-42 --label staging
arkvoryctl search --metadata-key commit --metadata-value abc123
```

`--metadata-key` и `--metadata-value` передаются вместе и задают точное, регистрозависимое равенство. Пустая строка значения допустима. Лимиты: ключ 64, значение 1024, общий текст 240 символов; до 100 результатов, продолжение через `--after`. Каждый результат содержит `id`, `name`, `size` (десятичная строка), `createdAt`, `publishedAt`, текущие `labels` и `stages`. UI и SDK предоставляют те же фильтры. Поиск использует актуальную annotation, а не скрытые старые значения upload descriptor. Substring search may scan the repository; this is not an indexed full-text engine. Exact metadata filters are case-sensitive and must be supplied as a key/value pair.

`search --all` ищет во всех репозиториях, где у ключа есть `artifact.list` (без фильтра — не больше первых 1000 по имени; названные в `--repositories` проверяются напрямую), через `GET /api/v1/search` ([ADR 0081](adr/0081-mcp-and-agent-skill.md), этап A1). Фильтры: `--query`, `--repositories R1,R2` (до 100), `--label L1,L2` (до 8, нужны все), `--stage`, `--limit` (1–100, по умолчанию 50), `--after` — непрозрачный курсор `next`. Порядок: время публикации (сначала новые), затем репозиторий и ID. Каждый результат — тот же элемент, что у `search`, плюс `repository`. Репозиторий без права в `--repositories` пропускается так же, как несуществующий.

```sh
arkvoryctl search --all --query build-42 --label release --limit 20
```

## MCP для ИИ-агентов / MCP for AI agents

`arkvoryctl mcp [--root DIR] [--max-output-bytes N] [--write [--write-repositories R1,R2]]` — MCP-сервер на stdin/stdout для клиента агента, который запускает его дочерним процессом (этапы M1–M3 [ADR 0081](adr/0081-mcp-and-agent-skill.md)). Сетевого слушателя нет; все вызовы идут через SDK к API с ключом профиля или окружения (те же правила, что у `connection()`), сервер проверяет права как обычно. Запросы несут `Arkvory-Client: arkvoryctl-mcp/<версия>`.

```sh
claude mcp add arkvory -- arkvoryctl mcp --profile production --root ~/work
claude mcp add arkvory-publish -- arkvoryctl mcp --profile ci --root ~/work --write --write-repositories builds
```

- Инструменты только чтения: `arkvory_repositories`, `arkvory_search` (общий поиск), `arkvory_artifacts`, `arkvory_artifact` (дескриптор, стадии, аннотации и вложения при `annotation.read`), `arkvory_packages` (список и `resolve`), `arkvory_files` (страница путей или история пути; обе продолжаются `after` = `next`), `arkvory_history` (лента `R/changes`), `arkvory_status` (возможности, HA, зеркала, резервные копии, площадки; недоступный раздел — `forbidden`), `arkvory_download`. Инструменты, которые ключ заведомо не может выполнить (по `GET /api/v1/auth/permissions`), не регистрируются.
- Запись — только с `--write` (без него инструментов записи нет совсем): `arkvory_upload` (файл из корня как новый артефакт или, с `repositoryPath`, как следующая ревизия пути; те же байты по пути не загружаются, `created: false`), `arkvory_publish_package` (UPack: загрузка и регистрация), `arkvory_promote` (стадия; с `sha256` — только если у артефакта ровно эти байты), `arkvory_stage_remove`, `arkvory_annotate` (метки и/или metadata при `expectedRevision`; не переданное поле и коллекции остаются). Каждый — только при соответствующих правах ключа (загрузка — `upload.create`, `upload.read`, `upload.write` и `upload.complete`; UPack — ещё `package.publish`; `artifact.promote`; `annotation.read` и `annotation.write`). Подсказки: загрузка и публикация — не destructive и не idempotent; `promote` — idempotent; `stage_remove` и `annotate` — destructive. Удаления, восстановления ревизий, ссылок `dtl_` и администрирования нет никогда.
- `--write-repositories R1,R2` (до 100 имён, только вместе с `--write`) проверяется до запроса: запись в другой репозиторий — `repository_not_allowed`, на сервер ничего не уходит; права ключа сервер проверяет как обычно. Инструкции сервера требуют от агента подтверждения пользователя перед каждой записью.
- Источник записи — обычный файл внутри `--root`: те же правила `realpath`, что у скачивания (ссылка наружу, каталог, устройство, FIFO — `path_outside_root`; нет файла — `file_not_found`). После проверки файл открывается (в POSIX с `O_NOFOLLOW` и `O_NONBLOCK`), открытый дескриптор сверяется с путём (тот же device/inode, путь по-прежнему ведёт к нему), и все байты читаются только через этот дескриптор. Файл, укоротившийся при чтении, — `source_changed`. Файл, содержащий ключ в любом месте, не отправляется (`source_contains_credential`): ключ ищется в том же проходе, что считает SHA-256. Собственные файлы CLI — каталог `ARKVORY_CLI_HOME` (профили, чекпойнты) и файл ключа — инструменты не читают и не заменяют даже внутри корня (`private_path`), и для загрузки, и для `arkvory_download`.
- Загрузка возобновляется: чекпойнт лежит в `<ARKVORY_CLI_HOME>/mcp-uploads/` (не рядом с файлом) и назван по серверу, репозиторию, реальному пути, размеру, SHA-256, меткам и metadata. Повтор того же вызова продолжает ту же загрузку или возвращает тот же артефакт по тому же ключу идемпотентности; изменённый файл или другие метки — новая загрузка. Если загрузка из чекпойнта прошлого вызова уже не завершится (истекла, отменена, сборка не удалась), чекпойнт удаляется и загрузка один раз начинается заново. При запуске `--write` удаляются чекпойнты старше 30 дней и сверх 1000 новейших; занятый (с `.lock`) не трогается. `state_locked` после аварии процесса: убедитесь, что `arkvoryctl mcp` с этой загрузкой не работает, и удалите `.lock` в `mcp-uploads/`. Результат — квитанция сервера (без пути чекпойнта), `size` и `sha256` прочитанного файла. Квитанция, не совпадающая с прочитанными байтами, — `integrity_mismatch`, и на ней не строятся ни регистрация UPack, ни ревизия пути. Если не подтвердилась только регистрация UPack, ошибка содержит `stage: "register"` и `artifactId`.
- `arkvory_download` пишет только внутри `--root` (по умолчанию текущий каталог): путь разрешается через `realpath`, ссылка за корень, каталог, устройство и FIFO отклоняются (`path_outside_root`). В Windows имя устройства (`NUL`, `COM1`…), поток (`a:b`), запрещённые символы и имя с точкой или пробелом в конце — `invalid_path`. Байты идут во временный файл `.arkvory-<uuid>.part` рядом с целью, размер и SHA-256 сверяются (SDK и повторно CLI), затем hard link (без `overwrite`) или rename (с `overwrite: true`). Место проверяется ещё раз перед открытием временного файла, после открытия и перед переименованием (тот же файл, каталог без подмены на ссылку). При ошибке временный файл удаляется. `maxBytes` отклоняет больший артефакт до передачи.
- Результат — `structuredContent` по `outputSchema` и текстовый блок со сводкой и тем же JSON (для клиентов, читающих только текст); весь сериализованный результат (с экранированием JSON внутри текста) не больше `--max-output-bytes` (по умолчанию 65536, 4096–1048576). Списки — до 100 элементов; страница, не помещающаяся в лимит, обрезается так, что `next` продолжает сразу после последнего возвращённого элемента. Если не помещается даже один элемент, строки сокращаются до 256 символов; если и так нельзя сохранить курсор — `output_too_large`, а не досрочный конец списка. `truncated: true` отмечает обрезку и сокращение.
- Управляющие и невидимые символы в чужих строках (C0/C1, нулевой ширины, двунаправленные, блок тегов U+E0000–E007F, BOM, одиночные суррогаты) заменяются пробелом; сокращение не разрезает суррогатную пару; значение ключа и токены `dtl_…` заменяются на `[withheld]`. Ошибки — `isError: true` с кодом ADR 0051 (`code`, `reason`, `status`, `requestId`, `retryAfterSeconds`), без текста исключений, путей и адресов.
- Протокол MCP `2025-11-25` или `2025-06-18`; клиенту с более новой ревизией сервер отвечает `2025-11-25` (решение — за клиентом, как требует спецификация), клиент с более ранней ревизией получает ошибку -32602 со списком поддерживаемых версий.
- Тексты лицензий встроенных зависимостей — `MCP-LICENSES.txt` рядом с `arkvoryctl.mjs`.
- Навык для агентов (`SKILL.md` и `reference/`) лежит в клиентском пакете в `agent-skills/arkvory/` рядом с `arkvoryctl.mjs`. `arkvoryctl skill install [--target DIR] [--force]` копирует его в `~/.claude/skills/arkvory` (или в `DIR`) и пишет `.arkvory-skill.json` с SHA-256 установленных файлов. Файл, изменённый после прошлой установки, без `--force` не перезаписывается: установка останавливается до записи (`skill_modified`, exit 6). Файл, которого в новой версии навыка нет, удаляется, только если не изменён. Ссылки и каталоги на месте файлов навыка не перезаписываются (`skill_target_not_file`).

## Деревья каталогов / Directory trees

Базовая реализация `zip-tree` 1 бесплатного ядра ([ADR 0083](adr/0083-core-extension-points.md), N8, этапы Y13 и Y14). Код: `apps/cli/src/tree/`.

| Команда                                                                             | Результат                                                                                       |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `tree push DIR [--name NAME.zip] [--label TAG] [--file METADATA.json] [--compress]` | Каталог как один детерминированный ZIP, загрузка частями с чекпойнтом                           |
| `tree pull ID DIR`                                                                  | Пустой каталог — целый архив (T1); каталог с файлами — синхронизация по оглавлению (T2)         |
| `tree verify ID DIR`                                                                | `missing`, `mismatched`, `extra`, `counts`, `ok`; exit 5 при расхождении                        |
| `tree repair ID DIR`                                                                | Перезаписывает пропавшие и несовпавшие файлы; лишние остаются; `fetchedBytes` — сколько скачано |

- **push.** Обход без перехода по ссылкам; ссылка, junction, устройство, FIFO — `tree_entry_unsupported`; имена — по правилам дерева (ниже). Архив `.<каталог>.arkvory-tree.zip` рядом с каталогом: записи в порядке путей (кодовые точки), дата 1980-01-01, режим 0755 только при праве исполнения владельцем (POSIX), иначе 0644, флаг UTF-8 имён, `stored` без `--compress` (`deflate` с ним), ZIP64 при размере записи от 0xF0000000, смещении или числе записей сверх классических полей. Одно состояние каталога — одни байты и один SHA-256, поэтому повтор после обрыва продолжает ту же загрузку (обычный `upload` с чекпойнтом `<архив>.arkvory-upload.json`). После успеха архив и чекпойнт удаляются. Имя артефакта — `--name`, по умолчанию `<каталог>.zip`; оно обязано оканчиваться на `.zip` (`invalid_tree_name`): оглавление сервер строит для `.zip` и `.upack`. Пустые каталоги не сохраняются.
- **Оглавление (T2).** `GET …/artifacts/{id}/tree` постранично (`after`, до 1000); используется только `status: ready`; страницы с разным `archiveSha256` — `tree_changed`; неизвестный `method`, `pending`, `unavailable` и 404 `route_not_found` (старый сервер) — переход к целому архиву. Строки проверяются теми же правилами, что записи архива. Каждая запись скачивается диапазоном `dataOffset…dataOffset+dataLength-1` через `downloadRangeVerified` (ETag `sha256:<архив>`, диапазоны до 8 МиБ, один `Arkvory-Download-Id` на команду); `deflate` распаковывается zlib (пул потоков libuv). Режим файла оглавление не несёт: перезаписанный файл сохраняет режим прежнего, новый получает 0644.
- **Целый архив (T1).** `download` в `.<каталог>.arkvory-tree.zip` рядом с целью (продолжение по чекпойнту, проверка SHA-256 в SDK), затем собственный разбор ZIP (`zip-read.ts`, без сторонних пакетов): центральный каталог до 256 МиБ, ZIP64, только `stored`/`deflate` (`unsupported_method`), без шифрования и ссылок (`unsupported_entry`), имена без флага UTF-8 — только ASCII, до 100 000 файлов, данные записи не заходят в центральный каталог. `pull` распаковывает во временный каталог рядом с целью и ставит его на место цели (прежний каталог отодвигается `rename` и удаляется после замены); `verify` и `repair` считают SHA-256 записей из архива. Законченный архив без чекпойнта (прерванный запуск) скачивается заново; после команды он удаляется.
- **Запись файла** (`LocalTreeWriter`, `local-tree.ts`): временный `.<имя>.arkvory-<uuid>.tmp` рядом с целью, размер и SHA-256 (из оглавления) или CRC-32 (из архива) по ходу записи, `fsync`, `rename` поверх цели; несовпадение — `checksum_mismatch` (exit 5), цель не меняется. Каталог на месте файла — `path_conflict`. Оставшиеся временные файлы удаляет следующий `repair` или `pull`.
- **Правила путей** (`tree-paths.ts`, на всех системах): абсолютный путь, буква диска, обратная косая черта, пустой сегмент, `.` и `..` — `path_outside_root`; имя устройства Windows, `<>:"|?*`, управляющие символы, точка или пробел в конце — `unsafe_name`; повтор пути — `duplicate_entry`; пути, равные без учёта регистра, и файл-родитель другого пути — `case_collision`; до 1024 символов и 64 уровней. Каталог на пути к файлу проверяется `lstat`: ссылка — `path_outside_root`, по ней не идут.
- **pull в каталог с файлами (T2)** делает каталог деревом: сначала удаляются лишние пути (ссылка удаляется сама, не её цель), затем пишутся несовпавшие файлы. `repair` лишнее не трогает.

`tree push` packs a folder into one deterministic ZIP (stored entries, fixed timestamps) and uploads it resumably. With the server's table of contents, `verify` compares every file by SHA-256, and `repair`/`pull` fetch only the differing entries by verified ranges; without it, the whole archive is downloaded and verified first. Every file is written to a temporary file, checked and renamed; paths outside the folder and names Windows cannot hold are refused.

## Клиентские модули / Client modules

Подписанные пакеты `side: client` ([ADR 0079](adr/0079-extension-modules.md), п. 5.11, этап X5; [ADR 0078](adr/0078-open-core-modules-and-licenses.md), п. 3). Код: `apps/cli/src/modules/`.

| Команда                                                   | Результат                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `module install FILE [--yes] [--allow-stale-revocations]` | Проверка и показ модуля с условиями; с `--yes` установка (выключенным)         |
| `module list`                                             | Установленные модули, `enabledFor`, `revoked`, состояние списка отзыва         |
| `module enable ID [--profile NAME]`                       | Для всех профилей (`*`) или для одного                                         |
| `module disable ID [--profile NAME]`                      | Везде (`[]`) или для одного; у включённого везде — `module_enabled_everywhere` |
| `module remove ID`                                        | Удаляет пакет и запись                                                         |
| `module revocations FILE`                                 | Сохраняет подписанный список отзыва (меньший номер — `revocation_rollback`)    |

- **Хранение** — `<ARKVORY_CLI_HOME>/modules/`: `installed.json` (`format: 1`, по модулю `id`, `version`, SHA-256 архива, `keyId`, `kind`, `enabledFor`, `installedAt`), распакованные `<id>/<version>/`, `module-revocations.json`, `.staging/`. Одна версия на id; новая версия наследует `enabledFor`. Команда без профиля (CI с `ARKVORY_BASE_URL`) получает только модули с `enabledFor: "*"`.
- **Установка**: копия в `.staging`, `inspectModulePackage` с хостом `side: client` — только встроенные ключи модулей ProAnimaStudio (ключи операторов не принимаются; переменной окружения для ключей нет); пакет серверной стороны — `side_mismatch`; более новый список отзыва из пакета сохраняется; отозванная версия — `module_revoked`; без актуального списка — `stale_revocations`, если не задан `--allow-stale-revocations` (в результате `staleRevocations: true`).
- **Загрузка** — только для команд, которые переносят содержимое (`upload`, `download`, `put`, `get`, `packages publish|download`, `tree`), и только модулей, включённых для профиля. Порядок: права до чтения (каталог CLI, `modules/`, `installed.json`, список отзыва; затем каталоги до пакета и каждый файл пакета): без ссылок и junction, изменить может только пользователь (или root, или администраторы Windows) — POSIX: владелец и нет записи группе и прочим; Windows: владелец и правила ACL по той же классификации, что у загрузчика сервера (`unsafeForUser` в `signing`), проверка не запустилась — `module_access_unverified`, иначе `module_access`; `verifyInstalledModule` (подпись, файлы, совместимость), совпадение id, версии и ключа с `installed.json` (`installed_mismatch`), отзыв, `kind: transfer` (иначе `kind_unsupported`), затем `confinePackage` и единственный вычисляемый `import()` CLI (`module-import.ts`, `COMPUTED_IMPORTS`) с ограничением 10 с. Описание обязано совпасть с подписанным манифестом (`descriptor_mismatch`); `create(context)` получает только `signal` и `clientVersion`; вклад — до 16 `TransferExtension`, методы вызываются на объекте модуля, результаты проверяются (`contribution_invalid`). Отказ — строка `client module ID VERSION not loaded (code)` в stderr; команда продолжается без модуля.
- **Режим** — `--transfer auto|strict|core`: `auto` — SDK переходит к своей передаче, если расширение не подходит, отказалось или упало; `strict` — `transfer_unavailable` (exit 4); `core` — модули не загружаются. `--verbose` печатает `download via <name> v<N>` или `via core (extension declined|failed|incomplete)`.

Signed client packages are installed per user, start disabled and are enabled for every profile or for named ones. Only commands that move content load them, after the access check, signature and file hashes, revocation check, and with their code confined to the package directory. A refused module is reported and skipped; `--transfer` selects auto, strict or core.

## Метки, метаданные и вложения

Для начального upload: `--label test` либо `--file metadata.json`, содержащий `labels` и `metadata`. JSON имеет приоритет над `--label`. Метаданные — string-to-string map. Каналы `test`, `staging`, `release` — обычные метки, не встроенные неизменяемые статусы.

Для изменения: сначала `arkvoryctl annotations get ID`, затем подготовьте **полное** желаемое состояние:

```json
{
  "labels": ["staging", "linux"],
  "metadata": { "commit": "abc123", "pipeline": "build-42" },
  "collections": ["desktop"]
}
```

```sh
arkvoryctl annotations set ID --revision 3 --file annotations.json
arkvoryctl search --label staging --collection desktop
```

При конкурентном изменении сервер возвращает 409 (exit 6). CLI не повторяет запись с новой ревизией автоматически: перечитайте данные и согласуйте изменения.

Дополнительные файлы сначала загружаются обычным `upload`; затем прикрепляются к билду:

```json
[
  {
    "name": "manifest.json",
    "kind": "manifest",
    "artifactId": "00000000-0000-4000-8000-000000000001",
    "description": "Deployment manifest"
  }
]
```

`arkvoryctl attachments get ID` показывает текущую ревизию; `attachments set ID --revision N --file attachments.json` заменяет полный список; файл — просто JSON-массив элементов `[{name, kind, artifactId, description}]`, тогда как тело HTTP PUT — объект `{expectedRevision, items}` (ревизию CLI берёт из `--revision`). `attachments history ID` показывает последние изменения. Типы: `manifest`, `sbom`, `signature`, `report`, `file`. CLI обновляет аннотации и ссылки Arkvory; байты опубликованного UPack остаются неизменными. Чтобы встроить данные в `upack.json`, сформируйте архив перед загрузкой согласно [описанию сборок](BUILD_DETAILS.md).

Read current annotations or attachments, then submit the complete replacement with `--revision`. Conflicts never silently overwrite another client's changes. Upload attachment files first and reference their artifact IDs. Arkvory annotations do not rewrite an immutable published UPack archive.

## Обрывы, продолжение и восстановление

Повторите ту же команду после Ctrl+C или сетевого сбоя. Upload хранит `<source>.arkvory-upload.json` (либо `--state`), включая idempotency key до первого запроса; готовая квитанция остаётся для безопасного повторения. Для **новой** публикации тех же байтов используйте новый `--state`. Просроченную/отменённую сессию нельзя продолжить: создайте новую с новым state. `uploads status ID` и `uploads cancel ID` управляют серверной сессией; `cancel` не является паузой.

Download хранит `<output>.arkvory-part` и `<output>.arkvory-download.json`. На продолжении читает префикс и проверяет итоговый SHA-256. Части синхронизируются на диск блоками 8 МиБ, публикация происходит после успешной проверки. Непроверенный файл не становится конечным результатом. Повреждённый префикс сбрасывается после integrity failure; повтор команды скачает заново. Конечный файл не перезаписывается: выбирайте другое имя или переместите старый самостоятельно.

Локальные каталоги должны быть доступны на запись, на одном диске с результатом; рекомендуются NTFS/ext4/XFS. Для атомарной публикации нужны hard links (FAT/exFAT не поддерживаются). Чекпойнты рассчитаны на локальный диск одного клиента, не на параллельную работу через NFS/SMB. После аварийного завершения `.lock` остаётся: проверьте PID из lock и отсутствие активной передачи, затем удалите **только** lock. Staging и state оставьте для продолжения. Если авария произошла уже после публикации hard link, конечный файл проверен; оставшиеся sidecars можно удалить после остановки процесса.

Repeat the same command after interruption. Upload receipts make repeated publication idempotent; use a new `--state` for a new publication. Downloads resume from local staging and publish only after SHA-256 verification. Destinations are never overwritten. Hard crashes leave a lock intentionally: confirm the owning process is stopped before removing only the lock. Keep staging/checkpoints for recovery. Use a local filesystem with hard-link support.

## Границы и развитие

Команды чтения: `doctor`, `repositories`, `operations`, `list`, `search`, `inspect`, `packages list`, `annotations get`, `attachments get/history`, `storage usage/policy`, `uploads status`, `search --all`, `mcp` (только чтение и скачивание внутри `--root`). Запись: `upload`, `packages publish`, `packages register`, `annotations set`, `attachments set`, `uploads cancel`. Download потоковый, с bounded retries и backpressure SDK. Клиент не обходит ACL и не управляет сервисами ОС.

Создание ключей/пользователей, destructive retention и настройка topology пока остаются в административном API/UI. Полный каталог: [API_MAP](API_MAP.md). Архитектура и проверки: [ADR 0034](adr/0034-remote-client-cli.md). Гейты: `npm run gate -- quick`, `integration`, `deployment`, `native-install` (последний только disposable CI runner). Публикация — только после release gates.
