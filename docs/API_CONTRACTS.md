# Контракты API

Уведомления и управление обновлением: `GET/HEAD /api/v1/system/updates`, `POST /api/v1/system/updates/requests`, только глобальный administrator. API публикует ограниченный запрос для привилегированного планировщика; `202` не означает завершённую установку. [UPDATES](UPDATES.md), [ADR 0038](adr/0038-update-notifications-and-control.md).

Документ задаёт целевые правила API. Реализованные native сценарии и ограничения: [CORE_RUNBOOK](CORE_RUNBOOK.md), [LIFECYCLE_AND_CATALOG](LIFECYCLE_AND_CATALOG.md). OpenAPI доступна по `/api/v1/openapi.json`; схемы и проверка ответов SDK находятся в contracts. Управление пользователями, группами и сервисными ключами реализовано. Первый профиль сервисов включает 18 repository permissions и отдельного bootstrap-оператора: [SERVICE_KEYS](SERVICE_KEYS.md). Делегирование на точные аккаунты уже реализовано: [контракт](SERVICE_DELEGATION.md). Распределённые transfers, schemas и events/webhooks остаются запланированными. Файловый каталог дополнен [отдельным cursor API](ASSET_PAGINATION.md).

Полная [карта API](API_MAP.md) связывает текущие методы, права, ответы и ограничения. Проект расширения: [сервисные аккаунты, permissions и ключи](API_ACCESS.md), [масштабирование и этапы внедрения](API_EVOLUTION.md). Проектные маршруты и policies не входят в работающую OpenAPI до реализации.

## Собственный API

Версия `/api/v1`; области: repositories, packages/versions, assets/revisions, schemas/labels/collections, uploads, transfers, references, events/webhooks/audit, administration.

- Runtime-схемы — источник wire-контрактов; OpenAPI и SDK согласуются с ними проверками.
- Пагинация курсором, стабильные ID, UTC, фильтры с лимитами сложности.
- Машинный код ошибки + request ID; без stack trace, секретов и физических путей в публичном ответе.
- Идемпотентность изменяющих операций с областью ключа и обнаружением конфликтов тела.
- Optimistic concurrency для редактируемых metadata и asset pointers.
- `unknown` до валидации; проверка ответа интеграции также обязательна.
- Полные 64-битные значения в JSON кодируются десятичными строками по явно описанной схеме; не передавать bigint напрямую в JSON.stringify.

Учётные записи: `POST /api/v1/auth/login` принимает имя и пароль без предварительного Bearer, возвращает сессию на 12 часов; новый вход отзывает самые старые сессии при превышении лимита 32 активных сессий пользователя. `POST /api/v1/auth/logout` отзывает текущую сессию. `GET /api/v1/auth/me` сообщает текущий principal и его эффективные `grants` по репозиториям с `permissions: read|write`. Список подходит для выбора репозитория в UI, но клиент всё равно должен обрабатывать отзыв прав при следующем запросе. Администратор через `/api/v1/users` и `/api/v1/access-groups` создаёт пользователей/группы, отключает аккаунты, меняет пароли, membership и права группы на репозиторий. Права пересчитываются при каждом запросе. Контракт и безопасность: [ADR 0011](adr/0011-users-groups-and-package-browser.md).

Пользователь с действующей сессией может вызвать `POST /api/v1/auth/password` с `currentPassword` и `newPassword`. Ответ `204` означает, что все его сессии отозваны и нужен новый вход; неверный текущий пароль возвращает `401` с `reason: current_password_invalid` и `details` для `/currentPassword`, сервисный ключ — `403`. Истёкшая или отозванная сессия на этом маршруте — `401` с причиной сессии, а не пароля. См. [ADR 0012](adr/0012-account-password-change.md).

