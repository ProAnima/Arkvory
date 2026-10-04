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
| 6         | Конфликт ревизии, состояния, блокировки, существующий файл (`conflict`, 409) / Conflict                                       |
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

`arkvoryctl attachments get ID` показывает текущую ревизию; `attachments set ID --revision N --file attachments.json` заменяет полный список. `attachments history ID` показывает последние изменения. Типы: `manifest`, `sbom`, `signature`, `report`, `file`. CLI обновляет аннотации и ссылки Arkvory; байты опубликованного UPack остаются неизменными. Чтобы встроить данные в `upack.json`, сформируйте архив перед загрузкой согласно [описанию сборок](BUILD_DETAILS.md).

Read current annotations or attachments, then submit the complete replacement with `--revision`. Conflicts never silently overwrite another client's changes. Upload attachment files first and reference their artifact IDs. Arkvory annotations do not rewrite an immutable published UPack archive.

## Обрывы, продолжение и восстановление

Повторите ту же команду после Ctrl+C или сетевого сбоя. Upload хранит `<source>.arkvory-upload.json` (либо `--state`), включая idempotency key до первого запроса; готовая квитанция остаётся для безопасного повторения. Для **новой** публикации тех же байтов используйте новый `--state`. Просроченную/отменённую сессию нельзя продолжить: создайте новую с новым state. `uploads status ID` и `uploads cancel ID` управляют серверной сессией; `cancel` не является паузой.

Download хранит `<output>.arkvory-part` и `<output>.arkvory-download.json`. На продолжении читает префикс и проверяет итоговый SHA-256. Части синхронизируются на диск блоками 8 МиБ, публикация происходит после успешной проверки. Непроверенный файл не становится конечным результатом. Повреждённый префикс сбрасывается после integrity failure; повтор команды скачает заново. Конечный файл не перезаписывается: выбирайте другое имя или переместите старый самостоятельно.

Локальные каталоги должны быть доступны на запись, на одном диске с результатом; рекомендуются NTFS/ext4/XFS. Для атомарной публикации нужны hard links (FAT/exFAT не поддерживаются). Чекпойнты рассчитаны на локальный диск одного клиента, не на параллельную работу через NFS/SMB. После аварийного завершения `.lock` остаётся: проверьте PID из lock и отсутствие активной передачи, затем удалите **только** lock. Staging и state оставьте для продолжения. Если авария произошла уже после публикации hard link, конечный файл проверен; оставшиеся sidecars можно удалить после остановки процесса.

Repeat the same command after interruption. Upload receipts make repeated publication idempotent; use a new `--state` for a new publication. Downloads resume from local staging and publish only after SHA-256 verification. Destinations are never overwritten. Hard crashes leave a lock intentionally: confirm the owning process is stopped before removing only the lock. Keep staging/checkpoints for recovery. Use a local filesystem with hard-link support.

## Границы и развитие

Команды чтения: `doctor`, `repositories`, `operations`, `list`, `search`, `inspect`, `packages list`, `annotations get`, `attachments get/history`, `storage usage/policy`, `uploads status`. Запись: `upload`, `packages publish`, `packages register`, `annotations set`, `attachments set`, `uploads cancel`. Download потоковый, с bounded retries и backpressure SDK. Клиент не обходит ACL и не управляет сервисами ОС.

Создание ключей/пользователей, destructive retention и настройка topology пока остаются в административном API/UI. Полный каталог: [API_MAP](API_MAP.md). Архитектура и проверки: [ADR 0034](adr/0034-remote-client-cli.md). Гейты: `npm run gate -- quick`, `integration`, `deployment`, `native-install` (последний только disposable CI runner). Публикация — только после release gates.
