---
title: Командная строка (arkvoryctl)
---

# Командная строка (arkvoryctl)

`arkvoryctl` — удалённый клиент Arkvory для людей и CI/CD. Он загружает и скачивает файлы по частям, продолжает передачу после прерываний и проверяет SHA-256. Он работает с правами того ключа, который вы ему дадите.

## Установка {#install}

| Система                                          | Пакет                       | Как установить                                                                                                                                                         |
| ------------------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows 10/11, Windows Server 2019+ (x64)        | `Arkvory-CLI-Setup-x64.exe` | Запустите его. Он устанавливает программу для текущего пользователя, без прав администратора, и добавляет `arkvoryctl` в `PATH` пользователя. Откройте новый терминал. |
| Debian, Ubuntu (x64)                             | `Arkvory-CLI-amd64.deb`     | `sudo apt install ./Arkvory-CLI-amd64.deb`                                                                                                                             |
| Fedora, RHEL-совместимые (x64)                   | `Arkvory-CLI-x86_64.rpm`    | `sudo dnf install ./Arkvory-CLI-x86_64.rpm`                                                                                                                            |
| Любая система с Node.js 24 (например, раннер CI) | `arkvoryctl.mjs`            | `node ./arkvoryctl.mjs --help`                                                                                                                                         |

Нативные пакеты содержат собственный Node.js. У отдельного файла `arkvoryctl.mjs` нет зависимостей от npm. Берите файлы из надёжного релиза `ProAnima/Arkvory` и сверяйте их SHA-256 с `release-checksums.json`. Пакетов для ARM64 пока нет. Чтобы обновить клиент, установите более новый стабильный релиз. При удалении ваши профили, файлы ключей и контрольные точки сохраняются.

## Подключение к серверу {#connect-to-a-server}

1. Получите ключ: персональный токен доступа в консоли или ключ сервиса у администратора. См. [Учётные записи и ключи](../use/accounts).
2. Сохраните ключ в закрытом файле вне любого репозитория с исходным кодом. В Linux задайте режим `0600`. В Windows разрешите доступ только вашей учётной записи.
3. Добавьте профиль и проверьте подключение:

```bash
arkvoryctl profile add production --server https://arkvory.example --token-file "$HOME/.secrets/arkvory.key" --repository releases
arkvoryctl doctor
arkvoryctl repositories
```

```powershell
arkvoryctl profile add production --server https://arkvory.example --token-file C:\Private\arkvory.key --repository releases
arkvoryctl doctor
```

`doctor` показывает сервер, репозиторий, возможности и права ключа. Ключ никогда не передаётся аргументом команды.

## Профили и окружение {#profiles-and-environment}

Профили хранятся в файле `profiles.json` в `~/.config/arkvory` (в Windows — в `.config\arkvory` в папке пользователя). Профиль хранит URL сервера, репозиторий по умолчанию и **путь** к файлу ключа, но не сам ключ.

| Команда                                                                 | Действие                                                                                                   |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `profile add NAME --server URL [--token-file PATH] [--repository NAME]` | Добавляет профиль. Первый профиль становится профилем по умолчанию. Репозиторий по умолчанию — `releases`. |
| `profile list`                                                          | Показывает все профили и активный                                                                          |
| `profile use NAME`                                                      | Делает профиль профилем по умолчанию                                                                       |
| `profile remove NAME`                                                   | Удаляет профиль                                                                                            |

