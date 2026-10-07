---
title: '모니터링'
description: '상태 엔드포인트, 메트릭, 로그, 콘솔 진단, 그리고 Arkvory 서버를 위한 제안 경보 목록입니다.'
---

# 모니터링

Arkvory는 네 가지 정보 출처를 제공합니다. "작동 중인가"를 답하는 상태 엔드포인트, Prometheus 메트릭, JSON 로그 줄, 그리고 콘솔의 진단입니다. 이 페이지는 각 출처에 무엇이 들어 있는지 설명하고, 시작할 때 사용할 경보 집합으로 끝납니다.

메트릭, 상태 엔드포인트, 로그 이벤트는 하나의 API 프로세스를 설명합니다. 워커와 백업 에이전트에는 HTTP 포트가 없습니다. 이들은 로그 줄, 완료 대기열 메트릭, 백업 상태를 통해 확인합니다.

## 지금 서버 확인 {#quick-check}

1. 공개 상태 엔드포인트를 호출합니다. 키가 필요하지 않습니다:

   ```bash
   curl -fsS http://127.0.0.1:8080/health/status
   ```

   HTTP 200과 함께 `{"status":"ready"}`는 API가 데이터베이스와 스토리지 디렉터리에 도달했음을 의미합니다.

2. 설치 프로그램이 만든 상태 키로 전체 준비 상태 응답을 요청합니다:

   ```bash
   sudo sh -c 'curl -fsS -H "Authorization: Bearer $(cat /opt/proanima-arkvory/config/health-token.txt)" http://127.0.0.1:8080/health/ready'
   ```

   ```powershell
   $root = 'C:\ProgramData\ProAnima\Arkvory'
   $key = (Get-Content "$root\config\health-token.txt" -Raw).Trim()
   Invoke-RestMethod -Headers @{ Authorization = "Bearer $key" } http://127.0.0.1:8080/health/ready
   ```

3. 백업을 확인합니다:

   ```bash
   arkvoryctl backup status
   ```

   이 명령에는 복구 키 또는 관리자 세션이 필요합니다. 심각한 경고가 활성 상태이면 종료 코드 9로 종료됩니다. 무인 확인에는 아래의 Prometheus 경보를 사용하세요. [명령줄](../protocols/cli)을 참조하세요.

