# 0057. Служба агента резервных копий в установщиках и настройка vault

Статус: accepted. Owner: Ian Panaev. Дата: 2026-10-02. Продолжает [ADR 0056](0056-unattended-backups.md) (агент B2) и дополняет [ADR 0031](0031-release-installation-and-supervision.md), [ADR 0050](0050-windows-compose-engine-user.md), [ADR 0055](0055-built-in-tls.md).

## Контекст

Агент `arkvory-backup agent` (ADR 0056) работает под службой ОС, но установщики регистрировали только API и worker: оператор создавал службу вручную, без автозапуска, восстановления и обновления вместе с релизом. Путь vault задаётся только агенту (`ARKVORY_BACKUP_VAULT`), а его подготовка (права учётной записи службы, sandbox systemd, bind mount Compose) требовала ручных шагов с риском ошибиться в правах на каталог с хешами паролей и всем содержимым.

Ограничения существующих установок:

- `root/launcher.mjs` копируется один раз при установке и содержит таблицу ролей; launcher 0.2.x знает только api, worker и migrate.
- Обновление выполняет код установленной (старой) версии. Обновление с 0.2.x меняет схему (24 → 26), поэтому идёт через `upgrade` без автоматического отката.

Попутно найдено: `arkvory configure --tls-*` брал installation lock второй раз внутри уже взятого и всегда завершался «Installation is locked»; кроме того, новый `runtime.json` создавался с владельцем root:root и режимом 0640, и после перезапуска служба на Linux теряла право его читать.

## Решение

**Роль backup.** В таблице ролей launcher три службы: api, worker и backup (`apps/backup/dist/main.js agent`), а также migrate. Единственная операторская команда через launcher — `vault-init <абсолютный каталог>`: CLI `vault init` того же релиза с окружением установки, поэтому CLI сам повторяет проверку отделения vault от storage. Точка входа получает argv, как собственный исполняемый файл. Неожиданный выход службы, как у API и worker, даёт код 1.

| Supervisor | Служба                                                                                                                                          | Доступ к vault                                                                                                                                                                                                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| systemd    | `arkvory-backup`: User arkvory, тот же sandbox (ProtectSystem=strict, ProtectHome, PrivateTmp), `Restart=always` 10 с, `TimeoutStopSec=120`     | Без `ReadWritePaths`: storage только для чтения. `deploy/backup-vault-linux.sh` пишет drop-in `arkvory-backup.service.d/arkvory-vault.conf` с `ReadWritePaths="-<vault>"`, ставит владельца arkvory:arkvory и режим 0700. Повторная регистрация drop-in не трогает                                               |
| WinSW      | `Arkvorybackup`: LocalService, Automatic (Delayed), `stoptimeout` 120 с, restart через 10 с, `resetfailure` 1 ч, журналы 20 MiB × 5, как worker | `deploy/backup-vault-windows.ps1`: `icacls /inheritance:r /grant:r` SYSTEM F, Administrators F и `NT AUTHORITY\LOCAL SERVICE` (S-1-5-19) M с наследованием (OI)(CI) для новых файлов                                                                                                                             |
| Compose    | `backup`: общий runtime-шаблон (read_only, cap_drop ALL, no-new-privileges, `unless-stopped`, `stop_grace_period` 120 с), без портов            | `config/compose.vault.yml`: long syntax bind, `create_host_path: false`, цель `/srv/arkvory-vault`. Установщик добавляет `-f` только к релизу, объявляющему сервис backup. Владельца (uid 1000) выставляет одноразовый `vault-owner` (profile maintenance, root, без сети), как `initialize`; на Windows ещё ACL |

Контейнер backup монтирует только `storage:ro` и `runtime.json`: без ключей, health-токена и mailbox обновлений, зависит только от database.

На Windows используется та же учётная запись, что у API и worker. Service SID (`NT SERVICE\Arkvorybackup`) WinSW 2.12 не настраивает. Vault защищён не хуже данных и `runtime.json`, которые LocalService уже читает. UNC и SMB отклоняются: LocalService входит в сеть анонимно.

