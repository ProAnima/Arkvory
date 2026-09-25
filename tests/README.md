# Тесты ядра

- `npm test`: сборка, Node.js test runner, домен/Range и реальная локальная файловая система.
- `npm run test:integration`: PostgreSQL/HTTP, требует `DEPOT_TEST_DATABASE_URL` на отдельную тестовую БД. Создаёт уникальные schema; удаляет только свои данные.
- `npm run gate -- browser`: оба браузерных сценария, настоящие API/БД, pinned Playwright Chromium; обязательный CI-гейт.
- `npm run test:large`: оба сценария 5 GiB, настоящий HTTP, отдельный серверный процесс, restart, Range, SHA-256 и RSS, multipart kill/resume с managed credential и traffic limits. Требует ту же тестовую БД и не менее 11 GiB свободного места в системном temp.
- `npm run gate -- quick|verify|release`: единые профили; имена передаются отдельно, например `npm run gate -- verify`. Реестр, добавление проверок и отчёты: [ENGINEERING_GATES](../docs/ENGINEERING_GATES.md).

SDK fault tests входят в `npm test`: настоящие HTTP-сокеты без БД, неполные ответы, неправильные validators/Range, ограниченные повторы/тайм-ауты/отмена. Integration suite дополнительно теряет ответы после записи create/part/complete в настоящей БД и обрывает multipart upload.

`bandwidth.test.mjs` использует виртуальные монотонные часы для проверки верхней границы shared/per-principal bucket, fairness, cancellation и backpressure. `integration/traffic.test.mjs` проверяет скорость параллельных full/multipart и native/legacy потоков по настоящим сокетам, ротацию ключей одного id, отмену и остановку API. Флаг `--traffic` большого теста включает квоты и отдельный отчёт `large-traffic.json`.

Не запускайте интеграционные suites одновременно на одной БД: standalone-lock намеренно допускает один API. Unit/blob-тесты не требуют БД. Подробнее: [runbook](../docs/CORE_RUNBOOK.md), [результаты](../docs/CORE_VALIDATION.md).

`tests/integration/identity.test.mjs` проверяет регистрацию администратором, группы, чтение байтов по праву группы, изменение и отзыв прав, блокировку входа, смену пароля и ограничение числа сессий в PostgreSQL. Для запуска нужен `DEPOT_TEST_DATABASE_URL`; локальные unit-тесты не заменяют эту проверку.

`tests/integration/package-pagination.test.mjs` сравнивает SQL-порядок SemVer с доменным правилом и проходит курсором более 1000 версий без повторов и пропусков; также проверяет направления сортировки, привязку курсора к запросу, готовность шести индексов и восстановление прерванной миграции.

`tests/integration/compat.test.mjs` проверяет legacy exact/latest UPack download при каталоге более 1000 версий, те же байты, отсутствие версии и прежние ACL/Range.

`tests/integration/service-access.test.mjs` проверяет managed ключи: точные права native/legacy, one-time issuance, ротацию и ownership, отзыв между записью bytes и commit, policy CAS, caps, worker/reader и отсутствие file fallback. `npm run gate -- large-multipart` выполняет передачу 5 GiB с managed credential, kill/restart/resume и проверкой SHA-256. Standalone БД должна быть свободна от других suites.

`api-contract.test.mjs` проверяет стабильные operationId, схемы, security/path metadata и собранный JSON. `integration/api-contract.test.mjs` проверяет реальный HTTP без credentials для всех операций, запрет всех mutations на reader, отказ startup при неизвестном route и схемы реальных PostgreSQL/HTTP ответов. Снимок `fixtures/api-operations.json` обновляется после review изменений контракта; не расширяйте исключения guard ради зелёного теста.

Делегирование: `tests/integration/delegation.test.mjs` проверяет lifecycle через SDK/HTTP, exact targets/actions, ceilings и expiry, запрет цепочек/самоуправления, tombstone CAS и конкурентные лимиты, фильтрацию до LIMIT, повторную авторизацию после ожидания lock, rollback audit и pending activation после смены authority. Интеграционные файлы используют общий тестовый PostgreSQL и запускаются с `--test-concurrency=1` перед списком файлов.

Файловые страницы: `tests/asset-page.test.mjs` и `tests/integration/asset-pagination.test.mjs` проверяют Unicode prefix bounds, bounded response parser, полный обход >1000, SQL seek на 20 000 путей, scope/ACL/revoke, restart и concurrent changes, совместимость старого API и восстановление индексной миграции 11.

Discovery: tests/repositories.test.mjs и integration/repositories.test.mjs проверяют managed opt-in, frozen coarse mapping, empty/group overrides, 10 000 grants, фильтрацию до LIMIT, wire parsing, HTTP/SDK/HEAD, user groups/reader, revoke/expiry/disable/rotation и отсутствие data/admin escalation.

`download-queue.test.mjs` проверяет scheduler/checkpoint/commit/cleanup. PostgreSQL suite дополняется `integration/download-queue.test.mjs` с реальными HTTP Range и файлами. Дополнительная браузерная приёмка: `browser/downloads.mjs` (Playwright Chromium/Edge, отдельная БД, запуск последовательно с integration); [инструкции](../docs/DOWNLOAD_QUEUE.md).

## Приёмка интерфейса

`tests/browser/console.mjs` — обязательный сценарий verify/CI с реальными API/PostgreSQL: каталог, скачивание, метаданные, история, пользователи и загрузка. Проверяет семь экранов на трёх ширинах в RU/EN и обеих темах, сохранение полей, клавиатурное меню и блокировку входа во время передачи. Playwright входит в devDependencies; браузер устанавливается через `npm run test:browser:install`. Обычный `npm test` запускает только unit-гейт. Запуск и границы проверки: [CONSOLE_UX](../docs/CONSOLE_UX.md).
`operations.test.mjs` и `integration/operations.test.mjs` проверяют partition всего API, visibility без cross-resource/admin escalation, schema/HEAD/cursors, revoke/delegation/reader, пользовательские группы и реальный SDK workflow через новые namespaces. [Контракт](../docs/API_SURFACES.md).

`attachments.test.mjs` и integration/attachments проверяют ограничения, CAS/права, историю, restart и FK-пины. Browser console вызывает build-details: реальные metadata edits, labels, multipart pause/resume, conflict/reload, unlink/restore и reader. Браузерный сценарий и integration suite на одной PostgreSQL базе запускаются последовательно: storage advisory locks действуют на всю БД, даже при разных test schemas.

Retention: tests/retention.test.mjs и tests/integration/retention.test.mjs проверяют bounded filters, explicit managed permission, stale revisions, reference races, history pins, rollback audit, immutable package identities, replay/restart и offline GC grace. tests/browser/deletion.mjs вызывается из console.mjs: managed discovery, dependency blockers, ID confirmation, CAS, RU/EN, light/dark и mobile.

Storage policy acceptance covers per-channel/per-package/global last-N ranking, multi-channel survival, protected labels/references, 100-item batches without pinned-row starvation, concurrent quota reservations, pending/cancelled accounting, CAS, live-key reauthorization, restart, disabled schedules and bounded event history. Diagnostics tests cover stream backpressure and secret/query redaction. UPack tests create an archive with nested custom metadata and verify manifest preservation. The console scenario also covers storage settings, disabled preview, explicit activation and both themes/languages. Physical online GC and the two-server replication lab remain outside this acceptance.
