---
title: Linux
description: Linux에서 .deb 또는 .rpm 패키지로 Arkvory를 설치하고, 시작하고, systemd 서비스를 운영하고, 업그레이드하고 제거합니다.
---

# Linux

Linux에서 Arkvory를 실행하는 방법은 두 가지입니다.

- **패키지** `Arkvory-amd64.deb` 또는 `Arkvory-x86_64.rpm`. 권장합니다. systemd 서비스와 Arkvory가 관리하는 전용 PostgreSQL 클러스터를 설치합니다. PostgreSQL 프로그램은 패키지 관리자가 제공합니다.
- **스크립트** `install.sh`. 같은 서비스를 설치하지만 기존 PostgreSQL 서버를 사용합니다. arm64도 지원합니다. [기존 PostgreSQL 사용](#existing-postgresql)을 참조하세요.

Docker는 [Docker Compose](./docker)를 참조하세요. 콘솔을 처음 살펴보려면 [빠른 시작](../guide/quick-start)을 참조하세요.

## 요구 사항 {#requirements}

| 항목                | 요구 사항                                                                                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 프로세서            | 패키지는 x64용입니다. arm64 패키지는 없습니다. arm64에서는 `install.sh`를 사용하세요                                                                                                                                                            |
| 초기화 시스템       | systemd. OpenRC, runit 및 기타 초기화 시스템은 지원하지 않습니다                                                                                                                                                                                |
| C 라이브러리        | glibc 2.28 이상. Alpine Linux(musl)는 지원하지 않습니다                                                                                                                                                                                         |
| 테스트된 배포판     | `.deb`는 Ubuntu 24.04, `.rpm`은 Fedora 44. 아래 종속성을 충족하는 다른 systemd 배포판은 테스트되지 않았습니다                                                                                                                                   |
| `.deb`의 종속성     | `postgresql` 16 이상, `systemd`, `python3`, `ca-certificates`, `libc6` 2.28 이상, `libstdc++6`, `libgcc-s1`, `libatomic1`                                                                                                                       |
| `.rpm`의 종속성     | `postgresql-server` 16 이상, `systemd`, `python3`, `ca-certificates`, `glibc` 2.28 이상, `libstdc++`, `libatomic`                                                                                                                               |
| PostgreSQL 프로그램 | 버전 16~19. 설치 단계에서 `/usr/lib/postgresql/*/bin`, `/usr/pgsql-*/bin`, `/usr/bin`, `/usr/lib/pgsql/bin`을 검색하여 찾은 가장 높은 버전을 사용합니다. 배포판이 더 오래된 버전만 제공한다면 먼저 더 새로운 PostgreSQL 리포지토리를 추가하세요 |
| 계정                | `root` 또는 `sudo`를 실행할 수 있는 사용자                                                                                                                                                                                                      |
| 사용 가능한 포트    | `127.0.0.1`의 8080과 54329                                                                                                                                                                                                                      |
| 파일 스토리지       | 하드 링크를 지원하는 로컬 파일 시스템. 네트워크 공유를 사용하지 마세요                                                                                                                                                                          |

패키지에는 Node.js 24가 포함되어 있습니다. 설치에는 패키지 관리자가 종속성을 처리하는 데 사용하는 것 외의 인터넷 액세스가 필요하지 않습니다.

패키지는 기존 PostgreSQL 클러스터나 서비스를 변경하지 않습니다. Arkvory는 PostgreSQL 프로그램으로 자체 클러스터를 시작합니다.

## 패키지 설치 {#install-package}

1. [GitHub Releases](https://github.com/ProAnima/Arkvory/releases)에서 배포판에 맞는 패키지를 같은 릴리스의 `native-linux.json`과 함께 다운로드하세요.
2. 패키지의 SHA-256을 `native-linux.json`의 값과 비교하세요. 패키지는 게시자 키로 서명되지 않으므로, 이 검사가 다운로드한 파일이 무엇인지 증명하는 유일한 방법입니다.
3. 패키지를 설치하세요. 파일 이름 앞의 `./`를 유지하세요. 이 표시는 파일이 로컬에 있음을 패키지 관리자에게 알려 줍니다. Debian과 Ubuntu에서는:

```bash
sudo apt install ./Arkvory-amd64.deb
```

Fedora 및 RPM 호환 시스템에서는:

```bash
sudo dnf install ./Arkvory-x86_64.rpm
```

패키지 관리자가 종속성을 설치한 다음 Arkvory가 스스로를 구성합니다. 구성 단계에서는 다음을 수행합니다.

1. Node.js를 `/opt/proanima-arkvory/runtime/node`로 복사합니다.
2. 두 서비스 계정, 구성, 키, 복구 키를 만듭니다.
3. PostgreSQL 클러스터를 만들고 시작하며 데이터베이스 마이그레이션을 실행합니다.
4. 서비스와 업데이트 타이머를 등록하고 시작합니다.
5. API가 준비 상태 확인에 연속 세 번 응답할 때까지 기다립니다.

마지막에 콘솔 주소와 복구 키의 경로를 출력합니다. 단계가 실패하면 설치는 오류와 함께 중단됩니다. [문제 해결](#troubleshooting)을 참조하세요.

설치 후에는 자동 업데이트가 꺼져 있습니다. 켜는 방법은 [업데이트](./updates)를 참조하세요.

## 패키지가 만드는 항목 {#what-package-creates}

### 파일과 디렉터리 {#files}

| 경로                                                            | 내용                                                                                                                             |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `/usr/lib/proanima-arkvory/`                                    | 패키지 페이로드: Node.js, 릴리스 파일, 설치 프로그램. 패키지가 소유합니다                                                        |
| `/usr/bin/arkvory`                                              | 관리 명령. [arkvory 명령](#arkvory-command)을 참조하세요                                                                         |
| `/usr/share/applications/arkvory.desktop`                       | 데스크톱에서 콘솔을 여는 메뉴 항목. 데스크톱이 없는 서버에서는 사용하지 않습니다                                                 |
| `/opt/proanima-arkvory/`                                        | 설치 루트: 구성, 데이터, 데이터베이스, 각 버전의 프로그램 코드. 레이아웃은 [설치 선택](./#installation-directory)에서 설명합니다 |
| `/etc/systemd/system/arkvory-*.service`, `arkvory-update.timer` | 서비스 유닛과 업데이트 타이머                                                                                                    |

루트는 `root:arkvory`이며 모드는 `0711`입니다. 그 안에서 `config/`는 `0750 root:arkvory`이고, `data/`와 `logs/`는 `arkvory` 소유이며, `database/`는 `arkvory-db` 소유에 모드 `0700`입니다. 복구 키와 데이터베이스 비밀번호 파일은 `root`만 읽을 수 있습니다.

### 계정 {#accounts}

| 계정         | 실행 대상                | 비고                                                                         |
| ------------ | ------------------------ | ---------------------------------------------------------------------------- |
| `arkvory`    | API, 워커, 백업 에이전트 | 시스템 계정, 로그인 셸 없음, 홈 디렉터리 `/opt/proanima-arkvory/data`        |
| `arkvory-db` | 데이터베이스             | 시스템 계정, 로그인 셸 없음. API 계정은 데이터베이스 파일을 읽을 수 없습니다 |

### 서비스 {#services}

| 유닛                   | 실행 계정                                | 재시작 정책                                      |
| ---------------------- | ---------------------------------------- | ------------------------------------------------ |
| `arkvory-database`     | `arkvory-db`                             | `on-failure`, 10초 후                            |
| `arkvory-api`          | `arkvory`                                | `always`, 10초 후                                |
| `arkvory-worker`       | `arkvory`                                | `always`, 10초 후                                |
| `arkvory-backup`       | `arkvory`                                | `always`, 10초 후                                |
| `arkvory-update.timer` | `arkvory-update.service`를 `root`로 시작 | 매분. 작업은 업데이트 요청과 릴리스를 확인합니다 |

모든 유닛은 부팅 시(`multi-user.target`) 시작합니다. 중지에 120초를 허용합니다. `NoNewPrivileges`, 비공개 `/tmp`, 자체 디렉터리 외부의 읽기 전용 파일 시스템, `/home`에 대한 액세스 없음으로 실행됩니다. API와 워커는 루트의 `data/`, `logs/`, `updates/inbox/`에만 쓸 수 있습니다. 백업 에이전트는 스토리지를 읽고 백업 보관소에만 씁니다. 유닛에서 `/home`이 숨겨져 있으므로 인증서, 보관소, 데이터 디렉터리를 홈 디렉터리 아래에 두지 마세요.

요청하지 않았는데 중지된 서비스는 10초 후에 다시 시작합니다. 메인 스레드가 60초 동안 멈춘 프로세스는 스스로 종료되고 다시 시작합니다. 준비 상태 확인이 실패했다는 이유만으로는 서비스를 다시 시작하지 않습니다. [자가 복구](../operate/self-healing)를 참조하세요.

### 포트 {#ports}

| 포트      | 용도                       | 노출                                           |
| --------- | -------------------------- | ---------------------------------------------- |
| 8080/TCP  | API와 콘솔                 | [HTTPS](./https)를 구성할 때까지 `127.0.0.1`만 |
| 54329/TCP | 관리형 PostgreSQL 클러스터 | `127.0.0.1`만. 이 번호는 고정입니다            |

## 첫 시작과 시작하기 {#first-start}

1. 서비스가 실행 중인지 확인하세요.

   ```bash
   systemctl status arkvory-database arkvory-api arkvory-worker arkvory-backup
   ```

2. 복구 키를 읽으세요. `root`만 읽을 수 있습니다.

   ```bash
   sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
   ```

3. `http://127.0.0.1:8080/console/#onboarding`을 여세요. 원격 서버에서는 먼저 포트를 전달한 다음 자신의 컴퓨터에서 주소를 여세요.

   ```bash
   ssh -L 8080:127.0.0.1:8080 admin@arkvory.example
   ```

4. 콘솔에서 [[ui:navStart]]를 열고 [[ui:welcomeOwner]]를 펼치세요. 키를 [[ui:welcomeRecovery]]에 붙여넣고, 소유자 이름과 12자 이상의 비밀번호를 입력한 다음 [[ui:welcomeCreate]]를 선택하세요. 이름은 3~64자이며 라틴 문자, 숫자, 점, 대시, 밑줄을 사용할 수 있습니다.
5. 새 이름과 비밀번호로 로그인하세요.

소유자는 첫 번째 관리자입니다. 복구 키는 서버에 남아 있습니다. 파일을 삭제하지 말고 클라이언트나 CI 시스템에 복사하지 마세요. 설치 도구가 이 파일을 읽습니다. 일상적인 작업에는 계정과 서비스 키를 만드세요. [계정 및 액세스](../use/accounts)와 [보안](../operate/security)을 참조하세요.

다른 컴퓨터의 클라이언트가 연결하기 전에 [HTTPS](./https)를 구성하세요. 그런 다음 백업 보관소를 연결하고 첫 백업을 실행하세요. [백업](../operate/backups)을 참조하세요.

자신의 컴퓨터에서 서버에 설치하려면 대신 Arkvory Remote Setup을 사용할 수 있습니다. [설치 선택](./#remote-installation-over-ssh)을 참조하세요.

## arkvory 명령 {#arkvory-command}

패키지는 `/usr/bin/arkvory`를 설치합니다. `arkvory help`는 모든 명령을 나열하며 특별한 권한이 필요하지 않습니다. 다른 모든 명령은 `root`와 설치 루트가 필요합니다.

```bash
sudo arkvory status --root /opt/proanima-arkvory
```

`status`는 설치 모드, 설치된 버전, 자동 업데이트 설정, 버전 고정을 출력합니다.

| 명령              | 용도                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `status`          | 설치된 버전과 업데이트 정책을 표시합니다                                                         |
| `update`          | 더 새로운 안정 릴리스를 지금 설치합니다. [업데이트](./updates)를 참조하세요                      |
| `configure`       | HTTPS, 백업 보관소, 미러, 업데이트 정책, 허브를 설정합니다. [구성](./configuration)을 참조하세요 |
| `recover`         | 중단된 업데이트를 마무리합니다. [업데이트](./updates#recover-update)를 참조하세요                |
| `finish-install`  | 중단된 설치를 계속합니다                                                                         |
| `updates-connect` | 오래된 릴리스에서 업데이트된 설치의 콘솔과 업데이트 타이머를 연결합니다                          |

## 로그 {#logs}

서비스는 시스템 저널에 기록합니다. API와 워커는 한 줄에 JSON 레코드 하나를 기록합니다.

```bash
sudo journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup -u arkvory-database
sudo journalctl -u arkvory-api -f
sudo journalctl -u arkvory-update --since today
```

`arkvory-update`에는 업데이트 타이머의 출력이 들어 있습니다. 저널 크기와 보존 기간은 운영 체제의 설정입니다. 레코드 필드와 메트릭은 [모니터링](../operate/monitoring)을 참조하세요. 배포 명령은 `<ISO-8601 time> INFO|WARN|ERROR <text>` 형식의 줄을 출력합니다. 시크릿은 여기서 제거됩니다.

## 업그레이드 {#upgrade}

이전 패키지 위에 더 새로운 패키지를 설치하거나, 콘솔에서 또는 `arkvory update`로 업데이트하세요. 업데이트가 새 코드로 전환될 때까지 실행 중인 서비스는 계속 응답합니다. 정책, 데이터베이스 스키마 변경 전 백업, 복구 단계는 [업데이트](./updates)를 참조하세요.

Arkvory용 apt 또는 dnf 리포지토리는 없습니다. 릴리스 페이지에서 각 새 패키지를 다운로드하세요.

## 제거 {#remove}

### 패키지를 제거하고 데이터 유지 {#remove-package}

Debian과 Ubuntu에서는:

```bash
sudo apt remove proanima-arkvory
```

Fedora 및 RPM 호환 시스템에서는:

```bash
sudo dnf remove proanima-arkvory
```

제거는 서비스와 업데이트 타이머를 중지하고 비활성화합니다. `/usr/lib/proanima-arkvory`, `/usr/bin/arkvory`, 메뉴 항목을 삭제합니다. 의도적으로 다음을 **유지**합니다.

- `/opt/proanima-arkvory`: 데이터베이스, 모든 파일, 구성, 복구 키,
- `/etc/systemd/system`의 유닛 파일, `arkvory`와 `arkvory-db` 계정,
- 백업 보관소와 그 systemd drop-in. 보관소는 절대 건드리지 않습니다.

`apt purge`는 `apt remove`보다 더 많이 제거하지 않습니다. 패키지를 다시 설치하면 유지된 데이터로 이어서 진행하고 서비스를 시작합니다.

### 모두 제거 {#remove-all}

이렇게 하면 저장된 모든 파일과 카탈로그가 삭제됩니다. 먼저 백업을 만들고 보관소를 유지하세요.

```bash
sudo systemctl disable --now arkvory-update.timer arkvory-backup arkvory-worker arkvory-api arkvory-database
sudo rm -rf /opt/proanima-arkvory
sudo rm -f /etc/systemd/system/arkvory-*.service /etc/systemd/system/arkvory-update.timer
sudo rm -rf /etc/systemd/system/arkvory-backup.service.d
sudo systemctl daemon-reload
sudo userdel arkvory
sudo userdel arkvory-db
```

위에서 설명한 대로 먼저 패키지를 제거하세요. 스크립트로 설치한 경우에는 패키지가 없습니다. 첫 번째 명령이 서비스를 중지하고, `arkvory-database`와 `arkvory-db`를 지정한 명령은 해당 항목이 없다고 보고합니다.

## 기존 PostgreSQL 사용 {#existing-postgresql}

패키지는 항상 자체 클러스터를 만듭니다. 조직에서 운영하는 PostgreSQL 서버를 사용하려면 `install.sh`로 설치하세요. 같은 세 가지 서비스와 업데이트 타이머를 만들지만 `arkvory-database` 유닛과 `/usr/bin/arkvory` 명령은 만들지 않습니다.

PostgreSQL 16~19 버전을 사용하세요. 하나의 Arkvory 설치에 하나의 데이터베이스를 사용하세요. 두 설치를 같은 데이터베이스에 연결하지 마세요.

1. 데이터베이스 관리자에게 빈 데이터베이스와 그 데이터베이스를 소유하는 역할을 요청하세요. Arkvory는 이 역할로 마이그레이션을 실행합니다.
2. 릴리스에서 `install.sh`를 다운로드하고 읽어 보세요. `bash`, `curl`, `python3`, `tar`, `xz`, systemd, `root`가 필요합니다.
3. 실행하세요. 스크립트가 연결 URL을 묻습니다. 입력한 내용은 표시되지 않습니다.

   ```bash
   sudo bash ./install.sh --automatic
   ```

   대신 URL을 파일로 전달하려면 `root`만 읽을 수 있는 파일을 만드세요.

   ```json
   { "ARKVORY_DATABASE_URL": "postgresql://arkvory:<password>@db.example:5432/arkvory" }
   ```

   ```bash
   sudo bash ./install.sh --config /root/arkvory.json
   ```

4. 설치가 끝나면 임시 디렉터리 `/opt/proanima-arkvory/bootstrap.*`를 삭제하세요. 프롬프트에서 URL을 입력했다면 그 디렉터리의 `native.json`에 URL이 들어 있습니다.
5. [첫 시작과 시작하기](#first-start)에서 설명한 대로 소유자를 만드세요.

스크립트는 `nodejs.org`에서 Node.js 24.21.0을 다운로드하고 SHA-256을 확인한 다음 최신 안정 릴리스를 설치합니다. 자동 업데이트를 꺼 두려면 `--automatic`을 생략하세요. 환경 변수로 기본값을 변경할 수 있습니다.

| 변수                      | 의미                                                        | 기본값                  |
| ------------------------- | ----------------------------------------------------------- | ----------------------- |
| `ARKVORY_INSTALL_ROOT`    | 설치 루트. `/home` 밖의 전용 빈 디렉터리를 사용하세요       | `/opt/proanima-arkvory` |
| `ARKVORY_RELEASE_VERSION` | 최신 버전 대신 이 안정 버전을 설치합니다                    | 최신 안정 릴리스        |
| `ARKVORY_ARTIFACT_DIR`    | GitHub 대신 압축을 푼 `Arkvory-Linux.tar.gz`에서 설치합니다 | 설정되지 않음           |

`sudo env`를 통해 전달하세요. 예: `sudo env ARKVORY_INSTALL_ROOT=/srv/arkvory bash ./install.sh`.

`arkvory` 명령이 없으면 스크립트가 설치한 Node.js로 관리 프로그램을 호출하세요. arm64에서는 `linux-arm64`를 사용하세요.

```bash
root=/opt/proanima-arkvory
sudo "$root/runtime/node-v24.21.0-linux-x64/bin/node" "$root/manage.mjs" status --root "$root"
```

PostgreSQL 서버는 직접 백업하고 유지 관리합니다. Arkvory 백업 에이전트가 연결 URL을 통해 데이터베이스 내용을 보관소로 복사합니다. [백업](../operate/backups)을 참조하세요.

## 문제 해결 {#troubleshooting}

| 문제                                                                    | 해결 방법                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PostgreSQL 16–19 server binaries are required`                         | PostgreSQL 프로그램이 없거나 너무 오래되었습니다. 16~19 버전의 PostgreSQL 서버를 설치하고 패키지를 다시 설치하세요                                                                                                                                                                                                                        |
| `Use a dedicated empty installation directory`                          | `/opt/proanima-arkvory`에 `installation.json`을 저장하기 전에 중단된 첫 설치의 파일이 들어 있습니다. 설치 프로그램은 구성을 덮어쓰지 않습니다. 저널과 패키지 관리자 출력을 읽고 원인을 해결하세요. 아직 데이터가 없는 디렉터리는 다른 곳으로 옮겨 다시 설치할 수 있습니다. 데이터가 있는 설치의 `config/`나 `database/`를 삭제하지 마세요 |
| `Installation is locked`                                                | 작업이 실행 중이거나 중단되었습니다. 업데이트 타이머를 중지하고 루트의 `journal.json`을 읽으며, 상태를 알기 전에는 `operation.lock`을 삭제하지 마세요. [업데이트](./updates#recover-update)를 참조하세요                                                                                                                                  |
| `database/bootstrap-started`는 있지만 `database/initialized`가 없습니다 | 데이터베이스 생성이 중단되었습니다. 클러스터를 삭제하지 말고 SQL을 직접 반복하지도 마세요. 원인을 해결한 다음 `sudo arkvory finish-install --root /opt/proanima-arkvory`를 실행하세요                                                                                                                                                     |
| 서비스가 시작되지 않습니다                                              | `journalctl -u arkvory-api -n 100`. 시작 실패 시 설정 이름을 알려 주는 `reason`이 담긴 JSON 레코드 하나를 출력하며, 값은 절대 출력하지 않습니다                                                                                                                                                                                           |
| 포트 8080이 사용 중입니다                                               | 다른 프로그램이 사용하고 있습니다. 포트를 비우거나 `config/runtime.json`에 `ARKVORY_PORT`를 설정하세요. [구성](./configuration#address-and-port)을 참조하세요. 데이터베이스 포트 54329는 변경할 수 없습니다                                                                                                                               |

`installation.json`을 기록한 뒤 설치가 중단되었다면 패키지의 구성 단계를 다시 실행할 수도 있습니다. Debian과 Ubuntu에서는 `sudo dpkg --configure -a`, RPM 시스템에서는 같은 패키지를 다시 설치하세요.

더 많은 도움말은 [문제 해결](../operate/troubleshooting)에 있습니다.