**Compose поддерживается.** Корневая ФС контейнера доступна только для чтения, а агент без `vault.json` ничего не пишет. Поэтому отсутствующий mount не превращается в запись в другое место. Несуществующий каталог не даёт контейнеру стартовать: в статусе это `agent_offline`. На Docker Desktop (bind mount 9P) проверены запись от uid 1000, rename, fsync файла и каталога и statfs; полная копия проходит в gate.

Ограничения Compose:

- Том NAS, смонтированный после старта контейнера, не виден до перезапуска backup.
- SELinux relabel не выполняется, как и для остальных bind mount профиля.
- В rootless Podman uid 1000 контейнера соответствует subuid хоста.
- Ручные команды Compose с настроенным vault должны включать `-f config/compose.vault.yml`. Иначе `up` пересоздаст backup без vault, и агент сообщит `vault_unavailable`.

**Жизненный цикл.**

- `stop`: backup → worker → api. Агент прерывает фазу как `interrupted`, задание возвращается в очередь.
- `start`: api и worker, затем backup. Ошибка запуска агента — предупреждение. Исключение — неподтверждённый timeout, который сохраняет lock. Readiness, как прежде, означает три ответа API и работающий worker.
- После старта при install, finish-install и repair, update, recover, upgrade и updates-connect выполняется ограниченное (около 90 с) ожидание `GET /api/v1/backup/status`. Запрос идёт с bootstrap-ключом через `localRequest`/`localTarget` и ждёт `agent.online`; при неудаче — WARN без отката. Ожидание стоит вне `applyUpdate`, поэтому агент не влияет на откат API.
- Совместимость: `stop` включает backup, если служба зарегистрирована (native) или текущий релиз её объявляет (Compose). `start` запускает агента, только если релиз поставляет роль (`apps/backup/dist/agent.js` или сервис в `compose.yml`).
- Принятие роли (adopt). Установка, созданная релизом без роли, получает её при первом update или upgrade кодом новой версии (в окне остановки), при `configure --backup-vault` или `updates-connect`. Это полная повторная регистрация служб, как repair, и новый `root/launcher.mjs`. Launcher заменяется атомарно и только при отличии содержимого; на Windows затем повторяется выдача прав управляемой БД (NetworkService) на новый файл. Новый launcher совместим с ролями старых релизов.
- Код 0.2.x роль не регистрирует: `manage.mjs update/upgrade` и планировщик запускают старый код. После такого обновления нужен `arkvory updates-connect` или `configure --backup-vault`. Пакеты deb, rpm и exe применяют обновление кодом нового пакета.
- Удаление и repair удаляют или регистрируют службу backup вместе с остальными. Vault вне корня и drop-in остаются нетронутыми.

**`arkvory configure --root R --backup-vault <dir> [--init-vault]` и `--backup-vault-off`.**

