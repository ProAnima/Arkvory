---
title: 故障排查
description: 'Arkvory 服务器上发生的故障的症状、原因和修复方法，以及如何查找日志和请求 ID。'
---

# 故障排查

找到你的症状，阅读原因并应用修复方法。每一节都会指明你应当看到的日志事件或错误。有关错误代码的含义，请参见[错误](../api/errors)。

## 初步步骤 {#first-steps}

1. 查询状态端点：`curl -fsS http://127.0.0.1:8080/health/status`。`{"status":"ready"}` 表示 API 可以访问它的数据库和存储。
2. 阅读故障服务的最新日志行。参见[日志与反馈](#logs-and-feedback)。
3. 查找事件 `startup.failed` 或 `worker.unavailable`。其字段 `reason` 指明原因。
4. 如果客户端报告错误，请询问请求 ID 并在日志中搜索它。

## 服务器无法启动 {#server-does-not-start}

服务管理器每 10 秒重新启动失败的服务。日志随后会重复出现 `startup.failed`。阅读字段 `reason`，以及字段 `errno` 和 `sqlstate`。

### 端口被占用 {#port-busy}

**原因。** `startup.failed` 带有 `errno` `EADDRINUSE`。另一个程序在端口 8080（`ARKVORY_PORT`）上监听，或者旧的 Arkvory 进程仍在运行。

**修复。** 找到该端口的占用者并停止它，或更改端口。

```bash
sudo ss -ltnp 'sport = :8080'
```

```powershell
Get-NetTCPConnection -LocalPort 8080 | Select-Object LocalAddress, OwningProcess
```

要更改端口，请编辑 `config/runtime.json` 中的 `ARKVORY_PORT` 并重启服务。控制台的地址也会随之更改。

### 数据库不可达或拒绝登录 {#database-problems}

**原因。** 日志显示以下原因之一：

| `reason`                                                             | 含义                                                |
| -------------------------------------------------------------------- | --------------------------------------------------- |
| `dependency unavailable`，带有 `errno` `ECONNREFUSED` 或 `ETIMEDOUT` | PostgreSQL 已停止、在其他位置监听，或防火墙阻止了它 |
| `database authentication failed`                                     | `ARKVORY_DATABASE_URL` 中的用户或密码错误           |
| `database does not exist`                                            | URL 中指定的数据库不存在                            |
| `database role lacks a required privilege`                           | 该角色无法创建或更改表                              |

**修复。** 启动 PostgreSQL，或更正 `config/runtime.json` 中的 `ARKVORY_DATABASE_URL` 并重启服务。受管数据库在 `127.0.0.1:54329` 上监听（Windows 上的服务为 `Arkvorydatabase`，Linux 上为 `arkvory-database`）。当数据库应答时，服务会自行启动。不要删除 `database/` 文件夹。

### 数据库与程序不一致 {#migrations}

**原因。** 原因以 `unavailable:` 开头，并显示 `Database migrations 1 through N are required; run migrate`，或 `Database schema is newer than this release`，或 `database schema is missing; run migrations`。这发生在一半停止的更新之后，或者在较新的数据库上启动了旧版本之后。

**修复。** 不要在较新的数据库上启动旧版本。使用 `arkvory status --root <root>` 检查状态，并用 `recover` 完成或撤销更新。参见[更新失败](#update-failed)。为保护数据安全，只有在 `recover` 无法完成时才从备份恢复。

### 另一个进程拥有该存储 {#storage-identity}

**原因。** 原因可能是 `busy: Another writer or maintenance process owns this database`，或 `conflict: Database belongs to a different storage directory`。第二个 API 针对同一个数据库运行，或者数据目录不是该数据库曾使用的那个。每个存储目录都有一个文件 `storage-id`，数据库会记录它。

**修复。** 停止另一个进程。使用属于该数据库的数据目录。绝不要把 `storage-id` 复制到另一个目录，也绝不要把两个安装实例连接到同一个数据库。

### 根目录或数据目录的权限 {#root-permissions}

**原因。** `errno` 是 `EACCES` 或 `EPERM`，或者原因是 `Cannot read ARKVORY_KEYS_FILE (EACCES)`。服务账户无法读取配置或写入数据目录。典型原因是安装在用户配置文件中、手动复制的文件夹，或所有者被更改。

**修复。**

- Linux：根目录和 `config/` 属于 `root:arkvory`，模式为 0750。`config/runtime.json` 和 `config/keys.json` 的模式为 0640。`data/` 和 `logs/` 属于 `arkvory:arkvory`。
- Windows：账户 `NT AUTHORITY\LocalService` 必须能读取根目录的每个父文件夹，并更改 `data\`、`logs\` 和更新收件箱。请再次运行图形安装程序以恢复访问规则。
- 安装到主目录和用户配置文件之外的专用文件夹中。

### 设置或证书被拒绝 {#invalid-configuration}

**原因。** 原因会指明某个变量，例如 `Invalid ARKVORY_PORT`，或者证书问题：`TLS certificate has expired`、`TLS certificate and key do not match`、`TLS key is not an unencrypted PEM private key`。当证书错误时，服务器绝不会以明文 HTTP 启动。

**修复。** 更正 `config/runtime.json` 中指定的变量。超出其范围的值会阻止启动。续订或替换证书文件。在你修复文件期间，使用 `arkvory configure --tls-off` 返回明文 HTTP。参见[环境变量](../reference/environment)。

## 控制台无法访问 API {#console-unreachable}

| 控制台中的消息              | 原因                                                                                                        | 修复                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [[ui:errorNetwork]]         | 浏览器得不到应答：服务已停止、地址或端口错误、防火墙阻止、服务器仅在 `127.0.0.1` 上监听，或证书与名称不匹配 | 从与浏览器相同的计算机测试 `/health/status`。检查服务、监听地址和防火墙     |
| [[ui:errorGateway]]         | 反向代理有应答，但它后面的 API 没有                                                                         | 检查 API 是否在运行，以及代理是否指向它的端口。为大型传输提高代理的读取超时 |
| [[ui:errorTimeout]]         | 服务器未及时应答                                                                                            | 在日志中查找 `upload.deadline` 或繁忙的数据库                               |
| [[ui:errorUnavailable]]     | 数据库等依赖短暂不可用                                                                                      | 等待并重试。参见[繁忙与不可用](#retry-after)                                |
| [[ui:errorOriginForbidden]] | 外部控制台运行在 `ARKVORY_CORS_ORIGINS` 未列出的地址上                                                      | 添加确切的来源（协议、主机和端口）并重启 API                                |
| [[ui:sessionEnded]]         | 你在别处退出了登录、密码已更改，或访问权限被撤销                                                            | 重新登录                                                                    |

更新期间，控制台会自行重新连接。不要再次发送安装请求。如果使用 Docker Desktop，服务器会一直不可用，直到 Docker Desktop 运行。参见 [Docker](#docker)。

## 登录问题 {#sign-in}

### 名称或密码错误 {#wrong-password}

**原因。** 消息是 [[ui:signInFailed]]（401 `invalid_credentials`）。对于错误的名称、错误的密码和已禁用的账户，服务器给出相同的应答，这样没有人能查出哪些名称存在。

**修复。** 管理员可以在 [[ui:administration]] 中检查该账户，如果它已被禁用则使用 [[ui:enableUser]]，或使用 [[ui:resetPassword]] 设置新密码。

### 尝试次数过多 {#too-many-attempts}

**原因。** 应答是 429 `rate_limited`，带有 `login_attempts` 和 `Retry-After`。该地址已用完它的 10 次尝试，或者账户在多次错误密码后处于等待中（最多 2 分钟）。在这段时间里，即使密码正确也要等待。

**修复。** 等待 `Retry-After` 中的秒数。管理员可以通过重置密码清除账户的等待。重启 API 会清除地址的计数器，但不会清除账户的等待。

### 所有人在代理后面都被阻止 {#blocked-behind-proxy}

**原因。** 服务器把代理的地址看作每个客户端的地址，因此所有客户端共享一份预算。

**修复。** 将 `ARKVORY_TRUSTED_PROXIES` 设置为代理的地址并重启 API。代理必须发送 `X-Forwarded-For`。参见[安全](./security#sign-in-limits)。

### 所有者丢失 {#owner-lost}

**原因。** 没有人记得管理员密码。

**修复。** 在服务器上使用恢复密钥：

1. 以 root 或 Administrator 身份从 `config/bootstrap-token.txt` 读取密钥。
2. 在控制台中打开 [[ui:keySignIn]]，粘贴密钥并选择 [[ui:connect]]。
3. 打开 [[ui:administration]]。对该账户使用 [[ui:resetPassword]]，或使用 [[ui:createUser]] 创建新的管理员。
4. 选择 [[ui:disconnect]] 并使用该账户登录。

表单 [[ui:welcomeOwner]] 只在服务器完全没有账户时可用。

### 恢复密钥丢失 {#recovery-key-lost}

**原因。** 文件 `config/bootstrap-token.txt` 被删除或从未保存。服务器只保存密钥的哈希。

**修复。** 在服务器上以 root 或 Administrator 权限写入新密钥及其哈希。参见[配置](../install/configuration)。不要再删除该文件：安装工具会读取它。

## 上传 {#uploads}

### 上传无法完成 {#upload-stuck}

**原因。** 可能有几种原因：

- 客户端失去了连接。分片上传会保留它已记录的分片 7 天。
- 大型上传在等待工作进程。工作进程已停止，或它失败了。第二个工作进程会作为备用等待。
- 同时运行的上传太多。默认运行 2 个，每个账户 1 个，其他的等待 20 秒，然后收到 503 `busy`。
- 反向代理拒绝较大的正文（413），或停止较慢的请求（502 或 504）。

**修复。**

1. 查询上传的状态：`arkvoryctl uploads status <id>`。使用相同的文件和相同的状态文件续传。参见[命令行](../protocols/cli#resume-interrupted-transfers)。
2. 检查工作进程：`systemctl status arkvory-worker`、`Get-Service Arkvoryworker`。查找带有 `uploadId` 的 `completion.failed` 和 `completion.attempts_exhausted`。指标 `arkvory_completion_oldest_queued_seconds` 显示等待中的任务。
3. 提高代理对正文大小和读取时间的限制。上传请求在 30 秒没有数据后以及在总计 30 分钟后停止。
4. 超过 7 天的会话已失效（409 `upload_expired`）。请开始新的上传。

### integrity_mismatch {#integrity-mismatch}

**原因。** 应答是 422 `integrity_mismatch`，或者客户端以退出码 5 退出。字节与声明的大小或 SHA-256 不匹配。文件在发送期间发生了变化，声明的哈希是为另一个文件计算的，或者代理或网络设备更改了正文。

**修复。** 从未更改的副本再次发送文件。会话保持打开，因此可以把更正后的文件发送进去。如果下载屡次校验失败，请通过另一条路径再下载一次，然后报告请求 ID。参见[日志与反馈](#logs-and-feedback)。

## 繁忙、速率受限、不可用 {#retry-after}

代码 `busy`、`unavailable` 和 `rate_limited` 是临时的。应答带有响应头 `Retry-After` 和字段 `retryAfterSeconds`。请等待这么长时间。SDK 和命令行客户端会有限次地重复这些应答。

| 应答                             | 原因                                                                                                  | 处理方式                                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 503 `busy`，原因 `request_limit` | 服务器同时处理 `ARKVORY_MAX_REQUESTS` 个请求（默认 128）                                              | 等待。只有在内存充足时才提高限制。检查 `arkvory_http_requests_in_flight`                                                                    |
| 503 `busy`                       | 传输队列已满、某个传输等待时间超过 `ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS`（20 秒），或服务器在停止前排空 | 等待并重试。如果频繁发生，请提高 `ARKVORY_MAX_UPLOADS` 或 `ARKVORY_MAX_DOWNLOADS`。`arkvory_transfer_admission_failures_total` 统计拒绝次数 |
| 503 `unavailable`                | 数据库重启、进程失去了存储所有权，或中心（hub）不可达（`hub_unreachable`）                            | 等待。服务会自行重启。参见[自愈](./self-healing)                                                                                            |
| 429 `rate_limited`               | 登录、注册、密码或反馈尝试过多                                                                        | 等待。参见[尝试次数过多](#too-many-attempts)                                                                                                |

500 `internal` 没有 `Retry-After`。不要盲目重复它。在日志中搜索它的请求 ID 并报告。

## 磁盘写满与配额 {#disk-full}

| 应答，原因          | 原因                                                                                         | 修复                                                                |
| ------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 507 `storage_full`  | 存储卷的可用空间低于预留 `ARKVORY_STORAGE_RESERVE_BYTES`（默认 1 GiB），或数据库所在磁盘已满 | 释放卷上的空间。检查 `df -h` 或 `Get-PSDrive`，以及 PostgreSQL 的卷 |
| 507 `storage_quota` | 仓库配额已用完                                                                               | 删除旧构建、更改保留策略，或在 [[ui:repositoryStorage]] 中提高配额  |
| 507 `catalog_limit` | 所有预留内容之和将超过 `ARKVORY_CAPACITY_BYTES`（默认 10 TiB）                               | 删除内容，或提高 `config/runtime.json` 中的值                       |
| 507 `queue_full`    | 某个账户有 100 个未完成的完成作业，或服务器有 10,000 个                                      | 等待工作进程完成它们                                                |

磁盘写满期间，下载和控制台继续工作。`/health/ready` 显示 `"writable": false`。在 Arkvory 中删除制品不会立即释放磁盘：文件会在其宽限期后等待物理清理。参见[存储](./storage)。不要降低预留来塞入更多数据，因为数据库和日志需要它。

## 备份失败 {#backups-failing}

从 [[ui:backups]] 中的警告或 `arkvoryctl backup status` 开始，以及带有 `errorCode` 的日志事件 `backup.request.failed` 和 `backup.agent.failed`。参见[备份](./backups)。

| 警告或消息                                                                               | 原因                                                                                 | 修复                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_offline`                                                                          | 备份服务已停止，或它无法启动                                                         | 启动 `arkvory-backup` 或 `Arkvorybackup`。阅读它的日志                                                                                                                                                              |
| `vault_unavailable`                                                                      | 备份存储卷未挂载、没有 `vault.json`，或服务账户无法写入它                            | 在服务启动前挂载该卷。检查所有者和权限。在 Windows 上，如果卷是稍后挂载的，请重启备份代理                                                                                                                           |
| `The vault directory does not exist; create it or mount its volume first`                | 路径错误或卷缺失                                                                     | 创建或挂载该目录                                                                                                                                                                                                    |
| `The vault directory is not writable`                                                    | 服务账户没有写入权限                                                                 | 在 Linux 上以用户 `arkvory` 的 `uid` 和 `gid` 挂载共享。在 Windows 上使用本地或 iSCSI 卷                                                                                                                            |
| `The directory has no vault.json: mount the vault volume, or create the vault first ...` | 目录中没有备份存储（未挂载的共享看起来也一样）；configure 不会自行创建加密的备份存储 | 挂载正确的卷，或运行 `arkvory-backup vault init <dir> --kit-file <file> --agent-key-file <file>`，将 kit 保存在服务器之外，然后传递 `--vault-key-file`。`--init-vault --vault-no-encryption` 会创建不加密的备份存储 |
| `The vault must be outside the installation root and the storage directory`              | 备份存储与数据重叠                                                                   | 在另一个卷上选择单独的目录                                                                                                                                                                                          |
| `Network share paths are not supported ...`                                              | Windows 上的 UNC 路径。`LocalService` 无法登录 SMB 共享                              | 使用本地或 iSCSI 卷的驱动器盘符                                                                                                                                                                                     |
| `The backup service cannot reach /home, /root, /run/user, /tmp or /var/tmp`              | systemd 沙箱隐藏了这些文件夹                                                         | 选择另一个目录                                                                                                                                                                                                      |
| `vault_full`、`vault_low_space`                                                          | 备份存储卷几乎已满                                                                   | 释放空间或保留更少的恢复点。更早的恢复点保持完好                                                                                                                                                                    |
| `vault_key_missing`, `vault_key_invalid`                                                 | vault 已加密，而代理没有密钥或密钥错误                                               | 用代理密钥运行 `arkvory configure --backup-vault DIR --vault-key-file FILE`。参见[加密 vault](./backups#encryption)                                                                                                 |
| `last_run_failed`                                                                        | 最新备份失败                                                                         | 使用 `arkvoryctl backup jobs` 读取 `errorCode`                                                                                                                                                                      |
| `verify_failed`                                                                          | 某个恢复点未通过检查                                                                 | 不要更改备份存储。保留它用于分析并报告                                                                                                                                                                              |

当备份代理在 150 秒内未报告新的备份存储时，`arkvory configure --backup-vault` 会恢复旧设置。更新会停止备份代理，因此当时正在运行的备份会在之后重复。当自动更新开启时，请将备份时间安排在更新时段之外（默认 03:00 UTC）。

## 镜像不同步 {#mirror-not-syncing}

查看仓库上的徽标 [[ui:mirrorFailing]]、`GET /api/v1/repositories/{repository}/mirror` 和工作进程事件 `mirror.step_failed`。下载会基于已复制的内容继续工作。参见[镜像](./mirrors)。

| `errorCode`                                                     | 原因                                             | 修复                                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `mirror_failed`，或源返回的代码如 `unauthorized` 或 `forbidden` | 源不可达、它的密钥错误或已过期，或它缺少某项权限 | 使用该密钥测试源。使用 `arkvory configure --mirror ... --mirror-token-file` 替换密钥。工作进程在每次失败后都会再次读取密钥 |
| `mirror_mismatch`                                               | 同一个 ID 在源处有不同的内容                     | 保留副本。调查该制品                                                                                                       |
| `mirror_source_changed`                                         | 该仓库已经持有另一个源的副本                     | 使用 `--mirror-detach` 解除，并把新源镜像到新仓库中                                                                        |
| `mirror_source_behind`                                          | 源被恢复或重新安装                               | 它会自行重新播种，该代码随后消失                                                                                           |
| 证书错误                                                        | 源使用公司或自签名证书                           | 向 `arkvory configure` 传递 `--mirror-ca-file`。该检查绝不会关闭                                                           |

源需要一个带有镜像数据源的版本。工作进程在失败后等待 2 秒，以倍增方式最长到 5 分钟。`ArkvoryMirrorStale` 在整整一小时没有追赶后触发。

## 更新失败 {#update-failed}

1. 阅读失败信息。在控制台中，[[ui:updates]] 显示一条消息。更新程序在 Windows 上写入 `logs\updater.log`，在 Linux 上写入 `journalctl -u arkvory-update`。
2. 检查已安装的版本：`arkvory status --root <root>`。
3. 找到你的情况。

| 情况                                                      | 发生了什么                                                           | 处理方式                                                                                                                           |
| --------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 相同的数据库架构，普通失败                                | 安装程序再次启动了上一个版本                                         | 修复原因并再次更新                                                                                                                 |
| 控制台显示 [[ui:updateMaintenance]]                       | 带有架构变更的版本需要经过验证的备份，安装程序在任何更改之前就拒绝了 | 连接备份存储、等待第一次备份，然后再次检查                                                                                         |
| 迁移失败                                                  | 它的事务已回滚，上一个版本在前一个架构上运行                         | 修复原因并再次更新                                                                                                                 |
| 新版本在成功迁移后没有启动                                | 日志显示 `maintenance-required` 并指明一个备份恢复点                 | 修复原因并运行 `recover`，它会完成更新。或者使用上一个版本恢复该恢复点                                                             |
| 更新程序被杀掉或机器断电                                  | 锁 `operation.lock` 和日志保留下来。没有任何东西会自行继续           | 下面的过程                                                                                                                         |
| 控制台显示 [[ui:updateStale]] 或 [[ui:updateUnavailable]] | 主机调度器未运行或未连接                                             | 检查任务 `ProAnimaArkvoryUpdate`（Windows）或 `arkvory-update.timer`（Linux）。使用 `arkvory updates-connect --root <root>` 连接它 |

更新程序被中断之后：

1. 停止调度器并确保没有更新程序在运行。保存 `journal.json` 和日志。
2. 只有在那之后，才删除安装根目录中的文件 `operation.lock`。绝不要在更新运行时删除它。
3. 运行 `recover`：

   ```bash
   sudo arkvory recover --root /opt/proanima-arkvory
   ```

   ```powershell
   & 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' recover --root C:\ProgramData\ProAnima\Arkvory
   ```

   在迁移开始之前，它会恢复上一个版本。在迁移开始之后，它会重复迁移并启动新版本。

4. 检查 `/health/ready`、完成队列和一次测试下载。然后再次打开调度器。

在你协调好状态之后，`arkvory updates-reset --root <root>` 会清除已接受的更新请求。无法降级。参见[更新](../install/updates)。

## Docker {#docker}

- **重启 Windows 后没有任何东西运行。** Docker Desktop 在用户登录时启动。打开 **Start Docker Desktop when you sign in**，或使用原生服务。
- **重启 Linux 主机后没有任何东西运行。** 检查引擎是否在启动时运行：`systemctl is-enabled docker`。
- **容器无法读取 `config/` 中的文件。** 容器以用户 `node`（uid 1000）运行。安装程序让 `runtime.json`、`keys.json` 和 `health-token.txt` 对它可读。如果手动编辑更改了所有者或把模式改为 0600，API 会以 `Cannot read ARKVORY_KEYS_FILE (EACCES)` 停止。请把这三个文件的模式恢复为 0644。`config/` 文件夹本身保持封闭。
- **备份存储不可写。** 备份代理以 uid 1000 运行，因此备份存储必须属于它。`arkvory configure --backup-vault` 通过文件 `config/compose.vault.yml` 进行设置。你自己挂载的共享需要 `uid=1000`。在每条手动 Compose 命令中都包含 `-f config/compose.vault.yml`，否则 `up` 会在没有备份存储的情况下创建备份容器。
- **容器处于 `unhealthy`。** 健康检查每 10 秒调用一次 `/health/ready`。Docker 会标记该容器，但不会重启它。阅读 API 容器的日志。

显示容器的日志：

```bash
docker logs --tail 100 proanima-arkvory-api-1
```

## Windows 服务无法启动 {#windows-service}

1. 读取状态和错误输出：

   ```powershell
   Get-Service Arkvoryapi, Arkvoryworker, Arkvorybackup, Arkvorydatabase
   Get-Content C:\ProgramData\ProAnima\Arkvory\logs\arkvory-api.err.log -Tail 50
   ```

2. 打开 Windows 事件查看器，**Windows 日志 > 系统**，并查找服务控制管理器（Service Control Manager）的事件。
3. 找到你的原因：

| 原因                                                             | 修复                                              |
| ---------------------------------------------------------------- | ------------------------------------------------- |
| 根目录位于用户配置文件中，或 `LocalService` 无法读取某个父文件夹 | 安装到专用文件夹中。参见[权限](#root-permissions) |
| 端口被占用                                                       | 参见[端口被占用](#port-busy)                      |
| 数据库服务未运行                                                 | 启动 `Arkvorydatabase`。API 每 10 秒重试一次      |
| 服务在启动后“延迟”启动                                           | 它们的启动类型为“自动（延迟启动）”。请等待几分钟  |
| 杀毒软件隔离了 Node.js                                           | 允许 `runtime\` 中的文件                          |
| `Another installation owns this service`                         | 存在另一个根目录中安装实例的服务。请先移除它们    |
| 服务保持停止                                                     | 你或某次更新停止了它。使用 `Start-Service` 启动它 |

请再次运行图形安装程序以恢复服务的启动类型和恢复操作。参见 [Windows](../install/windows)。

## 日志、请求 ID 与反馈 {#logs-and-feedback}

**查找日志。** Linux：`journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup`。Windows：安装根目录中的 `logs\`。Compose：`docker logs <container>`。格式和事件见[监控](./monitoring#logs)。

**查找请求 ID。** 每个响应都有响应头 `X-Request-Id`。每个错误正文都有 `requestId`。控制台将它作为 [[ui:requestIdLabel]] 显示在消息下方，命令行客户端会在错误行中输出它。请在 API 和工作进程的日志中搜索这个值，以查看该请求及它启动的作业。

**随日志发送反馈。**

1. 登录并选择顶部栏中的 [[ui:reportOpen]]。
2. 描述问题并添加请求 ID。你可以添加最多 6 张截图。
3. 如果你是管理员，请开启 [[ui:reportServerLog]]。这会附上 API 的最新日志行（约 1.5 MiB）和一份不含地址与密钥的系统摘要。
4. 选择 [[ui:reportShow]] 查看将发送的确切内容，然后选择 [[ui:reportSend]]。

服务器会把报告发送到 ProAnimaStudio 中心。如果中心不可达或反馈已关闭，控制台会显示可写入的地址 `info@proanima.net`。有关发送的内容，请参见[安全](./security#hub)。

## 相关页面 {#related-pages}

- [监控](./monitoring)
- [自愈](./self-healing)
- [安全](./security)
- [错误](../api/errors)
- [Windows](../install/windows)
