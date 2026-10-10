---
title: 설치 방식 선택
---

# 설치 방식 선택

Arkvory는 서버 한 대에서 실행됩니다. 모든 설치는 같은 구성 요소로 이루어집니다.

- **API**: HTTP API와 웹 콘솔입니다.
- **워커**: 업로드를 마무리하고 백그라운드 작업을 실행합니다.
- **백업 에이전트**: 예약된 백업을 백업 보관소에 만듭니다.
- **PostgreSQL**: 카탈로그용 데이터베이스입니다.

파일 콘텐츠는 서버의 로컬 디스크에 저장됩니다. 서버 한 대는 고가용성 시스템이 아닙니다. 업데이트나 서버 장애가 발생하면 짧은 중단이 생기며, 클라이언트는 전송을 재개합니다. 동기 복사본을 유지하며 서로를 대신해 인계받는 Linux 서버 두세 대는 [고가용성 클러스터](../operate/cluster)를 참조하세요.

## 설치 옵션 {#installation-options}

| 옵션                                                                                           | 플랫폼                                           | 로그인 없이 재부팅 후 시작                                                   | 데이터베이스                                           | 설치 후 자동 업데이트                                  | 권장 대상                                             |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------- |
| [그래픽 설치 프로그램](./windows) `Arkvory-Setup-x64.exe`                                      | Windows x64                                      | 예(Windows 서비스)                                                           | Arkvory가 관리하는 번들 PostgreSQL 18.4                | 꺼짐                                                   | 인터넷 연결 없이 설치하는 Windows 서버와 워크스테이션 |
| [Linux 패키지](./linux) `Arkvory-amd64.deb`, `Arkvory-x86_64.rpm`                              | systemd가 있는 Linux x64                         | 예(systemd 유닛)                                                             | 배포판이 제공하는 전용 PostgreSQL 클러스터(버전 16~19) | 꺼짐                                                   | Debian, Ubuntu 및 RPM 기반 서버                       |
| 스크립트, 네이티브 서비스: `install.sh`([Linux](./linux)), `install.ps1`([Windows](./windows)) | systemd가 있는 Linux x64 또는 arm64, Windows x64 | 예                                                                           | 기존 PostgreSQL 서버                                   | 꺼짐. `--automatic` / `-AutomaticUpdates`로 켤 수 있음 | 자동화, 기존 PostgreSQL 서버, Linux arm64             |
| [Docker Compose](./docker)                                                                     | Docker Engine이 있는 Linux                       | 예. 컨테이너 엔진이 부팅 시 시작되는 경우                                    | PostgreSQL 18.4 컨테이너                               | 꺼짐. `--automatic`으로 켤 수 있음                     | 컨테이너 호스트                                       |
| [Docker Desktop](./docker)                                                                     | Windows x64                                      | 아니요. 사용자가 로그인하고 Docker Desktop이 시작된 후에만 컨테이너가 실행됨 | PostgreSQL 18.4 컨테이너                               | 꺼짐. `-AutomaticUpdates`로 켤 수 있음                 | 워크스테이션에서의 평가                               |

모든 옵션은 같은 API, 워커, 백업 에이전트를 설치합니다. 내장 HTTPS는 네이티브 설치에서만 사용할 수 있습니다. Compose 설치에서 HTTPS를 사용하려면 리버스 프록시가 필요합니다. [HTTPS와 리버스 프록시](./https)를 참조하세요.

### SSH를 통한 원격 설치 {#remote-installation-over-ssh}

**Arkvory Remote Setup**은 클라이언트 패키지에 포함되어 있습니다. 관리자의 컴퓨터에서 실행되며, SSH로 서버에 연결해 네이티브 Linux 또는 Windows 패키지를 설치합니다. 이어서 소유자 계정을 만들고 비공개 SSH 터널을 통해 콘솔을 엽니다.

| 서버        | 요구 사항                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| Linux x64   | SSH와 SFTP, systemd, `apt-get` 또는 `dnf`, root 또는 `sudo -n`을 사용할 수 있는 사용자(비밀번호 입력 없음) |
| Windows x64 | SFTP가 있는 OpenSSH Server, Windows PowerShell, 관리자 계정                                                |

터널은 Remote Setup이 실행되는 동안에만 유지됩니다. Arkvory를 다른 컴퓨터에 공개하지 않습니다. 비밀번호가 필요한 `sudo`, SSH 에이전트, 점프 호스트, ARM 서버는 지원하지 않습니다.

## 릴리스 구성 {#what-a-release-contains}

