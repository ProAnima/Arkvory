# infrastructure

LocalBlobStore и PostgresCatalog, миграции. Потоковые записи и хеш, immutable publication, session locks, storage identity и standalone ownership. Гарантии ограничены ADR 0004.

[Запуск и API](../../docs/CORE_RUNBOOK.md), [границы](../../docs/ARCHITECTURE.md), [ADR](../../docs/adr/0004-native-standalone-core.md). Публичный вход — src/index.ts; runtime exports — dist/index.js и declarations.

Расширения 0.2: [части, каталог, очереди и обслуживание](../../docs/LIFECYCLE_AND_CATALOG.md).

BandwidthGovernor и AdmissionQueue обеспечивают общие/per-principal лимиты одного шлюза, bounded ожидание и остановку. Локальный governor описан в [TRAFFIC_CONTROL](../../docs/TRAFFIC_CONTROL.md).

PostgresDownloadLease и DownloadLeaseWindow координируют фиксированные доли раздачи, migration 5 хранит policy/slots. ClaimStorage сохраняет одного writer, добавляет readers и исключает смешение standalone/shared. Ограничения часов и общего storage: [ADR 0009](../../docs/adr/0009-leased-read-gateways.md).

PostgresIdentity хранит пользователей, группы, права и хеши сессий в таблицах migration 6; пароли проверяются scrypt. [ADR 0011](../../docs/adr/0011-users-groups-and-package-browser.md).

PostgresBrowse использует функцию SemVer-порядка из migration 7 для курсорных страниц и точечной выборки старшей версии; exact lookup опирается на уникальный индекс идентичности пакета. Migration 8 строит шесть индексов страниц вне транзакции с безопасным продолжением после прерывания. [ADR 0013](../../docs/adr/0013-package-cursor-pagination.md), [ADR 0014](../../docs/adr/0014-online-package-page-indexes.md).

PostgresServices реализует lifecycle ключей, CAS policy и ограниченный аудит. Миграция 9 расширяет схему. lockServiceAccess проверяет актуальные credentials под короткими row locks в транзакциях mutations; поток bytes не удерживает эти locks. [Контракт и эксплуатация](../../docs/SERVICE_KEYS.md).

Миграция 10 добавляет grants и issuer key reference. delegation-authorization разрешает действующий credential и exact grant; service-delegations отвечает за CAS/tombstones, пределы и запрет цепочек. PostgresServices удерживает короткий control lock для mutations и атомарного audit, использует repeatable-read snapshot для чтения и повторно проверяет issuer при pending activation. [Контракт](../../docs/SERVICE_DELEGATION.md).

Asset-page выполняет ограниченный SQL seek по repository/path COLLATE C, валидирует cursor scope и возвращает limit+1 lookahead. Миграция 11 строит C index concurrently через тот же механизм восстановления, что package indexes. [Контракт](../../docs/ASSET_PAGINATION.md).

PostgresAttachments и migration 12 хранят историю вложений и FK-пины исходных файлов. CAS сериализуется на строке основного артефакта, targets проверяются в том же репозитории, audit входит в транзакцию. [Контракт](../../docs/BUILD_DETAILS.md).

PostgresRetention сохраняет cancellation, deletion receipt и audit атомарно. Catalog-mutation сериализует короткие записи каталога по repository и исключает поздние pins/annotations после удаления; байты не блокируются. Миграция 13 фиксирует publication time, миграция 14 строит indexes concurrently. Package queries исключают tombstones, immutable identity сохраняется. [Контракт и ограничения](../../docs/ARTIFACT_RETENTION.md).
