---
title: 术语表
description: '按字母顺序排列的 Arkvory 及其文档中所用术语的简短定义，每一条都带有解释它的页面的链接。'
---

# 术语表

术语按字母顺序排列。关于它们背后的概念，请阅读[概念](../guide/concepts)。

## A {#letter-a}

### 账户 {#account}

人在服务器上的登录身份：由 3 到 64 个字符的名称和 12 到 128 个字符的密码组成。组授权让账户获得对仓库的访问权限。参见[账户与访问](../use/accounts)。

### 操作 {#action}

仓库上的一项确切权限，例如 `upload.create` 或 `content.read`。服务密钥携带操作，API 参考会列出每个操作所需的操作。参见[身份验证](../api/authentication#repository-actions)。

### 管理员 {#administrator}

管理账户、组、更新和备份的账户。除非某个组也授予管理员访问权限，否则管理员不读取仓库中的文件。参见[账户与访问](../use/accounts)。

### 准入 {#admission}

服务器同时处理的请求和传输数量限制。超过该限制时，传输会短暂等待，然后服务器以 `503` 响应，并附带代码 `busy` 和 `Retry-After` 请求头。参见[速率限制与繁忙的服务器](../api/index#rate-limits)。

### 制品 {#artifact}

一个不可变的已存储文件及其 SHA-256。新内容会产生新制品。参见[概念](../guide/concepts#artifacts)。

### 附件 {#attachment}

从一次构建指向同一仓库中另一个制品的链接：清单、SBOM、签名、报告或其他文件。一次构建最多有 32 个附件。参见[概念](../guide/concepts#annotations)。

## B {#letter-b}

### 备份 {#backup}

按计划把数据库和所有已发布内容复制到备份存储中的副本。参见[备份](../operate/backups)。

### 备份代理 {#backup-agent}

制作副本、验证副本并对恢复点应用保留规则的服务。参见[备份](../operate/backups)。

### Bearer 令牌 {#bearer-token}

每个客户端向 `/api/v1` 发送凭据的方式：请求头 `Authorization: Bearer <credential>`。参见[身份验证](../api/authentication#headers)。

### 绑定 {#binding}

服务策略中的一条条目：一个仓库以及允许对它执行的操作列表。一条策略最多有 64 个绑定。参见[身份验证](../api/authentication#service-accounts)。

### 构建 {#build}

一次 CI 运行的输出，以制品或包版本的形式存储。参见[包](../use/packages)。

## C {#letter-c}

### 目录 {#catalog}

仓库中制品的列表，包含它们的名称、大小、标签和阶段。参见[制品参考](../api/reference/artifacts)。

### 上限 {#ceiling}

委派的限制：运维人员可以放入其所管理账户的策略和密钥中的仓库操作。运维人员不能超出自己的上限。参见[身份验证](../api/authentication#delegation)。

### 校验和 {#checksum}

证明字节与预期一致的 SHA-256。上传会在字节到达之前声明它，服务器和客户端都会验证它。参见[传输](../use/transfers)。

### 物理清理 {#cleanup}

也称 physical cleanup。它在后台以小批量方式释放已删除内容占用的磁盘空间。参见[存储](../operate/storage)。

### 集合 {#collection}

一组有名称的制品。集合是制品注解的一部分。参见[概念](../guide/concepts#annotations)。

### 比较并交换 {#compare-and-swap}

一种会指明所期望修订版本的更改，例如 `expectedRevision`。如果已有另一项更改先行发生，服务器会以 `409` 响应，原因为 `revision_mismatch`，并且不做任何更改。参见 [HTTP API 概览](../api/index#revisions)。

### 完成作业 {#completion-job}

工作进程的一个后台作业，用于检查并发布大型上传。您可以通过 `GET /api/v1/jobs/{id}` 跟踪它。它的状态为 `queued`、`running`、`completed` 或 `failed`。参见[上传参考](../api/reference/uploads#getCompletionJob)。

### 控制台 {#console}

Arkvory 的 Web 界面，位于 `/console/`。参见 [Web 控制台](../guide/console)。

### CORS {#cors}

针对调用其他地址上 API 的页面的浏览器规则。来自其他源的页面只有在管理员把该源列入 `ARKVORY_CORS_ORIGINS` 时才能工作。参见[环境变量](./environment)。

### 游标 {#cursor}

结果页中的 `next` 值。将它作为 `after` 发送回去即可读取下一页；当 `next` 为 `null` 时，列表已完整。参见 [HTTP API 概览](../api/index#pagination)。

## D {#letter-d}

### 委派 {#delegation}

从恢复密钥授予运维密钥的一种授权：它可以在上限范围内管理指定的服务账户，并拥有指定的管理操作。参见[身份验证](../api/authentication#delegation)。

### 摘要（digest） {#digest}

容器镜像的内容地址，写作 `sha256:…`。参见[容器镜像](../protocols/containers)。

### 下载链接 {#download-link}

一种限时链接，无需密钥即可下载一个制品。它的有效期为 60 秒到 24 小时（默认 1 小时），并且在过期之前无法撤销。参见[身份验证](../api/authentication#download-links)。

## E {#letter-e}

### ETag {#etag}

下载的验证器：制品的强校验值 `"sha256:<hex>"`。把它与 `If-Range` 一起使用可以安全续传，与 `If-None-Match` 一起使用可以跳过重复下载。参见 [HTTP API 概览](../api/index#range-downloads)。

## F {#letter-f}

### 故障切换 {#failover}

当源丢失时将客户端转移到镜像。运维人员会分离镜像，它随即成为接受更改的普通仓库。不会自动切换。参见[镜像](../operate/mirrors)。

### 反馈 {#feedback}

已登录用户从控制台向 ProAnimaStudio 发送的带截图和日志的报告。控制台会在发送任何内容之前显示将要附加的内容。参见 [Web 控制台](../guide/console#feedback)。

### 路径文件 {#file-by-path}

通过仓库中的路径（例如 `builds/game/Setup.exe`）寻址并保留其早期修订版本的文件。参见[文件与路径](../use/files)。

### 文件密钥 {#file-key}

一种机密信息，其 SHA-256 列在服务器的密钥文件（`ARKVORY_KEYS_FILE`）中。恢复密钥就是一种文件密钥。参见[身份验证](../api/authentication#recovery-key)。

## G {#letter-g}

### 宽限期 {#grace-period}

已删除内容在物理清理将其移除之前保留在磁盘上的时间：默认 24 小时。参见[存储](../operate/storage)。

### 组 {#group}

共享仓库访问权限的一组账户。组针对每个仓库获得 `read` 或 `write`（“读取和写入”）访问权限。参见[账户与访问](../use/accounts)。

## H {#letter-h}

### 历史记录 {#history}

某个路径文件或某组附件的早期修订版本。参见[文件与路径](../use/files)。

### 中心（hub） {#hub}

位于 `https://hub.proanima.net` 的 ProAnimaStudio 服务，用于发布稳定版并接收反馈。参见[更新](../install/updates)。

## I {#letter-i}

### 幂等键 {#idempotency-key}

`Idempotency-Key` 请求头：一个 1 到 128 个字符的值，使重复的请求只生效一次。参见 [HTTP API 概览](../api/index#idempotency)。

### 容器镜像 {#image}

存储在内置注册表中的容器镜像。参见[容器镜像](../protocols/containers)。

### 安装根目录 {#installation-root}

包含数据、配置和日志的文件夹：在 Windows 上为 `C:\ProgramData\ProAnima\Arkvory`，在 Linux 上为 `/opt/proanima-arkvory`。参见[选择一种安装](../install/index#installation-directory)。

## L {#letter-l}

### 标签 {#label}

制品上的短标记，例如 `nightly` 或 `tested`。一个制品最多有 32 个标签。参见[概念](../guide/concepts#annotations)。

### 租约 {#lease}

一种进程在短时间内持有并且必须续期的声明，从而保证同一时间只有一个进程执行某项作业。备份代理默认持有 60 秒的租约，因此两个代理绝不会同时运行。参见[环境变量](./environment#backups)。

### 存活 {#liveness}

`GET /health/live` 的应答：进程正在运行。它是公开的。参见[系统参考](../api/reference/system)。

### 锁（文件锁） {#lock}

一种 Git LFS 文件锁，用于阻止两个人修改同一个二进制文件。参见 [Git LFS](../protocols/git-lfs)。

## M {#letter-m}

### 维护时段 {#maintenance-hour}

UTC 时区中自动更新可以安装的当天时段。默认是 03:00。参见[更新](../install/updates)。

### 元数据 {#metadata}

制品的键/值文本字段：最多 32 个字段，值最长为 1,024 个字符。参见[概念](../guide/concepts#annotations)。

### 镜像（仓库镜像） {#mirror}

由第二个安装实例通过跟随源来保存的仓库只读副本。参见[镜像](../operate/mirrors)。

### 源（源实例） {#mirror-source}

镜像所复制的源安装实例。镜像使用只读密钥登录它。参见[镜像](../operate/mirrors)。

### 移动 {#move}

一种晋级方式，同时会从源仓库中移除该构建。参见[晋级](../use/promotion)。

## O {#letter-o}

### 入门 {#onboarding}

安装后的最初步骤，显示在控制台的入门部分。参见[快速入门](../guide/quick-start)。

### OpenAPI {#openapi}

HTTP API 的机器可读描述，位于 `/api/v1/openapi.json`。参见 [HTTP API 概览](../api/index#discovery)。

### 所有者 {#owner}

在安装期间创建的第一个账户。它是一名管理员，也是 `arkvory-owners` 组的成员，该组可以写入 `releases`。参见[概念](../guide/concepts#owner-and-recovery-key)。

## P {#letter-p}

### 包 {#package}

带有包组、名称和 SemVer 版本号的版本化 UPack 包。参见[包](../use/packages)。

### 包组 {#package-group}

包名称的第一部分。不同组中同名的包是不同的包。参见[包](../use/packages)。

### 分片 {#part}

大文件的一部分，作为独立的请求发送。除最后一片外，分片至少为 8 MiB，最大为 1 GiB。参见[传输](../use/transfers)。

### 权限 {#permission}

执行一项操作的权限。用户通过组获得 `read` 或 `write`；服务密钥获得确切的操作。参见[身份验证](../api/authentication#access-rules)。

### 个人访问令牌 {#personal-access-token}

供脚本和命令行使用的人员机密。它以 `pat_` 开头，默认 90 天后过期（最长 365 天），并且要么只读，要么可读写。参见[身份验证](../api/authentication#personal-tokens)。

### 固定 {#pin}

使某样东西（例如恢复点）免于自动删除。参见[备份](../operate/backups)。

### 策略 {#policy}

服务账户（其绑定）、仓库（其存储策略）或备份计划的已保存规则。参见[身份验证](../api/authentication#service-accounts)。

### 晋级 {#promote}

晋级这一动词：把构建发布到另一个仓库，或用阶段标记它。参见[晋级](../use/promotion)。

### 晋级 {#promotion}

在不重新上传的情况下把构建发布到另一个仓库。参见[晋级](../use/promotion)。

## Q {#letter-q}

### 配额 {#quota}

一个仓库可以使用的最多空间。会使它超出的新上传会被拒绝，并返回 `507` 和原因 `storage_quota`。参见[存储](../operate/storage)。

## R {#letter-r}

### 范围 {#range}

HTTP 请求头 `Range: bytes=start-end`，用于请求文件的一部分。下载每次请求支持一个范围，这正是续传所需要的。参见 [HTTP API 概览](../api/index#range-downloads)。

### 速率限制 {#rate-limit}

对某项操作可以尝试的频率的限制。Arkvory 限制登录、注册、密码和反馈尝试，并以 `429` 和 `Retry-After` 响应。参见[身份验证](../api/authentication#sign-in-limits)。

### 读取网关 {#read-gateway}

同一存储上的额外只读下载 API 进程。它响应 `GET` 和 `HEAD`，并以 `405` 拒绝更改。参见[读取网关](../operate/read-gateways)。

### 就绪 {#readiness}

服务器是否能完成其工作。`GET /health/status` 是公开的，会以 `{"status":"ready"}` 或 `unavailable` 响应；`GET /health/ready` 需要凭据并提供详细信息。参见[系统参考](../api/reference/system)。

### 恢复密钥（引导密钥） {#recovery-key}

也称引导密钥。位于 `config/bootstrap-token.txt` 中的安装机密：它创建所有者、管理服务账户并恢复访问。参见[身份验证](../api/authentication#recovery-key)。

### 注册表（registry） {#registry}

Docker 或 npm 等客户端向其推送和拉取的服务器。Arkvory 有一个容器注册表（`/v2/`）和一个 npm 注册表（`/npm/`）。参见[客户端与协议](../protocols/index)。

### 仓库 {#repository}

命名的内容空间，拥有自己的访问规则和存储策略。参见[仓库](../use/repositories)。

### 请求 ID {#request-id}

单个请求的标识符，通过 `X-Request-Id` 请求头以及每个错误中返回。请把它提供给支持人员。参见 [HTTP API 概览](../api/index#request-ids)。

### 解析（按阶段解析） {#resolve}

找出某个阶段和某个版本范围所指向的构建。参见[晋级](../use/promotion)。

### 恢复 {#restore}

使文件的早期修订版本重新成为当前版本，这会新增一个修订版本。也指从恢复点恢复整个安装。参见[文件与路径](../use/files)和[备份](../operate/backups)。

### 恢复点 {#restore-point}

一个可恢复的完整备份。参见[备份](../operate/backups)。

### 续传（继续上传或下载） {#resume}

从中断的地方继续被中断的上传或下载。参见[传输](../use/transfers)。

### 保留（保留规则） {#retention}

内容或备份保留多长时间的规则。参见[存储](../operate/storage)。

### 保留策略 {#retention-policy}

仓库的已保存保留规则：保留多少个构建、保护哪些标签，以及构建在移除之前必须有多旧。在管理员打开它之前，它处于关闭状态。参见[存储](../operate/storage)。

### Retry-After {#retry-after}

一种请求头，以及错误的 `retryAfterSeconds` 字段，它说明在 `429` 或 `503` 之后重试之前要等待多少秒。参见 [HTTP API 概览](../api/index#rate-limits)。

### 修订版本 {#revision}

路径文件、制品注解或某项设置的编号版本。修订版本从 1 开始计数。参见 [HTTP API 概览](../api/index#revisions)。

### 撤销 {#revoke}

永久取消一个密钥或令牌。参见[身份验证](../api/authentication#service-keys)。

### 回滚 {#rollback}

在更新未能启动之后返回到上一个版本。参见[更新](../install/updates)。

### 轮换 {#rotate}

在旧密钥仍然可用的情况下用新密钥替换它。激活新密钥后，旧密钥的有效期被限制为 24 小时。参见[身份验证](../api/authentication#service-keys)。

## S {#letter-s}

### SBOM {#sbom}

软件物料清单：一次构建的组件列表。您可以把它附加到构建。参见[概念](../guide/concepts#annotations)。

### 自愈 {#self-healing}

服务在崩溃或卡死之后自行重启。参见[自愈](../operate/self-healing)。

### SemVer {#semver}

语义化版本：`MAJOR.MINOR.PATCH`，带一个可选预发布部分，例如 `1.4.2` 或 `2.0.0-rc.1`。参见[包](../use/packages)。

### 服务账户 {#service-account}

供 CI 或自动化使用的账户。它有一份策略，并使用密钥登录。参见[身份验证](../api/authentication#service-accounts)。

### 服务密钥 {#service-key}

服务账户用于登录的机密。它以 `arkvory_` 开头，只显示一次，并且必须被激活。参见[身份验证](../api/authentication#service-keys)。

### 会话 {#session}

一个已登录的控制台会话。它以 `dps_` 开头，持续 12 小时。参见[身份验证](../api/authentication#sessions)。

### SHA-256 {#sha-256}

Arkvory 用于制品、分片和发布的哈希函数。它写作 64 个小写十六进制数字。参见[传输](../use/transfers)。

### 稳定版 {#stable-release}

ProAnimaStudio 已批准用于稳定通道上安装的版本。参见[更新](../install/updates)。

### 阶段 {#stage}

构建上的标记，例如 `qa`、`release` 或 `prod`。参见[晋级](../use/promotion)。

### 接口分组 {#surface}

六组 API 操作之一：`discovery`、`identity`、`catalog`、`transfers`、`administration` 和 `operations`。参见 [HTTP API 概览](../api/index#surfaces)。

## T {#letter-t}

### 镜像标签（tag） {#tag}

容器镜像某个版本的名称，例如 `latest` 或 `1.4`。参见[容器镜像](../protocols/containers)。

## U {#letter-u}

### UPack {#upack}

Arkvory 所注册的包格式：一个带有名为 `upack.json` 的清单的归档，该清单给出包组、名称和版本。参见[包](../use/packages)。

### 更新 {#update}

Arkvory 的一个较新稳定版，以及安装它。参见[更新](../install/updates)。

### 上传 {#upload}

把文件发送到服务器的行为。该词也指预留该文件的上传会话。参见[传输](../use/transfers)。

### 上传会话 {#upload-session}

针对一个文件的预留。它的有效期为 7 天，并在每个字节到达后完成。参见[上传参考](../api/reference/uploads)。

## V {#letter-v}

### 备份存储 {#vault}

备份的存储位置：另一块磁盘或网络共享上的文件夹。参见[备份](../operate/backups)。

### 版本 {#version}

包的 SemVer 版本，例如 `1.4.2`。参见[包](../use/packages)。

### 版本范围 {#version-range}

一组版本，例如 `^1.4`。参见[包](../use/packages)。

## W {#letter-w}

### 工作进程（worker） {#worker}

负责完成大型上传并同步镜像的服务。参见[选择一种安装](../install/index)。

### 写入进程 {#writer}

与读取网关相对、接受更改的 API 进程。参见[读取网关](../operate/read-gateways)。
