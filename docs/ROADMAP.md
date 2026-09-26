# Порядок реализации

## Подготовлено

- [x] Отдельный каталог проекта и перенесённый план.
- [x] AGENTS, правила SOLID/границ, strict TypeScript.
- [x] npm workspaces и проверки типов/lint/формата/зависимостей.
- [x] Архитектура, модель, API, надёжность, безопасность, стратегия испытаний.
- [x] Standalone native API, runtime-сборка, PostgreSQL, local backend и первый transfer-сценарий.
- [x] Онлайн-очистка с защитой активных передач, динамическими настройками API/SDK/UI и физическим освобождением квоты; offline repair/scrub сохранены отдельно. [ONLINE_CLEANUP](ONLINE_CLEANUP.md), [ADR 0035](adr/0035-online-cleanup.md).
- [x] Multipart/resume, UPack/assets каталог, UI/SDK, completion worker и локальные очереди.
- [x] Поднабор legacy downloads и проверяемый импорт из файлового каталога.
- [x] Ограниченные сетевые повторы SDK, восстановление потерянных ответов upload, проверяемая Range-докачка и resume с сохранённого prefix.
- [x] Общие и per-principal сетевые бюджеты standalone-шлюза, предел активных передач клиента, закрытие очередей и диагностика.
- [x] Read gateways на общем root, фиксированные доли общего download-бюджета, конечные leases и локальная проверка потери связи с PostgreSQL.
- [x] Common Packages download для зарегистрированных UPack по group/name/version.
- [x] Создание пользователей администратором, группы доступа к репозиториям, вход через сессии и сортировка/группировка UPack-каталога.
- [ ] Полная ProGet compatibility, глобальный scheduler, репликация и HA.

## Этапы

Backup/recovery выделен в самостоятельные вертикальные инкременты B0–B5: [механизмы и гейты](BACKUP_RECOVERY.md), [UX](BACKUP_UX.md), [ADR 0037](adr/0037-consistent-backup-and-recovery.md). Сейчас это проект; автоматические копии, backup pins и recovery wizard ещё не реализованы. B1 считается завершённым только после проверенного восстановления в чистую среду.

| Этап                     | Результат                                                                           | Условие завершения                                                 |
| ------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 0. Контракты             | Точная сборка ProGet, клиенты, HTTP-примеры без секретов, сеть/нагрузка, профиль HA | Зафиксированы обязательные сценарии и инфраструктурные ограничения |
| 1. Вертикальная передача | Runtime-сборка, API/worker, БД, local backend, upload/проверка/download             | 5 ГБ, bounded memory, restart, Range и контрольная сумма           |
| 2. Каталог               | Метаданные, labels/collections, версии/assets, ACL, аудит и UI                      | Поиск и правки соблюдают права и конкурентность                    |
| 3. Планировщик           | Устойчивые сессии/задачи, два шлюза, fairness, квоты и shaping                      | Лимиты и восстановление подтверждены смешанной нагрузкой           |
| 4. Интеграции            | ProGet-адаптеры, SDK, внешние клиенты через сеть, external references               | Реальные Hub/CI/клиенты проходят совместимые сценарии              |
| 5. HA                    | Выбранные отказоустойчивые backend/БД/вход, backup/restore                          | Отключения узлов подтверждают согласованные RPO/RTO                |
| 6. Миграция              | Возобновляемый перенос 4 ТБ и пилот                                                 | Сверены байты, каталог, metadata и права                           |
| 7. Переключение          | Финальная дельта, hostname/TLS, откат                                               | ProGet можно вывести из эксплуатации без пропущенных сценариев     |

## Текущий инкремент

Выполнены основные native сценарии этапов 1–2 и часть 3–4: [runbook 0.2](LIFECYCLE_AND_CATALOG.md). Приёмку всего roadmap не объявляем: поднабор legacy download не заменяет ProGet; файловый импорт не равен переносу 4 ТБ; очереди одного API не равны распределённой балансировке. Этапы 5–7 требуют инфраструктуры и внешних клиентов.

