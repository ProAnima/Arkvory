# Карта API Depot

Управление установленным кодом: `GET/HEAD /api/v1/system/updates` и `POST /api/v1/system/updates/requests`. Surface administration, глобальный administrator, команды check/configure/apply с revision и UUID. SDK: `client.updates`. [Контракт, права и восстановление](UPDATES.md).

Области ответственности, уровни видимости, каталог операций текущего credential и SDK для удалённых клиентов реализованы: [API_SURFACES](API_SURFACES.md). `GET/HEAD /api/v1/operations` — authenticated, контекст repository необязателен, pagination до 100, advisory conditions. `GET/HEAD /api/v1/openapi.json?surface=…` — документационное представление. OpenAPI document 0.12.0, 130 операций; актуальная схема БД — 17.

Дата сверки: 2026-09-25, runtime со схемой 17. Это точка входа для интеграторов: **реализованные маршруты** ниже отделены от **проектируемых расширений**. Детальные JSON-схемы текущего сервера: `GET /api/v1/openapi.json` с действующим Bearer. OpenAPI сейчас 3.0.3; новую модель доступа описывает [API_ACCESS](API_ACCESS.md), порядок внедрения — [API_EVOLUTION](API_EVOLUTION.md).

Физическая очистка: GET/HEAD `R/storage/cleanup` (`storage.read`), PUT того же пути и POST `R/storage/cleanup/run` (`storage.manage`). Настройки с CAS, динамическая пауза, ограниченный проход и результат последнего выполнения: [ONLINE_CLEANUP](ONLINE_CLEANUP.md). Выполняется в фоне без остановки HTTP; 200 при запросе прохода не означает завершение удаления.

## Обозначения и общие правила

`R = /api/v1/repositories/{repository}`. `read`, `write`, `administrator` — реальные сегодняшние проверки; `own` означает того же principal, не просто любой ключ с write. Пользовательская сессия также допустима. Администратор не обходит read/write. В таблице «целевое право» permissions репозиторных операций разделов 2–4 уже действуют для managed keys; глобальные identity/policy permissions пока проектные. Service administration выполняется file bootstrap либо делегатом с отдельными действиями на точные аккаунты, см. [текущий контракт ключей](SERVICE_KEYS.md). Несколько прав через `+` обязательны одновременно.

У reader доступны только GET/HEAD, кроме инфраструктурного CORS preflight; изменяющие методы получают 405 даже при наличии права. `/console/` размещается только на writer. Автоматические HEAD у Fastify GET могут присутствовать; ниже перечислены контрактные методы, для bytes HEAD указан явно.

Сейчас размеры JSON — десятичные строки, revision — ограниченное целое; timestamps UTC. JSON body по умолчанию до 64 KiB, upload content передаётся отдельным бинарным stream. Ошибка native: `{code,message,requestId}`. Нет/неверный credential — 401; недостаточно права — 403; чужой upload/job скрывается 404; конфликт — 409; hash mismatch — 422; исчерпанная ёмкость — 507; busy/unavailable — 503 с Retry-After. Не считать любой POST безопасным для автоматического retry.

## 1. Система и identity — реализовано

