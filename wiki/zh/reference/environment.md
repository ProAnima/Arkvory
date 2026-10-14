---
title: 环境变量
---

# 环境变量

Arkvory 通过名称以 `ARKVORY_` 开头的环境变量进行配置。本页列出服务器进程、命令行客户端和安装脚本读取的所有变量。

## 取值来源 {#where-the-values-come-from}

安装程序把服务器设置写入安装根目录中的一个文件 `config/runtime.json`。每个服务的启动器读取该文件，并把其中的值传给 API、worker 和备份代理。每个键必须以 `ARKVORY_` 开头，每个值必须是字符串。

```json
{
  "ARKVORY_HOST": "127.0.0.1",
  "ARKVORY_PORT": "8080",
  "ARKVORY_CAPACITY_BYTES": "10995116277760",
  "ARKVORY_DATABASE_URL": "postgresql://arkvory:PASSWORD@127.0.0.1:54329/arkvory",
  "ARKVORY_DATA_DIR": "/opt/proanima-arkvory/data",
  "ARKVORY_KEYS_FILE": "/opt/proanima-arkvory/config/keys.json",
  "ARKVORY_MAX_DOWNLOADS": "32"
}
```

该文件包含数据库密码。请保持安装程序设置的访问权限不变。

要更改设置，请编辑 `config/runtime.json` 并重启服务。如果 `arkvory configure` 命令涵盖了某项设置（HTTPS、备份存储、镜像、更新），请优先使用它。该命令会检查更改，并在服务无法启动时恢复旧文件。参见[配置](../install/configuration)。

```bash
sudo systemctl restart arkvory-api arkvory-worker arkvory-backup
```

```powershell
Restart-Service Arkvoryapi, Arkvoryworker, Arkvorybackup
```

超出允许范围的值会使进程在启动时停止，并给出指明该变量的消息。在这种情况下，Arkvory 不会回退到默认值。

“读取方”列使用以下名称：**API** 是 HTTP 服务器（也包括读取网关），**worker** 是后台工作进程，**agent** 是备份代理，**CLI** 是 `arkvoryctl`。

## 核心 {#core}

| 变量                         | 读取方                   | 默认值            | 含义                                                                                                           |
| ---------------------------- | ------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_DATABASE_URL`       | API、worker、agent、迁移 | 必需              | PostgreSQL 连接 URL（`postgres://` 或 `postgresql://`）。每个安装使用单独的数据库。                            |
| `ARKVORY_DATA_DIR`           | API、worker、agent       | 必需              | 本地存储目录：暂存区、内容和 `storage-id` 文件。不要使用网络共享。                                             |
| `ARKVORY_HOST`               | API                      | `127.0.0.1`       | 监听的地址。安装程序写入 `127.0.0.1`；在 Docker Compose 中，容器内为 `0.0.0.0`，端口只发布在主机的回环地址上。 |
| `ARKVORY_PORT`               | API                      | `8080`            | TCP 端口，1–65535。                                                                                            |
| `ARKVORY_WEB_DIR`            | API                      | `apps/web/public` | 包含 Web 控制台文件的目录。启动器每次启动时都会把它设置为当前发行版。                                          |
| `ARKVORY_DATABASE_POOL_SIZE` | API                      | `20`              | API 查询连接池的大小，4–200。长时间会话使用单独的 3 个连接的池。                                               |

## 存储与限制 {#storage-and-limits}

