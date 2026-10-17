# 0079. Модули расширения: явный реестр встроенных адаптеров

Статус: proposed. Owner: Ian Panaev. Дата: 2026-10-17. Решение меняет границы пакетов ([AGENTS.md](../../AGENTS.md), «Обязательные границы», п. 8) и способ сборки composition roots ([ADR 0030](0030-api-server-composition.md)); до решения владельца код не пишется. Связано с [ADR 0018](0018-executable-api-inventory.md), [ADR 0027](0027-executable-engineering-gates.md), [ADR 0060](0060-proanima-hub.md), [ADR 0071](0071-s3-backup-vault.md), [ADR 0080](0080-event-integrations.md).

## Контекст

Новые хранилища, протоколы, провайдеры входа и цели резервных копий подключаются сейчас правкой нескольких composition roots, и каждое подключение решается заново. Факты кода:

- **API.** `ApiRuntime` (`apps/api/src/api-runtime.ts`) сам создаёт `LocalBlobStore` и `PostgresCatalog`. `createProtocolServices` (`apps/api/src/protocol-services.ts`) связывает raw, Git LFS, npm и OCI с конкретным `LocalBlobStore` (`blobs.root` для staging, `blobs.checkSpace`), а не с портом. `registerProtocolRoutes` (`protocol-routes.ts`) регистрирует все протоколы безусловно: выключить неиспользуемый протокол нельзя.
- **Worker.** `apps/worker/src/runtime.ts` ещё раз создаёт `LocalBlobStore` и читает `process.env` сам, мимо типизированной конфигурации.
- **Резервные копии.** `FileVault.open` вызывается в `apps/backup/src/agent.ts`, `source.ts`, `vault-commands.ts` и `packages/infrastructure/src/vault-setup.ts`. S3-хранилище копий ([ADR 0071](0071-s3-backup-vault.md)) потребовало бы выбора реализации в четырёх местах.
- **Маршрутизация хранилищ.** Порт `BlobStore` (`packages/application/src/ports.ts`) уже несёт необязательный `backendId`, а `RoutedBlobStore` (`packages/infrastructure/src/routed-blobs.ts`) — список `StorageTarget`, но приложения его не используют (только `tests/storage-routing.test.mjs`). Жизненный цикл хранилища он узнаёт утиной типизацией (`hasLifecycle`, `isCollectable`): явного контракта запуска, готовности и сборки мусора у порта нет.
- **Инвентаризация маршрутов.** `apps/api/src/contract-guard.ts` вручную перечисляет исключения для `/v2/*`, `/lfs/:repository/...` и `/npm/:repository/*`. Флаги `GET /api/v1/capabilities` (`service-routes.ts`) тоже заданы руками и не отражают конфигурацию.
- **Вход.** `IdentityStore` (`packages/application/src/identity.ts`) объединяет вход по паролю, пользователей, группы и токены; `AccountOrigin` — только `'administrator' | 'self-registration'`. Внешнему провайдеру (LDAP, OIDC) подключиться некуда.
- **Схема.** Миграции идут одной линейной последовательностью (`SCHEMA_VERSION = 41`, `packages/infrastructure/src/schema-version.ts`, таблица `arkvory_migrations`). На ней держатся проверка схемы обновлений ([ADR 0059](0059-schema-updates-behind-verified-backup.md)) и реестр таблиц резервной копии `backup-tables.ts`. Таблицы протоколов уже имеют префиксы (`arkvory_oci_*`, `arkvory_lfs_*`, `arkvory_npm_*`).
- **Контрактные тесты.** Общего набора для реализаций `BlobStore` нет: `tests/local-blobs.test.mjs` проверяет только локальную реализацию. Принцип LSP из AGENTS.md пока ничем не проверяется.
- **Границы.** Пакеты и разрешённые связи задаёт `config/architecture.json`, `.dependency-cruiser.cjs` строит правила из него, а `scripts/policy/inventory.mjs` отклоняет незарегистрированные workspace и запрещённые зависимости в manifest.

## Решение

### 1. Что такое модуль

Модуль — единица **сборки**, а не загрузки кода. Он состоит из описания (`ModuleDescriptor`) и обычного кода в существующих слоях: порты и сценарии — в `application`, адаптеры — в `infrastructure`, HTTP — в `apps/api`. Composition root подключает описание, перечисляя его в явном списке своего файла `modules.ts`.

