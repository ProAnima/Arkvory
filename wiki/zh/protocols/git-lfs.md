---
title: Git LFS
description: 把 git 仓库的大型文件存储在 Arkvory 中并锁定二进制资源，例如用于 Unity 和 Unreal 项目。
---

# Git LFS

每个 Arkvory 仓库都是 Git LFS 服务器。您的 git 仓库仍保留在原处，例如在 GitHub、GitLab 或 Gitea 上。只有 Git LFS 跟踪的大型文件以及文件锁会进入 Arkvory。LFS 对象是普通制品，因此仓库权限、配额、SHA-256 校验、备份和镜像同样适用于它们。

## 搭建 git 仓库 {#set-up}

您需要服务器的 HTTPS 地址（参见 [HTTPS](../install/https)）、一个 Arkvory 仓库（例如 `games`）以及一个密钥（参见[账户与密钥](../use/accounts)）。

1. 在每台使用该仓库的机器上安装 Git LFS，并为每个用户运行一次 `git lfs install`。
2. 在 git 仓库根目录创建文件 `.lfsconfig` 并提交它。它会让整个团队使用 Arkvory：

```ini
[lfs]
	url = https://arkvory.example/lfs/games
```

3. 跟踪文件模式。这会写入 `.gitattributes`，您也要提交它：

```bash
git lfs track "*.psd" "*.fbx" "*.wav" "*.uasset" "*.umap"
git add .gitattributes .lfsconfig
```

