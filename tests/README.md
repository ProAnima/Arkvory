# Тесты ядра

- `npm test`: сборка, Node.js test runner, домен/Range и реальная локальная файловая система.
- `npm run test:integration`: PostgreSQL/HTTP, требует `DEPOT_TEST_DATABASE_URL` на отдельную тестовую БД. Создаёт уникальные schema; удаляет только свои данные.
- `npm run test:large`: настоящий HTTP, 5 GiB, отдельный серверный процесс, restart, Range, SHA-256 и RSS. Требует ту же тестовую БД и не менее 6 GiB места в системном temp.

Не запускайте интеграционные suites одновременно на одной БД: standalone-lock намеренно допускает один API. Unit/blob-тесты не требуют БД. Подробнее: [runbook](../docs/CORE_RUNBOOK.md), [результаты](../docs/CORE_VALIDATION.md).
