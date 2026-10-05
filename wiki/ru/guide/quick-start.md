---
title: Быстрый старт
---

# Быстрый старт

На этой странице показан кратчайший путь от пустого сервера до работающего Arkvory с одним загруженным файлом. Выберите один способ установки в шаге 1, затем выполните остальные шаги по порядку.

Скачивайте установщики только со [страницы релизов](https://github.com/ProAnima/Arkvory/releases) проекта и сверяйте их SHA-256 с файлами контрольных сумм релиза.

## Шаг 1. Установите сервер {#step-1-install-the-server}

### Windows {#windows}

Нужны Windows 10 версии 1809 или новее либо Windows Server 2019 или новее на архитектуре x64 и права администратора. Подключение к интернету не требуется.

1. Запустите `Arkvory-Setup-x64.exe` и подтвердите запрос прав администратора.
2. Выберите язык и примите лицензию.
3. На странице владельца введите имя (3–64 символа: латинские буквы, цифры, `.`, `-` или `_`) и пароль не короче 12 символов. Это первая учётная запись администратора.
4. Завершите работу мастера. Он может сам открыть консоль.

Программа установки помещает файлы программы в `C:\Program Files\ProAnima\Arkvory`, а данные — в `C:\ProgramData\ProAnima\Arkvory`. Она создаёт четыре службы Windows: `Arkvorydatabase`, `Arkvoryapi`, `Arkvoryworker` и `Arkvorybackup`. Они работают без вошедшего пользователя. См. [Windows](../install/windows).

### Linux {#linux}

Возьмите пакет для вашего дистрибутива. Менеджер пакетов также установит сервер PostgreSQL (поддерживаются версии с 16 по 19).

```bash
# Debian, Ubuntu
sudo apt install ./Arkvory-amd64.deb

# Fedora, RHEL-совместимые дистрибутивы
sudo dnf install ./Arkvory-x86_64.rpm
```

Корень установки — `/opt/proanima-arkvory`. Пакет создаёт службы systemd `arkvory-database`, `arkvory-api`, `arkvory-worker` и `arkvory-backup`. Проверьте их:

```bash
systemctl status arkvory-api arkvory-worker arkvory-backup
```

См. [Linux](../install/linux).

### Docker Compose {#docker-compose}

Нужен Docker с Compose. В Windows используйте Docker Desktop с контейнерами Linux. Скрипт скачивает Node.js и релиз, поэтому ему нужен доступ в интернет.

Скачайте `install.sh` или `install.ps1` из релиза и прочитайте скрипт, прежде чем запускать его.

```bash
sudo bash ./install.sh --mode compose
```

В Windows запустите PowerShell от имени того же пользователя, под которым работает Docker Desktop, без прав администратора:

```powershell
.\install.ps1 -Mode compose
```

Корень установки — `/opt/proanima-arkvory` в Linux и `C:\ProgramData\ProAnima\Arkvory` в Windows. В состав стека входят API, обработчик, агент резервного копирования и PostgreSQL 18. См. [Docker](../install/docker).

## Шаг 2. Откройте консоль {#step-2-open-the-console}

Откройте `http://127.0.0.1:8080/console/` в браузере на сервере.

Сначала сервер слушает только локальный адрес `127.0.0.1`. Чтобы открыть консоль со своего компьютера, пробросьте порт через SSH:

```bash
ssh -L 8080:127.0.0.1:8080 admin@arkvory.example
```

Затем откройте `http://127.0.0.1:8080/console/` на своём компьютере. Чтобы открыть доступ другим машинам, сначала настройте [HTTPS](../install/https).

## Шаг 3. Создайте владельца {#step-3-create-the-owner}

Пропустите этот шаг, если вы установили Arkvory с помощью `Arkvory-Setup-x64.exe`: программа установки уже создала владельца.

В Linux и Docker первая учётная запись создаётся с помощью **ключа восстановления**. Установщик записывает его в `config/bootstrap-token.txt` в корне установки. Прочитать файл может только администратор.

```bash
sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
```

```powershell
Get-Content C:\ProgramData\ProAnima\Arkvory\config\bootstrap-token.txt
```

1. В консоли откройте раздел [[ui:navStart]] и разверните [[ui:welcomeOwner]].
2. Вставьте ключ в поле [[ui:welcomeRecovery]].
3. Введите имя владельца и пароль не короче 12 символов, затем нажмите [[ui:welcomeCreate]].
4. Войдите с новым именем и паролем в карточке [[ui:connection]].

Храните ключ восстановления в секрете и не удаляйте файл: им пользуются средства установки и обновления. См. [Безопасность](../operate/security).

Владелец — администратор и может писать в репозиторий `releases`. Чтобы создать другой репозиторий, откройте [[ui:administration]], разверните [[ui:manageGrants]], выберите для группы `arkvory-owners` уровень доступа [[ui:write]] к новому имени, например `builds`, и нажмите [[ui:saveGrant]]. Имя репозитория состоит из строчных латинских букв, цифр, `-` и `_` и содержит не более 64 символов.

## Шаг 4. Создайте ключ для своих инструментов {#step-4-create-a-key-for-your-tools}

Скриптам и клиенту командной строки нужен ключ. Для первой проверки используйте персональный токен доступа:

1. Разверните [[ui:personalAccessTokens]] в карточке [[ui:connection]].
2. Заполните поле [[ui:tokenName]], в поле [[ui:tokenScope]] выберите значение [[ui:tokenScopeReadWrite]] и нажмите [[ui:generateToken]].
3. Скопируйте токен. Он показывается только один раз.
4. Сохраните его в файле, который можете читать только вы, например `~/.arkvory/key`.

Для CI/CD и агентов развёртывания вместо этого создайте сервисную учётную запись с собственным ключом. См. [Учётные записи и доступ](../use/accounts).

## Шаг 5. Загрузите и скачайте файл с помощью curl {#step-5-upload-and-download-with-curl}

Путь к файлу в репозитории работает как файл на веб-сервере. `PUT` сохраняет новую версию пути, а `GET` возвращает текущую версию.

```bash
export ARKVORY_KEY="$(cat ~/.arkvory/key)"

# Загрузка
curl -T ./Setup.exe -H "Authorization: Bearer $ARKVORY_KEY" \
  http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe

# Скачивание
curl -fL -H "Authorization: Bearer $ARKVORY_KEY" -o Setup-copy.exe \
  http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe
```

Загрузка возвращает JSON такого вида:

```json
{
  "path": "builds/game/1.0/Setup.exe",
  "revision": 1,
  "created": true,
  "artifact": { "id": "…", "size": "1048576", "sha256": "…" }
}
```

Если загрузить те же байты ещё раз, ответ — `200` с `"created": false`, и новая версия не создаётся. Новый файл получает статус `201`.

В PowerShell:

```powershell
$headers = @{ Authorization = "Bearer $env:ARKVORY_KEY" }
$url = 'http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe'
Invoke-WebRequest -Method Put -InFile .\Setup.exe -Headers $headers -Uri $url
Invoke-WebRequest -Headers $headers -Uri $url -OutFile .\Setup-copy.exe
```

Один запрос `PUT` должен завершиться за 30 минут. Для очень больших файлов или медленных сетей используйте клиент командной строки: он загружает файл по частям и продолжает после сбоя. См. [Обычные файлы](../protocols/raw-files).

## Шаг 6. Используйте клиент командной строки {#step-6-use-the-command-line-client}

Установите `arkvoryctl` на свой компьютер: `Arkvory-CLI-Setup-x64.exe` в Windows, `Arkvory-CLI-amd64.deb` или `Arkvory-CLI-x86_64.rpm` в Linux. На машине CI с Node.js 24 подойдёт и `arkvoryctl.mjs`.

```bash
arkvoryctl profile add local --server http://127.0.0.1:8080 --token-file ~/.arkvory/key
arkvoryctl doctor
arkvoryctl put ./Setup.exe builds/game/1.0/Setup.exe
arkvoryctl get builds/game/1.0/Setup.exe ./Setup-copy.exe
```

Профиль использует репозиторий `releases`, если не указать `--repository`. Если передача прервалась, запустите ту же команду ещё раз: она продолжит с места остановки и в конце проверит SHA-256. Клиент принимает обычный HTTP только для локального компьютера; для удалённого сервера используйте HTTPS. См. [Клиент командной строки](../protocols/cli).

## Дальнейшие шаги {#next-steps}

- [Основные понятия](./concepts): репозитории, артефакты, стадии и ключи.
- [HTTPS](../install/https): безопасно откройте сервер для других машин.
- [Резервные копии](../operate/backups): подключите хранилище копий, прежде чем хранить важные данные.
- [Пакеты](../use/packages) и [Продвижение](../use/promotion): сборки с версиями для развёртывания.
- [Веб-консоль](./console): обзор всех разделов.