История assets, чтение конкретной ревизии и атомарное восстановление реализованы в API/SDK/консоли: [ADR 0006](adr/0006-asset-history-and-restore.md). Логическое удаление и выборочный retention реализованы: [ARTIFACT_RETENTION](ARTIFACT_RETENTION.md). Физическая очистка работает без остановки: [ONLINE_CLEANUP](ONLINE_CLEANUP.md).

Клиентское восстановление сетевых передач реализовано: [контракт и эксплуатация](TRANSFER_RECOVERY.md), [ADR 0007](adr/0007-client-transfer-recovery.md). Web использует проверяемый download, CLI upload — multipart/resume. Локальный дисковый журнал download и продолжение после закрытия браузера остаются будущими клиентскими функциями.

Владелец выбрал **два сервера с репликацией**, стендовые проверки отложены: [проект профиля](TWO_NODE_PLAN.md). Следующие code milestones: legacy publication/list/metadata + контрактные fixtures (Common Packages download уже добавлен); подтверждённые blob replicas и динамическое распределение квот; реализация выбранного replication/fencing deployment.

## Открытые решения

Реализован [мастер удалённой нативной установки](REMOTE_DEPLOYMENT.md): Windows/Linux по SSH, клиентские пакеты, RU/EN, проверка платформы/ключа, установка стабильного релиза, владелец, readiness и приватный туннель. Постоянная HTTPS/LAN-публикация, DNS/firewall/NAT, remote Compose и приёмка на реальном удалённом стенде остаются открытыми. Автоматический проброс локальной консоли не равен доступности сервиса всей сети.

Расширение API для сервисов: [карта](API_MAP.md), [модель](API_ACCESS.md), [план A–E](API_EVOLUTION.md). Реализованы discovery, managed keys, точные repository bindings, lifecycle и повторная авторизация перед публикацией. Добавлено [делегированное управление](SERVICE_DELEGATION.md) на точные аккаунты с actions/ceiling, без цепочек: [ADR 0019](adr/0019-scoped-service-administration.md). OpenAPI и drift guard покрывают [127 операций](API_CONTRACT_GUARD.md). Добавлено [веб-управление](WEB_ADMINISTRATION.md) аккаунтами, ключами, делегированием и доступными репозиториями. Далее: импорт старых identities/ownership, namespace selectors, события, отдельный реестр жизненного цикла репозиториев и распределённые квоты. Legacy publication и стендовая приёмка HA остаются открытыми.

В рамках этапа 3 реализован локальный исполнитель общего/per-principal byte budget: [TRAFFIC_CONTROL](TRAFFIC_CONTROL.md), [ADR 0008](adr/0008-gateway-bandwidth-budgets.md). Дополнительно реализованы независимые read gateways, конечные leases фиксированных долей и локальные проверки потери координации: [READ_GATEWAYS](READ_GATEWAYS.md), [ADR 0009](adr/0009-leased-read-gateways.md). Для завершения этапа нужны подтверждённые реплики blobs, инфраструктура входа и испытания смешанной нагрузки на выбранном стенде. Локальный bucket каждого процесса нельзя выдавать за общий лимит площадки.

- Обязателен ли автоматический failover одного узла уже в первом промышленном выпуске?
- Подтверждены две машины. Остаются ОС/диски, replication backend, fencing и способ резервирования PostgreSQL.
- Одна площадка или несколько, скорость сети и число одновременных передач?
- Точная сборка ProGet, типы клиентов, тайм-ауты и механизмы retry?
- Политика overwrite, срок хранения ревизий, публичное чтение и задержка отзыва токенов?
- RPO/RTO, сроки хранения backup и ответственный за эксплуатацию?

До этих ответов нельзя обещать скорость, процент доступности или число необходимых серверов. Каркас не блокирует уточнение требований и не фиксирует неподтверждённые значения как обязательные.

