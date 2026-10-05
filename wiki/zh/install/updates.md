---
title: 更新
description: 'Arkvory 如何查找、验证并安装新发行版，包括手动和自动更新、架构更改前的备份、回滚、固定和离线更新。'
---

# 更新

ProAnimaStudio 通过中心（hub）发布 Arkvory 的每个稳定版。您的服务器向中心询问它可以安装哪个版本，下载该发行版，检查其签名并安装它。除非您启动更新，或开启自动更新，否则不会安装任何内容。自动更新默认关闭。

更新不是滚动更新。服务会短暂停止，正在进行的传输会被中断。能够续传的客户端会继续它们的传输。请在维护时段内更新。

## 更新如何工作 {#how-it-works}

- **发行版。** 只安装版本为 `x.y.z` 的已发布稳定版。预发行版、分支、任意地址和较旧的版本都会被拒绝。
- **中心决定。** 服务器每 6 小时向中心询问批准给它使用的版本。中心会暂缓新版本或逐步发布它。文件本身通过中心签发的短期链接从 GitHub 获取。服务器不需要为此提供 GitHub 令牌。
- **签名。** 每个发行版清单都由 ProAnimaStudio 签名。服务器使用内置到已安装程序中的公钥检查签名，然后检查归档的 SHA-256。未签名或被改动的发行版不会被安装，无论它来自中心还是 GitHub。中心在完整性方面不受信任。
- **主机更新程序。** 服务器上的计时器（Linux 上为 `arkvory-update.timer`，Windows 上为任务 `ProAnimaArkvoryUpdate`）每分钟运行更新程序。它接收来自控制台的请求，在距上次检查已过去 6 小时时检查发行版，并在其时段内启动自动更新。即使自动安装关闭，检查也会运行。

### 一次更新会做什么 {#what-an-update-does}