4. 서비스와 최신 로그 줄을 확인합니다. [로그](#logs)를 참조하세요.

`arkvory status --root <root>`는 설치된 버전, 설치 모드, 업데이트 정책을 출력합니다. 서버를 검사하지는 않습니다. `arkvoryctl doctor`는 서버, 리포지토리, 기능, 키의 권한을 보여 줍니다. 상태 확인이 아니라 클라이언트 확인입니다.

## 상태와 준비 상태 {#health}

API 포트에서 세 개의 엔드포인트가 응답합니다. 어느 것도 요청 예산 `ARKVORY_MAX_REQUESTS`에 포함되지 않으므로, 전송 부하 때문에 서버가 죽은 것처럼 보이지 않습니다. 세 엔드포인트 모두 서버가 중지 전에 드레이닝하는 동안에도 계속 응답합니다.

| 경로             | 키             | 응답                                                                                                               | 사용 용도                      |
| ---------------- | -------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `/health/live`   | 없음           | 프로세스가 응답하는 한 200 `{"status":"ok"}`                                                                       | 프로세스 확인                  |
| `/health/status` | 없음           | 200 `{"status":"ready"}`, 또는 `Retry-After: 2`와 함께 503 `{"status":"unavailable"}` 또는 `{"status":"draining"}` | 로드 밸런서와 가동 시간 프로브 |
| `/health/ready`  | 모든 유효한 키 | 아래의 세부 정보와 함께 200, 또는 오류 봉투와 `Retry-After`와 함께 503                                             | 배포 확인과 Compose 상태 확인  |

`/health/status`와 `/health/ready`는 세 가지를 확인합니다. 데이터베이스가 응답하고 이 릴리스의 마이그레이션을 정확히 가지고 있는지, 스토리지 디렉터리의 `blobs` 폴더가 존재하는지, 프로세스가 여전히 스토리지 잠금을 소유하고 있는지입니다. `/health/status`의 결과는 1초 동안 캐시되므로 공개 프로브가 데이터베이스 쿼리를 증폭시킬 수 없습니다. 드레이닝 중인 서버는 즉시 `draining`으로 응답합니다.

키가 없으면 `/health/ready`는 401을 반환합니다. 설치 프로그램이 만드는 `deployment-health` 키에는 리포지토리 권한과 관리자 권한이 없습니다. 이 키의 시크릿은 `config/health-token.txt`에 있습니다.

`/health/ready`의 200 응답에는 다음 필드가 있습니다:

| 필드              | 의미                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `status`          | 200 응답에서 항상 `ready`                                                                                                                                                                                                                                                                                                                  |
| `writable`        | 스토리지 볼륨의 여유 공간이 `ARKVORY_STORAGE_RESERVE_BYTES`보다 적을 때와 읽기 게이트웨이에서 `false`입니다. 읽기는 계속 작동합니다                                                                                                                                                                                                        |
| `role`            | `api`, 읽기 게이트웨이의 경우 `reader`                                                                                                                                                                                                                                                                                                     |
| `sharedDownloads` | 읽기 게이트웨이의 임대(`slot`, `slots`, `active`, `leaseSeconds`), 또는 `null`                                                                                                                                                                                                                                                             |
| `transfers`       | `uploads`와 `downloads`의 경우: `admission`(`active`, `waiting`, `capacity`, `perPrincipalCapacity`, `waitingCapacity`, `perPrincipalWaitingCapacity`, `timeoutMs`, `rejected`, `timedOut`, `cancelled`) 및 `bandwidth`(`bytesPerSecond`, `perPrincipalBytesPerSecond`, `burstBytes`, `perPrincipalBurstBytes`, `waiting`, `grantedBytes`) |

준비 상태 확인 실패만으로 서비스를 다시 시작하지는 않습니다. [자가 복구](./self-healing)를 참조하세요.

## 메트릭 {#metrics}

`GET /health/metrics`는 API 프로세스의 메트릭을 Prometheus 텍스트 형식(버전 0.0.4)으로 반환합니다. 모든 유효한 키로 읽을 수 있으며, 서버가 드레이닝하는 동안에도 작동합니다. 스크레이퍼를 위해 최소 권한을 가진 서비스 키를 만들고, Prometheus만 읽는 파일에 보관하세요.

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

작업 이름은 `arkvory`여야 합니다. 함께 제공되는 경보 규칙이 이름으로 선택하기 때문입니다.

값은 프로세스에 속하며 재시작 후 0에서 시작합니다. 그럴 때 `arkvory_process_start_time_seconds`가 바뀝니다. 레이블은 제한적입니다. `route`는 URL이 아니라 라우트 템플릿이고, `status_class`는 `2xx`, `5xx` 등입니다.

| 메트릭                                                                                      | 레이블                                                     | 의미                                                                       |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `arkvory_http_requests_total`                                                               | `method`, `route`, `status_class`                          | 종료된 응답                                                                |
| `arkvory_http_request_duration_seconds`                                                     | 동일                                                       | 5 ms에서 1800 s까지의 기간 히스토그램. 중단된 전송도 포함됩니다            |
| `arkvory_http_request_bytes_total`, `arkvory_http_response_bytes_total`                     | `method`, `route`                                          | 소켓 바이트, 헤더 포함                                                     |
| `arkvory_http_requests_in_flight`                                                           |                                                            | 응답이 아직 열려 있는 허용된 요청                                          |
| `arkvory_transfer_active`, `arkvory_transfer_queue_depth`                                   | `direction`                                                | 허용된 전송과 슬롯을 기다리는 전송                                         |
| `arkvory_transfer_admission_failures_total`                                                 | `direction`, `reason`                                      | 허용에서 거부된 전송: `rejected`(대기열 가득 참), `timed_out`, `cancelled` |
| `arkvory_completion_jobs`                                                                   | `state` (`queued`, `running`)                              | 데이터베이스의 업로드 완료 작업                                            |
| `arkvory_completion_oldest_queued_seconds`                                                  |                                                            | 실행 가능한 가장 오래된 대기 작업의 대기 시간                              |
| `arkvory_diagnostic_records_total`                                                          | `outcome` (`written`, `dropped`, `truncated`, `oversized`) | 결과별 로그 줄                                                             |
| `arkvory_metrics_collection_failures_total`                                                 | `collector` (`jobs`, `backup`, `mirror`)                   | 데이터베이스 기반 메트릭 읽기 실패                                         |
| `arkvory_backup_last_success_timestamp_seconds`                                             |                                                            | 가장 최근에 완료된 백업 지점의 스냅샷 시각                                 |
| `arkvory_backup_agent_last_seen_timestamp_seconds`                                          |                                                            | 백업 에이전트의 마지막 하트비트                                            |
| `arkvory_backup_warnings`                                                                   | `code`                                                     | 경고가 활성 상태이면 1, 그렇지 않으면 0                                    |
| `arkvory_mirror_last_sync_timestamp_seconds`, `arkvory_mirror_last_check_timestamp_seconds` | `repository`, `mode`                                       | 원본과의 마지막 따라잡기와 피드의 마지막 읽기                              |
| `arkvory_mirror_failing`                                                                    | `repository`, `mode`                                       | 마지막 동기화 시도가 실패했으면 1                                          |
| `arkvory_tls_certificate_expiry_timestamp_seconds`                                          |                                                            | 내장 HTTPS 인증서의 만료. 내장 HTTPS에서만 제공됩니다                      |
| `arkvory_build_info`                                                                        | `service`, `version`                                       | 항상 1                                                                     |
| `arkvory_process_start_time_seconds`, `arkvory_process_resident_memory_bytes`               |                                                            | 시작 시각과 상주 메모리                                                    |

데이터베이스 기반 메트릭(완료, 백업, 미러)은 최대 5초마다 읽습니다. 읽기가 실패하면 서버는 오래된 값을 보여 주는 대신 이 메트릭들을 생략하고, `arkvory_metrics_collection_failures_total`이 증가합니다.

파일 전송을 제외한 제어 요청의 99번째 백분위수:

```text
histogram_quantile(0.99, sum by (le) (rate(arkvory_http_request_duration_seconds_bucket{route!~".*(content|parts).*"}[10m])))
```

Arkvory는 스토리지 볼륨이나 데이터베이스의 여유 공간을 내보내지 않습니다. 볼륨에는 `node_exporter`를, PostgreSQL에는 `postgres_exporter`를 사용하세요.

## 로그 {#logs}

API, 워커, 백업 에이전트, 유지 관리 도구는 표준 출력에 한 줄에 하나의 JSON 객체를 기록합니다. 서버는 스스로 로그 파일을 작성하지 않습니다. 플랫폼의 서비스 관리자가 줄을 수집합니다.

| 설치 방식                   | 확인 위치                                                                                                                                                                                                                 | 교체 및 보관                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Linux(패키지, `install.sh`) | `journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup`. 관리형 데이터베이스는 `arkvory-database`, 업데이터는 `arkvory-update`입니다                                                                              | journald가 설정                    |
| Windows                     | 설치 루트의 `logs\arkvory-api.out.log`, `arkvory-worker.out.log`, `arkvory-backup.out.log`. 오류 출력은 그 옆의 `.err.log` 파일로 갑니다. 업데이터는 `logs\updater.log`에, 데이터베이스 서비스는 `database\`에 기록합니다 | 파일당 20 MiB, 이전 파일 5개 보관  |
| Docker Compose              | `docker logs --tail 100 proanima-arkvory-api-1`, 그리고 `-worker-1`과 `-backup-1`도 동일                                                                                                                                  | 파일당 20 MiB, 컨테이너당 파일 5개 |

응답 중단은 표준 오류에 `process.stalled` 기록을 남기고 프로세스를 종료하므로, `.err.log` 파일이나 journal도 확인하세요. `logs\`의 다른 파일은 [Windows](../install/windows#logs)를 참조하세요.

모든 줄은 동일한 필드로 시작합니다:

| 필드                         | 값                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `timestamp`                  | ISO 8601의 UTC 시각                                                                                            |
| `level`                      | `debug`, `info`, `warning` 또는 `error`                                                                        |
| `service`                    | `api`, `worker`, `backup`, `migrate`, `gc` 또는 `scrub`                                                        |
| `version`, `pid`, `hostname` | 릴리스, 프로세스, 호스트                                                                                       |
| `component`                  | `api`, `http`, `storage`, `worker`, `maintenance`, `backup`, `mirror`, `migrate`, `process` 또는 `diagnostics` |
| `code`                       | 이벤트 이름                                                                                                    |

다른 필드는 고정 목록에서 옵니다. 식별자(`requestId`, `traceId`, `jobId`, `uploadId`, `artifactId`, `repository`, `principal`, `clientIp`), 숫자(`status`, `durationMs`, `bytesSent`, `bytesReceived`, `attempts`) 및 사유 필드(`errorCode`, `errorName`, `errno`, `sqlstate`, `reason`)입니다. `ARKVORY_LOG_LEVEL`은 기록되는 최저 수준을 설정합니다.

### 주요 이벤트 {#log-events}

| 이벤트 (`code`)                                                                                       | 수준                           | 의미와 첫 조치                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api.listening`                                                                                       | info                           | API가 요청을 처리합니다. 필드 `address`, `port`, `tls`                                                                                                                       |
| `startup.failed`                                                                                      | error                          | API가 시작되지 않았습니다. `reason`이 원인을 나타냅니다. [문제 해결](./troubleshooting#server-does-not-start)을 참조하세요                                                   |
| `worker.unavailable`                                                                                  | error                          | 워커가 시작되지 않았거나 오류로 중지되었습니다                                                                                                                               |
| `http.plaintext_exposed`                                                                              | warning                        | API가 TLS와 신뢰할 수 있는 프록시 없이 비루프백 주소에서 수신 대기합니다                                                                                                     |
| `http.access`                                                                                         | info                           | 완료되거나 중단된 요청마다 한 줄                                                                                                                                             |
| the error code of a request, for example `unavailable` or `internal`                                  | warning for 4xx, error for 5xx | 요청의 오류 코드(예: `unavailable` 또는 `internal`). `requestId`, `route`, `status`가 있는 실패한 요청이며, 시스템 오류의 경우 `errorName`, `errno`, `sqlstate`도 포함합니다 |
| `upload.input_timeout`, `upload.deadline`                                                             | warning                        | 업로드가 데이터 전송을 중지했거나 `ARKVORY_UPLOAD_DEADLINE_MS`보다 오래 걸렸습니다                                                                                           |
| `api.ownership_lost`, `worker.ownership_lost`                                                         | error                          | 스토리지 소유권을 증명하는 데이터베이스 세션이 끊어졌습니다. 프로세스가 종료되고 다시 시작됩니다                                                                             |
| `process.stalled`                                                                                     | error                          | 워치독이 응답이 중단된 프로세스를 종료했습니다. 필드 `stalledSeconds`                                                                                                        |
| `process.unhandled`                                                                                   | error                          | 예기치 않은 오류가 프로세스를 종료했습니다                                                                                                                                   |
| `process.watchdog_failed`                                                                             | warning                        | 워치독이 시작되지 못했습니다. 서비스는 워치독 없이 실행됩니다                                                                                                                |
| `drain.started`, `drain.settled`, `drain.timeout`, `api.stopped`                                      | info or warning                | 정상 중지. `drain.timeout`은 요청이 중단되었음을 의미합니다                                                                                                                  |
| `tls.reloaded`, `tls.reload_failed`, `tls.expiring`                                                   | info or warning                | 인증서 파일을 다시 읽었거나, 읽지 못했거나, 14일 이내에 만료됩니다. `tls.expiring`은 하루에 한 번 반복됩니다                                                                 |
| `completion.completed`, `completion.failed`, `completion.lease_lost`, `completion.attempts_exhausted` | info or error                  | 업로드 완료 작업의 결과이며 `jobId`, `uploadId`, `errorCode`를 포함합니다                                                                                                    |
| `backup.agent.started`, `backup.agent.standby`, `backup.agent.lease_lost`                             | info or warning                | 백업 에이전트의 상태                                                                                                                                                         |
| `backup.request.failed`, `backup.request.requeued`, `backup.failed`                                   | error or warning               | 백업 작업이 실패했거나 다시 실행됩니다. 필드 `errorCode`                                                                                                                     |
| `mirror.step_failed`, `mirror.recovered`                                                              | warning or info                | 미러 동기화 단계가 실패했거나(`errorCode`, `attempts`) 다시 작동합니다                                                                                                       |
| `migrate.started`, `migrate.completed`, `migrate.failed`                                              | info or error                  | 업데이트의 데이터베이스 마이그레이션                                                                                                                                         |
| `diagnostics.dropped`, `diagnostics.oversized`                                                        | warning                        | 로그 판독기가 너무 느리거나 줄이 너무 길어서 줄이 버려졌습니다                                                                                                               |

느린 로그 판독기가 전송을 느리게 하지는 않습니다. 출력이 막히면 서버는 줄을 버리고 수를 세며, 출력이 다시 여유로워지면 그 수와 함께 `diagnostics.dropped`를 기록합니다. 4096자보다 긴 줄은 `diagnostics.oversized`로 대체됩니다. 텍스트 필드는 256자에서 잘립니다.

### 요청 ID {#request-ids}

모든 응답은 `X-Request-Id` 헤더를 포함하고, 모든 오류 본문에는 `requestId` 필드가 있습니다. 같은 값이 `http.access` 줄, 오류 줄, 요청이 시작한 완료 작업의 줄, 감사 기록에 들어 있습니다. 문제를 보고하는 클라이언트는 이 값만 알려 주면 됩니다.

```bash
journalctl -u arkvory-api -u arkvory-worker --since "1 hour ago" -o cat | grep 'REQUEST_ID'
```

```powershell
Select-String -Path "$root\logs\*.log" -Pattern 'REQUEST_ID'
```

리버스 프록시 뒤에서 서버는 `ARKVORY_TRUSTED_PROXIES`의 주소에서 온 `X-Request-Id`만, 그리고 그것이 8~128자(문자, 숫자, `.`, `_`, `:` 및 `-`)의 단일 값일 때만 받습니다. 프록시가 헤더를 덮어쓰게 하세요. 예를 들어 nginx에서 `proxy_set_header X-Request-Id $request_id;`를 사용합니다. 모든 클라이언트의 유효한 W3C `traceparent` 헤더는 `traceId` 필드가 됩니다. 검색용일 뿐이며 아무 권한도 부여하지 않습니다.

### 기록되지 않는 것 {#never-logged}

로그에는 비밀번호, 키, 토큰, `Authorization` 헤더, 요청 본문, 쿼리 문자열, URL, 예외 텍스트가 없습니다. 다운로드 링크는 쿼리 문자열에 시크릿을 담고 있으므로 라우트 템플릿만 기록됩니다. `reason` 필드가 유일한 자유 텍스트입니다. 이 필드는 마스킹되고 240자에서 잘립니다. 줄에는 `principal`(계정 또는 키의 ID)과 `clientIp`가 표시됩니다. 로그를 개인 데이터로 취급하세요.

`ARKVORY_ACCESS_LOG=false`는 `http.access`를 끕니다. `/health/live`와 `/health/status`에 대한 성공한 요청은 기록되지 않습니다. `warning`과 `error` 수준은 액세스 줄도 숨깁니다.

## 콘솔의 진단 {#console}

관리자는 셸 없이 콘솔에서 서버 상태를 볼 수 있습니다. [웹 콘솔](../guide/console)을 참조하세요.

| 위치                                  | 표시 내용                                                                                                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [[ui:backups]]                        | 헤드라인에 [[ui:backupStateOk]], [[ui:backupStateWarning]], [[ui:backupStateCritical]]이 표시됩니다. 아래에는 [[ui:backupNewest]] 백업, [[ui:backupNextRun]], [[ui:backupAgent]], [[ui:backupVault]]와 각 경고에 대한 조치가 있는 경고 목록이 있습니다 |
| [[ui:updates]]                        | 설치된 버전과 최신 버전, 마지막 확인 시각, 호스트 업데이터의 상태                                                                                                                                                                                      |
| 리포지토리의 [[ui:repositoryStorage]] | [[ui:storageWarning]]과 [[ui:storageCritical]] 상태가 있는 할당량 사용량, 그리고 [[ui:storageEvents]] 목록                                                                                                                                             |
| 서비스 계정의 [[ui:serviceAudit]]     | 누가 무엇을 만들고, 변경하고, 발급하고, 폐기했는지                                                                                                                                                                                                     |
| 리포지토리 카드                       | 마지막 동기화가 실패했을 때 [[ui:mirrorFailing]] 상태가 있는 배지 [[ui:mirrorBadge]]                                                                                                                                                                   |

[[ui:storageEvents]] 목록은 진단을 읽을 권한이 필요합니다. 다른 이벤트들 중에서 해당 리포지토리의 서비스 키의 실패한 요청을 요청 ID, 라우트, 상태와 함께 보관합니다.

할당량 임계값은 관리자가 변경하지 않는 한 경고가 80 %, 심각 상태가 95 %입니다. 할당량이 없는 리포지토리에는 임계값이 없습니다.

## 스토리지 및 디스크 경고 {#storage}

서버는 데이터베이스, 로그, 시스템을 위해 스토리지 볼륨에 `ARKVORY_STORAGE_RESERVE_BYTES`(기본 1 GiB)의 여유 공간을 유지합니다. 이 예비량 아래에서는:

- `/health/ready`가 `"writable": false`를 보고하지만 여전히 200으로 응답합니다.
- 업로드는 507과 `storage_full` 사유로 실패합니다. 다운로드와 콘솔은 계속 작동합니다.

서버는 여유 공간을 대신 측정하지 않습니다. 자체 도구로 스토리지 볼륨, 데이터베이스 볼륨, 백업 볼륨을 감시하고 예비량에 도달하기 전에 경보하세요. 예비량은 할당량이 아닙니다. `ARKVORY_CAPACITY_BYTES`는 예약된 콘텐츠의 합계를 제한하며 디스크 확인이 아닙니다. [스토리지](./storage)를 참조하세요.

## 백업 상태 {#backup-health}

백업 에이전트는 임대 갱신마다 하트비트를 보냅니다. API는 하트비트와 백업 작업 기록을 고정 코드가 있는 경고로 바꿉니다. 각 코드가 무엇을 요구하는지는 [백업](./backups)을 참조하세요.

| 코드                                                                            | 심각도 | 조건                                                                       |
| ------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------- |
| `agent_offline`                                                                 | 심각   | 2분 동안 하트비트 없음                                                     |
| `backup_stale`                                                                  | 심각   | 가장 최근 지점이 26시간보다 오래되었고 계획이 켜져 있음                    |
| `vault_unavailable`                                                             | 심각   | 백업 보관소 볼륨이 마운트되지 않았거나, `vault.json`이 없거나, 쓸 수 없음  |
| `verify_failed`                                                                 | 심각   | 복원 지점이 검증에 실패함                                                  |
| `vault_not_configured`, `schedule_disabled`, `no_backup_yet`, `last_run_failed` | 경고   | 보관소 없음, 계획 꺼짐, 첫 백업 없음, 마지막 백업 실패                     |
| `vault_low_space`                                                               | 경고   | 백업 보관소의 여유가 10 % 미만이거나, 마지막 지점의 새 바이트의 두 배 미만 |
| `never_deep_verified`                                                           | 경고   | 8일 넘게 전체 검증이 없음                                                  |

메트릭 `arkvory_backup_warnings`는 같은 코드를 사용합니다. 백업의 나이는 완료된 시각이 아니라 스냅샷 시각부터 계산합니다.

## 권장 경보 {#alerts}

릴리스에는 `releases/<version>/deploy/monitoring/arkvory-alerts.yml`에 바로 사용할 수 있는 Prometheus 규칙이 들어 있습니다. `prometheus.yml`의 `rule_files`에 이 파일을 추가하세요. 임계값은 시작점입니다. 측정한 트래픽에 맞게 조정하세요.

| 경보                                                            | 조건                                                  | 심각도     |
| --------------------------------------------------------------- | ----------------------------------------------------- | ---------- |
| `ArkvoryDown`                                                   | 2분 동안 스크레이프 실패                              | 심각       |
| `ArkvoryHighServerErrorRate`                                    | 10분 동안 응답의 5 % 넘게 5xx                         | 경고       |
| `ArkvorySlowMetadataRequests`                                   | 15분 동안 제어 요청의 99번째 백분위수가 2초 초과      | 경고       |
| `ArkvoryCompletionBacklog`                                      | 가장 오래된 대기 완료 작업이 10분 넘게 대기           | 경고       |
| `ArkvoryTransferAdmissionRejections`                            | 15분 동안 초당 0.1건 넘게 전송이 거부되거나 시간 초과 | 경고       |
| `ArkvoryDiagnosticsDropped`                                     | 지난 15분 동안 로그 줄이 버려짐                       | 경고       |
| `ArkvoryMetricsCollectionFailing`                               | 데이터베이스 기반 메트릭을 읽지 못함                  | 경고       |
| `ArkvoryTlsCertificateExpiring`, `ArkvoryTlsCertificateExpired` | 내장 인증서가 14일 이내에 만료되거나 이미 만료됨      | 경고, 심각 |
| `ArkvoryBackupStale`                                            | 가장 최근 지점이 26시간보다 오래됨                    | 심각       |
| `ArkvoryBackupAgentOffline`                                     | 5분 동안 2분 넘게 하트비트 없음                       | 심각       |
| `ArkvoryBackupWarning`                                          | 10분 동안 `vault_unavailable` 또는 `verify_failed`    | 심각       |
| `ArkvoryMirrorStale`                                            | 미러가 한 시간 동안 원본을 따라잡지 못함              | 경고       |
| `ArkvoryMirrorFailing`                                          | 15분 동안 미러의 마지막 동기화 실패                   | 경고       |
| `ArkvoryRestartLoop`                                            | API 프로세스가 30분 동안 3회 이상 다시 시작됨         | 경고       |

Arkvory가 데이터를 내보내지 않으므로 다음 경보는 직접 추가하세요:

| 경보                                          | 출처                           | 이유                                                     |
| --------------------------------------------- | ------------------------------ | -------------------------------------------------------- |
| 스토리지, 데이터베이스, 백업 볼륨의 여유 공간 | `node_exporter`                | 디스크가 가득 차면 업로드, 데이터베이스, 백업이 멈춥니다 |
| PostgreSQL이 다운되었거나 연결이 너무 많음    | `postgres_exporter`            | 데이터베이스가 없으면 API가 종료되고 다시 시작됩니다     |
| 공개 상태가 `ready`가 아님                    | `/health/status`의 외부 프로브 | 클라이언트에서 본 네트워크 경로, 프록시, 인증서          |

볼륨과 PostgreSQL용으로, 릴리스에는 `node_exporter`와 `postgres_exporter`용 규칙이 `deploy/monitoring/arkvory-host-alerts.yml`에 준비되어 있습니다. 파일을 불러오기 전에 `mountpoint` 표현식을 사용 중인 볼륨으로 바꾸세요.

경보를 한 번 테스트하세요. 예를 들어 `arkvory-backup`을 중지하면 `ArkvoryBackupAgentOffline`이 약 7~8분 후에 발생합니다(하트비트 없는 2분, 규칙의 5분, 스크레이프 간격 추가).

## 관련 페이지 {#related-pages}

- [자가 복구](./self-healing)
- [문제 해결](./troubleshooting)
- [백업](./backups)
- [환경 변수](../reference/environment)
- [오류](../api/errors)
