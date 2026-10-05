---
title: Windows
---

# Windows

Windows에서 Arkvory를 실행하는 방법은 세 가지입니다.

- **그래픽 설치 프로그램** `Arkvory-Setup-x64.exe`. 권장하는 방법입니다. Windows 서비스와 전용 PostgreSQL 데이터베이스를 설치하며, 인터넷 연결이 필요하지 않습니다.
- **PowerShell 스크립트** `install.ps1`. 같은 Windows 서비스를 설치하지만 기존 PostgreSQL 서버를 사용합니다.
- **Docker Desktop**과 `install.ps1 -Mode compose`. 평가용으로만 사용하세요. [Docker Compose](./docker)를 참조하세요.

## 요구 사항 {#requirements}

- Windows x64, 빌드 10.0.17763 이상(Windows 10 버전 1809, Windows Server 2019 이상).
- Administrators 그룹에 속한 계정.
- 데이터를 저장할 로컬 NTFS 볼륨. 파일 스토리지에는 네트워크 공유를 지원하지 않습니다.
- 사용자 프로필과 `AppData` 밖에 있는 설치 디렉터리. 서비스 계정이 모든 상위 디렉터리를 읽을 수 있어야 합니다.

## 그래픽 설치 프로그램으로 설치 {#install-with-the-graphical-installer}

