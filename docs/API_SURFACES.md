# API: ответственность, видимость и интеграции

Статус: реализовано в native v1, OpenAPI document **0.11.0**, схема БД **17**. Контракт содержит **127 операций**, включая HEAD и текущий legacy-поднабор. Потребители: CI/CD, интеграции и отдельный удалённый интерфейс. Они используют один серверный контракт; встроенная консоль не имеет привилегированного канала.

## Независимые области ответственности

| Surface          | Ответственность                                                   | Примеры                                                                        |
| ---------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `discovery`      | Узнать возможности, разрешённые операции и репозиторные области   | capabilities, operations, OpenAPI, repositories                                |
| `identity`       | Вход и собственная identity                                       | login/logout, me, permissions, password, активация собственного managed key    |
| `catalog`        | Описания, организация, версии и ссылки на содержимое              | artifacts, annotations, packages, assets/history, references, repository audit |
| `transfers`      | Приём и раздача байтов, состояние собственных загрузок/заданий    | upload create/parts/complete/cancel, jobs, download/HEAD/Range                 |
| `administration` | Учётные записи, группы, сервисы, credentials, policy и delegation | users, access-groups, service-accounts, api-keys                               |
| `operations`     | Текущее состояние процесса и готовность шлюза                     | health/live, health/ready                                                      |
| `compatibility`  | Сохранение существующего внешнего протокола                       | поднабор скачиваний UPack/Common Packages/Assets                               |

Это логические области контракта, не семь новых сервисов. URL существующих клиентов сохраняются. Размещение writer/reader определяется deployment-профилем, а не названием surface. Будущее физическое разделение должно сохранять operationId, авторизацию, ресурсные границы и общий контракт ошибок.

## Уровни видимости — без наследования полномочий

| Visibility       | Что означает                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `public`         | Сам вызов не требует Bearer: liveness и обмен username/password на сессию. Каталог операций всё равно требует авторизацию. |
| `authenticated`  | Общие сведения для действующего credential; не разрешение читать чужие ресурсы.                                            |
| `self`           | Своя identity, сессия либо credential; дополнительные условия отражены в authorization metadata.                           |
| `repository`     | Точные actions внутри одного репозитория.                                                                                  |
| `owned-resource` | Те же actions плюс владелец upload/job/reference.                                                                          |
| `delegated`      | Конкретный целевой service account, отдельные admin actions и ceiling; bootstrap остаётся явной альтернативой.             |
| `bootstrap`      | Локально настроенное управление сервисными identities/delegations.                                                         |
| `administrator`  | Управление пользовательскими учётными записями и группами.                                                                 |

Administrator не наследует download, bootstrap не становится пользовательским administrator, Publisher не наследует Reader. Managed account/key bindings пересекаются по **действию и тому же репозиторию**. Новые actions не включаются в старые read/write автоматически. Runtime use cases остаются источником решений; `x-depot-surface` и `x-depot-visibility` являются описанием, а не middleware авторизации.

## Каталог операций для текущего клиента

```http
GET /api/v1/operations?repository=releases&surface=transfers&limit=50
Authorization: Bearer <credential>
```

Ответ содержит `apiVersion`, `documentVersion`, `gatewayRole`, `repository`, `advisory: true`, `items` и `next`. В операции: `operationId`, HTTP method/path template, summary, surface, visibility, retry, requiredActions и conditions.

- Без `repository` возвращаются только применимые общие, собственные и административные операции; bytes/catalog/upload конкретного репозитория не предполагаются.
- Discovery списков может оставаться доступным с пустым результатом: видимость операции listRepositories не выдаёт repository.read или доступ к именам чужих репозиториев.
- С `repository` добавляются операции, для которых действуют **все** обязательные permissions. Достаточно своего непустого binding; отдельное `repository.read` не требуется для introspection существующего узкого data key. Карточка репозитория по-прежнему требует своё `repository.read` у managed key.
- Чужая и неизвестная репозиторная область дают одинаковый 404. Endpoint не проверяет существование файлов или глобального repository registry.
- `requiredActions` описывает managed permissions. Legacy keys и пользовательские группы проверяются по прежнему coarse mapping; introspection не меняет их права.
- `conditions` перечисляет оставшиеся проверки: `resource-state`, `upload-owner`, `job-owner`, `reference-owner`, `delegation-target-and-ceiling`, `own-key`. Наличие строки в каталоге **не гарантирует** доступ к произвольному resource ID, успешный CAS или свободную квоту.
- Делегированные admin actions видны при наличии актуального enabled grant с этим action. Целевые account IDs и ceiling не выдаются через общий каталог; они читаются отдельным API собственных delegations. Bootstrap видит свою альтернативу.
- Reader исключает все изменяющие методы. Права на writer могут быть шире; этот ответ описывает именно опрошенный шлюз.
- `limit`: 1–100, default 50. Порядок по operationId, `next` — последний ID страницы. Фильтрация прав выполняется **до** LIMIT. Следующая страница повторно проверяет права. Это не snapshot; после смены фильтра/репозитория обход начинают заново.
- Неизвестные, повторённые и некорректные query options дают 400. GET и HEAD защищены одинаково. Ответ — `Cache-Control: private, no-store`; не сохранять его как долговременный permission cache.

`advisory: true` обязателен: каждый настоящий запрос заново проверяет ключ, область, владельца, состояние, ревизию, ограничения и роль шлюза. Отозванный ключ не может продолжить работу по старому каталогу. Для возможностей ещё не реализованного API не публикуются фиктивные operationId.

## Спецификация по областям

```http
GET /api/v1/openapi.json
GET /api/v1/openapi.json?surface=catalog
GET /api/v1/openapi.json?surface=administration
```

