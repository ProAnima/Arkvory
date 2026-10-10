export function deploymentHelp(): string {
  return `ProAnima Arkvory · Installation & lifecycle / Установка и обслуживание

arkvory <command> --root <absolute-directory> [options]

install        Install a verified stable release / Установить проверенный релиз
finish-install Resume saved installation / Продолжить сохранённую установку
status         Show installed version and update policy / Состояние
updates-connect Connect console notifications and host scheduler; registers missing services
               (backup agent after an update from 0.2) / Подключить обновления и недостающие службы
updates-poll    Process one update-control tick / Проверка и обработка очереди
updates-reset   Clear an interrupted request after reconciliation / Снять запрос после проверки
update         Update; a schema change first captures and verifies a backup in the vault
               / Обновить; при смене схемы сначала проверенная копия
upgrade        Schema change without the built-in vault; --backup-record required / Вручную
recover        Finish an interrupted update: back before a migration, forward after it
               / Завершить прерванное обновление
cluster-status       HA cluster (ADR 0072): role, complete copies, copies a write needs
                     / HA-кластер: роль, полные копии, сколько нужно для записи
cluster-single-copy  --until <ISO time, at most 7 days> --reason <text> | --off
                     Acknowledge writes with ONE copy until then; a second failure loses them
                     / Подтверждать запись одной копией до срока; второй отказ их потеряет
cluster-replica      The arkvory-replica service (Pacemaker starts it) / Служба состояния копий
cluster-node         [--cluster-resource r] On another data node, with the volume mounted:
                     the same accounts and units, none enabled / Подготовить другой узел
cluster-plan         --cluster ha-2|ha-3 --nodes a=10.0.0.1,b=10.0.0.2[,c=…] [--witness w=10.0.0.3]
                     --disk /dev/vg/arkvory --fence-agent fence_ipmilan --virtual-ip 10.0.0.10/24
                     --output <dir> [--cluster-resource r] [--drbd-minor 0] [--drbd-port 7789]
                     [--filesystem xfs|ext4]  DRBD resource and Pacemaker commands to review
                     / Конфигурация DRBD и Pacemaker для проверки и применения
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
               <dir> --kit-file <file> --agent-key-file <file>"; --vault-key-file gives the agent key (AK1-...) to install, never the recovery key. --init-vault makes a
               vault without encryption only together with --vault-no-encryption
               --mirror <repo> --mirror-upstream <https://origin> [--mirror-source <repo>]
               --mirror-token-file <file> [--mirror-stages a,b] [--mirror-ca-file <pem>]
               | --mirror-detach <repo>
               Read-only mirror of a repository of another installation, or with
               --mirror-stages an ordinary repository importing versions given those stages
               (dev -> prod); checks the source, restarts, rolls back / Зеркало или импорт;
               --mirror-ca-file trusts the authority of a source with a corporate or
               self-signed certificate besides the defaults (TLS stays verified)
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
  arkvory configure --root /opt/proanima-arkvory --mirror-detach releases
  arkvory configure --root /opt/proanima-arkvory --webhook ci --webhook-repository releases --webhook-url https://ci.example.com/hooks/arkvory --webhook-secret-file /root/ci.secret
  arkvory configure --root /opt/proanima-arkvory --webhook-detach ci

Console / Консоль: http://127.0.0.1:8080/console/#onboarding
API: /api/v1/capabilities, /api/v1/operations (authenticated / с авторизацией)
API reference and integration recipes: Console → Help / Консоль → Справка
Recovery key: <root>/config/bootstrap-token.txt (administrator only)
Never put passwords or tokens in command arguments / Не передавайте секреты аргументами.
`;
}
