# Тесты ядра

- `npm test`: сборка, Node.js test runner, домен/Range и реальная локальная файловая система.
- `npm run test:integration`: PostgreSQL/HTTP, требует `DEPOT_TEST_DATABASE_URL` на отдельную тестовую БД. Создаёт уникальные schema; удаляет только свои данные.
- `npm run test:large`: настоящий HTTP, 5 GiB, отдельный серверный процесс, restart, Range, SHA-256 и RSS. Требует ту же тестовую БД и не менее 6 GiB места в системном temp.
- `node tests/large-transfer.mjs --multipart --verified`: multipart, kill API на середине и после публикации, проверяемая SDK-докачка через fault proxy, SHA-256 и RSS обоих процессов. Не менее 11 GiB свободного места для частей и собранного blob.

SDK fault tests входят в `npm test`: настоящие HTTP-сокеты без БД, неполные ответы, неправильные validators/Range, ограниченные повторы/тайм-ауты/отмена. Integration suite дополнительно теряет ответы после записи create/part/complete в настоящей БД и обрывает multipart upload.

`bandwidth.test.mjs` использует виртуальные монотонные часы для проверки верхней границы shared/per-principal bucket, fairness, cancellation и backpressure. `integration/traffic.test.mjs` проверяет скорость параллельных full/multipart и native/legacy потоков по настоящим сокетам, ротацию ключей одного id, отмену и остановку API. Флаг `--traffic` большого теста включает квоты и отдельный отчёт `large-traffic.json`.

Не запускайте интеграционные suites одновременно на одной БД: standalone-lock намеренно допускает один API. Unit/blob-тесты не требуют БД. Подробнее: [runbook](../docs/CORE_RUNBOOK.md), [результаты](../docs/CORE_VALIDATION.md).

`tests/integration/identity.test.mjs` проверяет регистрацию администратором, группы, чтение байтов по праву группы, изменение и отзыв прав, блокировку входа, смену пароля и ограничение числа сессий в PostgreSQL. Для запуска нужен `DEPOT_TEST_DATABASE_URL`; локальные unit-тесты не заменяют эту проверку.

`tests/integration/package-pagination.test.mjs` сравнивает SQL-порядок SemVer с доменным правилом и проходит курсором более 1000 версий без повторов и пропусков; также проверяет направления сортировки, привязку курсора к запросу, готовность шести индексов и восстановление прерванной миграции.

`tests/integration/compat.test.mjs` проверяет legacy exact/latest UPack download при каталоге более 1000 версий, те же байты, отсутствие версии и прежние ACL/Range.

`tests/integration/service-access.test.mjs` проверяет managed ключи: точные права native/legacy, one-time issuance, ротацию и ownership, отзыв между записью bytes и commit, policy CAS, caps, worker/reader и отсутствие file fallback. `node tests/large-transfer.mjs --multipart --verified --traffic --managed` выполняет передачу 5 GiB с managed credential, kill/restart/resume и проверкой SHA-256. Standalone БД должна быть свободна от других suites.

`api-contract.test.mjs` проверяет стабильные operationId, схемы, security/path metadata и собранный JSON. `integration/api-contract.test.mjs` проверяет реальный HTTP без credentials для всех операций, запрет всех mutations на reader, отказ startup при неизвестном route и схемы реальных PostgreSQL/HTTP ответов. Снимок `fixtures/api-operations.json` обновляется после review изменений контракта; не расширяйте исключения guard ради зелёного теста.

Делегирование: `tests/integration/delegation.test.mjs` проверяет lifecycle через SDK/HTTP, exact targets/actions, ceilings и expiry, запрет цепочек/самоуправления, tombstone CAS и конкурентные лимиты, фильтрацию до LIMIT, повторную авторизацию после ожидания lock, rollback audit и pending activation после смены authority. Интеграционные файлы используют общий тестовый PostgreSQL и запускаются с `--test-concurrency=1` перед списком файлов.

Файловые страницы: `tests/asset-page.test.mjs` и `tests/integration/asset-pagination.test.mjs` проверяют Unicode prefix bounds, bounded response parser, полный обход >1000, SQL seek на 20 000 путей, scope/ACL/revoke, restart и concurrent changes, совместимость старого API и восстановление индексной миграции 11.

Discovery: tests/repositories.test.mjs и integration/repositories.test.mjs проверяют managed opt-in, frozen coarse mapping, empty/group overrides, 10 000 grants, фильтрацию до LIMIT, wire parsing, HTTP/SDK/HEAD, user groups/reader, revoke/expiry/disable/rotation и отсутствие data/admin escalation.
