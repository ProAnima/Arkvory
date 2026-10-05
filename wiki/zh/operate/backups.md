---
title: 备份
description: 连接备份存储，安排并验证备份，把恢复点恢复到空服务器，并定期测试恢复。
---

# 备份

备份代理把安装的数据库和已存储的文件复制到**备份存储**（vault）中。备份存储是另一块磁盘或网络共享上的目录。备份期间，用户可以继续上传和下载。每次完成的备份都是一个**恢复点**，您可以验证并恢复它。

本页介绍备份存储、计划、保留规则、验证、状态界面和恢复流程。恢复是在服务器上运行的命令，控制台中没有恢复按钮。

## 备份的工作方式 {#how-backups-work}

备份代理是安装中的第三个服务，与 API 和 worker 并列。它在 Linux 上名为 `arkvory-backup`，在 Windows 上名为 `Arkvorybackup`，在 Docker Compose 中名为 `backup`。同一时间只有一个代理工作。第二个代理会等待，并在第一个停止后接管。

代理做三件事：

- 计划开启时，运行每日计划。
- 运行您在控制台中、通过 `arkvoryctl` 或通过 API 请求的任务。
- 检查每个新的恢复点，并应用保留规则。

恢复点保存的是安装在某一时刻 **T**（快照时间）的已发布状态。T 之后发布的文件进入下一次备份。控制台从 T 开始计算备份的存在时间，而不是从复制完成的时间开始。

请记住以下几点：

- 备份不会停止上传或下载。备份运行期间，物理清理会保留备份所需的文件，并在之后的某一轮清理中再删除它们。
- 无论有多少个恢复点包含某个文件，该文件在备份存储中只保存一份。第一次备份会复制所有内容，因此内容达到 TB 级别时需要很长时间。之后的备份只复制新文件。
- 只有复制完成后，恢复点才会出现。失败或中断的备份绝不会损坏之前的恢复点。
- 备份不是时间点恢复系统，也不是高可用方案。您恢复的是某个恢复点的状态，T 之后的更改会丢失。

## 备份包含什么 {#contents}

恢复点包含：

- 数据库中的目录表：制品、包、文件路径及其历史记录、标签和元数据、阶段、附件、账户、组和授权、服务账户和密钥、审计记录、存储策略和清理策略、容器镜像、Git LFS 和 npm 注册表的数据，以及仓库镜像的状态。
- 每个已发布文件的内容。

恢复点不包含：

- 登录会话、下载链接和读取网关的运行状态。
- 尚未完成的上传。恢复会取消它们，客户端需要重新开始上传。
- 备份计划和代理状态。恢复后的安装在启动时备份处于关闭状态。
- 安装的 `config/` 目录：设置、TLS 文件、仓库镜像密钥、恢复密钥。请自行保管这些文件的副本。
- Arkvory 程序。请先安装一个发行版，再进行恢复。

## 准备备份存储 {#vault}

### 要求 {#vault-requirements}

| 要求                                                                               | 原因                                                                                               |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 一个新的或空的目录，在服务启动之前挂载                                             | 代理会在其中写入 `vault.json` 和恢复点                                                             |
| 位于安装目录和存储目录之外，包括通过链接、联接点（junction）和短名称指向它们的路径 | 位于存储内部的备份存储会随存储一起丢失。如果路径包含这些目录或位于其中，检查会拒绝该路径           |
| 服务账户可写                                                                       | Linux 上是 `arkvory`。Windows 上是 `NT AUTHORITY\LocalService`。`arkvory configure` 会为您设置权限 |
| 除要复制的数据外，至少还有 1 GiB 的可用空间                                        | 备份存储会保留这部分空间。卷写满时，备份会以 `vault_full` 结束，之前的恢复点保持完好               |
| 在 Linux 上，不在 `/home`、`/root`、`/run/user`、`/tmp` 或 `/var/tmp` 之下         | 服务沙箱会隐藏这些目录树                                                                           |
| 在 Windows 上，使用有盘符的本地卷或 iSCSI 卷                                       | `LocalService` 无法登录 SMB 共享，因此 `\\nas\share` 这样的路径会被拒绝                            |