| Метод и путь                                                  | Текущий доступ                | Результат / важное условие                                                     | Целевое право                                                               |
| ------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| GET `/health/live`                                            | Без ключа                     | 200, минимальная liveness                                                      | Публичный минимум                                                           |
| GET `/health/ready`                                           | Любой действующий ключ/сессия | 200/503, writable, role, агрегаты admission/bandwidth                          | Совместимый прежний доступ; подробная диагностика отдельно `system.observe` |
| GET `/api/v1/openapi.json`                                    | Любой действующий ключ/сессия | Рабочая спецификация                                                           | Аутентифицированный доступ                                                  |
| POST `/api/v1/auth/login`                                     | Без предварительного ключа    | 200, token/expiresAt/account; password gate                                    | Учётные данные пользователя                                                 |
| GET `/api/v1/auth/me`                                         | Любой действующий ключ/сессия | ID, administrator, точные repository grants                                    | Своя identity                                                               |
| POST `/api/v1/auth/logout`                                    | Действующая авторизация       | 204; отзыв текущей пользовательской сессии. Не отзывает file-based service key | Своя сессия                                                                 |
| POST `/api/v1/auth/password`                                  | Пользовательская сессия       | 204; currentPassword + newPassword, отзывает все сессии                        | Своя учётная запись                                                         |
| GET `/api/v1/users`                                           | administrator                 | items, текущий предел 1000 пользователей                                       | `identity.read`                                                             |
| POST `/api/v1/users`                                          | administrator                 | 201; name/password/administrator                                               | `identity.manage`, с ограничением назначения полномочий                     |
| PATCH `/api/v1/users/{id}`                                    | administrator                 | 200; enabled и/или password; не изменение administrator                        | `identity.manage`                                                           |
| GET `/api/v1/access-groups`                                   | administrator                 | Группы с members/grants; до 100 групп                                          | `identity.read`                                                             |
| POST `/api/v1/access-groups`                                  | administrator                 | 201; name                                                                      | `identity.manage`                                                           |
| PUT / DELETE `/api/v1/access-groups/{id}/members/{userId}`    | administrator                 | 204; добавить/убрать membership                                                | `identity.manage`, membership не обходит delegation ceiling                 |
| PUT / DELETE `/api/v1/access-groups/{id}/grants/{repository}` | administrator                 | 204; access read/write либо снять grant                                        | `policy.manage` + разрешение делегировать конкретные actions/resources      |

CORS: OPTIONS для `/api/v1/*` и `/health/ready` проверяет origin/method/headers без Bearer. Это не разрешение на саму операцию; см. [EXTERNAL_UI](EXTERNAL_UI.md). `/console/` — статический клиент, не API управления.

## 2. Загрузки, задания и байты — реализовано

| Метод и путь                          | Текущий доступ             | Контракт / повтор                                                                                 | Целевое право                            |
| ------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| POST `R/uploads`                      | write                      | 201, descriptor; Idempotency-Key обязателен, конфликт другого descriptor                          | `upload.create`                          |
| GET `R/uploads/{id}`                  | write + own                | Состояние собственной сессии                                                                      | `upload.read` + own                      |
| DELETE `R/uploads/{id}`               | write + own                | 200, отменяет pending; опубликованный объект не удаляет                                           | `upload.cancel` + own                    |
| PUT `R/uploads/{id}/content`          | write + own                | 200, целый octet-stream с проверкой размера/SHA и публикацией. После потери ответа сначала status | `upload.write` + `upload.complete` + own |
| GET `R/uploads/{id}/parts`            | write + own                | partBytes и принятые parts; размер части 8 MiB                                                    | `upload.read` + own                      |
| PUT `R/uploads/{id}/parts/{index}`    | write + own                | 204; X-Content-SHA256, повтор той же части безопасен; другой hash — 409                           | `upload.write` + own                     |
| POST `R/uploads/{id}/complete`        | write + own                | 200; повтор завершённой сессии возвращает опубликованный результат                                | `upload.complete` + own                  |
| POST `R/uploads/{id}/complete-async`  | write + own                | 202, durable job; публикация подтверждается отдельно                                              | `upload.complete` + own                  |
| GET `/api/v1/jobs/{id}`               | write в repo задания + own | queued/running/completed/failed, attempts и errorCode                                             | `job.read` + own                         |
| GET `R/artifacts`                     | read                       | items/next; limit 1–100, по умолчанию 50, after                                                   | `artifact.list`                          |
| GET `R/artifacts/{id}`                | read                       | Только available; descriptor, не bytes                                                            | `artifact.read`                          |
| GET / HEAD `R/artifacts/{id}/content` | read                       | GET: 200/206/304/416, ETag, Range/If-Range. HEAD не передаёт body и игнорирует Range              | `content.read`                           |

Upload owner привязан к principal. Долговечность сейчас — local filesystem + PostgreSQL; наличие маршрута resume не означает сохранность после потери диска/узла. Вся схема восстановления: [TRANSFER_RECOVERY](TRANSFER_RECOVERY.md).

## 3. Каталог, metadata и ссылки — реализовано

