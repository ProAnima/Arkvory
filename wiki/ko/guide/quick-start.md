---
title: 빠른 시작
---

# 빠른 시작

이 페이지는 아무것도 없는 상태에서 Arkvory 서버를 실행하고 파일 하나를 업로드하기까지의 가장 짧은 경로를 안내합니다. 1단계에서 설치 방법을 하나 선택한 다음, 나머지 단계를 순서대로 따라 하세요.

설치 프로그램은 프로젝트의 [릴리스 페이지](https://github.com/ProAnima/Arkvory/releases)에서만 다운로드하고, SHA-256을 릴리스의 체크섬 파일과 비교하세요.

## 1단계. 서버 설치 {#step-1-install-the-server}

### Windows {#windows}

x64 기반 Windows 10 버전 1809 이상 또는 Windows Server 2019 이상과 관리자 권한이 필요합니다. 인터넷 연결은 필요하지 않습니다.

1. `Arkvory-Setup-x64.exe`를 실행하고 관리자 권한 확인 메시지를 승인하세요.
2. 언어를 선택하고 라이선스에 동의하세요.
3. 소유자 페이지에서 이름(라틴 문자, 숫자, `.`, `-`, `_`로 3~64자)과 12자 이상의 비밀번호를 입력하세요. 이 계정이 첫 번째 관리자 계정입니다.
4. 마법사를 완료하세요. 마법사가 콘솔을 대신 열어 줄 수 있습니다.

Setup은 프로그램을 `C:\Program Files\ProAnima\Arkvory`에, 데이터를 `C:\ProgramData\ProAnima\Arkvory`에 설치합니다. 그리고 `Arkvorydatabase`, `Arkvoryapi`, `Arkvoryworker`, `Arkvorybackup`의 네 가지 Windows 서비스를 만듭니다. 이 서비스는 로그인한 사용자 없이 실행됩니다. [Windows](../install/windows)를 참조하세요.

### Linux {#linux}

사용하는 배포판에 맞는 패키지를 사용하세요. 패키지 관리자가 PostgreSQL 서버도 함께 설치합니다(버전 16~19 지원).

```bash
# Debian, Ubuntu
sudo apt install ./Arkvory-amd64.deb

# Fedora, RHEL 호환
sudo dnf install ./Arkvory-x86_64.rpm
```

설치 루트는 `/opt/proanima-arkvory`입니다. 패키지는 systemd 서비스 `arkvory-database`, `arkvory-api`, `arkvory-worker`, `arkvory-backup`을 만듭니다. 다음 명령으로 서비스 상태를 확인하세요.

```bash
systemctl status arkvory-api arkvory-worker arkvory-backup
```

[Linux](../install/linux)를 참조하세요.

### Docker Compose {#docker-compose}

Compose가 포함된 Docker가 필요합니다. Windows에서는 Linux 컨테이너 모드의 Docker Desktop을 사용하세요. 스크립트가 Node.js와 릴리스를 다운로드하므로 인터넷에 접근할 수 있어야 합니다.

릴리스에서 `install.sh` 또는 `install.ps1`을 다운로드하고, 실행하기 전에 내용을 읽어 보세요.

```bash
sudo bash ./install.sh --mode compose
```

Windows에서는 Docker Desktop을 실행하는 사용자와 같은 사용자로, 관리자 권한 없이 PowerShell을 실행하세요.

```powershell
.\install.ps1 -Mode compose
```

설치 루트는 Linux에서 `/opt/proanima-arkvory`, Windows에서 `C:\ProgramData\ProAnima\Arkvory`입니다. 스택에는 API, 워커, 백업 에이전트, PostgreSQL 18이 포함됩니다. [Docker](../install/docker)를 참조하세요.

## 2단계. 콘솔 열기 {#step-2-open-the-console}

서버의 브라우저에서 `http://127.0.0.1:8080/console/`을 여세요.

처음에는 서버가 로컬 주소 `127.0.0.1`에서만 연결을 받습니다. 사용 중인 컴퓨터에서 콘솔을 열려면 SSH로 포트를 포워딩하세요.

```bash
ssh -L 8080:127.0.0.1:8080 admin@arkvory.example
```

그런 다음 컴퓨터에서 `http://127.0.0.1:8080/console/`을 여세요. 다른 컴퓨터에서도 접근할 수 있게 하려면 먼저 [HTTPS](../install/https)를 설정하세요.

## 3단계. 소유자 만들기 {#step-3-create-the-owner}

Windows에서는 이 단계를 건너뛰세요. Setup이 이미 소유자를 만들었습니다.

Linux와 Docker에서는 **복구 키**로 첫 번째 계정을 만듭니다. 설치 프로그램이 이 키를 설치 루트의 `config/bootstrap-token.txt`에 기록합니다. 이 파일은 관리자만 읽을 수 있습니다.

```bash
sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
```

```powershell
Get-Content C:\ProgramData\ProAnima\Arkvory\config\bootstrap-token.txt
```

1. 콘솔에서 [[ui:navStart]] 섹션을 열고 [[ui:welcomeOwner]] 항목을 펼치세요.
2. [[ui:welcomeRecovery]] 필드에 키를 붙여 넣으세요.
3. 소유자 이름과 12자 이상의 비밀번호를 입력한 다음 [[ui:welcomeCreate]] 버튼을 선택하세요.
4. [[ui:connection]] 카드에서 새 이름과 비밀번호로 로그인하세요.

복구 키는 비밀로 유지하고 파일을 삭제하지 마세요. 설치 및 업데이트 도구가 이 키를 사용합니다. [보안](../operate/security)을 참조하세요.

소유자는 관리자이며 `releases` 리포지토리에 쓸 수 있습니다. 다른 리포지토리를 만들려면 [[ui:administration]] 섹션을 열고 [[ui:manageGrants]] 항목을 펼친 다음, `arkvory-owners` 그룹에 `builds` 같은 새 이름에 대한 [[ui:write]] 액세스를 부여하고 [[ui:saveGrant]] 버튼을 선택하세요. 리포지토리 이름에는 소문자 라틴 문자, 숫자, `-`, `_`를 사용할 수 있으며 최대 64자입니다.

## 4단계. 도구용 키 만들기 {#step-4-create-a-key-for-your-tools}

스크립트와 명령줄 클라이언트에는 키가 필요합니다. 처음 테스트할 때는 개인용 액세스 토큰을 사용하세요.

1. [[ui:connection]] 카드에서 [[ui:personalAccessTokens]] 항목을 펼치세요.
2. [[ui:tokenName]] 필드에 이름을 입력하고, [[ui:tokenScope]] 목록에서 [[ui:tokenScopeReadWrite]] 옵션을 선택한 다음 [[ui:generateToken]] 버튼을 선택하세요.
3. 토큰을 복사하세요. 토큰은 한 번만 표시됩니다.
4. 본인만 읽을 수 있는 파일(예: `~/.arkvory/key`)에 저장하세요.

CI/CD와 배포 에이전트에는 대신 자체 키를 가진 서비스 계정을 만드세요. [계정 및 액세스](../use/accounts)를 참조하세요.

## 5단계. curl로 업로드와 다운로드 {#step-5-upload-and-download-with-curl}

리포지토리의 파일 경로는 웹 서버의 파일처럼 동작합니다. `PUT`은 해당 경로의 새 버전을 저장하고, `GET`은 현재 버전을 반환합니다.

```bash
export ARKVORY_KEY="$(cat ~/.arkvory/key)"

# 업로드
curl -T ./Setup.exe -H "Authorization: Bearer $ARKVORY_KEY" \
  http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe

# 다운로드
curl -fL -H "Authorization: Bearer $ARKVORY_KEY" -o Setup-copy.exe \
  http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe
```

업로드하면 다음과 같은 JSON이 반환됩니다.

```json
{
  "path": "builds/game/1.0/Setup.exe",
  "revision": 1,
  "created": true,
  "artifact": { "id": "…", "size": "1048576", "sha256": "…" }
}
```

같은 바이트를 다시 업로드하면 응답은 `"created": false`와 함께 `200`이며, 새 버전은 만들어지지 않습니다. 새 파일은 상태 `201`을 받습니다.

PowerShell에서는 다음과 같이 합니다.

```powershell
$headers = @{ Authorization = "Bearer $env:ARKVORY_KEY" }
$url = 'http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe'
Invoke-WebRequest -Method Put -InFile .\Setup.exe -Headers $headers -Uri $url
Invoke-WebRequest -Headers $headers -Uri $url -OutFile .\Setup-copy.exe
```

`PUT` 요청 하나는 30분 안에 끝나야 합니다. 매우 큰 파일이나 느린 네트워크에서는 명령줄 클라이언트를 사용하세요. 클라이언트는 파트로 나누어 업로드하고 실패한 뒤에도 이어서 진행합니다. [원시 파일](../protocols/raw-files)을 참조하세요.

## 6단계. 명령줄 클라이언트 사용 {#step-6-use-the-command-line-client}

사용 중인 컴퓨터에 `arkvoryctl`을 설치하세요. Windows에서는 `Arkvory-CLI-Setup-x64.exe`, Linux에서는 `Arkvory-CLI-amd64.deb` 또는 `Arkvory-CLI-x86_64.rpm`을 사용합니다. Node.js 24가 있는 CI 머신에서는 `arkvoryctl.mjs`도 사용할 수 있습니다.

```bash
arkvoryctl profile add local --server http://127.0.0.1:8080 --token-file ~/.arkvory/key
arkvoryctl doctor
arkvoryctl put ./Setup.exe builds/game/1.0/Setup.exe
arkvoryctl get builds/game/1.0/Setup.exe ./Setup-copy.exe
```

`--repository`를 추가하지 않으면 프로필은 `releases` 리포지토리를 사용합니다. 전송이 중단되면 같은 명령을 다시 실행하세요. 중단된 지점부터 이어서 진행하고, 끝에서 SHA-256을 확인합니다. 클라이언트는 로컬 컴퓨터에 대해서만 일반 HTTP를 허용하므로, 원격 서버에는 HTTPS를 사용하세요. [명령줄 클라이언트](../protocols/cli)를 참조하세요.

## 다음 단계 {#next-steps}

- [개념](./concepts): 리포지토리, 아티팩트, 스테이지, 키를 설명합니다.
- [HTTPS](../install/https): 서버를 다른 컴퓨터에 안전하게 공개합니다.
- [백업](../operate/backups): 중요한 데이터를 저장하기 전에 보관소를 연결합니다.
- [패키지](../use/packages)와 [승격](../use/promotion): 배포를 위한 버전 관리 빌드를 다룹니다.
- [웹 콘솔](./console): 모든 섹션을 둘러봅니다.
