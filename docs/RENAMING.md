# Переход на Arkvory / Moving to Arkvory

Arkvory — новое название самостоятельного хранилища ProAnimaStudio. Правообладатель и держатель бренда — Ian Panaev лично. Лицензия остаётся проприетарной.

| Поверхность    | Новое имя                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| Репозиторий    | `ProAnima/Arkvory`                                                                                     |
| CLI клиента    | `arkvoryctl`                                                                                           |
| CLI установки  | `arkvory`, `arkvory-setup.mjs`                                                                         |
| SDK            | `@proanima/arkvory-sdk`, `ArkvoryClient`                                                               |
| Окружение      | `ARKVORY_*`                                                                                            |
| Windows службы | `Arkvoryapi`, `Arkvoryworker`, `Arkvorydatabase`                                                       |
| Linux службы   | `arkvory-api`, `arkvory-worker`, `arkvory-database`, `arkvory-update.timer`                            |
| Compose        | `proanima-arkvory`; volumes `proanima-arkvory_storage`, `proanima-arkvory_catalog`                     |
| Windows данные | `C:\ProgramData\ProAnima\Arkvory`                                                                      |
| Linux данные   | `/opt/proanima-arkvory`                                                                                |
| Релиз          | `arkvory-release.json`, `arkvory-runtime.zip`, `Arkvory-Setup-x64.exe`, DEB/RPM и CLI-пакеты с Arkvory |

Для новой установки используйте новые артефакты. Публикация стабильного релиза — отдельный процесс; переименование исходников не создаёт опубликованный релиз.

## Совместимость интеграций и данных

HTTP-маршруты и ProGet-compatible API не изменились. Пакеты и байты не перепаковываются. Старые `DEPOT_*` принимаются API/worker/CLI как aliases, но при конфликте с `ARKVORY_*` процесс завершается с понятной ошибкой. Значения путей, DB URL и ключей не редактируются. Сборочные/CI-параметры используют новые имена; обновите GitHub variables с префиксом `ARKVORY_`.

SDK-потребители меняют имя workspace/package и классов с Depot на Arkvory. Существующий HTTP-клиент не требует этого изменения. CLI ищет старые profiles/checkpoints при отсутствии новых; не запускайте старый и новый CLI одновременно на одном файле. Старые настройки темы и языка читаются как fallback. Внутренние SQL `depot_*` и OPFS locks сохранены намеренно — не переименовывайте их вручную.

## Существующая установка Depot

Автоматическая смена системных служб и Docker volumes **не выполняется**. Managed installer/updater останавливает переход со старого runtime configuration; стандартные старые папки распознаются до установки. Это предотвращает появление второго writer или нового пустого volume. Произвольные старые пути должен указать и проверить оператор.

До перехода на реальном сервере:

1. Зафиксируйте текущий релиз, пути PostgreSQL/blobs, службы, volumes, ключи, update schedule и способ возврата. Создайте согласованную резервную копию и проверьте её восстановление отдельно.
2. Отключите старый updater, завершите передачи, штатно остановите API и worker. Не удаляйте PostgreSQL, blobs, installation.json или Docker volumes.
3. На копии данных проверьте Arkvory runtime с прежними DB URL, DATA_DIR и KEYS_FILE. Для оператора доступны `node --env-file=<protected-env> apps/api/dist/main.js` и worker entrypoint. Alias-конвертация меняет только имена env, а не значения и не данные. Зафиксируйте прежние лимиты и права.
4. Подготовьте новые supervisor definitions с явными путями runtime и существующих данных. Не подключайте два writer. Для Compose явно подключите прежние external volumes; нельзя полагаться на новые имена volume по умолчанию.
5. На стенде проверьте readiness, чтение прежних пакетов, hash, resume, регистрацию новой сборки, перезапуск служб и возврат. Только после этого выполните контролируемое переключение на сервере.
6. Подключайте managed updates лишь после приведения всей установки (службы, paths, image/volume identity, launcher и installation state) к одному проверенному профилю Arkvory. Простая замена `DEPOT_` в runtime.json не является миграцией установки.

Нативная установка и переход на существующих Windows/Linux/Compose серверах требуют стендовой проверки. Документ не утверждает готовность автоматической конвертации или бесшовного rolling update.

## English

Arkvory replaces the Depot product name. Ian Panaev remains the personal copyright and brand owner; the proprietary license is unchanged. New installations, packages, services, CLI and release assets use Arkvory. HTTP/ProGet-compatible routes and stored bytes remain unchanged.

Legacy `DEPOT_*` runtime settings are accepted by API/worker/CLI; conflicting canonical values fail closed without logging secrets. Existing CLI profiles/checkpoints are reused in place. Persistent SQL/OPFS identities are intentionally stable. Do not run both CLI generations against one unfinished transfer.

Existing managed installations require a supervised, backup-verified handover. Automatic service/volume conversion is not implemented. Installers reject detected legacy installations rather than creating a second empty storage. Rehearse the transition with explicit existing database/blob paths or external volumes, one writer, crash recovery and rollback before production. Renaming runtime keys alone is not an installation migration.
