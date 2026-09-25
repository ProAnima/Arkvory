# Контракты API

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

Пользователь с действующей сессией может вызвать `POST /api/v1/auth/password` с `currentPassword` и `newPassword`. Ответ `204` означает, что все его сессии отозваны и нужен новый вход; неверный текущий пароль возвращает `401`, сервисный ключ — `403`. См. [ADR 0012](adr/0012-account-password-change.md).

Каталог `GET /api/v1/repositories/{repository}/packages` поддерживает фильтры `group`, `name`, сортировку `sort=group|name|version`, `direction=asc|desc`, группировку `groupBy=none|group|package` и курсор `after`. Ответ содержит `items`, `groups` и `next`; группы ссылаются на элементы текущей страницы через `artifactIds`, чтобы не дублировать manifest. При `groupBy=none` список групп пуст. Размер страницы: 50 по умолчанию, от 1 до 100 через `limit`. При переходе по `next` фильтры и порядок сохраняются. Добавления между страницами не образуют снимок каталога. См. [ADR 0013](adr/0013-package-cursor-pagination.md).

## Байтовые передачи

`GET /health/ready` требует прежнюю сервисную авторизацию и дополнительно возвращает агрегаты `transfers.uploads/downloads`: admission и bandwidth. Схема в contracts/OpenAPI, смысл счётчиков и доступ: [TRAFFIC_CONTROL](TRAFFIC_CONTROL.md). Не содержит индивидуальных ID, ключей или путей; byte counters сериализуются десятичными строками и сбрасываются при restart.

GET/HEAD, Content-Length, сильный ETag, Range/If-Range, 206/416, сохранение исходных байтов. Токен закреплён за blob и допуском. Redirect к другому hostname допустим только при подтверждённой совместимости клиента и доступности сети.

Нативная очередь: создать задачу → получить состояние/URL polling или SSE → получить допуск → передать байты. Готовность задания и успешная публикация — разные состояния. Пауза download означает закрытие запроса и последующее продолжение клиентом, а не перенос TCP-соединения.

Multipart-сессия сохраняет состояние вне памяти процесса; принятая часть повторяется безопасно. Завершение проверяет полное покрытие, размер и хеш. SDK принимает AbortSignal, ограничивает повторы и не повторяет небезопасную запись без ключа идемпотентности.

Точный реализованный контракт SDK, лимиты повторов и требования к локальному commit скачивания: [TRANSFER_RECOVERY](TRANSFER_RECOVERY.md). HTTP-схемы и БД этим инкрементом не изменяются.

## ProGet

Поверхности: `/api/packages/{feed}/...`, `/upack/{feed}/...`, `/endpoints/{directory}/...` и необходимые методы управления. Точную матрицу строим по реальным версиям Hub, CI/CD и остальных клиентов.

Сохраняем формы JSON, коды/заголовки, группы, регистр, latest/prerelease, авторизацию, правила overwrite и multipart Assets. Не заменяем существующий синхронный download на `202 + job`.

При перегрузке возможны ограниченное ожидание и Retry-After, но поддержку повторов проверяем для каждого клиента. Клиент без retry требует запаса ресурсов/выделенной полосы либо изменения клиента.

## Внешние приложения

Клиенты на любом поддерживаемом языке используют HTTP/OpenAPI. Для TypeScript предоставляется версионированный SDK. Прямой доступ к БД, внутренним файловым путям и shared runtime internals запрещён. Внешние ссылки на версии защищают используемые компоненты от очистки.

Внешний браузерный UI может вызывать тот же `/api/v1` с `Authorization: Bearer <token>`. Серверная опция `DEPOT_CORS_ORIGINS` разрешает только перечисленные точные HTTPS origins (loopback HTTP для разработки), максимум 16. Для `/api/v1/*` и `/health/ready` разрешён preflight `OPTIONS` без токена; методы: GET, HEAD, POST, PUT, PATCH, DELETE; заголовки: Authorization, Content-Type, Idempotency-Key, X-Content-SHA256, Range, If-Range, If-None-Match. Ответ содержит конкретный `Access-Control-Allow-Origin`, `Vary`, не содержит разрешения credentials и открывает клиенту `X-Request-Id`, ETag, Content-Length, Content-Range, Accept-Ranges, Content-Disposition, Location, Retry-After. Незаявленный origin получает 403, пустая конфигурация закрывает cross-origin запросы. Проверки Bearer и ACL выполняются независимо от CORS. Legacy-маршруты в этот CORS-контракт не входят. [Настройка внешнего UI](EXTERNAL_UI.md), [ADR 0015](adr/0015-external-browser-ui.md).

