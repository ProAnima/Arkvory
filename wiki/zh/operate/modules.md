---
title: 模块
description: 在主机上安装、检查和移除已签名的模块包，并保存您信任的插件作者的密钥。
---

# 模块

模块包为 Arkvory 增加一项功能。Arkvory 只安装它能够验证签名的包。本页的命令在安装所在的主机上运行：Linux 上以 root 身份，Windows 上以管理员身份。控制台和 HTTP API 不能安装模块，也不能信任密钥，因此被盗的控制台管理员帐户无法在服务器上运行代码。

此版本保存并验证模块包。服务目前还不运行模块代码：后续版本会加载已安装的模块。

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

限制：每个包 1 GiB，每个文件 256 MiB，最多 4096 个文件。更大的包会在读取其数据之前被拒绝。

已以相同字节安装的版本保持不变。同一版本但字节不同则会被拒绝。

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

该命令会重新验证每个已安装的包，就像服务在加载它之前所做的那样：签名、每个文件和归档。每个模块显示一个状态：

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
