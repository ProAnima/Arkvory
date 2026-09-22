# api

Работающий Fastify composition root: конфигурация, сервисные ключи, нативные HTTP routes, Range/ETag, допуски передач, health и lifecycle. Запуск через npm run build, npm run migrate, npm start. См. CORE_RUNBOOK.

[Запуск и API](../../docs/CORE_RUNBOOK.md), [границы](../../docs/ARCHITECTURE.md), [ADR](../../docs/adr/0004-native-standalone-core.md). Публичный вход — src/index.ts; runtime exports — dist/index.js и declarations.

Расширения 0.2: [части, каталог, очереди и обслуживание](../../docs/LIFECYCLE_AND_CATALOG.md).

Потоки full/multipart upload и native/legacy download подключены к общим квотам шлюза и клиента; readiness возвращает агрегаты. Переменные DEPOT_*_BYTES_PER_SECOND и активные лимиты: [TRAFFIC_CONTROL](../../docs/TRAFFIC_CONTROL.md).

`DEPOT_ROLE=reader` запускает тот же composition root с запретом HTTP-изменений и без консоли. Writer использует slot 0, readers — остальные slots с одинаковой shared policy. Локальные governors ограничены leased share; потеря lease закрывает допуск до restart. Настройка/обновление: [READ_GATEWAYS](../../docs/READ_GATEWAYS.md).
