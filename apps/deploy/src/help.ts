/** The HA cluster commands (ADR 0072). */
const clusterHelp = `cluster-status       HA cluster (ADR 0072), on the active node: role, complete copies, copies a
                     write needs / HA-кластер на активном узле: роль, копии, сколько нужно
cluster-single-copy  --until <ISO time with Z or offset, at most 7 days> --reason <text> | --off
                     On the active node: acknowledge writes with ONE copy until then; a second
                     failure loses them / Запись одной копией до срока; второй отказ их потеряет
cluster-replica      The arkvory-replica service (Pacemaker starts it) / Служба состояния копий
cluster-units        The arkvory-units service: units from the volume / Юниты с тома
cluster-check        Quorum, fencing of every node, DRBD quorum and fencing, both copies
                     / Проверка кластера
cluster-switchover   --to <node>  Planned move of Arkvory; the target needs a complete copy
                     / Плановое переключение
cluster-fence-test   --node <standby> [--yes]  Fence a standby to prove its device; refused unless every
                     check passes / Проверка fencing
cluster-release      While the cluster is built: stop Arkvory here, unmount the volume, make this
                     node secondary / Отдать том при сборке кластера
cluster-node         [--cluster-resource r] While the cluster is built, on each other data node:
                     takes the volume, makes the same accounts and units (none enabled), releases
                     it / Подготовить другой узел
                     --kit <file>  A replacement node, without the volume / Новый узел по комплекту
cluster-kit          --output <file>  On the active node: what a replacement node needs
                     / Комплект для нового узла
cluster-plan         --cluster ha-2|ha-3 --nodes a=10.0.0.1,b=10.0.0.2[,c=…] [--witness w=10.0.0.3]
                     --disk /dev/vg/arkvory --fence-agent fence_ipmilan --virtual-ip 10.0.0.10/24
                     --output <dir> [--cluster-resource r] [--drbd-minor 0] [--drbd-port 7789]
                     [--filesystem xfs|ext4]  DRBD resource and Pacemaker commands to review
                     / Конфигурация DRBD и Pacemaker для проверки и применения
`;

/** Module packages and operator keys (ADR 0078, ADR 0082). */
const moduleHelp = `module install <file.tgz> [--yes] [--downgrade] [--allow-stale-revocations]
                     Verify a signed module package (signature, files, compatibility, revocation),
                     show it and its terms; --yes installs it into modules/ through the journal;
                     needs a current revocation list unless stale is allowed (warned, audited)
                     / Проверить и установить подписанный пакет модуля
module list          Installed modules, each verified again; kept packages; revocation list
                     / Установленные модули с повторной проверкой
module remove <id>   Remove from the set; a module storing published bytes (data layout) is refused
                     / Удалить модуль из набора
module pin <id> <version> [--allow-stale-revocations] | module pin <id> --unpin
                     Keep the installed version / Закрепить
module revocations <file>   Store a signed revocation list; an older list is refused
                     / Список отзыва из файла
module check-revocations   Whether this release trusts the key of the stored revocation list
                     / Доверяет ли релиз ключу сохранённого списка отзыва
module trust add <file.pub | key> --label <text> [--plugins op-a-*,…] [--allow-in-process]
                     [--expires <UTC time>] [--yes]  Trust a plugin author's key on this host
                     / Доверять ключу автора плагинов
module trust list | module trust remove <keyId>   / Список доверия
`;

/** Licences of signed modules (ADR 0078, R2); the free core needs none. */
const licenseHelp = `license activate --key-file <file>   Activate a licence through the hub; the key is read
                     from the file and sent once, never stored / Активировать лицензию
license refresh [<act_…>]   Refresh now (the worker does it about daily) / Обновить сейчас
license deactivate <lic_… | act_…>   Free the place on the hub, delete the secret / Освободить место
license status [--json]   Licences, states and terms; never a key or secret / Состояние лицензий
license request --key-file <file> --out <file>   Offline: a request file without the key
                     / Файл запроса офлайн-активации
license install <file>   Offline answer or licence revocation list / Ответ офлайн или список отзыва
`;

