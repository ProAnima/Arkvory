# Архитектура

## Подход

Модульная архитектура с направлением зависимостей внутрь: предметные правила → сценарии и порты → внешние адаптеры → точки сборки. Наличие TypeScript-интерфейса само по себе не делает код чистым: домен должен оставаться независимым от инфраструктуры и её форматов.

Базовый стек: TypeScript strict, Node.js 24 LTS, npm workspaces. Для HTTP используется Fastify, для каталога и устойчивых completion jobs — PostgreSQL. Консоль написана на TypeScript и обращается через SDK; файловые шлюзы Nginx и конкретный HA blob-store ещё не реализованы.

## Направление зависимостей

| Модуль         | Разрешённые внутренние зависимости             | Что запрещено                                               |
| -------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| domain         | Нет                                            | HTTP, БД, Node/browser globals, внешние runtime-библиотеки  |
| application    | domain                                         | Конкретные адаптеры, transport DTO, глобальная конфигурация |
| contracts      | Нет                                            | Домен, application, storage и HTTP server framework         |
| infrastructure | application, domain                            | Приложения, UI и SDK                                        |
| sdk            | contracts                                      | Серверные пакеты и Node-only API                            |
| apps/api       | application, domain, contracts, infrastructure | Другие apps и SDK                                           |
| apps/worker    | application, domain, infrastructure            | HTTP/Web/SDK                                                |
| apps/scheduler | application, domain, infrastructure            | HTTP/Web/SDK                                                |
| apps/web       | sdk, contracts                                 | Все серверные пакеты и другие apps                          |

Импорты типов также соблюдают границы. Межпакетный доступ — по workspace-имени через `src/index.ts`; даже разрешённый соседний пакет не открывает все свои внутренние файлы. Граф проверяется dependency-cruiser. Для domain/application дополнительно запрещены runtime-зависимости на сторонние пакеты и Node builtins; `import type` не должен использоваться для обхода модели.

В contracts допускаются библиотеки runtime-схем после выбора подхода; в SDK — browser-compatible зависимости по необходимости. JSON/wire DTO не обязаны совпадать с domain objects. Преобразования на границах явные.

## Ответственность слоёв

**Domain.** Идентичность пакета, политика версий, допустимость перехода состояния, правила меток и удаления. Детерминированные функции/объекты. Время и случайность передаются извне.

**Application.** PublishPackage, CompleteUpload, ResolveDownload, UpdateMetadata, ScheduleTransfer. Сценарии оркестрируют порты и проверяют права. Не держат SQL-транзакцию на протяжении сетевой передачи. Только необходимые интерфейсы, без заготовок на все будущие операции.

**Infrastructure.** Адаптер PostgreSQL, backend blob-store, хеширование/архивы, event outbox, чтение метрик, идентификаторы и часы. Порты должны явно описывать устойчивость записи, отмену и ошибки; реализации проходят общий набор контрактных тестов.

**Composition roots.** Apps валидируют конфигурацию, создают адаптеры и сценарии, регистрируют lifecycle/shutdown. HTTP handlers переводят запрос в типизированный сценарий и результат в ответ. Не следует переносить SQL и правила публикации в routes.

## Содержимое и управление

PostgreSQL хранит каталог, права, ревизии, состояния загрузок/задач, outbox. Blob-store хранит исходные байты; API не читает файлы целиком в память. Шлюз раздаёт разрешённый неизменяемый blob. Внешние приложения не являются промежуточными узлами передачи или обязательными серверами авторизации.

LocalBlobStore — профиль одного сервера. HA использует проверенное отказоустойчивое хранилище с документированными гарантиями и доступные копии БД/входного адреса. Выбор схемы и провайдера оформляется ADR до обещаний о доступности.

## Правила изменений

Расширение авторизации сервисов проектируется внутри существующих слоёв: stable service account, credentials, action/resource bindings и общий application authorizer для HTTP API и worker. Новые границы и миграция старых read/write описаны в [ADR 0016](adr/0016-service-access-and-api-evolution.md); широкая модель остаётся proposed, первый рабочий профиль принят в [ADR 0017](adr/0017-managed-service-keys.md): root bootstrap, точные repository actions, managed credentials и повторная проверка mutations перед commit. [Карта API](API_MAP.md) отделяет работающие маршруты от планируемых.

- Новый пакет создаётся только с конкретной ролью, владельцем правил и разрешёнными зависимостями.
- Общее поведение извлекается после появления реального повторения; не создаём универсальный framework заранее.
- Новые брокер/БД/сервис требуют обоснования: какую измеренную проблему они решают и как восстанавливаются.
- Границы API, долговечность, операции удаления, топология HA и протокол очереди меняются через ADR и проверяемые сценарии.
- Размер каталога, потоков и очередей должен быть ограничен конфигурацией и доступной ёмкостью.

## Текущее состояние

