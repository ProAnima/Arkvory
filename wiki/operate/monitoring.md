---
title: Monitoring
description: Health endpoints, metrics, logs, console diagnostics and a suggested alert list for an Arkvory server.
---

# Monitoring

Arkvory gives you four sources of facts: health endpoints that answer "is it up", Prometheus metrics, JSON log lines, and the diagnostics of the console. This page lists what each source contains and ends with a set of alerts to start with.

The metrics, the health endpoints and the log events describe one API process. The worker and the backup agent have no HTTP port. You see them through log lines, through the completion queue metrics and through the backup status.

## Check a server now {#quick-check}

1. Ask the public status endpoint. It needs no key:

   ```bash
   curl -fsS http://127.0.0.1:8080/health/status
   ```

   `{"status":"ready"}` with HTTP 200 means that the API reaches its database and its storage directory.

2. Ask for the full readiness answer with the health key that the installer created:

   ```bash
   sudo sh -c 'curl -fsS -H "Authorization: Bearer $(cat /opt/proanima-arkvory/config/health-token.txt)" http://127.0.0.1:8080/health/ready'
   ```

   ```powershell
   $root = 'C:\ProgramData\ProAnima\Arkvory'
   $key = (Get-Content "$root\config\health-token.txt" -Raw).Trim()
   Invoke-RestMethod -Headers @{ Authorization = "Bearer $key" } http://127.0.0.1:8080/health/ready
   ```

3. Check the backups:

   ```bash
   arkvoryctl backup status
   ```

   The command needs the recovery key or the session of an administrator. It exits with code 9 when a critical warning is active. For unattended checks use the Prometheus alerts below. See [Command line](../protocols/cli).