Первый URL сохраняет полную спецификацию. Второй и третий — документационные представления, с параметрами путей, схемами, security, retry и gateway metadata исходного контракта. Они **не фильтруются по правам пользователя**: документация административного метода не открывает доступ к нему. Для построения меню удалённого UI применяется `/operations`, а не факт наличия пути в OpenAPI.

В каждой операции OpenAPI присутствуют `x-depot-surface` и `x-depot-visibility` наряду с прежними `x-depot-authorization`, `x-depot-gateway` и `x-depot-retry`. Неизвестная responsibility или операция без описания останавливает сборку/запуск. Registry/route guard проверяет весь inventory, в том числе новые GET/HEAD.

## SDK по зонам ответственности

```typescript
const client = new DepotClient('https://depot.example.com/', () => currentToken);
const repository = client.inRepository('releases');

const visible = await repository.operations({ surface: 'transfers' });
const files = await repository.artifacts.search({ label: 'stable' });
const revisions = await repository.assets.history('current/app.upack');
const annotations = await repository.annotations.get(artifactId);
await repository.annotations.update(artifactId, annotations.revision, {
  labels: ['stable'],
  collections: ['desktop'],
  metadata: { channel: 'stable' },
});
const verifiedBytes = await repository.artifacts.downloadVerified(artifactId, {
  signal: abortController.signal,
});
```

| SDK namespace                       | Методы                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `client.identity`                   | login, logout, me, permissions, changePassword, activateKey              |
| `client.administration.users`       | list, create, update                                                     |
| `client.administration.groups`      | list, create, setMember, setGrant                                        |
| `client.administration.services`    | list, get, create, update, policy, setPolicy, keys, audit                |
| `client.administration.credentials` | get, issue, rotate, revoke, delegations, setDelegation, removeDelegation |
| `repository`                        | describe, operations; immutable id                                       |
| `repository.artifacts`              | list, search, get, download, downloadVerified                            |
| `repository.annotations`            | get, update                                                              |
| `repository.uploads`                | create, get, parts, resume, complete, completeAsync, cancel              |
| `repository.packages`               | list, register                                                           |
| `repository.assets`                 | get, list (cursor page), history, revision, assign, restore              |

Плоские методы `client.create`, `client.repository`, `client.downloadVerified` и остальные сохранены. Новые namespaces делегируют тем же методам, не дублируют HTTP/retry/auth логику. Клиент хранит callback получения текущего токена; смена токена не закрепляет старую identity за созданным namespace. Namespace не является security boundary: его методы всё равно могут вернуть 401/403/404/409 и другие контрактные ошибки.

## Подключение удалённого интерфейса

1. Авторизоваться через пользовательскую сессию либо отдельный подходящий credential; не встраивать общий service secret в распространяемый UI.
2. Получить capabilities, identity/permissions и разрешённые репозитории. У data-only managed key логический репозиторий может быть задан конфигурацией интеграции, без repository.read.
3. Прочитать все страницы `/operations` для нужного repo/gateway; построить разделы по surface и действия по operationId. Ограничения conditions остаются видимыми пользователю.
4. После 401 удалить локальную авторизацию; после 403 обновить права и доступные действия; после 409 перечитать ревизию. Ошибки не превращаются в бесконечный retry.
5. Для записи использовать writer, для раздачи — разрешённый endpoint. Не переносить постоянный credential на произвольный host через redirect. CORS настраивается на точный origin по [EXTERNAL_UI](EXTERNAL_UI.md).

## Дальнейшее расширение — ещё не реализовано

| Область            | Следующий самостоятельный контракт                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Catalog            | Реестр и настройки репозиториев, native resolve exact/latest, управляемые schemas/labels/collections, namespace selectors |
| Transfers          | Долговечная общая очередь и её own/admin views, transfer tickets, динамические квоты, подтверждённые replicas             |
| Integration events | Авторизованный event cursor, затем outbox/webhooks с replay/deduplication и ограничениями egress                          |
| Administration     | Импорт legacy ownership, делегированное identity administration, готовые версионированные роли                            |
| Operations         | Отдельное system.observe для подробной диагностики, retention dry-run/apply, проверенный backup/restore                   |
| Compatibility      | Publication/list/metadata на основе реальных ProGet fixtures                                                              |

Эти расширения не выдаются за работающие API. Текущий health/ready сохраняет прежний доступ любого действующего credential к агрегатам. Добавление новых административных или опасных операций требует отдельного действия, явной видимости, bounds, отрицательных тестов и документации, а не назначения через общий `write`.

## Проверка

Unit: ответственность всех операций, разделение областей OpenAPI, отсутствие перемножения bindings, независимость bootstrap/admin/delegation, exact repository после 100-й записи, строгий parser страниц. Integration: реальный HTTP/PostgreSQL, schema validation, HEAD, paging, узкие managed keys, отзыв policy/key/delegation, reader-фильтрация, пользовательская сессия/группы и SDK upload/download/metadata/assets. Новая версия не требует миграции БД и не объявляет HA или полную ProGet compatibility.

Для манифестов и дополнительных файлов добавлена группа `repository.attachments.{get,replace,history}`. Операции `getBuildAttachments`, `replaceBuildAttachments`, `getBuildAttachmentHistory` относятся к catalog/repository. [Контракт и UI](BUILD_DETAILS.md).

Внутренняя композиция SDK не меняет эти поверхности: 68 flat methods и namespaces сохранены, группы используют общий HTTP-транспорт с актуальным credential для каждого запроса. Снимок публичных типов и сетевые регрессии входят в unit-гейт. [Архитектурное решение](adr/0028-sdk-composition.md).
