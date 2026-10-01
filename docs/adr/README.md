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
- [0010 — Чтение UPack по group/name/version (заменено 0045)](0010-common-package-download.md)
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
- [0023 — Области API и каталог применимых операций](0023-api-surfaces-and-operation-discovery.md)

- [0024 — Именованные вложения к опубликованной сборке](0024-build-attachments.md)
- [0025 — Удаление артефактов и удержание](0025-artifact-retention.md)
- [0026 — Автоочистка, квоты и диагностика](0026-storage-retention-quotas-diagnostics.md)
- [0027 — Исполняемые инженерные гейты](0027-executable-engineering-gates.md)
- [0028 — Композиция SDK](0028-sdk-composition.md)
- [0029 — Время жизни загрузок и точное чтение](0029-upload-lifetime-and-exact-reads.md)
- [0030 — Композиция API-сервера](0030-api-server-composition.md)
- [0031 — Установка релизов и службы](0031-release-installation-and-supervision.md)
- [0032 — Проверенные релизные комплекты](0032-tested-release-bundles.md)
- [0033 — Нативные установщики и знакомство с Arkvory](0033-native-installers-and-guided-setup.md)
- [0034 — Отдельный удалённый клиент arkvoryctl](0034-remote-client-cli.md)
- [0035 — Физическая очистка при работающем сервисе](0035-online-cleanup.md)
- [0036 — Локальный мастер удалённой установки](0036-local-remote-setup-wizard.md)
- [0037 — Согласованные копии и независимое восстановление (проект)](0037-consistent-backup-and-recovery.md)
- [0038 — Уведомления и ограниченное управление обновлением](0038-update-notifications-and-control.md)
- [0039 — Восстановление процесса после потери владения](0039-supervised-ownership-recovery.md)
- [0040 — Единая идентичность Arkvory](0040-arkvory-identity.md)
- [0041 — Восстановление клиентской очереди, поиск metadata и публикация UPack](0041-client-recovery-search-and-publication.md)
- [0042 — Ограниченное подтверждение владения storage](0042-bounded-storage-ownership.md)
- [0043 — Подтверждение объектных сессий и completion lease](0043-operation-session-protection.md)
- [0044 — Переносимые зеркала и отдельный HA-профиль](0044-replication-profiles-and-control.md)
- [0045 — Только нативный API без совместимости с внешними протоколами](0045-native-only-api.md)
- [0046 — Размер объекта без фиксированного предела и адаптивные части multipart](0046-adaptive-multipart-layout.md)
- [0047 — Продвижение артефактов: стадии и перенос между репозиториями](0047-artifact-promotion.md)
- [0050 — Compose на Windows от пользователя контейнерного движка](0050-windows-compose-engine-user.md)