4. Check the services and the newest log lines. See [Logs](#logs).

`arkvory status --root <root>` prints the installed version, the installation mode and the update policy. It does not probe the server. `arkvoryctl doctor` shows the server, the repository, the capabilities and the permissions of one key. It is a client check, not a health check.

## Health and readiness {#health}

Three endpoints answer on the API port. None of them counts against the request budget `ARKVORY_MAX_REQUESTS`, so a transfer load cannot make a server look dead. All three keep answering while the server drains before a stop.

| Path             | Key           | Answer                                                                                                       | Use it for                                     |
| ---------------- | ------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `/health/live`   | No            | 200 `{"status":"ok"}` as long as the process answers                                                         | A process check                                |
| `/health/status` | No            | 200 `{"status":"ready"}`, or 503 `{"status":"unavailable"}` or `{"status":"draining"}` with `Retry-After: 2` | Load balancers and uptime probes               |
| `/health/ready`  | Any valid key | 200 with the details below, or 503 with the error envelope and `Retry-After`                                 | Deployment checks and the Compose health check |

`/health/status` and `/health/ready` check three things: the database answers and has exactly the migrations of this release, the `blobs` folder of the storage directory exists, and the process still owns its storage lock. The result of `/health/status` is cached for one second, so public probes cannot multiply database queries. A draining server answers `draining` at once.

Without a key `/health/ready` returns 401. The key `deployment-health` that the installer creates has no repository rights and no administrator rights. Its secret is in `config/health-token.txt`.

A 200 answer of `/health/ready` has these fields:

| Field             | Meaning                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`          | Always `ready` in a 200 answer                                                                                                                                                                                                                                                                                                               |
| `writable`        | `false` when the free space of the storage volume is below `ARKVORY_STORAGE_RESERVE_BYTES`, and on a read gateway. Reads still work                                                                                                                                                                                                          |
| `role`            | `api`, or `reader` for a read gateway                                                                                                                                                                                                                                                                                                        |
| `sharedDownloads` | The lease of a read gateway (`slot`, `slots`, `active`, `leaseSeconds`), or `null`                                                                                                                                                                                                                                                           |
| `transfers`       | For `uploads` and `downloads`: `admission` (`active`, `waiting`, `capacity`, `perPrincipalCapacity`, `waitingCapacity`, `perPrincipalWaitingCapacity`, `timeoutMs`, `rejected`, `timedOut`, `cancelled`) and `bandwidth` (`bytesPerSecond`, `perPrincipalBytesPerSecond`, `burstBytes`, `perPrincipalBurstBytes`, `waiting`, `grantedBytes`) |

A failed readiness check alone never restarts a service. See [Self-healing](./self-healing).

## Metrics {#metrics}

`GET /health/metrics` returns the metrics of the API process in the Prometheus text format (version 0.0.4). Any valid key may read it, and it works while the server drains. Create a service key with the fewest rights for the scraper, and keep it in a file that only Prometheus reads.

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

The job must be named `arkvory`: the shipped alert rules select it by name.

Values belong to the process and start from zero after a restart. `arkvory_process_start_time_seconds` changes when that happens. Labels are bounded: `route` is the route template, never the URL, and `status_class` is `2xx`, `5xx` and so on.

| Metric                                                                                      | Labels                                                     | Meaning                                                                                  |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `arkvory_http_requests_total`                                                               | `method`, `route`, `status_class`                          | Closed responses                                                                         |
| `arkvory_http_request_duration_seconds`                                                     | same                                                       | Duration histogram from 5 ms to 1800 s. Aborted transfers are included                   |
| `arkvory_http_request_bytes_total`, `arkvory_http_response_bytes_total`                     | `method`, `route`                                          | Socket bytes, headers included                                                           |
| `arkvory_http_requests_in_flight`                                                           |                                                            | Admitted requests whose responses are still open                                         |
| `arkvory_transfer_active`, `arkvory_transfer_queue_depth`                                   | `direction`                                                | Admitted transfers and transfers that wait for a slot                                    |
| `arkvory_transfer_admission_failures_total`                                                 | `direction`, `reason`                                      | Transfers refused by admission: `rejected` (queue full), `timed_out`, `cancelled`        |
| `arkvory_completion_jobs`                                                                   | `state` (`queued`, `running`)                              | Upload completion jobs in the database                                                   |
| `arkvory_completion_oldest_queued_seconds`                                                  |                                                            | Wait of the oldest runnable queued job                                                   |
| `arkvory_diagnostic_records_total`                                                          | `outcome` (`written`, `dropped`, `truncated`, `oversized`) | Log lines by outcome                                                                     |
| `arkvory_metrics_collection_failures_total`                                                 | `collector` (`jobs`, `backup`, `mirror`, `webhook`)        | Failed reads of database-backed metrics                                                  |
| `arkvory_backup_last_success_timestamp_seconds`                                             |                                                            | Snapshot time of the newest completed backup point                                       |
| `arkvory_backup_agent_last_seen_timestamp_seconds`                                          |                                                            | Last heartbeat of the backup agent                                                       |
| `arkvory_backup_warnings`                                                                   | `code`                                                     | 1 while the warning is active, 0 otherwise                                               |
| `arkvory_mirror_last_sync_timestamp_seconds`, `arkvory_mirror_last_check_timestamp_seconds` | `repository`, `mode`                                       | Last catch-up with the source and last read of its feed                                  |
| `arkvory_mirror_failing`                                                                    | `repository`, `mode`                                       | 1 while the last synchronization attempt failed                                          |
| `arkvory_webhook_failing`, `arkvory_webhook_last_success_timestamp_seconds`                 | `subscription`, `repository`                               | Webhook delivery: 1 while the last attempt failed, and the time of the last `2xx` answer |
| `arkvory_tls_certificate_expiry_timestamp_seconds`                                          |                                                            | Expiry of the built-in HTTPS certificate. Present only with built-in HTTPS               |
| `arkvory_build_info`                                                                        | `service`, `version`                                       | Always 1                                                                                 |
| `arkvory_process_start_time_seconds`, `arkvory_process_resident_memory_bytes`               |                                                            | Start time and resident memory                                                           |

The database-backed metrics (completion, backup, mirror) are read at most every 5 seconds. When a read fails, the server leaves these metrics out instead of showing old values, and `arkvory_metrics_collection_failures_total` grows.

The 99th percentile of the control requests, without file transfers:

```text
histogram_quantile(0.99, sum by (le) (rate(arkvory_http_request_duration_seconds_bucket{route!~".*(content|parts).*"}[10m])))
```

Arkvory does not export the free space of the storage volume or of the database. Use `node_exporter` for the volumes and `postgres_exporter` for PostgreSQL.

## Logs {#logs}

The API, the worker, the backup agent and the maintenance tools write one JSON object per line to standard output. The server does not write log files itself. The service manager of your platform collects the lines.

| Installation                   | Where to read                                                                                                                                                                                                                                      | Rotation                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Linux (packages, `install.sh`) | `journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup`. The managed database is `arkvory-database`, the updater is `arkvory-update`                                                                                                       | Set by journald                        |
| Windows                        | `logs\arkvory-api.out.log`, `arkvory-worker.out.log`, `arkvory-backup.out.log` in the installation root. Error output goes to the `.err.log` files next to them. The updater writes `logs\updater.log`, the database service writes to `database\` | 20 MiB per file, 5 old files kept      |
| Docker Compose                 | `docker logs --tail 100 proanima-arkvory-api-1`, and the same for `-worker-1` and `-backup-1`                                                                                                                                                      | 20 MiB per file, 5 files per container |

A hang ends a process with the record `process.stalled` on standard error, so look into the `.err.log` file or the journal too. See [Windows](../install/windows#logs) for the other files in `logs\`.

Every line starts with the same fields:

| Field                        | Value                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `timestamp`                  | UTC time in ISO 8601                                                                                         |
| `level`                      | `debug`, `info`, `warning` or `error`                                                                        |
| `service`                    | `api`, `worker`, `backup`, `migrate`, `gc` or `scrub`                                                        |
| `version`, `pid`, `hostname` | Release, process and host                                                                                    |
| `component`                  | `api`, `http`, `storage`, `worker`, `maintenance`, `backup`, `mirror`, `migrate`, `process` or `diagnostics` |
| `code`                       | The event name                                                                                               |

Other fields come from a fixed list: identifiers (`requestId`, `traceId`, `jobId`, `uploadId`, `artifactId`, `repository`, `principal`, `clientIp`), numbers (`status`, `durationMs`, `bytesSent`, `bytesReceived`, `attempts`) and reason fields (`errorCode`, `errorName`, `errno`, `sqlstate`, `reason`). `ARKVORY_LOG_LEVEL` sets the lowest level that is written.

### Important events {#log-events}

| Event (`code`)                                                                                        | Level                          | Meaning and first action                                                                                                |
| ----------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `api.listening`                                                                                       | info                           | The API serves requests. Fields `address`, `port` and `tls`                                                             |
| `startup.failed`                                                                                      | error                          | The API did not start. `reason` names the cause. See [Troubleshooting](./troubleshooting#server-does-not-start)         |
| `worker.unavailable`                                                                                  | error                          | The worker did not start or stopped with an error                                                                       |
| `http.plaintext_exposed`                                                                              | warning                        | The API listens on a non-loopback address without TLS and without a trusted proxy                                       |
| `http.access`                                                                                         | info                           | One line per finished or aborted request                                                                                |
| the error code of a request, for example `unavailable` or `internal`                                  | warning for 4xx, error for 5xx | A failed request with `requestId`, `route`, `status` and, for system errors, `errorName`, `errno` or `sqlstate`         |
| `upload.input_timeout`, `upload.deadline`                                                             | warning                        | An upload stopped sending data, or took longer than `ARKVORY_UPLOAD_DEADLINE_MS`                                        |
| `api.ownership_lost`, `worker.ownership_lost`                                                         | error                          | The database session that proves ownership of the storage broke. The process exits and restarts                         |
| `process.stalled`                                                                                     | error                          | The watchdog ended a hung process. Field `stalledSeconds`                                                               |
| `process.unhandled`                                                                                   | error                          | An unexpected error ended the process                                                                                   |
| `process.watchdog_failed`                                                                             | warning                        | The watchdog could not start. The service runs without it                                                               |
| `drain.started`, `drain.settled`, `drain.timeout`, `api.stopped`                                      | info or warning                | A graceful stop. `drain.timeout` means that requests were cut off                                                       |
| `tls.reloaded`, `tls.reload_failed`, `tls.expiring`                                                   | info or warning                | Certificate files were read again, could not be read, or expire in less than 14 days. `tls.expiring` repeats once a day |
| `completion.completed`, `completion.failed`, `completion.lease_lost`, `completion.attempts_exhausted` | info or error                  | The result of an upload completion job, with `jobId`, `uploadId` and `errorCode`                                        |
| `backup.agent.started`, `backup.agent.standby`, `backup.agent.lease_lost`                             | info or warning                | State of the backup agent                                                                                               |
| `backup.request.failed`, `backup.request.requeued`, `backup.failed`                                   | error or warning               | A backup job failed or runs again. Field `errorCode`                                                                    |
| `mirror.step_failed`, `mirror.recovered`                                                              | warning or info                | A mirror synchronization step failed (`errorCode`, `attempts`), or works again                                          |
| `webhook.step_failed`, `webhook.recovered`                                                            | warning or info                | A webhook delivery failed (`subscription`, `errorCode`, `attempts`), or works again                                     |
| `migrate.started`, `migrate.completed`, `migrate.failed`                                              | info or error                  | The database migration of an update                                                                                     |
| `diagnostics.dropped`, `diagnostics.oversized`                                                        | warning                        | Lines were discarded because the log reader is too slow, or a line was too long                                         |

A slow log reader never slows a transfer. When the output is blocked, the server discards lines, counts them, and writes `diagnostics.dropped` with the number after the output is free again. A line longer than 4096 characters is replaced by `diagnostics.oversized`. Text fields are cut at 256 characters.

### Request IDs {#request-ids}

Every response carries the header `X-Request-Id`, and every error body has the field `requestId`. The same value is in the `http.access` line, in the error line, in the lines of the completion job that the request started, and in the audit records. A client that reports a problem needs to give you only this value.

```bash
journalctl -u arkvory-api -u arkvory-worker --since "1 hour ago" -o cat | grep 'REQUEST_ID'
```

```powershell
Select-String -Path "$root\logs\*.log" -Pattern 'REQUEST_ID'
```

Behind a reverse proxy, the server takes an incoming `X-Request-Id` only from an address in `ARKVORY_TRUSTED_PROXIES`, and only if it is a single value of 8 to 128 characters (letters, digits, `.`, `_`, `:` and `-`). Let the proxy overwrite the header, for example with `proxy_set_header X-Request-Id $request_id;` in nginx. A valid W3C `traceparent` header from any client becomes the field `traceId`. It is for searching only and never grants anything.

### What is never logged {#never-logged}

The log has no passwords, keys, tokens, `Authorization` headers, request bodies, query strings, URLs or exception texts. Download links carry a secret in the query string, so only the route template is logged. The field `reason` is the only free text. It is redacted and cut at 240 characters. The line shows the `principal` (the ID of an account or key) and the `clientIp`. Treat the log as personal data.

`ARKVORY_ACCESS_LOG=false` turns off `http.access`. Successful requests to `/health/live` and `/health/status` are never logged. The levels `warning` and `error` also hide the access lines.

## Diagnostics in the console {#console}

Administrators see the state of the server in the console without a shell. See [The web console](../guide/console).

| Where                                    | What you see                                                                                                                                                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [[ui:backups]]                           | The headline states [[ui:backupStateOk]], [[ui:backupStateWarning]] and [[ui:backupStateCritical]]. Below are the [[ui:backupNewest]] backup, the [[ui:backupNextRun]], the [[ui:backupAgent]], the [[ui:backupVault]] and the list of warnings with the action for each |
| [[ui:updates]]                           | The installed and the latest version, the time of the last check, and the state of the host updater                                                                                                                                                                      |
| [[ui:repositoryStorage]] of a repository | The use of the quota with the states [[ui:storageWarning]] and [[ui:storageCritical]], and the list [[ui:storageEvents]]                                                                                                                                                 |
| [[ui:serviceAudit]] of a service account | Who created, changed, issued or revoked what                                                                                                                                                                                                                             |
| The repository card                      | The badge [[ui:mirrorBadge]], with the state [[ui:mirrorFailing]] when the last synchronization failed                                                                                                                                                                   |

The list [[ui:storageEvents]] needs the permission to read diagnostics. Among other events it holds the failed requests of service keys in that repository, with the request ID, the route and the status.

Quota thresholds are 80 % for the warning and 95 % for the critical state, unless an administrator changed them. A repository without a quota has no thresholds.

## Storage and disk warnings {#storage}

The server keeps `ARKVORY_STORAGE_RESERVE_BYTES` (1 GiB by default) of free space on the storage volume for the database, the logs and the system. Below this reserve:

- `/health/ready` reports `"writable": false`, but still answers 200.
- Uploads fail with 507 and the reason `storage_full`. Downloads and the console keep working.

The server does not measure free space for you. Watch the storage volume, the database volume and the backup volume with your own tools, and alert before the reserve is reached. The reserve is not a quota. `ARKVORY_CAPACITY_BYTES` limits the sum of reserved content and is not a disk check. See [Storage](./storage).

## Backup health {#backup-health}

The backup agent sends a heartbeat with every lease renewal. The API turns the heartbeat and the history of backup jobs into warnings with fixed codes. See [Backups](./backups) for what each code asks you to do.

| Code                                                                            | Severity | Condition                                                                             |
| ------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| `agent_offline`                                                                 | critical | No heartbeat for 2 minutes                                                            |
| `backup_stale`                                                                  | critical | The newest point is older than 26 hours and the plan is on                            |
| `vault_unavailable`                                                             | critical | The vault volume is not mounted, has no `vault.json` or cannot be written             |
| `verify_failed`                                                                 | critical | A restore point failed its verification                                               |
| `vault_not_configured`, `schedule_disabled`, `no_backup_yet`, `last_run_failed` | warning  | No vault, plan off, no first backup, last backup failed                               |
| `vault_low_space`                                                               | warning  | The vault has less than 10 % free, or less than twice the new bytes of the last point |
| `never_deep_verified`                                                           | warning  | No full verification for more than 8 days                                             |

The metric `arkvory_backup_warnings` carries the same codes. The age of a backup counts from its snapshot time, not from the moment it finished.

## Suggested alerts {#alerts}

The release contains ready Prometheus rules in `releases/<version>/deploy/monitoring/arkvory-alerts.yml`. Add the file to `rule_files` in `prometheus.yml`. The thresholds are starting points. Tune them with the traffic that you measure.

| Alert                                                           | Condition                                                              | Severity          |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------- |
| `ArkvoryDown`                                                   | The scrape fails for 2 minutes                                         | Critical          |
| `ArkvoryHighServerErrorRate`                                    | More than 5 % of responses are 5xx for 10 minutes                      | Warning           |
| `ArkvorySlowMetadataRequests`                                   | The 99th percentile of control requests is above 2 s for 15 minutes    | Warning           |
| `ArkvoryCompletionBacklog`                                      | The oldest queued completion job waits more than 10 minutes            | Warning           |
| `ArkvoryTransferAdmissionRejections`                            | More than 0.1 refused or timed-out transfers per second for 15 minutes | Warning           |
| `ArkvoryDiagnosticsDropped`                                     | Log lines were discarded in the last 15 minutes                        | Warning           |
| `ArkvoryMetricsCollectionFailing`                               | A database-backed metric could not be read                             | Warning           |
| `ArkvoryTlsCertificateExpiring`, `ArkvoryTlsCertificateExpired` | The built-in certificate expires in less than 14 days, or has expired  | Warning, critical |
| `ArkvoryBackupStale`                                            | The newest point is older than 26 hours                                | Critical          |
| `ArkvoryBackupAgentOffline`                                     | No heartbeat for more than 2 minutes, for 5 minutes                    | Critical          |
| `ArkvoryBackupWarning`                                          | `vault_unavailable` or `verify_failed` for 10 minutes                  | Critical          |
| `ArkvoryMirrorStale`                                            | A mirror has not caught up with its source for an hour                 | Warning           |
| `ArkvoryMirrorFailing`                                          | The last synchronization of a mirror failed, for 15 minutes            | Warning           |
| `ArkvoryRestartLoop`                                            | The API process restarted 3 or more times in 30 minutes                | Warning           |
| `ArkvoryWebhookFailing`                                         | A webhook delivery has failed for 15 minutes                           | Warning           |

Add these alerts yourself, because Arkvory does not export the data:

| Alert                                                  | Source                                | Why                                                                 |
| ------------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------- |
| Free space of the storage, database and backup volumes | `node_exporter`                       | A full disk stops uploads, the database and the backups             |
| PostgreSQL is down or has too many connections         | `postgres_exporter`                   | The API exits and restarts while the database is away               |
| The public status is not `ready`                       | An external probe of `/health/status` | The network path, the proxy and the certificate, seen from a client |

For the volumes and for PostgreSQL the release contains ready rules for `node_exporter` and `postgres_exporter` in `deploy/monitoring/arkvory-host-alerts.yml`. Replace the `mountpoint` expressions with your own volumes before you load the file.

Test an alert once. For example, stop `arkvory-backup`: `ArkvoryBackupAgentOffline` fires about 7 to 8 minutes later (2 minutes without heartbeat, 5 minutes in the rule, plus the scrape interval).

## Related pages {#related-pages}

- [Self-healing](./self-healing)
- [Troubleshooting](./troubleshooting)
- [Backups](./backups)
- [Environment variables](../reference/environment)
- [Errors](../api/errors)