请使用另一块磁盘或 NAS 上的卷，这样存储磁盘故障时备份不会一起丢失。与存储位于同一块物理磁盘上的备份存储只能防止误操作，不能防止磁盘故障。

**备份存储不加密。** 其中包含目录、密码哈希和每个已发布的文件。请把它放在加密卷上（LUKS、BitLocker、NAS 加密），并且只允许服务账户和备份管理员访问。

### 连接备份存储 {#connect-vault}

请在服务器上以 root 或管理员身份运行该命令。命令会先检查目录，然后才做出更改。

```bash
sudo arkvory configure --root /opt/proanima-arkvory --backup-vault /mnt/backup/arkvory --init-vault
```

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' configure --root $root --backup-vault D:\Backup\Arkvory --init-vault
```

对于 Windows 上的脚本安装，请按 [Windows](../install/windows#manage-the-services) 中的说明启动 `manage.mjs`。

1. 命令检查路径：必须是绝对路径，是已存在且可写的目录，位于安装目录和存储目录之外，并且对服务可见。
2. 使用 `--init-vault` 时，它会在**空**目录中创建 `vault.json`。它绝不会对同一个目录初始化两次。既没有 `vault.json` 也没有该选项时，它会拒绝执行，以免把未挂载的 NAS 当作空的备份存储。
3. 它为服务账户授予访问权限，把 `ARKVORY_BACKUP_VAULT` 写入 `config/runtime.json`，并且只重启代理。
4. 它最多等待 150 秒，直到代理报告这个备份存储可用。这项检查会读取 `config/bootstrap-token.txt`，因此请不要删除该文件。
5. 如果任何一步失败，它会恢复之前的设置和访问权限，并重启代理。

若要使用已有的备份存储（例如在新服务器上），请省略 `--init-vault`。若要断开备份存储，请使用 `--backup-vault-off`。这样不会改动该目录及其中的文件。重启会中断正在运行的备份，代理会重新执行它。

在 Docker Compose 中，备份存储是通过 `config/compose.vault.yml` 实现的绑定挂载。自行运行 Compose 命令时，请加上 `-f config/compose.vault.yml`。没有它时，`up` 创建的代理容器不带备份存储。

### 网络共享上的备份存储 {#network-share}

在 Linux 上，NAS 通过 SMB 3 和 NFS 4 工作。挂载共享时，要让文件归服务账户所有，否则代理无法写入，`configure` 会拒绝并恢复旧设置。

```bash
sudo mount -t cifs //nas/arkvory /mnt/backup/arkvory \
  -o credentials=/etc/arkvory/smb.credentials,uid=$(id -u arkvory),gid=$(id -g arkvory),file_mode=0600,dir_mode=0700,vers=3.1.1
