---
title: 模块
description: 在主机上安装、启用、检查和移除已签名的模块包，并保存您信任的插件作者的密钥。
---

# 模块

模块包为 Arkvory 增加一项功能。Arkvory 只安装它能够验证签名的包。本页的命令在安装所在的主机上运行：Linux 上以 root 身份，Windows 上以管理员身份。控制台和 HTTP API 不能安装模块，也不能信任密钥，因此被盗的控制台管理员帐户无法在服务器上运行代码。

服务每次启动时都会重新检查并加载已安装的模块。模块只有在您启用后才会运行。

## 安装包 {#install}

1. 将包文件 `arkvory-module-<id>-<version>.tgz` 复制到主机。
2. 检查它并阅读其条款：

   ```bash
   sudo arkvory module install /root/arkvory-module-sample-1.0.0.tgz --root /opt/proanima-arkvory
   ```

   该命令显示模块、其角色、它保存的数据、签名密钥和包的 SHA-256，然后显示模块的条款。此时还不会做任何更改。

3. 安装它：

   ```bash
   sudo arkvory module install /root/arkvory-module-sample-1.0.0.tgz --root /opt/proanima-arkvory --yes
   ```

在以下情况下，Arkvory 会拒绝包：

| 原因                                                   | 消息中的代码                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| 签名不是来自 ProAnimaStudio 的模块密钥，或清单已被更改 | `unknown_key`、`wrong_key_class`、`signature_invalid`          |
| 文件缺失、被更改或未列在清单中                         | `file_missing`、`file_mismatch`、`file_unlisted`               |
| 归档包含链接、设备、包外的路径或仅大小写不同的名称     | `link_entry`、`special_entry`、`unsafe_path`、`case_collision` |
| 归档包含原生插件（`.node`）                            | `native_addon`                                                 |
| 模块需要另一个版本的 Arkvory                           | `module_incompatible`                                          |
| ProAnimaStudio 已撤销此版本                            | `module_revoked`，并给出替代版本                               |
| 没有有效的撤销列表（见下文）                           | `stale_revocations`                                            |

限制：每个包 1 GiB，每个文件 256 MiB，最多 4096 个文件。更大的包会在读取其数据之前被拒绝。

已以相同字节安装的版本保持不变。同一版本但字节不同则会被拒绝。

## 启用并加载模块 {#load}

已安装的模块在您启用之前保持关闭。服务只在启动时加载模块。