Дополнение этапа C API: [постраничный файловый каталог](ASSET_PAGINATION.md) реализован в API/SDK, с exact repository ACL, буквальным prefix и индексным seek. Миграция 11 не переписывает pointers/history. Репозиторные карточки теперь реализованы как [discovery из актуальных прав](REPOSITORY_DISCOVERY.md), без глобального registry. Настройки репозиториев, selectors, legacy identity import и события остаются открытыми.

Управляемые клиентские скачивания реализованы в SDK и консоли: [DOWNLOAD_QUEUE](DOWNLOAD_QUEUE.md), [ADR 0022](adr/0022-client-download-queue.md). OPFS checkpoints, pause/resume/cancel, очистка ожидающих, параллелизм/задержки, серверные waiting limits/timeouts. Восстановление очереди после reload реализовано через приватный журнал и явное продолжение. Глобальный scheduler остаётся открытым. Поиск охватывает значения metadata и точные пары; CLI `packages publish` объединяет upload и регистрацию с повторным использованием receipt.
Для внешних клиентов реализованы [API surfaces и operation discovery](API_SURFACES.md): ответственность/видимость всего inventory, актуальные права и роль gateway, документационные представления OpenAPI, SDK identity/administration/repository scopes. Прежние методы сохранены. Inventory: 127 операций, документ 0.11.0, схема БД 17.

Реализовано: произвольные метки и metadata в редакторе полей, именованные вложения (manifest/SBOM/signature/report/file), CAS, история/восстановление, upload/pause/resume в карточке и API/SDK. Полные metadata snapshots, проверка подписей/manifest schemas, release approvals и retention истории остаются будущими задачами. [BUILD_DETAILS](BUILD_DETAILS.md).

Логическое удаление и retention preview/apply реализованы в [ARTIFACT_RETENTION](ARTIFACT_RETENTION.md): managed-only artifact.delete, CAS аннотаций, пины истории и receipts. OpenAPI 0.11.0, 127 операций, миграции 13/14. Реестр репозиториев, SDK distribution, identity delegation/SSO и глобальное управление очередями остаются отдельными этапами.

Реализованы расписание last-N retention, настройки квот и предупреждений, bounded диагностика API/worker, SDK и RU/EN-консоль. Группировка выбирается по пакету/каналу, пакету или репозиторию; ключ расписания перепроверяется. [STORAGE_POLICIES](STORAGE_POLICIES.md), [ADR 0026](adr/0026-storage-retention-quotas-diagnostics.md). Физические реплики и стендовые HA-проверки остаются открытыми.

После архитектурного аудита SDK разделён на HTTP transport, группы операций и transfer workflows за прежним ArkvoryClient. Устранены два исключения размера; совместимость 68 методов проверяется строгим внешним TS consumer и сетевыми регрессиями. [ADR 0028](adr/0028-sdk-composition.md). Декомпозиция API composition root также завершена, см. ниже; распространение SDK как отдельного версионированного пакета остаётся отдельной задачей.

Из API composition root выделены upload/session/completion routes и управление временем upload. Реализованы отдельные sender-idle и absolute deadlines, диагностика причин прерывания, точное завершение blob/Range/part reads и регистрация ошибок начатой раздачи. Старый TCP timer больше не обрывает допущенный upload только из-за паузы backend. [ADR 0029](adr/0029-upload-lifetime-and-exact-reads.md). Исторические локальные ECONNRESET не объявляются полностью объяснёнными без соответствующих логов; HA/репликация остаются отдельными этапами. Online GC реализован: [ONLINE_CLEANUP](ONLINE_CLEANUP.md).

Декомпозиция сборки API завершена: runtime/lifecycle, service factories, request security/context, HTTP errors, diagnostics/background и native/legacy download отделены от createServer. Исключения размера server.ts/createServer удалены; startup rollback освобождает pools, ownership и listeners после частичной ошибки. Проверяемый порядок и границы: [ADR 0030](adr/0030-api-server-composition.md).
