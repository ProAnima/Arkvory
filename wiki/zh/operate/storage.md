---
title: 存储
description: '规划磁盘空间，为每个仓库设置配额和保留策略，在不停止服务器的情况下释放空间，并在磁盘写满时做出应对。'
---

# 存储

Arkvory 把每个已发布的文件原样保存一份，存放在服务器本地磁盘上的存储目录中，也可以存放在[更多卷](#volumes)上。本页说明哪些内容占用磁盘空间、如何用配额和保留策略限制它、已删除的文件如何离开磁盘，以及磁盘写满时该怎么做。

## 内容所在位置 {#location}

存储目录由 `ARKVORY_DATA_DIR` 设置。安装程序使用以下位置：

| 安装方式       | 存储                                           |
| -------------- | ---------------------------------------------- |
| Windows        | `C:\ProgramData\ProAnima\Arkvory` 中的 `data\` |
| Linux          | `/opt/proanima-arkvory` 中的 `data/`           |
| Docker Compose | Docker 卷 `proanima-arkvory_storage`           |

在它内部，`blobs/` 保存完成的文件，`staging/` 和 `parts/` 保存进行中的上传，文件 `storage-id` 将目录与数据库绑定。包含所有名称、标签、版本和权限的目录数据存放在 PostgreSQL 中。文件与数据库属于一体。

- 使用支持硬链接的本地文件系统。不要将网络共享用于存储。
- 不要手动在目录中添加、更改或删除文件。Arkvory 会自行删除文件，如下所述。
- 已发布的文件绝不会更改。新内容是具有新 ID 的新文件。

## 多个卷 {#volumes}

你可以为 Arkvory 添加更多存储目录，例如放在第二块磁盘上，而不必扩展一个卷。每个额外的目录都是内置模块 `local-storage` 的一个实例，并有自己的 ID。`ARKVORY_DATA_DIR` 的存储目录始终是实例 `default`。

在模块文件中配置实例（`ARKVORY_MODULES_FILE`，参见[环境变量](../reference/environment)）：

```json
{
  "format": 1,
  "modules": {
    "local-storage": {
      "enabled": true,
      "config": {
        "instances": {
          "volume-2": { "directory": "/srv/arkvory-volume-2" }
        }
      }
    }
  }
}
```

| 字段            | 含义                                                                           | 默认值                          |
| --------------- | ------------------------------------------------------------------------------ | ------------------------------- |
| `directory`     | 目录的绝对路径。它不能包含存储目录或其他实例，也不能位于它们内部               | 必填                            |
| `acceptsWrites` | `false` 会停止向此卷的新上传。卷上的文件仍可读取，已经在其上开始的上传可以完成 | `true`                          |
| `mode`          | `read-only` 只提供下载和检查，拒绝所有写入和删除，例如用于以只读方式挂载的卷   | `full`                          |
| `enabled`       | `false` 会关闭该卷：在你再次启用它之前，其中的文件无法下载                     | `true`                          |
| `reserveBytes`  | 在此卷上保留的可用空间，以字节为单位                                           | `ARKVORY_STORAGE_RESERVE_BYTES` |

ID 由小写字母、数字和 `-` 组成，以字母开头，且不能是 `default`。最多可以添加 16 个实例。每个进程（API、读取网关、worker 和备份代理）都必须读取同一个模块文件：规划了不同实例的进程不会就绪。更改后请重新启动所有服务。

添加卷：

1. 挂载卷并创建目录。该目录必须属于运行服务的账户。Arkvory 不会创建此目录。如果目录不存在，例如因为卷未挂载，该卷会保持不可用，挂载点下面不会写入任何内容。
2. 把目录标记为新卷：`arkvory volume-init --directory /srv/arkvory-volume-2`。该命令不需要 `--root`。它拒绝不存在或非空的目录（只允许有 `lost+found`），并写入身份文件 `storage-id`。在 Linux 上，它还拒绝不是挂载点的目录，例如未挂载卷的空目录。对于已挂载卷内部的目录，请加上 `--no-expect-mount`。在 Windows 上，`--expect-mount` 会开启这项检查。服务从不创建此文件：没有该文件的卷保持不可用。
3. 把实例添加到模块文件中，然后重新启动服务。API 首次启动时会记录卷的身份，即目录中的文件 `storage-id`。此后每个进程都会检查此文件。未挂载的卷，或同一路径上的另一个卷，绝不会被写入。每次在该卷上写入或删除之前，都会再次检查此文件。
4. 用[放置策略](#placement)选择哪些上传进入该卷。

### 新上传的放置 {#placement}

仓库的放置策略为每个新上传选择存储。一条规则有一个 ID、一个存储（`backendId`）和两个可选条件：包组（`models/*`、`tools` 或 `*`）和以字节为单位的最小大小。第一条条件成立的规则生效。没有匹配时，上传进入 `default`。一个仓库最多可以有 32 条规则。

使用 `arkvoryctl` 或 API 操作 [getStoragePlacement](../api/reference/storage#getStoragePlacement) 和 [setStoragePlacement](../api/reference/storage#setStoragePlacement) 读取和更改策略：

```bash
arkvoryctl storage placement --repository releases
arkvoryctl storage placement --repository releases --revision 0 --file rules.json
```

文件 `rules.json` 包含规则列表，例如把所有 1 GiB 及以上的文件放到 `volume-2`：

```json
[{ "id": "large", "backendId": "volume-2", "packageGroup": null, "minSizeBytes": "1073741824" }]
```

- 读取策略需要 `storage.read`，更改策略需要 `storage.manage`。响应还会列出每个存储及其状态：`accepting`、`not_accepting`、`read_only`、`disabled`、`unavailable` 或 `not_loaded`。
- 规则只能指定已配置的存储。其他名称会以 400 `backend_unknown` 被拒绝。
- 策略保存时会带有修订版本。如果其他人更改了它，请重新读取并再次保存。
- 更改只适用于新上传。已经存储的文件保留在原处；要移动它们，请参见[将已存储的文件移动到另一个卷](#rehome)。

### 卷不接受新上传时 {#placement-fallback}

发布绝不会因为放置而失败。如果所选存储此时不接受上传，原因是 `acceptsWrites: false`、`read-only`、`enabled: false`、缺少实例，或卷不可用（未挂载、身份检查失败、无应答），新上传会改为在 `default` 中创建。上传在 `storageBackend` 中显示其存储，指标 `arkvory_storage_placement_fallback_total` 会计数，日志中有一行 `storage.placement_fallback`。

- **进行中的上传不会移动。** 如果某个分片上传正在一个卷上进行时，该卷停止接收数据，新的分片会以 409 `backend_read_only` 被拒绝，客户端会开始新的上传。如果所有分片都已到位，完成上传时会把文件写入 `default`。分片从它们所在的卷读取。被中断的尝试已经完整保存在该卷上的文件会留在那里。
- **不可用的卷**会使其文件的下载以 503 `unavailable` 失败，直到它恢复。服务器继续运行，就绪状态和 `writable` 只跟随 `default`。每个进程每 30 秒重新检查一次自己的卷。
- **清理**会在保存文件的卷上删除每个文件，包括留在另一个卷上的分片。在不可用或只读的卷上，清理会跳过该文件，稍后再试。
- **配额和限制。** 配额和 `ARKVORY_CAPACITY_BYTES` 把所有卷合并计算。预留空间适用于每个卷。
- raw、OCI 和镜像上传的**临时文件**保留在存储目录 `default` 中。
- **集群。** 在[高可用集群](./cluster)中，每个卷都必须像存储目录一样，是复制卷上的一个目录：另一块磁盘不会被复制到其他服务器。否则 API 不会启动。
- **从配置中移除的卷。** Arkvory 会记住每个存过数据的卷。如果某个卷不再出现在模块文件中，它的文件就无法下载、清理或备份：备份会以 `blob_missing` 失败。每个进程都会通过指标 `arkvory_storage_backend_unconfigured`、日志行 `storage.backend_unconfigured` 和告警 `ArkvoryStorageVolumeUnconfigured` 报告它，放置策略的应答会以状态 `not_loaded` 列出它。要修复，请重新配置它。要让卷退役，请设置 `acceptsWrites: false`，把它的文件[移动](#rehome)到另一个卷，并在移动完成之前保留其配置。

请关注 `arkvory_storage_backend_up` 和 `arkvory_storage_backend_accepting`，参见[监控](./monitoring#metrics)。备份会复制每个卷。恢复需要为每个卷准备一个空目录，参见[恢复多个卷](./backups#restore-volumes)。

### 将已存储的文件移动到另一个卷 {#rehome}

要移动已经存储的文件，例如让某个卷退役或填充一个新卷，请在服务器上规划移动。服务会继续运行。

```bash
arkvory storage rehome --root /opt/proanima-arkvory --from volume-2 --to default
arkvory storage moves --root /opt/proanima-arkvory
```

1. `rehome` 为 `--from` 存储中的每个已发布文件规划一次移动，并输出规划的数量以及按状态统计的移动。`--repository <name>` 将其限制在一个仓库内，`--limit <n>` 限制文件数量（默认 10 000，最多 100 000）。已有移动正在进行的文件不会被再次规划。两个存储都必须已配置。目标必须接受新上传，否则命令以 `backend_read_only` 失败。源可以是只读的。
2. worker 执行移动，每次两个。对每个文件，它把字节复制到目标并检查大小和 SHA-256，将文件切换到目标，然后删除源中的副本。文件保留其 ID：链接、路径、阶段和引用都保持有效。
3. `moves` 按状态输出移动：`planned`、`copied`、`switched`、`released`（已完成）、`skipped`（文件在此期间已被删除；它在目标中的副本已被移除）和 `failed`。

- **下载和备份。** 在切换之前开始的下载会从源一直读到结束。只有在该下载以及所有包含该文件的备份完成之后，源中的副本才会被删除。删除会等待；它绝不会阻塞下载。
- **失败。** 失败的步骤会以逐渐增长的间隔重试。失败 5 次之后，或者当目标停止接受上传时，移动变为 `failed`，文件留在原处。再次运行 `rehome` 以规划新的移动。下一次移动会检查并复用失败的移动留在目标中的副本。这只适用于切换之前：切换之后移动不会变为 `failed`，删除源副本会一直重试直到成功。当存储不可用或只读时（例如被撤离的源存储），该步骤会等待它，并每 5 分钟重新检查一次。
- **速度。** `ARKVORY_REHOME_BYTES_PER_SECOND` 限制 worker 的复制速度。默认不限制。
- **配额**对每个文件只计算一次，无论是在移动期间还是之后。
- 使用 Docker Compose 时，该命令会运行一个一次性的 worker 容器。

worker 会写入日志行 `storage.move_completed`、`storage.move_skipped` 和 `storage.move_failed`。

## 规划磁盘 {#disk}

以下内容会占用存储卷上的磁盘空间：

| 内容                 | 说明                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------- |
| 已发布的文件         | 你保留的所有版本                                                                        |
| 进行中的上传         | 分片和暂存文件，直到上传结束                                                            |
| 已完成上传的分片文件 | 临时分片会留在完成文件旁边，直到一次物理清理将其移除。参见[物理清理](#physical-cleanup) |
| 已删除的文件         | 它们会留在磁盘上，直到宽限期结束且一次清理将其移除                                      |
| 镜像副本             | 镜像复制文件期间 `mirror-staging` 中的一个分片。参见[镜像](./mirrors)                   |

除存储之外，如果可能，请为 PostgreSQL 数据库、日志和备份存储规划各自的卷。参见[备份](./backups)。

Arkvory 在存储卷上预留一份可用空间。默认是 1 GiB（`ARKVORY_STORAGE_RESERVE_BYTES`）。会动用该预留的上传会被拒绝，返回 HTTP 507 和原因 `storage_full`。下载继续工作。在没有空间容纳新数据期间，`GET /health/ready` 显示 `writable: false`。

Arkvory 还会在每个卷上保留 100 000 个空闲 inode（`ARKVORY_STORAGE_RESERVE_INODES`）：每个已存储的文件和每个分片都是一个文件，因此卷可能在字节用完之前先用完 inode。会动用这些 inode 的写入会以同样的方式被拒绝。没有 inode 计数的文件系统（例如 NTFS）只检查字节。

有两个限制独立于磁盘运行：

- `ARKVORY_CAPACITY_BYTES` 限制安装实例预留的所有内容。默认是 10 TiB。它是逻辑限制，不是对磁盘的检查。达到时，上传失败，返回 HTTP 507 和原因 `catalog_limit`。
- `ARKVORY_MAX_OBJECT_BYTES` 限制单个文件的大小。

参见[环境变量](../reference/environment#storage-and-limits)。Arkvory 没有针对存储或数据库可用空间的指标。请使用操作系统工具或 node exporter 监控这些卷。

## 谁可以管理存储 {#permissions}

存储设置不属于常规的读写权限。服务密钥需要对仓库具有明确的动作：

| 动作               | 允许                                               |
| ------------------ | -------------------------------------------------- |
| `storage.read`     | 查看策略、用量、清理设置和放置                     |
| `storage.manage`   | 更改策略、配额、清理设置和放置，并请求一次清理批次 |
| `artifact.delete`  | 预览删除、删除制品，并开启自动保留策略             |
| `diagnostics.read` | 读取存储事件                                       |

带密码的账户和恢复密钥本身不具备这些权限。要在控制台中管理存储：

1. 创建一个服务账户，并为该仓库配置包含这四个动作的策略。参见[账户与访问](../use/accounts)。
2. 为它签发并激活一个密钥。
3. 在控制台中打开 [[ui:keySignIn]]，粘贴密钥并选择 [[ui:connect]]。
4. 打开 [[ui:repositories]]，在仓库卡片上选择 [[ui:repositoryStorage]]。

面板 [[ui:storageTitle]] 会出现在目录上方。没有权限时，该面板保持隐藏。

已启用的保留策略与**启用它的密钥**绑定。每次自动运行都会再次检查该密钥是否仍然有效、未过期，并且仍具有 `storage.manage` 和 `artifact.delete`。如果你撤销该密钥或收窄其权限，删除会停止并出现事件 `retention.failed`。轮换密钥后，请使用新密钥再次保存该策略。

## 配额与警告阈值 {#quotas}

仓库可以有配额。没有配额时，只应用全局限制。

| 设置     | 控制台字段                    | 含义                                                                                       | 默认值 |
| -------- | ----------------------------- | ------------------------------------------------------------------------------------------ | ------ |
| 配额     | [[ui:storageQuota]]           | 仓库可使用的最大空间。API 接受精确字节数，从 1 到 9 007 199 254 740 991，`null` 表示无限制 | 无限制 |
| 警告阈值 | [[ui:storageWarningPercent]]  | 触发警告的配额占比。1–98                                                                   | 80     |
| 严重阈值 | [[ui:storageCriticalPercent]] | 触发错误的占比。2–99，高于警告阈值                                                         | 95     |

计入配额的用量是仓库中所有尚未从磁盘移除的文件大小：已发布的文件、未完成的上传，以及等待清理的已删除文件。因此，已删除的文件在被一次清理移除之前仍然占用配额。

- **检查。** 服务器在上传开始时检查配额。会超出配额的新上传失败，返回 HTTP 507 和原因 `storage_quota`。使用相同幂等键的重试不会重复预留空间。
- **调低。** 你可以把配额设到低于当前用量。正在运行的上传可以完成。超出限制的新上传会被拒绝。
- **不会自动释放。** 配额绝不会导致删除。保留策略不会为了满足配额而移除额外的构建。
- **状态。** 状态为 `unlimited`、`normal`、`warning`、`critical` 或 `exceeded`。状态变化会作为一次存储事件记录一次。
- **监控。** 服务器每分钟重新检查最多 20 个仓库的状态，在自动删除关闭时也是如此。

这些数字是逻辑预留，不是可用磁盘空间。仓库可能在其配额以内，而磁盘却已满，因为磁盘还保存着暂存文件和其他仓库。

## 保留策略 {#retention}

保留策略会自动删除旧的**已注册 UPack 构建**并保留最近 N 个。它不会删除其他文件：按路径访问的普通文件、容器镜像、Git LFS 对象和 npm 包不在其范围内。没有策略时，不会自动删除任何内容。

### 设置 {#retention-settings}

| 设置       | 控制台字段              | 含义                                                                                     | 默认值                                |
| ---------- | ----------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------- |
| 启用       | [[ui:storageEnabled]]   | 开启自动删除                                                                             | 关闭                                  |
| 分组       | [[ui:storageGrouping]]  | 计数的单位：[[ui:storagePerChannel]]、[[ui:storagePerPackage]] 或 [[ui:storageGlobal]]   | 包和渠道                              |
| 最近 N 个  | [[ui:storageKeep]]      | 每个计数器保留多少个构建，1–100 000                                                      | 10                                    |
| 渠道       | [[ui:storageChannels]]  | 为某个标签单独设置 N，格式为 `label=N`，每行一个，最多 32 个。仅与分组“包和渠道”一起使用 | `test=10`、`staging=10`、`release=10` |
| 最小年龄   | [[ui:storageAge]]       | 比此更年轻的构建会保留，以小时计，0–87 600                                               | 24                                    |
| 受保护标签 | [[ui:storageProtected]] | 带有其中任一标签的构建绝不会被删除，最多 32 个，以逗号分隔                               | `bse`、`release`                      |
| 间隔       | [[ui:storageInterval]]  | 两次运行之间的分钟数，1–10 080                                                           | 60                                    |

标签为 1 到 64 个字母、数字或字符 `_ . : -`。

### 如何选择构建 {#retention-rules}

1. 服务器按**发布时间**对每个计数器的构建排序，最新的在前。该顺序不是版本的 SemVer 顺序。
2. 计数器取决于分组。使用“包和渠道”时，构建会针对它携带的每个已配置渠道标签分别计数，按包（`group/name`）计算。没有已配置标签的构建会进入该包的一个共享计数器，使用默认 N。使用“包”时，每个包有一个计数器。使用整个仓库时，所有构建共享一个计数器。包名忽略大小写，标签不忽略。
3. 如果构建属于其所属的**任一**计数器的最近 N 个，它就会被保留。
4. 比最小年龄更年轻的构建会保留。
5. 带有受保护标签的构建会保留。它的标签来自当前注解，或在没有注解时来自上传。受保护的构建仍然参与排序，因此保留的数量可能高于 N。

当仍有东西需要某个构建时，它绝不会被删除：

- 外部服务持有对它的引用。
- 某个文件路径（当前或来自历史记录）使用它。
- 另一个构建（现在或历史记录中）将它列为附件。
- 它被晋级到某个阶段。请先移除该阶段。
- 某个容器镜像、Git LFS 或 npm 条目使用它。

删除构建是逻辑上的：它会离开列表，新的下载会以 404 失败。字节稍后在[物理清理](#physical-cleanup)中离开磁盘。包版本保持预留，因此同一版本无法再以其他内容发布。

### 安全地启用策略 {#retention-enable}

先预览，再启用。预览会显示已保存的策略将删除什么，并且不会删除任何内容。

1. 使用具有这四个动作的密钥连接，并打开该仓库的存储面板。
2. 设置各字段，让 [[ui:storageEnabled]] 保持关闭。选择 [[ui:storageSave]]。
3. 选择 [[ui:storagePreview]]。列表显示已保存的策略在一次批次中将删除的最多 100 个构建。如果还有更多候选，控制台会说明。
4. 如果列表正确，勾选 [[ui:storageEnabled]] 和确认项 [[ui:storageAcknowledge]]，然后再次保存。这需要 `artifact.delete`。

说明：

- 预览显示的是某一时刻。策略运行时，它会重新排序并再次检查依赖关系。
- 策略保存时会带有修订版本。如果其他人更改了它，请重新加载并再次保存。
- [[ui:storageRefresh]] 会重新加载设置和用量。

### 如何运行 {#retention-run}

负责写入的 API 进程（不是读取网关）每 60 秒检查一次，并处理最多 20 个到期的策略。一个批次最多删除 100 个构建。如果还有候选，下一个批次在一分钟后开始。否则下一次运行在间隔之后到来。计划保存在数据库中，重启后仍然存在。

你也可以通过 API 操作 [runStoragePolicy](../api/reference/storage#runStoragePolicy) 自行运行一个批次。用量、预览和事件在同一个[存储 API 参考](../api/reference/storage)中有对应的操作。

## 物理清理 {#physical-cleanup}

删除制品（由人或策略执行）只会将它从目录中移除。**物理清理**会在后台把它的字节从磁盘移除，不停止 API、工作进程或读取网关。它还会：

- 取消已过期但未完成的上传，并移除它们的分片。
- 移除已完成上传的临时分片。

它不选择要删除的构建。它只移除已经删除或取消的内容。

**物理清理默认关闭，并且按仓库设置。** 请在你使用的每个仓库中开启它。在此之前，已删除的文件、过期的上传以及已完成上传的分片都会留在磁盘上，并且配额会把已删除的文件计入。

### 设置 {#cleanup-settings}

在仓库的面板中，打开 [[ui:cleanupTitle]]：

| 设置   | 控制台字段             | 含义                                     | 默认值 | 范围     |
| ------ | ---------------------- | ---------------------------------------- | ------ | -------- |
| 启用   | [[ui:cleanupEnabled]]  | 开启后台清理                             | 关闭   |          |
| 宽限期 | [[ui:cleanupGrace]]    | 已删除文件在磁盘上保留多长时间，以小时计 | 24     | 0–8760   |
| 批次   | [[ui:cleanupBatch]]    | 一个批次处理的文件数                     | 25     | 1–100    |
| 间隔   | [[ui:cleanupInterval]] | 批次之间的秒数                           | 60     | 5–86 400 |
| 延迟   | [[ui:cleanupDelay]]    | 文件之间的暂停毫秒数                     | 50     | 0–1000   |

选择 [[ui:cleanupSave]] 以应用它们。更改立即生效。如果你关闭清理，它会在当前文件之后停止。[[ui:cleanupRun]] 会请求尽快执行一个批次，它不会立即删除。选择 [[ui:cleanupRefresh]] 查看上一个批次的结果。

宽限期不是回收站。值为 0 时，文件一旦被删除且没有读取者打开它，就可以立即离开。Arkvory 无法恢复已删除的制品。

### 清理会做什么、会跳过什么 {#cleanup-rules}

- 它只移除已取消或已删除且超过宽限期的文件。它会再次检查没有东西使用它们：没有引用、文件路径历史记录或附件历史记录。
- 正在进行的下载、正在写入的上传，以及正在运行的备份所需的文件，会让清理**跳过**该文件。下一个批次会再次尝试。上一次结果会显示它处理、跳过和失败了多少文件，以及释放了多少字节。
- 配额和逻辑容量只有在文件从磁盘移除后才会释放。
- 批次受批次大小和延迟限制，这会降低磁盘负载。它不保证严格的磁盘吞吐量，也无法承诺对其他请求的延迟零影响。
- 清理在写入端 API 中运行，每个数据库一次。写入端每 5 秒检查一个到期的仓库。没有正在运行的写入端，就不会清理任何内容。
- 只有在更新了每个 Arkvory 进程（包括网关和工作进程）之后，才启用清理。没有清理协议的旧进程会让清理推迟它的工作。

## 删除制品 {#delete-artifacts}

你可以手动删除一个已发布的制品。你需要对该仓库具有 `artifact.delete`。

1. 在 [[ui:metadata]] 中打开该制品，找到 [[ui:deletionTitle]]。
2. 选择 [[ui:deletionInspect]]。控制台会显示仍有谁在使用该制品。如果有东西阻止删除，你必须先移除该依赖。
3. 粘贴该制品的 ID 以确认，然后选择 [[ui:deletionSubmit]]。

以这种方式删除不会检查受保护标签，因为对象是你自己选择的。依赖关系始终会被检查。删除之后：

- 制品会离开列表和搜索结果。新的下载以 404 失败。已经在运行的下载可以完成。
- 包版本保持预留。
- 字节会留在磁盘上，直到[物理清理](#physical-cleanup)在宽限期后移除它们。
- 你无法在控制台或 API 中撤销它。

对于大量制品，API 提供 [previewRetention](../api/reference/storage#previewRetention) 和 [applyRetention](../api/reference/storage#applyRetention)。预览会列出在某个日期之前发布的候选及其阻止原因。应用只删除你传入的 ID，每次调用最多 100 个，并为每个 ID 返回结果：`deleted`、`already_deleted`、`protected`、`changed`、`not_eligible` 或 `not_found`。请检查每个结果，而不仅仅是 HTTP 状态。

## 存储诊断与事件 {#diagnostics}

[[ui:storageEvents]] 部分列出仓库中发生的事件，最早的在前，每页 100 个。选择 [[ui:storageMore]] 查看下一页。读取它需要 `diagnostics.read`。API 操作是 [getStorageEvents](../api/reference/storage#getStorageEvents)，可按级别（`info`、`warning`、`error`）过滤。

| 事件                                                                                                  | 级别                   | 含义                                                           |
| ----------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------- |
| `storage.policy_updated`                                                                              | info                   | 保留策略已保存                                                 |
| `retention.completed`                                                                                 | info                   | 一个批次删除了构建。事件包含数量                               |
| `retention.failed`                                                                                    | error                  | 自动删除停止，例如因为授权密钥被撤销                           |
| `cleanup.configured`                                                                                  | info                   | 清理设置已保存                                                 |
| `storage.placement_updated`                                                                           | info                   | 放置策略已保存                                                 |
| `cleanup.completed`                                                                                   | info or error          | 一个清理批次处理、跳过或失败于某些文件。它列出数量和释放的字节 |
| `capacity.normal`、`capacity.warning`、`capacity.critical`、`capacity.exceeded`、`capacity.unlimited` | info、warning 或 error | 配额状态发生变化                                               |
| HTTP 错误码                                                                                           | warning 或 error       | 受管密钥对此仓库的一次请求失败。事件保留请求 ID、路由和状态    |

历史记录是有界的：每个仓库 1000 个事件，总共 20 000 个，最旧的会被丢弃。这是尽力而为的诊断，而不是保证投递的日志。请及时导出你需要的内容，并使用服务器日志作为长期证据。参见[监控](./monitoring)。

面板还会显示用量：已发布的字节、未完成的上传、等待清理的字节，以及相对于配额的总量。API 操作是 [getStorageUsage](../api/reference/storage#getStorageUsage)。

## 磁盘写满时 {#disk-full}

迹象：上传失败，返回 HTTP 507 和原因 `storage_full`，`GET /health/ready` 显示 `writable: false`，或者操作系统报告没有可用空间。下载继续工作。在你释放空间后，客户端可以续传它们的上传。

1. **找出原因。** 检查存储卷、数据库卷和备份存储卷的可用空间。比较存储面板中的用量数字。较大的“等待清理”数字意味着已删除的数据仍在磁盘上。较大的“未完成上传”数字意味着被放弃的上传。
2. **运行清理。** 如果清理已关闭，请在每个仓库中开启它，并使用较短的宽限期，例如 0（如果你接受已删除文件立即离开）。选择 [[ui:cleanupRun]]。它还会移除已完成上传的临时分片和过期的上传。等待各批次并读取上一次结果。清理会跳过正在使用的文件，因此请重复执行。
3. **删除你不需要的内容。** 应用保留策略，或删除制品。只有在清理移除字节之后，这才会释放空间。
4. **增加空间。** 扩展卷或磁盘。如果备份存储或其他数据与该卷共用，请把它们移出该卷。你也可以[添加一个卷](#volumes)，把新上传放到那里。
5. **检查恢复情况。** 空间释放后，`writable` 会恢复为 `true`，上传重新工作。

不要手动删除 `blobs/`、`staging/` 或 `parts/` 中的文件：这会破坏数据库与磁盘之间的联系。如果预留对你的日志和同一卷上的数据库来说太小，请提高 `ARKVORY_STORAGE_RESERVE_BYTES`。

如果上传反而以原因 `storage_quota` 或 `catalog_limit` 失败，那么问题不在磁盘。请提高配额或全局限制，或者删除数据。

## 限制 {#limits}

- 保留策略只处理已注册的 UPack 构建。它绝不会移除其他文件。
- 保留排序依据是发布时间，而不是版本号。
- 存储、配额和清理需要明确的服务密钥动作。密码账户和恢复密钥不具备它们。
- 物理清理默认关闭，并按每个仓库设置。
- 已删除的制品无法恢复。请从备份恢复数据。参见[备份](./backups)。
- 镜像仓库不运行存储策略。参见[镜像](./mirrors)。
- 存储必须是本地文件系统。不支持网络共享。额外的[卷](#volumes)也是本地目录。已存储的文件只能通过服务器上的命令 [`arkvory storage rehome`](#rehome) 在它们之间移动，不能通过 API。
- 在 Windows 上，Arkvory 会把每个文件同步到磁盘，但无法同步发布该文件的目录项：Node.js 在那里不提供目录同步。上传完成后不久断电，可能导致已发布的文件在磁盘上缺失。请使用 UPS，并保留[备份](./backups)或[镜像](./mirrors)。在 Linux 上，目录项也会同步。

签名存储模块可供离线 `scrub` 以只读模式访问。请保留已安装的模块及其配置。`storage rehome` 可以规划从已配置的模块存储迁移到普通存储；worker 会在复制前检查目标。已安装模块的计划必须与 writer 一致。运行 `scrub` 前请停止 API 和 worker。

## 相关页面 {#related-pages}

- [备份](./backups)
- [镜像](./mirrors)
- [监控](./monitoring)
- [故障排查](./troubleshooting)
- [环境变量](../reference/environment)
- [仓库](../use/repositories)