Проект backup/recovery: единая точка БД/blobs, durable backup pins для GC, отдельный локальный агент и независимый recovery entrypoint. Границы, failure semantics и будущие API — в [ADR 0037](adr/0037-consistent-backup-and-recovery.md) и [BACKUP_RECOVERY](BACKUP_RECOVERY.md). Это не реализованный runtime; текущие reader pins не защищают резервные копии.

Фоновая физическая очистка реализована отдельными domain/application/SQL модулями, API/SDK и UI. Неблокирующие per-object guards защищают активные uploads и shared content readers; writer запускает ограниченные порции. Миграции 16/17, динамическая политика и отсутствие SQL-транзакций вокруг filesystem I/O: [ADR 0035](adr/0035-online-cleanup.md), [эксплуатация](ONLINE_CLEANUP.md).

В infrastructure добавлен BandwidthGovernor — локальный исполнитель upload/download бюджета и квоты принципала. API подключает его к HTTP-потокам; application/storage и worker не зависят от HTTP pacing. AdmissionQueue ограничивает также активные операции принципала. Контракт и граница одного процесса: [ADR 0008](adr/0008-gateway-bandwidth-budgets.md).

Реализованы domain/application, нативный HTTP API, PostgreSQL с миграциями, LocalBlobStore, multipart/resume, каталог и история assets, SDK, консоль, completion worker и скачивание по ID артефакта, идентичности UPack и пути файла. Один API владеет standalone-БД. Распределённый scheduler и HA остаются будущими ролями. Рабочие контракты и ограничения: [CORE_RUNBOOK](CORE_RUNBOOK.md), [LIFECYCLE_AND_CATALOG](LIFECYCLE_AND_CATALOG.md), [ADR 0006](adr/0006-asset-history-and-restore.md).

Учётные записи, группы и сессии добавлены в тех же слоях: domain проверяет идентификаторы и точные repository grants, application определяет сценарий/порт, infrastructure реализует PostgreSQL и хеширование. API проверяет сессию и собирает principal при каждом запросе; UI использует SDK. Порядок и группировка списка UPack задаются чистой функцией application. [ADR 0011](adr/0011-users-groups-and-package-browser.md).

Профиль read gateways сохраняет существующие границы: composition root API выбирает роль и связывает PostgresDownloadLease с доступностью локального governor. Domain/application не зависят от leases раздачи. Writer остаётся один, readers используют тот же согласованный root; миграция 5 и mode/maintenance barriers защищают конфигурацию. [ADR 0009](adr/0009-leased-read-gateways.md), [эксплуатация](READ_GATEWAYS.md).

Контрактный guard composition root сверяет зарегистрированные HTTP routes с OpenAPI перед готовностью сервера. Metadata живёт в contracts и не исполняет ACL; авторизация остаётся в application/infrastructure. Спецификация экспортируется сборкой и не включается в браузерный bundle. [ADR 0018](adr/0018-executable-api-inventory.md).

Ограниченный delegation профиль принят в [ADR 0019](adr/0019-scoped-service-administration.md): точный operator key → target account, отдельные admin actions и ceiling, без цепочек. Application валидирует команду и передаёт Principal порту; infrastructure повторно разрешает authority в той же транзакции, где меняет grants/keys/policy и пишет audit. Domain хранит чистые типы/actions. Контракт и обновление: [SERVICE_DELEGATION](SERVICE_DELEGATION.md).

Файловые страницы выделены в небольшие application/infrastructure asset-page модули. Параметры и prefix bounds чистые, SQL seek и scope cursor находятся в адаптере; каталог/HTTP только вызывают сценарий. Новый API сохраняет прежний assets list. [ADR 0020](adr/0020-asset-cursor-pagination.md).

Discovery репозиториев — чистая application projection актуального Principal, не новая таблица/RepositoryStore. Coarse permission mapping вынесен из HTTP в application с прежними semantics. Domain добавляет repository.read, transport и SDK используют отдельный wire contract. [ADR 0021](adr/0021-repository-discovery.md).

Клиентская очередь скачиваний живёт в SDK: DownloadQueue управляет расписанием, checkpointedDownload использует узкий DownloadStorage и существующий HTTP-клиент. OPFS/выбор конечного файла принадлежат web; domain/application/server не зависят от браузерного storage. [ADR 0022](adr/0022-client-download-queue.md).
Области и видимость API описываются contracts registry; application `operationVisible` проецирует применимость по действующим правам без HTTP/БД. API объединяет её с ролью шлюза и выдаёт advisory-каталог. SDK namespaces делегируют существующему транспорту. [ADR 0023](adr/0023-api-surfaces-and-operation-discovery.md), [контракт](API_SURFACES.md).

Именованные вложения используют отдельные domain rules, application AttachmentStore/BuildAttachments и PostgreSQL-адаптер. Байты проходят прежний transfer stack. Migration 12 хранит append-only snapshots и FK-пины targets. Web разделяет annotation editor, attachments controller и общий worker hash. [ADR 0024](adr/0024-build-attachments.md).