Запросы с origin самого API проходят без настройки CORS, поэтому встроенная консоль работает при пустом `DEPOT_CORS_ORIGINS`. Сравнение собственного origin использует Host запроса; на reverse proxy передавайте исходный Host клиента. Разный порт означает другой origin и требует явного разрешения.

Webhooks подписываются, могут дублироваться и повторяются через outbox. Event ID обеспечивает дедупликацию; API позволяет восстановить состояние при пропущенных событиях.

## Эталонные источники

- [ProGet Packages API](https://docs.inedo.com/docs/proget/api/packages)
- [Universal Feed API](https://docs.inedo.com/docs/proget/api/universal-feed)
- [Asset Directories API](https://docs.inedo.com/docs/proget/api/assets)
- [Multipart Assets](https://docs.inedo.com/docs/proget/api/assets/files/upload/multipart)
- [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html)

## Профиль шлюза чтения

`DEPOT_ROLE=reader` принимает только GET/HEAD; после аутентификации остальные методы получают 405, `Allow: GET, HEAD`, `code: read_only`, даже с write key. Прежние scopes чтения сохраняются. `/health/ready` содержит `role: api|reader`, `sharedDownloads: null|{slot,slots,active,leaseSeconds}`; `writable` всегда false на reader. Потеря ownership/lease — 503 с Retry-After, уже начатый поток прерывается. Консоль доступна на writer. Общая OpenAPI описывает операции writer; поддержка reader-профиля ограничена указанным правилом. [READ_GATEWAYS](READ_GATEWAYS.md).

Пустой `group=` фильтрует корневые пакеты; отсутствие group выбирает все группы. SDK сохраняет это различие. Все изменения паролей разделяют ограниченный допуск с login; заполнение очереди даёт 503/Retry-After. Identity-каталог ограничен 1000 пользователями, 100 группами и по 10 000 memberships/grants, превышение при добавлении — 507/capacity_exceeded.

Текущая OpenAPI содержит 123 операций со стабильными operationId, явными правами, retry и gateway metadata, включая [делегированное service administration](SERVICE_DELEGATION.md). Native/legacy/HEAD inventory сверяется при startup и в CI; сборка сохраняет `packages/contracts/dist/openapi.json`. Правила расширения и границы: [API_CONTRACT_GUARD](API_CONTRACT_GUARD.md).

GET/HEAD списка и карточки репозитория реализованы в [REPOSITORY_DISCOVERY](REPOSITORY_DISCOVERY.md): отдельный managed action repository.read, legacy own scopes, bounded pagination и отсутствие data/admin escalation. Никакого SQL inventory всей площадки или автоматического импорта прав.

Readiness дополнен параметрами admission waitingCapacity, perPrincipalWaitingCapacity и timeoutMs; OpenAPI document 0.10.0 сохраняет 123 операций. Управление [клиентской очередью скачиваний](DOWNLOAD_QUEUE.md) не добавляет HTTP routes и не меняет права ProGet-adapter.
Каталог применимых операций и представления спецификации по областям реализованы в [API_SURFACES](API_SURFACES.md). `operations` фильтруется текущим credential и gateway, возвращает remaining conditions и не заменяет авторизацию рабочих запросов. Native URL/operationId и legacy права сохранены.

Вложения сборки расширяют surface catalog; OpenAPI 0.10.0, 123 операций; данные вложений добавлены миграцией 12. До 32 ссылок на published artifacts того же репозитория, CAS и постраничная история. Annotation/read-write и content права разделены. [BUILD_DETAILS](BUILD_DETAILS.md), [ADR 0024](adr/0024-build-attachments.md).

Логическое удаление и retention preview/apply реализованы в [ARTIFACT_RETENTION](ARTIFACT_RETENTION.md): managed-only artifact.delete, CAS аннотаций, пины истории и receipts. OpenAPI 0.10.0, 123 операций, миграции 13/14. Реестр репозиториев, SDK distribution, identity delegation/SSO, online GC и глобальное управление очередями остаются отдельными этапами.

Хранение расширено `/storage/{policy,usage,preview,run,events}`: last-N scheduler, квоты резервирования, CAS и diagnostics. OpenAPI 0.10.0, 123 операции, миграция 15; явные managed storage/diagnostics actions. [STORAGE_POLICIES](STORAGE_POLICIES.md).
