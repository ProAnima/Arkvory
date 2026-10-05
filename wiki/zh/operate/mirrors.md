---
title: 仓库镜像与第二站点
description: 在第二个安装上保留仓库的只读副本，查看它的同步状态，并在源丢失时切换到它。
---

# 仓库镜像与第二站点

**仓库镜像**是某个 Arkvory 安装上的仓库，它是另一个安装上某个仓库（即**源**）的只读副本。承载仓库镜像的安装（下文称“镜像端”）通过 HTTPS 从源拉取更改。镜像端拥有自己的数据库、自己的存储、自己的账户和自己的密钥。

仓库镜像可用于从第二个地点提供下载，也可用于保留一个在源丢失时能够接管的第二站点。仓库镜像不是源的备份，也不是自动的高可用。切换需要您自己完成。其他防护措施参见[备份](./backups)和[读取网关](./read-gateways)。

## 什么是仓库镜像 {#what-a-mirror-is}

对于做了镜像的仓库，镜像端会复制：

- 已发布的文件，包括其字节内容和与源上**相同的制品 ID**。
- 标签、元数据和集合。
- UPack 注册信息、阶段和当前的文件路径。
- 该仓库的容器镜像、Git LFS 对象和 npm 包。
- 删除操作。在源上删除的文件，在镜像端也会被删除。

按 ID、按包（版本、范围、阶段）和按文件路径下载时，镜像端的响应与源在最近一次同步时的响应一致。源停机时，这些下载仍然可用。

镜像端不会复制：

- 账户、组、密钥和授权。镜像端有自己的一套，彼此独立：在源上撤销密钥不会影响镜像端。
- 保护文件免于清理的引用、构建的附件、审计记录和存储策略。
- 首次同步之前的文件路径历史记录。镜像端上标签和路径的修订号是它自己的。

客户端不能向做了镜像的仓库写入。对其上传、更改标签、更改文件路径、设置阶段、删除和晋级，都会收到 HTTP 409，原因为 `mirror_read_only`。镜像端的其他仓库照常工作。存储策略不会在做了镜像的仓库中运行，只有同步才会在其中删除内容。

## 设置仓库镜像 {#set-up}

您需要在源上准备一个密钥，并在镜像端运行一条命令。

### 在源上创建密钥 {#source-key}

镜像端需要一个只能读取源仓库的密钥，不需要写入密钥。

1. 在源上，使用恢复密钥或运维密钥打开 [[ui:services]]。
2. 选择 [[ui:serviceCreate]]，并在 [[ui:servicePolicy]] 中添加该仓库。选择 [[ui:bindingRead]]，填入镜像端所需的权限，包括 `artifact.list`、`artifact.read`、`content.read`、`annotation.read`、`asset.read` 和 `package.read`。
3. 选择 [[ui:keyIssue]]，复制机密，勾选 [[ui:keySaved]]，然后选择 [[ui:keyActivate]]。未激活的密钥会在 15 分钟后过期。
4. 把机密保存到镜像端服务器上的一个文件中。文件只包含密钥，占一行，长度为 16 到 4000 个可打印字符。只有 root 或 Administrators 组可以读取它。

源必须是带有更改源（change feed）的发行版。下一步的命令会检查这一点。

### 在镜像端连接仓库 {#attach}

请在镜像端使用一个**新的、空的**仓库名称。同步会使仓库与源保持一致，但绝不会删除源上从来没有的内容。

```bash
sudo arkvory configure --root /opt/proanima-arkvory \
  --mirror releases \
  --mirror-upstream https://arkvory.example \
  --mirror-token-file /root/mirror-releases.key
```

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' configure --root $root `
  --mirror releases --mirror-upstream https://arkvory.example `
  --mirror-token-file C:\secure\mirror-releases.key
