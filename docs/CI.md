# Проверки в CI

[Workflow](../.github/workflows/check.yml) `Arkvory gates` запускается при push в main и тегах `v*`, pull request, merge queue, еженедельно (понедельник 02:20 UTC) и вручную. Actions закреплены по commit SHA, доступ — `contents: read`, credentials checkout не сохраняются. Deploy не выполняется. Команды, тайм-ауты, зависимости и тестовые входы определяет config/gates.json; policy проверяет, что каждый гейт реестра выполняется в CI.

## Образы runner’ов

Все jobs используют образы с явной версией: `ubuntu-22.04`, `ubuntu-24.04`, `windows-2022`, `windows-2025`. Метки `*-latest` запрещены policy (`scripts/policy/runners.mjs`) в check и release workflow: GitHub переводит `ubuntu-latest` на Ubuntu 26 с 2026-10-19, и смена ядра, Docker, shell и системных пакетов не должна незаметно менять гейты. Переход на новый образ — отдельное изменение workflow с прогоном всех lanes.

## Lanes

| Job                     | Runner                                     | Команда                                                      | Когда                                                                   |
| ----------------------- | ------------------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `check` (Quality)       | ubuntu-22.04, ubuntu-24.04, windows-2022/5 | `npm run gate -- quick deployment deployment-services`       | всегда                                                                  |
| `native`                | ubuntu-24.04, windows-2022                 | `npm run gate -- native-install` (включает `native-package`) | всегда                                                                  |
| `integration`           | ubuntu-24.04 + PostgreSQL 18.4             | `npm run gate -- integration`                                | всегда                                                                  |
| `browser`               | ubuntu-24.04 + PostgreSQL 18.4             | `npm run gate -- browser`                                    | всегда                                                                  |
| `security`              | ubuntu-24.04                               | `npm run gate -- security`                                   | всегда                                                                  |
| `deployment-containers` | ubuntu-24.04 (Docker Engine)               | `npm run gate -- deployment-containers`                      | всегда                                                                  |
| `large`                 | ubuntu-24.04 + PostgreSQL 18.4, ×2         | `npm run gate -- large-full` / `large-multipart`             | push в main, `v*`, merge queue, schedule, ручной `large_transfers=true` |
| `verdict`               | ubuntu-24.04                               | `node scripts/ci-verdict.mjs`                                | всегда                                                                  |

Обязательны все lanes, кроме `large`. Итоговый `Arkvory merge gate` (verdict) запускается всегда и блокирует результат при missing/failed/cancelled/skipped любого обязательного job. Для push в main, `v*`, merge queue, расписания и ручного запуска с `large_transfers` он требует также оба сценария 5 GiB. Обычный pull request может пропустить только `large`.

Сценарии 5 GiB: `large-full` (полная передача) и `large-multipart` (`--multipart --verified --traffic --managed`, убийство сервера на середине загрузки, resume, Range, SHA-256, RSS клиента/сервера). В check workflow они идут на двух независимых runner’ах. Release workflow выполняет их последовательно внутри `npm run gate -- release` до упаковки candidate.

Windows lanes не запускают `deployment-containers`: на GitHub-hosted Windows нет Linux containers. Контейнерный gate на Windows выполняется локально на хосте с Docker Desktop (см. ниже).

## Release workflow

[`Prepare stable release`](../.github/workflows/release.yml) запускается вручную только с main: `build` (ubuntu-24.04) выполняет `npm run gate -- release` и собирает один candidate; `acceptance` на четырёх ОС проверяет этот candidate через `deployment deployment-services`, а на Linux дополнительно `deployment-containers`; `native` (ubuntu-24.04, windows-2022) — `native-install`; `publish` проверяет хеши и создаёт draft. Подробности: [ENGINEERING_GATES](ENGINEERING_GATES.md#проверки-поставки-и-служб).

## Локальный конвейер

Без GitHub Actions те же lanes выполняются на машине сопровождающего (Windows + Docker Desktop, либо Linux + Docker Engine без windows-lane). Решение и границы: [ADR 0053](adr/0053-local-ci-and-release.md).

```
npm run ci:local                # verify: все lanes, нужен чистый коммит
npm run ci:local -- release     # плюс оба сценария 5 GiB
npm run ci:local -- --allow-dirty --lane linux,linux-system
npm run release:local -- 1.2.3 --dry-run
npm run release:local -- 1.2.3  # черновик релиза на GitHub
```

| Lane           | Где                                                       | Гейты (verify)                                                                                                      |
| -------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `windows`      | хост, рабочее дерево; БД `npm run test:db:up`             | static, unit, security, integration, browser, deployment, deployment-containers, native-package (+ 5 GiB в release) |
| `linux`        | контейнер `scripts/ci/linux.Dockerfile` + PostgreSQL 18.4 | static, unit, integration, browser, deployment                                                                      |
| `linux-system` | одноразовый контейнер с systemd                           | native-package, deployment-services, native-install                                                                 |

Не выполняются локально (gap): Windows `deployment-services` и `native-install` — они ставят службы и пакет на машину. Покрыты другим lane: Linux `deployment-containers`, `security`, оба сценария 5 GiB. Полнота плана проверяется `tests/local-ci.test.mjs`: новый гейт в config/gates.json без lane или явного объявления роняет unit-гейт.

Контейнерные lanes тестируют коммит через `git bundle`. С `--allow-dirty` они тестируют снимок рабочего дерева (временный индекс; HEAD, индекс и stash не меняются), а evidence помечено `dirty`. Итог: `test-results/local-ci/<commit>-<profile>/evidence.{json,md}` и отчёты гейтов по lanes. Первый запуск собирает образ (Ubuntu по digest, Node.js из закреплённого архива поставки, Chromium Playwright) и скачивает нативные зависимости. Потом используются тома `arkvory-ci-npm` и `arkvory-ci-native`. `--keep-containers` оставляет контейнеры для разбора.

`release:local` создаёт только черновик:

1. Проверяет main, чистое дерево, HEAD = `origin/main` (сначала push), `gh auth`, право записи, отсутствие тега и релиза, версию выше опубликованных.
2. Берёт свежее releasable evidence release-профиля (`--reuse-evidence`) или запускает его.
3. Упаковывает один candidate в `artifacts/<версия>`.
4. Принимает его на Windows и в systemd-контейнере.
5. Сверяет хеши.
6. Создаёт `gh release create --draft --target <sha>` с проверенными файлами, `arkvory-local-ci-evidence.json` и заметками о пробелах.

Опубликовать черновик на GitHub нужно вручную. До публикации автообновление его не видит.

## Состояние GitHub Actions на 2026-10-01

Jobs репозитория падают до первого шага из-за проблемы с биллингом аккаунта GitHub (лимит расходов или оплата), а не из-за кода. Такой прогон не означает ни успеха, ни дефекта: verdict остаётся красным, merge по зелёному gate невозможен. До восстановления биллинга обязательные проверки выполняются локальным конвейером выше, и PR перечисляет фактически выполненные и невыполненные гейты. После восстановления повторите workflow для последнего commit.

## Отчёты

Каждая job публикует итог в logs и job summary даже после ошибки. Архивы test-results загружаются только при repository variable `ARKVORY_UPLOAD_ARTIFACTS=true`; это дополнительный канал, который требует свободной квоты GitHub. Подробности и локальные эквиваленты: [ENGINEERING_GATES](ENGINEERING_GATES.md).

Окружение — Node.js 24 LTS, npm 11. [Измерения локального стенда](CORE_VALIDATION.md), [запуск](CORE_RUNBOOK.md). HA и промышленный failover этими jobs не подтверждаются.
