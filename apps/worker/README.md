# worker

Фоновые обработчики и composition root.

Реализованы completion worker (lease/retry/fencing), offline GC и scrub. Запуск и пределы: [runbook 0.2](../../docs/LIFECYCLE_AND_CATALOG.md).

Разрешённые зависимости и правила: [ARCHITECTURE.md](../../docs/ARCHITECTURE.md). Общие инструкции: [AGENTS.md](../../AGENTS.md).

Публичный вход — src/index.ts. Импорт внутренних файлов другого workspace запрещён. Реальные зависимости объявляются в package.json при появлении импорта.
