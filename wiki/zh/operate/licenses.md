---
title: 许可证
description: 在线或离线激活付费模块的许可证，检查其状态，并了解 Arkvory 发送和保存什么。
---

# 许可证

免费的 Arkvory 核心无需付费模块许可证即可运行。许可证启用 ProAnimaStudio 的付费功能，包括 [Arkvory Pro](modules#pro)。过期不会导致已有 Pro 数据无法读取；付费功能不可用时，新上传使用核心存储和普通传输。在您激活许可证之前，Arkvory 不会发送任何许可证相关信息。

本页命令在安装所在的主机上运行：Linux 上以 root 身份，Windows 上以管理员身份。Docker Compose 安装不加载模块，因此会拒绝这些命令。

## 在线激活 {#activate}

1. 把从 ProAnimaStudio 网站得到的许可证密钥保存到只有您能读取的文件中，例如 `/root/arkvory.key`。
2. 激活：

   ```bash
   sudo arkvory license activate --key-file /root/arkvory.key --root /opt/proanima-arkvory
   ```

3. 激活后删除本地密钥文件。请保留在账户中获取许可证密钥的权限：恢复激活时可能再次需要它。

Arkvory 通过校验证书的 HTTPS 把请求发送到安装的中心（hub）（`config/hub.json` 中的地址，与更新使用的相同）。只有当答复由 ProAnimaStudio 的许可证密钥签名、且针对本安装和本次请求时，才会被接受。有拼写错误的密钥在发送任何内容之前就会被拒绝。用同一密钥再次激活同一安装不会占用许可证的新名额。

### 发送的内容 {#sent}

| 请求 | 内容                                                                            |
| ---- | ------------------------------------------------------------------------------- |
| 激活 | 许可证密钥、安装 ID、一个随机值、Arkvory 版本、已安装付费模块的 ID 和版本、时间 |
| 刷新 | 激活 ID 及其密钥、一个随机值、序号、各版本                                      |

许可证持有者的名称、人员姓名、地址、机器信息、数据量、仓库名称、内容、metadata 和使用统计永远不会发送。关闭统计不会在这里增加或减少任何内容。中心（hub）关闭时（`--hub-off`），请使用[离线激活](#offline)。

### 保存的内容 {#kept}

- 令牌：中心（hub）签名的文档，保存在数据库和备份中。
- 激活密钥：`config/licenses/` 中的一个文件，只有服务账户可以读取。它从不出现在数据库、日志或备份中。
- 许可证密钥：任何地方都不保存。

## 检查状态 {#status}

```bash
sudo arkvory license status --root /opt/proanima-arkvory
```

脚本可加 `--json`。全局管理员在 `GET /api/v1/system/license` 中看到相同内容（[参考](../api/reference/system#getSystemLicense)）。Arkvory 每次都会重新验证每个已保存的文档；没有 ProAnimaStudio 签名的文档为 `invalid`，不启用任何功能。

| 状态            | 含义                                                                   | 付费写入             |
| --------------- | ---------------------------------------------------------------------- | -------------------- |
| `valid`         | 许可证有效；中心（hub）一段时间没有答复时为 `refreshFailing`           | 按模块的方式         |
| `offline-grace` | 超过一天没有刷新；令牌在 `offlineGraceUntil` 之前有效                  | 按模块的方式         |
| `grace`         | 许可证期限已结束；续期宽限期到 `graceUntil`                            | 按模块的方式         |
| `mismatch`      | 令牌属于另一个安装（在别处恢复）；宽限期到 `graceUntil`                | 在此之前按模块的方式 |
| `expired`       | `trial_expired`、`licence_expired` 或 `activation_stale`（令牌已结束） | 按核心的形式         |
| `revoked`       | 已签名的吊销；显示原因                                                 | 按核心的形式         |
| `invalid`       | 已保存的文档未通过验证                                                 | 按核心的形式         |

在任何状态下，您的数据都保持可读，备份和恢复照常工作，发布也从不会因为许可证而失败：没有许可证时，付费模块会以免费核心的形式写入新数据。刷新成功后，按模块方式的写入会自动恢复。

## 刷新与离线窗口 {#refresh}

工作进程（worker）大约每天刷新每个激活一次，并在启动时刷新。每次刷新都会带来新令牌和新密钥；之前的密钥随即失效。

无法连接中心（hub）时，工作进程（worker）会在 15 分钟后重试，之后每次等待更久，最长 6 小时。许可证仍为 `valid`；一天没有刷新后变为 `offline-grace`；令牌结束时（离线窗口：默认 30 天，试用为 7 天）变为带有 `activation_stale` 的 `expired`。中心（hub）的拒绝（如 `licence_expired` 或 `activation_suspended`）不会重试：处理好原因后运行：

```bash
sudo arkvory license refresh --root /opt/proanima-arkvory
```

把时钟调回不会延长任何期限：Arkvory 以它见过的最晚时间为准。数据库时钟比该时间落后超过一天时，会显示 `clockRollback`。

如果刷新请求可能已到达中心（hub），但答复丢失，Arkvory 只允许在 10 分钟窗口内重试一次，重启也不会重置次数。如果结果仍不确定、重试次数已用完、窗口已结束或收到的令牌无效，`activation_recovery_required` 将停止后续刷新。当前令牌在到期前仍然有效。请获取密钥并重新执行 `license activate --key-file <file>`；`license refresh` 无法解除此状态。

### 副本与恢复 {#copies}

安装的副本（例如克隆的虚拟机）持有相同的密钥。两个副本都刷新时，中心（hub）会暂停该激活（`activation_secret_reused`）。请用密钥重新激活您要保留的那个安装。

在另一个安装上恢复的备份会保留其令牌，该令牌属于原来的安装：状态为带宽限期的 `mismatch`。请用密钥激活新安装，然后停用原来的安装。

在离线窗口加 30 天内都没有刷新的激活会失效，其名额被释放。下一次刷新会在仍有空余名额时取回名额；否则会以 `activation_lapsed` 被拒绝。请先停用另一个安装，再刷新。

## 停用 {#deactivate}

```bash
sudo arkvory license deactivate lic_0123456789ABCDEFGHJKMNPQRS --root /opt/proanima-arkvory
```

指定许可证或某个激活。中心（hub）释放名额，Arkvory 删除密钥。

## 离线激活 {#offline}

适用于无法访问中心（hub）的主机：

1. 写出请求文件：

   ```bash
   sudo arkvory license request --key-file /root/arkvory.key --out /root/request.json --root /opt/proanima-arkvory
   ```

   文件中是密钥的 SHA-256，而不是密钥本身。Arkvory 为此不访问任何网络。

2. 在您的 ProAnimaStudio 账户中上传该文件并下载答复。
3. 安装答复：

   ```bash
   sudo arkvory license install /root/answer.json --root /opt/proanima-arkvory
   ```

答复必须对应本安装的某个请求。离线激活不会刷新：它在到期前有效，最长 365 天，用新的请求续期。吊销只能通过许可证吊销列表到达这样的主机，该列表以同样方式安装。

## 错误 {#errors}

| 代码                                                | 含义                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| `licence_key_invalid`                               | 中心（hub）不认识该密钥                                                |
| `activation_limit_reached`                          | 许可证的所有名额都已占用；请停用另一个安装                             |
| `answer_invalid`                                    | 答复不是 ProAnimaStudio 签名的，或属于另一个安装或请求；不保存任何内容 |
| `installation_mismatch`, `nonce_unknown`            | 离线答复属于另一个安装，或不对应任何等待中的请求                       |
| `seq_replayed`                                      | 比已保存文档更旧的文档；已拒绝                                         |
| `revocation_rollback`                               | 比已保存列表更旧的吊销列表                                             |
| `unreachable`, `timeout`, `tls_failed`, `hub_error` | 无法连接中心（hub）；工作进程（worker）会重试                          |
