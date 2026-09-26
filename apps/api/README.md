# api

Работающий Fastify composition root: конфигурация, сервисные ключи, нативные HTTP routes, Range/ETag, допуски передач, health и lifecycle. Запуск через npm run build, npm run migrate, npm start. См. CORE_RUNBOOK.

Legacy чтение UPack доступно также через ограниченный `/api/packages/{feed}/download`; точная поддержка описана в [матрице](../../docs/COMPATIBILITY.md).

[Запуск и API](../../docs/CORE_RUNBOOK.md), [границы](../../docs/ARCHITECTURE.md), [ADR](../../docs/adr/0004-native-standalone-core.md). Публичный вход — src/index.ts; runtime exports — dist/index.js и declarations.

Расширения 0.2: [части, каталог, очереди и обслуживание](../../docs/LIFECYCLE_AND_CATALOG.md).

Потоки full/multipart upload и native/legacy download подключены к общим квотам шлюза и клиента; readiness возвращает агрегаты. Переменные ARKVORY_*_BYTES_PER_SECOND и активные лимиты: [TRAFFIC_CONTROL](../../docs/TRAFFIC_CONTROL.md).

`ARKVORY_ROLE=reader` запускает тот же composition root с запретом HTTP-изменений и без консоли. Writer использует slot 0, readers — остальные slots с одинаковой shared policy. Локальные governors ограничены leased share; потеря lease закрывает допуск до restart. Настройка/обновление: [READ_GATEWAYS](../../docs/READ_GATEWAYS.md).

Управляемые service accounts/keys подключены через ServiceAccess и PostgresServices. Pending key разрешён только на activate-key; dpk credentials не используют file fallback. Новые маршруты: service-routes.ts. [Контракт и эксплуатация](../../docs/SERVICE_KEYS.md).

Contract guard сверяет onRoute inventory с OpenAPI в onReady для writer/reader. Исключения ограничены точными static GET/HEAD. Неописанный или отсутствующий route блокирует startup. [Правила](../../docs/API_CONTRACT_GUARD.md).

Service routes также предоставляют scoped delegation: handlers валидируют transport и передают команды ServiceAccess, без SQL и самостоятельного обхода ceiling. GET собственного grants допускается managed key; PUT/DELETE только bootstrap. Reader блокирует изменения прежним барьером. [Контракт](../../docs/SERVICE_DELEGATION.md).

GET/HEAD assets/page валидирует query, вызывает ArtifactCatalog и сохраняет текущие auth/admission/no-store правила. Старый assets route не меняется. [Контракт](../../docs/ASSET_PAGINATION.md).

Repository-routes разбирает ограниченные параметры списка/карточки и вызывает чистые application сценарии. Auth продолжает формировать актуальный Principal; repository.read не предоставляет bytes. Service-routes использует общий application effective-permissions вместо своей копии coarse mapping. [Контракт](../../docs/REPOSITORY_DISCOVERY.md).