| 变量                            | 读取方             | 默认值       | 含义                                                                                                                            |
| ------------------------------- | ------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_CAPACITY_BYTES`        | API、worker        | 10 TiB       | 所有已预留内容的上限，单位为字节：已发布的内容、未完成的上传，以及等待清理的内容。它不是磁盘检查。worker 只在复制镜像时读取它。 |
| `ARKVORY_STORAGE_RESERVE_BYTES` | API、worker、agent | `1073741824` | 上传永远不会占用的可用空间，单位为字节。它留给数据库、日志和系统。`0` 表示关闭该预留。                                          |
| `ARKVORY_MAX_OBJECT_BYTES`      | API                | 约 10 TiB    | 最大对象的大小，单位为字节。允许的最大值是 10 000 个 1 GiB 的分片。设置较小的值可以限制文件大小。                               |

## 传输与带宽 {#transfers-and-bandwidth}

这些限制属于单个 API 进程。速率以字节/秒为单位：`0` 表示不限制，其他任何值必须在 65 536 到 1 TiB 之间。

| 变量                                              | 读取方 | 默认值                                        | 含义                                                                                                                                                                                                                    |
| ------------------------------------------------- | ------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_MAX_UPLOADS`                             | API    | `8`                                           | 同时运行的上传数，1–32。                                                                                                                                                                                                |
| `ARKVORY_MAX_DOWNLOADS`                           | API    | `16`                                          | 同时运行的下载数，1–256。                                                                                                                                                                                               |
| `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`               | API    | `4`                                           | 单个账户或密钥同时进行的上传数，不超过上传总数限制。                                                                                                                                                                    |
| `ARKVORY_MAX_DOWNLOADS_PER_PRINCIPAL`             | API    | `4`                                           | 单个账户或密钥同时进行的下载数，不超过下载总数限制。                                                                                                                                                                    |
| `ARKVORY_DOWNLOAD_STRATEGY`                       | API    | `ordered`                                     | 下载队列如何安排大于 `ARKVORY_DOWNLOAD_SESSION_MIN_BYTES` 的对象的完整下载：`ordered`（优先级类别，账户和密钥轮流）、`smallest-first`（小对象优先）或 `shared`（不排队：每个请求单独准入）。读取网关默认使用 `shared`。 |
| `ARKVORY_MAX_DOWNLOAD_SESSIONS`                   | API    | `ARKVORY_MAX_DOWNLOADS`                       | 同时占有位置的下载数，1–1024。                                                                                                                                                                                          |
| `ARKVORY_DOWNLOAD_RESERVE`                        | API    | `1`                                           | 批量更新期间为人员（控制台会话和个人令牌）保留的位置。少于四个位置时默认 `0`。                                                                                                                                          |
| `ARKVORY_DOWNLOAD_WEIGHTS`                        | API    | `interactive=8,release=4,bulk=2,background=1` | 各类别分到的空闲位置比例。只需写出要更改的类别。                                                                                                                                                                        |
| `ARKVORY_DOWNLOAD_SESSION_MIN_BYTES`              | API    | `16777216`                                    | 不超过此大小的对象不进入队列，按请求准入。                                                                                                                                                                              |
| `ARKVORY_DOWNLOAD_IDLE_SECONDS`                   | API    | `30`                                          | 区间之间的停顿超过此值即释放位置。该下载在十分钟内保留其顺序。                                                                                                                                                          |
| `ARKVORY_DOWNLOAD_AGING_MINUTES`                  | API    | `15`                                          | 每等待这么久，下载提升一个类别，最高到 `release`。`0` 关闭老化。                                                                                                                                                        |
| `ARKVORY_DOWNLOAD_PREEMPT`                        | API    | `true`                                        | 队列协议的客户端（SDK、`arkvoryctl`）占用位置满一分钟后，会在区间边界把位置让给更高类别或低于自身份额的密钥。                                                                                                           |
| `ARKVORY_DOWNLOAD_RANGES_PER_SESSION`             | API    | `4`                                           | 同一下载的并发请求数：并行区间、同一地址后的多个客户端。                                                                                                                                                                |
| `ARKVORY_DOWNLOAD_QUEUE_LIMIT`                    | API    | `65536`                                       | 队列中的下载总数，包括活动和等待的。超出时客户端会被要求一分钟后再来。                                                                                                                                                  |
| `ARKVORY_DOWNLOAD_QUEUE_PER_PRINCIPAL`            | API    | `4096`                                        | 单个账户、密钥或链接的下载总数。                                                                                                                                                                                        |
| `ARKVORY_DOWNLOAD_HOLD_SECONDS`                   | API    | `20`                                          | 队列协议之外的工具（docker、npm、curl、浏览器）的请求在答复 503 之前被保留等待轮次的时长。默认：`ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS`。`0` 立即答复。                                                                     |
| `ARKVORY_SITE_NAME`                               | API    | —                                             | 本安装在其他安装的“站点”页面上的名称，1–63 个字符。                                                                                                                                                                     |
| `ARKVORY_FLEET_KEY_FILE`                          | API    | `fleet.key`                                   | 封存本安装所管理站点的密钥的密钥。写入进程首次启动时创建；请像数据目录一样保护它。它既不在数据库中，也不在备份中。                                                                                                      |
| `ARKVORY_TRANSFER_QUEUE_LIMIT`                    | API    | `64`                                          | 可以等待空闲槽位的传输数，1–1024。                                                                                                                                                                                      |
| `ARKVORY_TRANSFER_QUEUE_PER_PRINCIPAL`            | API    | `8`                                           | 单个账户或密钥的等待中传输数，不超过队列上限。                                                                                                                                                                          |
| `ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS`               | API    | `20000`                                       | 传输可以在队列中等待的时长，1–120 000 ms。                                                                                                                                                                              |
| `ARKVORY_MAX_REQUESTS`                            | API    | `128`                                         | 同时处理的已认证请求数，1–4096。它必须大于上传数加下载数。如果未设置且传输限制较高，默认值为上传数加下载数再加 64。                                                                                                     |
| `ARKVORY_UPLOAD_BYTES_PER_SECOND`                 | API    | `0`                                           | 进程的总上传速率。                                                                                                                                                                                                      |
| `ARKVORY_DOWNLOAD_BYTES_PER_SECOND`               | API    | `0`                                           | 进程的总下载速率。                                                                                                                                                                                                      |
| `ARKVORY_UPLOAD_BYTES_PER_SECOND_PER_PRINCIPAL`   | API    | `0`                                           | 单个账户或密钥在其所有连接上的上传速率。                                                                                                                                                                                |
| `ARKVORY_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL` | API    | `0`                                           | 单个账户或密钥在其所有连接上的下载速率。                                                                                                                                                                                |
| `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`                  | API    | `30000`                                       | 在这段时间内没有发送任何数据的上传请求会被停止，1–1 800 000 ms。                                                                                                                                                        |
| `ARKVORY_UPLOAD_DEADLINE_MS`                      | API    | `1800000`                                     | 单个上传请求的最长时间，1–1 800 000 ms。它不能短于空闲超时。                                                                                                                                                            |

