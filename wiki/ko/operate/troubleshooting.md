---
title: 문제 해결
description: 'Arkvory 서버에서 발생하는 장애의 증상, 원인, 해결 방법과 로그 및 요청 ID를 찾는 방법을 설명합니다.'
---

# 문제 해결

증상을 찾고 원인을 읽고 해결 방법을 적용하세요. 각 섹션에는 확인해야 할 로그 이벤트나 오류가 나와 있습니다. 오류 코드의 의미는 [오류](../api/errors)를 참조하세요.

## 첫 단계 {#first-steps}

1. 상태 엔드포인트에 요청합니다: `curl -fsS http://127.0.0.1:8080/health/status`. `{"status":"ready"}`는 API가 데이터베이스와 스토리지에 도달할 수 있다는 뜻입니다.
2. 실패한 서비스의 최신 로그 줄을 읽습니다. [로그 및 피드백](#logs-and-feedback)을 참조하세요.
3. `startup.failed` 또는 `worker.unavailable` 이벤트를 찾습니다. `reason` 필드에 원인이 나와 있습니다.
4. 클라이언트가 오류를 보고하면 요청 ID를 물어보고 로그에서 이를 검색합니다.

## 서버가 시작되지 않음 {#server-does-not-start}

서비스 관리자는 실패한 서비스를 10초마다 다시 시작합니다. 그러면 로그에 `startup.failed`가 반복됩니다. `reason` 필드와 `errno`, `sqlstate` 필드를 읽으세요.

### 포트가 사용 중임 {#port-busy}

**원인.** `startup.failed`에 `errno` `EADDRINUSE`가 있습니다. 다른 프로그램이 포트 8080(`ARKVORY_PORT`)에서 수신 대기 중이거나, 이전 Arkvory 프로세스가 아직 실행 중입니다.

**해결.** 포트의 소유자를 찾아 중지하거나 포트를 변경하세요.

```bash
sudo ss -ltnp 'sport = :8080'
```

```powershell
Get-NetTCPConnection -LocalPort 8080 | Select-Object LocalAddress, OwningProcess
```

포트를 변경하려면 `config/runtime.json`의 `ARKVORY_PORT`를 편집하고 서비스를 다시 시작하세요. 콘솔 주소도 함께 변경됩니다.

### 데이터베이스에 연결할 수 없거나 로그인을 거부함 {#database-problems}

**원인.** 로그에 다음 사유 중 하나가 표시됩니다:

| `reason`                                                          | 의미                                                                          |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `dependency unavailable`, `errno` `ECONNREFUSED` 또는 `ETIMEDOUT` | PostgreSQL이 중지되어 있거나, 다른 곳에서 수신 대기 중이거나, 방화벽이 차단함 |
| `database authentication failed`                                  | `ARKVORY_DATABASE_URL`의 사용자 또는 비밀번호가 잘못됨                        |
| `database does not exist`                                         | URL에 지정된 데이터베이스가 없음                                              |
| `database role lacks a required privilege`                        | 롤이 테이블을 만들거나 변경할 수 없음                                         |

**해결.** PostgreSQL을 시작하거나 `config/runtime.json`의 `ARKVORY_DATABASE_URL`을 고친 후 서비스를 다시 시작하세요. 관리형 데이터베이스는 `127.0.0.1:54329`에서 수신 대기합니다(Windows에서는 `Arkvorydatabase` 서비스, Linux에서는 `arkvory-database`). 데이터베이스가 응답하면 서비스가 스스로 시작됩니다. `database/` 폴더를 삭제하지 마세요.

### 데이터베이스와 프로그램이 일치하지 않음 {#migrations}

**원인.** 사유가 `unavailable:`로 시작하며 `Database migrations 1 through N are required; run migrate`, `Database schema is newer than this release`, `database schema is missing; run migrations` 중 하나를 말합니다. 이는 중간에 멈춘 업데이트 후 또는 이전 버전이 더 새로운 데이터베이스에서 시작된 후에 발생합니다.

**해결.** 더 새로운 데이터베이스에서 이전 버전을 시작하지 마세요. `arkvory status --root <root>`로 상태를 확인하고 `recover`로 업데이트를 완료하거나 되돌리세요. [업데이트 실패](#update-failed)를 참조하세요. 데이터를 안전하게 유지하려면 `recover`가 완료할 수 없을 때만 백업에서 복원하세요.

### 다른 프로세스가 스토리지를 소유함 {#storage-identity}

**원인.** 사유가 `busy: Another writer or maintenance process owns this database` 또는 `conflict: Database belongs to a different storage directory`입니다. 두 번째 API가 같은 데이터베이스에 대해 실행 중이거나, 데이터 디렉터리가 이 데이터베이스와 함께 사용된 것이 아닙니다. 각 스토리지 디렉터리에는 `storage-id` 파일이 있으며 데이터베이스가 이를 기록합니다.

**해결.** 다른 프로세스를 중지하세요. 이 데이터베이스에 속한 데이터 디렉터리를 사용하세요. `storage-id`를 다른 디렉터리로 복사하지 말고, 두 설치를 같은 데이터베이스에 연결하지 마세요.

### 루트 또는 데이터 디렉터리 권한 {#root-permissions}

**원인.** `errno`가 `EACCES` 또는 `EPERM`이거나, 사유가 `Cannot read ARKVORY_KEYS_FILE (EACCES)`입니다. 서비스 계정이 구성을 읽거나 데이터 디렉터리에 쓸 수 없습니다. 일반적인 원인은 사용자 프로필에 설치된 경우, 직접 복사한 폴더, 변경된 소유자입니다.

**해결.**

- Linux: 루트와 `config/`는 모드 0750으로 `root:arkvory`에 속합니다. `config/runtime.json`과 `config/keys.json`은 모드 0640입니다. `data/`와 `logs/`는 `arkvory:arkvory`에 속합니다.
- Windows: `NT AUTHORITY\LocalService` 계정이 루트의 모든 상위 폴더를 읽을 수 있어야 하며 `data\`, `logs\`, 업데이트 인박스를 변경할 수 있어야 합니다. 그래픽 설치 프로그램을 다시 실행하여 액세스 규칙을 복원하세요.
- 홈 디렉터리와 사용자 프로필 밖의 전용 폴더에 설치하세요.

### 설정이나 인증서가 거부됨 {#invalid-configuration}

**원인.** 사유에 변수 이름이 나오거나(예: `Invalid ARKVORY_PORT`) 인증서 문제가 있습니다: `TLS certificate has expired`, `TLS certificate and key do not match`, `TLS key is not an unencrypted PEM private key`. 인증서가 잘못되면 서버는 일반 HTTP로 시작하지 않습니다.

**해결.** `config/runtime.json`에서 해당 변수를 고치세요. 범위를 벗어난 값은 시작을 중단시킵니다. 인증서 파일을 갱신하거나 교체하세요. 파일을 고치는 동안 `arkvory configure --tls-off`로 일반 HTTP로 돌아가세요. [환경 변수](../reference/environment)를 참조하세요.

## 콘솔이 API에 연결할 수 없음 {#console-unreachable}

| 콘솔의 메시지               | 원인                                                                                                                                                                         | 해결                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [[ui:errorNetwork]]         | 브라우저가 응답을 받지 못함: 서비스가 중지되었거나, 주소나 포트가 잘못되었거나, 방화벽이 차단하거나, 서버가 `127.0.0.1`에서만 수신 대기하거나, 인증서가 이름과 일치하지 않음 | 브라우저와 같은 컴퓨터에서 `/health/status`를 테스트합니다. 서비스, 수신 주소, 방화벽을 확인하세요                   |
| [[ui:errorGateway]]         | 리버스 프록시는 응답하지만 그 뒤의 API는 응답하지 않음                                                                                                                       | API가 실행 중인지, 프록시가 해당 포트를 가리키는지 확인하세요. 대용량 전송을 위해 프록시의 읽기 제한 시간을 높이세요 |
| [[ui:errorTimeout]]         | 서버가 제때 응답하지 않음                                                                                                                                                    | 로그에서 `upload.deadline` 또는 사용 중인 데이터베이스를 찾으세요                                                    |
| [[ui:errorUnavailable]]     | 데이터베이스와 같은 의존성이 잠시 사용할 수 없음                                                                                                                             | 기다렸다가 다시 시도하세요. [사용 중 및 사용 불가](#retry-after)를 참조하세요                                        |
| [[ui:errorOriginForbidden]] | 외부 콘솔이 `ARKVORY_CORS_ORIGINS`에 나열되지 않은 주소에서 실행됨                                                                                                           | 정확한 오리진(스킴, 호스트, 포트)을 추가하고 API를 다시 시작하세요                                                   |
| [[ui:sessionEnded]]         | 다른 곳에서 로그아웃했거나, 비밀번호가 변경되었거나, 액세스가 폐기됨                                                                                                         | 다시 로그인하세요                                                                                                    |

업데이트 중에는 콘솔이 스스로 다시 연결합니다. 설치 요청을 다시 보내지 마세요. Docker Desktop을 사용하는 경우 Docker Desktop이 실행될 때까지 서버를 사용할 수 없습니다. [Docker](#docker)를 참조하세요.

## 로그인 문제 {#sign-in}

### 이름 또는 비밀번호가 잘못됨 {#wrong-password}

**원인.** 메시지는 [[ui:signInFailed]] (401 `invalid_credentials`)입니다. 서버는 잘못된 이름, 잘못된 비밀번호, 비활성화된 계정에 대해 같은 응답을 주므로 어떤 이름이 존재하는지 아무도 알아낼 수 없습니다.

**해결.** 관리자는 [[ui:administration]]에서 계정을 확인하고 비활성화되어 있으면 [[ui:enableUser]]를 사용하거나 [[ui:resetPassword]]로 새 비밀번호를 설정할 수 있습니다.

### 시도 횟수가 너무 많음 {#too-many-attempts}

**원인.** 응답은 `login_attempts`와 `Retry-After`가 포함된 429 `rate_limited`입니다. 주소가 10회 시도를 모두 사용했거나, 여러 번의 잘못된 비밀번호 후 계정이 대기 상태입니다(최대 2분). 이 시간 동안에는 올바른 비밀번호도 대기합니다.

**해결.** `Retry-After`에 있는 초만큼 기다리세요. 관리자는 비밀번호를 재설정하여 계정의 대기를 해제할 수 있습니다. API를 다시 시작하면 주소의 카운터는 지워지지만 계정의 대기는 지워지지 않습니다.

### 프록시 뒤에서 모두 차단됨 {#blocked-behind-proxy}

**원인.** 서버는 프록시의 주소를 모든 클라이언트의 주소로 보므로 모든 클라이언트가 하나의 예산을 공유합니다.

**해결.** `ARKVORY_TRUSTED_PROXIES`를 프록시의 주소로 설정하고 API를 다시 시작하세요. 프록시는 `X-Forwarded-For`를 보내야 합니다. [보안](./security#sign-in-limits)을 참조하세요.

### 소유자를 잃음 {#owner-lost}

**원인.** 아무도 관리자 비밀번호를 기억하지 못합니다.

**해결.** 서버에서 복구 키를 사용하세요:

1. root 또는 Administrator로 `config/bootstrap-token.txt`에서 키를 읽습니다.
2. 콘솔에서 [[ui:keySignIn]]을 열고 키를 붙여 넣은 다음 [[ui:connect]]를 선택합니다.
3. [[ui:administration]]을 엽니다. 계정에 [[ui:resetPassword]]를 사용하거나 [[ui:createUser]]로 새 관리자를 만듭니다.
4. [[ui:disconnect]]를 선택하고 계정으로 로그인합니다.

[[ui:welcomeOwner]] 양식은 서버에 계정이 전혀 없을 때만 동작합니다.

### 복구 키를 잃음 {#recovery-key-lost}

**원인.** `config/bootstrap-token.txt` 파일이 삭제되었거나 저장된 적이 없습니다. 서버는 키의 해시만 보관합니다.

**해결.** 서버에서 root 또는 Administrator 권한으로 새 키와 그 해시를 작성하세요. [구성](../install/configuration)을 참조하세요. 이 파일을 다시 삭제하지 마세요: 설치 도구가 이 파일을 읽습니다.

## 업로드 {#uploads}

### 업로드가 완료되지 않음 {#upload-stuck}

**원인.** 몇 가지 가능한 원인이 있습니다:

- 클라이언트가 연결을 잃었습니다. 멀티파트 업로드는 기록된 파트를 7일 동안 유지합니다.
- 대용량 업로드가 워커를 기다립니다. 워커가 중지되었거나 실패했습니다. 두 번째 워커가 대기 상태로 기다립니다.
- 너무 많은 업로드가 동시에 실행됩니다. 기본적으로 2개(계정당 1개)가 실행되며 나머지는 20초를 기다린 후 503 `busy`를 받습니다.
- 리버스 프록시가 큰 본문을 거부(413)하거나 느린 요청을 중단(502 또는 504)합니다.

**해결.**

1. 업로드 상태를 확인합니다: `arkvoryctl uploads status <id>`. 같은 파일과 같은 상태 파일로 재개하세요. [명령줄](../protocols/cli#resume-interrupted-transfers)을 참조하세요.
2. 워커를 확인합니다: `systemctl status arkvory-worker`, `Get-Service Arkvoryworker`. `uploadId`와 함께 `completion.failed` 및 `completion.attempts_exhausted`를 찾습니다. 메트릭 `arkvory_completion_oldest_queued_seconds`는 대기 중인 작업을 보여 줍니다.
3. 본문 크기와 읽기 시간에 대한 프록시의 한도를 높이세요. 업로드 요청은 데이터가 없는 상태로 30초 후, 총 30분 후에 중단됩니다.
4. 7일보다 오래된 세션은 사라집니다(409 `upload_expired`). 새 업로드를 시작하세요.

### integrity_mismatch {#integrity-mismatch}

**원인.** 응답은 422 `integrity_mismatch`이거나 클라이언트가 종료 코드 5로 종료됩니다. 바이트가 선언된 크기나 SHA-256과 일치하지 않습니다. 전송 중 파일이 변경되었거나, 선언된 해시가 다른 파일에 대해 계산되었거나, 프록시나 네트워크 장치가 본문을 변경했습니다.

**해결.** 변경되지 않은 사본에서 파일을 다시 보내세요. 세션은 열린 상태로 유지되므로 수정된 파일을 그 세션으로 보낼 수 있습니다. 다운로드가 검사를 계속 실패하면 다른 경로로 한 번 더 다운로드한 다음 요청 ID를 보고하세요. [로그 및 피드백](#logs-and-feedback)을 참조하세요.

## 사용 중, 속도 제한, 사용 불가 {#retry-after}

`busy`, `unavailable`, `rate_limited` 코드는 일시적입니다. 응답에는 `Retry-After` 헤더와 `retryAfterSeconds` 필드가 있습니다. 그만큼 기다리세요. SDK와 명령줄 클라이언트는 이러한 응답을 제한된 횟수만큼 반복합니다.

| 응답                             | 원인                                                                                                                            | 해야 할 일                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 503 `busy`, 사유 `request_limit` | 서버가 `ARKVORY_MAX_REQUESTS`개의 요청을 동시에 처리함(기본값 128)                                                              | 기다리세요. 충분한 메모리가 있을 때만 한도를 높이세요. `arkvory_http_requests_in_flight`를 확인하세요                                                                    |
| 503 `busy`                       | 전송 대기열이 가득 찼거나, 전송이 `ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS`(20초)보다 오래 기다렸거나, 서버가 중지 전에 드레이닝 중임 | 기다렸다가 반복하세요. 자주 발생하면 `ARKVORY_MAX_UPLOADS` 또는 `ARKVORY_MAX_DOWNLOADS`를 높이세요. `arkvory_transfer_admission_failures_total`이 거부 횟수를 계산합니다 |
| 503 `unavailable`                | 데이터베이스가 다시 시작되거나, 프로세스가 스토리지 소유권을 잃었거나, 허브에 도달할 수 없음(`hub_unreachable`)                 | 기다리세요. 서비스는 스스로 다시 시작됩니다. [자가 복구](./self-healing)를 참조하세요                                                                                    |
| 429 `rate_limited`               | 로그인, 등록, 비밀번호 또는 피드백 시도가 너무 많음                                                                             | 기다리세요. [시도 횟수가 너무 많음](#too-many-attempts)을 참조하세요                                                                                                     |

500 `internal`에는 `Retry-After`가 없습니다. 무작정 반복하지 마세요. 로그에서 해당 요청 ID를 검색하고 보고하세요.

## 디스크 가득 참 및 할당량 {#disk-full}

| 응답, 사유          | 원인                                                                                                                            | 해결                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 507 `storage_full`  | 스토리지 볼륨의 여유 공간이 예비 영역 `ARKVORY_STORAGE_RESERVE_BYTES`(기본값 1 GiB)보다 적거나, 데이터베이스의 디스크가 가득 참 | 볼륨의 공간을 확보하세요. `df -h` 또는 `Get-PSDrive`와 PostgreSQL의 볼륨을 확인하세요            |
| 507 `storage_quota` | 리포지토리 할당량이 모두 사용됨                                                                                                 | 오래된 빌드를 삭제하거나, 보존 정책을 변경하거나, [[ui:repositoryStorage]]에서 할당량을 높이세요 |
| 507 `catalog_limit` | 모든 예약된 콘텐츠의 합계가 `ARKVORY_CAPACITY_BYTES`(기본값 10 TiB)를 초과함                                                    | 콘텐츠를 삭제하거나 `config/runtime.json`의 값을 높이세요                                        |
| 507 `queue_full`    | 계정에 열린 완료 작업이 100개 있거나, 서버에 10,000개가 있음                                                                    | 워커가 끝낼 때까지 기다리세요                                                                    |

디스크가 가득 찬 동안에도 다운로드와 콘솔은 계속 동작합니다. `/health/ready`는 `"writable": false`를 표시합니다. Arkvory에서 아티팩트를 삭제해도 디스크가 즉시 확보되지는 않습니다: 파일은 유예 기간 후 물리적 정리를 기다립니다. [스토리지](./storage)를 참조하세요. 데이터를 더 밀어 넣으려고 예비 영역을 낮추지 마세요. 데이터베이스와 로그에 필요하기 때문입니다.

## 백업 실패 {#backups-failing}

[[ui:backups]] 또는 `arkvoryctl backup status`의 경고와, `errorCode`가 포함된 로그 이벤트 `backup.request.failed` 및 `backup.agent.failed`부터 확인하세요. [백업](./backups)을 참조하세요.

| 경고 또는 메시지                                                                    | 원인                                                                               | 해결                                                                                                                                       |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent_offline`                                                                     | 백업 서비스가 중지되었거나 시작에 실패함                                           | `arkvory-backup` 또는 `Arkvorybackup`을 시작하세요. 로그를 읽으세요                                                                        |
| `vault_unavailable`                                                                 | 보관소 볼륨이 마운트되지 않았거나, `vault.json`이 없거나, 서비스 계정이 쓸 수 없음 | 서비스 시작 전에 볼륨을 마운트하세요. 소유자와 권한을 확인하세요. Windows에서는 볼륨이 나중에 마운트된 경우 에이전트를 다시 시작하세요     |
| `The vault directory does not exist; create it or mount its volume first`           | 경로가 잘못되었거나 볼륨이 없음                                                    | 디렉터리를 만들거나 마운트하세요                                                                                                           |
| `The vault directory is not writable`                                               | 서비스 계정에 쓰기 액세스가 없음                                                   | Linux에서는 사용자 `arkvory`의 `uid`와 `gid`로 공유를 마운트하세요. Windows에서는 로컬 또는 iSCSI 볼륨을 사용하세요                        |
| `The directory has no vault.json: mount the vault volume, or pass --init-vault ...` | 빈 디렉터리는 마운트되지 않은 공유일 수 있으므로 명령이 이를 거부함                | 올바른 볼륨을 마운트하거나, 새 빈 보관소에는 `--init-vault --vault-no-encryption`를 전달하세요                                             |
| `The vault must be outside the installation root and the storage directory`         | 보관소가 데이터와 겹침                                                             | 다른 볼륨의 별도 디렉터리를 선택하세요                                                                                                     |
| `Network share paths are not supported ...`                                         | Windows의 UNC 경로. `LocalService`가 SMB 공유에 로그인할 수 없음                   | 로컬 또는 iSCSI 볼륨의 드라이브 문자를 사용하세요                                                                                          |
| `The backup service cannot reach /home, /root, /run/user, /tmp or /var/tmp`         | systemd 샌드박스가 이 폴더를 숨김                                                  | 다른 디렉터리를 선택하세요                                                                                                                 |
| `vault_full`, `vault_low_space`                                                     | 보관소 볼륨이 거의 가득 참                                                         | 공간을 확보하거나 더 적은 지점을 유지하세요. 이전 지점은 그대로 유지됩니다                                                                 |
| `vault_key_missing`, `vault_key_invalid`                                            | vault가 암호화되어 있는데 에이전트에 키가 없거나 잘못된 키가 있습니다              | 에이전트 키로 `arkvory configure --backup-vault DIR --vault-key-file FILE`을 실행하세요. [vault 암호화](./backups#encryption)를 참고하세요 |
| `last_run_failed`                                                                   | 최신 백업이 실패함                                                                 | `arkvoryctl backup jobs`로 `errorCode`를 읽으세요                                                                                          |
| `verify_failed`                                                                     | 지점이 검사를 통과하지 못함                                                        | 보관소를 변경하지 마세요. 분석을 위해 보관하고 보고하세요                                                                                  |

`arkvory configure --backup-vault`는 에이전트가 150초 이내에 새 보관소를 보고하지 않으면 이전 설정을 복원합니다. 업데이트는 백업 에이전트를 중지하므로 그 순간 실행되는 백업은 나중에 반복됩니다. 자동 업데이트가 켜져 있으면 백업 시간을 업데이트 시간(기본값 03:00 UTC) 밖으로 두세요.

## 미러가 동기화되지 않음 {#mirror-not-syncing}

리포지토리의 배지 [[ui:mirrorFailing]], `GET /api/v1/repositories/{repository}/mirror`, 워커 이벤트 `mirror.step_failed`를 확인하세요. 다운로드는 복사된 것으로 계속 동작합니다. [미러](./mirrors)를 참조하세요.

| `errorCode`                                                         | 원인                                                                 | 해결                                                                                                                                      |
| ------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `mirror_failed` 또는 `unauthorized`, `forbidden`과 같은 원본의 코드 | 원본에 도달할 수 없거나, 키가 잘못되었거나 만료되었거나, 권한이 없음 | 키로 원본을 테스트하세요. `arkvory configure --mirror ... --mirror-token-file`로 키를 교체하세요. 워커는 실패할 때마다 키를 다시 읽습니다 |
| `mirror_mismatch`                                                   | 같은 ID가 원본에서 다른 콘텐츠를 가짐                                | 복사본은 유지됩니다. 아티팩트를 조사하세요                                                                                                |
| `mirror_source_changed`                                             | 리포지토리가 이미 다른 원본의 복사본을 보유함                        | `--mirror-detach`로 분리하고 새 원본을 새 리포지토리로 미러하세요                                                                         |
| `mirror_source_behind`                                              | 원본이 복원되거나 재설치됨                                           | 스스로 다시 시드하며 코드가 사라집니다                                                                                                    |
| 인증서 오류                                                         | 원본이 회사 또는 자체 서명 인증서를 사용함                           | `arkvory configure`에 `--mirror-ca-file`을 전달하세요. 검사는 절대 꺼지지 않습니다                                                        |

원본에는 미러 피드가 있는 릴리스가 필요합니다. 워커는 실패 후 2초를 기다리며 최대 5분까지 두 배로 늘립니다. `ArkvoryMirrorStale`은 따라잡기 없이 한 시간이 지나면 발생합니다.

## 업데이트 실패 {#update-failed}

1. 실패를 읽으세요. 콘솔에서 [[ui:updates]]가 메시지를 보여 줍니다. 업데이터는 Windows에서는 `logs\updater.log`에, Linux에서는 `journalctl -u arkvory-update`에 기록합니다.
2. 설치된 버전을 확인하세요: `arkvory status --root <root>`.
3. 해당하는 경우를 찾으세요.

| 경우                                                             | 발생한 일                                                                            | 해야 할 일                                                                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 동일한 데이터베이스 스키마, 일반적인 실패                        | 설치 프로그램이 이전 버전을 다시 시작함                                              | 원인을 고치고 다시 업데이트하세요                                                                                                           |
| 콘솔에 [[ui:updateMaintenance]]가 표시됨                         | 스키마 변경이 있는 릴리스는 검증된 백업이 필요하며, 설치 프로그램이 변경 전에 거부함 | 보관소를 연결하고, 첫 백업을 기다린 후 다시 확인하세요                                                                                      |
| 마이그레이션 실패                                                | 트랜잭션이 롤백되었고 이전 버전이 이전 스키마에서 실행됨                             | 원인을 고치고 다시 업데이트하세요                                                                                                           |
| 마이그레이션은 성공했지만 새 버전이 시작되지 않음                | 저널이 `maintenance-required`를 말하고 백업 지점을 지정함                            | 원인을 고치고 업데이트를 완료하는 `recover`를 실행하세요. 또는 이전 버전으로 지점을 복원하세요                                              |
| 업데이터가 종료되었거나 머신의 전원이 꺼짐                       | 잠금 `operation.lock`과 저널이 남음. 아무것도 스스로 계속되지 않음                   | 아래 절차                                                                                                                                   |
| 콘솔에 [[ui:updateStale]] 또는 [[ui:updateUnavailable]]가 표시됨 | 호스트 스케줄러가 실행 중이 아니거나 연결되지 않음                                   | `ProAnimaArkvoryUpdate`(Windows) 또는 `arkvory-update.timer`(Linux) 작업을 확인하세요. `arkvory updates-connect --root <root>`로 연결하세요 |

중단된 업데이터 이후:

1. 스케줄러를 중지하고 업데이터가 실행 중이 아닌지 확인하세요. `journal.json`과 로그를 저장하세요.
2. 그런 다음에만 설치 루트의 `operation.lock` 파일을 삭제하세요. 업데이트가 실행 중일 때는 절대 삭제하지 마세요.
3. `recover`를 실행하세요:

   ```bash
   sudo arkvory recover --root /opt/proanima-arkvory
   ```

   ```powershell
   & 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' recover --root C:\ProgramData\ProAnima\Arkvory
   ```

   마이그레이션이 시작되기 전이면 이전 버전을 복원합니다. 마이그레이션이 시작된 후면 마이그레이션을 반복하고 새 버전을 시작합니다.

4. `/health/ready`, 완료 대기열, 테스트 다운로드 하나를 확인하세요. 그런 다음 스케줄러를 다시 켜세요.

`arkvory updates-reset --root <root>`는 상태를 조정한 후 수락된 업데이트 요청을 지웁니다. 다운그레이드는 불가능합니다. [업데이트](../install/updates)를 참조하세요.

## Docker {#docker}

- **Windows 재시작 후 아무것도 실행되지 않음.** Docker Desktop은 사용자가 로그인할 때 시작됩니다. **Start Docker Desktop when you sign in**을 켜거나 네이티브 서비스를 사용하세요.
- **Linux 호스트 재시작 후 아무것도 실행되지 않음.** 엔진이 부팅 시 시작되는지 확인하세요: `systemctl is-enabled docker`.
- **컨테이너가 `config/`의 파일을 읽을 수 없음.** 컨테이너는 `node` 사용자(uid 1000)로 실행됩니다. 설치 프로그램은 `runtime.json`, `keys.json`, `health-token.txt`를 이 사용자가 읽을 수 있게 만듭니다. 수동 편집으로 소유자나 모드를 0600으로 변경하면 API가 `Cannot read ARKVORY_KEYS_FILE (EACCES)`와 함께 중지됩니다. 이 세 파일의 모드를 0644로 복원하세요. `config/` 폴더 자체는 닫힌 상태로 유지됩니다.
- **보관소에 쓸 수 없음.** 에이전트는 uid 1000으로 실행되므로 보관소가 이에 속해야 합니다. `arkvory configure --backup-vault`가 `config/compose.vault.yml` 파일로 이를 설정합니다. 직접 마운트한 공유에는 `uid=1000`이 필요합니다. 모든 수동 Compose 명령에 `-f config/compose.vault.yml`을 포함하세요. 그렇지 않으면 `up`이 보관소 없이 백업 컨테이너를 만듭니다.
- **컨테이너가 `unhealthy`임.** 상태 확인은 10초마다 `/health/ready`를 호출합니다. Docker는 컨테이너를 표시하지만 다시 시작하지는 않습니다. API 컨테이너의 로그를 읽으세요.

컨테이너의 로그를 표시합니다:

```bash
docker logs --tail 100 proanima-arkvory-api-1
```

## Windows 서비스가 시작되지 않음 {#windows-service}

1. 상태와 오류 출력을 읽으세요:

   ```powershell
   Get-Service Arkvoryapi, Arkvoryworker, Arkvorybackup, Arkvorydatabase
   Get-Content C:\ProgramData\ProAnima\Arkvory\logs\arkvory-api.err.log -Tail 50
   ```

2. Windows 이벤트 뷰어를 열고 **Windows Logs > System**에서 서비스 제어 관리자의 이벤트를 찾으세요.
3. 원인을 찾으세요:

| 원인                                                                       | 해결                                                           |
| -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 루트가 사용자 프로필 안에 있거나 `LocalService`가 상위 폴더를 읽을 수 없음 | 전용 폴더에 설치하세요. [권한](#root-permissions)을 참조하세요 |
| 포트가 사용 중임                                                           | [포트가 사용 중임](#port-busy)을 참조하세요                    |
| 데이터베이스 서비스가 실행 중이 아님                                       | `Arkvorydatabase`를 시작하세요. API는 10초마다 재시도합니다    |
| 부팅 후 서비스가 "늦게" 시작됨                                             | 시작 유형이 자동(지연 시작)입니다. 몇 분 기다리세요            |
| 백신 소프트웨어가 Node.js를 격리함                                         | `runtime\`의 파일을 허용하세요                                 |
| `Another installation owns this service`                                   | 다른 루트의 설치 서비스가 존재합니다. 먼저 제거하세요          |
| 서비스가 중지된 상태로 유지됨                                              | 사용자나 업데이트가 중지했습니다. `Start-Service`로 시작하세요 |

그래픽 설치 프로그램을 다시 실행하여 서비스의 시작 유형과 복구 작업을 복원하세요. [Windows](../install/windows)를 참조하세요.

## 로그, 요청 ID 및 피드백 {#logs-and-feedback}

**로그 찾기.** Linux: `journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup`. Windows: 설치 루트의 `logs\`. Compose: `docker logs <container>`. 형식과 이벤트는 [모니터링](./monitoring#logs)에 있습니다.

**요청 ID 찾기.** 모든 응답에는 `X-Request-Id` 헤더가 있습니다. 모든 오류 본문에는 `requestId`가 있습니다. 콘솔은 메시지 아래에 [[ui:requestIdLabel]]로 이를 표시하고, 명령줄 클라이언트는 오류 줄에 출력합니다. API와 워커의 로그에서 이 값을 검색하여 요청과 그로 인해 시작된 작업을 확인하세요.

**로그와 함께 피드백 보내기.**

1. 로그인하고 상단 표시줄에서 [[ui:reportOpen]]을 선택합니다.
2. 문제를 설명하고 요청 ID를 추가합니다. 최대 6개의 스크린샷을 추가할 수 있습니다.
3. 관리자인 경우 [[ui:reportServerLog]]를 켭니다. 그러면 API의 최신 로그 줄(약 1.5 MiB)과 주소와 시크릿이 없는 시스템 요약이 첨부됩니다.
4. 전송될 내용을 정확히 확인하려면 [[ui:reportShow]]를 선택한 다음 [[ui:reportSend]]를 선택합니다.

서버는 보고서를 ProAnimaStudio 허브로 보냅니다. 허브에 도달할 수 없거나 피드백이 꺼져 있으면 콘솔이 문의할 주소 `info@proanima.net`을 표시합니다. 전송되는 내용은 [보안](./security#hub)을 참조하세요.

## 관련 페이지 {#related-pages}

- [모니터링](./monitoring)
- [자가 복구](./self-healing)
- [보안](./security)
- [오류](../api/errors)
- [Windows](../install/windows)
