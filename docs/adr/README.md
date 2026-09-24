# Архитектурные решения

ADR нужен для изменения границ, публичных контрактов, долговечности, модели прав, HA-топологии или существенного инструментария. Рутинные реализации не требуют отдельного ADR.

Создавайте `NNNN-short-name.md` по [шаблону](0000-template.md). Статусы: proposed, accepted, superseded. Сохраняйте причины и последствия; не переписывайте прошлое решение как будто альтернатив не было.

- [0001 — TypeScript и границы модулей](0001-typescript-and-boundaries.md)
- [0002 — HA-профили и открытая топология](0002-storage-and-ha-profiles.md)
- [0003 — Бренд, права и распространение](0003-brand-ownership-and-distribution.md)

- [0004 — Нативное standalone-ядро](0004-native-standalone-core.md)
- [0005 — Жизненный цикл, каталог и worker](0005-lifecycle-catalog-and-worker.md)
- [0006 — История файлов и восстановление](0006-asset-history-and-restore.md)

- [0007 — Клиентское восстановление передач](0007-client-transfer-recovery.md)
- [0008 — Бюджеты полосы и допуск шлюза](0008-gateway-bandwidth-budgets.md)
- [0009 — Шлюзы чтения и leases долей](0009-leased-read-gateways.md)
- [0010 — Чтение UPack через Common Packages API](0010-common-package-download.md)
- [0011 — Учётные записи, группы и каталог пакетов](0011-users-groups-and-package-browser.md)
- [0012 — Самостоятельная смена пароля](0012-account-password-change.md)
- [0013 — Курсорные страницы каталога UPack](0013-package-cursor-pagination.md)
- [0014 — Индексы страниц каталога без длительной блокировки записи](0014-online-package-page-indexes.md)
- [0015 — Браузерный UI на отдельном origin](0015-external-browser-ui.md)
- [0016 — Права сервисных ключей и развитие API (proposed)](0016-service-access-and-api-evolution.md)
- [0017 — Первый рабочий профиль управляемых сервисных ключей](0017-managed-service-keys.md)
- [0018 — Проверяемая инвентаризация API](0018-executable-api-inventory.md)

- [0019 — Делегирование управления точными сервисными аккаунтами](0019-scoped-service-administration.md)

- [0020 — Отдельный API страниц файлового каталога](0020-asset-cursor-pagination.md)

- [0021 — Discovery логических репозиториев из текущих прав](0021-repository-discovery.md)

- [0022 — Управляемая очередь проверяемых скачиваний](0022-client-download-queue.md)
