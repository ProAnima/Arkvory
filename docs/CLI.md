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
arkvoryctl upload ./build.upack --label test
arkvoryctl packages register ARTIFACT_ID
arkvoryctl download ARTIFACT_ID ./downloaded.upack
```

`upload` принимает обычный файл или UPack. Регистрация UPack в каталоге пакетов — явный `packages register`; некорректный архив остаётся доступным как обычный файл. Профиль по умолчанию выбирается при добавлении первого профиля, затем `profile use NAME`. Разовый выбор: `--profile NAME`; смена репозитория: `--repository NAME`. Список/удаление: `profile list`, `profile remove NAME`.

Get a scoped key from your administrator, keep it in a private file, add a profile and run `doctor`. Upload ordinary files or UPack archives; `packages register ID` indexes a published UPack. Use `--profile` and `--repository` for a single command, or `profile use NAME` to change the default. `--help --lang en|ru` explains all commands.

## CI/CD и формат вывода

```sh
# Значения поступают из secret store CI; не печатать их в логи.
export ARKVORY_BASE_URL=https://arkvory.example
export ARKVORY_TOKEN_FILE=/run/secrets/arkvory-key
node ./arkvoryctl.mjs upload ./build.upack --state ./job-state/upload.json --json
```

Каталог `job-state` нужно создать заранее и сохранять между повторами job вместе с исходным файлом. Содержимое/полный путь исходного файла, endpoint, репозиторий и параметры публикации должны совпадать. `ARKVORY_TOKEN` имеет приоритет над файлом; `ARKVORY_TOKEN_FILE` — над ссылкой в профиле. При `ARKVORY_BASE_URL` CLI **не использует** token file профиля: передайте CI-ключ явно через окружение. `ARKVORY_CLI_HOME` меняет каталог профилей (по умолчанию `~/.config/arkvory`).

`--json`: один JSON-результат в stdout, JSON-ошибка в stderr, exit code определяет успех. stdout не содержит прогресса. Без JSON результат форматируется, прогресс появляется только в интерактивном stderr. Ответы постраничные: `next` передаётся через `--after`; клиент не накапливает весь каталог в памяти. Опции не повторяются, неизвестные/неподходящие опции отклоняются. Имена файлов с дефисом передавайте после `--`.

Для медленных сетей: `--attempt-timeout 300000` задаёт окно одной попытки передачи в миллисекундах (1..1800000); `--retries 20` — общий бюджет сетевых повторов операции (0..100). `--timeout 60000` ограничивает запросы управления (1..3600000 мс). Общего ограничения по времени всего файла нет; синхронное завершение upload имеет отдельное окно SDK до 30 минут. `--retries 0` отключает автоматические сетевые повторы, сохраняя возможность повторить команду вручную.

| Exit code | Значение / Meaning                                                    |
| --------- | --------------------------------------------------------------------- |
| 0         | Успех / Success                                                       |
| 2         | Аргументы или конфигурация / Usage or configuration                   |
| 3         | Нет ключа, 401/403 / Missing credential or access denied              |
| 4         | HTTP, сеть, request timeout / HTTP or network failure                 |
| 5         | Целостность / Integrity failure                                       |
| 6         | Конфликт ревизии, состояния, блокировки, существующий файл / Conflict |
| 7         | Локальный I/O или недопустимый протокол / Local I/O or protocol error |
| 130       | Прерывание / Interrupted                                              |

CI should inject `ARKVORY_BASE_URL` and `ARKVORY_TOKEN_FILE` (or `ARKVORY_TOKEN`) through its secret store. Never pass a key as a command argument. Preserve the upload checkpoint and source file across retries. JSON output is machine-readable; diagnostics use stderr. Pagination is explicit with `--after`. HTTPS is mandatory except for loopback; TLS verification cannot be disabled.

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

Команды чтения: `doctor`, `repositories`, `operations`, `list`, `search`, `inspect`, `packages list`, `annotations get`, `attachments get/history`, `storage usage/policy`, `uploads status`. Запись: `upload`, `packages register`, `annotations set`, `attachments set`, `uploads cancel`. Download потоковый, с bounded retries и backpressure SDK. Клиент не обходит ACL и не управляет сервисами ОС.

Создание ключей/пользователей, destructive retention и настройка topology пока остаются в административном API/UI. Полный каталог: [API_MAP](API_MAP.md). Архитектура и проверки: [ADR 0034](adr/0034-remote-client-cli.md). Гейты: `npm run gate -- quick`, `integration`, `deployment`, `native-install` (последний только disposable CI runner). Публикация — только после release gates.