릴리스는 [github.com/ProAnima/Arkvory/releases](https://github.com/ProAnima/Arkvory/releases)에 게시됩니다.

| 파일                                                                                                                                      | 용도                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `Arkvory-Setup-x64.exe`                                                                                                                   | Windows 그래픽 설치 프로그램입니다. Node.js, PostgreSQL, WinSW, Microsoft Visual C++ 런타임이 포함되어 있습니다           |
| `Arkvory-amd64.deb`, `Arkvory-x86_64.rpm`                                                                                                 | Linux 패키지입니다. Node.js가 포함되어 있습니다                                                                           |
| `install.sh`, `install.ps1`                                                                                                               | 네이티브 서비스 또는 Docker Compose용 명령줄 설치 프로그램입니다                                                          |
| `Arkvory-Linux.tar.gz`, `Arkvory-Windows.zip`                                                                                             | 자동화 키트입니다. 명령줄 설치 프로그램과 릴리스 파일이 들어 있으며, GitHub Releases에 접근하지 않고 설치할 때 사용합니다 |
| `Arkvory-CLI-Setup-x64.exe`, `Arkvory-CLI-amd64.deb`, `Arkvory-CLI-x86_64.rpm`                                                            | 클라이언트 패키지입니다. `arkvoryctl` 명령줄 클라이언트와 Arkvory Remote Setup이 들어 있습니다                            |
| `arkvoryctl.mjs`, `arkvory-remote.mjs`                                                                                                    | 같은 클라이언트 도구를 Node.js 24용 단일 파일로 제공한 것입니다                                                           |
| `arkvory-runtime.zip`, `arkvory-setup.mjs`, `arkvory-release.json`, `arkvory-release.json.sig`, `release-checksums.json`, `native-*.json` | 프로그램 파일, 매니페스트, 체크섬, 서명입니다. 설치 프로그램과 업데이터가 읽습니다                                        |

## 요구 사항 {#requirements}

| 항목                          | 요구 사항                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows, 그래픽 설치 프로그램 | x64, Windows 빌드 10.0.17763 이상(Windows 10 버전 1809, Windows Server 2019). 관리자 권한                                                   |
| Windows, 스크립트             | x64, Windows PowerShell. 네이티브 서비스에는 관리자 권한이 필요합니다                                                                       |
| Linux 패키지                  | x64, systemd, glibc 2.28 이상, Python 3. 패키지 관리자가 PostgreSQL 16 이상을 설치합니다                                                    |
| Linux, 스크립트               | x64 또는 arm64, 네이티브 서비스용 systemd, glibc, Bash, curl, Python 3, tar, xz                                                             |
| Docker Compose                | Compose 플러그인이 있는 Docker Engine 또는 Linux 컨테이너 모드의 Docker Desktop. 호환되는 compose 공급자가 있는 Podman도 사용할 수 있습니다 |
| PostgreSQL                    | Arkvory 설치 하나에 데이터베이스 하나입니다. 두 설치를 같은 데이터베이스에 연결하지 마세요                                                  |
| 파일 스토리지                 | 하드 링크를 지원하는 로컬 파일 시스템. 파일 스토리지에 네트워크 공유를 사용하지 마세요                                                      |
| 백업 보관소                   | 서비스가 시작되기 전에 마운트되는 별도 볼륨입니다. [백업](../operate/backups)을 참조하세요                                                  |

Arkvory는 프로세서나 메모리의 고정 최소 사양을 정의하지 않습니다. 파일, 데이터베이스, 백업 보관소에 필요한 디스크 공간을 계획하세요. 기본적으로 Arkvory는 스토리지 볼륨에 1 GiB의 여유 공간을 유지하고 최대 10 TiB의 예약된 업로드를 받습니다. 두 제한 모두 변경할 수 있습니다. [구성](./configuration)을 참조하세요.

### 설치와 업데이트 중의 네트워크 접근 {#network-access-during-installation-and-updates}

그래픽 설치 프로그램은 인터넷 연결 없이 동작합니다. 다른 옵션은 HTTPS로 파일을 다운로드합니다.

| 호스트                                                   | 사용하는 대상                                                                             |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `nodejs.org`                                             | `install.sh`와 `install.ps1`이 Node.js 24.21.0을 다운로드하고 SHA-256을 확인합니다        |
| `api.github.com`, `github.com` 및 GitHub 다운로드 호스트 | 스크립트 설치 프로그램, 그리고 업데이트 허브에 연결할 수 없을 때의 업데이트               |
| `hub.proanima.net`                                       | 업데이트 확인과 다운로드. [업데이트](./updates)를 참조하세요                              |
| Docker Hub                                               | Compose가 `node:24.21.0-bookworm-slim`으로 이미지를 빌드하고 `postgres:18.4`를 실행합니다 |

인터넷 연결이 없으면 릴리스의 로컬 사본으로 설치하고 업데이트하세요. [업데이트](./updates)를 참조하세요.

## 포트 {#ports}

| 포트      | 서비스                                                  | 기본 노출 범위                                                                                                                                           |
| --------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8080/TCP  | API와 콘솔(HTTP, 내장 TLS를 사용하면 HTTPS)             | `127.0.0.1`에서만 연결할 수 있습니다. 네이티브 설치는 HTTPS를 구성한 후 다른 주소에서도 수신할 수 있습니다. Compose는 항상 `127.0.0.1:8080`에 게시합니다 |
| 54329/TCP | 그래픽 설치 프로그램과 Linux 패키지의 관리형 PostgreSQL | `127.0.0.1`에서만 연결할 수 있습니다                                                                                                                     |
| 5432/TCP  | Compose 설치의 PostgreSQL 컨테이너                      | 게시되지 않습니다. Compose 네트워크 안에서만 접근할 수 있습니다                                                                                          |

클라이언트 네트워크에는 HTTPS 포트만 여세요. 데이터베이스 포트는 절대 열지 마세요.

## 설치 디렉터리 {#installation-directory}

설치 루트는 Windows에서 `C:\ProgramData\ProAnima\Arkvory`, Linux에서 `/opt/proanima-arkvory`입니다. 홈 디렉터리와 사용자 프로필 밖에 있는 전용 빈 디렉터리를 사용하세요.

| 루트 안의 경로                   | 내용                                                               |
| -------------------------------- | ------------------------------------------------------------------ |
| `installation.json`              | 설치된 버전, 설치 모드, 자동 업데이트 설정, 버전 고정              |
| `journal.json`, `operation.lock` | 마지막 업데이트의 상태, 그리고 실행 중인 작업의 잠금               |
| `launcher.mjs`, `manage.mjs`     | 서비스 시작과 관리 명령                                            |
| `releases/<version>/`            | 설치된 각 버전의 프로그램 코드. 서비스는 여기에 쓰지 않습니다      |
| `runtime/`                       | Node.js. 그래픽 설치 프로그램은 PostgreSQL과 WinSW도 여기에 둡니다 |
| `config/`                        | 설정, 키, 복구 키. [구성](./configuration)을 참조하세요            |
| `data/`                          | 네이티브 설치의 파일 스토리지                                      |
| `database/`                      | 관리형 PostgreSQL 클러스터. Windows에서는 해당 로그도 포함됩니다   |
| `logs/`                          | Windows 서비스 로그와 Windows 업데이터 로그                        |
| `service/`                       | Windows 서비스 래퍼                                                |
| `updates/`                       | 콘솔의 업데이트 요청과 업데이터의 상태                             |

Compose 설치는 데이터를 `data/`가 아니라 Docker 볼륨 `proanima-arkvory_storage`(파일)와 `proanima-arkvory_catalog`(데이터베이스)에 보관합니다.

`releases/`의 이전 버전은 자동으로 삭제되지 않습니다. 업데이트에 성공한 후에는 사용하지 않는 버전을 삭제할 수 있습니다. 현재 버전과 `journal.json`에 기록된 이전 버전은 남겨 두세요.

## 복구 키 {#recovery-key}

설치 프로그램은 `config/bootstrap-token.txt`를 만듭니다. 이 파일에는 관리자 권한이 있는 키인 **복구 키**가 들어 있습니다. root 또는 Administrators 그룹만 읽을 수 있습니다.

- 설치 프로그램이 소유자 계정을 만들지 않았다면 첫 소유자 계정을 만들 때 한 번 사용합니다. 콘솔은 처음 시작할 때 이 키를 요청합니다.
- 설치 도구는 서버에서 이 키를 읽습니다. 소유자 생성, `arkvory configure --backup-vault`, 업데이트 후 백업 확인, 데이터베이스 스키마 변경 전 백업에서 사용합니다. **이 파일을 삭제하지 마세요.**
- 클라이언트, CI 시스템, 스크립트에 복사하지 마세요. 일상적인 작업에는 권한이 제한된 사용자 계정과 서비스 키를 만드세요. [계정 및 액세스](../use/accounts)를 참조하세요.

복구 키를 교체하려면 [구성](./configuration)을 참조하세요.

## 다음 단계 {#next-steps}

1. 사용하는 플랫폼의 페이지에 따라 설치하세요: [Windows](./windows), [Linux](./linux), [Docker Compose](./docker).
2. 로그인하고 첫 파일을 게시하세요. [빠른 시작](../guide/quick-start)을 참조하세요.
3. 다른 컴퓨터의 클라이언트가 연결하기 전에 [HTTPS](./https)를 구성하세요.
4. 백업 보관소를 연결하고 첫 백업을 실행하세요. [백업](../operate/backups)을 참조하세요.
5. [업데이트 정책](./updates)을 선택하세요.
