# application

StorageService: резервирование, публикация, завершение/восстановление, отмена, lookup/list/download. Catalog, UploadMutation, BlobStore и IdentitySource — порты сценариев.

[Запуск и API](../../docs/CORE_RUNBOOK.md), [границы](../../docs/ARCHITECTURE.md), [ADR](../../docs/adr/0004-native-standalone-core.md). Публичный вход — src/index.ts; runtime exports — dist/index.js и declarations.

Расширения 0.2: [части, каталог, очереди и обслуживание](../../docs/LIFECYCLE_AND_CATALOG.md).

IdentityService определяет регистрацию администратором, вход и изменение групп через IdentityStore. organizePackages задаёт порядок и группировку страницы UPack; порт BrowseStore получает ограниченные курсорные страницы и отдельно разрешает одну exact/latest версию для legacy download. [ADR 0011](../../docs/adr/0011-users-groups-and-package-browser.md), [ADR 0013](../../docs/adr/0013-package-cursor-pagination.md).

ServiceAccess задаёт порт ServiceStore и валидирует команды bootstrap/delegated управления, передавая Principal в порт для атомарной проверки authority с изменением. Изменяющие data use cases передают MutationAccess адаптерам для повторной проверки перед commit. [Контракт и эксплуатация](../../docs/SERVICE_KEYS.md).
