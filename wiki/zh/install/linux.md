---
title: Linux
description: '使用 .deb 或 .rpm 软件包在 Linux 上安装 Arkvory、启动它、操作 systemd 服务、升级并删除它。'
---

# Linux

在 Linux 上运行 Arkvory 有两种方式：

- **软件包** `Arkvory-amd64.deb` 或 `Arkvory-x86_64.rpm`。推荐使用。它会安装 systemd 服务和由 Arkvory 管理的专用 PostgreSQL 集群。PostgreSQL 程序由您的软件包管理器提供。
- **脚本** `install.sh`。它安装相同的服务，但使用现有的 PostgreSQL 服务器。它还支持 arm64。参见[使用现有的 PostgreSQL](#existing-postgresql)。

关于 Docker，参见 [Docker Compose](./docker)。要初次了解控制台，参见[快速入门](../guide/quick-start)。

## 要求 {#requirements}

| 项目            | 要求                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 处理器          | 软件包为 x64。没有 arm64 软件包：在 arm64 上请使用 `install.sh`                                                                                                                                         |
| Init 系统       | systemd。不支持 OpenRC、runit 和其他 init 系统                                                                                                                                                          |
| C 库            | glibc 2.28 或更高版本。不支持 Alpine Linux（musl）                                                                                                                                                      |
| 已测试的发行版  | `.deb` 为 Ubuntu 24.04，`.rpm` 为 Fedora 44。满足以下依赖的其他 systemd 发行版未经测试                                                                                                                  |
| `.deb` 的依赖   | `postgresql` 16 或更高版本、`systemd`、`python3`、`ca-certificates`、`libc6` 2.28 或更高版本、`libstdc++6`、`libgcc-s1`、`libatomic1`                                                                   |
| `.rpm` 的依赖   | `postgresql-server` 16 或更高版本、`systemd`、`python3`、`ca-certificates`、`glibc` 2.28 或更高版本、`libstdc++`、`libatomic`                                                                           |
| PostgreSQL 程序 | 版本 16 到 19。安装步骤会搜索 `/usr/lib/postgresql/*/bin`、`/usr/pgsql-*/bin`、`/usr/bin` 和 `/usr/lib/pgsql/bin`，并选取找到的最高版本。如果您的发行版只提供较旧的版本，请先添加较新的 PostgreSQL 仓库 |
| 账户            | `root`，或可以运行 `sudo` 的用户                                                                                                                                                                        |
| 空闲端口        | `127.0.0.1` 上的 8080 和 54329                                                                                                                                                                          |
| 文件存储        | 支持硬链接的本地文件系统。不要使用网络共享                                                                                                                                                              |

软件包包含 Node.js 24。安装它除了软件包管理器用于获取依赖的访问之外，不需要互联网访问。

软件包绝不会更改现有的 PostgreSQL 集群或服务。Arkvory 从 PostgreSQL 程序启动自己的集群。

## 安装软件包 {#install-package}

1. 从 [GitHub Releases](https://github.com/ProAnima/Arkvory/releases) 下载适用于您的发行版的软件包，以及同一发行版的 `native-linux.json`。
2. 将软件包的 SHA-256 与 `native-linux.json` 中的值比较。软件包未使用发布者密钥签名，因此此检查是您所下载内容的唯一证明。
3. 安装软件包。请保留文件名前面的 `./`：它告诉软件包管理器该文件是本地文件。在 Debian 和 Ubuntu 上：

```bash
sudo apt install ./Arkvory-amd64.deb
```

在 Fedora 和兼容 RPM 的系统上：

```bash
sudo dnf install ./Arkvory-x86_64.rpm
```

软件包管理器安装依赖，然后 Arkvory 进行自我配置。它会：

1. 将 Node.js 复制到 `/opt/proanima-arkvory/runtime/node`，
2. 创建两个服务账户、配置、密钥和恢复密钥，
3. 创建并启动 PostgreSQL 集群并运行数据库迁移，
4. 注册并启动服务和更新计时器，
5. 等待 API 连续三次应答其就绪检查。

最后它会打印控制台地址和恢复密钥的路径。如果某个步骤失败，安装会因错误而停止。参见[故障排查](#troubleshooting)。

安装后自动更新处于关闭状态。要开启它们，参见[更新](./updates)。

## 软件包创建了什么 {#what-package-creates}

### 文件和目录 {#files}

| 路径                                                            | 内容                                                                                                        |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `/usr/lib/proanima-arkvory/`                                    | 软件包载荷：Node.js、发行版文件和安装程序。归软件包所有                                                     |
| `/usr/bin/arkvory`                                              | 管理命令。参见 [arkvory 命令](#arkvory-command)                                                             |
| `/usr/share/applications/arkvory.desktop`                       | 在桌面上打开控制台的菜单项。没有桌面的服务器不会使用它                                                      |
| `/opt/proanima-arkvory/`                                        | 安装根目录：配置、数据、数据库、每个版本的程序代码。其布局在[选择安装方式](./#installation-directory)中描述 |
| `/etc/systemd/system/arkvory-*.service`, `arkvory-update.timer` | 服务单元和更新计时器                                                                                        |

根目录为 `root:arkvory`，权限模式为 `0711`。在其内部，`config/` 为 `0750 root:arkvory`，`data/` 和 `logs/` 归 `arkvory` 所有，`database/` 归 `arkvory-db` 所有且权限模式为 `0700`。恢复密钥和数据库密码文件只能由 `root` 读取。

### 账户 {#accounts}

| 账户         | 运行                    | 说明                                                          |
| ------------ | ----------------------- | ------------------------------------------------------------- |
| `arkvory`    | API、工作进程、备份代理 | 系统账户，无登录 shell，主目录为 `/opt/proanima-arkvory/data` |
| `arkvory-db` | 数据库                  | 系统账户，无登录 shell。API 账户无法读取数据库文件            |

### 服务 {#services}

| 单元                   | 运行身份                                | 重启策略                           |
| ---------------------- | --------------------------------------- | ---------------------------------- |
| `arkvory-database`     | `arkvory-db`                            | `on-failure`，10 秒后              |
| `arkvory-api`          | `arkvory`                               | `always`，10 秒后                  |
| `arkvory-worker`       | `arkvory`                               | `always`，10 秒后                  |
| `arkvory-backup`       | `arkvory`                               | `always`，10 秒后                  |
| `arkvory-update.timer` | 以 `root` 启动 `arkvory-update.service` | 每分钟。该作业检查更新请求和发行版 |

所有单元在开机时启动（`multi-user.target`）。它们允许 120 秒的停止时间。它们以 `NoNewPrivileges`、私有 `/tmp`、在其自身目录之外为只读的文件系统运行，并且无法访问 `/home`。API 和工作进程只能写入根目录下的 `data/`、`logs/` 和 `updates/inbox/`。备份代理读取存储，并且只写入备份存储。由于 `/home` 对单元隐藏，切勿将证书、备份存储或数据目录放在主目录下。

未经您请求而停止的服务会在 10 秒后再次启动。主线程挂起 60 秒的进程会自行结束并再次启动。仅就绪检查失败不会重启服务。参见[自愈](../operate/self-healing)。

### 端口 {#ports}

| 端口      | 用途                   | 暴露                                        |
| --------- | ---------------------- | ------------------------------------------- |
| 8080/TCP  | API 和控制台           | 仅 `127.0.0.1`，直到您配置 [HTTPS](./https) |
| 54329/TCP | 托管的 PostgreSQL 集群 | 仅 `127.0.0.1`。该编号是固定的              |

## 首次启动和入门 {#first-start}

1. 检查服务是否运行：

   ```bash
   systemctl status arkvory-database arkvory-api arkvory-worker arkvory-backup
   ```

2. 读取恢复密钥。只有 `root` 可以读取它。

   ```bash
   sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
   ```

3. 打开 `http://127.0.0.1:8080/console/#onboarding`。在远程服务器上，请先转发端口，然后在您自己的计算机上打开该地址：

   ```bash
   ssh -L 8080:127.0.0.1:8080 admin@arkvory.example
   ```

4. 在控制台中，打开 [[ui:navStart]] 并展开 [[ui:welcomeOwner]]。将密钥粘贴到 [[ui:welcomeRecovery]]，输入所有者名称和至少 12 个字符的密码，然后选择 [[ui:welcomeCreate]]。名称有 3 到 64 个字符：拉丁字母、数字、点、短横线或下划线。
5. 使用新名称和密码登录。

所有者是第一位管理员。恢复密钥保留在服务器上：不要删除该文件，也不要将其复制到客户端或 CI 系统。安装工具会读取它。对于日常工作，请创建账户和服务密钥。参见[账户与访问](../use/accounts)和[安全](../operate/security)。

在客户端从其他计算机连接之前，请配置 [HTTPS](./https)。然后连接备份存储并运行首次备份：参见[备份](../operate/backups)。

要从您自己的计算机在服务器上安装，您也可以改用 Arkvory Remote Setup。参见[选择安装方式](./#remote-installation-over-ssh)。

## arkvory 命令 {#arkvory-command}

软件包安装 `/usr/bin/arkvory`。`arkvory help` 列出所有命令，无需特殊权限。其他所有命令都需要 `root` 和安装根目录：

```bash
sudo arkvory status --root /opt/proanima-arkvory
```

`status` 打印安装模式、已安装版本、自动更新设置和版本固定。

| 命令              | 用途                                                               |
| ----------------- | ------------------------------------------------------------------ |
| `status`          | 显示已安装版本和更新策略                                           |
| `update`          | 立即安装较新的稳定版。参见[更新](./updates)                        |
| `configure`       | HTTPS、备份存储、镜像、更新策略和中心。参见[配置](./configuration) |
| `recover`         | 完成被中断的更新。参见[更新](./updates#recover-update)             |
| `finish-install`  | 继续被中断的安装                                                   |
| `updates-connect` | 连接从旧发行版更新而来的安装的控制台和更新计时器                   |

## 日志 {#logs}

服务写入系统日志。API 和工作进程每行写入一条 JSON 记录。

```bash
sudo journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup -u arkvory-database
sudo journalctl -u arkvory-api -f
sudo journalctl -u arkvory-update --since today
```

`arkvory-update` 保存更新计时器的输出。日志大小和保留期是您操作系统的设置。关于记录字段和指标，参见[监控](../operate/monitoring)。部署命令打印的行的格式为 `<ISO-8601 time> INFO|WARN|ERROR <text>`。机密会从中移除。

## 升级 {#upgrade}

在旧软件包之上安装较新的软件包，或从控制台或使用 `arkvory update` 进行更新。正在运行的服务会继续提供服务，直到更新切换到新代码。关于策略、数据库架构更改前的备份以及恢复步骤，参见[更新](./updates)。

Arkvory 没有 apt 或 dnf 仓库。请从发行版页面下载每个新软件包。

## 删除 {#remove}

### 删除软件包并保留数据 {#remove-package}

在 Debian 和 Ubuntu 上：

```bash
sudo apt remove proanima-arkvory
```

在 Fedora 和兼容 RPM 的系统上：

```bash
sudo dnf remove proanima-arkvory
```

删除操作会停止并禁用服务和更新计时器。它会删除 `/usr/lib/proanima-arkvory`、`/usr/bin/arkvory` 和菜单项。它有意**保留**：

- `/opt/proanima-arkvory`：数据库、所有文件、配置和恢复密钥，
- `/etc/systemd/system` 中的单元文件、账户 `arkvory` 和 `arkvory-db`，
- 备份存储及其 systemd drop-in。它绝不会改动备份存储。

`apt purge` 删除的内容不会超过 `apt remove`。如果您再次安装该软件包，它会使用保留的数据继续并启动服务。

### 删除所有内容 {#remove-all}

这会删除所有存储的文件和目录。请先进行备份并保留备份存储。

```bash
sudo systemctl disable --now arkvory-update.timer arkvory-backup arkvory-worker arkvory-api arkvory-database
sudo rm -rf /opt/proanima-arkvory
sudo rm -f /etc/systemd/system/arkvory-*.service /etc/systemd/system/arkvory-update.timer
sudo rm -rf /etc/systemd/system/arkvory-backup.service.d
sudo systemctl daemon-reload
sudo userdel arkvory
sudo userdel arkvory-db
```

请先删除软件包，如上所述。脚本安装之后没有软件包：第一条命令会停止服务，而指明 `arkvory-database` 和 `arkvory-db` 的命令会报告它们不存在。

## 使用现有的 PostgreSQL {#existing-postgresql}

软件包始终创建自己的集群。要使用贵组织运行的 PostgreSQL 服务器，请使用 `install.sh` 安装。它会创建相同的三个服务和更新计时器，但没有 `arkvory-database` 单元，也没有 `/usr/bin/arkvory` 命令。

请使用 16 到 19 的 PostgreSQL 版本。一个 Arkvory 安装使用一个数据库。切勿将两个安装连接到同一个数据库。

1. 向您的数据库管理员索取一个空数据库和拥有它的角色。Arkvory 使用该角色运行其迁移。
2. 从发行版下载 `install.sh` 并阅读它。它需要 `bash`、`curl`、`python3`、`tar` 和 `xz`、systemd 以及 `root`。
3. 运行它。脚本会询问连接 URL；输入是隐藏的。

   ```bash
   sudo bash ./install.sh --automatic
   ```

   要改为通过文件传入 URL，请创建一个只有 `root` 可以读取的文件：

   ```json
   { "ARKVORY_DATABASE_URL": "postgresql://arkvory:<password>@db.example:5432/arkvory" }
   ```

   ```bash
   sudo bash ./install.sh --config /root/arkvory.json
   ```

4. 安装完成后，删除临时目录 `/opt/proanima-arkvory/bootstrap.*`。如果您在提示符处输入了 URL，该目录会在 `native.json` 中保存它。
5. 如[首次启动和入门](#first-start)所述创建所有者。

脚本从 `nodejs.org` 下载 Node.js 24.21.0，检查其 SHA-256 并安装最新的稳定版。省略 `--automatic` 可让自动更新保持关闭。环境变量会更改默认值：

| 变量                      | 含义                                                    | 默认值                  |
| ------------------------- | ------------------------------------------------------- | ----------------------- |
| `ARKVORY_INSTALL_ROOT`    | 安装根目录。使用 `/home` 之外的专用空目录               | `/opt/proanima-arkvory` |
| `ARKVORY_RELEASE_VERSION` | 安装此稳定版本，而不是最新版本                          | 最新稳定版              |
| `ARKVORY_ARTIFACT_DIR`    | 从解包后的 `Arkvory-Linux.tar.gz` 安装，而不是从 GitHub | 未设置                  |

通过 `sudo env` 传入它们，例如 `sudo env ARKVORY_INSTALL_ROOT=/srv/arkvory bash ./install.sh`。

没有 `arkvory` 命令时，请使用脚本安装的 Node.js 调用管理程序。在 arm64 上使用 `linux-arm64`：

```bash
root=/opt/proanima-arkvory
sudo "$root/runtime/node-v24.21.0-linux-x64/bin/node" "$root/manage.mjs" status --root "$root"
```

您需要自行备份和维护 PostgreSQL 服务器。Arkvory 备份代理通过连接 URL 将数据库内容复制到备份存储中。参见[备份](../operate/backups)。

## 故障排查 {#troubleshooting}

| 问题                                                                | 如何处理                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PostgreSQL 16–19 server binaries are required`                     | PostgreSQL 程序缺失或太旧。请安装 16 到 19 版本的 PostgreSQL 服务器，然后再次安装该软件包                                                                                                                                                                              |
| `Use a dedicated empty installation directory`                      | `/opt/proanima-arkvory` 中保存着首次安装（在它保存 `installation.json` 之前就停止了）留下的文件。安装程序绝不会覆盖配置。请阅读日志和软件包管理器的输出并修复原因。尚未保存任何数据的目录可以移走，以便您重新安装。不要删除保存有数据的安装的 `config/` 或 `database/` |
| `Installation is locked`                                            | 某个操作正在运行或已崩溃。请停止更新计时器，读取根目录中的 `journal.json`，在了解状态之前不要删除 `operation.lock`。参见[更新](./updates#recover-update)                                                                                                               |
| `database/bootstrap-started` 存在，但 `database/initialized` 不存在 | 数据库创建被中断。不要删除集群，也不要手动重复 SQL。修复原因并运行 `sudo arkvory finish-install --root /opt/proanima-arkvory`                                                                                                                                          |
| 服务无法启动                                                        | `journalctl -u arkvory-api -n 100`。启动失败会打印一条 JSON 记录，其中的 `reason` 指明设置名，而不是其值                                                                                                                                                               |
| 端口 8080 被占用                                                    | 另一个程序正在使用它。释放该端口，或在 `config/runtime.json` 中设置 `ARKVORY_PORT`。参见[配置](./configuration#address-and-port)。数据库端口 54329 无法更改                                                                                                            |

如果安装在写入 `installation.json` 之后停止，您也可以重复软件包的配置步骤：在 Debian 和 Ubuntu 上运行 `sudo dpkg --configure -a`，或在 RPM 系统上再次安装同一软件包。

更多提示见[故障排查](../operate/troubleshooting)。