| Переменная           | Значение                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_TOKEN`      | Сам ключ. Приоритетнее любого файла.                                                                                                           |
| `ARKVORY_TOKEN_FILE` | Путь к файлу ключа. Приоритетнее файла профиля.                                                                                                |
| `ARKVORY_BASE_URL`   | URL сервера. Если переменная задана, файл ключа из профиля **не** используется: передайте ключ через `ARKVORY_TOKEN` или `ARKVORY_TOKEN_FILE`. |
| `ARKVORY_CLI_HOME`   | Другая папка для `profiles.json`                                                                                                               |

URL сервера должен использовать HTTPS. Обычный HTTP разрешён только для `localhost`, `127.0.0.1` и `[::1]`. Проверку TLS отключить нельзя.

## Общие параметры {#global-options}

| Параметр                    | По умолчанию     | Значение                                                                                                     |
| --------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `--profile NAME`            | активный профиль | Профиль только для этой команды                                                                              |
| `--repository NAME`         | из профиля       | Репозиторий только для этой команды                                                                          |
| `--json`                    | выкл.            | Один компактный результат JSON в stdout; ошибки в виде JSON в stderr                                         |
| `--lang en` или `--lang ru` | из `LANG`        | Язык справки и сообщений                                                                                     |
| `--timeout MS`              | 60000            | Предел для управляющих запросов (от 1 до 3600000)                                                            |
| `--attempt-timeout MS`      | 120000           | Предел для одной попытки передачи (от 1 до 1800000)                                                          |
| `--retries N`               | 20               | Повторы при сбоях сети для одной операции (от 0 до 100); `0` отключает их                                    |
| `--verbose`                 | выкл.            | Одна строка в stderr на каждый HTTP-запрос: метод, путь, статус, время, ID запроса. Без заголовков и ключей. |
| `--help`, `--version`       |                  | Справка; версия клиента в виде JSON                                                                          |
| `--`                        |                  | Завершает параметры; нужен для имён файлов, начинающихся с `-`                                               |

Каждый параметр можно указать один раз. Неизвестные параметры отклоняются.

## Команды {#commands}

### Сведения и каталог {#discovery-and-catalog}

| Команда                                                                    | Результат                                              |
| -------------------------------------------------------------------------- | ------------------------------------------------------ |
| `doctor`                                                                   | Подключение, возможности и права                       |
| `repositories [--after CURSOR]`                                            | Репозитории, видимые ключу                             |
| `operations [--after CURSOR]`                                              | Операции API, доступные в репозитории                  |
| `list [--after CURSOR]`                                                    | Артефакты репозитория                                  |
| `search [--query TEXT] [--label TAG] [--collection NAME] [--after CURSOR]` | Поиск по имени и тексту метаданных                     |
| `search --metadata-key KEY --metadata-value VALUE`                         | Точное совпадение метаданных (передайте оба параметра) |
| `inspect ID`                                                               | Метаданные одного артефакта                            |
| `storage usage` / `storage policy`                                         | Занятое место репозитория и политика хранения          |

Страницы возвращают `next`. Передайте это значение в `--after`, чтобы прочитать следующую страницу.

### Передачи {#transfers}

| Команда                                                                        | Результат                                                                                                      |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `upload FILE [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]`   | Возобновляемая загрузка любого файла                                                                           |
| `download ID OUTPUT`                                                           | Возобновляемое скачивание с проверкой SHA-256                                                                  |
| `put FILE PATH [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]` | Загружает файл и делает его следующей версией пути. Если путь уже содержит те же байты, ничего не загружается. |
| `get PATH OUTPUT`                                                              | Скачивает текущую версию пути с проверкой, возобновляемо                                                       |
| `link ID [--ttl SECONDS]`                                                      | Ссылка для скачивания без ключа, действует от 60 секунд до 24 часов (по умолчанию 1 час)                       |
| `uploads status ID` / `uploads cancel ID`                                      | Состояние сессии загрузки; отмена сессии (отмена — это не пауза)                                               |

`METADATA.json` содержит `labels` и `metadata` (словарь строк). Он приоритетнее `--label`.

```bash
arkvoryctl put "./Build/Game Setup.exe" builds/game/1.4/GameSetup.exe
arkvoryctl get builds/game/1.4/GameSetup.exe ./GameSetup.exe
arkvoryctl link 00000000-0000-4000-8000-000000000001 --ttl 900
```

Ссылка на скачивание — это секрет. Её нельзя отозвать до истечения срока.

### Пакеты и продвижение {#packages-and-promotion}

| Команда                                                                                                               | Результат                                                             |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `packages list [--group G] [--name N] [--after CURSOR]`                                                               | Пакеты UPack                                                          |
| `packages publish FILE [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]`                                | Загружает архив UPack и регистрирует его                              |
| `packages register ID`                                                                                                | Регистрирует уже загруженный UPack                                    |
| `packages resolve NAME [--group G] [--exact V] [--range R] [--stage S] [--prerelease] [--order promoted]`             | Выбирает версию (`--exact` и `--range` взаимно исключают друг друга)  |
| `packages download NAME OUTPUT [те же фильтры]`                                                                       | Выбирает версию, затем скачивает её с проверкой                       |
| `promote ID --to REPOSITORY [--move] [--stage S1,S2] [--comment TEXT]`                                                | Публикует артефакт в другом репозитории без повторной отправки байтов |
| `stages list ID` / `stages add ID STAGE [--comment TEXT]` / `stages remove ID STAGE` / `stages artifacts [--stage S]` | Стадии артефактов                                                     |
| `promotions history ID` / `promotions journal [--after CURSOR]`                                                       | История продвижений                                                   |

```bash
arkvoryctl packages publish ./build.upack --label test --state ./job-state/build.json --json
arkvoryctl promote 00000000-0000-4000-8000-000000000001 --to prod --stage release
arkvoryctl packages download app ./app.upack --range ^1.4 --stage release
```

Для точной версии используйте `--exact`; `--version` выводит версию клиента. См. [Пакеты](../use/packages) и [Продвижение](../use/promotion).

### Аннотации и вложения {#annotations-and-attachments}

`annotations get ID` и `annotations set ID --revision N --file ANNOTATIONS.json` читают и заменяют метки, метаданные и коллекции. `attachments get ID`, `attachments history ID` и `attachments set ID --revision N --file ATTACHMENTS.json` делают то же для вложений сборки. Сначала прочитайте, затем отправьте полное новое состояние с номером ревизии, который вы прочитали. Параллельное изменение возвращает конфликт (код выхода 6).

### Резервные копии {#backups}

| Команда                                                           | Результат                                                                                                  |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `backup status`                                                   | Хранилище копий, агент, план, последняя точка, предупреждения; код выхода 9 при критическом предупреждении |
| `backup run`                                                      | Ставит задание резервного копирования в очередь                                                            |
| `backup jobs [--after CURSOR]` / `backup points [--after CURSOR]` | Задания и точки восстановления, сначала новые                                                              |
| `backup verify POINT_ID`                                          | Ставит в очередь полную проверку точки                                                                     |
| `backup pin POINT_ID [--off]`                                     | Сохраняет точку сверх правил хранения или снимает закрепление                                              |

Этим командам нужен файловый ключ владельца установки (bootstrap) или сессия администратора. Персональные токены и ключи сервисов получают 403 (код выхода 3). Работу выполняет агент резервного копирования сервера. Пример для мониторинга: `arkvoryctl backup status --json || alert`. См. [Резервные копии](../operate/backups).

## Продолжение прерванных передач {#resume-interrupted-transfers}

После Ctrl+C или сбоя сети снова запустите **ту же команду с теми же параметрами**.

- `upload`, `put` и `packages publish` хранят контрольную точку рядом с исходным файлом: `<файл>.arkvory-upload.json` или файл, заданный через `--state`. Она сохраняет ключ идемпотентности до первого запроса, поэтому потерянный ответ никогда не создаст вторую копию.
- Чтобы опубликовать те же байты как **новый** артефакт, используйте новый файл `--state`.
- `download` и `get` хранят `<выходной файл>.arkvory-part` и `<выходной файл>.arkvory-download.json` рядом с выходным файлом. Итоговый файл появляется только после проверки SHA-256. Существующий выходной файл никогда не перезаписывается.
- В CI создайте папку состояния до начала задания и сохраняйте её вместе с исходным файлом между повторными запусками.

Храните контрольные точки на локальном диске с поддержкой жёстких ссылок (NTFS, ext4, XFS), а не на FAT, exFAT или в сетевых папках. После аварийного завершения остаётся файл `.lock`. Убедитесь, что процесс с указанным в нём PID остановлен, затем удалите только файл `.lock`.

## Пример для CI {#ci-example}

```bash
# Ключ берётся из хранилища секретов CI. Никогда не выводите его.
export ARKVORY_BASE_URL=https://arkvory.example
export ARKVORY_TOKEN_FILE=/run/secrets/arkvory-key
mkdir -p job-state
node ./arkvoryctl.mjs packages publish ./build.upack --label test --state ./job-state/upload.json --json
```

Если регистрация не удалась после загрузки, ошибка JSON содержит `stage: "register"` и `artifactId`. Повторите ту же команду. Повторная регистрация того же артефакта безопасна.

### Системы CI {#ci-systems}

Все системы ниже делают одно и то же: ставят закреплённый `arkvoryctl.mjs`, берут ключ из хранилища секретов системы и запускают одну команду. Закрепите версию и SHA-256, чтобы изменённая загрузка прерывала задание. Используйте ключ сервиса, ограниченный репозиторием и действиями, которые нужны заданию ([Учётные записи и ключи](../use/accounts)). На агенте нужен Node.js 24.

```yaml
# GitHub Actions: .github/workflows/publish.yml
name: publish
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    env:
      ARKVORY_BASE_URL: https://arkvory.example
      ARKVORY_TOKEN: ${{ secrets.ARKVORY_KEY }}
      ARKVORY_CLI_VERSION: '0.3.0'
      ARKVORY_CLI_SHA256: 555af7e66e25447ba17ea0d3dc676f6d04b4b8adc47818d8c8bb548085752504
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: Install arkvoryctl
        run: |
          curl -fsSL -o arkvoryctl.mjs "https://github.com/ProAnima/Arkvory/releases/download/v${ARKVORY_CLI_VERSION}/arkvoryctl.mjs"
          echo "${ARKVORY_CLI_SHA256}  arkvoryctl.mjs" | sha256sum -c -
      - name: Publish the build
        run: node ./arkvoryctl.mjs put ./Build/Game.zip "builds/game/${GITHUB_REF_NAME}/Game.zip" --json
