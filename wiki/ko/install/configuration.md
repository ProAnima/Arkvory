---
title: 구성
description: 'Arkvory 구성이 위치하는 곳, 이를 변경하는 수명 주기 명령, 작업별 주요 설정, 변경 적용 방법을 설명합니다.'
---

# 구성

Arkvory에는 두 종류의 설정이 있습니다:

- **서버 설정**은 `config/runtime.json` 파일의 `ARKVORY_*` 변수입니다. 주소, 한도, 스토리지 및 이와 유사한 항목을 설정합니다. API, 워커, 백업 에이전트는 시작할 때 이 변수를 읽습니다.
- **설치 정책**은 업데이트 정책, HTTPS 파일, 백업 보관소, 미러입니다. `arkvory configure` 명령으로 변경합니다. 이 명령은 변경 사항을 확인하고, 필요한 것을 다시 시작하며, 서비스가 시작되지 않으면 이전 상태를 복원합니다.

이 페이지에서는 파일이 있는 위치, 존재하는 명령, 주요 설정이 동작하는 방식을 설명합니다. 기본값과 범위를 포함한 전체 변수 목록은 [환경 변수](../reference/environment)에 있습니다.

## 구성이 위치하는 곳 {#where-it-lives}

설치 루트가 모든 것을 담고 있습니다. Windows에서는 `C:\ProgramData\ProAnima\Arkvory`이고 Linux에서는 `/opt/proanima-arkvory`입니다. Compose 설치도 호스트에서 같은 루트를 사용합니다. 아래 경로는 루트를 기준으로 합니다.

