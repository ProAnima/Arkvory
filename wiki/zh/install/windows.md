---
title: Windows
---

# Windows

在 Windows 上运行 Arkvory 有三种方式：

- **图形安装程序** `Arkvory-Setup-x64.exe`。推荐使用。它会安装 Windows 服务和专用的 PostgreSQL 数据库，且无需联网。
- **PowerShell 脚本** `install.ps1`。它安装同样的 Windows 服务，但使用您现有的 PostgreSQL 服务器。
- **Docker Desktop** 配合 `install.ps1 -Mode compose`。仅用于评估。参见 [Docker Compose](./docker)。

## 要求 {#requirements}

- x64 版 Windows，内部版本 10.0.17763 或更高（Windows 10 1809 版，Windows Server 2019 或更高版本）。
- 属于 Administrators 组的账户。
- 用于存放数据的本地 NTFS 卷。文件存储不支持网络共享。
- 位于用户配置文件和 `AppData` 之外的安装目录。服务账户必须能够读取每一级父目录。

## 使用图形安装程序安装 {#install-with-the-graphical-installer}

安装程序的界面只有英语和俄语，下面用英文原文标出界面上的按钮和选项，并在括号中给出中文说明。

1. 从 [GitHub Releases](https://github.com/ProAnima/Arkvory/releases) 下载 `Arkvory-Setup-x64.exe`。
2. 运行该文件并确认用户账户控制（UAC）提示。
3. 选择英语（English）或俄语，并接受许可协议。
4. 输入所有者账户。名称为 3 到 64 个字符：拉丁字母、数字、点、短横线或下划线。密码为 12 到 128 个字符。
5. 等待安装程序准备数据库、服务和所有者账户。
6. 在最后一页，保持选中 **Open Arkvory and finish onboarding**（打开 Arkvory 并完成入门），然后点击 **Finish**（完成）。控制台会在 `http://127.0.0.1:8080/console/#onboarding` 打开。

安装程序还会创建两个开始菜单快捷方式：**Arkvory**（控制台）和 **API and CLI**（控制台的帮助页面）。

如果安装程序提示 Microsoft 运行库需要重启，请重启 Windows 并再次运行安装程序。已有的 Arkvory 数据会保留。

安装后自动更新处于关闭状态。要开启，请参见[更新](./updates)。

### 静默安装 {#silent-installation}

用于自动化部署时，请把所有者账户写入一个 JSON 文件，并保护该文件，使只有 SYSTEM 和 Administrators 可以读取。

```json
{ "name": "admin", "password": "<至少 12 个字符>" }
```

```powershell
.\Arkvory-Setup-x64.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /OWNERFILE="C:\secure\owner.json"
```

安装程序在创建账户后会删除所有者文件。切勿把密码作为命令参数传递。如果不使用 `/OWNERFILE`，请稍后在控制台中用恢复密钥创建所有者。如果配置未完成，安装程序会以非零退出码退出。更新运行期间不要运行安装程序。

## 图形安装程序创建的内容 {#what-the-graphical-installer-creates}

| 项目             | 位置或值                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------- |
| 程序文件         | `C:\Program Files\ProAnima\Arkvory`                                                      |
| 数据、配置和日志 | `C:\ProgramData\ProAnima\Arkvory`（安装根目录）                                          |
| 数据库           | PostgreSQL 18.4，位于根目录的 `database\` 中，监听 `127.0.0.1:54329`                     |
| 控制台           | `http://127.0.0.1:8080/console/`                                                         |
| 恢复密钥         | 根目录中的 `config\bootstrap-token.txt`                                                  |
| 更新任务         | 任务计划程序（Task Scheduler）中的 `ProAnimaArkvoryUpdate`。以 SYSTEM 身份每分钟运行一次 |

### 服务 {#services}

| 服务名称          | 显示名称                  | 账户                          | 启动类型         |
| ----------------- | ------------------------- | ----------------------------- | ---------------- |
| `Arkvoryapi`      | ProAnima Arkvory api      | `NT AUTHORITY\LocalService`   | 自动（延迟启动） |
| `Arkvoryworker`   | ProAnima Arkvory worker   | `NT AUTHORITY\LocalService`   | 自动（延迟启动） |
| `Arkvorybackup`   | ProAnima Arkvory backup   | `NT AUTHORITY\LocalService`   | 自动（延迟启动） |
| `Arkvorydatabase` | ProAnima Arkvory database | `NT AUTHORITY\NetworkService` | 自动             |

这些服务无需用户登录即可运行。API、worker 和备份代理共用 LocalService 账户。数据库在 NetworkService 下运行，因此 API 账户无法读取数据库文件。

根目录只向 SYSTEM 和 Administrators 授予完全控制权限。LocalService 可以读取根目录，但只能修改 `data\`、`logs\` 和更新请求目录。恢复密钥以及安装程序的其他凭据文件只有 SYSTEM 和 Administrators 可以读取。

## 使用 PowerShell 和现有 PostgreSQL 安装 {#install-with-powershell-and-an-existing-postgresql}

如果您的组织已经在运行 PostgreSQL，请使用这种方式。它不会创建受管理的数据库服务，也不会在 **Apps**（应用）中添加条目。

1. 向数据库管理员申请一个空数据库和拥有该数据库的角色。Arkvory 使用此角色运行数据库迁移。
2. 从发行版下载 `install.ps1` 并审阅其内容。
3. **以管理员身份**打开 Windows PowerShell 并运行：

```powershell
.\install.ps1 -AutomaticUpdates
```

脚本会询问 PostgreSQL 连接 URL，输入内容不会显示。然后它从 `nodejs.org` 下载 Node.js 24.21.0，检查其 SHA-256，并安装最新的稳定版。

也可以不使用提示，而是传入一个受保护的 JSON 文件：

```json
{ "ARKVORY_DATABASE_URL": "postgresql://arkvory:<password>@db.example:5432/arkvory" }
```

```powershell
.\install.ps1 -Config C:\secure\arkvory.json
```

如果 PowerShell 阻止脚本运行，请运行 `powershell -ExecutionPolicy Bypass -File .\install.ps1`。这只会为当前进程更改执行策略。

| 参数                         | 含义                                                        |
| ---------------------------- | ----------------------------------------------------------- |
| `-Root <path>`               | 安装根目录。默认值：`C:\ProgramData\ProAnima\Arkvory`       |
| `-Version <x.y.z>`           | 安装此稳定版本，而不是最新版本                              |
| `-Mode windows` 或 `compose` | Windows 服务（默认）或 [Docker Compose](./docker)           |
| `-Engine docker` 或 `podman` | Compose 使用的容器引擎                                      |
| `-Config <file>`             | 包含 `ARKVORY_*` 设置（含数据库 URL）的 JSON 文件           |
| `-Artifact <directory>`      | 从解压后的 `Arkvory-Windows.zip` 安装，而不是从 GitHub 安装 |
| `-AutomaticUpdates`          | 开启自动更新                                                |
| `-Pin`                       | 固定已安装的版本                                            |

`-Root`、`-Config` 和 `-Artifact` 请使用绝对路径，例如 `-Artifact $PWD.Path`。

脚本不会创建所有者账户。在服务器上打开 `http://127.0.0.1:8080/console/`，选择 [[ui:welcomeOwner]]，并输入 `config\bootstrap-token.txt` 中的恢复密钥。

## 管理服务 {#manage-the-services}

```powershell
Get-Service Arkvoryapi, Arkvoryworker, Arkvorybackup, Arkvorydatabase
Restart-Service Arkvoryapi, Arkvoryworker
sc.exe qfailure Arkvoryapi
```

管理命令需要提升权限（以管理员身份运行）的 PowerShell，并且必须带上 `--root` 选项：

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
# 图形安装程序
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' status --root $root
# 脚本安装
& "$root\runtime\node-v24.21.0-win-x64\node.exe" "$root\manage.mjs" status --root $root
```

运行 `arkvory.ps1 help` 查看所有命令。这些命令在[配置](./configuration)和[更新](./updates)中有说明。

## 故障后的恢复 {#recovery-after-a-failure}

- 服务进程在没有收到停止请求的情况下停止时，Windows 会在 10 秒后重新启动它。失败计数在一小时后重置。
- 主线程卡死 60 秒的进程会自行退出，随后 Windows 会重新启动它。参见[自愈](../operate/self-healing)。
- 仅仅就绪检查失败不会重启服务（例如服务器正在排空请求时）。但是，当数据库不再响应时，API 和 worker 无法确认自己拥有存储：大约 8 秒后它们会自行退出，随后 Windows 每隔 10 秒重新启动它们，直到数据库恢复。
- 由您自己停止的服务会一直保持停止，直到您启动它或 Windows 重新启动。

再次运行图形安装程序会恢复服务的启动类型和恢复操作。

## 日志 {#logs}

| 根目录中的位置     | 内容                                                                    |
| ------------------ | ----------------------------------------------------------------------- |
| `logs\`            | API、worker 和备份代理的输出。文件在达到 20 MiB 时轮转，保留 5 个旧文件 |
| `logs\updater.log` | 更新任务的输出，轮转规则相同                                            |
| `database\`        | 数据库服务的日志（`arkvory-database*.log`）                             |
| `bootstrap.log`    | 图形安装程序配置步骤的输出                                              |

安装程序还会把自己的日志写入运行它的用户的临时文件夹。API 和 worker 每行写入一条 JSON 记录。参见[监控](../operate/monitoring)。

## 卸载 {#uninstall}

打开 **设置 > 应用**（Settings > Apps），选择 **ProAnima Arkvory**，然后点击 **卸载**（Uninstall）。卸载程序会：

1. 删除 `ProAnimaArkvoryUpdate` 任务。
2. 停止并删除 `Arkvorybackup`、`Arkvoryworker`、`Arkvoryapi` 和 `Arkvorydatabase`。
3. 删除程序文件。

它有意**保留** `C:\ProgramData\ProAnima\Arkvory`：数据库、所有文件、配置和恢复密钥。它绝不会触碰备份存储。如果以后运行相同或更新版本的安装程序，它会继续使用保留的数据。要删除数据，请先做好备份，然后自行删除该文件夹。

脚本安装没有卸载程序。要删除它的服务，请在提升权限的 PowerShell 中运行：

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
Unregister-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Confirm:$false
foreach ($role in 'backup', 'worker', 'api') {
  $exe = "$root\service\arkvory-$role.exe"
  if ((Get-Service "Arkvory$role").Status -ne 'Stopped') { & $exe stopwait }
  & $exe uninstall
}
```

## Docker Desktop {#docker-desktop}

Docker Desktop 是属于单个用户的应用程序。只有在该用户登录并且 Docker Desktop 启动之后，它的容器才会运行。计算机重启后，在此之前 Arkvory 不可用。如果使用 Docker Desktop 安装，请启用 **Settings > General > Start Docker Desktop when you sign in**（登录时启动 Docker Desktop）。该设置关闭时，安装程序和 `status` 命令会发出警告。对于必须无需登录即可启动的服务器，请使用本页介绍的原生服务。

## 故障排查 {#troubleshooting}

| 问题                                                                | 解决方法                                                                                       |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 安装程序提示配置未完成                                              | 阅读 `bootstrap.log`、安装程序日志和数据库日志。不要删除数据库文件夹                           |
| `database\bootstrap-started` 存在，但 `database\initialized` 不存在 | 数据库创建被中断。不要删除集群，也不要手动重复执行 SQL。请排除原因后运行 `finish-install` 命令 |
| `Run installer as Administrator`                                    | 启动 PowerShell 时选择**以管理员身份运行**（Run as administrator）                             |
| `Use a dedicated directory`                                         | 根目录已包含文件。请使用空目录。要管理已有的安装，请使用它自带的命令                           |
| `Node.js runtime is incomplete after extraction`                    | 检查杀毒软件的隔离区                                                                           |
| `Another installation owns this service`                            | 存在位于其他根目录的安装的服务。请先删除它们                                                   |

要在不删除数据的情况下完成被中断的安装：

```powershell
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' finish-install --root C:\ProgramData\ProAnima\Arkvory
```

更多提示见[故障排查](../operate/troubleshooting)。