## 网络、HTTPS 与浏览器 {#network-https-and-browsers}

| 变量                         | 读取方 | 默认值    | 含义                                                                                                                                                                                                                    |
| ---------------------------- | ------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_TLS_CERT_FILE`      | API    | 未设置    | 用于内置 HTTPS 的 PEM 证书（含证书链）。请与密钥文件一起设置。                                                                                                                                                          |
| `ARKVORY_TLS_KEY_FILE`       | API    | 未设置    | 不带密码的 PEM 私钥。                                                                                                                                                                                                   |
| `ARKVORY_TLS_MIN_VERSION`    | API    | `TLSv1.2` | `TLSv1.2` 或 `TLSv1.3`。                                                                                                                                                                                                |
| `ARKVORY_TLS_RELOAD_SECONDS` | API    | `300`     | 多久读取一次续期后的证书文件：30–86 400 秒；`0` 表示只在启动时读取。                                                                                                                                                    |
| `ARKVORY_CORS_ORIGINS`       | API    | 空        | 以逗号分隔的列表，最多 16 个浏览器源，用于位于其他地址的控制台。仅限 HTTPS，或回环地址上的 HTTP。                                                                                                                       |
| `ARKVORY_TRUSTED_PROXIES`    | API    | 空        | 最多 32 个反向代理地址（IP 或 CIDR）。只有这些代理可以通过 `X-Forwarded-For` 设置客户端地址，通过 `X-Request-Id` 设置请求 ID，通过 `X-Forwarded-Host` 和 `X-Forwarded-Proto` 设置绝对链接（Git LFS、npm）的主机和协议。 |

内置 HTTPS 适用于原生安装。使用 Docker Compose 时，请使用反向代理。参见 [HTTPS](../install/https)。

## 身份与密钥 {#identity-and-keys}

| 变量                         | 读取方      | 默认值 | 含义                                                                                              |
| ---------------------------- | ----------- | ------ | ------------------------------------------------------------------------------------------------- |
| `ARKVORY_KEYS_FILE`          | API、worker | 必需   | 包含文件密钥（例如恢复密钥和健康检查密钥）的 JSON 文件。它保存的是 SHA-256 哈希，而不是密钥本身。 |
| `ARKVORY_ALLOW_REGISTRATION` | API         | 关闭   | `true` 允许用户在登录页面自行创建账户。其他任何值都保持关闭。                                     |

## 备份 {#backups}

| 变量                              | 读取方   | 默认值 | 含义                                                                                                                                 |
| --------------------------------- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ARKVORY_BACKUP_VAULT`            | agent    | 未设置 | 已初始化的备份存储目录。没有它时，代理仍会运行，并报告未配置备份存储。`arkvory configure --backup-vault` 会写入它。                  |
| `ARKVORY_BACKUP_VAULT_KEY_FILE`   | agent    | 未设置 | 包含加密 vault 代理密钥（`AK1-…`）的文件，或恢复套件。命令也接受它作为 `--key-file`。`arkvory configure --vault-key-file` 会写入它。 |
| `ARKVORY_BACKUP_BYTES_PER_SECOND` | agent    | 无限制 | 备份的复制速率上限，至少为 65 536。                                                                                                  |
| `ARKVORY_BACKUP_POLL_SECONDS`     | agent    | `15`   | 代理多久检查一次新的备份任务，1–3600 秒。                                                                                            |
| `ARKVORY_BACKUP_LEASE_SECONDS`    | agent    | `60`   | 防止第二个代理同时运行的租约时长，2–3600 秒。                                                                                        |
| `ARKVORY_BACKUP_SNAPSHOT_SECONDS` | agent    | `1800` | 备份中数据库快照部分的时间上限，60–86 400 秒。                                                                                       |
| `ARKVORY_BACKUP_BARRIER_SECONDS`  | agent    | `30`   | 备份等待正在运行的清理步骤的时长，1–600 秒。                                                                                         |
| `ARKVORY_RESTORE_DATABASE_URL`    | 恢复命令 | 未设置 | 恢复的目标数据库。它比 `--database-url` 更安全，因为其他用户无法在进程列表中看到它。                                                 |