```

| 选项                       | 含义                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `--mirror NAME`            | 此安装上的仓库。1–64 个字符：小写字母、数字、`_` 和 `-`，以字母或数字开头                                       |
| `--mirror-upstream URL`    | 源的来源地址：`https://host`，不含路径、凭据和查询参数。纯 `http://` 仅接受 `localhost`、`127.0.0.1` 和 `[::1]` |
| `--mirror-token-file FILE` | 密钥文件的绝对路径                                                                                              |
| `--mirror-source NAME`     | 源上的仓库。默认与 `--mirror` 同名                                                                              |
| `--mirror-ca-file FILE`    | 包含源的证书颁发机构的 PEM 文件。参见[使用自有证书颁发机构的 HTTPS](#ca-file)                                   |

每条命令只处理一个仓库。不能在同一次调用中把仓库镜像的更改与 HTTPS、备份存储或更新的更改合并。

1. 命令在做出任何更改之前，会先用密钥检查源。源必须报告它提供仓库镜像的更改源，并且源仓库的更改源必须有响应。
2. 它把密钥保存到 `config/mirrors/NAME.token`，写入 `config/mirrors/mirrors.json`，并在 `config/runtime.json` 中设置 `ARKVORY_MIRRORS_FILE`。
3. 它重启 API 和 worker，并等待它们就绪。如果任何一步失败，它会恢复之前的文件并再次重启。

在 Docker Compose 中，命令还会写入 `config/compose.mirrors.yml`，它把仓库镜像文件挂载到 API 和 worker 容器中。请把它加入您自己运行的 Compose 命令。

使用新的 `--mirror-token-file` 重复运行命令，即可更换某个仓库的密钥。worker 在每次失败之后都会重新读取密钥文件，因此新密钥无需重启即可生效。已经在镜像某个源的仓库，会拒绝另一个源，并给出消息 `NAME mirrors another source; detach it first`。

在镜像端，请为人员和工具授予对该仓库的访问权限。只要有授权或服务策略提到某个仓库，它就存在了。人员使用 [[ui:administration]] 中的 [[ui:manageGrants]]，工具使用服务策略。源上的权限不会带过来。

### 使用自有证书颁发机构的 HTTPS {#ca-file}

如果源使用的证书来自企业内部的或自签名的颁发机构，请在 `--mirror` 命令中添加 `--mirror-ca-file /path/ca.pem`。命令会检查每个证书是否可读且未过期，并把 1 到 64 个证书保存到 `config/mirrors/ca.pem`（该文件不得超过 1 MiB）。之后 worker 除了信任标准证书之外，还会信任这些证书。

- 该文件为安装中的所有仓库镜像共用。新的 `--mirror-ca-file` 会追加到其中，已存在的证书只保留一份。分离最后一个仓库镜像时，该文件会被删除。
- worker 在其所有连接中都信任整组证书，而不仅仅是针对某一个仓库镜像。
- 证书检查绝不会被关闭。

## 复制什么、多久一次 {#sync}

同步由镜像端的 worker 完成，没有单独的服务。对每个做了镜像的仓库，它执行以下步骤：

1. **首次填充。** worker 记下源的更改源的当前位置。然后按页读取制品、包和文件路径的列表，并使仓库镜像与之保持一致。
2. **跟随。** worker 读取源的更改源。追平之后，它每 10 秒检查一次。每应用一项更改，它都会保存自己的位置。
3. **复制文件。** 文件按分片复制。worker 检查每个分片和整个文件的 SHA-256。中断之后，它从第一个缺失的分片继续。分片在等待期间存放在镜像端存储目录内的 `mirror-staging` 中。
4. **出错之后。** worker 在暂停之后重复该步骤，暂停从 2 秒开始，每次翻倍，最长 5 分钟。一个失败的仓库镜像不会使其他仓库镜像停止。

一个安装最多可以有 64 个做了镜像的仓库。副本会计入容量限制和镜像端的磁盘，因此请规划与源仓库相同的空间。参见[存储](./storage)。

如果源的密钥被撤销，或源无法访问，仓库镜像会继续提供它已有的内容，并在状态中显示错误。

## 检查同步状态 {#status}

### 在控制台中 {#status-console}

把镜像端的控制台连接到做了镜像的仓库。目录上方的徽标显示状态：

- [[ui:mirrorBadge]] 表示仓库镜像已追平。
- [[ui:mirrorBehind]] 表示它仍在复制，或尚未开始。
- [[ui:mirrorFailing]] 表示上一次尝试失败。下载仍然可用。

打开徽标的帮助（[[ui:mirrorHelpLabel]]），可以查看源、上次同步的时间和错误代码。控制台会在做了镜像的仓库中隐藏上传和更改按钮。

### 使用 API {#status-api}

[getRepositoryMirror](../api/reference/mirrors#getRepositoryMirror) 返回仓库的状态。它需要有读取该仓库的权限。对于普通仓库，响应为 404。

| 字段                             | 含义                                                              |
| -------------------------------- | ----------------------------------------------------------------- |
| `mode`                           | `mirror` 或 `import`                                              |
| `phase`                          | `pending`（worker 尚未开始）、`seeding`（首次填充）或 `following` |
| `caughtUp`                       | 保存的位置等于源的最新位置时为 `true`。首次填充结束之前为 `null`  |
| `checkedAt`、`syncedAt`          | worker 上次读取更改源的时间，以及上次追平的时间                   |
| `copiedArtifacts`、`copiedBytes` | 到目前为止复制的总量（`copiedBytes` 是十进制字符串）              |
| `errorCode`、`errorAt`           | 某个步骤最近一次失败的信息，或 `null`                             |

### 错误代码 {#error-codes}

| `errorCode`             | 含义和处理方法                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `mirror_mismatch`       | 同一个制品 ID 在源上的内容不同。仓库镜像保留自己的文件。请调查该制品；在查明原因之前，不要删除任何一份副本                           |
| `mirror_source_changed` | 该仓库已经保存了另一个源的副本。请分离它，或把新的源镜像到新的仓库中                                                                 |
| `mirror_source_behind`  | 源已被恢复或重新安装，它的更改源落后于仓库镜像。仓库镜像会重新读取它，追平之后该代码会清除。恢复后的源所缺少的文件会保留在仓库镜像上 |
| `mirror_delete_blocked` | 源删除了一个镜像端无法删除的文件，因为这里仍有内容在使用它，例如引用或文件路径历史记录                                               |
| `mirror_failed`         | 没有更具体代码的失败。请查看 worker 日志                                                                                             |
| 其他代码                | 失败请求的代码，例如密钥被撤销时的 `unauthorized`，或仓库镜像已满时的 `capacity_exceeded`                                            |

worker 日志（`component` 为 `mirror`）包含 `mirror.started`、带有 `errorCode` 和 `attempts` 的 `mirror.step_failed`、`mirror.recovered` 和 `mirror.stopped`。

## 监控仓库镜像 {#monitoring}

镜像端的 API 为每个做了镜像的仓库提供三项指标，带有标签 `repository` 和 `mode`：

- `arkvory_mirror_last_sync_timestamp_seconds`：仓库镜像上次追平的时间。
- `arkvory_mirror_last_check_timestamp_seconds`：上次读取更改源的时间。
- `arkvory_mirror_failing`：上一次尝试失败时为 1。

现成的 Prometheus 规则是 `ArkvoryMirrorStale`（超过一小时未追平）和 `ArkvoryMirrorFailing`（失败持续 15 分钟）。参见[监控](./monitoring)。worker 尚未处理到的仓库镜像没有同步时间，因此在首次同步之前，过期规则不会触发。

## 按阶段导入 {#import}

使用 `--mirror-stages` 时，第二个安装上的仓库**不是**仓库镜像。它是一个普通的可写仓库，会接收源上带有其中某个阶段的版本。可用它把构建从开发服务器移到生产服务器。

```bash
sudo arkvory configure --root /opt/proanima-arkvory \
  --mirror releases --mirror-upstream https://dev.example \
  --mirror-token-file /root/dev.key --mirror-stages release
```

- 列出 1 到 16 个不同的阶段名称，用逗号分隔。
- 版本只复制一次，其 ID、字节内容、标签和 UPack 注册信息都相同，并带有相应的阶段。
- 之后它就归此安装所有。源上的更改、阶段移除和删除都不会传到这里。您在这里删除的版本不会再次被导入。
- 仓库的上传和存储策略照常工作。
- 容器镜像、Git LFS 和 npm 注册表的数据不会被带过来。
- 更改阶段会开始新一轮首次填充。它只会添加，并跳过已有的内容。

控制台显示徽标 [[ui:mirrorImport]]，上一次尝试失败时显示 [[ui:mirrorImportFailing]]。源上的密钥需要与仓库镜像相同的只读权限。

## 源丢失时的故障切换 {#failover}

这是针对两个站点上两个独立安装的手动切换，不是自动的。仓库镜像尚未拉取的更改会丢失。

### 提前准备 {#failover-prepare}

1. 尽可能使用与源相同的发行版安装第二站点，使用它自己的 PostgreSQL 和自己的磁盘。两个站点不共享任何东西。
2. 在源上创建只读密钥，并把每个仓库都作为仓库镜像连接。之后在源上创建的仓库不会自行出现在镜像端，因此请以同样的方式连接它。
3. 在镜像端，签发使用方将要使用的密钥，包括切换之后可以写入的密钥。源的权限不会带过来，所以被攻破的源不会让人获得镜像端的访问权限。
4. 给使用方（CI、部署代理）配置镜像端的地址，作为下载的备用地址。这也能减轻通往源的链路的负载。
5. 把源备份到其站点之外的备份存储中。参见[备份](./backups)。仓库镜像不能取代备份。
6. 用上述规则监控仓库镜像。

### 切换 {#failover-switch}

1. 确认源对客户端确实不可用，并且不会自行恢复。两个站点如果同时接受对同一个逻辑仓库的写入，之后无法合并。如果源部分可达，请停止它的服务或关闭它的端口。
2. 在镜像端，读取每个仓库的 `syncedAt`。该时间之后在源上做的更改不在镜像端。
3. 在镜像端分离每个做了镜像的仓库。它会变成一个普通的可写仓库，制品 ID 和所有数据都保持不变。

   ```bash
   sudo arkvory configure --root /opt/proanima-arkvory --mirror-detach releases
   ```

   该命令会重启 API 和 worker，因此会出现短暂中断。

4. 通过 DNS 或您的 CI 配置，让写入的客户端指向镜像端。
5. 在镜像端上传并下载一个对照文件。

客户端看到的情况：

- 切换之前，从镜像端下载正常，写入会收到 409 `mirror_read_only`。
- 分离之后，写入可以进行。徽标消失。
- 源的密钥和密码在镜像端无效，除非您在那里创建了相同的账户。

没有回头路。不要把已分离的仓库再次作为仓库镜像连接。若要让旧的源恢复，请清空它或重新安装，然后把新主站点的仓库作为仓库镜像连接。切勿让旧的源和新的主站点在都启用写入的情况下并行运行。

### 演练 {#failover-rehearse}

请每个季度以及更新之后演练一次切换。在备用副本上分离一个仓库，检查 `syncedAt`、一次下载和一次上传，并记下日期和结果。另外请单独测试把源的备份恢复到空安装中。参见[定期测试恢复](./backups#test-restore)。

## 限制 {#limits}

- 仓库镜像在分离之前是只读的。已分离的仓库不能再变回仓库镜像。
- 仓库镜像不是备份。它没有账户、密钥或授权的副本，也不复制引用、附件、审计记录或存储策略。
- 导入模式不复制容器镜像、Git LFS 或 npm 数据。
- 同步只会添加和更新。源恢复之后，源所丢失的文件仍会保留在仓库镜像上。
- 两个安装各自独立更新。源必须提供仓库镜像的更改源。
- 源所信任的颁发机构集合作用于整个 worker。
- 没有自动故障切换，没有对旧源的隔离（fencing），也没有反向同步。

## 相关页面 {#related-pages}

- [备份](./backups)
- [读取网关](./read-gateways)
- [存储](./storage)
- [监控](./monitoring)
- [环境变量](../reference/environment#mirrors)
- [账户与访问](../use/accounts)