4. 像往常一样提交并推送。第一个请求会要求提供凭据：参见[登录](#sign-in)。

仓库的 LFS 地址始终是 `https://<host>/lfs/<repository>`。

若要迁移已在另一台服务器的 LFS 中的文件，请先从旧服务器下载所有对象，然后切换 `lfs.url` 并上传它们：

```bash
git lfs fetch --all origin
git config lfs.url https://arkvory.example/lfs/games
git lfs push --all origin
```

## 登录 {#sign-in}

Arkvory 将密钥作为 HTTP Basic 认证的密码。用户名不会被检查：可使用任意名称。密钥也可以作为 Bearer 令牌提供。

当服务器第一次返回 `401` 时，Git 会通过其凭据助手询问用户名和密码。助手会保存它们：Windows 和 macOS 上是 Git Credential Manager，Linux 上是 `credential.helper store` 或 `cache`。

| 谁             | 密钥                                                                       |
| -------------- | -------------------------------------------------------------------------- |
| 开发人员       | 个人访问令牌。推送和锁使用范围 `read-write`，仅克隆和拉取使用范围 `read`。 |
| 构建服务器、CI | 带有[权限](#permissions)中动作的服务密钥                                   |

Git 按主机保存凭据。Arkvory 的密钥不会替换您 git 仓库主机（例如 GitHub）的凭据。

在没有凭据助手的 CI runner 上，请把密钥放入检出目录的本地配置中。这样密钥只存在于该工作区的 `.git/config` 中，绝不会出现在 `.lfsconfig` 中：

```bash
git config lfs.url "https://ci:${ARKVORY_KEY}@arkvory.example/lfs/games"
```

不要提交密钥。不要在日志中打印它。作业结束后删除工作区。

## 日常工作 {#daily-work}

Git LFS 的工作方式与任何 LFS 服务器相同。您会使用的命令：

| 命令                                    | 作用                                                 |
| --------------------------------------- | ---------------------------------------------------- |
| `git push`                              | 在推送提交之前把新的 LFS 对象上传到 Arkvory          |
| `git clone`、`git pull`、`git checkout` | 下载工作树需要的对象                                 |
| `git lfs fetch --all`                   | 下载所有分支的对象                                   |
| `git lfs ls-files`                      | 列出已跟踪的文件及其短 ID                            |
| `git lfs push --all origin`             | 再次上传所有本地对象。Arkvory 已有的对象不会被发送。 |

Arkvory 已有的、具有相同 ID 和大小的对象不会被再次发送。中断后重复推送只会发送缺失的内容。

## 锁定文件 {#locks}

二进制资源无法合并。锁会告诉团队某个人正在编辑某个文件。锁属于 Arkvory 仓库，而不属于分支。

```bash
git lfs lock Content/Maps/Level01.umap
git lfs locks
git lfs unlock Content/Maps/Level01.umap
```

- 对同一路径执行第二次 `git lfs lock` 会失败并提示 "already created lock"，并指出所有者。
- 所有者显示为创建锁时的用户或服务账户名称。文件密钥会显示其 ID。
- 只有所有者才能解锁文件。对别人的锁执行 `git lfs unlock --force` 需要在该仓库中具有 `artifact.delete` 动作的服务密钥。个人令牌无法解除他人的锁。
- 锁路径是 git 仓库的路径：最多 1024 个字符，文件夹之间用 `/` 分隔，且不含空段、`.` 或 `..`、反斜杠或冒号。
- `git lfs locks` 每页显示 100 个锁。

开启推送前检查，这样 git 会拒绝推送对他人已锁定文件的更改。该设置按服务器地址生效：

```bash
git config lfs.https://arkvory.example/lfs/games.locksverify true
```

标记编辑前应锁定的文件类型。之后 Git LFS 会让它们保持只读，直到您锁定它们：

```bash
git lfs track --lockable "*.umap" "*.uasset"
```

推送时的锁检查需要写访问权限，因此只读令牌无法使用它。请使用 `git lfs locks` 列出锁，读访问权限允许这样做。

## Unity 与 Unreal 提示 {#game-engines}

- Unity：把文本资源（`.unity`、`.prefab`、`.asset`）保留在 git 中，并把资源序列化设置为 Force Text。把大型二进制文件交给 LFS 跟踪，例如 `*.png`、`*.psd`、`*.fbx`、`*.wav`、`*.mp4`、`*.exr`。在 LFS 中跟踪的文本文件也同样受支持。
- Unreal Engine：跟踪 `*.uasset`、`*.umap` 以及大型源文件，并把 `*.uasset` 和 `*.umap` 标记为可锁定。
- 调用 LFS 锁定命令的编辑器集成使用 Git LFS 的标准文件锁定协议。Arkvory 已使用 `git` 和 `git-lfs` 命令行客户端测试。
- 不要把数十 GB 且不断变化的构建产物放入 LFS。请用 [`arkvoryctl`](./cli) 把它们作为制品或[原始文件](./raw-files)上传。LFS 对象绝不会被保留规则删除，因此会永久保留。
- Unity 项目共享的大型可复用代码或工具更适合使用 [Unity 包](./unity-npm)。

## 存储的内容 {#what-is-stored}

- LFS 对象是 Arkvory 仓库中的制品。它的名称和标识是其内容的 SHA-256（LFS 的 `oid`），并带有标签 `lfs`。您可以在控制台的 [[ui:catalog]] 下看到这些制品。
- Arkvory 在接收对象时校验大小和 SHA-256。如果它们与 `oid` 不一致，上传会失败并返回 `422`，且不会存储任何内容。
- 对象属于仓库。两个 Arkvory 仓库会各自保存同一文件的副本。
- 保留规则绝不会删除 LFS 对象，因为服务器无法得知哪些提交仍需要它们。没有删除 LFS 对象的命令。请为资源的完整历史规划仓库配额。
- 锁是数据库中的行。备份会包含它们。

## 权限 {#permissions}

个人令牌和文件密钥会获得仓库的读或写访问权限。服务密钥获得精确的动作。

| 操作                             | 服务密钥动作      | 个人令牌或文件密钥                |
| -------------------------------- | ----------------- | --------------------------------- |
| 下载（`clone`、`fetch`、`pull`） | `content.read`    | 读访问权限                        |
| 上传（`push`）                   | `upload.create`   | 写访问权限，令牌范围 `read-write` |
| 列出锁                           | `artifact.list`   | 读访问权限                        |
| 创建、校验和释放自己的锁         | `upload.create`   | 写访问权限，令牌范围 `read-write` |
| 释放他人的锁（`--force`）        | `artifact.delete` | 不支持                            |

需要推送和拉取的 CI 作业需要 `content.read`、`upload.create` 和 `artifact.list`。只能推送的密钥仍会得知对象是否存在，因此不会重复上传它。

只读个人令牌可以克隆和拉取，尽管下载列表请求是 `POST`。它不能推送或加锁。镜像和读取网关在[镜像与读取网关](#mirrors-and-read-gateways)中介绍。

## 传输的工作方式 {#how-it-works}

日常工作中不需要了解这些细节。它们有助于您调试代理或防火墙。

1. Git LFS 发送一个 `POST /lfs/<repository>/objects/batch`，其中包含操作（`download` 或 `upload`）以及对象列表。每个请求最多 1000 个对象。Git LFS 默认最多发送 100 个。
2. Arkvory 为每个需要传输的对象返回一个有效期为一小时的链接。对于上传，它会省略已经拥有的对象。
3. Git LFS 使用 `PUT` 把每个对象发送到 `/lfs/<repository>/objects/<oid>`，或使用 `GET` 下载它。该请求携带与批量请求相同的密钥。
4. `PUT` 需要 `Content-Length` 请求头。分块上传会被拒绝并返回 `422`。

支持的内容：

| 项目       | 值                                                                                 |
| ---------- | ---------------------------------------------------------------------------------- |
| 传输适配器 | 仅 `basic`                                                                         |
| 哈希算法   | 仅 `sha256`。请求其他算法的客户端会收到 `409`。                                    |
| 认证       | Basic（密钥作为密码）或 Bearer                                                     |
| 下载       | 使用 `GET` 和 `HEAD` 及 `Range` 请求                                               |
| 媒体类型   | JSON 请求使用 `application/vnd.git-lfs+json`。任何媒体类型的对象正文都按字节存储。 |

错误是包含 `message` 和 `request_id` 的 JSON 文档。向管理员求助时请提供 `request_id`。

这些链接指向客户端访问服务器时使用的地址。当反向代理终止 HTTPS 时，它必须传递 `Host` 请求头并发送 `X-Forwarded-Proto: https`，如安装文档中的 nginx 示例所示，以便链接使用 `https`。只有当链接是 `https` 或指向本机时，Arkvory 才会把密钥放入链接。通过明文 HTTP 访问另一台主机时，git 无法随对象发送密钥，传输会失败。

## 大文件与续传 {#large-files}

- Git LFS 在一个 `PUT` 请求中发送每个对象。失败后它会从第一个字节重新开始该对象。不支持在对象内部续传的 `tus` 适配器。
- 上传请求必须在 30 分钟内完成，且暂停不得超过 30 秒（`ARKVORY_UPLOAD_DEADLINE_MS`、`ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`）。数十 GB 的文件需要快速稳定的网络。对于更大的文件，请使用按分片上传的 [`arkvoryctl`](./cli)。
- 下载接受 `Range` 请求。
- 对象最大可与安装实例的最大对象大小相同（`ARKVORY_MAX_OBJECT_BYTES`，默认约 10 TiB）。更大的对象会在批量响应中被拒绝并返回 `422`。

默认情况下，服务器同时运行 2 个上传，每个密钥 1 个（`ARKVORY_MAX_UPLOADS`、`ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`）。Git LFS 默认同时发送 8 个对象。其他上传会等待空闲槽位，并在 20 秒后放弃（`ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS`）并返回 `503`。Git LFS 会对失败的对象重试几次，但推送大型文件时减少并行传输会更可靠：

```bash
git config lfs.concurrenttransfers 1
```

您也可以请管理员提高限制。这些限制在[环境变量](../reference/environment#transfers-and-bandwidth)中描述。

## 镜像与读取网关 {#mirrors-and-read-gateways}

| 位置                                 | 克隆和拉取                                          | 推送和锁                                                     |
| ------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------ |
| 主服务器                             | 是                                                  | 是                                                           |
| [镜像](../operate/mirrors)           | 是。镜像拥有其源的对象，因此请把 `lfs.url` 指向它。 | 被拒绝（`409`，原因 `mirror_read_only`）。锁不会复制到镜像。 |
| [读取网关](../operate/read-gateways) | 否。下载列表是 `POST` 请求，读取网关不接受它。      | 否                                                           |

请始终把 `lfs.url` 指向主服务器，对于只读机器则指向镜像。

## 故障排查 {#troubleshooting}

| 消息或症状                                      | 原因                                          | 处理方式                                                    |
| ----------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------- |
| `401` 或授权错误                                | 没有密钥、密钥错误，或令牌已过期或已撤销      | 在凭据管理器中删除已保存的凭据，然后使用有效密钥再次推送    |
| `403` 并提示 "Read-only personal access token"  | 令牌的范围为 `read`                           | 创建一个范围为 `read-write` 的令牌                          |
| `403`                                           | 密钥缺少此操作的访问权限，或未授予该仓库权限  | 添加[权限](#permissions)中的动作                            |
| `Lock failed: already created lock`             | 有人持有该锁                                  | 请所有者解锁，或请管理员使用 `--force`                      |
| `422` "Object exceeds the maximum size"         | 对象大于安装实例的限制                        | 对此类文件使用 `arkvoryctl`                                 |
| 上传时 `422`                                    | 内容与 `oid` 不匹配；文件在推送期间发生了变化 | 再次运行 `git lfs push`                                     |
| `503` 或 `Retry-After`                          | 同时有太多传输                                | 降低 `lfs.concurrenttransfers` 并重试                       |
| `507`                                           | 已达到仓库配额或安装实例的容量                | 释放空间或申请更大的配额                                    |
| 上传时 `409`                                    | 该仓库是镜像                                  | 推送到主服务器                                              |
| 工作树中的文件是带 `oid` 的小文本文件           | 对象未被下载，或未运行 `git lfs install`      | 运行 `git lfs install`，然后运行 `git lfs pull`             |
| `x509: certificate signed by unknown authority` | 客户端不信任证书                              | 把证书颁发机构添加到系统的信任存储，或设置 `http.sslCAInfo` |

不要关闭 TLS 验证（`GIT_SSL_NO_VERIFY`）：密钥会随每个请求发送。

## 相关页面 {#related-pages}

- [客户端与协议](./index)
- [账户与密钥](../use/accounts)
- [HTTPS](../install/https)
- [镜像](../operate/mirrors)
- [Unity 与 npm 包](./unity-npm)