参见[备份](../operate/backups)。

## 镜像 {#mirrors}

| 变量                      | 读取方      | 默认值 | 含义                                                                            |
| ------------------------- | ----------- | ------ | ------------------------------------------------------------------------------- |
| `ARKVORY_MIRRORS_FILE`    | API、worker | 未设置 | 列出镜像仓库（最多 64 个）的 JSON 文件。`arkvory configure --mirror` 会写入它。 |
| `ARKVORY_MIRRORS_CA_FILE` | worker      | 未设置 | 包含源服务器额外证书颁发机构的 PEM 文件的绝对路径。TLS 始终会被验证。           |

参见[镜像](../operate/mirrors)。

## Webhook {#webhooks}

| 变量                             | 读取方 | 默认值 | 含义                                                                                                  |
| -------------------------------- | ------ | ------ | ----------------------------------------------------------------------------------------------------- |
| `ARKVORY_WEBHOOKS_FILE`          | worker | 未设置 | 列出 webhook 订阅的 JSON 文件（最多 16 个）。没有它就不会发送任何 webhook。                           |
| `ARKVORY_WEBHOOKS_ALLOW_PRIVATE` | worker | 未设置 | 以逗号分隔的 CIDR 网络（最多 32 个），除公网地址外，这些网络也可以接收 webhook，例如 `10.20.0.0/16`。 |
| `ARKVORY_WEBHOOKS_CA_FILE`       | worker | 未设置 | 包含接收方额外证书颁发机构的 PEM 文件的绝对路径。TLS 始终会被验证。                                   |

参见 [Webhook](../protocols/webhooks)。

## 高可用集群 {#cluster}

| 变量                     | 读取方 | 默认值 | 含义                                                                                                                                         |
| ------------------------ | ------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_REPLICA_SOCKET` | API    | 未设置 | `arkvory-replica` 服务的套接字。`arkvory configure --cluster` 会设置它。设置后，只有所需副本都完整时，写入才会得到 2xx。未设置：独立服务器。 |

参见 [高可用集群](../operate/cluster)。

## 更新与中心（hub） {#updates-and-the-hub}

| 变量                         | 读取方 | 默认值                     | 含义                                                                                                                                                                 |
| ---------------------------- | ------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_HUB_URL`            | API    | `https://hub.proanima.net` | ProAnimaStudio 中心的地址，仅供控制台反馈使用（更新中心保存在 `config/hub.json` 中，用 `arkvory configure` 修改）。空值会关闭反馈。仅限 HTTPS，或回环地址上的 HTTP。 |
| `ARKVORY_HUB_PROJECT`        | API    | `arkvory`                  | 中心上的项目名称。                                                                                                                                                   |
| `ARKVORY_UPDATE_CONTROL_DIR` | API    | 未设置                     | API 与主机更新程序共享的目录。由安装程序设置。没有它，控制台无法请求更新。                                                                                           |

参见[更新](../install/updates)。

## 日志与关闭 {#logging-and-shutdown}

| 变量                       | 读取方             | 默认值  | 含义                                                           |
| -------------------------- | ------------------ | ------- | -------------------------------------------------------------- |
| `ARKVORY_LOG_LEVEL`        | API、worker、agent | `info`  | `debug`、`info`、`warning` 或 `error`。                        |
| `ARKVORY_ACCESS_LOG`       | API                | `true`  | `true` 为每个 HTTP 请求写入一行 JSON；`false` 表示关闭。       |
| `ARKVORY_DRAIN_TIMEOUT_MS` | API                | `30000` | 收到停止信号后，留给正在运行的请求完成的时间，0–3 600 000 ms。 |

