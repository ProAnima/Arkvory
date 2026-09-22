# contracts

Схемы native API, wire-типы, OpenAPI и runtime-проверки ответов SDK, включая историю файлов. Размеры содержимого в JSON — десятичные строки. Каталог и ревизии: [runbook](../../docs/LIFECYCLE_AND_CATALOG.md).

[Запуск и API](../../docs/CORE_RUNBOOK.md), [границы](../../docs/ARCHITECTURE.md), [ADR](../../docs/adr/0004-native-standalone-core.md). Публичный вход — src/index.ts; runtime exports — dist/index.js и declarations.

Readiness дополнен `role` и nullable `sharedDownloads` (slot, slots, active, leaseSeconds). Reader отвергает изменяющие методы: 405, Allow GET/HEAD, read_only. Правила маршрутизации: [READ_GATEWAYS](../../docs/READ_GATEWAYS.md).