Инварианты:

- Нет загрузки произвольного кода: ни `import()` по пути или имени из конфигурации, ни обхода каталогов, ни `require` по строке. Конфигурация **выбирает** модули из встроенных в релиз и задаёт их параметры, но не добавляет новые. Это проверяет policy-тест: в `apps/*` и `packages/*` запрещён `import()` с аргументом, не являющимся строковым литералом.
- Нет service locator: модуль получает только зависимости, объявленные в `requires`, явными параметрами `create`. Полную композицию модулю не передают (как и обработчикам по ADR 0030).
- `domain` и `application` о модулях не знают: порты остаются у потребителя (DIP), модуль только связывает реализацию с портом.

### 2. Пакет `packages/extension-api`

Новый workspace `@proanima/arkvory-extension-api` с ролью «формат описания модуля и чистая проверка плана сборки». В `config/architecture.json` он стоит сразу после `packages/contracts`, `allowed: []`. Он входит в правила `pure-core-no-external-runtime` и `portable-layers-no-node`: Node и сторонние пакеты ему недоступны. Подключать его разрешено только `packages/infrastructure` и серверным `apps/api`, `apps/worker`, `apps/scheduler`, `apps/backup`. `sdk`, `web`, `cli`, `deploy`, `domain`, `application` и `contracts` его не получают.

Содержимое:

- `ModuleManifest`:
  - `id` — `[a-z][a-z0-9-]{1,31}`;
  - `kind` — закрытое объединение `storage-backend | protocol | identity-provider | backup-vault | event-sink`; новый вид вводится только через ADR;
  - `format: 1` — версия формата описания;
  - `core: boolean` — модуль нельзя выключить;
  - `roles` — в каких процессах модуль работает: `api`, `reader`, `worker`, `backup`;
  - `requires` и `provides` — имена возможностей, например `catalog`, `blob-store`, `staging`, `egress`, `http`, `metrics`;
  - `schema` — `{tablePrefix, steps}`: номера миграций модуля в общей последовательности;
  - `routes` — `{prefixes, apiOperations}`: префиксы вне `/api/v1` и `operationId` в `/api/v1`;
  - `metricPrefix` — `arkvory_<id>_`.
- `ModuleDescriptor<Kind, Config, Context, Instance>`: `manifest`, `parseConfig(input: unknown): Config` (бросает `ModuleConfigError` с машинным кодом и JSON-путём, без значений), `create(context: Context, config: Config): Instance`. Пока модуль не запущен, `create` не выполняет сетевого и дискового I/O.
- `ModuleLifecycle`: `start(signal: AbortSignal)`, `drain(deadlineMs)`, `stop()` (идемпотентен, вызывается и после неудачного `start`), `health(): ModuleHealth` (`ok | degraded | failed` и код).
- Чистая функция `planModules(descriptors, selection)` проверяет набор и возвращает план или список ошибок с кодами. Проверки: уникальные `id`; известные `kind` и `format`; модули `core` включены; каждое `requires` закрыто `provides` включённого модуля или корня; префиксы маршрутов и метрик не пересекаются; номера миграций не повторяются. План задаёт порядок запуска (топологический по `requires`, при равенстве — по `id`), обратный порядок остановки и отпечаток (`fingerprint`) — SHA-256 списка включённых `id` и нормализованной конфигурации без путей к секретам; хеш передаёт вызывающая сторона.

Типы контекста и экземпляра для каждого вида лежат рядом с реализациями, а не в `extension-api`. Для `storage-backend`, `backup-vault`, `identity-provider` и `event-sink` это `infrastructure`: например, `StorageBackendModule = ModuleDescriptor<'storage-backend', C, StorageContext, StorageBackend>`, где `StorageBackend` — `BlobStore`, явный `StorageLifecycle` и `StagingArea`. Для `protocol` это `apps/api`, потому что маршруты зависят от Fastify. Так `extension-api` остаётся переносимым, а виды — рядом с портами, которые они реализуют.

### 3. Реестр и конфигурация

