---
title: 'Docker Compose'
description: 'Запуск Arkvory как проекта Docker Compose: контейнеры, тома, порты, обновления, агент резервного копирования и удаление.'
---

# Docker Compose

Установка Compose запускает API, обработчик, агент резервного копирования и PostgreSQL как контейнеры на одном хосте. Установщик собирает образ Arkvory из релиза и запускает проект `proanima-arkvory`. Используйте её на хостах контейнеров. В Windows Docker Desktop подходит только для ознакомления: см. [Windows с Docker Desktop](#docker-desktop).

В Compose нет встроенного HTTPS. Прежде чем клиенты начнут подключаться с других компьютеров, поставьте перед ним обратный прокси-сервер: см. [HTTPS и обратный прокси-сервер](./https).

## Требования {#requirements}

| Параметр            | Требование                                                                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Движок              | Docker Engine с плагином Compose (`docker compose`). Podman с совместимым провайдером compose возможен с `--engine podman`, но не проверялся                                 |
| Пользователь        | `root` или пользователь из группы `docker`                                                                                                                                   |
| Запуск при загрузке | Движок контейнеров должен запускаться при загрузке, иначе Arkvory не вернётся после перезагрузки. Проверьте командой `systemctl is-enabled docker`                           |
| Хост                | Одна установка Arkvory на один хост контейнеров. Имя проекта и порт зафиксированы                                                                                            |
| Свободный порт      | 8080 на `127.0.0.1`                                                                                                                                                          |
| Контейнеры          | Только контейнеры Linux. Контейнеры Windows не поддерживаются                                                                                                                |
| Интернет            | `nodejs.org` (установщик скачивает Node.js 24.21.0 и проверяет его SHA-256), хаб обновлений или GitHub (релиз) и Docker Hub (`node:24.21.0-bookworm-slim` и `postgres:18.4`) |

Установщик не устанавливает и не меняет движок контейнеров, гипервизор или WSL.

## Комплект {#bundle}

Установщик берёт проверенный релиз и распаковывает его в `releases/<версия>/` в корне установки. Файл Compose — `releases/<версия>/deploy/compose.yml`, файл сборки — `releases/<версия>/deploy/Dockerfile`. Образ `proanima-arkvory:<версия>` собирается на вашем хосте из `node:24.21.0-bookworm-slim`. Из реестра Arkvory ничего не скачивается.

Корень установки в Linux — `/opt/proanima-arkvory`. Его структура описана в разделе [Выбор установки](./#installation-directory). В установке Compose данные хранятся не в `data/`, а в томах, описанных ниже.

## Контейнеры {#containers}

| Служба        | Образ                       | Роль                                                                                                 |
| ------------- | --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `database`    | `postgres:18.4`             | PostgreSQL. Сообщает о готовности через `pg_isready` каждые 5 секунд                                 |
| `api`         | `proanima-arkvory:<версия>` | HTTP API и консоль. Опубликован на `127.0.0.1:8080`. Проверка работоспособности каждые 10 секунд     |
| `worker`      | `proanima-arkvory:<версия>` | Завершает загрузки и выполняет фоновые задания. Запускается после того, как API стал работоспособным |
| `backup`      | `proanima-arkvory:<версия>` | Агент резервного копирования. Читает том хранилища только для чтения. Не публикует порт              |
| `initialize`  | `proanima-arkvory:<версия>` | Одноразовый, от имени root: передаёт пользователю 1000 владение томом хранилища                      |
| `migrate`     | `proanima-arkvory:<версия>` | Одноразовый: выполняет миграции базы данных                                                          |
| `vault-owner` | `proanima-arkvory:<версия>` | Одноразовый, только с профилем `maintenance`: передаёт пользователю 1000 владение хранилищем копий   |

Долгоживущие службы перезапускаются, пока вы их не остановите. Контейнеры Arkvory работают от пользователя `node` (пользователь 1000) образа, с корневой файловой системой только для чтения, `/tmp` размером 64 МиБ в памяти, со сброшенными привилегиями (capabilities), `no-new-privileges` и 120 секундами на остановку. Docker хранит для каждого контейнера до пяти файлов журнала JSON по 20 МиБ.

## Тома и подключённые каталоги {#volumes}

### Тома Docker {#docker-volumes}

| Том                        | Подключён в                        | Содержимое                                                                                                          |
| -------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `proanima-arkvory_storage` | `/var/lib/arkvory`                 | Содержимое файлов и промежуточное хранилище загрузок. Агент резервного копирования подключает его только для чтения |
| `proanima-arkvory_catalog` | `/var/lib/postgresql` в `database` | Данные PostgreSQL                                                                                                   |

Тома переживают обновления и `docker compose down`. Только `down --volumes` их удаляет.

### Каталоги хоста из корня установки (bind mounts) {#bind-mounts}

| Путь на хосте             | В контейнере                    | Режим           | Подключён в                                                        |
| ------------------------- | ------------------------------- | --------------- | ------------------------------------------------------------------ |
| `config/runtime.json`     | `/run/arkvory/runtime.json`     | только чтение   | api, worker, backup                                                |
| `config/keys.json`        | `/run/arkvory/keys.json`        | только чтение   | api, worker                                                        |
| `config/health-token.txt` | `/run/arkvory/health-token.txt` | только чтение   | api, worker                                                        |
| `config/postgres.env`     | файл окружения                  |                 | database                                                           |
| `updates/status`          | `/run/arkvory-updates/status`   | только чтение   | api, worker                                                        |
| `updates/inbox`           | `/run/arkvory-updates/inbox`    | чтение и запись | api, worker                                                        |
| хранилище копий           | `/srv/arkvory-vault`            | чтение и запись | backup, `vault-owner` (только пока подключено хранилище копий)     |
| `config/mirrors`          | `/run/arkvory/mirrors`          | только чтение   | api, worker (только пока какой-либо репозиторий является зеркалом) |

### Владельцы и режимы {#owners}

| Путь                                                   | Владелец и режим                     | Зачем                                                                                                                                                                |
| ------------------------------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Корень установки                                       | Устанавливающий пользователь, `0700` | В корне лежат ключ восстановления и пароль базы данных. Войти в него может только устанавливающий пользователь                                                       |
| `config/runtime.json`, `keys.json`, `health-token.txt` | `0644`                               | Пользователь 1000 в контейнере должен их читать. В `runtime.json` лежит пароль базы данных; корень с режимом `0700` не подпускает к этим файлам других пользователей |
| `updates/inbox`                                        | `0777`                               | Единственный каталог, в который контейнер пишет на хосте. ID пользователя в контейнере и ID пользователя программы обновления на хосте могут различаться             |
| `updates/status`                                       | `0755`                               | Его пишет программа обновления на хосте; контейнер только читает                                                                                                     |
| Том хранилища                                          | Пользователь 1000                    | `initialize` задаёт его при установке и обновлении                                                                                                                   |
| Хранилище копий                                        | Пользователь 1000                    | `vault-owner` задаёт его, когда вы подключаете хранилище копий. После этого оно принадлежит пользователю хоста с ID 1000                                             |

## Порты {#ports}

| Порт     | Служба        | Доступность                                         |
| -------- | ------------- | --------------------------------------------------- |
| 8080/TCP | API и консоль | `127.0.0.1:8080` на хосте. Адрес зафиксирован       |
| 5432/TCP | PostgreSQL    | Не публикуется. Доступен только внутри сети Compose |

Файл Compose принадлежит каталогу релиза, который заменяют обновления, поэтому опубликованный адрес там изменить нельзя. Чтобы открыть консоль с других компьютеров, установите на хосте обратный прокси-сервер, который пересылает запросы на `127.0.0.1:8080`.

## Окружение {#environment}

Файл Compose не задаёт настроек Arkvory. Службы читают `/run/arkvory/runtime.json`, то есть `config/runtime.json` на хосте. Установщик записывает следующие значения, и менять их нельзя: `ARKVORY_HOST` (`0.0.0.0` внутри контейнера), `ARKVORY_PORT` (`8080`), `ARKVORY_DATABASE_URL` (контейнер `database` со сгенерированным паролем), `ARKVORY_DATA_DIR` (`/var/lib/arkvory`), `ARKVORY_KEYS_FILE` и `ARKVORY_UPDATE_CONTROL_DIR`.

Можно добавить другие настройки, например `ARKVORY_TRUSTED_PROXIES`, ограничения или `ARKVORY_LOG_LEVEL`. Добавьте их в `config/runtime.json`, затем остановите и снова запустите службы, как показано в разделе [Управление проектом](#manage). Полный список — на странице [Переменные окружения](../reference/environment). В `config/compose.env` хранится `ARKVORY_IMAGE`. Его поддерживает установщик; не редактируйте его.

## Установка в Linux {#install}

1. Скачайте `install.sh` со страницы [GitHub Releases](https://github.com/ProAnima/Arkvory/releases) и прочитайте его.
2. Запустите его от имени `root`:

   ```bash
   sudo bash ./install.sh --mode compose
   ```

   Добавьте `--automatic`, чтобы включить автоматические обновления, или `--engine podman` для Podman. Если задать `ARKVORY_RELEASE_VERSION=1.2.3`, скрипт установит эту стабильную версию. Если GitHub недоступен из интернета, распакуйте `Arkvory-Linux.tar.gz` и выполните `sudo env ARKVORY_ARTIFACT_DIR="$PWD" bash ./install.sh --mode compose` в распакованном каталоге. Node.js всё равно скачивается.

3. Дождитесь окончания работы установщика. Он проверяет и распаковывает релиз, собирает образ, запускает базу данных, выполняет `initialize` и `migrate`, запускает API и обработчик, ждёт, пока API три раза подряд сообщит о готовности, запускает агент резервного копирования и регистрирует таймер обновления.

Пользователь из группы `docker` может установить Arkvory без `root` в каталог, которым он владеет:

```bash
ARKVORY_INSTALL_ROOT="$HOME/arkvory" bash ./install.sh --mode compose
```

Тогда установщик не регистрирует таймер обновления. Консоль не может запрашивать обновления, пока вы сами не запланируете программу обновления. См. [Обновления в Compose](#updates-compose).

## Первый запуск и первые шаги {#first-start}

1. Проверьте, что контейнеры работают. Команду `compose` см. в разделе [Управление проектом](#manage).

   ```bash
   "${compose[@]}" ps
   ```

2. Прочитайте ключ восстановления:

   ```bash
   sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
   ```

3. Откройте `http://127.0.0.1:8080/console/#onboarding` на сервере. С вашего компьютера пробросьте порт: `ssh -L 8080:127.0.0.1:8080 admin@arkvory.example`.
4. В консоли откройте [[ui:navStart]] и разверните [[ui:welcomeOwner]]. Вставьте ключ в поле [[ui:welcomeRecovery]], введите имя владельца и пароль не короче 12 символов и нажмите [[ui:welcomeCreate]].

Храните ключ восстановления на сервере. См. [Безопасность](../operate/security).

## Управление проектом {#manage}

Откройте оболочку root (`sudo -i`) и один раз определите команду `compose`. Compose нужны имя проекта, каталог проекта, файл окружения и каждый файл Compose установки:

```bash
root=/opt/proanima-arkvory
node="$root/runtime/node-v24.21.0-linux-x64/bin/node"   # linux-arm64 на arm64
version=$("$node" -p "require('$root/installation.json').current.version")
compose=(docker compose --project-name proanima-arkvory --project-directory "$root"
  --env-file "$root/config/compose.env" -f "$root/releases/$version/deploy/compose.yml")
for file in compose.vault.yml compose.mirrors.yml; do
  if [[ -f "$root/config/$file" ]]; then compose+=(-f "$root/config/$file"); fi
done
```

Если не указать существующий файл, `up` пересоздаст контейнер без подключённого хранилища копий или каталога зеркал.

| Задача              | Команда                                                                           |
| ------------------- | --------------------------------------------------------------------------------- |
| Показать контейнеры | `"${compose[@]}" ps`                                                              |
| Прочитать журналы   | `"${compose[@]}" logs --tail 100 api worker backup`                               |
| Остановить Arkvory  | `"${compose[@]}" stop --timeout 120 backup worker api`                            |
| Запустить Arkvory   | `"${compose[@]}" up -d --wait api worker`, а затем `"${compose[@]}" up -d backup` |

Остановка командой `stop` оставляет контейнер остановленным и после перезапуска движка. Запустите его снова командой `up -d`.

Команды жизненного цикла выполняются с Node.js, который установщик поместил в корень:

```bash
sudo "$node" "$root/manage.mjs" status --root "$root"
```

`arkvory` на хосте Compose не устанавливается, поэтому для `status`, `update` и `configure` вызывайте `manage.mjs`. Команды описаны на странице [Настройка](./configuration).

## Журналы {#logs}

Контейнеры пишут в файлы журнала JSON Docker. Читайте их через `"${compose[@]}" logs`. API и обработчик пишут по одной записи JSON в строке. См. [Мониторинг](../operate/monitoring). Команды жизненного цикла печатают свои сообщения в терминал, а таймер обновления пишет в журнал systemd: `journalctl -u arkvory-update`.

## Обновления в Compose {#updates-compose}

Обновляйте через консоль, окно автоматического обновления или командой:

```bash
sudo "$node" "$root/manage.mjs" update --root "$root"
```

Обновление скачивает и проверяет релиз, собирает новый образ, затем останавливает `backup`, `worker` и `api` и запускает их с новым образом. Контейнер `database` продолжает работать. Тома остаются как есть. Релиз, который меняет схему базы данных, устанавливается только после проверенной резервной копии. См. [Обновления](./updates).

Программа обновления на хосте запускается раз в минуту. Если установщик запущен от `root` на хосте с systemd, он регистрирует её как `arkvory-update.timer`. Без `root` установщик печатает предупреждение. Запланируйте выполнение этой команды каждую минуту от имени пользователя, которому принадлежит установка и который имеет доступ к движку контейнеров, например через cron:

```text
* * * * * /home/admin/arkvory/runtime/node-v24.21.0-linux-x64/bin/node /home/admin/arkvory/manage.mjs updates-poll --root /home/admin/arkvory
```

Никогда не передавайте сокет Docker контейнерам Arkvory.

## Агент резервного копирования в Compose {#backup-agent}

Контейнер `backup` работает с самого начала. Без хранилища копий он работает и сообщает, что хранилище копий не настроено. Хранилище копий — это каталог хоста вне корня установки, на отдельном томе.

1. Подключите том хранилища копий и создайте пустой каталог, например `/mnt/backup/arkvory`. Каталог должен существовать: Compose его не создаёт.
2. Подключите его:

   ```bash
   sudo "$node" "$root/manage.mjs" configure --root "$root" --backup-vault /mnt/backup/arkvory --vault-key-file /root/arkvory-agent.key
   ```

   Команда проверяет каталог, записывает `config/compose.vault.yml`, передаёт пользователю 1000 владение каталогом, передаёт контейнеру копий файл ключа агента только для чтения (`--vault-key-file`) и перезапускает только контейнер резервного копирования. Она завершается успешно, когда агент сообщает, что хранилище копий доступно. Иначе она восстанавливает прежнюю конфигурацию.

3. Чтобы отключить хранилище копий, выполните ту же команду с `--backup-vault-off`. Само хранилище копий не затрагивается.

Расписания, правила хранения и восстановление описаны на странице [Резервные копии](../operate/backups).

## Удаление {#remove}

```bash
"${compose[@]}" down              # удаляет контейнеры, тома остаются
"${compose[@]}" down --volumes    # ещё и удаляет каталог и все сохранённые файлы
```

`down --volumes` удаляет все данные. Никогда не запускайте его в установке, где есть файлы. Сначала сделайте резервную копию и сохраните хранилище копий.

После `down` можно удалить остатки:

```bash
sudo systemctl disable --now arkvory-update.timer
sudo rm -f /etc/systemd/system/arkvory-update.service /etc/systemd/system/arkvory-update.timer
sudo systemctl daemon-reload
docker image rm "proanima-arkvory:$version"
sudo rm -rf /opt/proanima-arkvory
```

Удаляйте корень, только когда вам больше не нужны конфигурация и ключ восстановления. Образы прежних версий остаются на хосте, пока вы их не удалите.

## Windows с Docker Desktop {#docker-desktop}

Используйте Docker Desktop только для ознакомления на рабочей станции. Docker Desktop — это приложение одного пользователя: контейнеры работают, только пока этот пользователь вошёл в систему и Docker Desktop запущен. После перезагрузки компьютера Arkvory недоступен до этого момента. Включите **Settings > General > Start Docker Desktop when you sign in**. Установщик и команда `status` предупреждают, когда этот параметр выключен. Для сервера используйте [службы Windows](./windows).

1. Запустите Docker Desktop в режиме контейнеров Linux.
2. Скачайте `install.ps1` из релиза и прочитайте его.
3. Откройте Windows PowerShell от имени пользователя, под которым работает Docker Desktop, **без** прав администратора и выполните:

   ```powershell
   .\install.ps1 -Mode compose
   ```

   Параметры `-Root`, `-Version`, `-Engine`, `-Artifact`, `-AutomaticUpdates` и `-Pin` описаны на странице [Windows](./windows#install-with-powershell-and-an-existing-postgresql). Передавайте `-Root` и `-Artifact` абсолютными путями.

4. Откройте `http://127.0.0.1:8080/console/#onboarding`, прочитайте ключ восстановления из `C:\ProgramData\ProAnima\Arkvory\config\bootstrap-token.txt` и создайте владельца, как описано в разделе [Первый запуск и первые шаги](#first-start).

Корень установки `C:\ProgramData\ProAnima\Arkvory` даёт доступ SYSTEM, группе «Администраторы» и устанавливающему пользователю, без наследования, потому что Docker Desktop читает подключённые каталоги с токеном этого пользователя. Не запускайте установщик Compose с повышенными правами.

Установщик регистрирует задачу обновления `ProAnimaArkvoryUpdate` только при запуске от администратора. Эта задача подходит для общесистемного движка, но не для Docker Desktop. Для Docker Desktop зарегистрируйте задачу от имени пользователя Docker Desktop. Она работает, только пока этот пользователь вошёл в систему и Docker Desktop запущен:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
$node = "$root\runtime\node-v24.21.0-win-x64\node.exe"
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$root\manage.mjs`" updates-poll --root `"$root`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Action $action -Trigger $trigger -Settings $settings
```

Управляйте проектом в PowerShell с теми же аргументами:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
$version = (Get-Content "$root\installation.json" -Raw | ConvertFrom-Json).current.version
$compose = @('compose', '--project-name', 'proanima-arkvory', '--project-directory', $root,
  '--env-file', "$root\config\compose.env", '-f', "$root\releases\$version\deploy\compose.yml")
foreach ($file in 'compose.vault.yml', 'compose.mirrors.yml') {
  if (Test-Path "$root\config\$file") { $compose += @('-f', "$root\config\$file") }
}
docker @compose ps
& "$root\runtime\node-v24.21.0-win-x64\node.exe" "$root\manage.mjs" status --root $root
```

Хранилище копий в Windows должно быть локальным томом или томом iSCSI. Пути UNC и SMB отклоняются. Чтобы удалить установку, выполните `docker @compose down --volumes`, отмените регистрацию задачи командой `Unregister-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Confirm:$false` и удалите корень. Сначала сделайте резервную копию.
