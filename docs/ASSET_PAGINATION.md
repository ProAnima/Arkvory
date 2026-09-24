# Постраничный файловый каталог

Реализовано 2026-09-24: схема БД **11**, OpenAPI 3.0.3 / документ **0.6.0**. Новый GET/HEAD `/api/v1/repositories/{repository}/assets/page` позволяет полностью обходить каталог текущих asset pointers независимо от прежнего ограничения 1000 записей. Решение: [ADR 0020](adr/0020-asset-cursor-pagination.md).

## Контракт

| Параметр | Значение                                                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `prefix` | Необязательный буквальный префикс, по умолчанию пустой; до 1024 UTF-16 code units; без управляющих символов и одиночных surrogate |
| `limit`  | Целое 1–100, по умолчанию 50                                                                                                      |
| `after`  | Непрозрачный cursor из `next` предыдущего ответа, максимум 8192 ASCII символа                                                     |

Ответ `200 {items: [{path,revision,artifactId}], next: string|null}`. `next:null` завершает обход. Пустой результат — 200, а не 404. HEAD выполняет те же проверки, не возвращает тело. Ответ private/no-store. Неизвестные query parameters, повтор параметра, неверный cursor/limit/prefix — 400. Формы ошибок и admission остаются общими для native API.

Порядок фиксирован: возрастание пути по байтам UTF-8, `COLLATE "C"` в PostgreSQL. Регистр учитывается. Нормализация Unicode и locale sorting не выполняются: составное `é` и `e` с combining accent остаются разными путями. Префикс `folder` включает `folder2/file`; `folder/` ограничивает начало пути папкой. Символы `%` и `_` буквальные, glob/LIKE patterns не поддерживаются.

Cursor связывает последний путь, версию формата и fingerprint пары repository/prefix. Изменение prefix или перенос в другой repository отклоняется; размер страницы можно менять. Cursor переживает перезапуск API и не зависит от reader/writer process. Его нельзя трактовать как secret, подписанное разрешение или snapshot token; внутреннее представление не является контрактом для ручного формирования клиентом.

Доступ: managed `asset.read` на конкретный repository либо прежний coarse `read`. Сохранённый cursor не даёт доступа после policy change или revoke. API заново разрешает credential и проверяет repository/action для каждой страницы. Права на чтение bytes, namespace isolation и фильтрация отдельных папок этим endpoint не добавляются. Reader поддерживает GET/HEAD по прежнему профилю общего storage.

## Изменения между страницами

Это обход текущего каталога, а не экспорт согласованного snapshot. Указатели/ревизии берутся на момент SQL-запроса страницы. Замена artifact у уже пройденного пути не возвращает этот путь повторно. Новый путь после cursor может появиться дальше; новый путь до cursor будет виден только при следующем обходе с начала. Удалённая граница не ломает продолжение: SQL сравнивает значение пути, не ищет строку cursor.

Для согласованного переноса каталога нужно отдельно заморозить изменения или использовать будущий snapshot/export workflow. Этот API не выдаётся за готовый перенос 4 ТБ. При построении индекса внешнего сервиса сохраняйте checkpoint после успешной обработки страницы, допускайте повтор страницы и периодически сверяйте полный каталог.

## SDK

```typescript
import { DepotClient } from '@proanima/depot-sdk';

const client = new DepotClient(depotUrl, () => serviceSecret);
let after: string | undefined;
do {
  const page = await client.assetPage(
    'releases',
    { prefix: 'builds/', limit: 100, ...(after ? { after } : {}) },
    signal,
  );
  await consumePage(page.items); // обработать и сохранить checkpoint на своей стороне
  after = page.next ?? undefined;
} while (after);
```

SDK проверяет предел страницы, поля entries, строгий порядок без дублей и форму next. JSON сохраняет общий предел 2 MiB; не накапливайте все страницы в RAM, если задача допускает поэтапную обработку. AbortSignal прекращает ожидание HTTP. Автоматического бесконечного обхода/retry нет. Наличие функции сообщается `capabilities.features.assetPagination:true`.

## Индекс и обновление

SQL использует точный repository, нижнюю и исключающую верхнюю границу prefix, исключающий after и `LIMIT limit+1`. Верхняя граница вычисляется по Unicode scalar values, включая переход через surrogate range и максимальный code point. Нет OFFSET, полного COUNT, сортировки/фильтрации всего каталога в JavaScript. В памяти адаптера не более 101 строки; в ответе не более 100.

Миграция 11 создаёт `depot_asset_page_path (repository, path COLLATE "C")` через CREATE INDEX CONCURRENTLY. Используется существующий отдельный migration lock 18471/9, отдельное соединение и конечные таймауты; upload reservation lock 18471/2 не захватывается. Marker 11 записывается после успешного построения. Повтор миграции использует уже валидный индекс; невалидный результат прерванного concurrent build удаляется и строится заново. Основные таблицы, pointers и история не переписываются. Индекс потребует дополнительного места на диске и I/O при построении.

Для обновления остановить процессы по действующему runbook, сохранить согласованный backup, обновить сборку, выполнить `npm run migrate`, затем запустить writer/readers/worker. Readiness требует markers **8, 9, 10, 11**. Additive индекс совместим с прежними данными, но сам по себе не разрешает mixed-version HA rollout. Для большого каталога при превышении конечного migration timeout повторить миграцию в подходящем окне обслуживания; не выставлять marker вручную.

Прежний GET `/assets?prefix=…` сохраняет `{items}` и отказ при более чем 1000 результатах. Его сортировка и wire format не изменены. Для больших каталогов используйте новый `/assets/page`. Управление UPack, asset history и публикация bytes сохраняют прежние контракты.

## Проверки

`tests/asset-page.test.mjs` проверяет Unicode-границы и runtime-парсер SDK. `tests/integration/asset-pagination.test.mjs` проверяет полный обход более 1000 путей, literal prefix, Unicode/case, scope cursor, ACL/revoke между страницами, restart/concurrent pointers, прежний API, migration resume/invalid index и EXPLAIN ANALYZE на 20 000 путей. Индексный сценарий проверяет seek без Seq Scan/Sort и чтение не более limit+1 строк. Это проверка плана конкретного запроса, не обещание latency/throughput для промышленного каталога.

Локальная приёмка 2026-09-24: Windows, Node 24.13.0, PostgreSQL 18.4; `npm run check`, 63 модульных теста и 76 последовательных PostgreSQL/HTTP integration tests прошли. В отдельной перепроверке предыдущего инкремента также прошли 16 сценариев service keys/delegation. Передача 5 GiB повторно не запускалась, поскольку путь bytes не изменён; стенд ProGet/HA по-прежнему отложен.
