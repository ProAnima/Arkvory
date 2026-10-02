# 0053. Локальный конвейер проверок и выпуск черновика релиза с машины сопровождающего

Статус: accepted. Owner: Ian Panaev. Дата: 2026-10-01. Дополняет [ADR 0027](0027-executable-engineering-gates.md), [ADR 0031](0031-release-installation-and-supervision.md) и [ADR 0050](0050-windows-compose-engine-user.md).

## Контекст

Обязательные lanes и release workflow описаны в [CI](../CI.md) и выполняются на GitHub-hosted runner’ах. С 2026-10-01 jobs не стартуют из-за биллинга аккаунта, поэтому ни merge gate, ни выпуск невозможны, хотя код и гейты исправны. Доступная машина сопровождающего — Windows с Docker Desktop. Гейты `deployment-services` и `native-install` устанавливают настоящие службы и пакеты и поэтому разрешены только на одноразовых машинах: запуск на рабочей станции запрещён.

## Решение

- `npm run ci:local -- [verify|release]` воспроизводит lanes CI на одной машине:
  - `windows`: гейты на хосте в рабочем дереве (static, unit, security, integration, browser, deployment, deployment-containers на Linux-движке Docker Desktop, native-package; в release ещё оба сценария 5 GiB);
  - `linux`: непривилегированный контейнер из `scripts/ci/linux.Dockerfile` с отдельным PostgreSQL 18.4 в собственной сети (static, unit, integration, browser, deployment);
  - `linux-system`: одноразовый привилегированный контейнер с systemd как PID 1 (native-package, deployment-services, native-install). Пакеты, службы, пользователи и sudo живут только в нём; контейнер удаляется после прогона.
- Образ закреплён по digest Ubuntu 24.04. Node.js берётся из того же архива с проверкой SHA-256, что и runtime поставки (`scripts/native-dependencies.mjs`). Playwright задан точной версией из `package.json`. Тег образа выводится из Dockerfile, хеша Node.js и версии Playwright.
- Контейнерные lanes получают исходники через `git bundle`, а не через bind mount: тестируется ровно коммит, `node_modules` хоста в Linux не попадает. При `--allow-dirty` рабочее дерево фиксируется как отдельный commit object через временный индекс (HEAD, индекс и stash не меняются). Такое evidence помечено `dirty` и для выпуска не годится.
- Проверка одноразовой машины (`tests/deployment/disposable-host.mjs`) принимает GitHub Actions или Linux-контейнер с `ARKVORY_DISPOSABLE_HOST=container` и маркером `/.dockerenv` или `/run/.containerenv`. Переменная на рабочей станции без контейнера не проходит. Проверка RPM копирует пакеты в sibling-контейнер через `docker cp` вместо bind mount, поэтому работает и из контейнера с сокетом движка хоста.
- План lanes (`scripts/ci/lanes.mjs`) — исполняемое правило. Каждый гейт из `mergeTasks` (и `releaseTasks` для release) на каждой платформе либо выполняется, либо объявлен явно:
  - `gap` — локально не покрыт: Windows `deployment-services` и `native-install`; Linux `deployment-containers` (права bind mount Linux-хоста, добавлено 2026-10-02 после ошибки vault Compose, которую Docker Desktop не воспроизводит);
  - `covered` — платформенно-независимый результат даёт другой lane.

  Новый гейт без такого решения роняет unit-тест.

- Evidence (`test-results/local-ci/<commit>-<profile>/evidence.{json,md}`) собирается только из отчётов `scripts/gates.mjs` этого прогона. Отчёт для другого коммита, отсутствующий отчёт или ошибка lane — это провал, а не пропуск.
- `npm run release:local -- <x.y.z>` выпускает только черновик:
  1. Предусловия: ветка main, чистое дерево, HEAD совпадает с `origin/main`, `gh` авторизован с правом записи в `ProAnima/Arkvory`, тега и релиза ещё нет, версия больше всех опубликованных.
  2. Свежее (до 24 часов) releasable evidence release-профиля для этого коммита.
  3. Один `release:package`, затем приёмка именно этих байтов: на Windows deployment, deployment-containers, native-package; в systemd-контейнере deployment, deployment-services, native-install.
  4. Сверка хешей `verifyReleaseFiles` и `verifyNativeFiles`.
  5. `gh release create --draft --target <sha>` с проверенными файлами, `arkvory-local-ci-evidence.json` и заметками, где перечислены непокрытые гейты. Тег GitHub создаёт при публикации; опубликовать черновик сопровождающий решает вручную. `--dry-run` останавливается перед созданием черновика.
- GitHub workflows и `scripts/publish-release.mjs` не меняются. При восстановлении биллинга основным путём снова становится CI.

## Альтернативы

- Self-hosted runner на рабочей станции: при проблеме с биллингом jobs могут не стартовать так же, код из PR исполнялся бы на машине сопровождающего, а сервисные гейты всё равно требуют одноразового хоста.
- Windows Sandbox для Windows-установки: компонент не установлен и включается только администратором. Остаётся возможным расширением без изменения формата evidence.
- Выполнять service-гейты прямо на хосте: нарушает правило одноразовых машин и оставляет службы и учётные записи на рабочей станции.

## Последствия

- Локальный черновик доказывает меньше, чем GitHub release workflow:
  - Windows-службы и машинная установка Windows-пакета не проверяются;
  - ОС ограничены Windows 11 и Ubuntu 24.04, без матрицы 22.04 и 2025;
  - доказательство не независимо: evidence формирует та же машина, что собирает байты.

  Поэтому заметки черновика перечисляют пробелы, а публикация остаётся ручной. Привилегированный контейнер `linux-system` и сокет движка дают ему права над Docker Desktop VM. Это допустимо для одноразового контейнера сопровождающего и недопустимо для общих раннеров.

## Проверка

`tests/local-ci.test.mjs` проверяет:

- полноту плана lanes и обнаружение нового гейта без решения;
- вердикт lane (чужой коммит, пропущенный гейт, ошибка, dirty);
- releasable только для чистого полного release-профиля;
- версии и предусловия;
- заметки;
- аргументы;
- правило одноразовой машины.

Сценарии `native-install` и `deployment-services` прошли в `linux-system` на Windows 11 + Docker Desktop 29.4: RPM в Fedora 44 через sibling-контейнер, updater, SSH и восстановление служб.
