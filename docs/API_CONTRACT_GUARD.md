# Проверяемый контракт API

Реализовано 2026-09-25. OpenAPI **3.0.3**, версия документа **0.11.0**, HTTP namespace остаётся `/api/v1`. В документе **127 операций**, включая явные и автоматически зарегистрированные HEAD, native API, liveness, endpoint самой спецификации и три семейства legacy downloads. Это инвентаризация работающего поднабора, не заявление о полной совместимости с ProGet.

## Получение спецификации

`GET /api/v1/openapi.json` требует действующий Bearer и возвращает документ конкретной сборки. После `npm run build` идентичный JSON находится в `packages/contracts/dist/openapi.json`; доступ к работающему серверу и credentials для этого не нужны. Сборка не читает deployment-конфигурацию и не записывает секреты в артефакт.

Для UI/SDK спецификация не обязательна при каждом запросе: portable TypeScript SDK использует существующие runtime-парсеры DTO. Внешние языки могут использовать JSON для генерации клиентов, но должны отдельно поддержать streaming, Range/recovery, Bearer и ограничения legacy catch-all путей. Сгенерированный клиент не освобождает от проверки hashes и статуса upload после потери ответа.

## Что проверяется автоматически

`packages/contracts/src/operation-policy.ts` описывает operationId, tag, авторизацию, ресурс/ownership и правило повтора. Wire-схемы остаются в native/catalog/identity/service modules. `openapi-compose.ts` объединяет их, отклоняет отсутствие policy, дубли operationId и policy без схемы, а также дополняет HEAD, ошибки и транспортные заголовки.

`apps/api/src/contract-guard.ts` собирает реальный Fastify `onRoute` inventory до регистрации handlers. Перед готовностью сервера сверяются обе стороны: любой неописанный маршрут либо отсутствующий handler вызывают `API route drift`. Guard включён для writer и reader. Сбой не открывает частично зарегистрированный сервер для listen; стартующий процесс закрывает ресурсы через обычный startup cleanup.

Исключены только GET/HEAD семи статических файлов `/console/`, перечисленных в guard по точному пути. Общего исключения `/console/*` нет. CORS OPTIONS обслуживаются `onRequest`, не регистрируют отдельный endpoint; они сохраняют собственные origin/method/header проверки и тесты. Неизвестные пути/default 404 — поведение транспортного слоя, не контрактный endpoint.

Тесты проверяют:

- Снимок method/path/operationId в `tests/fixtures/api-operations.json`: переименование не проходит незаметно. Изменение снимка требует обычного review совместимости.
- Все path parameters, ссылки на auth schemes, metadata доступа, компилируемость request/response JSON schemas, отсутствие тела у HEAD/204/304/416 и идентичность экспортированного JSON.
- Через настоящие HTTP-сокеты — границы аутентификации 127 операций, в том числе HEAD с ранним отказом.
- Все изменяющие операции на reader возвращают 405/read_only до application work.
- Реальные PostgreSQL/HTTP ответы uploads, jobs, каталога, services/keys, ошибки CAS/revoke, native и legacy bytes, Range/ETag соответствуют опубликованным схемам.
- Новая неописанная runtime route останавливает readiness; лишняя или отсутствующая route проваливает сверку.
- Полная спецификация и серверный inventory не попадают в браузерный bundle через SDK.

Это проверка инвентаризации и контрактных сценариев, а не доказательство всех комбинаций ACL или всех возможных JSON-ответов. Прежние domain, storage, SDK, ACL и отказные тесты сохраняются. Метаданные спецификации **не исполняют авторизацию**: её источником остаются use cases и транзакционные проверки managed credential.

## Расширения OpenAPI

