# proget-compat

Адаптеры протоколов ProGet.

Реализован поднабор чтения исходных UPack и assets, включая Common Packages download по group/name/version. Запись и остальные legacy API ещё не реализованы. См. [матрицу](../../docs/COMPATIBILITY.md).

Разрешённые зависимости и правила: [ARCHITECTURE.md](../../docs/ARCHITECTURE.md). Общие инструкции: [AGENTS.md](../../AGENTS.md).

Публичный вход — src/index.ts. Импорт внутренних файлов другого workspace запрещён. Реальные зависимости объявляются в package.json при появлении импорта.