- В каждом корне один явный список: `apps/api/src/modules.ts`, `apps/worker/src/modules.ts`, `apps/backup/src/modules.ts`. Policy-тест проверяет, что каждое описание, экспортированное `infrastructure`, перечислено хотя бы в одном корне, а в корне нет описаний, чьи `roles` его не включают.
- Выбор и параметры читаются из `ARKVORY_MODULES_FILE` (JSON `{"format": 1, "modules": {"<id>": {"enabled": true, "config": {...}}}}`) только в `loadConfig` корня. Неизвестный `id`, поле или нечитаемый файл останавливают запуск до захвата хранилища. Секреты в файле не хранятся, только пути к файлам секретов (как у зеркал и вебхуков). Без файла действуют значения по умолчанию, равные сегодняшнему поведению: локальное хранилище, файловое хранилище копий, все протоколы включены.
- **Один план на установку.** Процесс записи сохраняет отпечаток плана в БД (таблица `arkvory_module_plan`, одна строка, expand-only). Шлюз чтения и worker с другим отпечатком не становятся готовыми (`module_plan_mismatch` в readiness). Включение модуля, затрагивающего несколько ролей, — это перезапуск всех процессов, как смена `ARKVORY_MIRRORS_FILE`. Команда `arkvory configure --module <id> [--module-disable] [--module-config <file>]` пишет файл и перезапускает службы с откатом по образцу `--webhook`; это отдельный этап.

### 4. Жизненный цикл

Порядок в корне: разбор конфигурации всех модулей (без I/O) → `planModules` → `create` → `start` в порядке плана с сигналом остановки процесса → регистрация маршрутов → готовность. Ошибка любого шага останавливает уже запущенные модули в обратном порядке; это расширение отката `ApiRuntime`, а не новый механизм. При остановке: `preClose` прекращает приём работы (как `runtime.stop()` сейчас), затем `drain` с общим сроком, затем `stop` в обратном порядке, и только потом закрываются пулы.

Готовность: `failed` у модуля `core` или у модуля, нужного включённому модулю, — процесс не готов. `failed` или `degraded` у необязательного модуля (например, `event-sink`) видны в метриках и в `system/modules`, но не снимают процесс с балансировки. Метрики: `arkvory_module_info{module,kind}` и `arkvory_module_up{module}`. Собственные метрики модуль публикует только под своим `metricPrefix`; реестр метрик отклоняет чужие имена.

### 5. Данные и миграции

- Последовательность схемы остаётся одной. Модуль владеет своими шагами: номера выделяются в общей последовательности в том же PR, `SCHEMA_VERSION` растёт как сейчас. Новые таблицы модуля называются `arkvory_<id>_*`.
- **Миграции применяются независимо от того, включён ли модуль.** Тогда схема одинакова во всех установках одного релиза: проверка ADR 0059, восстановление в пустую цель и `migrate({upTo})` не зависят от конфигурации. Выключение модуля не удаляет данные, а включение не требует миграции. Правила expand/contract не меняются.
- Таблицы модуля входят в реестр `backup-tables.ts` или явно исключаются с причиной, как реестр площадок ADR 0077. Policy-тест сверяет таблицы с префиксом `arkvory_<id>_` из миграций с реестром.

### 6. HTTP

- Модуль `protocol` даёт `register(app, deps)` и `prefixes`. Исключения `contract-guard.ts` строятся из префиксов включённых модулей вместо ручного списка; пересечение префиксов отклоняет `planModules`.
- Операции модуля в `/api/v1` описываются в `contracts` статически, как все операции: OpenAPI и SDK одинаковы для всех установок релиза. Если модуль выключен, guard получает его `apiOperations` как ожидаемо отсутствующие, маршруты не регистрируются, ответ — обычный 404 `not_found`, а `capabilities` сообщает, что модуль выключен.
- ACL проверяет сервер, как и прежде: модуль использует общий `principal` и авторизатор `application`, своей модели прав у него нет.

### 7. Контрактные тесты (LSP)

У каждого порта, который реализует вид модуля, есть общий набор в `tests/contracts/`: `blob-store.mjs`, `vault.mjs` (`CaptureVault`, `ReadableVault`, `MaintainedVault`), затем `identity-provider.mjs` и `event-sink.mjs`. Набор — функция, принимающая фабрику реализации. Он проверяет:

- неизменяемость опубликованного blob и проверку при повторе `put`;
- точную длину чтения, включая Range и части;
- отмену через `Cancellation` и `AbortSignal`;
- поведение после `stop`, повтор `collect`;
- машинные коды ошибок.