| Метод и путь                                | Текущий доступ                | Контракт / граница                                                                                      | Целевое право                                                                     |
| ------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| GET `R/artifacts/{id}/annotations`          | read                          | revision, labels, metadata, collections                                                                 | `annotation.read`                                                                 |
| PUT `R/artifacts/{id}/annotations`          | read + write                  | expectedRevision + value; CAS, 409 при конфликте                                                        | `annotation.write` + `artifact.read`                                              |
| POST `R/artifacts/{id}/package`             | read + write                  | Читает и валидирует исходный UPack; регистрирует неизменяемую идентичность                              | `package.publish` + `artifact.read`                                               |
| GET `R/packages`                            | read                          | group/name, sort/direction/groupBy, after/limit; items/groups/next                                      | `package.read`                                                                    |
| GET `R/assets`                              | read                          | prefix; items, текущий предел 1000, полноценного cursor нет                                             | `asset.read`                                                                      |
| GET / HEAD `R/assets/page`                  | read                          | prefix/after/limit; items/next, до 100; literal prefix и UTF-8 порядок, [контракт](ASSET_PAGINATION.md) | `asset.read`                                                                      |
| GET `R/asset?path=…`                        | read                          | Текущий path/revision/artifactId                                                                        | `asset.read`                                                                      |
| PUT `R/asset`                               | read + write                  | path/artifactId/expectedRevision; 0 для создания, CAS                                                   | `asset.write` + `artifact.read` исходника                                         |
| GET `R/asset/history?path=…&before=…`       | read                          | До 50 ревизий и next                                                                                    | `asset.read`                                                                      |
| GET `R/asset/revision?path=…&revision=…`    | read                          | Точная ревизия и artifactId                                                                             | `asset.read`                                                                      |
| POST `R/asset/restore`                      | read + write                  | path/sourceRevision/expectedRevision; создаёт новую revision, не меняет старый blob                     | `asset.restore` + `asset.read` + `artifact.read`                                  |
| GET `R/search`                              | read                          | q/label/collection/after; до 100 items и next                                                           | `artifact.list`; дополнительные metadata scopes при расширении возвращаемых полей |
| GET `R/audit?after=…`                       | write                         | До 100 событий каталога; after — sequence, не аудит всех auth/download событий                          | `audit.read`                                                                      |
| POST / DELETE `R/artifacts/{id}/references` | read + write, reference owner | 204; JSON body key, ссылка принадлежит principal                                                        | `reference.write` + `artifact.read`                                               |

Пустой `group=` выбирает корневую группу; отсутствие group — все группы. Cursor пакетов связан с параметрами запроса, страницы не образуют snapshot. SDK допускает package page и own permissions до 8 MiB; остальные JSON-ответы до 2 MiB. Эти различия сохраняются до отдельного совместимого изменения.

Отдельного CRUD для schemas, labels и collections пока нет: labels/collections — ограниченные поля annotations. Нет REST-управления репозиториями и нет native удаления опубликованного содержимого.

## 4. Legacy — реализован только поднабор чтения

| Метод и путь                                                        | Текущий доступ   | Поведение                                                                   |
| ------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------- |
| GET / HEAD `/upack/{feed}/download/{group}/{name}/{version}`        | read в feed      | Exact UPack; group может отсутствовать или состоять из нескольких сегментов |
| GET / HEAD `/upack/{feed}/download/{group}/{name}?latest`           | read в feed      | Старшая SemVer, включая prerelease в текущем адаптере                       |
| GET / HEAD `/api/packages/{feed}/download?group=…&name=…&version=…` | read в feed      | Однозначная версия UPack, group необязателен                                |
| GET / HEAD `/endpoints/{directory}/content/{path}`                  | read в directory | Текущая asset revision, исходные bytes                                      |

Bearer, X-ApiKey и Basic `api:KEY` принимаются текущим адаптером; пользовательский Basic и query-string keys не поддерживаются. Формы error/status пока native, полная совместимость не подтверждена. Целевое право всех этих downloads — `content.read` на разрешённую привязку объекта; внутренний resolve не должен случайно требовать полный `package.read/asset.read` или обходить selector. Legacy publication/list/metadata добавляются по отдельной [матрице совместимости](COMPATIBILITY.md), а не по придуманным native маршрутам.

## 5. Сервисные API и дальнейшие расширения

