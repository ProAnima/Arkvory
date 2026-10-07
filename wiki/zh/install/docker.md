---
title: Docker Compose
description: '将 Arkvory 作为 Docker Compose 项目运行，包括其容器、卷、端口、更新、备份代理和删除。'
---

# Docker Compose

Compose 安装在一台主机上以容器方式运行 API、工作进程、备份代理和 PostgreSQL。安装程序从发行版构建 Arkvory 容器镜像并启动项目 `proanima-arkvory`。请在容器主机上使用它。在 Windows 上，Docker Desktop 仅供评估：参见 [Windows 上的 Docker Desktop](#docker-desktop)。

Compose 没有内置 HTTPS。在客户端从其他计算机连接之前，请在它前面放置反向代理：参见 [HTTPS 和反向代理](./https)。

## 要求 {#requirements}

| 项目     | 要求                                                                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 引擎     | 带 Compose 插件的 Docker Engine（`docker compose`）。可以使用 `--engine podman` 搭配兼容的 compose provider 来使用 Podman，但未经测试                          |
| 账户     | `root`，或 `docker` 组中的用户                                                                                                                                 |
| 开机启动 | 容器引擎必须在开机时启动，否则重启后 Arkvory 不会恢复。使用 `systemctl is-enabled docker` 检查                                                                 |
| 主机     | 每台容器主机一个 Arkvory 安装。项目名称和端口是固定的                                                                                                          |
| 空闲端口 | `127.0.0.1` 上的 8080                                                                                                                                          |
| 容器     | 仅限 Linux 容器。不支持 Windows 容器                                                                                                                           |
| 互联网   | `nodejs.org`（安装程序下载 Node.js 24.21.0 并检查其 SHA-256）、更新中心或 GitHub（发行版），以及 Docker Hub（`node:24.21.0-bookworm-slim` 和 `postgres:18.4`） |

安装程序不会安装或更改容器引擎、虚拟机监控程序或 WSL。

## 软件包 {#bundle}

安装程序获取经过验证的发行版并将其解包到安装根目录下的 `releases/<version>/`。Compose 文件是 `releases/<version>/deploy/compose.yml`，构建文件是 `releases/<version>/deploy/Dockerfile`。容器镜像 `proanima-arkvory:<version>` 在您的主机上基于 `node:24.21.0-bookworm-slim` 构建。不会从 Arkvory 注册表拉取任何内容。

安装根目录在 Linux 上是 `/opt/proanima-arkvory`。其布局在[选择安装方式](./#installation-directory)中描述。在 Compose 安装中，数据不在 `data/` 中：它位于下文描述的卷中。

## 容器 {#containers}

| 服务          | 镜像                         | 作用                                                                       |
| ------------- | ---------------------------- | -------------------------------------------------------------------------- |
| `database`    | `postgres:18.4`              | PostgreSQL。每 5 秒用 `pg_isready` 报告就绪                                |
| `api`         | `proanima-arkvory:<version>` | HTTP API 和控制台。发布在 `127.0.0.1:8080`。每 10 秒健康检查               |
| `worker`      | `proanima-arkvory:<version>` | 完成上传并运行后台作业。在 API 健康后启动                                  |
| `backup`      | `proanima-arkvory:<version>` | 备份代理。以只读方式读取存储卷。不发布端口                                 |
| `initialize`  | `proanima-arkvory:<version>` | 一次性，以 root 运行：将存储卷的所有权授予用户 1000                        |
| `migrate`     | `proanima-arkvory:<version>` | 一次性：运行数据库迁移                                                     |
| `vault-owner` | `proanima-arkvory:<version>` | 一次性，仅在使用 `maintenance` profile 时：将备份存储的所有权授予用户 1000 |

长期运行的服务会重启，除非您停止它们。Arkvory 的容器以镜像中的 `node` 用户（用户 1000）运行，具有只读根文件系统、内存中的 64 MiB `/tmp`、已丢弃所有 capability、`no-new-privileges`，以及 120 秒的停止时间。Docker 为每个容器最多保留五个 20 MiB 的 JSON 日志文件。

## 卷和绑定挂载 {#volumes}

### Docker 卷 {#docker-volumes}

| 卷                         | 挂载于                                | 内容                                         |
| -------------------------- | ------------------------------------- | -------------------------------------------- |
| `proanima-arkvory_storage` | `/var/lib/arkvory`                    | 文件内容和上传暂存。备份代理以只读方式挂载它 |
| `proanima-arkvory_catalog` | `database` 中的 `/var/lib/postgresql` | PostgreSQL 数据                              |

这些卷在更新和 `docker compose down` 后仍然存在。只有 `down --volumes` 会删除它们。

### 来自安装根目录的绑定挂载 {#bind-mounts}

| 主机路径                  | 容器内                          | 模式 | 挂载到                                        |
| ------------------------- | ------------------------------- | ---- | --------------------------------------------- |
| `config/runtime.json`     | `/run/arkvory/runtime.json`     | 只读 | api, worker, backup                           |
| `config/keys.json`        | `/run/arkvory/keys.json`        | 只读 | api, worker                                   |
| `config/health-token.txt` | `/run/arkvory/health-token.txt` | 只读 | api, worker                                   |
| `config/postgres.env`     | 环境文件                        |      | database                                      |
| `updates/status`          | `/run/arkvory-updates/status`   | 只读 | api, worker                                   |
| `updates/inbox`           | `/run/arkvory-updates/inbox`    | 读写 | api, worker                                   |
| 备份存储                  | `/srv/arkvory-vault`            | 读写 | backup、`vault-owner`（仅在配置了备份存储时） |
| `config/mirrors`          | `/run/arkvory/mirrors`          | 只读 | api、worker（仅在某个仓库被镜像时）           |

### 属主和模式 {#owners}

| 路径                                                   | 属主和模式       | 原因                                                                                                     |
| ------------------------------------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------- |
| 安装根目录                                             | 安装用户，`0700` | 根目录保存恢复密钥和数据库密码。只有安装用户可以进入它                                                   |
| `config/runtime.json`、`keys.json`、`health-token.txt` | `0644`           | 容器中的用户 1000 必须读取它们。`runtime.json` 保存数据库密码；`0700` 的根目录让其他用户无法访问这些文件 |
| `updates/inbox`                                        | `0777`           | 容器在主机上写入的唯一目录。容器用户和主机更新程序可能具有不同的用户 ID                                  |
| `updates/status`                                       | `0755`           | 由主机更新程序写入；容器只读取它                                                                         |
| 存储卷                                                 | 用户 1000        | `initialize` 在安装和更新时设置它                                                                        |
| 备份存储                                               | 用户 1000        | 当您连接备份存储时由 `vault-owner` 设置。备份存储随后属于 ID 为 1000 的主机用户                          |

## 端口 {#ports}

| 端口     | 服务         | 暴露                                    |
| -------- | ------------ | --------------------------------------- |
| 8080/TCP | API 和控制台 | 主机上的 `127.0.0.1:8080`。地址是固定的 |
| 5432/TCP | PostgreSQL   | 不发布。只能在 Compose 网络内部访问     |

Compose 文件属于发行版目录，更新会替换它，因此您无法在那里更改发布的地址。要从其他计算机访问控制台，请在主机上安装一个转发到 `127.0.0.1:8080` 的反向代理。

## 环境 {#environment}

Compose 文件不设置任何 Arkvory 设置。服务读取 `/run/arkvory/runtime.json`，即主机上的 `config/runtime.json`。安装程序写入这些值，您不得更改它们：`ARKVORY_HOST`（容器内为 `0.0.0.0`）、`ARKVORY_PORT`（`8080`）、`ARKVORY_DATABASE_URL`（带生成密码的 `database` 容器）、`ARKVORY_DATA_DIR`（`/var/lib/arkvory`）、`ARKVORY_KEYS_FILE` 和 `ARKVORY_UPDATE_CONTROL_DIR`。

您可以添加其他设置，例如 `ARKVORY_TRUSTED_PROXIES`、限制或 `ARKVORY_LOG_LEVEL`。将它们添加到 `config/runtime.json`，然后如[管理项目](#manage)所示停止并启动服务。完整列表见[环境变量](../reference/environment)。`config/compose.env` 保存 `ARKVORY_IMAGE`。安装程序维护它；请勿编辑它。

## 在 Linux 上安装 {#install}

1. 从 [GitHub Releases](https://github.com/ProAnima/Arkvory/releases) 下载 `install.sh` 并阅读它。
2. 以 `root` 身份运行它：

   ```bash
   sudo bash ./install.sh --mode compose
   ```

   添加 `--automatic` 可开启自动更新，或添加 `--engine podman` 以使用 Podman。使用 `ARKVORY_RELEASE_VERSION=1.2.3` 时，脚本会安装该稳定版本。如果无法通过互联网访问 GitHub，请解包 `Arkvory-Linux.tar.gz`，并在解包目录中运行 `sudo env ARKVORY_ARTIFACT_DIR="$PWD" bash ./install.sh --mode compose`。Node.js 仍会被下载。

3. 等待安装程序完成。它会检查并解包发行版、构建容器镜像、启动数据库、运行 `initialize` 和 `migrate`、启动 API 和工作进程、等待 API 连续三次报告就绪、启动备份代理并注册更新计时器。

`docker` 组中的用户可以在不使用 `root` 的情况下安装到该用户拥有的目录中：

```bash
ARKVORY_INSTALL_ROOT="$HOME/arkvory" bash ./install.sh --mode compose
```

此时安装程序不会注册更新计时器。在您自己安排更新程序之前，控制台无法请求更新。参见 [Compose 中的更新](#updates-compose)。

## 首次启动和入门 {#first-start}

1. 检查容器是否运行。关于 `compose` 命令，参见[管理项目](#manage)。

   ```bash
   "${compose[@]}" ps
   ```

2. 读取恢复密钥：

   ```bash
   sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
   ```

3. 在服务器上打开 `http://127.0.0.1:8080/console/#onboarding`。从您自己的计算机转发端口：`ssh -L 8080:127.0.0.1:8080 admin@arkvory.example`。
4. 在控制台中，打开 [[ui:navStart]] 并展开 [[ui:welcomeOwner]]。将密钥粘贴到 [[ui:welcomeRecovery]]，输入所有者名称和至少 12 个字符的密码，然后选择 [[ui:welcomeCreate]]。

请将恢复密钥保存在服务器上。参见[安全](../operate/security)。

## 管理项目 {#manage}

打开 root shell（`sudo -i`）并定义一次 `compose` 命令。Compose 需要项目名称、项目目录、环境文件和该安装的每个 Compose 文件：

```bash
root=/opt/proanima-arkvory
node="$root/runtime/node-v24.21.0-linux-x64/bin/node"   # linux-arm64 on arm64
version=$("$node" -p "require('$root/installation.json').current.version")
compose=(docker compose --project-name proanima-arkvory --project-directory "$root"
  --env-file "$root/config/compose.env" -f "$root/releases/$version/deploy/compose.yml")
for file in compose.vault.yml compose.mirrors.yml; do
  if [[ -f "$root/config/$file" ]]; then compose+=(-f "$root/config/$file"); fi
done
```

如果您遗漏了某个已存在的文件，`up` 会重新创建容器，但不带备份存储或镜像挂载。

| 任务         | 命令                                                                           |
| ------------ | ------------------------------------------------------------------------------ |
| 显示容器     | `"${compose[@]}" ps`                                                           |
| 读取日志     | `"${compose[@]}" logs --tail 100 api worker backup`                            |
| 停止 Arkvory | `"${compose[@]}" stop --timeout 120 backup worker api`                         |
| 启动 Arkvory | `"${compose[@]}" up -d --wait api worker`，然后 `"${compose[@]}" up -d backup` |

使用 `stop` 停止后，容器在引擎重启后仍保持停止。使用 `up -d` 再次启动它。

生命周期命令使用安装程序放入根目录的 Node.js 运行：

```bash
sudo "$node" "$root/manage.mjs" status --root "$root"
```

在 Compose 主机上不会安装 `arkvory`，因此对于 `status`、`update` 和 `configure`，请调用 `manage.mjs`。这些命令在[配置](./configuration)中描述。

## 日志 {#logs}

容器写入 Docker 的 JSON 日志文件。使用 `"${compose[@]}" logs` 读取它们。API 和工作进程每行写入一条 JSON 记录。参见[监控](../operate/monitoring)。生命周期命令将消息打印到终端，更新计时器写入日志：`journalctl -u arkvory-update`。

## Compose 中的更新 {#updates-compose}

使用控制台、自动更新时段或命令进行更新：

```bash
sudo "$node" "$root/manage.mjs" update --root "$root"
```

更新会下载并检查发行版，构建新的容器镜像，然后停止 `backup`、`worker` 和 `api` 并用新镜像启动它们。`database` 容器继续运行。卷保持不变。更改数据库架构的发行版仅在经过验证的备份之后才会安装。参见[更新](./updates)。

主机更新程序每分钟运行一次。在 systemd 主机上以 `root` 安装时，安装程序将它注册为 `arkvory-update.timer`。不使用 `root` 时，安装程序会打印警告。请以拥有该安装并有权访问容器引擎的用户身份每分钟安排此命令，例如使用 cron：

```text
* * * * * /home/admin/arkvory/runtime/node-v24.21.0-linux-x64/bin/node /home/admin/arkvory/manage.mjs updates-poll --root /home/admin/arkvory
```

切勿将 Docker socket 交给 Arkvory 容器。

## Compose 中的备份代理 {#backup-agent}

`backup` 容器从一开始就运行。没有备份存储时，它仍会运行并报告未配置备份存储。备份存储是主机上的一个目录，位于安装根目录之外，在单独的卷上。

1. 挂载备份存储卷并创建一个空目录，例如 `/mnt/backup/arkvory`。该目录必须存在：Compose 不会创建它。
2. 连接它：

   ```bash
   sudo "$node" "$root/manage.mjs" configure --root "$root" --backup-vault /mnt/backup/arkvory --vault-key-file /root/arkvory-agent.key
   ```

   该命令检查目录，写入 `config/compose.vault.yml`，将目录的所有权授予用户 1000，以只读方式把代理密钥文件交给备份容器（`--vault-key-file`），并仅重启备份容器。当代理报告备份存储可用时，命令成功。否则它会恢复之前的配置。

3. 要断开备份存储，请使用 `--backup-vault-off` 运行相同的命令。备份存储本身不会被改动。

计划、保留和恢复在[备份](../operate/backups)中描述。

## 删除 {#remove}

```bash
"${compose[@]}" down              # removes the containers, keeps the volumes
"${compose[@]}" down --volumes    # also deletes the catalog and all stored files
```

`down --volumes` 会删除所有数据。切勿在保存有文件的安装上运行它。请先进行备份，并保留备份存储。

执行 `down` 之后，您可以删除剩余的内容：

```bash
sudo systemctl disable --now arkvory-update.timer
sudo rm -f /etc/systemd/system/arkvory-update.service /etc/systemd/system/arkvory-update.timer
sudo systemctl daemon-reload
docker image rm "proanima-arkvory:$version"
sudo rm -rf /opt/proanima-arkvory
```

只有在您不再需要配置和恢复密钥之后，才能删除根目录。早期版本的镜像会保留在主机上，直到您删除它们。

## Windows 上的 Docker Desktop {#docker-desktop}

仅在工作站上进行评估时使用 Docker Desktop。Docker Desktop 是单个用户的应用程序：容器仅在该用户登录且 Docker Desktop 运行时才运行。计算机重启后，Arkvory 在此条件满足之前不可用。启用 **Settings > General > Start Docker Desktop when you sign in**。当此设置关闭时，安装程序和 `status` 命令会发出警告。对于服务器，请使用 [Windows 服务](./windows)。

1. 以 Linux 容器模式启动 Docker Desktop。
2. 从发行版下载 `install.ps1` 并阅读它。
3. 以运行 Docker Desktop 的用户身份打开 Windows PowerShell，**不要**使用管理员权限，然后运行：

   ```powershell
   .\install.ps1 -Mode compose
   ```

   参数 `-Root`、`-Version`、`-Engine`、`-Artifact`、`-AutomaticUpdates` 和 `-Pin` 在 [Windows](./windows#install-with-powershell-and-an-existing-postgresql) 中描述。`-Root` 和 `-Artifact` 请提供绝对路径。

4. 打开 `http://127.0.0.1:8080/console/#onboarding`，从 `C:\ProgramData\ProAnima\Arkvory\config\bootstrap-token.txt` 读取恢复密钥，并如[首次启动和入门](#first-start)所述创建所有者。

安装根目录 `C:\ProgramData\ProAnima\Arkvory` 在无继承的情况下向 SYSTEM、Administrators 和安装用户授予访问权限，因为 Docker Desktop 使用此用户的令牌读取绑定挂载。对于 Compose，请勿以提升权限运行安装程序。

安装程序仅在以管理员身份运行时才注册更新任务 `ProAnimaArkvoryUpdate`。该任务适合系统范围的引擎，而不是 Docker Desktop。对于 Docker Desktop，请以 Docker Desktop 用户身份注册该任务。它仅在此用户登录且 Docker Desktop 运行时才有效：

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
$node = "$root\runtime\node-v24.21.0-win-x64\node.exe"
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$root\manage.mjs`" updates-poll --root `"$root`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Action $action -Trigger $trigger -Settings $settings
```

在 PowerShell 中使用相同的参数管理项目：

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
$version = (Get-Content "$root\installation.json" -Raw | ConvertFrom-Json).current.version
$compose = @('compose', '--project-name', 'proanima-arkvory', '--project-directory', $root,
  '--env-file', "$root\config\compose.env", '-f', "$root\releases\$version\deploy\compose.yml")
foreach ($file in 'compose.vault.yml', 'compose.mirrors.yml') {
  if (Test-Path "$root\config\$file") { $compose += @('-f', "$root\config\$file") }
}
docker @compose ps
& "$root\runtime\node-v24.21.0-win-x64\node.exe" "$root\manage.mjs" status --root $root
```

Windows 上的备份存储必须是本地或 iSCSI 卷。UNC 和 SMB 路径会被拒绝。要删除安装，请运行 `docker @compose down --volumes`，使用 `Unregister-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Confirm:$false` 注销任务，并删除根目录。请先进行备份。
