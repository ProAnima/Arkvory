# Проверки в CI

[Workflow](../.github/workflows/check.yml) запускается при push в main, pull request и вручную. Actions закреплены по commit SHA, доступ — `contents: read`, credentials checkout не сохраняются. Deploy не выполняется.

Linux и Windows: `npm ci --ignore-scripts`, `npm run gate -- quick`. Это установка из lock-файла, архитектурная политика, формат, TypeScript, ESLint, границы, сборка JS/declarations и unit/governance/SDK fault tests. Команды, тайм-ауты, зависимости и тестовые входы определяет config/gates.json; workflow проверяется на покрытие всех обязательных гейтов.

Отдельная Linux job поднимает PostgreSQL 18.4 и запускает `npm run gate -- integration`. Тесты создают и удаляют собственную schema; credentials относятся только к изолированному CI service. Рабочие ключи и базы не нужны. Отсутствие тестовой БД приводит к ошибке, а не к зелёному пропуску.

Browser acceptance использует отдельную PostgreSQL и закреплённый Playwright Chromium: `npm run gate -- browser` проверяет консоль и скачивания. Dependency audit выполняет security-гейт. Итоговый `Arkvory merge gate` запускается всегда и требует успеха всех обязательных jobs; на теге или ручном large-прогоне требует также оба больших сценария. Настройка обязательного status check в защите ветки выполняется отдельно на GitHub и зависит от доступных настроек репозитория.

Тег `v*` или ручной workflow_dispatch с `large_transfers=true` дополнительно запускает `npm run gate -- large`: два сценария 5 GiB с новым серверным процессом, принудительным завершением, повторным запуском, Range, полным скачиванием, SHA-256 и измерением RSS клиента/сервера. Это тяжёлая проверка, поэтому не запускается при каждом изменении документации.

Каждая job публикует итог в logs и job summary даже после ошибки. Архивы test-results загружаются только при repository variable `ARKVORY_UPLOAD_ARTIFACTS=true`; это дополнительный канал, который требует свободной квоты GitHub. Подробности и локальные эквиваленты: [ENGINEERING_GATES](ENGINEERING_GATES.md).

Окружение — Node.js 24 LTS, npm 11. [Измерения локального стенда](CORE_VALIDATION.md), [запуск](CORE_RUNBOOK.md). Проверяются multipart, каталог, SDK, worker, GC, локальные очереди и документированный поднабор legacy downloads. Реальные ProGet-клиенты, HA и промышленный failover этими jobs не подтверждаются. Ручной large_transfers дополнительно запускает 5 GiB multipart с убийством процесса на середине загрузки.