Маршруты A/B ниже реализованы с уточнениями: создание аккаунтов и назначение делегирования требуют локального serviceAdministrator; управление существующими целями допускает отдельные admin actions в пределах ceiling. PATCH меняет только enabled; effective permissions не возвращает policy revision. GET `/api/v1/service-accounts/{id}/audit` требует bootstrap либо service-audit.read. Текущие контракты: [ключи](SERVICE_KEYS.md), [делегирование и карта admin actions](SERVICE_DELEGATION.md). В этапе C уже работают assets/page и список/карточки логических репозиториев; остальные строки C–E остаются проектом и не входят в рабочую OpenAPI.

| Этап | Метод / область                                                           | Назначение и право                                                                                                                                                                                            |
| ---- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | GET `/api/v1/capabilities`                                                | Развёрнутые функции, gateway role, лимиты протокола; любой действующий credential. Не список чужих ресурсов.                                                                                                  |
| A    | GET `/api/v1/auth/permissions`                                            | Собственные effective bindings, profile, credentialId и serviceAdministration; клиентский UX, не замена серверному authorize.                                                                                 |
| B    | GET / POST `/api/v1/service-accounts`                                     | Cursor-list: bootstrap или фильтр service-account.read; создание: только bootstrap.                                                                                                                           |
| B    | GET / PATCH `/api/v1/service-accounts/{id}`                               | Карточка / enabled с expectedRevision: bootstrap либо service-account.read/manage. Policy меняется отдельным CAS-контрактом.                                                                                  |
| B    | GET / PUT `/api/v1/service-accounts/{id}/policy`                          | Bootstrap либо policy.read/manage; expectedRevision, точные bindings, ceiling для изменения.                                                                                                                  |
| B    | GET / POST `/api/v1/service-accounts/{id}/keys`                           | Metadata list / выдача pending key: bootstrap либо credential.read/manage. Secret только в первом ответе POST.                                                                                                |
| B    | GET `/api/v1/api-keys/{id}`                                               | Метаданные без hash/secret: bootstrap либо credential.read.                                                                                                                                                   |
| B    | POST `/api/v1/api-keys/{id}/rotate`                                       | Новый pending key, Idempotency-Key, прежние ограничения или сужение: bootstrap либо credential.manage + ceiling.                                                                                              |
| B    | POST `/api/v1/api-keys/{id}/revoke`                                       | Необратимый отзыв: bootstrap либо credential.manage + ceiling; повтор — 204.                                                                                                                                  |
| B    | POST `/api/v1/auth/activate-key`                                          | Доказательство владения pending credential; 204, без выдачи дополнительных прав.                                                                                                                              |
| B    | GET `/api/v1/api-keys/{id}/delegations`                                   | Bootstrap либо владелец самого key; до 64 записей, включая tombstones.                                                                                                                                        |
| B    | PUT / DELETE `/api/v1/api-keys/{id}/delegations/{accountId}`              | Только bootstrap, CAS expectedRevision; 200 grant/tombstone. PUT создания требует revision 0. [Контракт](SERVICE_DELEGATION.md).                                                                              |
| C    | GET `/api/v1/repositories` и `/{repository}`                              | Реализовано: собственные логические scopes, after/limit, карточка id/formats/permissions; managed repository.read, legacy собственные непустые grants. Настройки/создание не включены.                        |
| C    | Пагинация каталогов (assets/page и accounts/keys уже работают)            | Bounded pages, согласованный cursor, фильтрация ACL до LIMIT; старый ответ assets не менять молча.                                                                                                            |
| C    | POST `/api/v1/transfer-tickets`                                           | Узкий краткоживущий допуск к одному immutable объекту; право выдачи отдельно от content access. Контракт после проверки gateway audience/revoke.                                                              |
| D    | GET `R/events`; GET / POST `R/webhooks`; PATCH / DELETE `R/webhooks/{id}` | Cursor replay / подписки, `event.read` / `webhook.manage`, outbox, retry, подпись и журнал доставки.                                                                                                          |
| D    | Каталог schemas и типизированных metadata                                 | Версионированные схемы, ограниченная сложность; собственная policy, без исполнения пользовательского кода.                                                                                                    |
| E    | Управление retention / операции удаления                                  | Реализованы explicit permission, preview, fixed-selection apply и защита ссылок/истории; scheduler и отдельный online GC реализованы: [ONLINE_CLEANUP](ONLINE_CLEANUP.md). [Контракт](ARTIFACT_RETENTION.md). |
| E    | Статус replicas / gateways / очередей                                     | `system.observe`; управление квотами — отдельный операторский контракт, не параметр произвольного клиента.                                                                                                    |