Границы и топологический порядок сборки теперь задаёт config/architecture.json. Проверяемые лимиты 500/300/100 и временные исключения описаны в [ADR 0027](adr/0027-executable-engineering-gates.md); команды, расширение и требования к комментариям — в [ENGINEERING_GATES](ENGINEERING_GATES.md). Существующий долг и порядок декомпозиции: [аудит 2026-09-25](ARCHITECTURE_AUDIT_2026-09-25.md).

SDK использует композицию: публичный ArkvoryClient делегирует группам операций, которые используют общий узкий HttpPort. HTTP-авторизация, ошибки и bounded parsing централизованы; transfer workflows сохраняют отдельные retry/checksum/abort-инварианты. Прежние flat methods и namespaces защищены проверкой строгого внешнего TS consumer. [ADR 0028](adr/0028-sdk-composition.md).

Маршруты upload/session/parts/completion выделены в upload-routes; UploadReceiver владеет ожиданием входящих bytes и deadline, получая bandwidth governor и диагностику через узкие порты. Эти механизмы остаются в HTTP-адаптере. LocalBlobStore отдельно обеспечивает точную длину завершённого чтения, включая Range и части. [ADR 0029](adr/0029-upload-lifetime-and-exact-reads.md).

Декомпозиция API composition root завершена: server связывает runtime, application factories, security/context, диагностику, фоновые задачи и feature registrars. Владение ресурсами и rollback централизованы в ApiRuntime; очереди и потоки закрываются до фоновой работы и pools. Регистраторы получают узкие зависимости; полная композиция не передаётся обработчикам. ServerConfig содержит webDirectory, окружение читается только loadConfig. ARCH-016/017 сняты без новых исключений. [ADR 0030](adr/0030-api-server-composition.md).

Управление установкой выделено в apps/deploy; единственная внутренняя зависимость — переносимый packages/contracts для протокола обновлений. UpdatePort отделяет переключение/откат от supervisor, GitHub и файловой системы. Привилегированный updater отделён от HTTP API защищённым mailbox: сервер принимает только check/configure/apply и читает статус. [ADR 0031](adr/0031-release-installation-and-supervision.md), [ADR 0038](adr/0038-update-notifications-and-control.md), [обновления](UPDATES.md).

Локальный мастер удалённой установки также принадлежит apps/deploy: HTTP session/формы, orchestration, SSH, команды платформ и туннель разделены. Клиентский пакет включает отдельный bundle; apps/cli и публичный API не получают SSH-credentials и не приобретают зависимость от deploy. Приватный туннель не является сетевой публикацией сервиса. [ADR 0036](adr/0036-local-remote-setup-wizard.md).

Комплекты запуска делегируют тому же deploy CLI. Релизный pipeline разделяет read-only сборку/приёмку и привилегированную публикацию уже проверенных байтов; состав и хеши assets проверяются перед публикацией. [ADR 0032](adr/0032-tested-release-bundles.md).

Удалённый `arkvoryctl` находится в `apps/cli`, зависит только от SDK/contracts и не имеет доступа к внутренним слоям сервера. CLI владеет профилями и локальными чекпойнтами; протокол, авторизация и сетевые повторы остаются в SDK. Устанавливается отдельными клиентскими пакетами с private runtime. [ADR 0034](adr/0034-remote-client-cli.md), [справка](CLI.md).

Единая идентичность Arkvory и чистая дорелизная установка описаны в [ADR 0040](adr/0040-arkvory-identity.md). Все имена конфигурации, SQL, сервисных ключей и локального состояния используют Arkvory; нормализатор альтернативных имён и зависимость worker от contracts удалены.

Восстановление download intents остаётся в web (OPFS/sessionStorage/Web Locks); SDK принимает paused jobs через явный restore. Staging сегментирован по 8 MiB. CLI packages publish оркестрирует upload/register с прежним receipt; metadata search реализован отдельным SQL-модулем через BrowseStore. [ADR 0041](adr/0041-client-recovery-search-and-publication.md).

Владение PostgreSQL-сессией выделено из каталога: StorageOwnership ограничивает период подтверждения locks, необратимо закрывает потерянное соединение и не допускает повторный claim. Это не межсерверный fencing и не репликация: [ADR 0042](adr/0042-bounded-storage-ownership.md).

Объектные locks uploads/GC и динамические content pins используют тот же инфраструктурный монитор SQL-сессии. PostgresJobLease отдельно связывает heartbeat/finish reservation с конечным локальным окном; worker отслеживает потери и ограничивает shutdown. [ADR 0043](adr/0043-operation-session-protection.md).

Проект независимой репликации отделяет переносимое mirror с авторитетным primary от синхронного HA с внешним fencing. Ordered outbox, durable pins/receipts, bounded transfer, новый worker и отдельная gateway composition добавляются только вместе с первым рабочим сценарием. Пока это проект, без новых runtime ролей или HTTP маршрутов: [ADR 0044](adr/0044-replication-profiles-and-control.md), [протокол](REPLICATION.md), [API](REPLICATION_API.md), [UI](REPLICATION_UX.md).