Публичный login имеет отдельный допуск до чтения тела: не более 16 активных запросов на API-процесс, превышение — `503/busy`, `Retry-After: 2` и закрытие соединения. На получение полного JSON-тела отводится 10 секунд абсолютного времени; превышение закрывает соединение, даже если клиент продолжает передавать отдельные байты. Этот бюджет не занимает общий лимит защищённых запросов (`ARKVORY_MAX_REQUESTS`, по умолчанию 128). После разбора тела login и регистрация проходят token bucket по адресу клиента и, для login, backoff учётной записи; отказ — `429`, `code: rate_limited`, `Retry-After` в секундах, без проверки пароля. Анонимные login/регистрация и аутентифицированная работа с паролями (смена своего пароля, создание и сброс администратором) используют разные bounded password gates. Это локальные ограничения процесса, не распределённая защита от DDoS. [IDENTITY](IDENTITY.md), [ADR 0049](adr/0049-token-and-account-security.md).

Каталог `GET /api/v1/repositories/{repository}/packages` поддерживает фильтры `group`, `name`, сортировку `sort=group|name|version`, `direction=asc|desc`, группировку `groupBy=none|group|package` и курсор `after`. Ответ содержит `items`, `groups` и `next`; группы ссылаются на элементы текущей страницы через `artifactIds`, чтобы не дублировать manifest. При `groupBy=none` список групп пуст. Размер страницы: 50 по умолчанию, от 1 до 100 через `limit`. При переходе по `next` фильтры и порядок сохраняются. Добавления между страницами не образуют снимок каталога. См. [ADR 0013](adr/0013-package-cursor-pagination.md).