1. 在服务继续运行的同时，它下载发行版，检查签名和 SHA-256，并将文件解包到安装根目录下的 `releases/<version>/`。对于 Compose，它会构建新的容器镜像。
2. 如果发行版更改数据库架构，它会先创建并验证一份新的备份。参见[更新前的备份](#backup)。
3. 它停止备份代理、工作进程和 API。每个都有最多 120 秒来完成。
4. 它将安装切换到新版本。架构更改此时运行其迁移。
5. 它启动 API 和工作进程，并等待 API 连续三次报告就绪。然后它启动备份代理。代理不属于检查的一部分：如果它没有在约 90 秒内报告，更新会打印警告并保持。
6. 如果统计已开启，它向中心发送匿名的 `updated` 事件。这里的失败绝不会撤销更新。

旧版本保留在 `releases/` 中。所有数据、密钥和配置保持不变。

## 检查更新 {#check}

以管理员身份登录控制台并打开 [[ui:updates]]。该页面显示 [[ui:updateCurrent]]、[[ui:updateLatest]] 和 [[ui:updateChecked]]。选择 [[ui:updateCheck]] 立即询问中心。登录后，带有 [[ui:updateOpen]] 的横幅会告知您何时存在较新的发行版。

如果检查失败，例如没有网络访问，页面会保留它找到的最后一个发行版，并将其标记为可能已过时。检查会在 6 小时后再次尝试，或在您选择 [[ui:updateCheck]] 时尝试。

在服务器上，`arkvory status --root <root>` 显示已安装版本、自动更新设置和固定。

如果页面显示主机更新程序未连接，请运行 `arkvory updates-connect --root <root>`。它会连接从旧发行版更新而来的安装的控制台和更新计时器。如果页面显示更新程序已停止报告，说明计时器或任务已有 5 分钟未运行。参见[故障排查](#troubleshooting)。

## 手动安装 {#manual}

### 在控制台中 {#manual-console}

1. 打开 [[ui:updates]]，确认 [[ui:updateLatest]] 显示您想要的版本。
2. 选择 [[ui:updateInstall]]。对话框会指明版本，并警告传输可能被中断。
3. 选择 [[ui:updateConfirmButton]]。控制台会发送该版本和您看到的 SHA-256。如果已发布的字节此后发生了变化，请求会被拒绝。
4. 等待。请求会立即被接受；主机更新程序会在一分钟内接收它。服务重启期间页面可能会失去连接，并会自行重新连接。不要发送第二个请求。

当版本被固定时，控制台会拒绝安装。参见[固定版本](#pin)。

### 使用命令 {#manual-command}

```bash
sudo arkvory update --root /opt/proanima-arkvory
sudo arkvory update --root /opt/proanima-arkvory --version 1.2.3
```

不带 `--version` 时，命令安装中心为此服务器批准的版本。带 `--version` 时，它安装该确切的稳定版，该版本必须比已安装的版本更新。更新失败时，命令会以错误码退出。如何在各平台上运行该命令见[配置](./configuration#lifecycle-commands)。

## 自动更新 {#automatic}

通过以下三种方式之一开启自动更新：

- 在控制台中，打开 [[ui:updates]]，在 [[ui:updateSettings]] 下选择 [[ui:updateAutomatic]]，选择 [[ui:updateHour]] 并选择 [[ui:updateSave]]。
- 在服务器上：`arkvory configure --root <root> --enable-updates`。
- 使用脚本安装时：`install.sh` 使用 `--automatic`，`install.ps1` 使用 `-AutomaticUpdates`。

使用控制台或 `arkvory configure --root <root> --disable-updates` 关闭它们。

| 规则     | 值                                                                  |
| -------- | ------------------------------------------------------------------- |
| 时段     | 选定的 UTC 小时。默认为 03:00 到 03:59 UTC。只有控制台会设置该小时  |
| 尝试次数 | 每个 UTC 日最多一次，无论成功还是失败。错过的时段不会在当天稍后补上 |
| 跳过条件 | 版本被固定、上次检查失败，或没有已知的较新发行版                    |
| 发行版   | 中心在上次检查时批准的最新发行版                                    |

请将备份安排在更新时段之外。更新会停止备份代理，正在运行的备份会被中断并重新排队。

## 更新前的备份 {#backup}

不更改数据库架构的更新不会创建备份。请依赖您计划的备份。

更改数据库架构的发行版仅在有一份新的、经过验证的备份之后才会安装。更新程序在服务仍在运行时执行此操作：

1. 它向备份代理请求一份新备份，并等待备份完成并检查。它最多等待 6 小时。在此期间控制台会显示该发行版正在安装。
2. 只有在此之后，它才停止服务、迁移数据库并启动新版本。

该备份需要三样东西：已连接且可用的备份存储、在线的备份代理，以及至少一份更早完成的备份。首次数 TB 的完整备份是计划内的工作，绝不是更新的副作用。如果三者中缺少任何一个，更新会在**任何内容更改之前被拒绝**。服务继续运行，控制台显示安装被拒绝，自动更新会在次日再次尝试。连接备份存储并运行首次备份：参见[备份](../operate/backups)。

在快照之后、服务停止之前到达的更改不在该备份中。只有当新版本在其迁移后失败时，该备份才有意义：参见[回滚和恢复](#rollback)。

### 使用您自己的备份升级 {#manual-upgrade}

没有内置备份存储时，请自行创建并验证数据库和整个存储的备份，然后为更新程序提供一个记录该备份的文件：

```bash
sudo arkvory upgrade --root /opt/proanima-arkvory --version 1.2.3 --backup-record /secure/backup-record.txt
```

该文件是您自己的记录。更新程序只检查它是否存在；它并不证明备份是完整的。日志和回滚与 `update` 相同。此命令只能向前运行，并且当版本被固定为另一个版本时会被拒绝。

## 回滚和恢复 {#rollback}

### 自动回滚 {#automatic-rollback}

- **无架构更改。** 如果新版本未变得就绪，更新程序会停止它、恢复之前的发行版、等待就绪并报告 `Update failed; previous release restored`。
- **架构更改，迁移失败。** 迁移在单个事务中运行。失败的迁移会回滚，之前的发行版会在未更改的架构上再次启动。
- **架构更改，新版本在迁移后无法启动。** 之前的发行版无法读取新架构，因此没有自动回退的方法。更新程序会将日志标记为 `maintenance-required` 并指明备份点。修复原因并运行 `recover`，它会完成更新。或者恢复 `journal.json` 中指定的备份点并运行之前的版本。

Arkvory 没有降级命令。该命令会拒绝较旧的版本。之前的版本保留在 `releases/` 中，仅用于自动回滚。

### 恢复被中断的更新 {#recover-update}

更新期间发生崩溃或断电会留下两样东西：锁 `operation.lock` 和安装根目录中的记录 `journal.json`。在您恢复之前，新的更新和大多数命令都会拒绝运行。在了解状态之前，切勿删除该锁。

1. 停止更新计时器，以便不会启动新的运行。在 Linux 上：`sudo systemctl stop arkvory-update.timer`。在 Windows 上：`Disable-ScheduledTask -TaskName ProAnimaArkvoryUpdate`。在没有计时器的 Compose 安装中，停止您计划的任务。
2. 确保没有更新程序进程在运行。保存 `journal.json` 和日志。
3. 只有在此之后才删除 `operation.lock`。
4. 运行 `arkvory recover --root <root>`。它会按日志允许的方向推进：
   - 对于没有架构更改的更新，或在迁移开始之前，它会返回之前的版本，
   - 在迁移开始之后，它会向前推进：重复迁移（重复是安全的）并启动新版本。
5. 检查服务已就绪并且测试下载可用。再次启动计时器：`sudo systemctl start arkvory-update.timer`，或 `Enable-ScheduledTask -TaskName ProAnimaArkvoryUpdate`。

如果启动该更新的控制台请求仍被存储，`arkvory updates-reset --root <root>` 会删除它。请在检查状态之后才运行它。它不会删除该锁。

## 固定版本 {#pin}

固定一个版本可阻止所有向其他版本的更新。

```bash
sudo arkvory configure --root <root> --pin                  # pin the installed version
sudo arkvory configure --root <root> --pin --version 1.2.3  # pin another stable version
sudo arkvory configure --root <root> --unpin
```

当某个版本被固定时：

- 自动更新不做任何事，
- 控制台拒绝安装发行版，并要求您在服务器上移除固定，
- `arkvory update` 安装被固定的版本，并拒绝另一个 `--version`，
- 检查仍会运行，因此控制台仍会显示较新的发行版。

在固定了较旧版本之后要安装较新版本，请固定较新的版本并运行 `arkvory update`。您也可以在使用脚本安装时固定：`install.sh` 使用 `--pin`，`install.ps1` 使用 `-Pin`。

## 中心、通道和统计 {#hub}

### 服务器向中心发送什么 {#hub-data}

| 何时                        | 发送什么                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 更新检查，每 6 小时或按请求 | 对项目 `arkvory` 更新的请求，包含已安装版本、操作系统（`linux` 或 `windows`）、处理器（`x86_64` 或 `aarch64`）和通道。开启统计时，会加上带有随机安装 ID 的请求头 `X-Install-Id` |
| 一次更新完成，且统计已开启  | 一个 `updated` 事件，包含安装 ID、新版本、操作系统、处理器和通道                                                                                                                |
| 下载某个发行版              | 中心应答一个指向 GitHub 的链接。文件来自那里                                                                                                                                    |

不会发送任何密钥、账户、主机名或存储内容，也不会有任何凭据到达中心。安装 ID 是一个随机值，除了该安装之外不标识任何内容。据项目称，中心不存储 IP 地址、名称或内容。中心还会接收用户从控制台发送的反馈。那是用户的单独操作。

关闭统计时，服务器不发送安装 ID，也不发送事件。此时中心只会在向所有安装发布某个版本后才提供它。

### 选项 {#hub-options}

| 设置     | 默认值                     | 更改方式                                                                                                  |
| -------- | -------------------------- | --------------------------------------------------------------------------------------------------------- |
| 统计     | 开启                       | 控制台：[[ui:updateSettings]] 下的 [[ui:updateStatistics]]。命令：`--statistics off` 或 `--statistics on` |
| 通道     | `stable`                   | `--update-channel beta` 以接收 ProAnimaStudio 更早提供的版本，`--update-channel stable` 以返回            |
| 中心地址 | `https://hub.proanima.net` | `--hub-url https://hub.example` 使用您自己的中心，`--hub-off` 仅使用 GitHub。该地址必须使用 HTTPS         |

它们都是 `arkvory configure --root <root>` 的选项，无需重启即可生效。这些设置存储在 `config/hub.json` 中。更改中心地址也会更改控制台发送反馈的位置，在服务下次重启之后生效。

### 当中心无法访问时 {#hub-unreachable}

如果中心不应答（网络故障、超时或服务器错误），更新程序会改为读取 GitHub 上的最新稳定版并记录警告。它执行相同的签名和 SHA-256 检查。来自中心的拒绝（状态 4xx）、文件缺失或签名错误都属于错误，没有回退。

如果 GitHub 上的发行版需要身份验证，请在安装根目录中创建文件 `github-token.txt`，其中包含一个可以读取仓库内容的令牌。只有管理员可以读取该文件。更新程序使用它，服务不使用它，并且它绝不会作为命令选项传入。使用 `--hub-off` 时，更新程序始终使用 GitHub。

服务器需要 HTTPS 访问 `hub.proanima.net`、`api.github.com`、`github.com` 以及 GitHub 下载主机。

## 离线安装 {#offline}

没有互联网访问的服务器无法检查发行版。此时页面 [[ui:updates]] 会显示检查失败。这不会影响服务。请改为从文件更新。

1. 在一台有互联网访问的计算机上，下载适用于您服务器平台的套件：`Arkvory-Linux.tar.gz` 或 `Arkvory-Windows.zip`。将它们的 SHA-256 与发行版的 `release-checksums.json` 比较。
2. 将套件复制到服务器并解包。该目录包含 `arkvory-release.json`、`arkvory-runtime.zip` 和 `arkvory-setup.mjs`。套件没有签名文件。从同一发行版页面下载 `arkvory-release.json.sig` 并将其放在 `arkvory-release.json` 旁边：这样更新程序也会验证签名。
3. 使用该目录的绝对路径运行更新：

   ```bash
   sudo arkvory update --root /opt/proanima-arkvory --artifact /media/release
   ```

   ```powershell
   & 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' update --root C:\ProgramData\ProAnima\Arkvory --artifact D:\release
   ```

更新程序根据清单检查归档的 SHA-256。只有当 `arkvory-release.json.sig` 位于清单旁边时，它才检查签名。本地目录是您自己的选择，因此更新不要求签名。没有签名时，第 1 步中将套件与 `release-checksums.json` 比较是您对来源的唯一证明。架构更改的规则同样适用：您需要先有一份经过验证的备份。

原生软件包或 `Arkvory-Setup-x64.exe` 自带其发行版，不需要互联网访问。Compose 更新会在主机上构建容器镜像。只有当基础镜像 `node:24.21.0-bookworm-slim` 尚未存在于主机上时，它才需要 Docker Hub。

## 按平台更新 {#platforms}

### Windows {#platform-windows}

在已安装的版本之上运行较新的 `Arkvory-Setup-x64.exe`。安装程序会找到数据，不会再次询问所有者。它以与从控制台更新相同的方式更新程序、服务和数据库发行版。较旧版本的安装程序会被拒绝，相同版本的安装程序会修复服务。更新运行时不要启动安装程序。安装程序仅提供英语和俄语版本。您也可以从控制台或使用命令更新。

### Linux 软件包 {#platform-linux}

从发行版页面下载较新的软件包，并像首次安装那样安装它：`sudo apt install ./Arkvory-amd64.deb` 或 `sudo dnf install ./Arkvory-x86_64.rpm`。没有 apt 或 dnf 仓库，因此 `apt upgrade` 和 `dnf upgrade` 找不到新版本。软件包的配置步骤会运行与命令相同的更新，发行版就在软件包内。正在运行的服务会继续提供服务，直到切换。

如果更新被拒绝，例如因为架构更改需要一份不存在的备份，旧版本会继续运行，配置步骤会失败。修复原因，然后在 Debian 和 Ubuntu 上使用 `sudo dpkg --configure -a` 重复该步骤，或在 RPM 系统上再次安装同一软件包。

从控制台更新之后，软件包管理器显示的版本可能比正在运行的版本旧。比正在运行的版本旧的软件包会被拒绝。

### 脚本安装 {#platform-script}

脚本安装没有 `arkvory` 命令。请从控制台更新，或使用安装自带的 Node.js 运行 `manage.mjs update`。参见[配置](./configuration#lifecycle-commands)。

### Docker Compose {#platform-compose}

从控制台或使用 `manage.mjs update` 更新。更新程序会构建新版本的容器镜像，替换 `backup`、`worker` 和 `api` 容器并保留卷。不使用 `root` 的 Compose 安装需要计划执行 `updates-poll`。参见 [Docker Compose](./docker#updates-compose)。

## 更新之后 {#after}

- 检查 `arkvory status --root <root>` 并登录控制台。
- 从 `releases/` 中删除您不再需要的版本。请保留当前版本和 `journal.json` 中指定的上一个版本。旧版本、下载文件和暂存内容绝不会被更新程序删除。
- 更新不会升级脚本安装的 Node.js、PostgreSQL 程序、操作系统或容器引擎。请单独更新它们。PostgreSQL 主版本的更改是它自己的迁移：请先备份。

## 故障排查 {#troubleshooting}

| 您看到的情况                                                             | 如何处理                                                                                                                                                                                                    |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 页面显示主机更新程序未连接                                               | 在维护时段内运行 `arkvory updates-connect --root <root>`                                                                                                                                                    |
| 页面显示更新程序已停止报告                                               | 检查计时器或任务。在 Linux 上：`systemctl status arkvory-update.timer` 和 `journalctl -u arkvory-update`。在 Windows 上：任务 `ProAnimaArkvoryUpdate` 和 `logs\updater.log`。检查 `operation.lock` 是否遗留 |
| 发行版检查失败                                                           | 检查服务器对中心和 GitHub 的访问。服务不受影响                                                                                                                                                              |
| 由于需要备份，安装被拒绝                                                 | 连接备份存储，等待首次备份，再次检查状态。参见[更新前的备份](#backup)                                                                                                                                       |
| 更新失败                                                                 | 在再次尝试之前，阅读 `journal.json`、更新程序日志和服务日志                                                                                                                                                 |
| 需要手动恢复                                                             | 按照[恢复被中断的更新](#recover-update)操作                                                                                                                                                                 |
| 请求等待期间设置发生了变化                                               | 刷新页面并再次发送请求                                                                                                                                                                                      |
| `Installation is locked`                                                 | 另一个操作正在运行，或有一个已崩溃。参见[恢复被中断的更新](#recover-update)                                                                                                                                 |
| `Interrupted deployment; use recover after inspecting journal.json`      | 先前的更新未完成。请先恢复                                                                                                                                                                                  |
| `Downgrades are forbidden`                                               | 该版本不比已安装的版本新                                                                                                                                                                                    |
| `Version is pinned`                                                      | 移除固定，或安装被固定的版本                                                                                                                                                                                |
| `Interrupted update request; inspect installation and use updates-reset` | 来自控制台的请求已被接受但未完成。检查状态，然后运行 `updates-reset`                                                                                                                                        |

更多提示见[故障排查](../operate/troubleshooting)和[自愈](../operate/self-healing)。
