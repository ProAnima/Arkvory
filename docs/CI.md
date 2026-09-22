# Проверки в CI

[Workflow](../.github/workflows/check.yml) запускается при push в main, pull request и вручную. Actions закреплены по commit SHA, доступ — `contents: read`, credentials checkout не сохраняются. Deploy не выполняется.

Linux и Windows: `npm ci --ignore-scripts`, `npm run check`, `npm test`. Это установка из lock-файла, формат, TypeScript, ESLint, границы, сборка JS/declarations и тесты домена/Range/LocalBlobStore.

Отдельная Linux job поднимает PostgreSQL 18.4 и запускает `npm run test:integration`. Тесты создают и удаляют собственную schema; credentials относятся только к изолированному CI service. Рабочие ключи и базы не нужны. Отсутствие тестовой БД приводит к ошибке, а не к зелёному пропуску.

Ручной workflow_dispatch с `large_transfers=true` дополнительно запускает 5 GiB HTTP test с новым серверным процессом, принудительным завершением, повторным запуском, Range, полным скачиванием, SHA-256 и измерением RSS. Это тяжёлая проверка, поэтому не запускается при каждом изменении документации.

Окружение — Node.js 24 LTS, npm 11. [Измерения локального стенда](CORE_VALIDATION.md), [запуск](CORE_RUNBOOK.md). Совместимость ProGet, HA, очереди и промышленный failover пока не реализованы и не проверяются этими jobs.
