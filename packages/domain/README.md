# domain

Чистые правила ArtifactDescriptor, Upload, repository scopes, идентификаторов и канонизации. Нет Node/БД/HTTP зависимостей.

[Запуск и API](../../docs/CORE_RUNBOOK.md), [границы](../../docs/ARCHITECTURE.md), [ADR](../../docs/adr/0004-native-standalone-core.md). Публичный вход — src/index.ts; runtime exports — dist/index.js и declarations.

ServiceBinding и 18 ServicePermission определены в service-policy.ts без зависимостей. Service-access содержит точное пересечение repo/action, проверку подмножества и authorizeAction; coarse authorize закрыт для managed principals. [Контракт и эксплуатация](../../docs/SERVICE_KEYS.md).

ServiceDelegation и отдельный каталог семи AdministrationAction описывают точное делегирование; data bindings по-прежнему содержат только repository actions. SQL/lookup/revoke не входят в domain. [Контракт](../../docs/SERVICE_DELEGATION.md).
