# Тесты ядра

- `npm test`: сборка, Node.js test runner, домен/Range и реальная локальная файловая система.
- `npm run test:integration`: PostgreSQL/HTTP, требует `DEPOT_TEST_DATABASE_URL` на отдельную тестовую БД. Создаёт уникальные schema; удаляет только свои данные.
- `npm run test:large`: настоящий HTTP, 5 GiB, отдельный серверный процесс, restart, Range, SHA-256 и RSS. Требует ту же тестовую БД и не менее 6 GiB места в системном temp.
- `node tests/large-transfer.mjs --multipart --verified`: multipart, kill API на середине и после публикации, проверяемая SDK-докачка через fault proxy, SHA-256 и RSS обоих процессов. Не менее 11 GiB свободного места для частей и собранного blob.

SDK fault tests входят в `npm test`: настоящие HTTP-сокеты без БД, неполные ответы, неправильные validators/Range, ограниченные повторы/тайм-ауты/отмена. Integration suite дополнительно теряет ответы после записи create/part/complete в настоящей БД и обрывает multipart upload.

`bandwidth.test.mjs` использует виртуальные монотонные часы для проверки верхней границы shared/per-principal bucket, fairness, cancellation и backpressure. `integration/traffic.test.mjs` проверяет скорость параллельных full/multipart и native/legacy потоков по настоящим сокетам, ротацию ключей одного id, отмену и остановку API. Флаг `--traffic` большого теста включает квоты и отдельный отчёт `large-traffic.json`.

Не запускайте интеграционные suites одновременно на одной БД: standalone-lock намеренно допускает один API. Unit/blob-тесты не требуют БД. Подробнее: [runbook](../docs/CORE_RUNBOOK.md), [результаты](../docs/CORE_VALIDATION.md).

`tests/integration/identity.test.mjs` проверяет регистрацию администратором, группы, чтение байтов по праву группы, изменение и отзыв прав, блокировку входа, смену пароля и ограничение числа сессий в PostgreSQL. Для запуска нужен `DEPOT_TEST_DATABASE_URL`; локальные unit-тесты не заменяют эту проверку.

`tests/integration/package-pagination.test.mjs` сравнивает SQL-порядок SemVer с доменным правилом и проходит курсором более 1000 версий без повторов и пропусков; также проверяет направления сортировки и привязку курсора к запросу.