1. [GitHub Releases](https://github.com/ProAnima/Arkvory/releases)에서 `Arkvory-Setup-x64.exe`를 다운로드하세요.
2. 파일을 실행하고 사용자 계정 컨트롤(UAC) 메시지를 승인하세요.
3. 영어 또는 러시아어를 선택하고 라이선스에 동의하세요.
4. 소유자 계정을 입력하세요. 이름은 3~64자이며 라틴 문자, 숫자, 점, 대시, 밑줄을 사용할 수 있습니다. 비밀번호는 12~128자입니다.
5. Setup이 데이터베이스, 서비스, 소유자 계정을 준비하는 동안 기다리세요.
6. 마지막 페이지에서 **Open Arkvory and finish onboarding**을 선택한 상태로 두고 **Finish**를 클릭하세요. 콘솔이 `http://127.0.0.1:8080/console/#onboarding`에서 열립니다.

Setup은 시작 메뉴 바로 가기도 두 개 만듭니다. **Arkvory**(콘솔)와 **API and CLI**(콘솔의 도움말 페이지)입니다.

Microsoft 런타임 때문에 다시 시작해야 한다고 Setup이 알려 주면 Windows를 다시 시작한 뒤 Setup을 다시 실행하세요. 기존 Arkvory 데이터는 유지됩니다.

설치 직후에는 자동 업데이트가 꺼져 있습니다. 켜는 방법은 [업데이트](./updates)를 참조하세요.

### 자동 설치(무인 설치) {#silent-installation}

자동화된 배포에서는 소유자 계정을 JSON 파일에 넣으세요. SYSTEM과 Administrators만 읽을 수 있도록 파일을 보호하세요.

```json
{ "name": "admin", "password": "<12자 이상>" }
```

```powershell
.\Arkvory-Setup-x64.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /OWNERFILE="C:\secure\owner.json"
```

설치 프로그램은 계정을 만든 뒤 소유자 파일을 삭제합니다. 비밀번호를 명령 인수로 전달하지 마세요. `/OWNERFILE`을 사용하지 않았다면 나중에 콘솔에서 복구 키로 소유자를 만드세요. 구성이 끝나지 않으면 Setup은 0이 아닌 코드로 종료됩니다. 업데이트가 실행 중일 때는 Setup을 실행하지 마세요.

## 그래픽 설치 프로그램이 만드는 항목 {#what-the-graphical-installer-creates}

| 항목               | 위치 또는 값                                                             |
| ------------------ | ------------------------------------------------------------------------ |
| 프로그램 파일      | `C:\Program Files\ProAnima\Arkvory`                                      |
| 데이터, 구성, 로그 | `C:\ProgramData\ProAnima\Arkvory`(설치 루트)                             |
| 데이터베이스       | 루트의 `database\`에 있는 PostgreSQL 18.4, `127.0.0.1:54329`             |
| 콘솔               | `http://127.0.0.1:8080/console/`                                         |
| 복구 키            | 루트의 `config\bootstrap-token.txt`                                      |
| 업데이트 작업      | 작업 스케줄러의 `ProAnimaArkvoryUpdate`. SYSTEM 계정으로 매분 실행됩니다 |

### 서비스 {#services}

| 서비스 이름       | 표시 이름                 | 계정                          | 시작 유형         |
| ----------------- | ------------------------- | ----------------------------- | ----------------- |
| `Arkvoryapi`      | ProAnima Arkvory api      | `NT AUTHORITY\LocalService`   | 자동(지연된 시작) |
| `Arkvoryworker`   | ProAnima Arkvory worker   | `NT AUTHORITY\LocalService`   | 자동(지연된 시작) |
| `Arkvorybackup`   | ProAnima Arkvory backup   | `NT AUTHORITY\LocalService`   | 자동(지연된 시작) |
| `Arkvorydatabase` | ProAnima Arkvory database | `NT AUTHORITY\NetworkService` | 자동              |

서비스는 로그인한 사용자 없이 실행됩니다. API, 워커, 백업 에이전트는 LocalService 계정을 공유합니다. 데이터베이스는 NetworkService 계정으로 실행되므로 API 계정은 데이터베이스 파일을 읽을 수 없습니다.

루트에 대한 모든 권한은 SYSTEM과 Administrators에만 부여됩니다. LocalService는 루트를 읽을 수 있으며 `data\`, `logs\`, 업데이트 수신함만 변경할 수 있습니다. 복구 키와 설치 프로그램의 다른 자격 증명 파일은 SYSTEM과 Administrators만 읽을 수 있습니다.

## PowerShell과 기존 PostgreSQL로 설치 {#install-with-powershell-and-an-existing-postgresql}

조직에서 이미 PostgreSQL을 운영하고 있다면 이 방법을 사용하세요. 관리형 데이터베이스 서비스를 만들지 않으며, **앱** 목록에 항목도 추가하지 않습니다.

1. 데이터베이스 관리자에게 빈 데이터베이스와 그 데이터베이스를 소유하는 역할을 요청하세요. Arkvory는 이 역할로 마이그레이션을 실행합니다.
2. 릴리스에서 `install.ps1`을 다운로드하고 내용을 검토하세요.
3. Windows PowerShell을 **관리자 권한으로** 열고 다음 명령을 실행하세요.

```powershell
.\install.ps1 -AutomaticUpdates
```

스크립트가 PostgreSQL 연결 URL을 묻습니다. 입력한 내용은 화면에 표시되지 않습니다. 이어서 스크립트는 `nodejs.org`에서 Node.js 24.21.0을 다운로드하고 SHA-256을 확인한 다음 최신 안정 릴리스를 설치합니다.

프롬프트 대신 보호된 JSON 파일을 전달할 수도 있습니다.

```json
{ "ARKVORY_DATABASE_URL": "postgresql://arkvory:<password>@db.example:5432/arkvory" }
```

```powershell
.\install.ps1 -Config C:\secure\arkvory.json
```

PowerShell이 스크립트를 차단하면 `powershell -ExecutionPolicy Bypass -File .\install.ps1`을 실행하세요. 이 방법은 해당 프로세스에 대해서만 정책을 변경합니다.

| 매개 변수                      | 의미                                                             |
| ------------------------------ | ---------------------------------------------------------------- |
| `-Root <path>`                 | 설치 루트. 기본값: `C:\ProgramData\ProAnima\Arkvory`             |
| `-Version <x.y.z>`             | 최신 버전 대신 이 안정 버전을 설치합니다                         |
| `-Mode windows` 또는 `compose` | Windows 서비스(기본값) 또는 [Docker Compose](./docker)           |
| `-Engine docker` 또는 `podman` | Compose에 사용할 컨테이너 엔진                                   |
| `-Config <file>`               | 데이터베이스 URL을 포함한 `ARKVORY_*` 설정이 들어 있는 JSON 파일 |
| `-Artifact <directory>`        | GitHub 대신 압축을 푼 `Arkvory-Windows.zip`에서 설치합니다       |
| `-AutomaticUpdates`            | 자동 업데이트를 켭니다                                           |
| `-Pin`                         | 설치된 버전을 고정합니다                                         |

`-Root`, `-Config`, `-Artifact`에는 `-Artifact $PWD.Path`처럼 절대 경로를 지정하세요.

스크립트는 소유자 계정을 만들지 않습니다. 서버에서 `http://127.0.0.1:8080/console/`을 열고 **[[ui:welcomeOwner]]** 항목을 선택한 다음 `config\bootstrap-token.txt`의 복구 키를 입력하세요.

## 서비스 관리 {#manage-the-services}

```powershell
Get-Service Arkvoryapi, Arkvoryworker, Arkvorybackup, Arkvorydatabase
Restart-Service Arkvoryapi, Arkvoryworker
sc.exe qfailure Arkvoryapi
```

관리 명령은 관리자 권한으로 실행한 PowerShell에서 실행해야 하며, 항상 `--root` 옵션이 필요합니다.

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
# 그래픽 설치 프로그램
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' status --root $root
# 스크립트로 설치한 경우
& "$root\runtime\node-v24.21.0-win-x64\node.exe" "$root\manage.mjs" status --root $root
```

모든 명령을 보려면 `arkvory.ps1 help`를 실행하세요. 명령은 [구성](./configuration)과 [업데이트](./updates)에서 설명합니다.

## 장애 후 복구 {#recovery-after-a-failure}

- 서비스 프로세스가 요청 없이 중지되면 Windows가 10초 후에 다시 시작합니다. 실패 횟수는 1시간 후에 초기화됩니다.
- 메인 스레드가 60초 동안 멈춘 프로세스는 스스로 종료되고, Windows가 다시 시작합니다. [자가 복구](../operate/self-healing)를 참조하세요.
- 준비 상태 확인이 실패했다는 이유만으로는 서비스를 다시 시작하지 않습니다(예: 서버가 요청을 마무리하는 동안). 그러나 데이터베이스가 응답하지 않으면 API와 워커는 스토리지를 자신이 소유하고 있는지 확인할 수 없습니다. 약 8초 후에 스스로 종료되고, Windows는 데이터베이스가 복구될 때까지 10초마다 다시 시작합니다.
- 직접 중지한 서비스는 직접 시작하거나 Windows를 다시 시작할 때까지 중지된 상태로 유지됩니다.

그래픽 설치 프로그램을 다시 실행하면 서비스의 시작 유형과 복구 동작이 복원됩니다.

## 로그 {#logs}

| 루트 안의 위치     | 내용                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------- |
| `logs\`            | API, 워커, 백업 에이전트의 출력. 파일은 20 MiB에서 순환되며 이전 파일 5개를 유지합니다 |
| `logs\updater.log` | 업데이트 작업의 출력. 같은 방식으로 순환됩니다                                         |
| `database\`        | 데이터베이스 서비스의 로그(`arkvory-database*.log`)                                    |
| `bootstrap.log`    | 그래픽 설치 프로그램의 구성 단계 출력                                                  |

Setup은 자체 로그도 실행한 사용자의 임시 폴더에 기록합니다. API와 워커는 한 줄에 JSON 레코드 하나를 기록합니다. [모니터링](../operate/monitoring)을 참조하세요.

## 제거 {#uninstall}

**설정 > 앱**을 열고 **ProAnima Arkvory**를 선택한 다음 **제거**를 클릭하세요. 제거 프로그램은 다음을 수행합니다.

1. `ProAnimaArkvoryUpdate` 작업을 제거합니다.
2. `Arkvorybackup`, `Arkvoryworker`, `Arkvoryapi`, `Arkvorydatabase`를 중지하고 제거합니다.
3. 프로그램 파일을 제거합니다.

`C:\ProgramData\ProAnima\Arkvory`는 의도적으로 **남겨 둡니다**. 데이터베이스, 모든 파일, 구성, 복구 키가 들어 있기 때문입니다. 백업 보관소는 절대 건드리지 않습니다. 나중에 같은 버전 또는 더 새로운 버전의 Setup을 실행하면 남아 있는 데이터로 이어서 진행합니다. 데이터를 제거하려면 먼저 백업을 만든 다음 폴더를 직접 삭제하세요.

스크립트로 설치한 경우에는 제거 프로그램이 없습니다. 서비스를 제거하려면 관리자 권한으로 실행한 PowerShell에서 다음을 실행하세요.

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
Unregister-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Confirm:$false
foreach ($role in 'backup', 'worker', 'api') {
  $exe = "$root\service\arkvory-$role.exe"
  if ((Get-Service "Arkvory$role").Status -ne 'Stopped') { & $exe stopwait }
  & $exe uninstall
}
```

## Docker Desktop {#docker-desktop}

Docker Desktop은 사용자 한 명의 애플리케이션입니다. 컨테이너는 그 사용자가 로그인하고 Docker Desktop이 시작된 후에만 실행됩니다. 컴퓨터를 다시 시작한 뒤에는 그때까지 Arkvory를 사용할 수 없습니다. Docker Desktop으로 설치한다면 **Settings > General > Start Docker Desktop when you sign in** 옵션을 켜세요. 이 설정이 꺼져 있으면 설치 프로그램과 `status` 명령이 경고합니다. 로그인 없이 시작해야 하는 서버에는 이 페이지에서 설명한 네이티브 서비스를 사용하세요.

## 문제 해결 {#troubleshooting}

| 문제                                                                    | 해결 방법                                                                                                                                             |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup이 구성을 끝내지 못했다고 알려 줍니다                              | `bootstrap.log`, Setup 로그, 데이터베이스 로그를 읽어 보세요. 데이터베이스 폴더를 삭제하지 마세요                                                     |
| `database\bootstrap-started`는 있지만 `database\initialized`는 없습니다 | 데이터베이스 생성이 중단되었습니다. 클러스터를 삭제하지 말고 SQL을 직접 다시 실행하지도 마세요. 원인을 해결한 다음 `finish-install` 명령을 실행하세요 |
| `Run installer as Administrator`                                        | **관리자 권한으로 실행**을 선택해 PowerShell을 시작하세요                                                                                             |
| `Use a dedicated directory`                                             | 루트에 이미 파일이 있습니다. 빈 디렉터리를 사용하세요. 기존 설치는 해당 설치의 명령으로 관리하세요                                                    |
| `Node.js runtime is incomplete after extraction`                        | 바이러스 백신 소프트웨어의 격리 항목을 확인하세요                                                                                                     |
| `Another installation owns this service`                                | 다른 루트에 있는 설치의 서비스가 이미 있습니다. 먼저 그 서비스를 제거하세요                                                                           |

데이터를 삭제하지 않고 중단된 설치를 마무리하려면 다음을 실행하세요.

```powershell
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' finish-install --root C:\ProgramData\ProAnima\Arkvory
```

더 많은 도움말은 [문제 해결](../operate/troubleshooting)에 있습니다.
