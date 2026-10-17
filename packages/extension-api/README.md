# extension-api

Публичный контракт модулей ядра ([ADR 0079](../../docs/adr/0079-extension-modules.md), модель поставки — [ADR 0078](../../docs/adr/0078-open-core-modules-and-licenses.md)). Переносимый пакет: без Node.js, браузера и сторонних библиотек, `allowed: []`; правила `pure-core-no-external-runtime` и `portable-layers-no-node` действуют как для domain.

Содержимое этапа X1:

- `EXTENSION_API_VERSION` и разбор semver/caret-диапазонов;
- `ModuleManifest` и `parseModuleManifest(input: unknown)` с машинными кодами и JSON Pointer поля, без значений в сообщении;
- `ModuleDescriptor` (`parseConfig`, `describeConfig`, `create`), `ModuleLifecycle` (`start(signal)`, `drain(budgetMs)`, `stop()`, `health()`), `ModuleConfigError`;
- чистая `planModules(candidates, host)`: дубли, неизвестная точка или формат, несовместимый API, выключенный модуль ядра, незакрытые и неоднозначные `requires`, роли поставщика, циклы, пересечения и владение префиксами маршрутов, метрик и таблиц; порядок запуска и остановки, отпечаток плана (SHA-256 считает вызывающая сторона).

`domain`, `application`, `contracts` и `web` этот пакет не импортируют. Встроенные модули описаны в `apps/api/src/modules.ts`. Снимок публичных деклараций — `api-report.d.ts`; после изменения контракта: `npm run build`, `node scripts/extension-api-report.mjs --write`, повышение версии в `package.json` и `EXTENSION_API_VERSION` (проверяет `tests/extension-api-report.test.mjs`). До 1.0.0 контракт не публикуется и любая minor-версия может быть несовместимой.
