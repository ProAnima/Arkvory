---
title: 监控
description: 'Arkvory 服务器的健康端点、指标、日志、控制台诊断以及建议的告警列表。'
---

# 监控

Arkvory 为您提供四类事实来源：回答“它是否在运行”的健康端点、Prometheus 指标、JSON 日志行，以及控制台的诊断信息。本页列出每个来源包含的内容，并在最后给出一组可直接采用的告警。

指标、健康端点和日志事件描述的都是单个 API 进程。工作进程（worker）和备份代理没有 HTTP 端口。您通过日志行、完成队列指标和备份状态来了解它们。

## 立即检查服务器 {#quick-check}

1. 查询公共状态端点。它不需要密钥：

   ```bash
   curl -fsS http://127.0.0.1:8080/health/status
   ```

   HTTP 200 的 `{"status":"ready"}` 表示 API 能够访问其数据库和存储目录。

2. 使用安装程序创建的健康密钥查询完整的就绪状态应答：

   ```bash
   sudo sh -c 'curl -fsS -H "Authorization: Bearer $(cat /opt/proanima-arkvory/config/health-token.txt)" http://127.0.0.1:8080/health/ready'
   ```

   ```powershell
   $root = 'C:\ProgramData\ProAnima\Arkvory'
   $key = (Get-Content "$root\config\health-token.txt" -Raw).Trim()
   Invoke-RestMethod -Headers @{ Authorization = "Bearer $key" } http://127.0.0.1:8080/health/ready
   ```

3. 检查备份：

   ```bash
   arkvoryctl backup status
   ```

   该命令需要恢复密钥（引导密钥）或管理员的会话。当存在严重警告时，它以退出码 9 退出。对于无人值守的检查，请使用下面的 Prometheus 告警。参见[命令行](../protocols/cli)。

