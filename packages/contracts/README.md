# contracts

Схемы native API, wire-типы, OpenAPI и runtime-проверки ответов SDK, включая историю файлов. Размеры содержимого в JSON — десятичные строки. Каталог и ревизии: [runbook](../../docs/LIFECYCLE_AND_CATALOG.md).

[Запуск и API](../../docs/CORE_RUNBOOK.md), [границы](../../docs/ARCHITECTURE.md), [ADR](../../docs/adr/0004-native-standalone-core.md). Публичный вход — src/index.ts; runtime exports — dist/index.js и declarations.

Readiness дополнен `role` и nullable `sharedDownloads` (slot, slots, active, leaseSeconds). Reader отвергает изменяющие методы: 405, Allow GET/HEAD, read_only. Правила маршрутизации: [READ_GATEWAYS](../../docs/READ_GATEWAYS.md).

Контракты входа, учётных записей, групп и сортируемого UPack-каталога добавлены в OpenAPI и runtime-парсеры SDK: [ADR 0011](../../docs/adr/0011-users-groups-and-package-browser.md).

Service-api экспортирует OpenAPI новых service routes и runtime-парсеры ответов. Wire-values содержит независимые примитивы валидации. Импорт domain/server не требуется. [Контракт и эксплуатация](../../docs/SERVICE_KEYS.md).

Operation-policy и openapi-compose связывают wire-схемы с 95 HTTP-операциями, правами и retry. Сборка экспортирует `dist/openapi.json`; snapshots, runtime inventory и schema tests защищают совместимость. Пакет не имеет внешних side effects; экспорт документа не должен увеличивать browser bundle SDK. [Контракт](../../docs/API_CONTRACT_GUARD.md).

delegation-api содержит wire actions, ограниченные runtime-парсеры и JSON schemas управления grants. OpenAPI document 0.4.0 отдельно описывает service-administration и bootstrap-or-own-key. Domain types и строки БД не импортируются.