```

```yaml
# GitLab CI: .gitlab-ci.yml (ARKVORY_TOKEN is a masked CI/CD variable)
publish:
  image: node:24
  variables:
    ARKVORY_BASE_URL: https://arkvory.example
    ARKVORY_CLI_VERSION: '0.3.0'
    ARKVORY_CLI_SHA256: 555af7e66e25447ba17ea0d3dc676f6d04b4b8adc47818d8c8bb548085752504
  script:
    - curl -fsSL -o arkvoryctl.mjs "https://github.com/ProAnima/Arkvory/releases/download/v${ARKVORY_CLI_VERSION}/arkvoryctl.mjs"
    - echo "${ARKVORY_CLI_SHA256}  arkvoryctl.mjs" | sha256sum -c -
    - node ./arkvoryctl.mjs put ./Build/Game.zip "builds/game/${CI_COMMIT_TAG}/Game.zip" --json
```

```groovy
// Jenkins: Jenkinsfile. The agent has Node.js 24 and a checked arkvoryctl.mjs, installed as above.
pipeline {
  agent any
  environment {
    ARKVORY_BASE_URL = 'https://arkvory.example'
    ARKVORY_TOKEN = credentials('arkvory-key')
  }
  stages {
    stage('Publish') {
      steps {
        sh 'node ./arkvoryctl.mjs put ./Build/Game.zip "builds/game/${BUILD_NUMBER}/Game.zip" --json'
      }
    }
  }
}
```

Любая другая система, например TeamCity или Buildkite, работает так же: задайте `ARKVORY_BASE_URL` и `ARKVORY_TOKEN` из её хранилища секретов и запустите команду. Решение принимайте по [коду выхода](#exit-codes).

## Вывод {#output}

- Результаты выводятся в stdout в формате JSON. Без `--json` JSON выводится с отступами. Команды резервного копирования печатают читаемые строки, если не добавить `--json`.
- Ход выполнения показывается только в интерактивном stderr.
- Ошибка без `--json` — это одна строка в stderr с кодом сервера, причиной, сообщением, следующим шагом и ID запроса. С `--json` в stderr выводится `{"error": {...}}` с полями `code`, `exitCode`, `status`, `serverCode`, `reason`, `requestId` и `retryAfterSeconds`. Если код неизвестен, ориентируйтесь на `exitCode`.

## Коды выхода {#exit-codes}

| Код | Значение                                                                                        |
| --- | ----------------------------------------------------------------------------------------------- |
| 0   | Успех                                                                                           |
| 2   | Неверные аргументы или настройка                                                                |
| 3   | Нет ключа или доступ запрещён (401, 403)                                                        |
| 4   | Ошибка HTTP или сети, тайм-аут, сервер занят, не найдено                                        |
| 5   | Нарушение целостности (несовпадение SHA-256, 422 `integrity_mismatch`)                          |
| 6   | Конфликт: ревизия, состояние, блокировка, существующий файл, изменённая контрольная точка (409) |
| 7   | Ошибка локального файла или недопустимый ответ сервера                                          |
| 8   | Достигнут предел ёмкости сервера: квота, диск, очередь (507 `capacity_exceeded`)                |
| 9   | `backup status`: действует критическое предупреждение о резервных копиях                        |
| 130 | Прервано                                                                                        |

Клиент повторяет запрос только при сбоях сети и ответах HTTP 408, 429, 502, 503 и 504, в пределах `--retries`.

## Устранение неполадок {#troubleshooting}

| Сообщение                             | Причина и решение                                                                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `credential_required` (код 3)         | Ключ не найден. Проверьте `--token-file`, `ARKVORY_TOKEN_FILE` или задайте ключ, если используется `ARKVORY_BASE_URL`.                   |
| `forbidden` (код 3)                   | У ключа нет нужного права. Выполните `doctor`, чтобы увидеть права.                                                                      |
| `checkpoint_mismatch` (код 6)         | Файл, сервер, репозиторий или параметры отличаются от сохранённой контрольной точки. Используйте исходные параметры или новый `--state`. |
| `state_locked` (код 6)                | Контрольную точку использует другой процесс или после сбоя остался старый `.lock`.                                                       |
| `destination_exists` (код 6)          | Выходной файл существует. Выберите другое имя.                                                                                           |
| `revision_mismatch` при `put` (код 6) | За это время кто-то изменил путь. Проверьте историю пути и решите, что делать.                                                           |
| код 8                                 | Квота или диск заполнены. Обратитесь к администратору.                                                                                   |

## Связанные страницы {#related-pages}

- [Клиенты и протоколы](./index)
- [Передачи](../use/transfers) и [Файлы по пути](../use/files)
- [TypeScript SDK](./sdk)
- [Ошибки](../api/errors)
