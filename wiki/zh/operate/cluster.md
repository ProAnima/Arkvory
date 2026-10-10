---
title: 高可用集群
description: 在同一站点的两到三台 Linux 服务器上运行 Arkvory，所有数据保持同步副本，支持自动故障切换和强制隔离（fencing）。
---

# 高可用集群

Arkvory 集群在站点中的某台服务器故障时仍能继续工作。两到三台 Linux 服务器持有同一个块卷的相同副本。其中一台服务器处于**活动**状态并运行 Arkvory。它故障时，集群管理器会将其隔离（fencing），并在另一台拥有相同数据的服务器上启动 Arkvory。

集群可以防护单个站点内服务器、磁盘或网络链路的丢失，但不能防护整个站点的丢失。为此，请在另一个站点保留[镜像](./mirrors)，并在集群之外保留[备份](./backups)。

## 工作原理 {#how-it-works}

- **一个卷，同步副本。** DRBD 9 会在写入完成之前，把卷上的每次写入复制到其他服务器（协议 C）。整个安装都位于该卷上：数据库、存储、配置和各个发布版本。目录与文件字节永远不会分叉。
- **Pacemaker 决定 Arkvory 在哪里运行。** Corosync 和 Pacemaker 维持仲裁，选出活动服务器，并按顺序启动：卷、文件系统、数据库、`arkvory-replica`、API、worker、备份代理、更新定时器和一个虚拟 IP 地址。Arkvory 自身没有选举机制。
- **隔离是强制的。** 在另一台服务器接管之前，Pacemaker 会通过电源设备（IPMI、iDRAC、iLO、Redfish、PDU）或虚拟机管理程序关闭故障服务器。没有隔离，两台服务器可能同时写入。没有隔离的集群无法启动。
- **每次已确认的写入都有两份副本。** 只有当写入已存在于至少两份完整副本上时，Arkvory 才会以成功响应写入（参见[写入与副本](#writes)）。缺少副本时，写入停止，读取继续。

| 配置   | 数据服务器 | 见证节点                                                               | 一台数据服务器故障时                       |
| ------ | ---------- | ---------------------------------------------------------------------- | ------------------------------------------ |
| `ha-2` | 2          | 必需：一台不存放数据的小型服务器，运行 `corosync-qnetd` 和 DRBD 仲裁者 | 写入停止，直到服务器恢复或由操作员做出决定 |
| `ha-3` | 3          | 不使用：三台服务器按多数票决定                                         | 写入继续：仍有两份副本                     |

推荐使用 `ha-3`。`ha-2` 成本更低，并且会如实停止写入，而不是让数据只保留一份副本。

集群适用于原生 Linux 软件包。Windows 安装和 Docker Compose 仍是配合镜像与备份使用的独立服务器。

## 写入与副本 {#writes}

**完整副本**是指处于最新状态的活动服务器本地磁盘，加上每一台已连接、正在复制且处于最新状态的其他数据服务器。正在重新同步的服务器在追平之前不计入。见证节点没有数据，永远不计入。

每个会修改数据的请求（HTTP API、容器注册表、Git LFS、npm）都会被检查两次：

- 执行**之前**，依据最近一秒的副本情况；
- 数据提交并同步**之后**，依据对卷的一次最新读取。

当完整副本少于写入所需的数量时，客户端会收到 HTTP 503，代码为 `unavailable`，原因为 `replication_degraded`，并带有 `Retry-After` 标头，绝不会是 2xx。上传完成作业的状态（`GET /api/v1/jobs/{id}`）以同样方式检查，因为它会告诉客户端某个大文件上传已发布。

提交之后出现的 503 表示该操作可能只存在于一份副本中。请使用相同的 `Idempotency-Key` 重复请求：重复请求会返回已有的结果，当两份副本再次存在时，它的 2xx 即表示确认。

在写入停止期间，读取、下载、控制台、登录与退出、反馈以及 Git LFS 的批量请求都可正常工作。

在写入停止期间，或单副本决定生效期间，登录控制台的管理员会看到一条横幅。

## 要求 {#requirements}

- 两到三台数据服务器，使用相同的 Linux 发行版、相同的 Arkvory 软件包版本，并且每台都有一块能容纳整个卷的磁盘（或逻辑卷）。请按整个存储加数据库的大小规划。
- 对于 `ha-2`，需要第三台小型服务器作为见证节点。它不需要存放数据的磁盘，也不运行 Arkvory。
- 服务器之间需要低延迟网络。每次写入都要等待其他服务器，因此延迟会叠加到每次写入上。条件允许时请使用专用链路。
- DRBD 9（内核模块和 `drbd-utils` 9；许多发行版自带较旧的 8.4 模块，因此请使用 LINBIT 软件包）、`pacemaker`、`pcs`、`corosync`、`resource-agents`（在 Ubuntu 上为 `resource-agents-base` 和 `resource-agents-extra`），以及适用于你硬件的 fence agent。对于 `ha-2`：数据服务器上需要 `corosync-qdevice`，见证节点上需要 `corosync-qnetd`。
- 每台数据服务器各一个隔离设备，以及它的凭据。
- 服务器所在网络中的一个空闲 IP 地址。客户端连接到这个虚拟地址。
- 虚拟地址的 TLS 证书。请把证书和密钥放在卷上，这样每台服务器都能在相同路径找到它们。

## 搭建集群 {#build}

下面的命令使用默认资源名 `arkvory`、安装目录 `/opt/proanima-arkvory`，并以 `/dev/vg0/arkvory` 作为底层磁盘。请以 root 身份运行。

1. 在每台数据服务器上，解包 Arkvory 软件包但不安装。这会添加文件和 `arkvory` 命令，并且不会在 `/opt/proanima-arkvory` 中创建任何内容：

   ```bash
   dpkg --unpack Arkvory-amd64.deb
   ```

2. 在一台数据服务器上生成方案。它会把 DRBD 资源和 Pacemaker 命令写入一个目录，供你审阅：

   ```bash
   arkvory cluster-plan --cluster ha-2 \
     --nodes node-a=10.0.0.11,node-b=10.0.0.12 --witness witness=10.0.0.13 \
     --disk /dev/vg0/arkvory --fence-agent fence_ipmilan \
     --virtual-ip 10.0.0.100/24 --output /root/arkvory-plan
   ```

   对于 `ha-3`，在 `--nodes` 中列出三台服务器，并省略 `--witness`。可选项：`--cluster-resource`、`--drbd-minor`（默认 0）、`--drbd-port`（默认 7789）、`--filesystem`（`xfs` 或 `ext4`，默认 `xfs`）。名称必须是服务器的主机名。

3. 把 `arkvory.res` 复制到每台服务器（包括见证节点）的 `/etc/drbd.d/`。在数据服务器上创建元数据，并在所有服务器上启动资源：

   ```bash
   drbdadm create-md arkvory   # data servers only
   drbdadm up arkvory          # every server
   ```

   在见证节点上，还要运行 `systemctl enable drbd@arkvory.service`，使仲裁者在重启后恢复。

   该方案让返回的副本即使在写入负载下也至少以 20 MB/s 重新同步，最高为 1 GB/s。请把 `disk` 部分中的 `c-min-rate` 和 `c-max-rate` 设为你的复制链路能够承载的值。

4. 在第一台数据服务器上，将其设为主节点，创建文件系统并挂载。对于全新的空磁盘，请先跳过初始同步：

   ```bash
   drbdadm new-current-uuid --clear-bitmap arkvory/0
   drbdadm primary arkvory
   mkfs.xfs /dev/drbd0
   mkdir -p /opt/proanima-arkvory && mount /dev/drbd0 /opt/proanima-arkvory
   ```

5. 把 Arkvory 安装到已挂载的卷中，把 TLS 文件放到卷上，并启用集群模式：

   ```bash
   dpkg --configure proanima-arkvory
   install -d -m 0750 -o root -g arkvory /opt/proanima-arkvory/config/tls
   install -m 0644 tls.crt /opt/proanima-arkvory/config/tls/tls.crt
   install -m 0640 -g arkvory tls.key /opt/proanima-arkvory/config/tls/tls.key
   arkvory configure --root /opt/proanima-arkvory --tls-cert /opt/proanima-arkvory/config/tls/tls.crt --tls-key /opt/proanima-arkvory/config/tls/tls.key --listen-host 0.0.0.0
   arkvory configure --root /opt/proanima-arkvory --cluster ha-2
   ```

   `configure --cluster` 会检查安装目录是否是已挂载的 DRBD 设备、此服务器是否为主节点，以及每份副本是否完整。它会启动 `arkvory-replica`，让 Arkvory 只在有两份完整副本时才确认写入，并关闭 Arkvory 服务的自动启动：从现在起由 Pacemaker 启动它们。如果某一步失败，会恢复独立配置。

6. 在第一台服务器上停止 Arkvory 并释放卷：

   ```bash
   systemctl stop arkvory-update.timer arkvory-backup arkvory-worker arkvory-api arkvory-replica arkvory-database
   umount /opt/proanima-arkvory && drbdadm secondary arkvory
   ```

7. 依次在其他每台数据服务器上，接管卷、准备服务器，然后再次释放卷：

   ```bash
   drbdadm primary arkvory
   mkdir -p /opt/proanima-arkvory && mount /dev/drbd0 /opt/proanima-arkvory
   arkvory cluster-node --root /opt/proanima-arkvory --cluster-resource arkvory
   dpkg --configure proanima-arkvory
   systemctl stop arkvory-update.timer arkvory-backup arkvory-worker arkvory-api arkvory-replica arkvory-database
   umount /opt/proanima-arkvory && drbdadm secondary arkvory
   ```

   `cluster-node` 会创建与第一台服务器用户 ID 和组 ID 相同的服务账户（卷上的文件归它们所有），并安装相同的服务，这些服务都不会自动启动。如果某个账户已存在但 ID 不同，命令会停止并告诉你应设置哪些 ID。

8. 在数据服务器上用 `pcs` 设置 Corosync 集群（`pcs host auth`、`pcs cluster setup`、`pcs cluster start --all`）。在 Debian 和 Ubuntu 上，请先在每台数据服务器上运行 `pcs cluster destroy`：软件包会安装一份示例 Corosync 配置，`pcs` 会把它当作已有的集群。不要运行 `pcs cluster enable`：被隔离的服务器应当只在你启动它时才重新加入。对于 `ha-2`，还要对见证节点进行认证，并在其上运行 `pcs qdevice setup model net --enable --start`。在 Debian 和 Ubuntu 上，软件包已经为其自身的服务账户设置好了仲裁设备：请改为在那里运行 `systemctl enable --now corosync-qnetd`。

9. 打开 `/root/arkvory-plan/pacemaker.sh`。把每个 `<agent parameters: …>` 替换为你的隔离设备的参数：其地址、登录名、密码文件或密钥，以及该服务器的插座或端口。然后在一台数据服务器上运行该脚本：

   ```bash
   sh /root/arkvory-plan/pacemaker.sh
   ```

   该脚本在一个文件中构建全部配置，并一次性推送：隔离、仲裁策略、DRBD 资源、Arkvory 组及其约束。

10. 在活动服务器上检查集群：

    ```bash
    arkvory cluster-check --root /opt/proanima-arkvory
    ```

    该命令检查仲裁、隔离是否已启用、每台服务器是否有隔离设备、DRBD 的仲裁与隔离设置、每份副本是否完整，以及 Arkvory 是否恰好运行在一台服务器上。某项检查失败时，命令会以错误退出。

11. 验证一次隔离：隔离每台备用服务器并让它恢复（参见[隔离测试](#fence-test)）。

把你的客户端和 DNS 名称指向虚拟地址。

## 日常运维 {#operation}

请以 root 身份运行这些命令。`cluster-status` 和 `cluster-single-copy` 需要读取卷，因此请在活动服务器上运行；其余命令可在任一数据服务器上运行。

| 命令                                                                      | 作用                                                                         |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `arkvory cluster-status --root <dir>`                                     | 以 JSON 输出配置、此服务器的角色、完整副本数与所需副本数，以及任何操作员决定 |
| `arkvory cluster-check --root <dir>`                                      | 健康集群的全部检查；某项失败时以错误退出                                     |
| `arkvory cluster-switchover --root <dir> --to <server>`                   | 有计划地把 Arkvory 迁移到另一台数据服务器；除非每份副本都完整，否则被拒绝    |
| `arkvory cluster-fence-test --root <dir> --node <standby>`                | 隔离一台备用服务器以验证其隔离设备；活动服务器会被拒绝                       |
| `arkvory cluster-single-copy --root <dir> --until <time> --reason <text>` | 在某个时间之前接受只有一份副本的写入；参见[单副本](#single-copy)             |

`pcs status` 显示 Pacemaker 所看到的集群状态。

### 计划切换 {#switchover}

`cluster-switchover` 请求 Pacemaker 迁移该组，最多等待 5 分钟，直到 Arkvory 在目标服务器上运行，然后移除临时的放置规则。迁移期间到旧服务器的连接会断开；客户端会重复其请求。Arkvory 绝不会自行切回。

### 隔离测试 {#fence-test}

`cluster-fence-test` 通过备用服务器的隔离设备将其重启。重启后，用 `pcs cluster start` 在该服务器上启动集群。集群服务在重启后不会自行启动（参见[搭建集群](#build)的第 8 步），因此被隔离的服务器没有你的操作就永远不会重新加入。

### 更新 {#updates}

在每台数据服务器上安装新软件包。在备用服务器上，软件包只替换程序文件，因为发布版本位于卷上。在活动服务器上，软件包会应用该发布版本：Arkvory 通知 Pacemaker 不要动这个组，停止服务，迁移，启动服务，等待它们就绪，然后把组交还。自动更新在活动服务器上的工作方式相同。

不要在集群服务器上用 `systemctl` 启动或停止 Arkvory 服务。Pacemaker 会把这当作故障。需要有计划地停止整个服务时，请使用 `pcs resource disable arkvory` 和 `pcs resource enable arkvory`。

## 故障 {#failures}

| 发生的情况                                             | `ha-2`                                                                               | `ha-3`                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| 一台备用服务器故障                                     | 被隔离。读取继续，写入收到 503 `replication_degraded`                                | 被隔离。读取和写入继续                               |
| 活动服务器故障                                         | 被隔离，Arkvory 在另一台服务器上启动。读取恢复，写入等待第二份副本                   | 被隔离，Arkvory 在另一台服务器上启动。读取和写入恢复 |
| 数据服务器之间发生网络分裂                             | 见证节点把仲裁权交给一侧；另一侧被隔离。绝不会有两个写入者                           | 多数一侧继续；另一台服务器被隔离                     |
| 三个成员中的两个故障（ha-2：一台数据服务器和见证节点） | 最后一台服务器没有仲裁：Arkvory 停止。绝不会有没有仲裁的写入者。恢复服务器（见下文） | 两台数据服务器故障时同样处理                         |
| 隔离不起作用                                           | 不进行故障切换。Arkvory 保持停止，直到隔离成功                                       | 同样                                                 |

恢复被隔离的服务器：

1. 修复原因并启动服务器。
2. 在其上运行 `pcs cluster start`。
3. 卷会重新同步已更改的块。当所需的每份副本再次完整时，写入会自动恢复；`arkvory cluster-status` 显示进度。

丢失仲裁后，请在每台已恢复的服务器上启动集群。Pacemaker 会在拥有最新副本的服务器上再次运行 Arkvory。最后一个丢失仲裁的服务器在恢复途中可能再被隔离一次，因为它无法干净地停止：请在它重启后再次在其上启动集群。

当隔离失败而你已将其修复后，请在一台正在运行的服务器上清除失败的尝试，让 Pacemaker 重试：`pcs stonith history cleanup <server>` 和 `pcs resource cleanup`。

### 单副本 {#single-copy}

当某台数据服务器长时间缺席（例如更换磁盘），并且停止写入的代价超过风险时，操作员可以在有限时间内接受只有一份副本的写入：

```bash
arkvory cluster-single-copy --root /opt/proanima-arkvory --until 2026-10-12T18:00:00Z --reason "disk replacement on node-b"
```

- 时间必须在未来 7 天以内。该命令仅在缺少副本时才有效。
- 决定生效期间，如果活动服务器丢失，此后已确认的写入也会随之丢失。
- 控制台横幅、指标 `arkvory_replication_required_copies` 和告警 `ArkvorySingleCopyWrites` 会显示该决定。
- 它会在到期时间结束，也可用 `--off` 结束，或在每份副本再次完整时自动结束。之后若再出现丢失，写入会再次停止。

## 监控 {#monitoring}

在写入停止期间，活动服务器上的 `GET /health/ready` 仍返回 200，因此监控不会移动健康的服务器。其字段 `writable` 为 `false`，字段 `replication` 显示 `copies`、`required` 和 `singleCopyUntil`；无法读取副本时，`replication` 为 `null`。独立服务器没有 `replication` 字段。

| 指标                                       | 含义                                        |
| ------------------------------------------ | ------------------------------------------- |
| `arkvory_replication_copies`               | 最近一次检查时的完整副本数                  |
| `arkvory_replication_required_copies`      | 一次写入所需的副本数：2，单副本决定期间为 1 |
| `arkvory_replication_writes_refused_total` | 以 503 `replication_degraded` 响应的写入数  |
| `arkvory_replication_check_failures_total` | 读取副本状态失败的次数                      |

`deploy/monitoring/arkvory-alerts.yml` 中的告警规则包括 `ArkvoryReplicationDegraded`、`ArkvorySingleCopyWrites` 和 `ArkvoryReplicationCheckFailing`。也请监控集群本身：定期运行 `arkvory cluster-check` 并根据其退出码告警，或使用你的 Pacemaker 安装自带的监控。参见[监控](./monitoring)。

## 备份 {#backups}

备份代理只在活动服务器上运行，作为组的一部分。请把备份存储放在集群卷之外，例如放在 NAS 上。参见[备份](./backups)。
