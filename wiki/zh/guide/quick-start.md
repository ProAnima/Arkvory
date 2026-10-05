---
title: 快速入门
---

# 快速入门

本页介绍从零开始、运行 Arkvory 服务器并上传一个文件的最短路径。在步骤 1 中选择一种安装方式，然后按顺序完成其余步骤。

请只从项目的[发布页面](https://github.com/ProAnima/Arkvory/releases)下载安装程序，并把它们的 SHA-256 与该版本的校验和文件进行比对。

## 步骤 1：安装服务器 {#step-1-install-the-server}

### Windows {#windows}

需要 x64 架构的 Windows 10 1809 版或更高版本，或 Windows Server 2019 或更高版本，以及管理员权限。不需要联网。

1. 运行 `Arkvory-Setup-x64.exe`，并确认管理员权限提示。
2. 选择语言并接受许可协议。
3. 在所有者页面，输入名称（3–64 个拉丁字母、数字、`.`、`-` 或 `_`）和至少 12 个字符的密码。这是第一个管理员账户。
4. 完成向导。向导可以为您打开控制台。

安装程序把程序文件安装到 `C:\Program Files\ProAnima\Arkvory`，把数据放在 `C:\ProgramData\ProAnima\Arkvory`。它会创建四个 Windows 服务：`Arkvorydatabase`、`Arkvoryapi`、`Arkvoryworker` 和 `Arkvorybackup`。这些服务无需用户登录即可运行。参见 [Windows](../install/windows)。

### Linux {#linux}

请使用适合您的发行版的软件包。包管理器也会安装 PostgreSQL 服务器（支持 16 到 19 版本）。

```bash
# Debian、Ubuntu
sudo apt install ./Arkvory-amd64.deb

# Fedora、兼容 RHEL 的发行版
sudo dnf install ./Arkvory-x86_64.rpm
```

安装根目录是 `/opt/proanima-arkvory`。软件包会创建 systemd 服务 `arkvory-database`、`arkvory-api`、`arkvory-worker` 和 `arkvory-backup`。检查它们的状态：

```bash
systemctl status arkvory-api arkvory-worker arkvory-backup
```

参见 [Linux](../install/linux)。

### Docker Compose {#docker-compose}

需要安装了 Compose 的 Docker。在 Windows 上，请使用 Linux 容器模式的 Docker Desktop。脚本会下载 Node.js 和发行版，因此需要访问互联网。

从发行版中下载 `install.sh` 或 `install.ps1`，并在运行之前先阅读脚本内容。

```bash
sudo bash ./install.sh --mode compose
```

在 Windows 上，请以运行 Docker Desktop 的同一用户身份运行 PowerShell，不要使用管理员权限：

```powershell
.\install.ps1 -Mode compose
```

安装根目录在 Linux 上是 `/opt/proanima-arkvory`，在 Windows 上是 `C:\ProgramData\ProAnima\Arkvory`。整套服务包含 API、worker、备份代理和 PostgreSQL 18。参见 [Docker](../install/docker)。

## 步骤 2：打开控制台 {#step-2-open-the-console}

在服务器上的浏览器中打开 `http://127.0.0.1:8080/console/`。

服务器起初只监听本地地址 `127.0.0.1`。要从您自己的计算机打开控制台，请通过 SSH 转发端口：

```bash
ssh -L 8080:127.0.0.1:8080 admin@arkvory.example
```

然后在您的计算机上打开 `http://127.0.0.1:8080/console/`。若要允许其他机器访问，请先设置 [HTTPS](../install/https)。

## 步骤 3：创建所有者 {#step-3-create-the-owner}

在 Windows 上请跳过此步骤：安装程序已经创建了所有者。

在 Linux 和 Docker 上，第一个账户使用**恢复密钥**创建。安装程序会把它写入安装根目录下的 `config/bootstrap-token.txt`。只有管理员可以读取该文件。

```bash
sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
```

```powershell
Get-Content C:\ProgramData\ProAnima\Arkvory\config\bootstrap-token.txt
```

1. 在控制台中，打开 [[ui:navStart]] 并展开 [[ui:welcomeOwner]]。
2. 把密钥粘贴到 [[ui:welcomeRecovery]] 字段中。
3. 输入所有者名称和至少 12 个字符的密码，然后选择 [[ui:welcomeCreate]]。
4. 在 [[ui:connection]] 卡片中，用新的名称和密码登录。

请对恢复密钥保密，并且不要删除该文件。安装和更新工具会用到它。参见[安全](../operate/security)。

所有者是管理员，可以写入仓库 `releases`。若要创建其他仓库，请打开 [[ui:administration]]，展开 [[ui:manageGrants]]，为 `arkvory-owners` 组授予对一个新名称（例如 `builds`）的 [[ui:write]] 访问权限，然后选择 [[ui:saveGrant]]。仓库名称使用小写拉丁字母、数字、`-` 和 `_`，最多 64 个字符。

## 步骤 4：为您的工具创建密钥 {#step-4-create-a-key-for-your-tools}

脚本和命令行客户端需要密钥。首次测试时，可以使用个人访问令牌：

1. 在 [[ui:connection]] 卡片中展开 [[ui:personalAccessTokens]]。
2. 在 [[ui:tokenName]] 中输入一个名称，将 [[ui:tokenScope]] 设为 [[ui:tokenScopeReadWrite]]，然后选择 [[ui:generateToken]]。
3. 复制令牌。它只显示一次。
4. 把它保存到只有您能读取的文件中，例如 `~/.arkvory/key`。

对于 CI/CD 和部署代理，请改为创建带有独立密钥的服务账户。参见[账户与访问](../use/accounts)。

## 步骤 5：用 curl 上传和下载 {#step-5-upload-and-download-with-curl}

仓库中的文件路径就像 Web 服务器上的文件。`PUT` 保存该路径的新版本，`GET` 返回当前版本。

```bash
export ARKVORY_KEY="$(cat ~/.arkvory/key)"

# 上传
curl -T ./Setup.exe -H "Authorization: Bearer $ARKVORY_KEY" \
  http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe

# 下载
curl -fL -H "Authorization: Bearer $ARKVORY_KEY" -o Setup-copy.exe \
  http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe
```

上传会返回如下 JSON：

```json
{
  "path": "builds/game/1.0/Setup.exe",
  "revision": 1,
  "created": true,
  "artifact": { "id": "…", "size": "1048576", "sha256": "…" }
}
```

如果再次上传相同的字节，响应为 `200`，其中 `"created": false`，且不会产生新版本。新文件的状态码是 `201`。

在 PowerShell 中：

```powershell
$headers = @{ Authorization = "Bearer $env:ARKVORY_KEY" }
$url = 'http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe'
Invoke-WebRequest -Method Put -InFile .\Setup.exe -Headers $headers -Uri $url
Invoke-WebRequest -Headers $headers -Uri $url -OutFile .\Setup-copy.exe
```

单个 `PUT` 请求必须在 30 分钟内完成。对于特别大的文件或较慢的网络，请使用命令行客户端：它按分片上传，并在失败后继续。参见[原始文件](../protocols/raw-files)。

## 步骤 6：使用命令行客户端 {#step-6-use-the-command-line-client}

在您自己的计算机上安装 `arkvoryctl`：Windows 上使用 `Arkvory-CLI-Setup-x64.exe`，Linux 上使用 `Arkvory-CLI-amd64.deb` 或 `Arkvory-CLI-x86_64.rpm`。在装有 Node.js 24 的 CI 机器上，也可以直接使用 `arkvoryctl.mjs`。

```bash
arkvoryctl profile add local --server http://127.0.0.1:8080 --token-file ~/.arkvory/key
arkvoryctl doctor
arkvoryctl put ./Setup.exe builds/game/1.0/Setup.exe
arkvoryctl get builds/game/1.0/Setup.exe ./Setup-copy.exe
```

除非添加 `--repository`，配置文件（profile）使用仓库 `releases`。如果传输中断，请再次运行相同的命令：它会从中断处继续，并在结束时检查 SHA-256。客户端只对本机接受明文 HTTP；远程服务器请使用 HTTPS。参见[命令行客户端](../protocols/cli)。

## 后续步骤 {#next-steps}

- [概念](./concepts)：仓库、制品、阶段和密钥。
- [HTTPS](../install/https)：安全地向其他机器开放服务器。
- [备份](../operate/backups)：在存放重要数据之前先连接备份存储。
- [包](../use/packages)和[晋级](../use/promotion)：用于部署的版本化构建。
- [Web 控制台](./console)：逐个介绍所有栏目。