OAuth/OIDC federation, S3/NuGet/npm/OCI adapters — потенциальные отдельные интеграции, не обещание совместимости. Они добавляются только при конкретном сценарии и используют те же authorizer/storage use cases.

## 6. Рецепты для клиентов

| Клиент                     | Рабочий маршрут сегодня                                                       | Целевая минимизация                                                                       |
| -------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| CI/CD                      | create upload → parts → complete или async job → register package / set asset | Publisher в одном repo, короткий срок ключа, отдельные identities dev/prod                |
| Агент развёртывания        | resolve package/asset → artifact content + Range/ETag                         | Downloader либо только content по закреплённому объекту; approved/channel policy отдельно |
| Индексатор / каталог       | packages/search/annotations                                                   | CatalogReader без content.read                                                            |
| Редактор metadata          | annotations GET/PUT с expectedRevision                                        | MetadataEditor без публикации и удаления                                                  |
| Внешняя браузерная консоль | login/me + native SDK, CORS exact origin                                      | Пользовательские сессии; machine secret не встроен в frontend                             |
| Мониторинг                 | authenticated health/ready                                                    | Observer, минимум информации для health, подробности отдельно                             |
| Интеграция по событиям     | Сейчас polling по доступным API                                               | Сначала авторизованный events cursor, затем подписанный webhook как уведомление           |
| ProGet-клиент              | Только реализованный legacy download                                          | Контрактные fixtures конкретных клиентов, без обязанности знать native API                |

## 7. Как поддерживать карту

При добавлении операции обновлять use case, runtime-схему, OpenAPI, SDK, право/ресурс в карте, негативные ACL-тесты и описание retry. HTTP method не определяет permission: GET jobs сегодня требует write, PUT annotations — read+write. Нельзя заменить эти проверки одним middleware «GET = read».

Экспортируемая OpenAPI содержит 130 операций, включая HEAD, liveness, сам endpoint спецификации и legacy downloads. Все имеют operationId, описание авторизации, retry и роли шлюза. Сервер при onReady и CI сверяют фактические маршруты со схемой; исключения ограничены точными static GET/HEAD. При сборке создаётся `packages/contracts/dist/openapi.json`. Правила и границы проверок: [API_CONTRACT_GUARD](API_CONTRACT_GUARD.md), [ADR 0018](adr/0018-executable-api-inventory.md).

Discovery: GET/HEAD `/api/v1/repositories` возвращает items/next (до 100), GET/HEAD `/api/v1/repositories/{repository}` — собственную карточку или 404. Это projection прав, не глобальный реестр storage и не право читать bytes. [Точные правила и SDK](REPOSITORY_DISCOVERY.md).

Ревизионные вложения сборки: GET/HEAD/PUT `/api/v1/repositories/{repository}/artifacts/{id}/attachments` и GET/HEAD `/attachments/history`. Метаданные и произвольные метки используют существующий annotations API. [Права, SDK и сценарии](BUILD_DETAILS.md).

Логическое удаление и retention preview/apply реализованы в [ARTIFACT_RETENTION](ARTIFACT_RETENTION.md): managed-only artifact.delete, CAS аннотаций, пины истории и receipts. OpenAPI 0.12.0, 130 операций, миграции 13/14. Реестр/настройки/квоты репозиториев, SDK distribution, identity delegation/SSO и глобальное управление очередями остаются отдельными этапами.

Настройки хранения: `GET/PUT repositories/{repository}/storage/policy`, `GET storage/usage`, `GET storage/preview`, `POST storage/run`, `GET storage/events`. Surface catalog, права storage.read/manage, artifact.delete и diagnostics.read по операции. [Контракт](STORAGE_POLICIES.md).