```

- 把凭据文件的权限设为 `0600`。
- 对于 NFS，请映射所有者，使文件归 `arkvory` 所有。请在导出项上使用 `no_root_squash`，或在两侧使用相同的用户 ID。
- 在 `/etc/fstab` 中添加该挂载，并带上 `_netdev`。如果 NAS 在开机时可能不可用，对 SMB 再添加 `nofail`。
- 如果 NAS 掉线，代理会报告 `vault_unavailable`。它不会向空的挂载点写入，因为备份存储的身份保存在 `vault.json` 中。

## 计划与保留 {#schedule}

### 设置计划 {#set-schedule}

打开 [[ui:backups]]，使用 [[ui:backupPlan]]。您需要有管理备份的权限。没有该权限时，表单会显示：[[ui:backupReadOnly]]

| 设置                                                          | 含义                                                                                            | 默认值  |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------- |
| [[ui:backupEnabled]]                                          | 开启每日计划。开启后不会立即启动备份                                                            | 关      |
| [[ui:backupTime]]                                             | 每日备份的本地时间，精确到分钟                                                                  | 02:00   |
| [[ui:backupTimezone]]                                         | 该本地时间所用的 IANA 时区，例如 `Europe/Moscow` 或 `UTC`。不接受 `+03:00` 这样的偏移量         | `UTC`   |
| [[ui:backupDaily]]、[[ui:backupWeekly]]、[[ui:backupMonthly]] | 分别保留多少天、多少周、多少个月的恢复点。参见[保留规则](#retention)。范围：0–366、0–260、0–120 | 7、4、6 |

选择 [[ui:backupPlanSave]]。如果在此期间有其他人更改了计划，控制台会加载当前的计划，请检查后重新保存。

计划遵循以下规则：

- 如果某个本地时间在时钟调整当天不存在，备份会在调整的那一刻运行。如果某个本地时间出现两次，则只在第一次运行一次。
- 停机之后，代理只补做一次备份，而不是为每个错过的日子各补一次。更改计划不会为更早的时间触发补做。
- 安装的默认更新时段是 03:00 UTC。更新会停止代理，正在运行的备份会被中断，并在之后重新执行。请选择不在更新时段内的备份时间。参见[更新](../install/updates)。

### 保留规则 {#retention}

保留规则会按计划的时区，保留最近 N 个本地日中每一天的最新恢复点、最近 N 个 ISO 周中每一周的最新恢复点，以及最近 N 个月中每个月的最新恢复点。这三组取并集，因此 7、4 和 6 最多保留 17 个恢复点，通常更少。

保留规则始终保留：

- 已固定的恢复点。
- 最新的恢复点，因此至少始终留有一个恢复点。

保留规则绝不会删除验证失败的恢复点，也绝不会动同一备份存储中属于其他安装的恢复点。

每次备份之后，代理会把保留规则作为单独的任务排入队列。您也可以选择 [[ui:backupRetentionApply]]。控制台会先显示哪些恢复点保留、哪些将被删除。删除无法撤销。随后代理会删除恢复点，再删除没有任何剩余恢复点需要的文件。如果备份存储中有损坏的恢复点（恢复点目录没有 `COMMITTED` 或清单无效），删除会以 `invalid_manifest` 停止。请保持备份存储原样，查明原因，然后手动删除损坏的目录。

备份的保留规则不会改变仓库中构建的保留规则。参见[存储](./storage)。

### 固定恢复点 {#pin}

固定的恢复点不受保留规则限制，会一直保留。例如，可以固定一次大规模迁移之前的恢复点。

- 控制台：在 [[ui:backupPoints]] 中，选择该恢复点所在行的 [[ui:backupPin]]。[[ui:backupUnpin]] 会释放它。
- CLI：`arkvoryctl backup pin POINT_ID`，以及 `arkvoryctl backup pin POINT_ID --off`。
- API：[setBackupPointPin](../api/reference/backups#setBackupPointPin)。

## 验证 {#verification}

验证有两种：

| 类型                                              | 检查内容                                                                       | 运行时机                                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 快速（控制台显示“[[ui:backupVerifyStructural]]”） | 恢复点中每个文件与其清单中摘要的一致性，以及每个已存储的文件是否存在且大小正确 | 每次备份之后自动运行                                                                                                                                        |
| 完整（“[[ui:backupVerifyDeep]]”）                 | 包含快速检查，并读取每个已存储的文件，检查其 SHA-256                           | 对最新的恢复点每 7 天自动运行一次。也可以通过 [[ui:backupVerifyDeepAction]]、`arkvoryctl backup verify POINT_ID` 或 `arkvory-backup verify --deep` 按需运行 |

完整验证会读取整个恢复点，因此备份存储很大时需要时间和磁盘吞吐量。如果恢复点未通过验证，控制台会显示“[[ui:backupVerifyFailed]]”和错误代码，同时警告 `verify_failed` 变为活动状态。在查明原因之前，请不要改动备份存储。

尚未检查的恢复点显示“[[ui:backupVerifyNone]]”。对最新恢复点做完整验证，也是检查备份存储是否可读的最佳例行方式。

## 立即运行备份 {#run-now}

可以使用以下任一方式：

- 控制台：[[ui:backups]] 中的 [[ui:backupRun]]。
- CLI：`arkvoryctl backup run`。
- API：[requestBackupRun](../api/reference/backups#requestBackupRun) 返回 202 以及已排队的任务。

代理每 15 秒检查一次队列（`ARKVORY_BACKUP_POLL_SECONDS`），因此任务很快就会开始。任务逐个运行，关闭控制台不会停止它们。因重启或冲突而停止的任务会被重新执行，最多尝试 5 次。代理的设置（包括复制速率限制 `ARKVORY_BACKUP_BYTES_PER_SECOND`）参见[环境变量](../reference/environment#backups)。

备份依次经过以下阶段，控制台在“[[ui:backupJobPhase]]”中显示它们：[[ui:backupPhasePreparing]]、[[ui:backupPhaseCatalog]]、[[ui:backupPhaseTransfer]]、[[ui:backupPhaseFinishing]] 和 [[ui:backupPhaseDone]]。快速检查显示“[[ui:backupPhaseStructural]]”，完整检查显示“[[ui:backupPhaseDeep]]”。

备份期间，请不要运行数据库迁移或离线工具 `gc` 和 `scrub`。它们会等待备份结束，或以 `busy` 拒绝执行。

## 查看状态 {#status}

### 在控制台中 {#status-console}

[[ui:backups]] 对管理员和恢复密钥可见。服务密钥和个人访问令牌永远看不到它。该页面显示：

- 状态：“[[ui:backupStateOk]]”“[[ui:backupStateWarning]]”或“[[ui:backupStateCritical]]”。
- “[[ui:backupNewest]]”及其从 T 起的存在时间，“[[ui:backupNextRun]]”（运行延迟时带有“[[ui:backupOverdue]]”），“[[ui:backupAgent]]”及其最后一次信号，以及“[[ui:backupVault]]”及其可用空间。
- 正在运行的任务，然后是警告，每条警告都附有应该怎么做的提示。
- [[ui:backupPoints]]，包含“[[ui:backupSnapshot]]”“[[ui:backupCompleted]]”“[[ui:backupSize]]”“[[ui:backupFiles]]”“[[ui:backupVerification]]”和固定操作。
- [[ui:backupJobs]]，包含类型（“[[ui:backupKindCapture]]”“[[ui:backupKindVerify]]”“[[ui:backupKindRetention]]”）、状态、阶段、时间、错误代码和进度。

任务处于以下状态之一：“[[ui:backupJobQueued]]”“[[ui:backupJobRunning]]”“[[ui:backupJobCommitting]]”“[[ui:backupJobCompleted]]”“[[ui:backupJobFailed]]”或“[[ui:backupJobInterrupted]]”。任务运行期间页面会自动刷新。您随时可以选择 [[ui:backupRefresh]]。

### 警告 {#warnings}

| 代码                   | 级别 | 处理方法                                                                           |
| ---------------------- | ---- | ---------------------------------------------------------------------------------- |
| `vault_not_configured` | 警告 | 连接备份存储。参见[连接备份存储](#connect-vault)                                   |
| `agent_offline`        | 严重 | 2 分钟内没有信号。启动代理服务并查看其日志                                         |
| `schedule_disabled`    | 警告 | 如果需要每日备份，请开启计划                                                       |
| `no_backup_yet`        | 警告 | 创建第一次备份                                                                     |
| `backup_stale`         | 严重 | 计划开启时，最新的恢复点已超过 26 小时。请查看任务的错误代码和代理日志             |
| `last_run_failed`      | 警告 | 上一次备份失败。错误代码在任务列表中                                               |
| `vault_unavailable`    | 严重 | 卷未挂载、缺少 `vault.json`，或备份存储不可写                                      |
| `vault_low_space`      | 警告 | 卷的可用空间不足 10%，或少于上一次备份新增数据的两倍。请释放空间或减少保留的恢复点 |
| `verify_failed`        | 严重 | 某个恢复点未通过验证。请不要改动备份存储，先进行调查                               |
| `never_deep_verified`  | 警告 | 超过 8 天没有进行完整验证。请检查代理是否在运行，或启动一次完整验证                |

### 使用 CLI 和 API {#status-cli}

```bash
arkvoryctl backup status
arkvoryctl backup jobs
arkvoryctl backup points
arkvoryctl backup status --json || echo "backup problem"
```

当有严重警告处于活动状态时，`backup status` 以退出代码 9 结束，因此可以在监控中使用。这些命令需要所有者的文件密钥或账户管理员的会话。参见[命令行客户端](../protocols/cli#backups)和 [TypeScript SDK](../protocols/sdk#backups)。HTTP 操作见[备份 API 参考](../api/reference/backups)。

对于 Prometheus，API 提供 `arkvory_backup_last_success_timestamp_seconds`（最新恢复点的 T）、`arkvory_backup_agent_last_seen_timestamp_seconds` 以及带有 `code` 标签的 `arkvory_backup_warnings`。参见[监控](./monitoring)。

## 恢复 {#restore}

恢复会写入**空**数据库和**空**存储目录。它绝不会覆盖正在运行的安装。恢复之后，请在恢复的数据上启动一个单独的实例，检查它，然后再决定是否用它替换旧服务器。

### 开始之前 {#restore-prepare}

- **程序。** 恢复命令是已安装发行版的 `arkvory-backup` 程序。请使用该安装自带的 Node.js 来启动它：
  - Linux 软件包：`/opt/proanima-arkvory/runtime/node /opt/proanima-arkvory/releases/VERSION/apps/backup/dist/main.js COMMAND`
  - Windows 图形安装程序：`& "$root\runtime\node.exe" "$root\releases\VERSION\apps\backup\dist\main.js" COMMAND`

  `VERSION` 是 `installation.json` 中的已安装版本。在本页其余部分，`arkvory-backup` 指的是这整条命令行。Docker Compose 用户从发行版容器镜像的容器中运行同一个程序。对于脚本安装，请使用 `runtime/` 下的 Node.js 文件夹。

- **发行版。** 请使用生成该恢复点的发行版或更新的发行版。来自更新发行版的恢复点会以 `schema_mismatch` 被拒绝。
- **账户。** 请使用能读取备份存储的账户运行命令。在 Linux 上，备份存储属于 `arkvory`，权限为 0700，因此请使用 `sudo -u arkvory`。在 Windows 上，请使用提升权限的 PowerShell。新的存储目录最终必须归运行 API 的账户所有。
- **目标。** 创建一个空数据库，例如 `CREATE DATABASE arkvory_restore OWNER arkvory;`。选择一个不存在或为空的存储目录，它必须位于与备份存储不同的卷上，且不在源存储内部。
- **数据库 URL。** 请通过环境变量传递，不要作为参数传递，因为参数在进程列表中是可见的。

### 逐步恢复 {#restore-steps}

1. 列出恢复点并选择一个。复制恢复点 ID。

   ```bash
   arkvoryctl backup points
   arkvory-backup list --vault /mnt/backup/arkvory
   ```

2. 对该恢复点进行完整验证。

   ```bash
   arkvory-backup verify --vault /mnt/backup/arkvory --point POINT_ID --deep
   ```

3. 在环境变量中设置目标数据库。

   ```bash
   export ARKVORY_RESTORE_DATABASE_URL='postgresql://arkvory@db.example/arkvory_restore'
   ```

4. **不带** `--yes` 运行恢复。这是一次试运行。它会检查恢复点、文件哈希、架构版本以及目标是否为空，不会写入任何内容。

   ```bash
   arkvory-backup restore --vault /mnt/backup/arkvory --point POINT_ID --storage /srv/arkvory-restore
   ```

   检查通过时，命令以退出代码 0 结束，并输出日志行 `backup.restore.planned`。

5. 带上 `--yes` 运行同一条命令。添加 `--report` 可以保留报告文件。该文件必须尚不存在。

   ```bash
   arkvory-backup restore --vault /mnt/backup/arkvory --point POINT_ID --storage /srv/arkvory-restore --yes --report /root/restore-report.json
   ```

   恢复依次经过 `verify`、`content`、`schema`、`tables`、`migrate` 和 `done` 阶段。它复制每个文件并检查其 SHA-256，创建架构，在一个事务中加载所有表，应用规范化，然后运行其余的迁移。报告只包含标识符和计数，绝不包含路径或凭据。

6. 在恢复的数据上启动一个单独的 API 实例：`ARKVORY_DATABASE_URL` 指向新数据库，`ARKVORY_DATA_DIR` 指向新目录，使用它自己的 `ARKVORY_KEYS_FILE` 和另一个端口。检查 `/health/ready` 是否有响应，能否登录，目录是否完整，以及一个对照文件下载后的 SHA-256 是否相同。

如果恢复失败，请删除目标数据库和目录，然后重新创建。目标不为空时，会以 `target_not_empty` 被拒绝，这样可以保护已有数据。

### 恢复会更改什么 {#after-restore}

恢复会应用一组固定的更改，使新实例不会延续任何进行中的操作，也不会启用任何旧凭据：

- 未完成的上传会被取消，并释放其配额。排队和运行中的完成任务会以失败结束，代码为 `conflict`。未完成的晋级会被丢弃。
- 不会恢复任何会话。所有人都需要重新登录。
- 所有个人访问令牌都会被撤销，所有服务密钥都变为 `revoked`。请签发新的密钥。
- 每个仓库中的存储保留规则和物理清理都会被关闭。请有意识地重新开启它们。
- 备份处于关闭状态，也没有配置备份存储。下载链接和读取网关的设置不会带过来。
- 账户、组和授权会保留，密码哈希为 T 时刻的状态。T 之后您更改过的密码，会以旧的形式重新生效，因此请按您自己的策略重置密码。
- 恢复密钥和文件密钥来自运行恢复数据的那个安装的密钥文件。
- 仓库镜像保留其位置，但仓库镜像的设置在 `config/` 中。请重新连接。参见[仓库镜像](./mirrors)。
- 一条安全审计记录 `backup.restored` 会记录恢复点和各项计数。

### 迁移到另一台服务器 {#move-server}

您可以使用备份把安装迁移到另一台服务器：

1. 在新服务器上安装与原来相同或更新的发行版的 Arkvory。参见[选择安装方式](../install/index)。
2. 把同一个备份存储或它的副本连接到新服务器。对已有的备份存储，不要使用 `--init-vault`。
3. 按上文所述，把最新的恢复点恢复到新的空数据库和空目录中，并测试结果。
4. 让安装指向恢复的数据：在 `config/runtime.json` 中设置 `ARKVORY_DATABASE_URL` 和 `ARKVORY_DATA_DIR`，然后重启服务。参见[配置](../install/configuration)。
5. 签发新的密钥，重新设置保留策略和清理策略，连接仓库镜像和备份计划，并把新地址告知客户端。

最后两步是手动的，不属于有引导的切换流程。请先在备用服务器上完整演练整个流程。T 之后在旧服务器上做的更改会丢失，因此请在客户端迁移之前停止旧服务器。

## 定期测试恢复 {#test-restore}

从未恢复过的备份只是一种希望。产品会验证恢复点的字节，但不会记录测试恢复。请自行记录日期和结果。

至少在以下时机测试：

- 第一次备份之后。
- 每次更改数据库架构的更新之后。
- 按您自己的计划，例如每季度一次。

每次测试都按[逐步恢复](#restore-steps)在备用服务器或临时数据库上进行，并以登录、查看目录和下载一个对照文件结束。之后请删除临时数据库和目录。

## 退出代码和日志行 {#exit-codes}

### 退出代码 {#exit-codes-table}

`arkvory-backup` 程序每行向标准输出写入一个 JSON 对象，失败时向标准错误写入一行提示。

| 代码 | 含义                                                                                    |
| ---- | --------------------------------------------------------------------------------------- |
| 0    | 成功。对于不带 `--yes` 的 `restore`，表示检查通过                                       |
| 1    | 运行失败：数据库或磁盘不可用，租约或快照丢失，备份存储或目标已满。恢复点没有损坏        |
| 2    | 参数或环境变量有误                                                                      |
| 3    | 安全检查拒绝执行：没有 `vault.json`、目录重叠、目标不为空、不支持的架构、没有这个恢复点 |
| 4    | 完整性故障：哈希、缺失的文件或被更改的清单。在弄清原因之前，请保持备份存储不变          |
| 5    | 忙：另一个备份或维护任务正在运行，或删除没有及时完成。请稍后重试                        |

### 日志行 {#log-lines}

每一行的 `component` 都设为 `backup`。路径、URL 和机密绝不会写入。最有用的几行：

| 代码                                                                                        | 含义                                                                                                           |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `backup.phase`                                                                              | 备份进入某个阶段：`barrier`、`pins`、`tables`、`blobs`、`manifest`、`commit`、`done`                           |
| `backup.capture.completed`                                                                  | 备份完成。字段：`pointId`、`outcome`、`blobs`、`copied`、`reused`、`copiedBytes`、`contentBytes`、`durationMs` |
| `backup.point`                                                                              | `list` 输出中的一个恢复点                                                                                      |
| `backup.verify.point`、`backup.verify.problem`                                              | 验证的结果，以及每个问题及其 `errorCode`                                                                       |
| `backup.restore.phase`、`backup.restore.planned`、`backup.restore.completed`                | 恢复的进度和结果，包含行数以及上面列出的各项更改的计数                                                         |
| `backup.failed`                                                                             | 命令失败。请查看 `errorCode`                                                                                   |
| `backup.agent.started`、`.standby`、`.lease_acquired`、`.lease_lost`、`.stopped`、`.failed` | 代理的生命周期                                                                                                 |
| `backup.request.started`、`.done`、`.failed`、`.requeued`                                   | 代理的一个任务，带有 `kind` 和 `errorCode`                                                                     |
| `backup.schedule.due`                                                                       | 计划启动了一次备份                                                                                             |
| `backup.retention.applied`                                                                  | 保留规则已执行完毕。字段：`forgotten`、`blobs`、`freedBytes`                                                   |

在 Linux 上用 `journalctl -u arkvory-backup` 查看代理日志，在 Windows 上查看安装根目录的 `logs\`，在 Compose 中使用 `docker compose logs backup`。

### 错误代码 {#error-codes}

| `errorCode`                                              | 退出代码 | 处理方法                                                           |
| -------------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| `vault_missing`                                          | 3        | 目录中没有 `vault.json`。请挂载卷，或运行一次 `vault init`         |
| `unsafe_path`                                            | 3        | 请让备份存储、存储目录和恢复目标位于相互独立的目录树中             |
| `target_not_empty`                                       | 3        | 恢复只会写入空数据库和空目录                                       |
| `schema_mismatch`                                        | 3        | 恢复点比发行版更新，或比受支持的恢复版本更旧。请使用其他发行版     |
| `upgrade_required`                                       | 3        | 请更新安装中的每个 API 和维护进程                                  |
| `point_not_found`、`storage_mismatch`                    | 3        | 恢复点 ID 有误，或 `ARKVORY_DATA_DIR` 不是该安装已初始化的存储目录 |
| `integrity_mismatch`、`invalid_manifest`、`blob_missing` | 4        | 保持备份存储不变。运行 `verify --deep` 并进行调查                  |
| `busy`、`barrier_timeout`                                | 5        | 另一项操作正在运行。请稍后重试                                     |
| `vault_full`、`storage_full`                             | 1        | 释放空间。之前的恢复点完好无损                                     |
| `attempts_exhausted`                                     | 3        | 此请求已用完 5 次尝试。请启动一次新的备份                          |

## 限制 {#limits}

- 每个安装只有一个计划和一个备份存储。备份存储是磁盘或已挂载共享上的目录，不支持 S3，也没有异地或不可变的配置。
- Arkvory 不会加密备份存储。
- 您无法暂停或取消备份任务，控制台也没有恢复向导，不显示恢复测试状态。
- 恢复需要空的目标，切换到恢复后的数据是手动步骤。
- 备份代理不是高可用系统。第二个代理只是作为备用等待。

## 相关页面 {#related-pages}

- [选择安装方式](../install/index)
- [更新](../install/updates)
- [存储](./storage)
- [仓库镜像](./mirrors)：用于第二个站点
- [监控](./monitoring)
- [自愈](./self-healing)
- [故障排查](./troubleshooting)
- [环境变量](../reference/environment#backups)
