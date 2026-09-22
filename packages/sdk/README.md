# sdk

Публичный HTTP-клиент хранилища.

Рабочий portable fetch SDK с runtime validation, multipart/resume и потоковым download. HTTPS кроме loopback. См. [runbook](../../docs/LIFECYCLE_AND_CATALOG.md).

Разрешённые зависимости и правила: [ARCHITECTURE.md](../../docs/ARCHITECTURE.md). Общие инструкции: [AGENTS.md](../../AGENTS.md).

Публичный вход — src/index.ts. Импорт внутренних файлов другого workspace запрещён. Реальные зависимости объявляются в package.json при появлении импорта.