Классы ошибок ([ADR 0048](adr/0048-operability.md), [ADR 0051](adr/0051-error-contract.md)): `ArkvoryError` сохраняет свой код и причину; ошибки запроса Fastify — `invalid_input` с причиной и своим статусом (см. [Ошибки](#ошибки)); `ENOSPC`/`EDQUOT` и disk full PostgreSQL — 507 `capacity_exceeded/storage_full`; потеря соединения с PostgreSQL, его остановка, перегрузка соединений, statement timeout и отмена — 503 `unavailable` с `Retry-After: 2`; всё прочее — 500 `internal` без Retry-After. Клиенту возвращается только фиксированное сообщение; причина сбоя (`errorName`, `errno`, `sqlstate`) пишется в журнал под тем же `requestId`. SDK повторяет 408/429/502/503/504 и сетевые сбои, но не 500.

Здоровье: `GET /health/live` — liveness процесса; `GET /health/status` — публичная готовность для балансировщика, ответ строго `{"status":"ready"}` (200) или `{"status":"unavailable"|"draining"}` (503, Retry-After); `GET /health/ready` — аутентифицированная подробная готовность, при drain — 503. Оба health-маршрута не занимают бюджет `ARKVORY_MAX_REQUESTS`. После SIGTERM/SIGINT сервер в течение `ARKVORY_DRAIN_TIMEOUT_MS` даёт завершиться принятым запросам, а новые получает 503 `busy` с `Retry-After` и `Connection: close`.

## Ошибки

Тело любого ответа 4xx/5xx — конверт `NativeError` (единственная схема в `packages/contracts/src/errors.ts`), включая 404 неизвестного маршрута, 405 и 416. Обязательные поля прежние: `code` (enum), `message` (фиксированный английский текст для оператора, не локализуется и не разбирается), `requestId` (равен `X-Request-Id`). Необязательные, добавлены аддитивно [ADR 0051](adr/0051-error-contract.md):

- `reason` — уточнение кода из закрытого набора этого кода (таблица ниже); клиент обязан терпеть неизвестные значения и тогда опираться на `code`;
- `details` — до 16 элементов `{field, problem}`; `field` — JSON Pointer в тело (`/name`, `/value/labels`, `/policy/quotaBytes`) или имя параметра пути/запроса без `/` (`stage`, `limit`); `problem` — `required`, `unknown_field`, `type`, `format`, `length`, `range`, `invalid`. Отправленные значения не возвращаются;
- `retryAfterSeconds` — только вместе с заголовком `Retry-After` (429 и 503), то же число секунд; для `busy`/`unavailable` без оценки — 2.

| `code`               | HTTP                    | `reason`                                                                                                                                                                                                                                                                                                                                                                           | Retry-After |
| -------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `invalid_input`      | 400, 405, 413, 415, 416 | `validation` (400, значение не прошло проверку; поля в `details`), `malformed_json` (400), `body_too_large` (413, JSON больше 64 KiB), `unsupported_media_type` (415), `method_not_allowed` (405 + `Allow`, путь есть с другим методом), `range_not_satisfiable` (416 + `Content-Range: bytes */size`)                                                                             | нет         |
| `not_found`          | 404                     | `route_not_found` — нет операции по этому пути (до аутентификации, URL не отражается); без причины — нет объекта или он не виден вызывающему                                                                                                                                                                                                                                       | нет         |
| `conflict`           | 409                     | `upload_expired`, `upload_state` (загрузка опубликована, отменена или не в ожидании), `revision_mismatch` (CAS: аннотации, вложения, путь, политика, сервис, делегирование), `version_exists`, `part_mismatch`, `parts_incomplete`, `idempotency_mismatch`, `already_exists` (имя пользователя, группы, сервиса), `stage_limit`, `state_conflict` (прочие несовместимые состояния) | нет         |
| `forbidden`          | 403                     | `permission_missing`, `read_only_token`, `credential_revoked` (ключ оператора/сервиса отозван, истёк или учётная запись выключена), `session_required`, `administrator_required`, `registration_disabled`, `origin_not_allowed` (CORS)                                                                                                                                             | нет         |
| `unauthorized`       | 401                     | `invalid_credentials` (вход: имя, пароль или выключенная учётная запись — неразличимо), `current_password_invalid`, `credential_missing`, `credential_invalid` (неизвестный, отозванный или неверной формы), `session_expired`, `token_expired` (PAT или управляемый ключ)                                                                                                         | нет         |
| `capacity_exceeded`  | 507                     | `storage_quota`, `storage_full`, `account_limit`, `group_limit`, `membership_limit`, `grant_limit`, `key_limit`, `token_limit`, `delegation_limit`, `catalog_limit`, `queue_full`, `transfer_limit`                                                                                                                                                                                | нет         |
| `integrity_mismatch` | 422                     | —                                                                                                                                                                                                                                                                                                                                                                                  | нет         |
| `busy`               | 503                     | `request_limit` (бюджет запросов процесса или входа); прочие без причины                                                                                                                                                                                                                                                                                                           | да          |
| `unavailable`        | 503                     | `feedback_disabled`, `hub_unreachable`                                                                                                                                                                                                                                                                                                                                             | да          |
| `rate_limited`       | 429                     | `login_attempts`, `registration_attempts`, `password_attempts`, `feedback_attempts`                                                                                                                                                                                                                                                                                                | да          |
| `read_only`          | 405                     | — (`Allow: GET, HEAD`, шлюз чтения)                                                                                                                                                                                                                                                                                                                                                | нет         |
| `internal`           | 500                     | —                                                                                                                                                                                                                                                                                                                                                                                  | нет         |

Правила совместимости: новые причины, `details`-проблемы и необязательные поля добавляются аддитивно одновременно в domain и contracts (равенство наборов проверяет unit-тест) и в эту таблицу. Новый `code`, изменение статуса или смысла существующих кода/причины, удаление причины — только через ADR. Клиент обрабатывает неизвестный `code` по классу HTTP-статуса, неизвестную `reason` — как её отсутствие, и не показывает `message` пользователю как локализованный текст. Неизвестный маршрут отвечает 404 одинаково с учётными данными и без них; аутентификация проверяется только для существующих операций.

Учётные данные: при отказе `resolve` сервер одним индексным запросом по дайджесту без фильтра срока определяет `session_expired`/`token_expired`; для управляемых ключей — только при совпадении секрета. Отозванный, неизвестный или принадлежащий выключенной учётной записи токен — `credential_invalid`. Имя учётной записи при входе не раскрывается.

## Байтовые передачи

`GET /health/ready` требует прежнюю сервисную авторизацию и дополнительно возвращает агрегаты `transfers.uploads/downloads`: admission и bandwidth. Схема в contracts/OpenAPI, смысл счётчиков и доступ: [TRAFFIC_CONTROL](TRAFFIC_CONTROL.md). Не содержит индивидуальных ID, ключей или путей; byte counters сериализуются десятичными строками и сбрасываются при restart.

GET/HEAD, Content-Length, сильный ETag, Range/If-Range, 206/416 (416 — JSON-конверт `invalid_input/range_not_satisfiable`), сохранение исходных байтов. Токен закреплён за blob и допуском. Redirect к другому hostname допустим только при подтверждённой совместимости клиента и доступности сети.

Нативная очередь: создать задачу → получить состояние/URL polling или SSE → получить допуск → передать байты. Готовность задания и успешная публикация — разные состояния. Пауза download означает закрытие запроса и последующее продолжение клиентом, а не перенос TCP-соединения.

Multipart-сессия сохраняет состояние вне памяти процесса; принятая часть повторяется безопасно. Завершение проверяет полное покрытие, размер и хеш. SDK принимает AbortSignal, ограничивает повторы и не повторяет небезопасную запись без ключа идемпотентности.

Точный реализованный контракт SDK, лимиты повторов и требования к локальному commit скачивания: [TRANSFER_RECOVERY](TRANSFER_RECOVERY.md). HTTP-схемы и БД этим инкрементом не изменяются.

## Скачивание по пакету и пути файла

`GET|HEAD /api/v1/repositories/{repository}/packages/content?group=&name=&version=` выдаёт исходный архив точной версии UPack, без `version` — старшей стабильной SemVer-версии; диапазоны, стадии и prerelease описаны в [PROMOTION](PROMOTION.md). `GET|HEAD /api/v1/repositories/{repository}/asset/content?path=` выдаёт текущую ревизию файла. Операции `downloadPackageContent` и `downloadAssetContent` разрешают один неизменяемый артефакт на момент запроса и далее следуют контракту `artifacts/{id}/content`: право `content.read`, admission, bandwidth, Range/ETag/If-Range, 304/416. Новая версия или ревизия пути не меняет уже выдаваемые байты; ETag принадлежит выбранному содержимому, поэтому докачка через If-Range после смены цели получает полный ответ, а не смешанный файл.

Синхронный download не заменяется на `202 + job`. При перегрузке возможны ограниченное ожидание и Retry-After; клиент без retry требует запаса ресурсов/выделенной полосы.

## Внешние приложения

Клиенты на любом поддерживаемом языке используют HTTP/OpenAPI. Для TypeScript предоставляется версионированный SDK. Прямой доступ к БД, внутренним файловым путям и shared runtime internals запрещён. Внешние ссылки на версии защищают используемые компоненты от очистки.

Ссылки на скачивание ([ADR 0062](adr/0062-download-links.md)): `POST /api/v1/repositories/{r}/artifacts/{id}/links` выдаёт `{token, url, expiresAt}`, а `GET|HEAD …/artifacts/{id}/content?token=dtl_…` скачивает этот артефакт без заголовка `Authorization`. Это единственное место, где учётные данные принимаются в query; на других маршрутах параметр не действует, заголовок `Authorization` всегда имеет приоритет. В OpenAPI это вторая схема безопасности `downloadLink`.

Внешний браузерный UI может вызывать тот же `/api/v1` с `Authorization: Bearer <token>`. Серверная опция `ARKVORY_CORS_ORIGINS` разрешает только перечисленные точные HTTPS origins (loopback HTTP для разработки), максимум 16. Для `/api/v1/*` и `/health/ready` разрешён preflight `OPTIONS` без токена; методы: GET, HEAD, POST, PUT, PATCH, DELETE; заголовки: Authorization, Content-Type, Idempotency-Key, X-Content-SHA256, Range, If-Range, If-None-Match. Ответ содержит конкретный `Access-Control-Allow-Origin`, `Vary`, не содержит разрешения credentials и открывает клиенту `X-Request-Id`, ETag, Content-Length, Content-Range, Accept-Ranges, Content-Disposition, Location, Retry-After. Незаявленный origin получает 403, пустая конфигурация закрывает cross-origin запросы. Проверки Bearer и ACL выполняются независимо от CORS. [Настройка внешнего UI](EXTERNAL_UI.md), [ADR 0015](adr/0015-external-browser-ui.md).

Запросы с origin самого API проходят без настройки CORS, поэтому встроенная консоль работает при пустом `ARKVORY_CORS_ORIGINS`. Сравнение собственного origin использует Host запроса; на reverse proxy передавайте исходный Host клиента. Разный порт означает другой origin и требует явного разрешения.

Webhooks подписываются, могут дублироваться и повторяются через outbox. Event ID обеспечивает дедупликацию; API позволяет восстановить состояние при пропущенных событиях.

## Эталонные источники

- [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html)

## Профиль шлюза чтения

`ARKVORY_ROLE=reader` принимает только GET/HEAD; после аутентификации остальные методы получают 405, `Allow: GET, HEAD`, `code: read_only`, даже с write key. Прежние scopes чтения сохраняются. `/health/ready` содержит `role: api|reader`, `sharedDownloads: null|{slot,slots,active,leaseSeconds}`; `writable` всегда false на reader. Потеря ownership/lease — 503 с Retry-After, уже начатый поток прерывается. Консоль доступна на writer. Общая OpenAPI описывает операции writer; поддержка reader-профиля ограничена указанным правилом. [READ_GATEWAYS](READ_GATEWAYS.md).

Пустой `group=` фильтрует корневые пакеты; отсутствие group выбирает все группы. SDK сохраняет это различие. Заполнение очереди проверки паролей даёт 503/Retry-After. Identity-каталог ограничен 1000 пользователями (самостоятельная регистрация — 900), 100 группами и по 10 000 memberships/grants, превышение при добавлении — 507/capacity_exceeded.

Текущая OpenAPI описывает все операции со стабильными operationId, явными правами, retry и gateway metadata, включая [делегированное service administration](SERVICE_DELEGATION.md). Inventory маршрутов, включая HEAD, сверяется при startup и в CI; сборка сохраняет `packages/contracts/dist/openapi.json`. Правила расширения и границы: [API_CONTRACT_GUARD](API_CONTRACT_GUARD.md).

GET/HEAD списка и карточки репозитория реализованы в [REPOSITORY_DISCOVERY](REPOSITORY_DISCOVERY.md): отдельный managed action repository.read, legacy own scopes, bounded pagination и отсутствие data/admin escalation. Никакого SQL inventory всей площадки или автоматического импорта прав.

Readiness дополнен параметрами admission waitingCapacity, perPrincipalWaitingCapacity и timeoutMs без новых операций. Управление [клиентской очередью скачиваний](DOWNLOAD_QUEUE.md) не добавляет HTTP routes и не меняет права.
Каталог применимых операций и представления спецификации по областям реализованы в [API_SURFACES](API_SURFACES.md). `operations` фильтруется текущим credential и gateway, возвращает remaining conditions и не заменяет авторизацию рабочих запросов. URL/operationId и права существующих операций сохранены.

Вложения сборки расширяют surface catalog; данные вложений добавлены миграцией 12. До 32 ссылок на published artifacts того же репозитория, CAS и постраничная история. Annotation/read-write и content права разделены. [BUILD_DETAILS](BUILD_DETAILS.md), [ADR 0024](adr/0024-build-attachments.md).

Логическое удаление и retention preview/apply реализованы в [ARTIFACT_RETENTION](ARTIFACT_RETENTION.md): managed-only artifact.delete, CAS аннотаций, пины истории и receipts. Миграции 13/14. Реестр репозиториев, SDK distribution, identity delegation/SSO и глобальное управление очередями остаются отдельными этапами.

Хранение расширено `/storage/{policy,usage,preview,run,events}`: last-N scheduler, квоты резервирования, CAS и diagnostics. Миграция 15; явные managed storage/diagnostics actions. [STORAGE_POLICIES](STORAGE_POLICIES.md).