## 读取网关 {#read-gateways}

设置其中任何一个变量时，槽位、槽位总数和共享速率都是必需的。写入端使用角色 `api` 和槽位 `0`。每个读取网关使用角色 `reader` 和各自的槽位。参见[读取网关](../operate/read-gateways)。

| 变量                                                     | 读取方 | 默认值 | 含义                                                                   |
| -------------------------------------------------------- | ------ | ------ | ---------------------------------------------------------------------- |
| `ARKVORY_ROLE`                                           | API    | `api`  | `api`（写入端）或 `reader`（读取网关）。                               |
| `ARKVORY_GATEWAY_SLOTS`                                  | API    | 未设置 | 共享下载预算的进程数，2–16。                                           |
| `ARKVORY_GATEWAY_SLOT`                                   | API    | 未设置 | 此进程的槽位，从 `0` 到槽位总数减一。                                  |
| `ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND`               | API    | 未设置 | 所有进程的总下载速率。每个槽位获得相等的份额，至少为每秒 65 536 字节。 |
| `ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL` | API    | `0`    | 单个账户或密钥在所有进程上的总下载速率；`0` 表示不限制。               |

## 看门狗 {#watchdog}

| 变量                       | 读取方             | 默认值 | 含义                                                                                                              |
| -------------------------- | ------------------ | ------ | ----------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_WATCHDOG_SECONDS` | API、worker、agent | `60`   | 持续阻塞达到这段时间的进程会自行退出，服务管理器会再次启动它。`0` 表示关闭（用于调试器）；否则取值为 10–3600 秒。 |

参见[自愈](../operate/self-healing)。

## 命令行客户端 {#command-line-client}

| 变量                  | 读取方 | 默认值                                     | 含义                                             |
| --------------------- | ------ | ------------------------------------------ | ------------------------------------------------ |
| `ARKVORY_BASE_URL`    | CLI    | 先取配置文件，再取 `http://127.0.0.1:8080` | 服务器地址。设置它之后，密钥也必须来自环境变量。 |
| `ARKVORY_TOKEN`       | CLI    | 未设置                                     | 密钥本身。它优先于密钥文件。                     |
| `ARKVORY_TOKEN_FILE`  | CLI    | 配置文件中的密钥文件                       | 包含密钥的文件的路径。                           |
| `ARKVORY_CLI_HOME`    | CLI    | `~/.config/arkvory`                        | `profiles.json` 文件所在的目录。                 |
| `ARKVORY_CLI_VERSION` | CLI    | `development`                              | `--version` 输出的版本。发行版软件包中已包含它。 |

参见[命令行客户端](../protocols/cli)。

## 安装脚本 {#installer-scripts}

这些变量由 Linux 上的 `install.sh` 读取。在 Windows 上，`install.ps1` 改用 `-Root` 和 `-Artifact` 等参数。

| 变量                      | 默认值                  | 含义                                                 |
| ------------------------- | ----------------------- | ---------------------------------------------------- |
| `ARKVORY_INSTALL_ROOT`    | `/opt/proanima-arkvory` | 安装根目录。不要把原生安装放在主目录中。             |
| `ARKVORY_ARTIFACT_DIR`    | 未设置                  | 已解压发行版的目录。脚本会安装它，而不是下载发行版。 |
| `ARKVORY_RELEASE_VERSION` | 最新稳定版              | 要安装的确切稳定版本，例如 `1.2.3`。                 |

## 由安装程序设置 {#set-by-the-installer}

安装程序为自己的辅助进程设置这些变量。请不要自行设置。

| 变量                      | 含义                                                                  |
| ------------------------- | --------------------------------------------------------------------- |
| `ARKVORY_IMAGE`           | 当前发行版的容器镜像，位于 `config/compose.env` 中。                  |
| `ARKVORY_SERVICE_WRAPPER` | Windows 备份服务包装程序的路径，在服务停止时使用。                    |
| `ARKVORY_PROTECT_ROOT`    | 在 Windows 上被设置访问规则的安装根目录。                             |
| `ARKVORY_ENGINE_USER`     | 在使用 Docker Desktop 的 Windows 上，授予当前用户对根目录的访问权限。 |

## 相关页面 {#related-pages}

- [配置](../install/configuration)
- [监控](../operate/monitoring)
- [安全](../operate/security)
- [存储](../operate/storage)
