# Автозапуск и восстановление процессов

Arkvory использует системный supervisor; открытая консоль, браузер и вход пользователя для нативной установки не требуются. Службы регистрируются установщиком. Ошибка регистрации или запуска завершает установку ошибкой.

| Установка                | Автозапуск                                                                                         | Восстановление после падения                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Linux с systemd          | `arkvory-api`, `arkvory-worker`, управляемая `arkvory-database` включены в `multi-user.target`     | API/worker: `Restart=always`; БД: `Restart=on-failure`; пауза 10 секунд, без исчерпания лимита попыток |
| Windows Desktop / Server | `Arkvoryapi`, `Arkvoryworker`: Automatic (Delayed Start); управляемая `Arkvorydatabase`: Automatic | Windows SCM и WinSW повторяют restart после аварийного завершения через 10 секунд                      |
| Docker Engine / Compose  | Контейнеры API, worker, PostgreSQL: `restart: unless-stopped`; нужен автозапуск самого Engine      | Движок перезапускает завершившийся контейнер; миграции и инициализация не перезапускаются              |

Управляемая БД входит в нативный комплект. Внешний PostgreSQL обслуживается его собственным supervisor. Планировщик проверки обновлений (`arkvory-update.timer` / `ProAnimaArkvoryUpdate`) отделён от служб хранения: отключение автообновлений не отключает автозапуск API/worker.

## Границы гарантии

- Linux native поддерживает systemd. Для OpenRC/runit и других init-систем встроенного регистратора пока нет; нужен отдельный проверенный адаптер или контейнерная установка с настроенным supervisor движка.
- На сервере Docker Engine должен запускаться при загрузке ОС. Проверка Linux: `systemctl is-enabled docker` и `systemctl is-active docker`; настройку выполняет администратор движка. Установщик Arkvory не перенастраивает общий Docker daemon.
- Docker Desktop с запуском только после входа пользователя не обеспечивает серверный автозапуск до входа. Для такого требования на Windows используйте нативную службу Arkvory. Podman и другие совместимые движки требуют собственного проверенного механизма запуска после перезагрузки; наличие команды `compose` не доказывает эту гарантию.
- Явный `stop` для обслуживания должен сохраняться. Supervisor не отменяет команду оператора. Для systemd/Windows служба с включённым автозапуском снова стартует при следующей загрузке ОС; контейнер с `unless-stopped` после ручного stop требует явного start.
- Readiness=false при недоступной БД не означает падение процесса. Перезапуск по одной лишь readiness не включён: он может усугубить отказ зависимости. Но необратимая потеря storage ownership/download lease завершает production API с кодом 1 после остановки передач: supervisor запускает нового владельца по обычным правилам блокировок. [ADR 0039](adr/0039-supervised-ownership-recovery.md). Обнаружение зависшего процесса watchdog-ом отдельно от crash recovery пока не реализовано.
- Падение рвёт активные соединения. Клиенты повторяют запросы/продолжают передачи; restart не заменяет HA, резервные копии и восстановление после отказа диска.

## Проверка и диагностика

Linux: `systemctl is-enabled arkvory-api arkvory-worker arkvory-database`, `systemctl status arkvory-api arkvory-worker arkvory-database`, `journalctl -u arkvory-api -u arkvory-worker -u arkvory-database`.

Windows: Services (`services.msc`), `Get-Service Arkvoryapi,Arkvoryworker,Arkvorydatabase`; свойства запуска — `Get-CimInstance Win32_Service`, действия восстановления — `sc.exe qfailure Arkvoryapi` (аналогично для остальных). Повторная регистрация восстанавливает SCM start mode и failure actions для принадлежащих этой установке служб. Логи находятся в `<root>/logs` и `<root>/database`.

Контейнеры: `docker inspect proanima-arkvory-api-1` (поля `HostConfig.RestartPolicy`, `RestartCount`, `State`), аналогично worker/database; `docker compose logs` с параметрами проекта из установки.

После аварии проверяйте `/health/ready` с health credential, логи и доступность БД/диска. При постоянном отказе конфигурации supervisor продолжает попытки с паузой; оператор устраняет причину, а не стирает данные или lock-файлы вслепую.

## Обязательная приёмка

Все проверки идут через `npm run gate`; служебные сценарии выполняются только на одноразовых GitHub Actions runners:

- `deployment-services`: регистрация → намеренное отключение autostart/recovery → повторная регистрация → проверка boot configuration → три последовательных падения API/worker → штатный stop без самопроизвольного запуска.
- `native-install`: настоящий установщик, проверка autostart API/worker/БД, аварийное завершение каждого компонента, смена PID и восстановление HTTP readiness без ручного start.
- `deployment-containers`: проверка restart policy и реальное завершение API/worker/PostgreSQL, увеличение RestartCount и возвращение readiness, затем обновление с сохранением volume.

Это проверка регистрации автозапуска и действующего crash recovery. Полная перезагрузка Windows/Linux, запуск без пользовательской сессии, задержанный старт внешней БД и восстановление после потери питания требуют отдельной приёмки на целевых машинах. CI не перезагружает runner и не выдаёт проверку конфигурации за reboot-тест.

Семантика supervisor: [WinSW 2.12 configuration](https://github.com/winsw/winsw/blob/v2.12.0/doc/xmlConfigFile.md), [Docker restart policies](https://docs.docker.com/engine/containers/start-containers-automatically/).
