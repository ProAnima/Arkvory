---
title: 选择安装方式
---

# 选择安装方式

Arkvory 运行在一台服务器上。每种安装都包含相同的组成部分：

- **API**：HTTP API 和 Web 控制台。
- **工作进程（worker）**：完成上传并运行后台任务。
- **备份代理**：按计划把备份写入备份存储。
- **PostgreSQL**：用于目录的数据库。

文件内容保存在服务器的本地磁盘上。这种部署不是高可用系统。更新或服务器故障会造成短暂中断，客户端会续传各自的传输。

## 安装选项 {#installation-options}

| 选项                                                                                    | 平台                                          | 重启后无需登录即可启动                             | 数据库                                                | 安装后的自动更新                                      | 适用场景                                          |
| --------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| [图形安装程序](./windows) `Arkvory-Setup-x64.exe`                                       | Windows x64                                   | 是（Windows 服务）                                 | 内置 PostgreSQL 18.4，由 Arkvory 管理                 | 关闭                                                  | Windows 服务器和工作站，无法访问互联网时的安装    |
| [Linux 软件包](./linux) `Arkvory-amd64.deb`、`Arkvory-x86_64.rpm`                       | 带 systemd 的 Linux x64                       | 是（systemd 单元）                                 | 使用发行版自带的独立 PostgreSQL 集群（16 到 19 版本） | 关闭                                                  | Debian、Ubuntu 和基于 RPM 的服务器                |
| 脚本，原生服务：`install.sh`（[Linux](./linux)）、`install.ps1`（[Windows](./windows)） | 带 systemd 的 Linux x64 或 arm64，Windows x64 | 是                                                 | 您现有的 PostgreSQL 服务器                            | 关闭；使用 `--automatic` / `-AutomaticUpdates` 可开启 | 自动化部署、已有的 PostgreSQL 服务器、Linux arm64 |
| [Docker Compose](./docker)                                                              | 装有 Docker Engine 的 Linux                   | 是，前提是容器引擎在开机时启动                     | PostgreSQL 18.4 容器                                  | 关闭；使用 `--automatic` 可开启                       | 容器主机                                          |
| [Docker Desktop](./docker)                                                              | Windows x64                                   | 否。容器仅在用户登录且 Docker Desktop 启动后才运行 | PostgreSQL 18.4 容器                                  | 关闭；使用 `-AutomaticUpdates` 可开启                 | 在工作站上试用                                    |

所有选项安装的 API、worker 和备份代理都相同。内置 HTTPS 仅适用于原生安装。Compose 安装需要反向代理来提供 HTTPS。参见 [HTTPS 与反向代理](./https)。

### 通过 SSH 远程安装 {#remote-installation-over-ssh}

**Arkvory Remote Setup** 是客户端软件包的一部分。它在管理员的计算机上运行，通过 SSH 连接到服务器，并在服务器上安装原生的 Linux 或 Windows 软件包。然后它创建所有者账户，并通过私有 SSH 隧道打开控制台。

| 服务器      | 要求                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------- |
| Linux x64   | SSH 和 SFTP、systemd、`apt-get` 或 `dnf`，root 用户或可使用 `sudo -n`（不提示输入密码）的用户 |
| Windows x64 | 带 SFTP 的 OpenSSH Server、Windows PowerShell、管理员账户                                     |

隧道只在 Remote Setup 运行期间有效，不会把 Arkvory 发布给其他计算机。不支持需要密码的 `sudo`、SSH agent、跳板机和 ARM 服务器。

## 发行版包含的文件 {#what-a-release-contains}