4. 检查服务以及最新的日志行。参见[日志](#logs)。

`arkvory status --root <root>` 打印已安装的版本、安装模式和更新策略。它不会探测服务器。`arkvoryctl doctor` 显示服务器、仓库、功能以及某个密钥的权限。它是客户端检查，而非健康检查。

## 健康与就绪 {#health}

三个端点在 API 端口上应答。它们都不计入请求预算 `ARKVORY_MAX_REQUESTS`，因此传输负载不会让服务器看起来像已停止响应。三者在服务器停止前排空期间都会继续应答。

| 路径             | 密钥         | 应答                                                                                                         | 用途                        |
| ---------------- | ------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------- |
| `/health/live`   | 否           | 只要进程应答就返回 200 `{"status":"ok"}`                                                                     | 进程检查                    |
| `/health/status` | 否           | 200 `{"status":"ready"}`，或带 `Retry-After: 2` 的 503 `{"status":"unavailable"}` 或 `{"status":"draining"}` | 负载均衡器和在线时长探测    |
| `/health/ready`  | 任意有效密钥 | 200，内容见下文；或 503，带错误封装和 `Retry-After`                                                          | 部署检查和 Compose 健康检查 |

`/health/status` 和 `/health/ready` 检查三件事：数据库能够应答，且恰好具有本版本的迁移；存储目录的 `blobs` 文件夹存在；进程仍然持有其存储锁。`/health/status` 的结果会缓存一秒，因此公共探测无法使数据库查询倍增。正在排空的服务器会立即应答 `draining`。

不带密钥时，`/health/ready` 返回 401。安装程序创建的密钥 `deployment-health` 没有仓库权限，也没有管理员权限。它的机密位于 `config/health-token.txt`。

`/health/ready` 的 200 应答包含以下字段：

| 字段              | 含义                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`          | 在 200 应答中始终为 `ready`                                                                                                                                                                                                                                                                                                                  |
| `writable`        | 当存储卷的可用空间低于 `ARKVORY_STORAGE_RESERVE_BYTES` 时，以及在读取网关上为 `false`。读取仍然可用                                                                                                                                                                                                                                          |
| `role`            | `api`，或读取网关的 `reader`                                                                                                                                                                                                                                                                                                                 |
| `sharedDownloads` | 读取网关的租约（`slot`、`slots`、`active`、`leaseSeconds`），或 `null`                                                                                                                                                                                                                                                                       |
| `transfers`       | 对于 `uploads` 和 `downloads`：`admission`（`active`、`waiting`、`capacity`、`perPrincipalCapacity`、`waitingCapacity`、`perPrincipalWaitingCapacity`、`timeoutMs`、`rejected`、`timedOut`、`cancelled`）和 `bandwidth`（`bytesPerSecond`、`perPrincipalBytesPerSecond`、`burstBytes`、`perPrincipalBurstBytes`、`waiting`、`grantedBytes`） |

仅一次就绪检查失败绝不会重启服务。参见[自愈](./self-healing)。

## 指标 {#metrics}

`GET /health/metrics` 以 Prometheus 文本格式（版本 0.0.4）返回 API 进程的指标。任何有效密钥都可以读取它，并且在服务器排空期间也能工作。为抓取器创建权限最少的服务密钥，并将其保存在只有 Prometheus 能读取的文件中。

```yaml
scrape_configs:
  - job_name: arkvory
    metrics_path: /health/metrics
    scheme: https
    authorization:
      credentials_file: /etc/prometheus/arkvory.key
    static_configs:
      - targets: ['arkvory.example:443']
```

该作业必须命名为 `arkvory`：随附的告警规则按名称选择它。

这些值属于进程，重启后会从零开始。发生这种情况时 `arkvory_process_start_time_seconds` 会改变。标签是有界的：`route` 是路由模板，绝不是 URL；`status_class` 是 `2xx`、`5xx` 等。

| 指标                                                                                        | 标签                                                       | 含义                                                               |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `arkvory_http_requests_total`                                                               | `method`, `route`, `status_class`                          | 已完成的响应                                                       |
| `arkvory_http_request_duration_seconds`                                                     | 相同                                                       | 从 5 毫秒到 1800 秒的时长直方图。包含已中止的传输                  |
| `arkvory_http_request_bytes_total`, `arkvory_http_response_bytes_total`                     | `method`, `route`                                          | 套接字字节数，包含头部                                             |
| `arkvory_http_requests_in_flight`                                                           |                                                            | 已准入且响应仍处于打开状态的请求                                   |
| `arkvory_transfer_active`, `arkvory_transfer_queue_depth`                                   | `direction`                                                | 已准入的传输以及等待槽位的传输                                     |
| `arkvory_transfer_admission_failures_total`                                                 | `direction`, `reason`                                      | 被准入拒绝的传输：`rejected`（队列已满）、`timed_out`、`cancelled` |
| `arkvory_completion_jobs`                                                                   | `state` (`queued`, `running`)                              | 数据库中的上传完成作业                                             |
| `arkvory_completion_oldest_queued_seconds`                                                  |                                                            | 最旧的、可运行的排队作业的等待时间                                 |
| `arkvory_diagnostic_records_total`                                                          | `outcome` (`written`, `dropped`, `truncated`, `oversized`) | 按结果分类的日志行                                                 |
| `arkvory_metrics_collection_failures_total`                                                 | `collector` (`jobs`, `backup`, `mirror`)                   | 读取由数据库支持的指标失败                                         |
| `arkvory_backup_last_success_timestamp_seconds`                                             |                                                            | 最新完成的备份恢复点的快照时间                                     |
| `arkvory_backup_agent_last_seen_timestamp_seconds`                                          |                                                            | 备份代理的最近一次心跳                                             |
| `arkvory_backup_warnings`                                                                   | `code`                                                     | 警告处于活动状态时为 1，否则为 0                                   |
| `arkvory_mirror_last_sync_timestamp_seconds`, `arkvory_mirror_last_check_timestamp_seconds` | `repository`, `mode`                                       | 与源的最近一次同步追平，以及对其馈送的最近一次读取                 |
| `arkvory_mirror_failing`                                                                    | `repository`, `mode`                                       | 最近一次同步尝试失败期间为 1                                       |
| `arkvory_tls_certificate_expiry_timestamp_seconds`                                          |                                                            | 内置 HTTPS 证书的到期时间。仅在启用内置 HTTPS 时存在               |
| `arkvory_build_info`                                                                        | `service`, `version`                                       | 始终为 1                                                           |
| `arkvory_process_start_time_seconds`, `arkvory_process_resident_memory_bytes`               |                                                            | 启动时间和常驻内存                                                 |

由数据库支持的指标（完成、备份、镜像）最多每 5 秒读取一次。当读取失败时，服务器会省略这些指标，而不是显示旧值，并且 `arkvory_metrics_collection_failures_total` 会增长。

控制请求的第 99 百分位数，不含文件传输：

```text
histogram_quantile(0.99, sum by (le) (rate(arkvory_http_request_duration_seconds_bucket{route!~".*(content|parts).*"}[10m])))
```

Arkvory 不导出存储卷或数据库的可用空间。使用 `node_exporter` 监控卷，使用 `postgres_exporter` 监控 PostgreSQL。

## 日志 {#logs}

API、工作进程（worker）、备份代理和维护工具每行向标准输出写入一个 JSON 对象。服务器本身不写日志文件。您平台的服务管理器负责收集这些行。

| 安装方式                      | 读取位置                                                                                                                                                                                           | 轮换                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Linux（软件包、`install.sh`） | `journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup`。托管的数据库是 `arkvory-database`，更新程序是 `arkvory-update`                                                                    | 由 journald 设置                   |
| Windows                       | 安装根目录中的 `logs\arkvory-api.out.log`、`arkvory-worker.out.log`、`arkvory-backup.out.log`。错误输出写入它们旁边的 `.err.log` 文件。更新程序写入 `logs\updater.log`，数据库服务写入 `database\` | 每个文件 20 MiB，保留 5 个旧文件   |
| Docker Compose                | `docker logs --tail 100 proanima-arkvory-api-1`，对 `-worker-1` 和 `-backup-1` 同理                                                                                                                | 每个文件 20 MiB，每个容器 5 个文件 |

卡死会以标准错误上的记录 `process.stalled` 结束进程，因此也要查看 `.err.log` 文件或日志（journal）。关于 `logs\` 中的其他文件，参见 [Windows](../install/windows#logs)。

每一行都以相同的字段开头：

| 字段                         | 取值                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `timestamp`                  | ISO 8601 格式的 UTC 时间                                                                                     |
| `level`                      | `debug`、`info`、`warning` 或 `error`                                                                        |
| `service`                    | `api`、`worker`、`backup`、`migrate`、`gc` 或 `scrub`                                                        |
| `version`, `pid`, `hostname` | 版本、进程和主机                                                                                             |
| `component`                  | `api`、`http`、`storage`、`worker`、`maintenance`、`backup`、`mirror`、`migrate`、`process` 或 `diagnostics` |
| `code`                       | 事件名称                                                                                                     |

其他字段来自一个固定的列表：标识符（`requestId`、`traceId`、`jobId`、`uploadId`、`artifactId`、`repository`、`principal`、`clientIp`），数字（`status`、`durationMs`、`bytesSent`、`bytesReceived`、`attempts`）以及原因字段（`errorCode`、`errorName`、`errno`、`sqlstate`、`reason`）。`ARKVORY_LOG_LEVEL` 设置写入的最低级别。

### 重要事件 {#log-events}

| 事件（`code`）                                                                                        | 级别                         | 含义与首要操作                                                                                       |
| ----------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `api.listening`                                                                                       | info                         | API 开始处理请求。字段 `address`、`port` 和 `tls`                                                    |
| `startup.failed`                                                                                      | error                        | API 未能启动。`reason` 指明原因。参见[故障排查](./troubleshooting#server-does-not-start)             |
| `worker.unavailable`                                                                                  | error                        | 工作进程未能启动，或因错误而停止                                                                     |
| `http.plaintext_exposed`                                                                              | warning                      | API 在非回环地址上监听，且未启用 TLS，也没有受信任的代理                                             |
| `http.access`                                                                                         | info                         | 每个已完成或已中止的请求一行                                                                         |
| 某个请求的错误码，例如 `unavailable` 或 `internal`                                                    | 4xx 为 warning，5xx 为 error | 失败的请求，带 `requestId`、`route`、`status`；对于系统错误，还带 `errorName`、`errno` 或 `sqlstate` |
| `upload.input_timeout`, `upload.deadline`                                                             | warning                      | 上传停止发送数据，或耗时超过 `ARKVORY_UPLOAD_DEADLINE_MS`                                            |
| `api.ownership_lost`, `worker.ownership_lost`                                                         | error                        | 证明存储所有权的数据库会话中断。进程退出并重启                                                       |
| `process.stalled`                                                                                     | error                        | 看门狗结束了卡死的进程。字段 `stalledSeconds`                                                        |
| `process.unhandled`                                                                                   | error                        | 意外错误结束了进程                                                                                   |
| `process.watchdog_failed`                                                                             | warning                      | 看门狗无法启动。服务在没有它的情况下运行                                                             |
| `drain.started`, `drain.settled`, `drain.timeout`, `api.stopped`                                      | info 或 warning              | 优雅停止。`drain.timeout` 表示请求被强制中断                                                         |
| `tls.reloaded`, `tls.reload_failed`, `tls.expiring`                                                   | info 或 warning              | 证书文件被再次读取、无法读取，或在 14 天内到期。`tls.expiring` 每天重复一次                          |
| `completion.completed`, `completion.failed`, `completion.lease_lost`, `completion.attempts_exhausted` | info 或 error                | 上传完成作业的结果，带 `jobId`、`uploadId` 和 `errorCode`                                            |
| `backup.agent.started`, `backup.agent.standby`, `backup.agent.lease_lost`                             | info 或 warning              | 备份代理的状态                                                                                       |
| `backup.request.failed`, `backup.request.requeued`, `backup.failed`                                   | error 或 warning             | 备份作业失败或重新运行。字段 `errorCode`                                                             |
| `mirror.step_failed`, `mirror.recovered`                                                              | warning 或 info              | 镜像同步步骤失败（`errorCode`、`attempts`），或恢复正常                                              |
| `migrate.started`, `migrate.completed`, `migrate.failed`                                              | info 或 error                | 一次更新的数据库迁移                                                                                 |
| `diagnostics.dropped`, `diagnostics.oversized`                                                        | warning                      | 由于日志读取器太慢或某行太长，日志行被丢弃                                                           |

缓慢的日志读取器绝不会拖慢传输。当输出被阻塞时，服务器会丢弃日志行、对它们计数，并在输出再次畅通后写入带数量的 `diagnostics.dropped`。超过 4096 个字符的行会被替换为 `diagnostics.oversized`。文本字段在 256 个字符处截断。

### 请求 ID {#request-ids}

每个响应都带有头部 `X-Request-Id`，每个错误正文都有字段 `requestId`。同一个值会出现在 `http.access` 行、错误行、该请求启动的完成作业的日志行，以及审计记录中。报告问题的客户端只需向您提供这个值。

```bash
journalctl -u arkvory-api -u arkvory-worker --since "1 hour ago" -o cat | grep 'REQUEST_ID'
```

```powershell
Select-String -Path "$root\logs\*.log" -Pattern 'REQUEST_ID'
```

在反向代理之后，服务器只接受来自 `ARKVORY_TRUSTED_PROXIES` 中地址的传入 `X-Request-Id`，且仅当它是 8 到 128 个字符（字母、数字、`.`、`_`、`:` 和 `-`）的单个值时。让代理覆盖该头部，例如在 nginx 中使用 `proxy_set_header X-Request-Id $request_id;`。来自任何客户端的有效 W3C `traceparent` 头部会成为字段 `traceId`。它仅用于搜索，绝不授予任何权限。

### 绝不记录的内容 {#never-logged}

日志不包含密码、密钥、令牌、`Authorization` 头部、请求正文、查询字符串、URL 或异常文本。下载链接在查询字符串中携带机密，因此只记录路由模板。字段 `reason` 是唯一的自由文本。它会被脱敏，并在 240 个字符处截断。日志行会显示 `principal`（账户或密钥的 ID）和 `clientIp`。请将日志视为个人数据。

`ARKVORY_ACCESS_LOG=false` 会关闭 `http.access`。对 `/health/live` 和 `/health/status` 的成功请求绝不记录。级别 `warning` 和 `error` 也会隐藏访问日志行。

## 控制台中的诊断 {#console}

管理员无需 shell 即可在控制台中查看服务器状态。参见 [Web 控制台](../guide/console)。

| 位置                            | 您看到的内容                                                                                                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [[ui:backups]]                  | 标题显示 [[ui:backupStateOk]]、[[ui:backupStateWarning]] 和 [[ui:backupStateCritical]]。下方是 [[ui:backupNewest]] 备份、[[ui:backupNextRun]]、[[ui:backupAgent]]、[[ui:backupVault]]，以及带各自操作的警告列表 |
| [[ui:updates]]                  | 已安装版本和最新版本、上次检查的时间，以及主机更新程序的状态                                                                                                                                                    |
| 仓库的 [[ui:repositoryStorage]] | 配额使用情况以及状态 [[ui:storageWarning]] 和 [[ui:storageCritical]]，还有列表 [[ui:storageEvents]]                                                                                                             |
| 服务账户的 [[ui:serviceAudit]]  | 谁创建、更改、签发或撤销了什么                                                                                                                                                                                  |
| 仓库卡片                        | 徽章 [[ui:mirrorBadge]]，当上次同步失败时显示状态 [[ui:mirrorFailing]]                                                                                                                                          |

列表 [[ui:storageEvents]] 需要读取诊断的权限。除其他事件外，它还包含该仓库中服务密钥失败的请求，带请求 ID、路由和状态。

配额阈值默认为警告 80%、严重 95%，除非管理员更改了它们。没有配额的仓库没有阈值。

## 存储和磁盘警告 {#storage}

服务器在存储卷上保留 `ARKVORY_STORAGE_RESERVE_BYTES`（默认 1 GiB）的可用空间，供数据库、日志和系统使用。低于此保留空间时：

- `/health/ready` 报告 `"writable": false`，但仍应答 200。
- 上传失败并返回 507，原因为 `storage_full`。下载和控制台继续工作。

服务器不会替您测量可用空间。请使用您自己的工具监视存储卷、数据库卷和备份卷，并在达到保留空间之前告警。保留空间不是配额。`ARKVORY_CAPACITY_BYTES` 限制已保留内容的总和，而不是磁盘检查。参见[存储](./storage)。

## 备份健康 {#backup-health}

备份代理在每次续租时发送心跳。API 将心跳和备份作业的历史记录转换为带有固定代码的警告。关于每个代码要求您做什么，参见[备份](./backups)。

| 代码                                                                            | 严重程度 | 条件                                                         |
| ------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------ |
| `agent_offline`                                                                 | critical | 2 分钟没有心跳                                               |
| `backup_stale`                                                                  | critical | 最新恢复点的存在时间超过 26 小时，且计划已开启               |
| `vault_unavailable`                                                             | critical | 备份存储卷未挂载、没有 `vault.json` 或无法写入               |
| `verify_failed`                                                                 | critical | 某个恢复点未通过验证                                         |
| `vault_not_configured`, `schedule_disabled`, `no_backup_yet`, `last_run_failed` | warning  | 没有备份存储、计划已关闭、尚无首次备份、上次备份失败         |
| `vault_low_space`                                                               | warning  | 备份存储的可用空间少于 10%，或少于上次恢复点新增字节数的两倍 |
| `never_deep_verified`                                                           | warning  | 超过 8 天没有完整验证                                        |

指标 `arkvory_backup_warnings` 携带相同的代码。备份的年龄从其快照时间算起，而不是从它完成的时刻算起。

## 建议的告警 {#alerts}

发行版在 `releases/<version>/deploy/monitoring/arkvory-alerts.yml` 中包含现成的 Prometheus 规则。将该文件添加到 `prometheus.yml` 的 `rule_files` 中。这些阈值只是起点。请根据您实测的流量进行调整。

| 告警                                                            | 条件                                                | 严重程度          |
| --------------------------------------------------------------- | --------------------------------------------------- | ----------------- |
| `ArkvoryDown`                                                   | 抓取失败持续 2 分钟                                 | Critical          |
| `ArkvoryHighServerErrorRate`                                    | 10 分钟内超过 5% 的响应为 5xx                       | Warning           |
| `ArkvorySlowMetadataRequests`                                   | 15 分钟内控制请求的第 99 百分位数高于 2 秒          | Warning           |
| `ArkvoryCompletionBacklog`                                      | 最旧的排队完成作业等待超过 10 分钟                  | Warning           |
| `ArkvoryTransferAdmissionRejections`                            | 15 分钟内每秒超过 0.1 次被拒绝或超时的传输          | Warning           |
| `ArkvoryDiagnosticsDropped`                                     | 过去 15 分钟内有日志行被丢弃                        | Warning           |
| `ArkvoryMetricsCollectionFailing`                               | 无法读取某个由数据库支持的指标                      | Warning           |
| `ArkvoryTlsCertificateExpiring`, `ArkvoryTlsCertificateExpired` | 内置证书在 14 天内到期，或已过期                    | Warning, critical |
| `ArkvoryBackupStale`                                            | 最新恢复点的存在时间超过 26 小时                    | Critical          |
| `ArkvoryBackupAgentOffline`                                     | 超过 2 分钟没有心跳，持续 5 分钟                    | Critical          |
| `ArkvoryBackupWarning`                                          | `vault_unavailable` 或 `verify_failed` 持续 10 分钟 | Critical          |
| `ArkvoryMirrorStale`                                            | 镜像已有一小时未追平其源                            | Warning           |
| `ArkvoryMirrorFailing`                                          | 镜像的上次同步失败，持续 15 分钟                    | Warning           |
| `ArkvoryRestartLoop`                                            | API 进程在 30 分钟内重启了 3 次或更多               | Warning           |

请自行添加以下告警，因为 Arkvory 不导出这些数据：

| 告警                               | 来源                           | 原因                                   |
| ---------------------------------- | ------------------------------ | -------------------------------------- |
| 存储卷、数据库卷和备份卷的可用空间 | `node_exporter`                | 磁盘写满会停止上传、数据库和备份       |
| PostgreSQL 宕机或连接数过多        | `postgres_exporter`            | 数据库不可用期间，API 会退出并重启     |
| 公共状态不是 `ready`               | 对 `/health/status` 的外部探测 | 从客户端角度看到的网络路径、代理和证书 |

针对存储卷和 PostgreSQL，发行版在 `deploy/monitoring/arkvory-host-alerts.yml` 中提供了面向 `node_exporter` 和 `postgres_exporter` 的现成规则。加载该文件前，请把 `mountpoint` 表达式替换为你自己的存储卷。

对告警测试一次。例如，停止 `arkvory-backup`：`ArkvoryBackupAgentOffline` 会在大约 7 到 8 分钟后触发（2 分钟没有心跳，规则中 5 分钟，再加上抓取间隔）。

## 相关页面 {#related-pages}

- [自愈](./self-healing)
- [故障排查](./troubleshooting)
- [备份](./backups)
- [环境变量](../reference/environment)
- [错误](../api/errors)
