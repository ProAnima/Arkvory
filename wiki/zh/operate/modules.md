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

2. 按照[应用更改](../install/configuration#apply-change)重启服务。
3. 以全局管理员身份检查模块：`GET /api/v1/system/modules` 在 API 和每个读取网关上都显示它为 `running: true`，`health.status` 为 `ok`。

API 和读取网关运行模块。worker 检查相同的模块，但不运行任何模块。此版本拒绝在 worker 或备份代理中运行的模块（`role_unsupported`）以及声明自有路由的模块（`routes_unsupported`）。Docker Compose 安装目前还不加载模块。

服务在导入模块的任何代码之前，会再次检查包：

1. 只有 root（Windows 上为 SYSTEM 和 Administrators）或安装目录的所有者可以更改 `modules/`、模块集和吊销列表。安装过程会这样设置。其他账户可以更改的文件以及包内的链接都会被拒绝（`access_unsafe`、`access_link`）。
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
