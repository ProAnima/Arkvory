# extension-api

Публичный контракт модулей ядра ([ADR 0079](../../docs/adr/0079-extension-modules.md), модель поставки — [ADR 0078](../../docs/adr/0078-open-core-modules-and-licenses.md)). Переносимый пакет: без Node.js, браузера и сторонних библиотек, `allowed: []`; правила `pure-core-no-external-runtime` и `portable-layers-no-node` действуют как для domain.

Содержимое этапа X1 и уточнений формы Y1 (ADR 0083, п. 2; версия 0.2.0):

- `EXTENSION_API_VERSION` и разбор semver/caret-диапазонов;
- `ModuleManifest` и `parseModuleManifest(input: unknown)` с машинными кодами и JSON Pointer поля, без значений в сообщении; `kind` — открытая строка (`MODULE_KINDS` — известные точки), `publisher`, необязательный `uses`;
- `MODULE_SOURCES` (`builtin`, `signed`, `operator`, `development`), `HOST_SERVICES` и `ModuleContext<Services>` (роль, источник, режим, сигнал остановки, журнал и метрики модуля, объявленные службы);
- `ModuleDescriptor` (`parseConfig`, `describeConfig`, `create`), `ModuleLifecycle` (`start(signal)`, `drain(budgetMs)`, `stop()`, `health()`), `ModuleConfigError`;
- чистая `planModules(candidates, host)`: дубли, формат, несовместимый API, неизвестная точка включённого модуля (`unknown_kind`), пространство id по источнику (`id_namespace_mismatch`), бюджет длины префикса таблиц (`table_prefix_too_long`), службы `uses` по матрице ролей и источников и по списку хоста (`service_unavailable`), выключенный модуль ядра, незакрытые и неоднозначные `requires`, роли поставщика, циклы, пересечения и владение префиксами маршрутов, метрик и таблиц; порядок запуска и остановки, отпечаток плана (SHA-256 считает вызывающая сторона). Коды правил — публичный `ModulePlanRuleCode`.

`domain`, `application`, `contracts` и `web` этот пакет не импортируют. Встроенные модули описаны в `packages/infrastructure/src/builtin-modules.ts`. Снимок публичных деклараций — `api-report.d.ts`: `index.d.ts` и только достижимые из его экспортов декларации; после изменения контракта: `npm run build`, `node scripts/extension-api-report.mjs --write`, повышение версии в `package.json` и `EXTENSION_API_VERSION` (проверяет `tests/extension-api-report.test.mjs`). До 1.0.0 контракт не публикуется и любая minor-версия может быть несовместимой.
