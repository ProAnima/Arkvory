# ADR 0020: Отдельный API страниц файлового каталога

Статус: accepted. Дата: 2026-09-24.

## Контекст

GET `/assets` возвращает items-only и требует сузить prefix при более 1000 записях. Для больших каталогов невозможно гарантировать полный обход произвольным делением префиксов. Прежняя форма ответа и семантика остаются совместимыми.

## Решение

Добавить GET/HEAD `/assets/page` с `{items,next}`, размером 1–100, literal prefix и фиксированным восходящим порядком UTF-8 bytes. Keyset boundary — уникальный path внутри repository; mutable revision/artifactId не входят в ключ сортировки. Версионированный opaque cursor привязан к repository/prefix fingerprint и переживает restart. Cursor не подписывается: он только выбирает границу, а каждый запрос отдельно авторизует repository/action. Namespace selectors не объявляются реализованными.

Application проверяет права и ограниченные параметры, infrastructure валидирует cursor и выполняет SQL seek по точному repo, диапазону prefix и after, выбирая limit+1 строк. Domain/HTTP не содержат SQL. Wire schemas/SDK независимы от SQL и application types. Старый маршрут сохраняется целиком, без скрытого перехода на несовместимый envelope.

Миграция 11 строит индекс `(repository,path COLLATE "C")` concurrently. Общий механизм ранее применялся к package indexes миграции 8; теперь он исполняет две явные группы с собственными markers под прежним отдельным migration lock. Валидный индекс после прерывания перед marker переиспользуется; invalid index перестраивается. Readiness проверяет 11 вместе с 8/9/10.

## Последствия и альтернативы

OFFSET отклонён из-за роста работы на глубоких страницах и сдвигов при вставках. Полный COUNT и in-memory filtering не нужны. Явный C index позволяет prefix range seek при любой default DB collation. Это добавляет дисковый индекс и write overhead; план проверяется на репрезентативном синтетическом каталоге.

Между страницами нет snapshot: вставки до boundary и изменения уже пройденных pointers требуют повторного обхода. Для согласованной миграции нужен отдельный export workflow. UI списка assets, папочные ACL, события и репликация не добавляются этим изменением.

## Приёмка

Полный HTTP/SDK обход >1000 путей, Unicode boundaries/порядок, literal `%`/`_`, отказ неправильных cursors и неизвестных query fields, ACL/revoke, restart и concurrent changes. Старый API сохраняет items-only/лимит. Проверяются schema responses и route inventory (97 операций), online index migration/resume и EXPLAIN ANALYZE без Seq Scan/Sort для глубокой страницы узкого prefix. Эксплуатация: [ASSET_PAGINATION](../ASSET_PAGINATION.md).
