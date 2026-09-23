# infrastructure

LocalBlobStore и PostgresCatalog, миграции. Потоковые записи и хеш, immutable publication, session locks, storage identity и standalone ownership. Гарантии ограничены ADR 0004.

[Запуск и API](../../docs/CORE_RUNBOOK.md), [границы](../../docs/ARCHITECTURE.md), [ADR](../../docs/adr/0004-native-standalone-core.md). Публичный вход — src/index.ts; runtime exports — dist/index.js и declarations.

Расширения 0.2: [части, каталог, очереди и обслуживание](../../docs/LIFECYCLE_AND_CATALOG.md).

BandwidthGovernor и AdmissionQueue обеспечивают общие/per-principal лимиты одного шлюза, bounded ожидание и остановку. Локальный governor описан в [TRAFFIC_CONTROL](../../docs/TRAFFIC_CONTROL.md).

PostgresDownloadLease и DownloadLeaseWindow координируют фиксированные доли раздачи, migration 5 хранит policy/slots. ClaimStorage сохраняет одного writer, добавляет readers и исключает смешение standalone/shared. Ограничения часов и общего storage: [ADR 0009](../../docs/adr/0009-leased-read-gateways.md).

PostgresIdentity хранит пользователей, группы, права и хеши сессий в таблицах migration 6; пароли проверяются scrypt. [ADR 0011](../../docs/adr/0011-users-groups-and-package-browser.md).

PostgresBrowse использует функцию SemVer-порядка из migration 7 и ограниченные курсорные запросы каталога пакетов. [ADR 0013](../../docs/adr/0013-package-cursor-pagination.md).