发行版发布在 [github.com/ProAnima/Arkvory/releases](https://github.com/ProAnima/Arkvory/releases)。

| 文件                                                                                                                                      | 用途                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `Arkvory-Setup-x64.exe`                                                                                                                   | Windows 图形安装程序。内置 Node.js、PostgreSQL、WinSW 和 Microsoft Visual C++ 运行库 |
| `Arkvory-amd64.deb`、`Arkvory-x86_64.rpm`                                                                                                 | Linux 软件包。内置 Node.js                                                           |
| `install.sh`、`install.ps1`                                                                                                               | 用于原生服务或 Docker Compose 的命令行安装程序                                       |
| `Arkvory-Linux.tar.gz`、`Arkvory-Windows.zip`                                                                                             | 自动化套件：命令行安装程序和发行版文件，用于无法访问 GitHub Releases 时的安装        |
| `Arkvory-CLI-Setup-x64.exe`、`Arkvory-CLI-amd64.deb`、`Arkvory-CLI-x86_64.rpm`                                                            | 客户端软件包：`arkvoryctl` 命令行客户端和 Arkvory Remote Setup                       |
| `arkvoryctl.mjs`、`arkvory-remote.mjs`                                                                                                    | 同样的客户端工具，作为适用于 Node.js 24 的单文件                                     |
| `arkvory-runtime.zip`、`arkvory-setup.mjs`、`arkvory-release.json`、`arkvory-release.json.sig`、`release-checksums.json`、`native-*.json` | 程序文件、清单、校验和与签名。安装程序和更新程序会读取它们                           |

## 要求 {#requirements}

| 项目                  | 要求                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Windows，图形安装程序 | x64，Windows 内部版本 10.0.17763 或更高（Windows 10 1809 版、Windows Server 2019）。需要管理员权限                   |
| Windows，脚本         | x64，Windows PowerShell。原生服务需要管理员权限                                                                      |
| Linux 软件包          | x64、systemd、glibc 2.28 或更高版本、Python 3。包管理器会安装 PostgreSQL 16 或更高版本                               |
| Linux，脚本           | x64 或 arm64，原生服务需要 systemd，另需 glibc、Bash、curl、Python 3、tar 和 xz                                      |
| Docker Compose        | 带 Compose 插件的 Docker Engine，或处于 Linux 容器模式的 Docker Desktop。也可以使用带兼容 compose provider 的 Podman |
| PostgreSQL            | 每个 Arkvory 安装使用一个数据库。切勿让两个安装连接到同一个数据库                                                    |
| 文件存储              | 支持硬链接的本地文件系统。不要把网络共享用作文件存储                                                                 |
| 备份存储              | 独立的卷，在服务启动之前挂载。参见[备份](../operate/backups)                                                         |

Arkvory 没有规定固定的处理器或内存最低配置。请按您的文件、数据库和备份存储来规划磁盘空间。默认情况下，Arkvory 在存储卷上保留 1 GiB 的可用空间，并接受最多 10 TiB 的预留上传。这两个限制都可以更改。参见[配置](./configuration)。

### 安装和更新期间的网络访问 {#network-access-during-installation-and-updates}

图形安装程序无需联网即可工作。其他选项通过 HTTPS 下载文件：

| 主机                                                | 用途                                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| `nodejs.org`                                        | `install.sh` 和 `install.ps1` 下载 Node.js 24.21.0 并检查其 SHA-256        |
| `api.github.com`、`github.com` 以及 GitHub 下载主机 | 脚本安装程序，以及无法连接更新中心时的更新                                 |
| `hub.proanima.net`                                  | 检查和下载更新。参见[更新](./updates)                                      |
| Docker Hub                                          | Compose 基于 `node:24.21.0-bookworm-slim` 构建镜像，并运行 `postgres:18.4` |

没有互联网访问时，请从发行版的本地副本安装和更新。参见[更新](./updates)。

## 端口 {#ports}

| 端口      | 服务                                           | 默认暴露范围                                                                                            |
| --------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 8080/TCP  | API 和控制台（HTTP，或使用内置 TLS 的 HTTPS）  | 仅限 `127.0.0.1`。配置 HTTPS 之后，原生安装可以监听其他地址。Compose 始终把它发布在 `127.0.0.1:8080` 上 |
| 54329/TCP | 图形安装程序和 Linux 软件包所管理的 PostgreSQL | 仅限 `127.0.0.1`                                                                                        |
| 5432/TCP  | Compose 安装的 PostgreSQL 容器                 | 不发布。仅在 Compose 网络内部可访问                                                                     |

只向客户端网络开放 HTTPS 端口。切勿开放数据库端口。

## 安装目录 {#installation-directory}

安装根目录在 Windows 上是 `C:\ProgramData\ProAnima\Arkvory`，在 Linux 上是 `/opt/proanima-arkvory`。请使用位于主目录和用户配置文件之外的专用空目录。

| 根目录中的路径                   | 内容                                                     |
| -------------------------------- | -------------------------------------------------------- |
| `installation.json`              | 已安装的版本、安装模式、自动更新设置和版本固定           |
| `journal.json`、`operation.lock` | 上次更新的状态，以及正在运行的操作的锁                   |
| `launcher.mjs`、`manage.mjs`     | 启动服务，以及管理命令                                   |
| `releases/<version>/`            | 每个已安装版本的程序代码。服务不会写入这里               |
| `runtime/`                       | Node.js。图形安装程序还会把 PostgreSQL 和 WinSW 放在这里 |
| `config/`                        | 设置、密钥和恢复密钥。参见[配置](./configuration)        |
| `data/`                          | 原生安装的文件存储                                       |
| `database/`                      | 受管理的 PostgreSQL 集群。在 Windows 上还包含它的日志    |
| `logs/`                          | Windows 服务日志和 Windows 更新程序日志                  |
| `service/`                       | Windows 服务包装程序                                     |
| `updates/`                       | 来自控制台的更新请求和更新程序的状态                     |

Compose 安装把数据保存在 Docker 卷 `proanima-arkvory_storage`（文件）和 `proanima-arkvory_catalog`（数据库）中，而不是 `data/` 中。

`releases/` 中的旧版本不会被自动删除。更新成功后，可以删除不再使用的版本。请保留当前版本，以及 `journal.json` 中记录的上一个版本。

## 恢复密钥 {#recovery-key}

安装程序会创建 `config/bootstrap-token.txt`。该文件保存**恢复密钥**，这是一把具有管理员权限的密钥。只有 root 或 Administrators 组可以读取它。

- 如果安装程序没有创建第一个所有者账户，请用它创建一次。控制台在首次启动时会要求提供它。
- 安装工具会在服务器上读取它：创建所有者、`arkvory configure --backup-vault`、更新后的备份检查，以及数据库架构变更之前的备份。**请勿删除此文件。**
- 不要把它复制到客户端、CI 系统或脚本中。日常工作请创建权限受限的用户账户和服务密钥。参见[账户与访问](../use/accounts)。

要更换恢复密钥，请参见[配置](./configuration)。

## 后续步骤 {#next-steps}

1. 按您的平台对应的页面进行安装：[Windows](./windows)、[Linux](./linux) 或 [Docker Compose](./docker)。
2. 登录并发布第一个文件。参见[快速入门](../guide/quick-start)。
3. 在客户端从其他计算机连接之前，先配置 [HTTPS](./https)。
4. 连接备份存储并运行第一次备份。参见[备份](../operate/backups)。
5. 选择[更新策略](./updates)。