1. Проверка до любых изменений:
   - путь абсолютный (на Windows — с буквой диска, не UNC);
   - без символов, которые нельзя передать в unit, Compose и icacls: кавычки `"` и `'`, `$`, `%`, обратный апостроф, управляющие символы, на POSIX ещё `\`;
   - каталог существует и не является корнем ФС;
   - после realpath (symlink, junction, 8.3) он не внутри корня установки и `ARKVORY_DATA_DIR` и не содержит их (в Compose — только корень);
   - на systemd он не в /home, /root, /run/user, /tmp, /var/tmp (ProtectHome, PrivateTmp);
   - проба записи: файл создаётся и удаляется.

   Без `vault.json` нужны `--init-vault` и пустой каталог. Существующий vault заново не инициализируется.

2. Роль принимается (adopt), vault открывается (drop-in, ACL или override и `vault-owner`). Затем при необходимости выполняется `vault init`: native — `node releases/<v>/deploy/launcher.mjs <root> vault-init <dir>`, Compose — `compose run --rm --no-deps backup vault-init /srv/arkvory-vault`. После него vault открывается повторно, чтобы файлы init принадлежали учётной записи службы.
3. В `runtime.json` записывается `ARKVORY_BACKUP_VAULT`: в native — канонический путь хоста, в Compose — `/srv/arkvory-vault`. Файл заменяется с сохранением режима, владельца и группы.
4. Перезапускается только backup. До 150 с команда ждёт: `agent.online`, `vault.configured`, `vault.available` и `vault.id`, равный ID из `vault.json`. Heartbeat прежнего агента не засчитывается. Bootstrap-ключ с правом `backup.read` обязателен: отказ 401 или 403 — немедленная ошибка и откат.
5. `--backup-vault-off` удаляет переменную, закрывает доступ (drop-in или override) и ждёт агента online без vault. Права на сам vault не отзываются.
6. При ошибке восстанавливаются `runtime.json` и прежний доступ, агент перезапускается, если уже перезапускался. `vault.json`, созданный этой попыткой, остаётся: это пустой vault, который повтор использует. При неподтверждённом завершении команды отката нет, lock сохраняется.

Один вызов `configure` меняет одно: HTTPS, vault или политику обновлений. Перед HTTPS и vault проверяется журнал обновления (`checkJournal`). В `configure --tls-*` убран вложенный lock; `runtime.json` заменяется `replaceText` с сохранением режима, владельца и группы.

## Альтернативы

- Оставить регистрацию оператору: нет автозапуска, восстановления и обновления вместе с релизом.
- Включить агента в readiness: сбой vault или NAS блокировал бы обновления и откатывал API.
- Писать vault в основной unit (`ReadWritePaths`): repair переписывал бы unit без знания vault. Drop-in живёт отдельно.
- Service SID на Windows: строже, но требует SidType unrestricted вне WinSW и не проверяется локально. Оставлено на будущее.
- Отказать Compose: агент в контейнере вечно сообщал бы `vault_not_configured`, хотя bind mount проверяемо безопасен.
- Подстановка `${VAR:-…}` в `compose.yml`: для ненастроенного vault нужен фиктивный каталог. Override подключается только при настроенном vault.

## Последствия

- Новые установки сразу запускают агента. Без vault он online и сообщает `vault_not_configured`.
- Первое обновление старой установки кодом новой версии заново выставляет права каталогов, как repair. На больших деревьях это удлиняет окно обновления (предел команды — 15 минут).
- `configure` перезапускает агента: текущая копия прерывается (`interrupted`) и повторяется.
- `configure` проверяет чтение vault агентом (heartbeat). Запись агентом проверяет первая копия.

## Проверка

Unit:

- `tests/backup-setup.test.mjs`:
  - успех с существующим vault и ID из heartbeat; init только без `vault.json`;
  - отказы до изменений: относительный или отсутствующий путь, файл, корень ФС, внутри root или storage, junction внутрь root, опасные символы, непустой каталог;
  - откат при неподтверждённом vault и при сбое до перезапуска;
  - выключение, отказ bootstrap-ключа, sandbox systemd.
- `tests/backup-service.test.mjs`: таблица ролей и процесс launcher, сервис Compose и override, признак роли в релизе, сохранение режима при замене, предупреждение вместо отказа.
- `tests/tls-setup.test.mjs`.

Gates:

- `deployment`: `vault-init` через launcher собранного релиза, синтаксис скриптов служб.
- `deployment-services`: регистрация, repair, три падения и stop для api, worker и backup; drop-in открывает vault; на Linux storage для агента только для чтения.
- `native-install`:
  - служба backup активна и включена;
  - `configure --backup-vault … --init-vault`, агент сообщает vault;
  - копия опубликованного blob через `POST /api/v1/backup/runs`;
  - crash recovery агента; repair сохраняет vault; удаление не трогает vault; RPM запускает backup.
- `deployment-containers`: контейнер backup под restart policy, configure с bind mount и копия, восстановление после падения, update с тем же vault.
