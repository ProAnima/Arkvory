# resolution

Разрешение модулей Node.js только внутри каталога релиза ([ADR 0031](../../docs/adr/0031-release-installation-and-supervision.md#confinement)). Пакет Node.js (`node:module`, `node:fs`), без сторонних библиотек и пакетов репозитория.

- `confineResolution` регистрирует хук `module.registerHooks` потока, один на поток и общий для всех копий пакета в процессе. С этого момента `import`, `import()`, `require` и `import.meta.resolve` получают только `node:` и файлы под разрешёнными корнями (реальный путь, на Windows без учёта регистра). Остальное — `ResolutionRefusedError` с кодом отсутствующего модуля (`MODULE_NOT_FOUND` / `ERR_MODULE_NOT_FOUND`) до загрузки.
- `allowResolutionUnder` добавляет корень — каталог релиза. Корень — абсолютный существующий каталог, не корень файловой системы. Переменные окружения корней не добавляют.
- `confineEntry(import.meta.url)` — первая инструкция точки входа через модуль `confine.ts` её приложения: ограничивает поток и разрешает релиз несобранной точки входа (`<релиз>/apps/<app>/dist/<файл>.js`). Бандл разрешает только встроенные модули, пока его код не назовёт релиз (`runRole`, `manage.ts`).

Пакет используют `apps/api`, `apps/worker`, `apps/backup`, `apps/deploy` и `apps/cli`; `tests/resolution-confinement.test.mjs` проверяет, что каждая поставляемая точка входа импортирует ограничение первой.