| Поле операции                                  | Значение                                                                                                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operationId`                                  | Стабильное имя; прежние 15 service IDs сохранены                                                                                                                                  |
| `x-depot-authorization`                        | kind: public/authenticated/account-session/administrator/service-bootstrap/bootstrap-or-own-key/repository-discovery/service-administration/pending-or-active-key либо repository |
| `actions`, `legacy` в repository authorization | Все требуемые managed actions; прежние coarse read/write, не wildcard                                                                                                             |
| `resource`                                     | `path.repository` либо `job.repository`, разрешаемый по заданию                                                                                                                   |
| `owner`                                        | Дополнительная проверка upload/job/reference owner, когда требуется                                                                                                               |
| `x-depot-gateway`                              | writer либо writer-or-reader; наличие схемы не разрешает запись на reader                                                                                                         |
| `x-depot-retry`                                | Семантика повтора, описанная ниже; не инструкция бесконечно повторять запрос                                                                                                      |
| `x-depot-route`                                | Точный зарегистрированный шаблон для inventory, включая `:repository` и `*`                                                                                                       |
| `x-depot-streaming`                            | Предел объекта/запроса, checksum/recovery либо Range и способ разрешения объекта                                                                                                  |

`read` — чтение можно повторять с ограниченным бюджетом; это не snapshot. `never-automatic` — потеря ответа требует отдельного решения вызывающего клиента. `idempotent` — целевое состояние допускает повтор; auth/expiry, аудит и конкурентные изменения всё равно учитываются. Например повтор logout с уже отозванной сессией может получить 401.

`idempotency-key` — сохранять тот же ключ и то же тело; secret выданного service key повторно не возвращается. `compare-and-swap` — после 409 перечитать состояние; нельзя автоматически менять expectedRevision ради успешного overwrite. `reconcile-upload` — сначала состояние upload/parts, затем безопасное продолжение; whole PUT нельзя продолжить с середины. `reconcile-job` — проверить задание; новый credential может переавторизовать queued/failed job по действующим правилам. 401/403 не повторяются автоматически, 503 требует учесть Retry-After и неопределённость результата mutations.

Native endpoints принимают Bearer. Только legacy downloads дополнительно описывают альтернативные X-ApiKey и Basic с literal username `api`; это альтернативы, а не обязательное одновременное предъявление. Permissions не помещаются в OAuth scopes. Наличие legacy query `key` не является способом аутентификации.

## Потоки и HEAD

GET bytes описывает 200/206, binary content, ETag, Content-Length, Content-Range и Accept-Ranges; 304/416 без тела. HEAD не имеет тела, учитывает If-None-Match и игнорирует Range, поэтому 206/416 для него не объявлены. Автоматические HEAD метаданных имеют те же проверки доступа, что GET.

`immutableBytes` относится к опубликованным bytes. Legacy latest/asset URL разрешает каталог заново на каждом запросе и может указывать на новую версию; сам URL нельзя считать неизменяемым. UPack `packagePath` и asset `assetPath` — catch-all с несколькими сегментами: кодировать каждый сегмент отдельно, сохраняя `/`. Поддержка таких путей генераторами SDK требует проверки.

Загрузка ограничена 5 GiB на объект; часть ≤8 MiB. Незавершённый HTTP request не подтверждает частичную запись. Error schema едина: code/message/requestId; HEAD передаёт только status/headers. Существующие форматы и HTTP-методы не изменены.

## Добавление операции

Добавить use case и server handler, wire-схемы и строку operation policy; определить стабильное имя, реальные права и retry. Обновить SDK и карту API, затем осмысленно обновить снимок operations. Запустить `npm run check`, `npm test`, PostgreSQL integrations и относящиеся ACL/отказные сценарии. Не расширять static exclusions ради прохождения проверки.

Сам inventory guard не требует таблиц; текущий runtime использует схему **11** с [индексом файловых страниц](ASSET_PAGINATION.md), сохраняя [делегированное управление](SERVICE_DELEGATION.md). Новые service-administration policies задают action, точную область resource и bootstrapAlternative; это metadata, не замена транзакционной авторизации. Следующие этапы: импорт identities/ownership, namespace selectors, события и UI управления ключами. Полный HA/ProGet стенд остаётся отдельной отложенной приёмкой.
