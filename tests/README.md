# Тесты ядра

- `npm test`: сборка, Node.js test runner, домен/Range и реальная локальная файловая система.
- `npm run test:integration`: PostgreSQL/HTTP, требует `DEPOT_TEST_DATABASE_URL` на отдельную тестовую БД. Создаёт уникальные schema; удаляет только свои данные.
- `npm run test:large`: настоящий HTTP, 5 GiB, отдельный серверный процесс, restart, Range, SHA-256 и RSS. Требует ту же тестовую БД и не менее 6 GiB места в системном temp.
- `node tests/large-transfer.mjs --multipart --verified`: multipart, kill API на середине и после публикации, проверяемая SDK-докачка через fault proxy, SHA-256 и RSS обоих процессов. Не менее 11 GiB свободного места для частей и собранного blob.

SDK fault tests входят в `npm test`: настоящие HTTP-сокеты без БД, неполные ответы, неправильные validators/Range, ограниченные повторы/тайм-ауты/отмена. Integration suite дополнительно теряет ответы после записи create/part/complete в настоящей БД и обрывает multipart upload.

Не запускайте интеграционные suites одновременно на одной БД: standalone-lock намеренно допускает один API. Unit/blob-тесты не требуют БД. Подробнее: [runbook](../docs/CORE_RUNBOOK.md), [результаты](../docs/CORE_VALIDATION.md).