export function deploymentHelp(): string {
  return `ProAnima Arkvory · Installation & lifecycle / Установка и обслуживание

arkvory <command> --root <absolute-directory> [options]
(cluster-plan, cluster-check, cluster-switchover, cluster-fence-test and volume-init need no --root)

install        Install a verified stable release / Установить проверенный релиз
finish-install Resume saved installation / Продолжить сохранённую установку
status         Show installed version and update policy / Состояние
updates-connect Connect console notifications and host scheduler; registers missing services
               (backup agent after an update from 0.2) / Подключить обновления и недостающие службы
updates-poll    Process one update-control tick / Проверка и обработка очереди
updates-reset   Clear an interrupted request after reconciliation / Снять запрос после проверки
changes-reset   Take site changes again after an interrupted one was checked
               / Снова принимать изменения площадки после проверки прерванного
update         Update; a schema change first captures and verifies a backup in the vault
               / Обновить; при смене схемы сначала проверенная копия
upgrade        Schema change without the built-in vault; --backup-record required / Вручную
recover        Finish an interrupted update: back before a migration, forward after it
               / Завершить прерванное обновление
${clusterHelp}${moduleHelp}${licenseHelp}volume-init    --directory <absolute dir> [--expect-mount | --no-expect-mount]
               Mark an empty directory as a new storage volume (file storage-id); the services
               never do it. --expect-mount (default on Linux): the directory must be a mount
               point / Подготовить пустой каталог как новый том хранилища
configure      --cluster ha-2|ha-3 [--cluster-resource r]: on the primary of a replicated volume,
               acknowledge writes only with two complete copies (ADR 0072) / Режим HA-кластера
configure      --enable-updates | --disable-updates | --pin --version X.Y.Z | --unpin
               --hub-url <https://origin> | --hub-off, --update-channel stable|beta,
               --statistics on|off: updates approved in the ProAnimaStudio hub (GitHub when it
               cannot be reached), anonymous statistics / Хаб обновлений, канал, статистика
               --tls-cert <pem> --tls-key <pem> [--listen-host <addr>] | --tls-off
               Built-in HTTPS; restarts, verifies, rolls back on failure / HTTPS с откатом
               --backup-vault <absolute dir> [--vault-key-file <file>] | --backup-vault-off
               --backup-vault <absolute dir> --init-vault --vault-no-encryption
               Vault of the backup agent: outside the root and storage, writable; restarts the
               agent, requires it to report the vault, rolls back on failure / Vault агента копий
               An encrypted vault (the default) is made first with "arkvory-backup vault init
               <dir> --kit-file <file> --agent-key-file <file>"; --vault-key-file gives the
               agent key (AK1-...) to install, never the recovery key. --init-vault makes a
               vault without encryption only together with --vault-no-encryption
               --mirror <repo> --mirror-upstream <https://origin> [--mirror-source <repo>]
               --mirror-token-file <file> [--mirror-stages a,b] [--mirror-ca-file <pem>]
               | --mirror-detach <repo>[,<repo>…] | --mirror-detach all
               Read-only mirror of a repository of another installation, or with
               --mirror-stages an ordinary repository importing versions given those stages
               (dev -> prod); checks the source, restarts, rolls back / Зеркало или импорт.
               A new key: --mirror <repo> --mirror-token-file <file> (source and stages stay).
               One source repository fills one repository here; a detached mirror stays
               writable and is never attached again. --mirror-ca-file adds the authority of a
               source with a corporate or self-signed certificate (TLS stays verified)
               --webhook <id> --webhook-repository <repo> --webhook-url <https url>
               --webhook-secret-file <file> [--webhook-next-secret-file <file>]
               [--webhook-actions a,b] [--webhook-allow-private <cidr,..>] [--webhook-ca-file <pem>]
               | --webhook-detach <id>
               Delivers the change feed of a repository to a receiver, signed (HMAC-SHA256);
               adds or replaces one subscription, copies the secret under config/webhooks,
               restarts, rolls back / Вебхук на получателя с подписью и откатом

Installation options:
  --artifact <directory>  Verified local release (offline)
  --mode windows|systemd|compose
  --config <json>         External database and runtime configuration
  --database-bin <path>   Dedicated local database; cannot combine with external DB
  --owner-file <json>     Private {name,password}; deleted after creating first owner
  --automatic            Opt in to stable automatic updates

Examples:
  arkvory status --root /opt/proanima-arkvory
  arkvory update --root /opt/proanima-arkvory --artifact /media/release
  arkvory configure --root /opt/proanima-arkvory --disable-updates
  arkvory configure --root /opt/proanima-arkvory --tls-cert /etc/arkvory/fullchain.pem --tls-key /etc/arkvory/privkey.pem --listen-host 0.0.0.0
  arkvory configure --root /opt/proanima-arkvory --backup-vault /mnt/backup/arkvory --vault-key-file /root/arkvory-agent.key
  arkvory configure --root /opt/proanima-arkvory --mirror releases --mirror-upstream https://arkvory.example --mirror-token-file /root/mirror.key
  arkvory configure --root /opt/proanima-arkvory --mirror releases --mirror-token-file /root/new-mirror.key
  arkvory configure --root /opt/proanima-arkvory --mirror-detach all
  arkvory cluster-plan --cluster ha-2 --nodes node-a=10.0.0.11,node-b=10.0.0.12 --witness w=10.0.0.13 --disk /dev/vg0/arkvory --fence-agent fence_ipmilan --virtual-ip 10.0.0.100/24 --output /root/arkvory-plan
  arkvory cluster-check
  arkvory cluster-switchover --to node-b
  arkvory configure --root /opt/proanima-arkvory --webhook ci --webhook-repository releases --webhook-url https://ci.example.com/hooks/arkvory --webhook-secret-file /root/ci.secret
  arkvory configure --root /opt/proanima-arkvory --webhook-detach ci

Console / Консоль: http://127.0.0.1:8080/console/#onboarding
API: /api/v1/capabilities, /api/v1/operations (authenticated / с авторизацией)
API reference and integration recipes: Console → Help / Консоль → Справка
Recovery key: <root>/config/bootstrap-token.txt (administrator only)
Never put passwords or tokens in command arguments / Не передавайте секреты аргументами.
`;
}