| 파일                                                                           | 내용                                                                                             | 변경 방법                                    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `config/runtime.json`                                                          | 서버 설정. 키는 `ARKVORY_`로 시작하며 모든 값은 문자열입니다. 데이터베이스 비밀번호를 포함합니다 | 직접 편집하거나 `configure` 사용             |
| `config/keys.json`                                                             | 복구 키와 준비 상태 키의 SHA-256 해시. 키 자체는 절대 포함하지 않습니다                          | [복구 키 교체](#replace-recovery-key) 시에만 |
| `config/bootstrap-token.txt`                                                   | 복구 키                                                                                          | 교체할 때만                                  |
| `config/health-token.txt`                                                      | 설치 도구가 준비 상태 확인에 사용하는 키                                                         | 변경하지 마세요                              |
| `config/hub.json`                                                              | 허브 주소, 업데이트 채널, 통계 설정                                                              | `configure` 사용                             |
| `config/install-id`                                                            | 무작위 설치 ID로, 통계가 켜져 있을 때만 허브로 전송됩니다                                        | 변경하지 마세요                              |
| `config/mirrors/`                                                              | 미러 목록과 워커가 소스에 사용하는 키                                                            | `configure --mirror` 사용                    |
| `config/webhooks/`                                                             | 구독 목록, 서명 시크릿, worker가 사용하는 수신자의 인증 기관                                     | `configure --webhook` 사용                   |
| `installation.json`                                                            | 모드, 엔진, 자동 업데이트 설정, 버전 고정, 설치된 릴리스                                         | 명령으로만                                   |
| `github-token.txt`                                                             | 릴리스 다운로드를 위한 선택적 GitHub 토큰. [업데이트](./updates#hub-unreachable) 참조            | 직접 편집                                    |
| `config/compose.env`, `config/compose.vault.yml`, `config/compose.mirrors.yml` | Compose 전용: 이미지, 보관소 마운트, 미러 마운트                                                 | 명령으로만                                   |

네이티브 Linux 설치에서 `runtime.json`과 `keys.json`은 모드 `0640`의 `root:arkvory`이며, `config/`의 자격 증명 파일은 `root`만 읽을 수 있습니다. Compose 설치는 컨테이너가 읽는 파일에 모드 `0644`를 사용합니다: [Docker Compose](./docker#owners)를 참조하세요. 설치 프로그램이 설정한 소유자와 모드를 유지하세요.

## 수명 주기 명령 {#lifecycle-commands}

모든 명령에는 관리자 권한과 설치 루트를 지정하는 `--root` 옵션이 필요합니다.

| 설치                          | 명령 실행 방법                                                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux 패키지                  | `sudo arkvory <command> --root /opt/proanima-arkvory`                                                                                                                 |
| Windows, 그래픽 설치 프로그램 | 관리자 권한 PowerShell에서: `& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' <command> --root C:\ProgramData\ProAnima\Arkvory`                                      |
| 스크립트 설치, Compose        | `sudo <root>/runtime/node-v24.21.0-linux-x64/bin/node <root>/manage.mjs <command> --root <root>`. Windows에서는 `runtime\node-v24.21.0-win-x64\node.exe`를 사용하세요 |

`arkvory help`는 특별한 권한 없이 명령을 나열합니다. 이 사이트의 예제에서는 짧은 형식 `arkvory <command>`를 사용합니다.

| 명령                            | 용도                                                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `status`                        | 설치 모드, 엔진, 자동 업데이트 설정, 고정, 설치된 릴리스를 표시합니다                                                            |
| `configure`                     | 정책을 변경합니다. [configure 명령](#configure-command)을 참조하세요                                                             |
| `update`                        | 더 새로운 안정 릴리스를 지금 설치합니다. [업데이트](./updates)를 참조하세요                                                      |
| `upgrade`                       | 데이터베이스 스키마를 변경하는 릴리스를 직접 만든 백업 기록과 함께 설치합니다. [업데이트](./updates#manual-upgrade)를 참조하세요 |
| `recover`                       | 중단된 업데이트를 완료합니다. [업데이트](./updates#recover-update)를 참조하세요                                                  |
| `finish-install`                | 중단된 최초 설치를 계속합니다                                                                                                    |
| `updates-connect`               | 콘솔과 업데이트 타이머를 연결하고, 오래된 설치에 없는 서비스를 등록합니다                                                        |
| `updates-poll`, `updates-reset` | 업데이트 타이머가 실행하며 복구에도 사용됩니다. [업데이트](./updates#recover-update)를 참조하세요                                |

한 번에 하나의 명령만 실행됩니다. 두 번째 명령은 `Installation is locked`와 함께 중지됩니다. 명령 옵션에 키나 비밀번호를 넣지 마세요: 파일을 사용하세요.

### configure 명령 {#configure-command}

한 번의 호출로 한 종류의 설정만 변경합니다. 다섯 가지 종류는 한 번의 호출에 섞을 수 없습니다.

| 종류        | 옵션                                                                                                                                                                                                                                       | 효과                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| HTTPS       | `--tls-cert FILE --tls-key FILE [--listen-host ADDRESS]`, 또는 `--tls-off [--listen-host ADDRESS]`                                                                                                                                         | 내장 HTTPS를 켜거나 끕니다. 서비스를 다시 시작하고 준비 상태를 확인합니다. [HTTPS](./https)를 참조하세요                   |
| 백업 보관소 | `--backup-vault DIRECTORY [--vault-key-file FILE \| --init-vault --vault-no-encryption]`, 또는 `--backup-vault-off`                                                                                                                        | 보관소를 연결하거나 연결을 끊습니다. 백업 에이전트만 다시 시작합니다. [백업](../operate/backups)을 참조하세요              |
| 미러        | `--mirror REPOSITORY --mirror-upstream URL --mirror-token-file FILE [--mirror-source REPOSITORY] [--mirror-stages LIST] [--mirror-ca-file FILE]`, 또는 `--mirror-detach REPOSITORY`                                                        | 리포지토리를 미러나 가져오기 대상으로 만들거나 다시 일반으로 되돌립니다. [미러](../operate/mirrors)를 참조하세요           |
| 웹훅        | `--webhook ID --webhook-repository REPOSITORY --webhook-url URL --webhook-secret-file FILE [--webhook-next-secret-file FILE] [--webhook-actions LIST] [--webhook-allow-private LIST] [--webhook-ca-file FILE]`, 또는 `--webhook-detach ID` | 웹훅 구독을 추가, 교체 또는 제거합니다. 서비스를 다시 시작하고 준비 상태를 확인합니다. 참고: [웹훅](../protocols/webhooks) |
| 업데이트    | `--enable-updates`, `--disable-updates`, `--pin [--version X.Y.Z]`, `--unpin`, `--update-channel stable` 또는 `beta`, `--statistics on` 또는 `off`, `--hub-url URL`, `--hub-off`                                                           | 업데이트 정책을 변경합니다. [업데이트](./updates)를 참조하세요                                                             |

HTTPS, 보관소, 미러 변경은 서비스를 다시 시작하며, 변경이 실패하면 이전 구성을 복원합니다. 업데이트 옵션은 `installation.json`과 `hub.json`만 다시 쓰며, 아무것도 다시 시작하지 않습니다. 파일 경로는 절대 경로입니다.

## 작업별 설정 {#settings-by-task}

### 주소와 포트 {#address-and-port}

| 변수           | 기본값      | 의미                |
| -------------- | ----------- | ------------------- |
| `ARKVORY_HOST` | `127.0.0.1` | API가 수신하는 주소 |
| `ARKVORY_PORT` | `8080`      | TCP 포트            |

기본값으로는 서버의 프로그램만 연결할 수 있습니다. 다른 컴퓨터의 연결을 허용하려면 두 가지 방법 중 하나를 선택하세요:

- **내장 HTTPS.** `arkvory configure --tls-cert … --tls-key … --listen-host 0.0.0.0`. [HTTPS](./https#built-in-tls)를 참조하세요.
- **다른 컴퓨터의 리버스 프록시.** `ARKVORY_HOST`를 프록시용 네트워크 인터페이스 주소로 설정하고 `ARKVORY_TRUSTED_PROXIES`에 프록시를 나열합니다. `runtime.json`을 편집하거나 `arkvory configure --tls-off --listen-host <address>`를 실행하세요. 방화벽으로 프록시에 대해서만 포트를 제한하세요.

`--listen-host`만 단독으로 사용하면 거부됩니다: TLS 파일과 함께 또는 `--tls-off`와 함께 사용하세요. `--tls-off` 후에 루프백으로 되돌리려면 `--listen-host 127.0.0.1`을 추가하세요. 그렇지 않으면 API는 설정된 주소에서 계속 수신합니다.

API가 TLS와 신뢰할 수 있는 프록시 없이 비루프백 주소에서 수신하면 시작할 때 경고 `http.plaintext_exposed`를 기록합니다. 컴퓨터 간에 일반 HTTP로 키를 전송하지 마세요.

Linux에서 서비스는 권한 없는 계정으로 실행되며, 일반적으로 1024 미만의 포트에서 수신할 수 없습니다. 콘솔 바로 가기(시작 메뉴, 메뉴 항목)는 계속 포트 8080을 가리킵니다. 수명 주기 명령은 `runtime.json`의 주소와 포트를 따릅니다. Compose 설치에서는 주소와 포트가 고정됩니다: [Docker Compose](./docker#ports)를 참조하세요.

### 공개 주소와 전달된 헤더 {#public-address}

공개 URL을 위한 설정은 없습니다. 서버는 Git LFS와 npm 응답의 링크처럼 절대 링크를 요청으로부터 만듭니다: 연결이 TLS이거나 프록시가 `X-Forwarded-Proto: https`를 보내면 스킴은 `https`이고, 호스트는 `Host` 헤더입니다. `ARKVORY_TRUSTED_PROXIES`에 나열된 프록시는 `X-Forwarded-Host`로 호스트를 설정할 수도 있습니다. 따라서 프록시는 공개 이름을 전달해야 합니다. [HTTPS](./https#reverse-proxy)를 참조하세요.

`ARKVORY_TRUSTED_PROXIES`는 쉼표로 구분된 최대 32개의 주소 또는 CIDR 범위를 받습니다. 이 피어만 `X-Forwarded-For`로 클라이언트 주소를, `X-Request-Id`로 요청 ID를 설정할 수 있습니다. 목록이 없으면 모든 클라이언트가 프록시 주소에서 온 것으로 보이며, 로그인 제한은 이들을 하나로 계산합니다.

### 다른 주소의 브라우저 {#browsers}

`ARKVORY_CORS_ORIGINS`는 다른 주소에서 실행되는 콘솔이나 다른 웹 애플리케이션의 최대 16개 오리진을 쉼표로 구분하여 나열합니다. 각 오리진에는 스킴, 호스트, 선택적 포트가 있으며 경로는 없습니다. HTTPS를 사용해야 하며, 일반 HTTP는 `localhost`, `127.0.0.1`, `[::1]`에만 허용됩니다. [HTTPS](./https#console-api-address)를 참조하세요. `ARKVORY_ALLOW_REGISTRATION=true`는 로그인 페이지에서 사용자가 직접 계정을 만들 수 있게 합니다. 기본적으로 꺼져 있습니다.

### 데이터베이스 {#database}

| 변수                         | 기본값               | 의미                                                                        |
| ---------------------------- | -------------------- | --------------------------------------------------------------------------- |
| `ARKVORY_DATABASE_URL`       | 설치 프로그램이 설정 | PostgreSQL 연결 URL. 관리형 데이터베이스는 `127.0.0.1:54329`에서 수신합니다 |
| `ARKVORY_DATABASE_POOL_SIZE` | `10`                 | API 연결 풀의 크기, 4~200                                                   |

설치를 다른 데이터베이스로 연결하지 마세요. 저장된 파일과 카탈로그는 함께 속해 있습니다. 새 데이터베이스로 이동하는 것은 백업에서 복원하는 것입니다: [백업](../operate/backups)을 참조하세요. 외부 PostgreSQL의 경우 `max_connections`를 API 풀에 충분히 높게 설정하세요: 쓰기 잠금을 위해 동시 업로드당 연결 하나, 워커용 5개, 그리고 백업 에이전트의 연결 수를 더한 값입니다.

### 스토리지 디렉터리와 여유 공간 {#storage}

| 변수                            | 기본값        | 의미                                                                                      |
| ------------------------------- | ------------- | ----------------------------------------------------------------------------------------- |
| `ARKVORY_DATA_DIR`              | `<root>/data` | 파일 내용이 저장되는 위치. 설치 프로그램이 설정합니다. 로컬 디스크를 사용하세요           |
| `ARKVORY_CAPACITY_BYTES`        | 10 TiB        | 예약된 모든 콘텐츠가 사용할 수 있는 최대치. 디스크 측정값이 아니라 예약에 대한 한도입니다 |
| `ARKVORY_STORAGE_RESERVE_BYTES` | 1 GiB         | 업로드가 절대 사용하지 않는 여유 공간. `0`이면 예약을 끕니다                              |
| `ARKVORY_MAX_OBJECT_BYTES`      | 약 10 TiB     | 단일 객체의 최대 크기. 파일 크기를 제한하려면 더 낮은 값을 설정하세요                     |

`ARKVORY_DATA_DIR`는 설치 프로그램이 둔 위치에 그대로 두세요. Linux 유닛은 루트의 `data/`, `logs/`, `updates/inbox/`에만 쓸 수 있으므로 다른 경로는 이들에게 읽기 전용입니다. 더 큰 디스크를 사용하려면 서비스를 중지하고, 내용을 새 디스크로 복사하고, 소유자를 `arkvory`로 하여 디스크를 `data/`에 마운트한 다음 서비스를 시작하세요. Windows와 Linux에서는 스크립트로 설치할 때 루트 자체를 선택할 수도 있습니다(`-Root`, `ARKVORY_INSTALL_ROOT`). [스토리지](../operate/storage)를 참조하세요.

### 전송 한도 {#limits}

한도는 API 프로세스 하나에 속합니다. 속도 `0`은 제한 없음을 의미합니다.

| 변수                                  | 기본값    | 의미                                                       |
| ------------------------------------- | --------- | ---------------------------------------------------------- |
| `ARKVORY_MAX_UPLOADS`                 | `2`       | 동시 업로드 수, 1~32                                       |
| `ARKVORY_MAX_DOWNLOADS`               | `16`      | 동시 다운로드 수, 1~256                                    |
| `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`   | `1`       | 하나의 계정 또는 키의 동시 업로드 수                       |
| `ARKVORY_MAX_DOWNLOADS_PER_PRINCIPAL` | `4`       | 하나의 계정 또는 키의 동시 다운로드 수                     |
| `ARKVORY_UPLOAD_BYTES_PER_SECOND`     | `0`       | 초당 총 업로드 속도(바이트)                                |
| `ARKVORY_DOWNLOAD_BYTES_PER_SECOND`   | `0`       | 초당 총 다운로드 속도(바이트)                              |
| `ARKVORY_UPLOAD_DEADLINE_MS`          | `1800000` | 업로드 요청 하나의 최대 시간, 30분                         |
| `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`      | `30000`   | 이 시간 동안 데이터를 보내지 않는 업로드 요청은 중단됩니다 |

API 앞의 프록시는 최소한 `ARKVORY_UPLOAD_DEADLINE_MS`만큼 긴 요청을 허용해야 합니다. [HTTPS](./https#reverse-proxy)를 참조하세요. 대기 큐와 계정별 속도 같은 다른 모든 한도는 [환경 변수](../reference/environment#transfers-and-bandwidth)에 있습니다.

### 백업과 미러 {#backups-mirrors}

두 가지 모두 `configure`를 사용하세요. `--backup-vault`는 `ARKVORY_BACKUP_VAULT`를 쓰고, 서비스 계정에 디렉터리 접근 권한을 부여하고, 백업 에이전트만 다시 시작하며, 에이전트가 보관소를 사용 가능하다고 보고할 때만 변경을 유지합니다. 보관소는 설치 루트 밖과 스토리지 밖에 있어야 합니다. `--mirror`는 `ARKVORY_MIRRORS_FILE`과 키 파일을 쓰고, API와 워커를 다시 시작하며, 아무것도 변경하기 전에 사용자의 키로 소스를 확인합니다.

### 업데이트와 허브 {#updates-and-hub}

업데이트 정책은 `installation.json`과 `config/hub.json`에 있습니다. 옵션은 [configure 명령](#configure-command)에 있고, 그 의미는 [업데이트](./updates)에 있습니다. `runtime.json`의 `ARKVORY_HUB_URL`은 별개입니다: 콘솔이 피드백을 보내는 위치를 설정합니다. `configure --hub-url` 또는 `--hub-off`는 둘 다 변경하며, 피드백 주소는 다음 서비스 재시작 후에 반영됩니다.

### 로그와 종료 {#logs-and-shutdown}

| 변수                       | 기본값  | 의미                                                                                       |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------ |
| `ARKVORY_LOG_LEVEL`        | `info`  | `debug`, `info`, `warning` 또는 `error`. `warning`과 `error` 수준은 액세스 로그도 숨깁니다 |
| `ARKVORY_ACCESS_LOG`       | `true`  | HTTP 요청마다 JSON 레코드 하나. 쿼리 문자열은 절대 기록되지 않습니다                       |
| `ARKVORY_DRAIN_TIMEOUT_MS` | `30000` | 중지 요청 후 실행 중인 요청이 끝날 때까지의 시간                                           |

감독자는 서비스에 중지할 시간 120초를 줍니다. 드레인 시간을 약 90초보다 크게 설정하면 서비스 관리자의 중지 제한 시간도 늘리세요: systemd 유닛의 `TimeoutStopSec`, Windows 서비스의 중지 제한 시간, Compose의 `stop_grace_period`입니다. [모니터링](../operate/monitoring)을 참조하세요.

## 변경 적용 {#apply-change}

`configure`는 자체 변경을 적용합니다. `config/runtime.json`에서 직접 편집하는 항목의 경우:

1. 파일의 사본을 만드세요. 예: `sudo cp -p /opt/proanima-arkvory/config/runtime.json /root/runtime.json.bak`. 이 파일에는 데이터베이스 비밀번호가 있으므로 사본을 비공개로 보관하세요.
2. 파일을 제자리에서 편집하세요. 모든 값이 문자열이 되도록 JSON을 유효하게 유지하세요.
3. 소유자와 모드를 확인하세요. Linux에서는 `root:arkvory`와 `0640`을 유지해야 합니다. `sudo chown root:arkvory runtime.json`과 `sudo chmod 0640 runtime.json`으로 복구하세요.
4. 서비스를 다시 시작하세요. 설정은 시작할 때만 읽힙니다.

   ```bash
   sudo systemctl restart arkvory-api arkvory-worker arkvory-backup
   ```

   ```powershell
   Restart-Service Arkvoryapi, Arkvoryworker, Arkvorybackup
   ```

   Compose 설치에서는 [Docker Compose](./docker#manage)의 `compose` 명령으로 컨테이너를 중지하고 시작하세요:

   ```bash
   "${compose[@]}" stop --timeout 120 backup worker api
   "${compose[@]}" up -d --wait api worker
   "${compose[@]}" up -d backup
   ```

5. 결과를 확인하세요. 범위를 벗어난 값은 시작할 때 변수 이름을 알리는 메시지와 함께 프로세스를 중지하며, 값 자체는 절대 알리지 않습니다. Linux에서는 `journalctl -u arkvory-api -n 50`으로 확인하세요. 이 경우 Arkvory는 기본값으로 대체하지 않습니다.

재시작은 실행 중인 전송을 중단합니다. 클라이언트가 이를 재개합니다.

## 복구 키 교체 {#replace-recovery-key}

누군가 `config/bootstrap-token.txt`를 읽었다고 의심되면 복구 키를 교체하세요. 키는 함께 변경해야 하는 두 곳에 저장됩니다: `bootstrap-token.txt` 파일에 키가 있고, `keys.json`의 `bootstrap-owner` 항목에 그 SHA-256이 있습니다. `deployment-health` 항목은 그대로 두세요.

1. `config/keys.json`의 사본을 만드세요.
2. 다음 스크립트를 `replace-recovery-key.mjs`로 저장하세요:

   ```js
   import { createHash, randomBytes } from 'node:crypto';
   import { readFileSync, writeFileSync } from 'node:fs';

   const directory = process.argv[2];
   const token = randomBytes(32).toString('hex');
   const keys = JSON.parse(readFileSync(`${directory}/keys.json`, 'utf8'));
   const owner = keys.find((key) => key.id === 'bootstrap-owner');
   if (!owner) throw new Error('No bootstrap-owner entry');
   owner.sha256 = createHash('sha256').update(token).digest('hex');
   writeFileSync(`${directory}/keys.json`, JSON.stringify(keys, null, 2));
   writeFileSync(`${directory}/bootstrap-token.txt`, token);
   ```

3. 설치의 Node.js로 `root` 또는 관리자 권한으로 실행하세요. 스크립트는 기존 파일에 쓰므로 소유자와 액세스 규칙은 그대로 유지됩니다.

   ```bash
   sudo /opt/proanima-arkvory/runtime/node ./replace-recovery-key.mjs /opt/proanima-arkvory/config
   ```

   ```powershell
   & 'C:\ProgramData\ProAnima\Arkvory\runtime\node.exe' .\replace-recovery-key.mjs 'C:\ProgramData\ProAnima\Arkvory\config'
   ```

   스크립트 설치 후에는 대신 `runtime\node-v24.21.0-…` 아래의 Node.js를 사용하세요.

4. [변경 적용](#apply-change)에 표시된 대로 서비스를 다시 시작하세요.
5. `config/bootstrap-token.txt`에서 새 키를 읽고, 스크립트와 `keys.json`의 사본을 삭제하세요.

계정, 개인용 액세스 토큰, 서비스 키는 영향을 받지 않습니다. 이들은 데이터베이스에 있습니다.
