# web

Автономный web UI.

Рабочая RU/EN консоль через SDK: каталог, правки, загрузка частями, потоковый hash в Web Worker. Собирается esbuild, выдаётся API по /console/. См. [runbook](../../docs/LIFECYCLE_AND_CATALOG.md).

Разрешённые зависимости и правила: [ARCHITECTURE.md](../../docs/ARCHITECTURE.md). Общие инструкции: [AGENTS.md](../../AGENTS.md).

Публичный вход — src/index.ts. Импорт внутренних файлов другого workspace запрещён. Реальные зависимости объявляются в package.json при появлении импорта.