1. 将模块添加到模块文件（`ARKVORY_MODULES_FILE`，参见[环境变量](../reference/environment#core)）。模块的设置放在 `config` 中：

   ```json
   { "format": 1, "modules": { "sample": { "enabled": true } } }
   ```

2. 如果模块会保存文件，请用 `resources` 批准其数据目录的大小，例如在 `enabled` 旁边写 `"resources": { "dataMiB": 512, "dataFiles": 10000 }`。它会取代包所请求的大小。参见[模块的数据目录](#data)。
3. 按照[应用更改](../install/configuration#apply-change)重启服务。
4. 以全局管理员身份检查模块：`GET /api/v1/system/modules` 在 API 和每个读取网关上都显示它为 `running: true`，`health.status` 为 `ok`。

签名模块根据声明的角色在 API、读取网关、worker 和备份代理中运行。每个进程只提供适用于其角色且在 `uses` 中声明的服务。路由需要 `routes` 服务。Docker Compose 暂不加载模块。

模块存储以 `<module>.<name>` 注册，可用于新上传的存储选择。如果实例停止接受写入，新上传将回退到 `default`。核心在发布分块组装的对象前验证全部字节。模块数据清理会等待活动读取、所有备份固定记录以及捕获屏障解除。计算在受限线程中运行；订阅仅在处理成功后确认事件，失败后可能重复投递。

服务在导入模块的任何代码之前，会再次检查包：

1. 只有 root（Windows 上为 SYSTEM 和 Administrators）或安装目录的所有者可以更改安装目录、`modules/`、模块集、吊销列表及其所在目录。安装过程会这样设置。其他账户可以更改的文件以及包内的链接都会被拒绝（`access_unsafe`、`access_link`）。
2. 签名、每个文件和 Arkvory 的版本，与 `module install` 的检查相同。
3. 吊销列表。被吊销的版本永远不会加载。过期的列表或没有列表都不会停止模块。

未通过检查的模块不会加载；其他模块和 Arkvory 继续运行。`GET /api/v1/system/modules` 显示它为 `running: false`：

| `health.status` | 含义                             | 代码                                                                                                        |
| --------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `failed`        | 包被拒绝，或其代码未能加载或启动 | `file_mismatch`、`unknown_key`、`module_incompatible`、`access_unsafe`、`config_invalid`、`start_failed` 等 |
| `revoked`       | ProAnimaStudio 吊销了此版本      | 吊销列表中的原因                                                                                            |
| `unavailable`   | 主机上缺少包目录                 | `module_unavailable`                                                                                        |

只有当另一个已启用的模块需要失败的模块时，它才会使 Arkvory 退出就绪状态（`/health/ready` 返回 503 和 `module_failed`）。保存已发布文件字节的模块（数据 `layout`）永远不会这样：Arkvory 继续提供其数据，并把新的上传写入自己的存储而不是模块的存储。日志会记录 `module.refused` 和 `module.failed`，代码在 `errorCode` 中。

要修复被更改或缺失的包，请重新安装它。安装的所有服务必须看到相同的模块，无论是否启用：模块不同的读取网关或 worker 不会就绪（`module_plan_mismatch`）。请在每个读取网关的主机上安装相同的包。

### 模块的数据目录 {#data}

保存自有索引、缓存或状态的模块会在数据卷上获得一个目录：`default` 存储目录中的 `module-data/<id>/`。其中 `data` 部分用于备份，`cache` 部分则不用于备份。Arkvory 把每次写入都计入批准的大小，以 MiB 和文件数计算，两部分合计。超出该大小的写入会被拒绝（`module_quota_exceeded`），模块继续运行。没有批准的大小时，模块只能读取。[卷的预留空间](./storage#disk)同样适用。在读取网关上，模块读取相同的文件，但不能更改它们。

移除模块时会保留其目录。不再需要这些数据时，请自行删除 `module-data/<id>/`。备份目前还不包含模块目录。

升级到 extension API 0.7.0 前，请停止所有写入模块数据的旧版 API 和 worker 进程。新版写入进程通过安装实例的 PostgreSQL 协调器共享配额核算；临时文件也计入配额。不支持新旧进程混合写入。崩溃后，Arkvory 会按需重建核算，并且只有取得前任所有者的数据库锁后，才会回收新协议的临时目录。旧版临时文件不会自动删除，仍计入配额；请在停止写入进程后单独检查这些文件。backup 进程只有读取权限。

## 模块的路由 {#routes}

模块可以在自己的前缀 `/api/ext/<id>/v<major>/` 下添加 HTTP 路由，例如 `/api/ext/sample/v1/`。在模块的任何代码运行之前，Arkvory 会检查每个请求：

| 检查   | 与 `/api/v1` 相同                                                                                                    |
| ------ | -------------------------------------------------------------------------------------------------------------------- |
| 凭据   | 相同的密钥、会话和令牌；路由对任何已登录的调用方开放，或仅对全局管理员开放                                           |
| 权限   | 路由针对其路径中的仓库指定的权限，例如 `content.read` 或 `upload.create`：服务密钥需要该权限，账户需要读取或写入授权 |
| 请求体 | 路由的大小限制，以及服务器的上传限制、期限和带宽                                                                     |
| 文件   | 由 Arkvory 自己发送：ETag、Range、`If-Range`、304、下载队列和下载带宽                                                |

错误采用 API 的错误格式。模块永远看不到凭据和其他标头。读取网关提供模块的读取路由，对其他路由回答 `read_only`。

每个模块都用 OpenAPI 文档描述自己的路由，Arkvory 在模块启动时比对两者。路由违反规则的模块不会启动，也不提供任何内容；Arkvory 继续运行。`GET /api/v1/system/modules` 显示它为 `running: false` 和 `health.status` `failed`：

| 代码                     | 含义                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| `routes_invalid`         | 路由违反规则，例如路径在模块前缀之外，或对任何已登录调用方开放的更改 |
| `openapi_invalid`        | OpenAPI 文档缺失或无效                                               |
| `openapi_route_mismatch` | 某个路由在文档中没有操作，或某个操作没有路由                         |
| `transfer_invalid`       | 模块提供了它不允许提供的传输协议                                     |

路由的文档：

| 地址                                                                                        | 谁可以读取         | 内容                                                 |
| ------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------- |
| `GET /api/ext/openapi.json`                                                                 | 任何已登录的调用方 | 此服务运行的所有模块的路由，只含调用方可以调用的操作 |
| [`GET /api/v1/system/modules/{id}/openapi`](../api/reference/system#getSystemModuleOpenApi) | 全局管理员         | 单个模块的路由                                       |

`/api/v1/openapi.json` 从不列出模块的路由。类型为 `transfer` 的模块可以提供另一种传输文件的方式：`GET /api/v1/capabilities` 在 `transfer` 中列出它。客户端只有在拥有匹配的扩展时才使用它，否则照常传输文件。

## 更新、固定和降级 {#versions}

使用 `--yes` 安装新版本的文件。之前的包会保留在主机上，直到下一次模块更改。

| 任务             | 命令                                                            |
| ---------------- | --------------------------------------------------------------- |
| 保持已安装的版本 | `sudo arkvory module pin sample 1.0.0 --root …`                 |
| 重新允许其他版本 | `sudo arkvory module pin sample --unpin --root …`               |
| 安装更旧的版本   | `sudo arkvory module install <file> --downgrade --yes --root …` |

已固定的模块会拒绝任何其他版本，直到您取消固定。 比已安装版本更旧的版本，或比已移除但其软件包仍在主机上的版本更旧的版本，需要 `--downgrade`。

## 检查已安装的模块 {#list}

```bash
sudo arkvory module list --root /opt/proanima-arkvory
```

该命令会重新验证每个已安装的包，与服务在加载它之前所做的相同：签名、每个文件和归档。每个模块显示一个状态：

| 状态                 | 含义                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| `ok`                 | 包完好无损                                                                            |
| `refused: <code>`    | 某个文件被更改、添加或替换为链接（`file_mismatch`、`file_unlisted`、`link_entry` 等） |
| `revoked (<reason>)` | ProAnimaStudio 已撤销此版本。`read path only` 表示其数据仍可读取                      |

被拒绝的包永远不会被使用。要修复它，请重新安装该包文件。

## 移除模块 {#remove}

```bash
sudo arkvory module remove sample --root /opt/proanima-arkvory
```

模块离开安装，其包会保留在主机上，直到下一次模块更改。保存已发布文件字节的模块（数据 `layout`）不能被移除：Arkvory 以 `module_owns_data` 拒绝，以确保其数据永远不会变得不可读。

## 撤销列表 {#revocations}

ProAnimaStudio 发布已撤销模块版本的签名列表。每个列表都有一个编号，Arkvory 绝不接受编号小于其已有列表的列表。模块包可以附带更新的列表：安装该包时，Arkvory 会保存它。在无法访问中心的主机上，请自行保存列表文件：

```bash
sudo arkvory module revocations /root/module-revocations.json --root /opt/proanima-arkvory
```

每个列表都带有签名的到期时间：默认 90 天，最长 180 天。`module install` 和 `module pin <id> <version>` 需要有效的列表；列表已过期或没有列表时，会以 `stale_revocations` 拒绝。携带有效列表的软件包也算数。若仍要继续，请添加 `--allow-stale-revocations`：Arkvory 会显示警告，并把该决定记录到 `modules/audit.jsonl`。过期的列表从不停止已安装的模块：它们继续运行，数据仍可读取；只有撤销条目才会停止某个版本。编号更大的列表总会替换已存储的列表，即使它已经过期。

当 ProAnimaStudio 更换模块签名密钥时，会有一个版本同时携带两把密钥，下一个列表用新密钥签名；只有之后的版本才移除旧密钥。只要主机仍存储着用旧密钥签名的列表，升级到该版本就会被拒绝：请先存储有效的列表。`sudo arkvory module check-revocations --root …` 会显示此版本是否信任已存储列表的密钥。

## 信任插件作者 {#trust}

您团队或其他作者的插件使用作者的密钥签名。在安装此类插件之前，请将密钥添加到主机的信任列表中。信任列表属于主机：服务可以读取它，但不能更改它。

1. 从作者处获取公钥文件（`.pub`，minisign 格式），并通过另一渠道获取其指纹。
2. 显示密钥并核对指纹：

   ```bash
   sudo arkvory module trust add /root/acme.pub --label "Acme platform team" --plugins "op-acme-*" --root /opt/proanima-arkvory
   ```

3. 使用 `--yes` 添加它。

| 选项                 | 含义                                                                        |
| -------------------- | --------------------------------------------------------------------------- |
| `--label`            | 密钥持有者；必填                                                            |
| `--plugins`          | 该密钥可以签名的插件 id，以逗号分隔：精确 id 或带 `*` 的前缀。默认为 `op-*` |
| `--expires`          | UTC 时间，例如 `2027-01-31T00:00:00Z`。此后该密钥不再接受新的安装           |
| `--allow-in-process` | 允许该密钥的插件在 Arkvory 进程内运行。此类代码获得服务的全部权限           |

插件 id 始终以 `op-` 开头。插件密钥从不签名 ProAnimaStudio 模块，ProAnimaStudio 的密钥也从不签名 `op-` 插件。 主机已经以其他 id 或其他类型的密钥知道的密钥会被拒绝（`duplicate_key`）。签名必须是预哈希签名，即当前 minisign 版本的默认方式；旧式签名会以 `signature_algorithm` 拒绝。

`sudo arkvory module trust list --root …` 显示受信任的密钥。`sudo arkvory module trust remove <key id> --root …` 移除一个密钥。

此版本维护信任列表；插件由后续版本安装。

## 中断之后 {#recover}

模块集合的每次更改都会记录在更新日志中。如果命令中途停止，下一个部署命令会以 `Interrupted deployment` 拒绝。运行 `sudo arkvory recover --root …`：它会恢复之前的模块集合。 在此之前，每个会更改内容的模块命令都会拒绝，包括 `module trust` 和 `module revocations`。

## 模块请求的生命周期 {#request-scope}

模块路由在整个响应期间（包括流式响应）使用调用者的权限。取消或完成会撤销权限并关闭读取资源。`upload-read` 仅读取未完成上传中已确认的分片，并检查所有者、`upload.read`、范围和取消信号。模块可在运行时撤回传输提议，后续能力查询将不再包含它。现有路由和传输保持可用。客户端可能缓存旧提议，因此路由必须检查每次操作。

## 派生缓存恢复 {#derived-cache}

签名模块可声明 `derived-cache`（extension API 0.9.0）。API 和 worker 构建并读取不可变代，reader 仅可读取；backup 不获得此服务。每次请求仍须检查源数据权限。模块资源预算同时涵盖旧数据/缓存和保留的代。缓存缺失时须重新生成或回退。

PostgreSQL 会话丢失并不能证明文件 I/O 已停止。不确定 owner 的预留和持久化 reader 引用仍计入配额。首先应用此核心版本的数据库迁移。恢复前，停止所有参与主机并确认进程和 I/O 已终止，或证明准确的 owner 进程实例已终止且无法恢复；对不可达主机执行 fencing。从诊断中获取准确的 owner UUID，并记录证据。PID、超时或数据库锁消失都不足以证明停止。

在已配置 `ARKVORY_DATABASE_URL` 的受信主机上，使用此核心版本已构建的包执行以下命令。该标志确认物理停止；存在活动 owner 锁时仍拒绝恢复。没有确认则不执行操作。之后恢复 reconciliation 并检查清理；确认本身不会立即释放配额。这是主机维护权限，不是模块或远程 CLI 权限。

```sh
node scripts/recover-derived-cache.mjs --owner UUID --confirm-owner-stopped
```

## 模块协调状态 {#module-state}

Extension API 0.10.0 为已签名模块提供有容量限制的原子状态寄存器。该状态在 HA 故障切换后保留，但不包含在可移植的逻辑备份中。恢复后，请按照模块的明确流程重新初始化；已有对象的读取和恢复必须保持可用。该状态与对象存储分离，重新安装模块不会将其重置。

传输模块可以暂时撤回其协议，并在策略检查成功后恢复，无需重启 Arkvory。每个请求仍须通过模块的当前策略检查。

扩展 API 0.12.0 允许签名存储模块设置逻辑字节上限。核心统计所有仓库中对象及已接受但未完成的上传的完整大小，不因去重而减少统计字节。达到上限后，新上传使用默认存储；已接受的上传保留原目标，已有对象仍可读取。只有清理完成后才减少计数。
