# Архитектура

## Подход

Модульная архитектура с направлением зависимостей внутрь: предметные правила → сценарии и порты → внешние адаптеры → точки сборки. Наличие TypeScript-интерфейса само по себе не делает код чистым: домен должен оставаться независимым от инфраструктуры и её форматов.

Базовый стек: TypeScript strict, Node.js 24 LTS, npm workspaces. Для HTTP используется Fastify, для каталога и устойчивых completion jobs — PostgreSQL. Консоль написана на TypeScript и обращается через SDK; файловые шлюзы Nginx и конкретный HA blob-store ещё не реализованы.

## Направление зависимостей

| Модуль         | Разрешённые внутренние зависимости                            | Что запрещено                                               |
| -------------- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| domain         | Нет                                                           | HTTP, БД, Node/browser globals, внешние runtime-библиотеки  |
| application    | domain                                                        | Конкретные адаптеры, transport DTO, глобальная конфигурация |
| contracts      | Нет                                                           | Домен, application, storage и HTTP server framework         |
| infrastructure | application, domain                                           | Приложения, UI, SDK и ProGet transport                      |
| proget-compat  | application, domain, contracts                                | Конкретная БД/blob-store, SDK, apps                         |
| sdk            | contracts                                                     | Серверные пакеты и Node-only API                            |
| apps/api       | application, domain, contracts, infrastructure, proget-compat | Другие apps и SDK                                           |
| apps/worker    | application, domain, infrastructure                           | HTTP/ProGet/Web/SDK                                         |
| apps/scheduler | application, domain, infrastructure                           | HTTP/ProGet/Web/SDK                                         |
| apps/web       | sdk, contracts                                                | Все серверные пакеты и другие apps                          |

Импорты типов также соблюдают границы. Межпакетный доступ — по workspace-имени через `src/index.ts`; даже разрешённый соседний пакет не открывает все свои внутренние файлы. Граф проверяется dependency-cruiser. Для domain/application дополнительно запрещены runtime-зависимости на сторонние пакеты и Node builtins; `import type` не должен использоваться для обхода модели.

В contracts допускаются библиотеки runtime-схем после выбора подхода; в SDK — browser-compatible зависимости по необходимости. JSON/wire DTO не обязаны совпадать с domain objects. Преобразования на границах явные.

## Ответственность слоёв

**Domain.** Идентичность пакета, политика версий, допустимость перехода состояния, правила меток и удаления. Детерминированные функции/объекты. Время и случайность передаются извне.

**Application.** PublishPackage, CompleteUpload, ResolveDownload, UpdateMetadata, ScheduleTransfer. Сценарии оркестрируют порты и проверяют права. Не держат SQL-транзакцию на протяжении сетевой передачи. Только необходимые интерфейсы, без заготовок на все будущие операции.

**Infrastructure.** Адаптер PostgreSQL, backend blob-store, хеширование/архивы, event outbox, чтение метрик, идентификаторы и часы. Порты должны явно описывать устойчивость записи, отмену и ошибки; реализации проходят общий набор контрактных тестов.

**Composition roots.** Apps валидируют конфигурацию, создают адаптеры и сценарии, регистрируют lifecycle/shutdown. HTTP handlers переводят запрос в типизированный сценарий и результат в ответ. Не следует переносить SQL и правила публикации в routes.

## Содержимое и управление

PostgreSQL хранит каталог, права, ревизии, состояния загрузок/задач, outbox. Blob-store хранит исходные байты; API не читает 5 ГБ целиком в память. Шлюз раздаёт разрешённый неизменяемый blob. Внешние приложения не являются промежуточными узлами передачи или обязательными серверами авторизации.

LocalBlobStore — профиль одного сервера. HA использует проверенное отказоустойчивое хранилище с документированными гарантиями и доступные копии БД/входного адреса. Выбор схемы и провайдера оформляется ADR до обещаний о доступности.

## Правила изменений

Расширение авторизации сервисов проектируется внутри существующих слоёв: stable service account, credentials, action/resource bindings и общий application authorizer для native/legacy/worker. Новые границы и миграция старых read/write описаны в [ADR 0016](adr/0016-service-access-and-api-evolution.md); широкая модель остаётся proposed, первый рабочий профиль принят в [ADR 0017](adr/0017-managed-service-keys.md): root bootstrap, точные repository actions, managed credentials и повторная проверка mutations перед commit. [Карта API](API_MAP.md) отделяет работающие маршруты от планируемых.

- Новый пакет создаётся только с конкретной ролью, владельцем правил и разрешёнными зависимостями.
- Общее поведение извлекается после появления реального повторения; не создаём универсальный framework заранее.
- Новые брокер/БД/сервис требуют обоснования: какую измеренную проблему они решают и как восстанавливаются.
- Границы API, долговечность, операции удаления, топология HA и протокол очереди меняются через ADR и проверяемые сценарии.
- Размер каталога, потоков и очередей должен быть ограничен конфигурацией и доступной ёмкостью.

## Текущее состояние

В infrastructure добавлен BandwidthGovernor — локальный исполнитель upload/download бюджета и квоты принципала. API подключает его к HTTP-потокам; application/storage и worker не зависят от HTTP pacing. AdmissionQueue ограничивает также активные операции принципала. Контракт и граница одного процесса: [ADR 0008](adr/0008-gateway-bandwidth-budgets.md).

Реализованы domain/application, нативный HTTP API, PostgreSQL с миграциями, LocalBlobStore, multipart/resume, каталог и история assets, SDK, консоль, completion worker и поднабор ProGet downloads. Один API владеет standalone-БД. Распределённый scheduler и HA остаются будущими ролями. Рабочие контракты и ограничения: [CORE_RUNBOOK](CORE_RUNBOOK.md), [LIFECYCLE_AND_CATALOG](LIFECYCLE_AND_CATALOG.md), [COMPATIBILITY](COMPATIBILITY.md), [ADR 0006](adr/0006-asset-history-and-restore.md).

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

SDK использует композицию: публичный DepotClient делегирует группам операций, которые используют общий узкий HttpPort. HTTP-авторизация, ошибки и bounded parsing централизованы; transfer workflows сохраняют отдельные retry/checksum/abort-инварианты. Прежние flat methods и namespaces защищены проверкой строгого внешнего TS consumer. [ADR 0028](adr/0028-sdk-composition.md).
