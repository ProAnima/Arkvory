# 0050. Compose на Windows от пользователя контейнерного движка

Статус: accepted. Owner: Ian Panaev. Дата: 2026-10-01. Уточняет [ADR 0031](0031-release-installation-and-supervision.md) и [ADR 0027](0027-executable-engineering-gates.md).

## Контекст

Режим Compose на Linux устанавливается пользователем группы docker: корень установки получает 0700, системный updater регистрируется только при root, иначе установщик просит оператора запланировать `updates-poll` в контексте владельца движка. На Windows `install.ps1 -Mode compose` и `arkvory-setup.mjs install --mode compose` требовали Administrator и оставляли в ACL корня только SYSTEM и Administrators.

Docker Desktop читает bind mounts (`config/runtime.json`, `keys.json`, `health-token.txt`, `updates/*`) с токеном пользователя, запустившего Docker Desktop. Под UAC этот токен отфильтрован: группа Administrators в нём deny-only, поэтому каталог, доступный только Administrators/SYSTEM, недоступен движку. Контейнерный gate на Windows не запускался вовсе: `bash install.sh` разрешался в WSL bash без дистрибутива, а GNU tar из Git читал `C:\...` как удалённый `host:path`.

## Решение

- Режим `windows` (нативные службы WinSW) по-прежнему требует Administrator и ACL SYSTEM + Administrators.
- Режим `compose` на Windows не требует повышения прав. ACL корня — SYSTEM, Administrators и SID текущего пользователя; наследование снимается так же, как раньше. Это аналог 0700 для пользователя группы docker на Linux: доступ к движку уже равнозначен доступу к файлам этого пользователя.
- Без повышения прав Compose на Windows не регистрирует SYSTEM-задачу `ProAnimaArkvoryUpdate` и печатает то же указание, что Linux без root: запланировать `updates-poll` под владельцем движка. С повышением прав поведение прежнее.
- Gate `deployment-containers` на Windows распаковывает `Arkvory-Windows.zip` и запускает `install.ps1 -Mode compose`, на Linux — прежний `install.sh --mode compose`. Оба пути используют проверенный Node.js из комплекта. После прогона Windows-gate удаляет задачу updater только если она указывает на его временный корень.
- Упаковка и deployment-проверки на Windows вызывают `%SystemRoot%\System32\tar.exe` (bsdtar) по абсолютному пути, PATH не используется. Отсутствие SystemRoot — ошибка окружения.
- Все jobs CI и release работают на образах с явной версией (`ubuntu-24.04`, `windows-2022` и т. д.); policy отклоняет `*-latest` и непроверяемые метки.

## Альтернативы

- Требовать Administrator и для Compose: Docker Desktop всё равно не прочитает файлы под отфильтрованным токеном, а gate нельзя запустить из обычной оболочки разработчика.
- Запускать `bash install.sh` через Git Bash на Windows: проверялся бы Linux-установщик вместо поставляемого Windows-пути, и нужен был бы ещё и curl/python3.
- Оставить ACL наследуемым: секреты в `config` стали бы доступны всем пользователям с правом чтения родителя.

## Последствия

Пользователь, установивший Compose без повышения прав, видит и изменяет секреты установки — так же, как владелец каталога на Linux. Установку нужно выполнять от того же пользователя, под которым работает Docker Desktop; повышение под другой административной учётной записью добавит в ACL не того пользователя. Плановые обновления без системного планировщика подключает оператор (пользовательская задача Windows работает только во время сеанса Docker Desktop).

## Проверка

- Unit: `tests/tar-resolver.test.mjs` (выбор bsdtar независимо от PATH, ошибка без SystemRoot, реальный round-trip с пробелами и буквой диска), `tests/gate-coverage.test.mjs` (закреплённые runner images, отклонение тестовых файлов вне gates).
- Gate `deployment-containers` на Linux CI и на Windows-хосте с Docker Desktop (Linux containers).
