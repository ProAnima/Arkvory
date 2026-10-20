# extension-api

Публичный контракт модулей ядра ([ADR 0079](../../docs/adr/0079-extension-modules.md), модель поставки — [ADR 0078](../../docs/adr/0078-open-core-modules-and-licenses.md)). Переносимый пакет: без Node.js, браузера и сторонних библиотек, `allowed: []`; правила `pure-core-no-external-runtime` и `portable-layers-no-node` действуют как для domain.

Содержимое этапа X1 и уточнений формы Y1 (ADR 0083, п. 2; версия 0.2.0) и службы `license` (ADR 0078, Р2; версия 0.6.0):

- `EXTENSION_API_VERSION` и разбор semver/caret-диапазонов;
- `ModuleManifest` и `parseModuleManifest(input: unknown)` с машинными кодами и JSON Pointer поля, без значений в сообщении; `kind` — открытая строка (`MODULE_KINDS` — известные точки), `publisher`, необязательный `uses`;
- `MODULE_SOURCES` (`builtin`, `signed`, `operator`, `development`), `HOST_SERVICES` и `ModuleContext<Services>` (роль, источник, режим, сигнал остановки, журнал и метрики модуля, объявленные службы);
- `LicenseService` (`view(feature?)`, `evidence()`), `LicenseView` и `LICENSE_STATES` — служба `license` для модулей ProAnimaStudio с `licenseFeature`: только чтение, без ключа, секрета активации и адреса хаба;
- `ModuleDescriptor` (`parseConfig`, `describeConfig`, `create`), `ModuleLifecycle` (`start(signal)`, `drain(budgetMs)`, `stop()`, `health()`), `ModuleConfigError`;
- чистая `planModules(candidates, host)`: дубли, формат, несовместимый API, неизвестная точка включённого модуля (`unknown_kind`), пространство id по источнику (`id_namespace_mismatch`), бюджет длины префикса таблиц (`table_prefix_too_long`), службы `uses` по матрице ролей и источников и по списку хоста (`service_unavailable`), выключенный модуль ядра, незакрытые и неоднозначные `requires`, роли поставщика, циклы, пересечения и владение префиксами маршрутов, метрик и таблиц; порядок запуска и остановки, два отпечатка плана: полный `fingerprint` с версиями ядра и модулей и `compatibilityFingerprint` без версий ядра и встроенных модулей, который сравнивают процессы установки (SHA-256 считает вызывающая сторона). Коды правил — публичный `ModulePlanRuleCode`.

Версия 0.6.0 объединяет службу `license` с маршрутами модулей и службами хоста версии 0.5.0.

Маршруты (этап X5 ADR 0079, этап Y6 ADR 0083, N7 и N12): служба хоста `routes` — `ModuleRoutes` (`add`, `document`, `offerTransfer`), `ModuleRoute` с методом, полным путём под `/api/ext/<id>/v<major>/`, `effect`, `access`, действием ACL репозитория (`MODULE_ROUTE_ACTIONS`), телом (`none`, `json`, `stream`) и пределами; запрос `ModuleRequest` и ответы `json`, `content` (выдаёт ядро), `stream` и `error` (`MODULE_ROUTE_ERRORS`); `ModuleTransferOffer` для `capabilities.transfer`.

Службы хоста этапов Y4–Y9 ADR 0083:

- переносимые типы `ByteRange`, `BlobDescriptor`, `PartRef`, `Page`, `PageRequest` и ошибка служб `ModuleServiceError` с кодами `SERVICE_ERROR_CODES`; `HostServiceTypes`/`HostServices` — типы служб, которые хост реализует;
- N1: `StagedCompletion` и `StagedObject` — завершение загрузки из частей, принятых хранилищем; размер и SHA-256 проверяет ядро;
- N4: непрозрачный `AccessScope`, `CatalogRead` (артефакт, страница, пачка, пакет, путь, поиск, пересечение областей) и `ContentRead` с `ContentHandle`; `null` без оракула существования;
- N6: `ModuleDataDirectory` с областями `data` и `cache`, `ModuleFiles`, `FileSink`, `ModuleDataUsage`; поле манифеста `resources` (`dataMiB`, `dataFiles`); необязательные `freeze`/`thaw` в `ModuleLifecycle`;
- N13: версии возможностей в `provides` (`name@1.4.0`), `requires` и новом `optional` (`name@^1.2.0`), `exposeTo`, `CapabilityToken`, `defineCapability`, `ModuleCapabilities` в `context.capabilities` и необязательный `capability(name)` поставщика; правила плана `requirement_version_mismatch`, `capability_unversioned`, `capability_not_exposed`;
- точка `service` в `MODULE_KINDS`: модуль без своей точки ядра, работающий через службы хоста.

Контрактные наборы служб — в `packages/extension-testkit`.

`domain`, `application`, `contracts` и `web` этот пакет не импортируют. Встроенные модули описаны в `packages/infrastructure/src/builtin-modules.ts`. Снимок публичных деклараций — `api-report.d.ts`: `index.d.ts` и только достижимые из его экспортов декларации; после изменения контракта: `npm run build`, `node scripts/extension-api-report.mjs --write`, повышение версии в `package.json` и `EXTENSION_API_VERSION` (проверяет `tests/extension-api-report.test.mjs`). До 1.0.0 контракт не публикуется и любая minor-версия может быть несовместимой.

Версия 0.7.0 добавляет серверные регистрации `ModuleStorageRegistry` и
`StagedCompletionRegistry`, worker-подписки `ChangeFeed` и signed tasks
`ComputePool`. Служба из `uses` должна быть доступна хотя бы в одной роли
модуля; конкретный процесс получает только службы своей роли. Например,
API/worker модуль получает `routes` только в API и `change-feed` только в worker.
Регистрация storage и staged completion завершается вместе с `create`;
экземпляры `<module>.<name>` активируются после успешного `start`.

`compute` манифеста содержит разрешённые задачи `{name, entry}`; entry должен
быть подписанным файлом `files/**/*.mjs`. Данные копируются, разделяемая память
не допускается; лимит сообщения 16 МиБ, очередь 64, одна задача за раз,
срок 60 секунд. Это исполнение доверенного подписанного кода в отдельном потоке,
а не sandbox. Feed допускает повторную доставку: обработчик идемпотентен,
подтверждение происходит после успешного завершения; отмена кооперативная.
Отдельные метрики ошибок compute/feed пока не предоставляются.

## Поколения производного кеша (0.9.0)

`derived-cache`: DerivedCache, CacheBuild, CacheRead; signed API/worker строят
и читают, reader читает, backup и плагины службу не получают. Пространство
изолировано от ModuleFiles, поколения публикуются атомарно, quota общая с
legacy data/cache. Потеря PG-сессии не доказывает quiescence файлового I/O.
Контракт и доверенная процедура recovery: [ADR 0084](../../docs/adr/0084-derived-cache-generations.md).

## Служебный регистр (0.10.0)

`module-state` даёт один ограниченный документ на модуль с атомарным обновлением
по строковой ревизии; API/worker пишут, reader/backup читают. Регистр отдельный
от байтов объектов, сохраняется в HA и не переносится логическим backup.
Контракт и повторная инициализация: [ADR 0086](../../docs/adr/0086-module-state-register.md).
`LicenseService.installation()` возвращает идентификатор установки или null,
без секрета активации и без решения о разрешённых функциях.
