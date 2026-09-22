# sdk

Публичный HTTP-клиент хранилища.

Рабочий portable fetch SDK с runtime validation, multipart/resume и потоковым download. HTTPS кроме loopback. См. [runbook](../../docs/LIFECYCLE_AND_CATALOG.md).

`create` и `resume` восстанавливают временные сетевые сбои с ограниченными повторами. `downloadVerified` возвращает поток с проверкой диапазонов и полного SHA-256, умеет продолжить с сохранённого Blob prefix. Политика попыток, AbortSignal, требования к commit клиента и примеры: [TRANSFER_RECOVERY](../../docs/TRANSFER_RECOVERY.md). Низкоуровневый `download` сохраняет прежний контракт Response; каталоговые CAS не повторяются автоматически.

Разрешённые зависимости и правила: [ARCHITECTURE.md](../../docs/ARCHITECTURE.md). Общие инструкции: [AGENTS.md](../../AGENTS.md).

Публичный вход — src/index.ts. Импорт внутренних файлов другого workspace запрещён. Реальные зависимости объявляются в package.json при появлении импорта.
