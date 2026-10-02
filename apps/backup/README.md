# backup

Composition root резервного копирования во встроенный vault и восстановления в пустую цель (этапы B1 и B2, [ADR 0054](../../docs/adr/0054-built-in-backup-vault.md), [ADR 0056](../../docs/adr/0056-unattended-backups.md)). Отдельный процесс оператора и агент под службой ОС: не HTTP-сервер и не часть transfer worker.

Команды: `agent` (служба: расписание, заявки API, retention; [ADR 0056](../../docs/adr/0056-unattended-backups.md)), `vault init`, `capture`, `list`, `verify`, `restore`. Запуск, коды выхода и обязанности оператора: [CORE_RUNBOOK](../../docs/CORE_RUNBOOK.md#резервные-копии-b1) и [агент](../../docs/CORE_RUNBOOK.md#резервные-копии-без-участия-оператора-b2), протокол: [BACKUP_RECOVERY](../../docs/BACKUP_RECOVERY.md).

Разрешённые зависимости: domain, application, infrastructure ([ARCHITECTURE.md](../../docs/ARCHITECTURE.md)). Публичный вход — src/index.ts; другие apps не импортируются.
