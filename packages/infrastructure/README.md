# infrastructure

LocalBlobStore и PostgresCatalog, миграции. Потоковые записи и хеш, immutable publication, session locks, storage identity и standalone ownership. Гарантии ограничены ADR 0004.

[Запуск и API](../../docs/CORE_RUNBOOK.md), [границы](../../docs/ARCHITECTURE.md), [ADR](../../docs/adr/0004-native-standalone-core.md). Публичный вход — src/index.ts; runtime exports — dist/index.js и declarations.

Расширения 0.2: [части, каталог, очереди и обслуживание](../../docs/LIFECYCLE_AND_CATALOG.md).

BandwidthGovernor и AdmissionQueue обеспечивают общие/per-principal лимиты одного шлюза, bounded ожидание и остановку. Сетевые квоты не являются распределёнными: [TRAFFIC_CONTROL](../../docs/TRAFFIC_CONTROL.md).
