---
title: FAQ
description: '关于限制、可用性、数据库、更新、迁移服务器、访问和许可证的常见问题的简短而准确的回答。'
---

# FAQ

## 大小与可用性 {#size-and-availability}

### 我能存储的最大文件是多少？ {#max-object-size}

10,000 GiB（10 737 418 240 000 字节）。一次上传最多 10,000 个分片，每个分片最多 1 GiB。管理员可以使用 `ARKVORY_MAX_OBJECT_BYTES` 设置更低的上限。声明的大小更大时会以 `400` 拒绝。在实践中，首先阻止您的是可用磁盘空间、仓库配额和 1 GiB 的可用空间保留：它们会应答 `507`。参见[概念](../guide/concepts#uploads)和[环境变量](./environment)。

### 一台服务器能容纳多少？ {#capacity}

Arkvory 默认最多保留 10 TiB 的内容（`ARKVORY_CAPACITY_BYTES`），计算已发布文件、未完成的上传和等待物理清理的内容。它是一个计数器，不是磁盘检查。磁盘和保留空间才是真正的限制。仓库可以有自己的配额。参见[存储](../operate/storage)。

### Arkvory 是高可用的吗？ {#high-availability}

不是。一个安装实例就是一台带一个 PostgreSQL 数据库和本地内容目录的服务器。如果服务器停止，客户端会等待，然后继续其传输；服务在崩溃或卡死后会自行重启。要防范服务器丢失，请使用[备份](../operate/backups)。要从第二个站点读取，请使用[镜像](../operate/mirrors)；切换到镜像是一个手动步骤，并且镜像尚未收到的更改会丢失。

### 它可以离线工作吗？ {#offline}

服务器无需互联网访问即可工作。Windows 安装程序包含 Node.js 和 PostgreSQL，可离线安装。Linux 软件包包含 Node.js，包管理器会安装 PostgreSQL。脚本安装程序和 Docker 会下载文件。更新可以从发行版的本地副本安装。如果无法访问更新中心，更新检查会失败并在控制台中显示；其他任何内容都不受影响。参见[选择安装方式](../install/index)和[更新](../install/updates)。

## 存储与数据库 {#storage-and-database}

### 它使用哪个数据库？ {#database}

PostgreSQL，每个安装实例一个数据库。Windows 安装程序包含 PostgreSQL 18.4。Linux 软件包使用来自您的发行版的 PostgreSQL 16 到 19 服务器的专用集群。Docker Compose 栈在容器中运行 PostgreSQL 18.4。脚本安装程序使用您自己的服务器。切勿将两个安装实例连接到一个数据库。文件内容不在数据库中：它在数据目录中。

### 我可以使用 S3 或其他对象存储吗？ {#s3}

不可以。文件内容存储在本地目录中，该目录必须位于支持硬链接的本地文件系统上，而不是网络共享上。Arkvory 不会将内容存储在 S3 中，也不提供 S3 接口。备份存储是另一块磁盘上的文件夹或挂载的网络共享（在 Windows 上，是本地或 iSCSI 卷）。

### 我可以使用公司的单点登录吗？ {#sso}

不可以。账户、组和密码属于 Arkvory。自动化使用服务密钥登录。参见[身份验证](../api/authentication)。

## 运行服务器 {#running}

### 我如何查看安装的是哪个版本？ {#version}

在控制台中，打开 [[ui:updates]]：[[ui:updateCurrent]] 会显示它。在服务器上，运行 `arkvory status --root <installation root>` 并读取 `current`；在带图形安装程序的 Windows 上，在提升权限的 PowerShell 中运行 `& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' status --root 'C:\ProgramData\ProAnima\Arkvory'`。管理员还可以调用 `GET /api/v1/system/updates`，它返回 `currentVersion`。`arkvoryctl --version` 命令显示客户端的版本，而不是服务器的版本。

### 我如何开启自动更新？ {#automatic-updates}

在控制台中，打开 [[ui:updates]]，选择 [[ui:updateAutomatic]]，选择 [[ui:updateHour]] 并选择 [[ui:updateSave]]。在服务器上，运行 `arkvory configure --root <installation root> --enable-updates`；`--disable-updates` 会关闭它们。除非您传入 `--automatic`，否则安装程序会让它们保持关闭。

即使自动安装关闭，服务器也会每 6 小时检查一次发行版。开启后，稳定版会在维护时段（默认 03:00 UTC）每天安装一次，除非版本被固定。更改数据库架构的发行版只有在服务器已创建并验证新备份之后才会安装。参见[更新](../install/updates)。

### Arkvory 会向 ProAnimaStudio 发送什么？ {#hub-traffic}

您的文件和数据保留在您的服务器上。服务器联系 ProAnimaStudio 中心（`hub.proanima.net`），并在无法访问中心时联系 GitHub，用于三件事：

- **更新检查。** 请求携带项目名称、操作系统、处理器架构、已安装版本和更新渠道。开启统计后，它还会携带一个随机安装 ID。
- **匿名统计。** 每次安装更新后有一个事件，包含安装 ID、版本、系统、架构和渠道。不会存储名称、地址、内容或 IP 地址。统计默认开启；通过 [[ui:updates]] 中的 [[ui:updateStatistics]] 或 `arkvory configure --statistics off` 关闭它们。没有统计时，新版本只有在向所有人推出时才会到达您这里。
- **反馈。** 仅当已登录的人员从 [[ui:reportOpen]] 发送它时。它包含消息、可选的电子邮件地址、最多 6 张截图和控制台日志。管理员可以添加服务器日志以及不含机密的版本和状态摘要。[[ui:reportShow]] 会准确显示将要发送的内容。

`arkvory configure --hub-off` 会停止联系中心：此后发行版仅来自 GitHub，反馈会在服务重启后关闭。空的 `ARKVORY_HUB_URL` 会仅关闭反馈。参见[许可证](https://github.com/ProAnima/Arkvory/blob/main/LICENSE.md)第 7 节。

### 备份会自行运行吗？ {#automatic-backups}

在您设置之前不会。使用 `arkvory configure --backup-vault <folder> --init-vault` 连接一个备份存储，然后在 [[ui:backups]] 中的 [[ui:backupPlan]] 开启每日计划。计划从 02:00 UTC 开始，保留 7 个每日、4 个每周和 6 个每月恢复点。在计划开启之前，控制台会显示每日计划已关闭的警告。参见[备份](../operate/backups)。

### 我如何迁移到另一台服务器？ {#move-server}

1. 在新服务器上安装相同或更新版本的 Arkvory。
2. 使用 `arkvory-backup restore` 命令将备份存储中最新的恢复点恢复到空数据库和空存储目录中。它会用 SHA-256 检查每个文件。参见[备份](../operate/backups)。
3. 将 `config/runtime.json` 中的 `ARKVORY_DATABASE_URL` 和 `ARKVORY_DATA_DIR` 指向恢复后的数据库和目录，重启服务，并检查控制台、一次下载和一次上传。
4. 将地址（DNS 或 CI 设置）迁移到新服务器。

用户、组和密码会恢复。会话不会被迁移，个人令牌和服务密钥会被撤销，因此请重新登录并签发新密钥。保留和物理清理策略会恢复为关闭状态；请有意开启它们。未完成的上传会被取消。对于您希望在旧服务器继续运行的同时迁移的仓库，您也可以让新服务器作为[镜像](../operate/mirrors)跟随它，并在切换时将其分离；镜像会携带文件、包和容器镜像，但不会携带账户、密钥、附件或策略。

### 服务器重启时传输会怎样？ {#interrupted-transfers}

客户端会继续。上传会话存活 7 天并保留已到达的分片；命令行客户端和 SDK 会询问服务器它已有什么并发送其余部分。下载会通过 `Range` 请求继续。单个 `PUT` 请求，例如原始文件或 Docker 层，会从第一个字节重新开始。参见[续传被中断的传输](../protocols/cli#resume-interrupted-transfers)。

### 出故障时我该去哪里查看？ {#logs}

每个错误都有一个请求 ID，位于 `requestId` 字段和 `X-Request-Id` 头部中。请在服务器的访问日志中找到它。服务将其日志写入 Windows 上的 `logs` 文件夹，以及 Linux 上的 journal（`journalctl -u arkvory-api`）。使用 [[ui:reportOpen]] 发送报告以包含日志。参见[故障排查](../operate/troubleshooting)和[监控](../operate/monitoring)。

## 访问 {#access}

### 我如何重置所有者的密码？ {#reset-owner-password}

另一位管理员可以在 [[ui:administration]] 中使用 [[ui:resetPassword]]。如果没有人能登录，请使用 `config/bootstrap-token.txt` 中的恢复密钥：用 `GET /api/v1/users` 找到账户的 ID，并发送 `PATCH /api/v1/users/<id>`，正文为 `{"password": "…"}`。新密码有 12 到 128 个字符。重置会结束该账户的所有会话和个人令牌。参见[身份验证](../api/authentication#recovery-key)。

### 什么是恢复密钥，如果我丢了它怎么办？ {#lost-recovery-key}

它是安装根目录中 `config/bootstrap-token.txt` 里的一项机密，只有系统管理员可以读取。它创建第一个所有者并管理服务账户。安装工具会读取该文件，因此不要删除它。如果文件丢失但您仍有管理员账户，您可以继续使用该账户工作；要生成新的恢复密钥，请遵循[配置](../install/configuration)。参见[概念](../guide/concepts#owner-and-recovery-key)。

### 我的 CI 应该使用哪个密钥？ {#ci-key}

使用一个服务账户的服务密钥，其策略只包含作业所需的操作，例如用于发布的 `upload.create`、`upload.write`、`upload.complete`、`upload.read` 和 `job.read`。控制台预设 [[ui:bindingRead]] 和 [[ui:bindingPublish]] 会填入典型的集合。不要在 CI 中使用恢复密钥或某个人的令牌。密钥默认持续 90 天，且最多 365 天，因此请计划轮换。参见[身份验证](../api/authentication#service-accounts)。

### 为什么管理员不能删除制品或更改存储策略？ {#delete-forbidden}

操作 `artifact.delete`、`storage.read`、`storage.manage` 和 `diagnostics.read` 仅对服务密钥存在。组授权、个人令牌、会话和恢复密钥永远不会携带它们。创建一个在仓库上具有这些操作的服务账户，签发一个密钥，并使用该密钥进行调用（API、`arkvoryctl` 或控制台中的 [[ui:keySignIn]]）。错误是 `403`，原因为 `permission_missing`。参见[身份验证](../api/authentication#repository-actions)。

### Docker、Git LFS 和 Unity 可以与它配合使用吗？ {#protocols}

可以。Arkvory 在 `/v2/` 提供容器注册表，在 `/lfs/<repository>` 提供 Git LFS 服务器，并在 `/npm/<repository>/` 提供 Unity Package Manager 可以使用的 npm 注册表。它们接受 Arkvory 密钥作为密码。参见[客户端与协议](../protocols/index)。

## 许可证 {#license}

### Arkvory 是开源的吗？ {#open-source}

不是。Arkvory 免费，其源代码可供阅读，但它不是开源软件。它采用 Ian Panaev 的 ProAnima Arkvory License 1.0，不允许分发分支或副本。请不要称它为“开源”。完整文本在 [LICENSE.md](https://github.com/ProAnima/Arkvory/blob/main/LICENSE.md) 中；如果两个版本不同，以俄文文本为准。

### 我可以用它做什么？ {#license-allowed}

您可以出于任何目的安装和使用任意数量的副本，包括在公司中；阅读和研究源代码；修改它；并在您的组织内部使用您修改后的版本。您可以通过它存储和交付您自己的制品，也可以交付给您自己的客户。

### 什么是不允许的？ {#license-forbidden}

您不得将软件或修改后的版本分发给组织外的任何人，发布包含其代码的分支、构建、容器镜像或补丁，出售、出租或出借它或对它的访问权，对它收费，或将其作为托管或管理服务提供给第三方。您不得移除版权声明、许可证或 ProAnima Arkvory 和 ProAnimaStudio 名称，或将修改后的版本呈现为原始版本。当您在公开场合描述基于 Arkvory 构建的系统时，请注明来源：“ProAnima Arkvory by ProAnimaStudio (Ian Panaev), https://github.com/ProAnima/Arkvory”。请仅从官方来源获取副本。如需其他许可，请写信至 info@proanima.net。

### 我在哪里报告问题或漏洞？ {#report}

对于您的安装出现的问题，请使用控制台中的 [[ui:reportOpen]]。对于安全问题，请遵循仓库中的 [SECURITY.md](https://github.com/ProAnima/Arkvory/blob/main/SECURITY.md)，不要公开发布它。
