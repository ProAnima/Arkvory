---
title: 'Docker Compose'
description: 'Arkvory를 Docker Compose 프로젝트로 실행하는 방법과 컨테이너, 볼륨, 포트, 업데이트, 백업 에이전트, 제거를 설명합니다.'
---

# Docker Compose

Compose 설치는 API, 워커, 백업 에이전트, PostgreSQL을 한 호스트에서 컨테이너로 실행합니다. 설치 프로그램은 릴리스에서 Arkvory 이미지를 빌드하고 `proanima-arkvory` 프로젝트를 시작합니다. 컨테이너 호스트에서 사용하세요. Windows에서는 Docker Desktop을 평가용으로만 사용하세요: [Docker Desktop이 있는 Windows](#docker-desktop)를 참조하세요.

Compose에는 내장 HTTPS가 없습니다. 다른 컴퓨터의 클라이언트가 연결하기 전에 앞에 리버스 프록시를 두세요: [HTTPS와 리버스 프록시](./https)를 참조하세요.

## 요구 사항 {#requirements}

| 항목           | 요구 사항                                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 엔진           | Compose 플러그인이 있는 Docker Engine(`docker compose`). 호환되는 compose 공급자가 있는 Podman은 `--engine podman`으로 가능하지만 테스트되지 않았습니다                           |
| 계정           | `root` 또는 `docker` 그룹의 사용자                                                                                                                                                |
| 부팅 시 시작   | 컨테이너 엔진이 부팅 시 시작되어야 합니다. 그렇지 않으면 재시작 후 Arkvory가 돌아오지 않습니다. `systemctl is-enabled docker`로 확인하세요                                        |
| 호스트         | 컨테이너 호스트당 Arkvory 설치 하나. 프로젝트 이름과 포트는 고정입니다                                                                                                            |
| 사용 가능 포트 | `127.0.0.1`의 8080                                                                                                                                                                |
| 컨테이너       | Linux 컨테이너만 지원합니다. Windows 컨테이너는 지원되지 않습니다                                                                                                                 |
| 인터넷         | `nodejs.org`(설치 프로그램이 Node.js 24.21.0을 다운로드하고 SHA-256을 확인합니다), 업데이트 허브 또는 GitHub(릴리스), Docker Hub(`node:24.21.0-bookworm-slim` 및 `postgres:18.4`) |

설치 프로그램은 컨테이너 엔진, 하이퍼바이저 또는 WSL을 설치하거나 변경하지 않습니다.

## 번들 {#bundle}

설치 프로그램은 검증된 릴리스를 가져와 설치 루트의 `releases/<version>/`에 압축을 풉니다. Compose 파일은 `releases/<version>/deploy/compose.yml`이고 빌드 파일은 `releases/<version>/deploy/Dockerfile`입니다. `proanima-arkvory:<version>` 이미지는 `node:24.21.0-bookworm-slim`에서 호스트에 빌드됩니다. Arkvory 레지스트리에서는 아무것도 가져오지 않습니다.

설치 루트는 Linux에서 `/opt/proanima-arkvory`입니다. 그 구조는 [설치 선택](./#installation-directory)에서 설명합니다. Compose 설치에서는 데이터가 `data/`에 없고 아래에 설명된 볼륨에 있습니다.

## 컨테이너 {#containers}

| 서비스        | 이미지                       | 역할                                                                                |
| ------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| `database`    | `postgres:18.4`              | PostgreSQL. 5초마다 `pg_isready`로 준비 상태를 보고합니다                           |
| `api`         | `proanima-arkvory:<version>` | HTTP API와 콘솔. `127.0.0.1:8080`에 게시됩니다. 10초마다 상태 확인                  |
| `worker`      | `proanima-arkvory:<version>` | 업로드를 마무리하고 백그라운드 작업을 실행합니다. API가 정상이 된 후 시작됩니다     |
| `backup`      | `proanima-arkvory:<version>` | 백업 에이전트. 스토리지 볼륨을 읽기 전용으로 읽습니다. 포트를 게시하지 않습니다     |
| `initialize`  | `proanima-arkvory:<version>` | 일회성, root로 실행: 스토리지 볼륨의 소유권을 사용자 1000에 부여합니다              |
| `migrate`     | `proanima-arkvory:<version>` | 일회성: 데이터베이스 마이그레이션을 실행합니다                                      |
| `vault-owner` | `proanima-arkvory:<version>` | 일회성, `maintenance` 프로필에서만: 백업 보관소의 소유권을 사용자 1000에 부여합니다 |

오래 실행되는 서비스는 중지하지 않는 한 다시 시작됩니다. Arkvory의 컨테이너는 이미지의 `node` 사용자(사용자 1000)로 실행되며, 루트 파일 시스템은 읽기 전용이고, 메모리에 64 MiB의 `/tmp`를 두며, 모든 기능(capability)이 제거되고, `no-new-privileges`가 설정되며, 중지에 120초가 주어집니다. Docker는 컨테이너마다 최대 5개의 20 MiB JSON 로그 파일을 유지합니다.

## 볼륨과 바인드 마운트 {#volumes}

### Docker 볼륨 {#docker-volumes}

| 볼륨                       | 마운트 위치                        | 내용                                                                    |
| -------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| `proanima-arkvory_storage` | `/var/lib/arkvory`                 | 파일 내용과 업로드 스테이징. 백업 에이전트가 읽기 전용으로 마운트합니다 |
| `proanima-arkvory_catalog` | `database`의 `/var/lib/postgresql` | PostgreSQL 데이터                                                       |

볼륨은 업데이트와 `docker compose down` 후에도 유지됩니다. `down --volumes`만이 이를 삭제합니다.

### 설치 루트의 바인드 마운트 {#bind-mounts}

| 호스트 경로               | 컨테이너 내부                   | 모드      | 마운트 대상                                     |
| ------------------------- | ------------------------------- | --------- | ----------------------------------------------- |
| `config/runtime.json`     | `/run/arkvory/runtime.json`     | 읽기 전용 | api, worker, backup                             |
| `config/keys.json`        | `/run/arkvory/keys.json`        | 읽기 전용 | api, worker                                     |
| `config/health-token.txt` | `/run/arkvory/health-token.txt` | 읽기 전용 | api, worker                                     |
| `config/postgres.env`     | 환경 파일                       |           | database                                        |
| `updates/status`          | `/run/arkvory-updates/status`   | 읽기 전용 | api, worker                                     |
| `updates/inbox`           | `/run/arkvory-updates/inbox`    | 읽기/쓰기 | api, worker                                     |
| 백업 보관소               | `/srv/arkvory-vault`            | 읽기/쓰기 | backup, `vault-owner`(보관소가 구성된 동안에만) |
| `config/mirrors`          | `/run/arkvory/mirrors`          | 읽기 전용 | api, worker(리포지토리가 미러링되는 동안에만)   |

### 소유자와 모드 {#owners}

| 경로                                                   | 소유자와 모드         | 이유                                                                                                                                                        |
| ------------------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 설치 루트                                              | 설치한 사용자, `0700` | 루트에는 복구 키와 데이터베이스 비밀번호가 있습니다. 설치한 사용자만 들어갈 수 있습니다                                                                     |
| `config/runtime.json`, `keys.json`, `health-token.txt` | `0644`                | 컨테이너의 사용자 1000이 읽어야 합니다. `runtime.json`에는 데이터베이스 비밀번호가 있습니다. `0700` 루트는 다른 사용자가 이 파일들에 접근하지 못하게 합니다 |
| `updates/inbox`                                        | `0777`                | 컨테이너가 호스트에 쓰는 유일한 디렉터리입니다. 컨테이너 사용자와 호스트 업데이터의 사용자 ID가 다를 수 있습니다                                            |
| `updates/status`                                       | `0755`                | 호스트 업데이터가 쓰고, 컨테이너는 읽기만 합니다                                                                                                            |
| 스토리지 볼륨                                          | 사용자 1000           | `initialize`가 설치와 업데이트 시 설정합니다                                                                                                                |
| 백업 보관소                                            | 사용자 1000           | 보관소를 연결할 때 `vault-owner`가 설정합니다. 그러면 보관소는 ID 1000인 호스트 사용자 소유가 됩니다                                                        |

## 포트 {#ports}

| 포트     | 서비스     | 노출                                                              |
| -------- | ---------- | ----------------------------------------------------------------- |
| 8080/TCP | API와 콘솔 | 호스트의 `127.0.0.1:8080`. 주소는 고정입니다                      |
| 5432/TCP | PostgreSQL | 게시되지 않습니다. Compose 네트워크 내부에서만 접근할 수 있습니다 |

Compose 파일은 업데이트가 교체하는 릴리스 디렉터리에 속하므로, 거기서 게시 주소를 변경할 수 없습니다. 다른 컴퓨터에서 콘솔에 접근하려면 호스트에 `127.0.0.1:8080`으로 전달하는 리버스 프록시를 설치하세요.

## 환경 {#environment}

Compose 파일은 Arkvory 설정을 지정하지 않습니다. 서비스는 호스트의 `config/runtime.json`인 `/run/arkvory/runtime.json`을 읽습니다. 설치 프로그램이 다음 값을 쓰므로 변경하지 마세요: `ARKVORY_HOST`(컨테이너 내부의 `0.0.0.0`), `ARKVORY_PORT`(`8080`), `ARKVORY_DATABASE_URL`(생성된 비밀번호가 있는 `database` 컨테이너), `ARKVORY_DATA_DIR`(`/var/lib/arkvory`), `ARKVORY_KEYS_FILE`, `ARKVORY_UPDATE_CONTROL_DIR`.

`ARKVORY_TRUSTED_PROXIES`, 한도, `ARKVORY_LOG_LEVEL` 같은 다른 설정을 추가할 수 있습니다. `config/runtime.json`에 추가한 다음 [프로젝트 관리](#manage)에 표시된 대로 서비스를 중지하고 시작하세요. 전체 목록은 [환경 변수](../reference/environment)에 있습니다. `config/compose.env`에는 `ARKVORY_IMAGE`가 있습니다. 설치 프로그램이 관리하므로 편집하지 마세요.

## Linux에 설치 {#install}

1. [GitHub Releases](https://github.com/ProAnima/Arkvory/releases)에서 `install.sh`를 다운로드하여 읽어 보세요.
2. `root`로 실행하세요:

   ```bash
   sudo bash ./install.sh --mode compose
   ```

   자동 업데이트를 켜려면 `--automatic`을, Podman을 사용하려면 `--engine podman`을 추가하세요. `ARKVORY_RELEASE_VERSION=1.2.3`을 지정하면 스크립트가 해당 안정 버전을 설치합니다. GitHub에 인터넷으로 접속할 수 없다면 `Arkvory-Linux.tar.gz`의 압축을 풀고 압축을 푼 디렉터리에서 `sudo env ARKVORY_ARTIFACT_DIR="$PWD" bash ./install.sh --mode compose`를 실행하세요. Node.js는 여전히 다운로드됩니다.

3. 설치 프로그램이 끝날 때까지 기다리세요. 릴리스를 확인하고 압축을 풀고, 이미지를 빌드하고, 데이터베이스를 시작하고, `initialize`와 `migrate`를 실행하고, API와 워커를 시작하고, API가 연속 세 번 준비 상태를 보고할 때까지 기다린 다음, 백업 에이전트를 시작하고 업데이트 타이머를 등록합니다.

`docker` 그룹의 사용자는 사용자가 소유한 디렉터리에 `root` 없이 설치할 수 있습니다:

```bash
ARKVORY_INSTALL_ROOT="$HOME/arkvory" bash ./install.sh --mode compose
```

그러면 설치 프로그램은 업데이트 타이머를 등록하지 않습니다. 직접 업데이터를 예약할 때까지 콘솔에서 업데이트를 요청할 수 없습니다. [Compose의 업데이트](#updates-compose)를 참조하세요.

## 최초 시작과 시작하기 {#first-start}

1. 컨테이너가 실행 중인지 확인하세요. `compose` 명령은 [프로젝트 관리](#manage)를 참조하세요.

   ```bash
   "${compose[@]}" ps
   ```

2. 복구 키를 읽으세요:

   ```bash
   sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
   ```

3. 서버에서 `http://127.0.0.1:8080/console/#onboarding`을 여세요. 자신의 컴퓨터에서 포트를 전달하려면: `ssh -L 8080:127.0.0.1:8080 admin@arkvory.example`.
4. 콘솔에서 [[ui:navStart]]를 열고 [[ui:welcomeOwner]]를 펼치세요. 키를 [[ui:welcomeRecovery]]에 붙여넣고, 소유자 이름과 12자 이상의 비밀번호를 입력한 다음 [[ui:welcomeCreate]]를 선택하세요.

복구 키는 서버에 보관하세요. [보안](../operate/security)을 참조하세요.

## 프로젝트 관리 {#manage}

root 셸(`sudo -i`)을 열고 `compose` 명령을 한 번 정의하세요. Compose에는 프로젝트 이름, 프로젝트 디렉터리, 환경 파일, 설치의 모든 Compose 파일이 필요합니다:

```bash
root=/opt/proanima-arkvory
node="$root/runtime/node-v24.21.0-linux-x64/bin/node"   # linux-arm64 on arm64
version=$("$node" -p "require('$root/installation.json').current.version")
compose=(docker compose --project-name proanima-arkvory --project-directory "$root"
  --env-file "$root/config/compose.env" -f "$root/releases/$version/deploy/compose.yml")
for file in compose.vault.yml compose.mirrors.yml; do
  if [[ -f "$root/config/$file" ]]; then compose+=(-f "$root/config/$file"); fi
done
```

존재하는 파일을 빼먹으면 `up`이 보관소나 미러 마운트 없이 컨테이너를 다시 만듭니다.

| 작업          | 명령                                                                            |
| ------------- | ------------------------------------------------------------------------------- |
| 컨테이너 표시 | `"${compose[@]}" ps`                                                            |
| 로그 읽기     | `"${compose[@]}" logs --tail 100 api worker backup`                             |
| Arkvory 중지  | `"${compose[@]}" stop --timeout 120 backup worker api`                          |
| Arkvory 시작  | `"${compose[@]}" up -d --wait api worker` 그다음 `"${compose[@]}" up -d backup` |

`stop`으로 중지하면 엔진 재시작 후에도 컨테이너가 중지 상태로 유지됩니다. `up -d`로 다시 시작하세요.

수명 주기 명령은 설치 프로그램이 루트에 넣은 Node.js로 실행됩니다:

```bash
sudo "$node" "$root/manage.mjs" status --root "$root"
```

Compose 호스트에는 `arkvory`가 설치되지 않으므로 `status`, `update`, `configure`에는 `manage.mjs`를 호출하세요. 명령은 [구성](./configuration)에 설명되어 있습니다.

## 로그 {#logs}

컨테이너는 Docker의 JSON 로그 파일에 씁니다. `"${compose[@]}" logs`로 읽으세요. API와 워커는 줄마다 JSON 레코드 하나를 씁니다. [모니터링](../operate/monitoring)을 참조하세요. 수명 주기 명령은 메시지를 터미널에 출력하고, 업데이트 타이머는 저널에 씁니다: `journalctl -u arkvory-update`.

## Compose의 업데이트 {#updates-compose}

콘솔, 자동 업데이트 시간, 또는 명령으로 업데이트하세요:

```bash
sudo "$node" "$root/manage.mjs" update --root "$root"
```

업데이트는 릴리스를 다운로드하고 확인하고, 새 이미지를 빌드한 다음, `backup`, `worker`, `api`를 중지하고 새 이미지로 시작합니다. `database` 컨테이너는 계속 실행됩니다. 볼륨은 그대로 유지됩니다. 데이터베이스 스키마를 변경하는 릴리스는 검증된 백업 후에만 설치됩니다. [업데이트](./updates)를 참조하세요.

호스트 업데이터는 1분에 한 번 실행됩니다. systemd 호스트에 `root`로 설치하면 설치 프로그램이 이를 `arkvory-update.timer`로 등록합니다. `root`가 아니면 설치 프로그램이 경고를 출력합니다. 설치를 소유하고 컨테이너 엔진에 접근할 수 있는 사용자로 이 명령을 1분마다 예약하세요. 예를 들어 cron을 사용합니다:

```text
* * * * * /home/admin/arkvory/runtime/node-v24.21.0-linux-x64/bin/node /home/admin/arkvory/manage.mjs updates-poll --root /home/admin/arkvory
```

Arkvory 컨테이너에 Docker 소켓을 주지 마세요.

## Compose의 백업 에이전트 {#backup-agent}

`backup` 컨테이너는 처음부터 실행됩니다. 보관소가 없으면 실행되면서 보관소가 구성되지 않았다고 보고합니다. 보관소는 설치 루트 밖, 별도 볼륨에 있는 호스트의 디렉터리입니다.

1. 보관소 볼륨을 마운트하고 빈 디렉터리를 만드세요. 예: `/mnt/backup/arkvory`. 디렉터리가 존재해야 합니다. Compose는 이를 만들지 않습니다.
2. 연결하세요:

   ```bash
   sudo "$node" "$root/manage.mjs" configure --root "$root" --backup-vault /mnt/backup/arkvory --vault-key-file /root/arkvory-agent.key
   ```

   이 명령은 디렉터리를 확인하고, `config/compose.vault.yml`을 쓰고, 디렉터리의 소유권을 사용자 1000에 부여하고, 에이전트 키 파일을 읽기 전용으로 백업 컨테이너에 전달하고(`--vault-key-file`), 백업 컨테이너만 다시 시작합니다. 에이전트가 보관소를 사용 가능하다고 보고하면 성공합니다. 그렇지 않으면 이전 구성을 복원합니다.

3. 보관소 연결을 끊으려면 같은 명령을 `--backup-vault-off`와 함께 실행하세요. 보관소 자체는 건드리지 않습니다.

일정, 보존, 복원은 [백업](../operate/backups)에 설명되어 있습니다.

## 제거 {#remove}

```bash
"${compose[@]}" down              # removes the containers, keeps the volumes
"${compose[@]}" down --volumes    # also deletes the catalog and all stored files
```

`down --volumes`는 모든 데이터를 삭제합니다. 파일이 있는 설치에서는 절대 실행하지 마세요. 먼저 백업하고 보관소를 보관하세요.

`down` 후에는 남은 것을 제거할 수 있습니다:

```bash
sudo systemctl disable --now arkvory-update.timer
sudo rm -f /etc/systemd/system/arkvory-update.service /etc/systemd/system/arkvory-update.timer
sudo systemctl daemon-reload
docker image rm "proanima-arkvory:$version"
sudo rm -rf /opt/proanima-arkvory
```

구성과 복구 키가 더 이상 필요하지 않을 때만 루트를 삭제하세요. 이전 버전의 이미지는 제거할 때까지 호스트에 남아 있습니다.

## Docker Desktop이 있는 Windows {#docker-desktop}

Docker Desktop은 워크스테이션에서 평가용으로만 사용하세요. Docker Desktop은 한 사용자의 애플리케이션입니다: 이 사용자가 로그인하고 Docker Desktop이 실행되는 동안에만 컨테이너가 실행됩니다. 컴퓨터를 다시 시작하면 그때까지 Arkvory를 사용할 수 없습니다. **Settings > General > Start Docker Desktop when you sign in**을 활성화하세요. 설치 프로그램과 `status` 명령은 이 설정이 꺼져 있으면 경고합니다. 서버에는 [Windows 서비스](./windows)를 사용하세요.

1. Docker Desktop을 Linux 컨테이너 모드로 시작하세요.
2. 릴리스에서 `install.ps1`을 다운로드하여 읽어 보세요.
3. Docker Desktop을 실행하는 사용자로 Windows PowerShell을 **관리자 권한 없이** 열고 실행하세요:

   ```powershell
   .\install.ps1 -Mode compose
   ```

   매개변수 `-Root`, `-Version`, `-Engine`, `-Artifact`, `-AutomaticUpdates`, `-Pin`은 [Windows](./windows#install-with-powershell-and-an-existing-postgresql)에 설명되어 있습니다. `-Root`와 `-Artifact`는 절대 경로로 지정하세요.

4. `http://127.0.0.1:8080/console/#onboarding`을 열고, `C:\ProgramData\ProAnima\Arkvory\config\bootstrap-token.txt`에서 복구 키를 읽은 다음, [최초 시작과 시작하기](#first-start)에 설명된 대로 소유자를 만드세요.

설치 루트 `C:\ProgramData\ProAnima\Arkvory`는 상속 없이 SYSTEM, Administrators, 설치한 사용자에게 접근 권한을 부여합니다. Docker Desktop이 이 사용자의 토큰으로 바인드 마운트를 읽기 때문입니다. Compose에서는 설치 프로그램을 관리자 권한으로 실행하지 마세요.

설치 프로그램은 관리자로 실행될 때만 업데이트 작업 `ProAnimaArkvoryUpdate`를 등록합니다. 그 작업은 시스템 전체 엔진에 적합하며 Docker Desktop에는 맞지 않습니다. Docker Desktop의 경우 Docker Desktop 사용자로 작업을 등록하세요. 이 작업은 이 사용자가 로그인하고 Docker Desktop이 실행되는 동안에만 동작합니다:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
$node = "$root\runtime\node-v24.21.0-win-x64\node.exe"
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$root\manage.mjs`" updates-poll --root `"$root`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Action $action -Trigger $trigger -Settings $settings
```

PowerShell에서 같은 인수로 프로젝트를 관리하세요:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
$version = (Get-Content "$root\installation.json" -Raw | ConvertFrom-Json).current.version
$compose = @('compose', '--project-name', 'proanima-arkvory', '--project-directory', $root,
  '--env-file', "$root\config\compose.env", '-f', "$root\releases\$version\deploy\compose.yml")
foreach ($file in 'compose.vault.yml', 'compose.mirrors.yml') {
  if (Test-Path "$root\config\$file") { $compose += @('-f', "$root\config\$file") }
}
docker @compose ps
& "$root\runtime\node-v24.21.0-win-x64\node.exe" "$root\manage.mjs" status --root $root
```

Windows의 백업 보관소는 로컬 또는 iSCSI 볼륨이어야 합니다. UNC 및 SMB 경로는 거부됩니다. 설치를 제거하려면 `docker @compose down --volumes`를 실행하고, `Unregister-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Confirm:$false`로 작업을 등록 해제한 다음 루트를 삭제하세요. 먼저 백업하세요.