Каждая реализация подключает набор своим тестовым файлом, зарегистрированным в `config/gates.json`. Реализации, которым нужна внешняя инфраструктура (S3-совместимое хранилище, LDAP), проверяются в отдельном гейте с контейнером. Отсутствие контейнера — невыполненная проверка, а не пропуск. Policy-тест сопоставляет каждое описание вида с файлом контрактного набора.

### 8. Существующий код как модули

| Модуль          | Вид               | `core` | Что меняется                                                                                                                                       |
| --------------- | ----------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upack`         | `protocol`        | да     | Маршруты пакетов и загрузок `/api/v1` остаются ядром продукта; описание даёт `apiOperations` и метрики                                             |
| `raw`           | `protocol`        | да     | `/api/v1/repositories/:repository/raw/*` (ADR 0064); staging через `StagingArea` вместо `blobs.root`                                               |
| `oci`           | `protocol`        | нет    | `/v2/*`, `arkvory_oci_*`; выключаемый                                                                                                              |
| `lfs`           | `protocol`        | нет    | `/lfs/:repository/*`, `arkvory_lfs_*`; выключаемый                                                                                                 |
| `npm`           | `protocol`        | нет    | `/npm/:repository/*`, `arkvory_npm_*`; выключаемый                                                                                                 |
| `local-storage` | `storage-backend` | нет    | `LocalBlobStore`; `ready`, `initialize`, `identity` и `checkSpace` уходят в явный `StorageLifecycle`, утиная типизация `RoutedBlobStore` убирается |
| `file-vault`    | `backup-vault`    | нет    | `FileVault.open` из четырёх мест заменяется выбором модуля в `apps/backup`                                                                         |
| `webhooks`      | `event-sink`      | нет    | Отправка ADR 0069 и подписки ADR 0080                                                                                                              |

Хотя бы одно хранилище (`storage-backend`) и одно хранилище копий (`backup-vault`, только в роли `backup`) обязательны; это проверяет `planModules`.

### 9. Будущие модули

- **S3-хранилище** (`s3-storage`, `storage-backend`). Живёт в отдельном workspace `packages/storage-s3` (allowed: `application`, `domain`, `extension-api`), чтобы сторонний HTTP- или подписывающий клиент не попал в общий `infrastructure`. Конфигурация: адрес, bucket, регион, путь к файлу ключа, файл УЦ. Модуль требует `egress`. Публикация успешна только после завершённого PUT с проверкой SHA-256 на стороне хранилища; `duplicate` — серверное копирование; `collect` идемпотентен. Модуль проходит `tests/contracts/blob-store.mjs` против MinIO в гейте `storage-s3`. Выбор хранилища для репозитория — через `backendId`, `RoutedBlobStore` и политики хранения. Долговечность и новая граница доверия требуют отдельного ADR; этот ADR задаёт только способ подключения.
- **LDAP / OIDC** (`identity-provider`). Из `IdentityStore` выделяется узкий порт `ExternalAuthenticator` (проверка учётных данных или кода авторизации → внешний субъект и группы), а также `AccountOrigin` `external:<provider>` с привязкой групп провайдера к группам доступа. OIDC добавляет операции `/api/v1/auth/oidc/{provider}/*` в `contracts`. Вход по паролю остаётся встроенным `core`-провайдером. Каждый провайдер — отдельный ADR: внешняя зависимость входа противоречит требованию, чтобы хранилище не зависело от клиентских систем для авторизации. Поэтому у сессий и сервисных ключей остаётся локальная проверка, а провайдер нужен только при входе.
- **S3-хранилище копий** ADR 0071 подключается вторым описанием `backup-vault` после принятия того ADR.

### 10. Безопасность и версии

- Модули — доверенный код, собранный в подписанный релиз (ADR 0060, Ed25519/minisign). Цепочка поставки та же, что у остального кода: `package-lock.json`, точные версии, `npm run gate -- security`, review. Узкие `requires` защищают от случайной связанности, но не изолируют вредоносный код: изоляции внутри процесса нет и не обещается. Расширения третьих сторон подключаются снаружи, через API и события (ADR 0080), а не внутри процесса.
- Модуль с исходящими соединениями использует общую политику `createEgressPolicy` (SSRF-правила ADR 0069) и объявляет `egress`. Через API расширить политику нельзя: только конфигурацией хоста.
- Версия модуля — версия релиза (модули поставляются вместе), отдельной матрицы совместимости нет. `format` описания меняется только вместе с `extension-api`: внешних потребителей у пакета нет.

### 11. Публичный контракт (аддитивно)

- `GET /api/v1/system/modules` (глобальный администратор): `id`, `kind`, `core`, `enabled`, `roles`, `health` (код), `version`, отпечаток плана. Конфигурацию и пути ответ не содержит.
- `GET /api/v1/capabilities` получает необязательное поле `modules: [{id, kind}]` — включённые модули с публичной поверхностью (протоколы, провайдеры входа). Его используют SDK, CLI и MCP (ADR 0081). Существующие `features` не меняются.
- OpenAPI, SDK (`client.system.modules()`) и CLI (`arkvoryctl doctor` показывает модули) обновляются в том же PR.

## Альтернативы

- **Плагины с диска** (каталог `plugins/`, `import()` по конфигурации). Отклонено: выполнение непроверенного кода в процессе с ключами и БД, обход подписи релиза, нестабильный ABI внутренних типов, лицензионные вопросы распространения.
- **DI-контейнер или service locator.** Запрещено AGENTS.md; связи становятся невидимыми для dependency-cruiser.
- **Отдельные сервисы на протокол или хранилище.** Нет измеренной необходимости; появились бы сеть, авторизация между сервисами и восстановление.
- **Оставить как есть.** Каждое новое хранилище — правки в 4+ корнях, утиная типизация и ручные списки в guard и `capabilities`.
- **Отдельная последовательность миграций на модуль.** Отклонено: проверка схемы ADR 0059 и восстановление опираются на одно число `SCHEMA_VERSION`.

## Последствия

- Один новый workspace и новые связи `infrastructure → extension-api` и `apps/{api,worker,scheduler,backup} → extension-api` в `config/architecture.json`. Остальные границы не меняются.
- Неиспользуемые протоколы можно выключить, и поверхность атаки уменьшается.
- Таблицы выключенных модулей существуют всегда: небольшой расход на пустые таблицы в обмен на одну схему.
- Модули не изолированы друг от друга в процессе; гарантии дают review, подпись релиза и границы импортов.

## Этапы (каждый — отдельный PR)

1. **X1. `extension-api` и протоколы.** Пакет, `planModules`, `ARKVORY_MODULES_FILE`, `modules.ts` в `apps/api`, описания `upack`, `raw`, `oci`, `lfs`, `npm`; включение и выключение протоколов; guard из префиксов; `arkvory_module_plan`, `system/modules`, `capabilities.modules`, метрики. Гейты: `quick`, `integration`.
2. **X2. Хранилище.** `tests/contracts/blob-store.mjs`, `StorageLifecycle` и `StagingArea`, описание `local-storage` в api, worker и backup; конфигурация worker через типизированный загрузчик вместо `process.env` в `runtime.ts`. Гейты: `quick`, `integration`, `large`.
3. **X3. Хранилище копий.** `tests/contracts/vault.mjs`, описание `file-vault`, выбор в `apps/backup`. Гейты: `quick`, `integration`, `deployment`.
4. **X4. `arkvory configure --module`.** Запись, откат, Compose-монтирование. Гейты: `deployment`, `deployment-containers`.
5. **X5 и далее.** Вид `event-sink` вместе с ADR 0080; S3-хранилище, S3-хранилище копий и провайдеры входа — каждый по своему ADR.

## Проверка

- Unit `planModules`: дубли, неизвестный вид или формат, незакрытое `requires`, пересечения префиксов и метрик, выключение `core`, порядок запуска и остановки, устойчивость отпечатка.
- Unit загрузчика `ARKVORY_MODULES_FILE`: неизвестные поля, `id` и типы отклоняются до I/O; сообщение об ошибке не содержит значений.
- Integration: выключенный `npm` отвечает 404 и отсутствует в `capabilities.modules`, guard проходит; шлюз чтения с другим отпечатком не готов; откат при неудачном `start` второго модуля останавливает первый; `drain` укладывается в срок.
- Контрактные наборы для `LocalBlobStore` и `FileVault`; негативная проверка: намеренно ломаемая реализация (неточная длина Range) не проходит набор.
- Policy: запрет динамического `import()`, соответствие описаний и корней, таблиц модулей и реестра резервной копии, описаний и контрактных наборов; dependency-cruiser отклоняет импорт `extension-api` из `domain`, `application`, `sdk` и `cli`.
