---
title: 配置
description: 'Arkvory 配置所在的位置、哪些生命周期命令会更改配置、按任务划分的主要设置，以及如何应用更改。'
---

# 配置

Arkvory 有两类设置：

- **服务器设置**是文件 `config/runtime.json` 中的 `ARKVORY_*` 变量。它们设置地址、限制、存储以及类似的内容。API、工作进程和备份代理在启动时读取它们。
- **安装策略**包括更新策略、HTTPS 文件、备份存储和镜像。您使用命令 `arkvory configure` 更改它。该命令会检查更改，重启它必须重启的内容，并在服务无法启动时恢复旧状态。

本页显示文件所在的位置、有哪些命令，以及主要设置如何工作。包含默认值和范围的完整变量列表见[环境变量](../reference/environment)。

## 配置所在的位置 {#where-it-lives}

安装根目录保存所有内容。在 Windows 上它是 `C:\ProgramData\ProAnima\Arkvory`，在 Linux 上是 `/opt/proanima-arkvory`。Compose 安装在主机上使用相同的根目录。下面的路径都相对于该根目录。

| 文件                                                                           | 内容                                                                      | 更改方式                                    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------- |
| `config/runtime.json`                                                          | 服务器设置。键以 `ARKVORY_` 开头，每个值都是字符串。它包含数据库密码      | 手动，或使用 `configure`                    |
| `config/keys.json`                                                             | 恢复密钥和就绪密钥的 SHA-256 哈希。它从不包含密钥                         | 仅用于[替换恢复密钥](#replace-recovery-key) |
| `config/bootstrap-token.txt`                                                   | 恢复密钥                                                                  | 仅用于替换它                                |
| `config/health-token.txt`                                                      | 安装工具用于就绪检查的密钥                                                | 不要更改                                    |
| `config/hub.json`                                                              | 中心地址、更新通道和统计设置                                              | 使用 `configure`                            |
| `config/install-id`                                                            | 随机的安装 ID，仅在开启统计时发送到中心                                   | 不要更改                                    |
| `config/mirrors/`                                                              | 镜像列表以及工作进程用于源的密钥                                          | 使用 `configure --mirror`                   |
| `config/webhooks/`                                                             | 订阅列表、签名密钥，以及 worker 使用的接收方证书颁发机构                  | 使用 `configure --webhook`                  |
| `installation.json`                                                            | 模式、引擎、自动更新设置、版本固定和已安装的发行版                        | 仅使用命令                                  |
| `github-token.txt`                                                             | 可选的 GitHub 令牌，用于下载发行版。参见[更新](./updates#hub-unreachable) | 手动                                        |
| `config/compose.env`, `config/compose.vault.yml`, `config/compose.mirrors.yml` | 仅 Compose：容器镜像、备份存储挂载和镜像挂载                              | 仅使用命令                                  |

在原生 Linux 安装中，`runtime.json` 和 `keys.json` 归 `root:arkvory` 所有，权限模式为 `0640`，并且 `config/` 中的凭据文件只能由 `root` 读取。Compose 安装对容器读取的文件使用权限模式 `0644`：参见 [Docker Compose](./docker#owners)。请保持安装程序设置的属主和权限模式。

## 生命周期命令 {#lifecycle-commands}

所有命令都需要管理员权限，并使用选项 `--root` 指定安装根目录。

| 安装方式              | 如何运行命令                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Linux 软件包          | `sudo arkvory <command> --root /opt/proanima-arkvory`                                                                                                        |
| Windows，图形安装程序 | 在提升权限的 PowerShell 中：`& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' <command> --root C:\ProgramData\ProAnima\Arkvory`                             |
| 脚本安装，Compose     | `sudo <root>/runtime/node-v24.21.0-linux-x64/bin/node <root>/manage.mjs <command> --root <root>`。在 Windows 上使用 `runtime\node-v24.21.0-win-x64\node.exe` |

`arkvory help` 无需特殊权限即可列出命令。本站示例使用简写形式 `arkvory <command>`。

| 命令                            | 用途                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `status`                        | 显示安装模式、引擎、自动更新设置、固定和已安装的发行版                                 |
| `configure`                     | 更改策略。参见 [configure 命令](#configure-command)                                    |
| `update`                        | 立即安装较新的稳定版。参见[更新](./updates)                                            |
| `upgrade`                       | 使用您自己的备份记录安装会更改数据库架构的发行版。参见[更新](./updates#manual-upgrade) |
| `recover`                       | 完成被中断的更新。参见[更新](./updates#recover-update)                                 |
| `finish-install`                | 继续被中断的首次安装                                                                   |
| `updates-connect`               | 连接控制台和更新计时器，并注册旧安装缺少的服务                                         |
| `updates-poll`, `updates-reset` | 由更新计时器运行，也用于恢复。参见[更新](./updates#recover-update)                     |

同一时间只运行一个命令。第二个命令会以 `Installation is locked` 停止。切勿将密钥或密码放入命令选项中：请使用文件。

### configure 命令 {#configure-command}

一次调用更改一类设置。五类设置不能在一次调用中混合。

| 类别     | 选项                                                                                                                                                                                                                                     | 效果                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| HTTPS    | `--tls-cert FILE --tls-key FILE [--listen-host ADDRESS]`，或 `--tls-off [--listen-host ADDRESS]`                                                                                                                                         | 打开或关闭内置 HTTPS。重启服务并检查就绪状态。参见 [HTTPS](./https)                              |
| 备份存储 | `--backup-vault DIRECTORY [--vault-key-file FILE \| --init-vault --vault-no-encryption]`，或 `--backup-vault-off`                                                                                                                        | 连接或断开备份存储。仅重启备份代理。参见[备份](../operate/backups)                               |
| 镜像     | `--mirror REPOSITORY --mirror-upstream URL --mirror-token-file FILE [--mirror-source REPOSITORY] [--mirror-stages LIST] [--mirror-ca-file FILE]`，或 `--mirror-detach REPOSITORY`                                                        | 使某个仓库成为镜像或导入目标，或恢复为普通仓库。参见[镜像](../operate/mirrors)                   |
| Webhook  | `--webhook ID --webhook-repository REPOSITORY --webhook-url URL --webhook-secret-file FILE [--webhook-next-secret-file FILE] [--webhook-actions LIST] [--webhook-allow-private LIST] [--webhook-ca-file FILE]`, or `--webhook-detach ID` | 添加、替换或删除一个 webhook 订阅。重启服务并检查就绪状态。参见 [Webhook](../protocols/webhooks) |
| 更新     | `--enable-updates`、`--disable-updates`、`--pin [--version X.Y.Z]`、`--unpin`、`--update-channel stable` 或 `beta`、`--statistics on` 或 `off`、`--hub-url URL`、`--hub-off`                                                             | 更改更新策略。参见[更新](./updates)                                                              |

HTTPS、备份存储和镜像更改会重启服务，并在更改不生效时恢复之前的配置。更新选项只重写 `installation.json` 和 `hub.json`；它们不会重启任何内容。文件路径必须是绝对路径。

## 按任务划分的设置 {#settings-by-task}

### 地址和端口 {#address-and-port}

| 变量           | 默认值      | 含义           |
| -------------- | ----------- | -------------- |
| `ARKVORY_HOST` | `127.0.0.1` | API 监听的地址 |
| `ARKVORY_PORT` | `8080`      | TCP 端口       |

使用默认值时，只有服务器上的程序可以连接。要接受其他计算机的连接，请选择以下两种方式之一：

- **内置 HTTPS。** `arkvory configure --tls-cert … --tls-key … --listen-host 0.0.0.0`。参见 [HTTPS](./https#built-in-tls)。
- **另一台计算机上的反向代理。** 将 `ARKVORY_HOST` 设置为供代理使用的网络接口地址，并把该代理列入 `ARKVORY_TRUSTED_PROXIES`。编辑 `runtime.json`，或运行 `arkvory configure --tls-off --listen-host <address>`。用防火墙把端口限制为仅该代理可访问。

单独使用 `--listen-host` 会被拒绝：请与 TLS 文件一起使用，或与 `--tls-off` 一起使用。在 `--tls-off` 之后，添加 `--listen-host 127.0.0.1` 以返回环回地址，否则 API 会继续监听已设置的地址。

当 API 在没有 TLS 且没有受信任代理的情况下监听非环回地址时，它会在启动时记录警告 `http.plaintext_exposed`。切勿在计算机之间通过明文 HTTP 发送密钥。

在 Linux 上，服务以非特权账户运行，通常无法监听低于 1024 的端口。控制台的快捷方式（开始菜单、菜单项）始终指向端口 8080。生命周期命令遵循 `runtime.json` 中的地址和端口。在 Compose 安装中，地址和端口是固定的：参见 [Docker Compose](./docker#ports)。

### 公共地址和转发的请求头 {#public-address}

没有用于公共 URL 的设置。服务器根据请求构建绝对链接，例如 Git LFS 和 npm 应答中的链接：当连接使用 TLS 或代理发送 `X-Forwarded-Proto: https` 时，协议为 `https`，主机为 `Host` 请求头。列入 `ARKVORY_TRUSTED_PROXIES` 的代理还可以用 `X-Forwarded-Host` 设置主机。因此您的代理必须转发公共名称。参见 [HTTPS](./https#reverse-proxy)。

`ARKVORY_TRUSTED_PROXIES` 最多接受 32 个地址或 CIDR 范围，以逗号分隔。只有这些对等方可以用 `X-Forwarded-For` 设置客户端地址，并用 `X-Request-Id` 设置请求 ID。没有该列表时，每个客户端看起来都来自代理的地址，登录限制会把它们计为一个。

### 其他地址上的浏览器 {#browsers}

`ARKVORY_CORS_ORIGINS` 最多列出 16 个运行在不同地址上的控制台或其他 Web 应用的源，以逗号分隔。每个源包含协议、主机和可选端口，且不含路径。它必须使用 HTTPS；明文 HTTP 仅允许用于 `localhost`、`127.0.0.1` 和 `[::1]`。参见 [HTTPS](./https#console-api-address)。`ARKVORY_ALLOW_REGISTRATION=true` 允许人们在登录页面创建自己的账户；默认关闭。

### 数据库 {#database}

| 变量                         | 默认值         | 含义                                                  |
| ---------------------------- | -------------- | ----------------------------------------------------- |
| `ARKVORY_DATABASE_URL`       | 由安装程序设置 | PostgreSQL 连接 URL。托管数据库监听 `127.0.0.1:54329` |
| `ARKVORY_DATABASE_POOL_SIZE` | `10`           | API 连接池的大小，从 4 到 200                         |

不要将一个安装指向另一个数据库。存储的文件和目录是一体的。迁移到新数据库就是从备份恢复：参见[备份](../operate/backups)。对于外部 PostgreSQL，请将 `max_connections` 设得足够高，以容纳 API 连接池、每个并发上传用于写锁的一个连接、工作进程的 5 个连接以及备份代理的连接。

### 存储目录和可用空间 {#storage}

| 变量                            | 默认值        | 含义                                                             |
| ------------------------------- | ------------- | ---------------------------------------------------------------- |
| `ARKVORY_DATA_DIR`              | `<root>/data` | 文件内容的存储位置。由安装程序设置。请使用本地磁盘               |
| `ARKVORY_CAPACITY_BYTES`        | 10 TiB        | 所有预留内容可使用的最大值。它是对预留量的限制，而非对磁盘的测量 |
| `ARKVORY_STORAGE_RESERVE_BYTES` | 1 GiB         | 上传永远不会使用的可用空间。`0` 表示关闭预留                     |
| `ARKVORY_MAX_OBJECT_BYTES`      | 约 10 TiB     | 单个对象的最大值。设置较低的值可限制文件大小                     |

请将 `ARKVORY_DATA_DIR` 保持在安装程序放置它的位置。Linux 单元只能写入根目录下的 `data/`、`logs/` 和 `updates/inbox/`，因此其他路径对它们来说是只读的。要使用更大的磁盘，请停止服务，将内容复制到新磁盘，把该磁盘挂载到 `data/` 并设置属主为 `arkvory`，然后启动服务。在 Windows 和 Linux 上，使用脚本安装时（`-Root`、`ARKVORY_INSTALL_ROOT`）也可以选择根目录本身。参见[存储](../operate/storage)。

### 传输限制 {#limits}

这些限制属于单个 API 进程。速率 `0` 表示无限制。

| 变量                                  | 默认值    | 含义                                 |
| ------------------------------------- | --------- | ------------------------------------ |
| `ARKVORY_MAX_UPLOADS`                 | `2`       | 同时进行的上传数，1 到 32            |
| `ARKVORY_MAX_DOWNLOADS`               | `16`      | 同时进行的下载数，1 到 256           |
| `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`   | `1`       | 一个账户或密钥同时进行的上传数       |
| `ARKVORY_MAX_DOWNLOADS_PER_PRINCIPAL` | `4`       | 一个账户或密钥同时进行的下载数       |
| `ARKVORY_UPLOAD_BYTES_PER_SECOND`     | `0`       | 总上传速率，以字节/秒为单位          |
| `ARKVORY_DOWNLOAD_BYTES_PER_SECOND`   | `0`       | 总下载速率，以字节/秒为单位          |
| `ARKVORY_UPLOAD_DEADLINE_MS`          | `1800000` | 单个上传请求的最长时间，30 分钟      |
| `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`      | `30000`   | 上传请求在此期间未发送任何数据则停止 |

API 前面的代理必须允许请求的持续时间至少与 `ARKVORY_UPLOAD_DEADLINE_MS` 一样长。参见 [HTTPS](./https#reverse-proxy)。所有其他限制，例如等待队列和每账户速率，见[环境变量](../reference/environment#transfers-and-bandwidth)。

### 备份和镜像 {#backups-mirrors}

两者都使用 `configure`。`--backup-vault` 会写入 `ARKVORY_BACKUP_VAULT`，授予服务账户对该目录的访问权限，仅重启备份代理，并且只有当代理报告备份存储可用时才保留该更改。备份存储必须位于安装根目录之外和存储之外。`--mirror` 会写入 `ARKVORY_MIRRORS_FILE` 和密钥文件，重启 API 和工作进程，并在更改任何内容之前用您的密钥检查源。

### 更新和中心 {#updates-and-hub}

更新策略位于 `installation.json` 和 `config/hub.json` 中。选项见 [configure 命令](#configure-command)，它们的含义见[更新](./updates)。`runtime.json` 中的 `ARKVORY_HUB_URL` 是独立的：它设置控制台将反馈发送到哪里。`configure --hub-url` 或 `--hub-off` 会同时更改两者，反馈地址会在服务下次重启后随之更新。

### 日志和关闭 {#logs-and-shutdown}

| 变量                       | 默认值  | 含义                                                                              |
| -------------------------- | ------- | --------------------------------------------------------------------------------- |
| `ARKVORY_LOG_LEVEL`        | `info`  | `debug`、`info`、`warning` 或 `error`。级别 `warning` 和 `error` 还会隐藏访问日志 |
| `ARKVORY_ACCESS_LOG`       | `true`  | 每个 HTTP 请求一条 JSON 记录。查询字符串永远不会被写入                            |
| `ARKVORY_DRAIN_TIMEOUT_MS` | `30000` | 发出停止请求后，正在运行的请求完成所需的时间                                      |

监督程序给服务 120 秒的停止时间。如果您将排空时间设置为超过约 90 秒，请同时提高服务管理器的停止超时：systemd 单元中的 `TimeoutStopSec`、Windows 服务的停止超时，以及 Compose 中的 `stop_grace_period`。参见[监控](../operate/monitoring)。

## 应用更改 {#apply-change}

`configure` 会应用它自己的更改。对于您在 `config/runtime.json` 中编辑的任何内容：

1. 复制该文件，例如 `sudo cp -p /opt/proanima-arkvory/config/runtime.json /root/runtime.json.bak`。它包含数据库密码：请对副本保密。
2. 就地编辑该文件。保持 JSON 有效，每个值都是字符串。
3. 检查属主和权限模式。在 Linux 上它们必须保持为 `root:arkvory` 和 `0640`。使用 `sudo chown root:arkvory runtime.json` 和 `sudo chmod 0640 runtime.json` 修复它们。
4. 重启服务。设置仅在启动时读取。

   ```bash
   sudo systemctl restart arkvory-api arkvory-worker arkvory-backup
   ```

   ```powershell
   Restart-Service Arkvoryapi, Arkvoryworker, Arkvorybackup
   ```

   在 Compose 安装中，使用 [Docker Compose](./docker#manage) 中的 `compose` 命令停止并启动容器：

   ```bash
   "${compose[@]}" stop --timeout 120 backup worker api
   "${compose[@]}" up -d --wait api worker
   "${compose[@]}" up -d backup
   ```

5. 检查结果。超出范围的值会在启动时使进程停止，并给出指明变量名（而不是其值）的消息。在 Linux 上使用 `journalctl -u arkvory-api -n 50` 读取它。在这种情况下，Arkvory 不会回退到默认值。

重启会中断正在进行的传输。客户端会续传。

## 替换恢复密钥 {#replace-recovery-key}

如果您怀疑有人读取了 `config/bootstrap-token.txt`，请替换恢复密钥。该密钥存储在必须一起更改的两个位置：文件 `bootstrap-token.txt` 保存密钥，`keys.json` 中的条目 `bootstrap-owner` 保存它的 SHA-256。保持条目 `deployment-health` 不变。

1. 复制 `config/keys.json`。
2. 将此脚本保存为 `replace-recovery-key.mjs`：

   ```js
   import { createHash, randomBytes } from 'node:crypto';
   import { readFileSync, writeFileSync } from 'node:fs';

   const directory = process.argv[2];
   const token = randomBytes(32).toString('hex');
   const keys = JSON.parse(readFileSync(`${directory}/keys.json`, 'utf8'));
   const owner = keys.find((key) => key.id === 'bootstrap-owner');
   if (!owner) throw new Error('No bootstrap-owner entry');
   owner.sha256 = createHash('sha256').update(token).digest('hex');
   writeFileSync(`${directory}/keys.json`, JSON.stringify(keys, null, 2));
   writeFileSync(`${directory}/bootstrap-token.txt`, token);
   ```

3. 使用安装自带的 Node.js，以 `root` 或管理员身份运行它。该脚本会写入现有文件，因此属主和访问规则保持不变。

   ```bash
   sudo /opt/proanima-arkvory/runtime/node ./replace-recovery-key.mjs /opt/proanima-arkvory/config
   ```

   ```powershell
   & 'C:\ProgramData\ProAnima\Arkvory\runtime\node.exe' .\replace-recovery-key.mjs 'C:\ProgramData\ProAnima\Arkvory\config'
   ```

   在脚本安装之后，请改用 `runtime\node-v24.21.0-…` 下的 Node.js。

4. 如[应用更改](#apply-change)所示重启服务。
5. 从 `config/bootstrap-token.txt` 读取新密钥，并删除脚本和 `keys.json` 的副本。

账户、个人令牌和服务密钥不受影响。它们存储在数据库中。
