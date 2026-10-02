# backup

Composition root резервного копирования во встроенный vault и восстановления в пустую цель (этап B1, [ADR 0054](../../docs/adr/0054-built-in-backup-vault.md)). Отдельный процесс оператора: не HTTP-сервер и не часть transfer worker.

Команды: `vault init`, `capture`, `list`, `verify`, `restore`. Запуск, коды выхода и обязанности оператора: [CORE_RUNBOOK](../../docs/CORE_RUNBOOK.md#резервные-копии-b1), протокол: [BACKUP_RECOVERY](../../docs/BACKUP_RECOVERY.md).

Разрешённые зависимости: domain, application, infrastructure ([ARCHITECTURE.md](../../docs/ARCHITECTURE.md)). Публичный вход — src/index.ts; другие apps не импортируются.
