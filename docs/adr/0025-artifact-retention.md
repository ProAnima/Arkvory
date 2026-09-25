# ADR 0025: явное удаление и проверяемый retention

Статус: принято.

## Контекст

Удалённый UI должен управлять временем жизни опубликованных объектов. Фоновое unlink без учёта references, asset history, attachments и открытых downloads нарушает существующие гарантии. Coarse write раньше означал загрузку/изменение каталога и не должен автоматически разрешать удаление опубликованного содержимого.

## Решение

Вводим managed-only `artifact.delete`, inspection, bounded preview и explicit-selection apply. `legacy: null` в policy означает отсутствие coarse alternative; пустой legacy array также fail-closed. Авторизация rechecked под locks account/key, затем короткий repository catalog gate. Все catalog mutations используют такой же порядок и проверяют доступность target внутри transaction. Byte I/O остаётся вне gate. Возможная hashtext collision только сериализует независимые репозитории и не влияет на права.

Preview — advisory. Apply принимает фиксированные IDs и annotation revisions, повторно проверяет критерии и все пины, атомарно пишет receipt, cancellation и audit. Scope — один repository, до 100 элементов. Ошибки infrastructure откатывают весь batch. Идемпотентность задаётся immutable ID с сохранением tombstone.

UPack identity сохраняется, package queries проверяют published state. Схема не расширяет публичный upload status enum: удалённый upload становится cancelled и не может быть completed вновь. Logical removal запрещает новые скачивания, физическое удаление выполняется только существующим offline GC после grace. Уже начатые downloads не лишаются байтов.

Миграция published_at использует консервативный migration-time baseline для старых objects и trigger для новой публикации. Индексы asset references строятся отдельно concurrently. Rolling-compatible расширение schema само по себе не разрешает downgrade после активации нового поведения; перед выдачей permission обновляются все процессы и SDK.

## Последствия

Gate сериализует короткие metadata writes в одном repository, поэтому не заявляем неограниченную масштабируемость. Он не сериализует загрузку/скачивание байтов. В текущем single-writer профиле это простой проверяемый инвариант; переход к distributed writers требует отдельной ревизии.

Сохранение истории может блокировать очистку части объектов навсегда до внедрения отдельного history lifecycle. Это намеренное сохранение данных. Нет force-delete, автоматического снятия чужих references, schedule, online GC, undelete или обещания HA. Контракт и эксплуатация: [ARTIFACT_RETENTION](../ARTIFACT_RETENTION.md).
