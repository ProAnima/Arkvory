---
title: 명령줄(arkvoryctl)
---

# 명령줄(arkvoryctl)

`arkvoryctl`은 사람과 CI/CD를 위한 Arkvory 원격 클라이언트입니다. 파트로 나누어 업로드하고 다운로드하며, 중단된 뒤에도 이어서 진행하고, SHA-256을 검증합니다. 지정한 키가 가진 권한으로 동작합니다.

## 설치 {#install}

| 시스템                                       | 패키지                      | 설치 방법                                                                                                              |
| -------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Windows 10/11, Windows Server 2019 이상(x64) | `Arkvory-CLI-Setup-x64.exe` | 실행하세요. 관리자 권한 없이 현재 사용자용으로 설치하며 `arkvoryctl`을 사용자 `PATH`에 추가합니다. 새 터미널을 여세요. |
| Debian, Ubuntu(x64)                          | `Arkvory-CLI-amd64.deb`     | `sudo apt install ./Arkvory-CLI-amd64.deb`                                                                             |
| Fedora, RHEL 호환(x64)                       | `Arkvory-CLI-x86_64.rpm`    | `sudo dnf install ./Arkvory-CLI-x86_64.rpm`                                                                            |
| Node.js 24가 있는 모든 시스템(예: CI 러너)   | `arkvoryctl.mjs`            | `node ./arkvoryctl.mjs --help`                                                                                         |

네이티브 패키지에는 자체 Node.js가 포함되어 있습니다. 단일 파일 `arkvoryctl.mjs`에는 npm 의존성이 없습니다. 신뢰할 수 있는 `ProAnima/Arkvory` 릴리스에서 파일을 받고, SHA-256을 `release-checksums.json`과 비교하세요. ARM64 패키지는 아직 제공되지 않습니다. 업데이트하려면 더 새로운 안정 릴리스를 설치하세요. 제거해도 프로필, 키 파일, 체크포인트는 유지됩니다.

## 서버에 연결 {#connect-to-a-server}

1. 키를 준비하세요. 콘솔에서 만든 개인용 액세스 토큰이나 관리자에게서 받은 서비스 키를 사용합니다. [계정 및 키](../use/accounts)를 참조하세요.
2. 키를 어떤 리포지토리에도 속하지 않은 비공개 파일에 저장하세요. Linux에서는 모드 `0600`을 사용하세요. Windows에서는 본인 계정에만 접근을 허용하세요.
3. 프로필을 추가하고 연결을 확인하세요.

```bash
arkvoryctl profile add production --server https://arkvory.example --token-file "$HOME/.secrets/arkvory.key" --repository releases
arkvoryctl doctor
arkvoryctl repositories
```

```powershell
arkvoryctl profile add production --server https://arkvory.example --token-file C:\Private\arkvory.key --repository releases
arkvoryctl doctor
```

`doctor`는 서버, 리포지토리, 기능, 키의 권한을 보여 줍니다. 키는 명령 인수로 전달하지 않습니다.

## 프로필과 환경 변수 {#profiles-and-environment}

프로필은 `~/.config/arkvory`의 `profiles.json`에 저장됩니다(Windows에서는 사용자 폴더의 `.config\arkvory`). 프로필에는 서버 URL, 기본 리포지토리, 키 파일의 **경로**가 저장되며 키 자체는 저장되지 않습니다.

| 명령                                                                    | 효과                                                                                            |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `profile add NAME --server URL [--token-file PATH] [--repository NAME]` | 프로필을 추가합니다. 첫 번째 프로필이 기본 프로필이 됩니다. 기본 리포지토리는 `releases`입니다. |
| `profile list`                                                          | 모든 프로필과 활성 프로필을 표시합니다                                                          |
| `profile use NAME`                                                      | 프로필을 기본 프로필로 지정합니다                                                               |
| `profile remove NAME`                                                   | 프로필을 제거합니다                                                                             |

| 변수                 | 의미                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_TOKEN`      | 키 자체입니다. 어떤 파일보다 우선합니다.                                                                                        |
| `ARKVORY_TOKEN_FILE` | 키 파일의 경로입니다. 프로필의 파일보다 우선합니다.                                                                             |
| `ARKVORY_BASE_URL`   | 서버 URL입니다. 설정하면 프로필의 키 파일을 사용하지 **않으므로**, `ARKVORY_TOKEN` 또는 `ARKVORY_TOKEN_FILE`로 키를 전달하세요. |
| `ARKVORY_CLI_HOME`   | `profiles.json`을 저장할 다른 폴더                                                                                              |

서버 URL은 HTTPS를 사용해야 합니다. 일반 HTTP는 `localhost`, `127.0.0.1`, `[::1]`에서만 허용됩니다. TLS 검증은 끌 수 없습니다.

## 전역 옵션 {#global-options}

| 옵션                         | 기본값          | 의미                                                                                                              |
| ---------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `--profile NAME`             | 활성 프로필     | 이 명령에만 사용할 프로필                                                                                         |
| `--repository NAME`          | 프로필의 값     | 이 명령에만 사용할 리포지토리                                                                                     |
| `--json`                     | 꺼짐            | 압축된 JSON 결과 하나를 stdout에 출력합니다. 오류는 stderr에 JSON으로 출력합니다                                  |
| `--lang en` 또는 `--lang ru` | `LANG`에서 결정 | 도움말과 메시지의 언어                                                                                            |
| `--timeout MS`               | 60000           | 관리 요청의 제한 시간(1~3600000)                                                                                  |
| `--attempt-timeout MS`       | 120000          | 전송 시도 한 번의 제한 시간(1~1800000)                                                                            |
| `--retries N`                | 20              | 작업 하나에 대한 네트워크 재시도 횟수(0~100). `0`이면 재시도하지 않습니다                                         |
| `--verbose`                  | 꺼짐            | HTTP 요청마다 stderr에 한 줄을 출력합니다: 메서드, 경로, 상태, 소요 시간, 요청 ID. 헤더와 키는 포함되지 않습니다. |
| `--help`, `--version`        |                 | 도움말. 클라이언트 버전을 JSON으로 출력합니다                                                                     |
| `--`                         |                 | 옵션의 끝을 표시합니다. `-`로 시작하는 파일 이름에 사용합니다                                                     |

각 옵션은 한 번만 지정할 수 있습니다. 알 수 없는 옵션은 거부됩니다.

## 명령 {#commands}

### 탐색과 카탈로그 {#discovery-and-catalog}

| 명령                                                                       | 결과                                   |
| -------------------------------------------------------------------------- | -------------------------------------- |
| `doctor`                                                                   | 연결, 기능, 권한                       |
| `repositories [--after CURSOR]`                                            | 키로 볼 수 있는 리포지토리             |
| `operations [--after CURSOR]`                                              | 리포지토리에서 사용할 수 있는 API 작업 |
| `list [--after CURSOR]`                                                    | 리포지토리의 아티팩트                  |
| `search [--query TEXT] [--label TAG] [--collection NAME] [--after CURSOR]` | 이름과 메타데이터 텍스트로 검색        |
| `search --metadata-key KEY --metadata-value VALUE`                         | 메타데이터 정확 일치(둘 다 지정)       |
| `inspect ID`                                                               | 아티팩트 하나의 메타데이터             |
| `storage usage` / `storage policy`                                         | 리포지토리 사용량과 스토리지 정책      |

목록은 페이지 단위로 반환되며 응답에 `next`가 포함됩니다. 다음 페이지를 읽으려면 이 값을 `--after`로 전달하세요.

### 전송 {#transfers}

| 명령                                                                           | 결과                                                                                                                |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `upload FILE [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]`   | 모든 파일의 재개 가능한 업로드                                                                                      |
| `download ID OUTPUT`                                                           | 재개 가능하며 SHA-256으로 검증하는 다운로드                                                                         |
| `put FILE PATH [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]` | 파일을 업로드하고 경로의 다음 리비전으로 지정합니다. 경로에 이미 같은 바이트가 있으면 아무것도 업로드하지 않습니다. |
| `get PATH OUTPUT`                                                              | 경로의 현재 리비전을 검증하고 재개 가능한 방식으로 다운로드합니다                                                   |
| `link ID [--ttl SECONDS]`                                                      | 키 없이 사용하는 다운로드 URL. 유효 시간은 60초~24시간(기본 1시간)입니다                                            |
| `uploads status ID` / `uploads cancel ID`                                      | 업로드 세션의 상태, 그리고 세션 취소(취소는 일시 중지가 아닙니다)                                                   |

`METADATA.json`에는 `labels`와 `metadata`(문자열 맵)가 들어 있습니다. 이 파일이 `--label`보다 우선합니다.

```bash
arkvoryctl put "./Build/Game Setup.exe" builds/game/1.4/GameSetup.exe
arkvoryctl get builds/game/1.4/GameSetup.exe ./GameSetup.exe
arkvoryctl link 00000000-0000-4000-8000-000000000001 --ttl 900
```

다운로드 링크는 시크릿입니다. 만료되기 전에는 폐기할 수 없습니다.

### 패키지와 승격 {#packages-and-promotion}

| 명령                                                                                                                  | 결과                                                              |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `packages list [--group G] [--name N] [--after CURSOR]`                                                               | UPack 패키지                                                      |
| `packages publish FILE [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]`                                | UPack 아카이브를 업로드하고 등록합니다                            |
| `packages register ID`                                                                                                | 이미 업로드된 UPack을 등록합니다                                  |
| `packages resolve NAME [--group G] [--exact V] [--range R] [--stage S] [--prerelease] [--order promoted]`             | 버전을 선택합니다(`--exact`와 `--range`는 함께 쓸 수 없음)        |
| `packages download NAME OUTPUT [same filters]`                                                                        | 버전을 선택한 다음 검증하며 다운로드합니다                        |
| `promote ID --to REPOSITORY [--move] [--stage S1,S2] [--comment TEXT]`                                                | 바이트를 다시 보내지 않고 아티팩트를 다른 리포지토리에 게시합니다 |
| `stages list ID` / `stages add ID STAGE [--comment TEXT]` / `stages remove ID STAGE` / `stages artifacts [--stage S]` | 아티팩트의 스테이지                                               |
| `promotions history ID` / `promotions journal [--after CURSOR]`                                                       | 승격 기록                                                         |

```bash
arkvoryctl packages publish ./build.upack --label test --state ./job-state/build.json --json
arkvoryctl promote 00000000-0000-4000-8000-000000000001 --to prod --stage release
arkvoryctl packages download app ./app.upack --range ^1.4 --stage release
```

정확한 버전에는 `--exact`를 사용하세요. `--version`은 클라이언트 버전을 출력합니다. [패키지](../use/packages)와 [승격](../use/promotion)을 참조하세요.

### 주석과 첨부 파일 {#annotations-and-attachments}

`annotations get ID`와 `annotations set ID --revision N --file ANNOTATIONS.json`은 레이블, 메타데이터, 컬렉션을 읽고 교체합니다. `attachments get ID`, `attachments history ID`, `attachments set ID --revision N --file ATTACHMENTS.json`은 빌드에 연결된 파일에 대해 같은 작업을 합니다. 먼저 읽은 다음, 읽은 리비전과 함께 전체 새 상태를 보내세요. 동시에 변경되면 충돌(종료 코드 6)이 반환됩니다.

### 백업 {#backups}

| 명령                                                              | 결과                                                                        |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `backup status`                                                   | 보관소, 에이전트, 계획, 마지막 지점, 경고. 심각한 경고가 있으면 종료 코드 9 |
| `backup run`                                                      | 백업 작업을 대기열에 추가합니다                                             |
| `backup jobs [--after CURSOR]` / `backup points [--after CURSOR]` | 작업과 복원 지점을 최신순으로 표시합니다                                    |
| `backup verify POINT_ID`                                          | 지점 전체 검증을 대기열에 추가합니다                                        |
| `backup pin POINT_ID [--off]`                                     | 지점을 보존 기간이 지나도 유지하거나, 고정을 해제합니다                     |

이 명령에는 설치 소유자(부트스트랩) 파일 키 또는 계정 관리자 세션이 필요합니다. 개인용 토큰과 서비스 키는 403(종료 코드 3)을 받습니다. 실제 작업은 서버의 백업 에이전트가 수행합니다. 모니터링 예: `arkvoryctl backup status --json || alert`. [백업](../operate/backups)을 참조하세요.

## 중단된 전송 재개 {#resume-interrupted-transfers}

Ctrl+C를 누르거나 네트워크 장애가 발생한 뒤에는 **같은 옵션으로 같은 명령**을 다시 실행하세요.

- `upload`, `put`, `packages publish`는 원본 파일 옆에 체크포인트(`<source>.arkvory-upload.json` 또는 `--state`로 지정한 파일)를 유지합니다. 체크포인트에는 첫 요청 전에 멱등성 키가 저장되므로, 응답이 유실되어도 사본이 두 번 만들어지지 않습니다.
- 같은 바이트를 **새** 아티팩트로 게시하려면 새 `--state` 파일을 사용하세요.
- `download`와 `get`은 출력 파일 옆에 `<output>.arkvory-part`와 `<output>.arkvory-download.json`을 유지합니다. 최종 파일은 SHA-256 검증을 마친 뒤에만 나타납니다. 이미 있는 출력 파일을 덮어쓰지 않습니다.
- CI에서는 작업을 시작하기 전에 상태 폴더를 만들고, 재시도하는 동안 원본 파일과 함께 유지하세요.

체크포인트는 하드 링크를 지원하는 로컬 디스크(NTFS, ext4, XFS)에 보관하고, FAT, exFAT, 네트워크 공유에는 두지 마세요. 비정상 종료 후에는 `.lock` 파일이 남습니다. 파일에 적힌 PID의 프로세스가 종료되었는지 확인한 다음 `.lock` 파일만 삭제하세요.

## CI 예제 {#ci-example}

```bash
# 키는 CI 시크릿 저장소에서 가져옵니다. 절대 출력하지 마세요.
export ARKVORY_BASE_URL=https://arkvory.example
export ARKVORY_TOKEN_FILE=/run/secrets/arkvory-key
mkdir -p job-state
node ./arkvoryctl.mjs packages publish ./build.upack --label test --state ./job-state/upload.json --json
```

업로드 후 등록에 실패하면 JSON 오류에 `stage: "register"`와 `artifactId`가 포함됩니다. 같은 명령을 다시 실행하세요. 같은 아티팩트를 다시 등록해도 안전합니다.

## 출력 {#output}

- 결과는 stdout에 JSON으로 출력됩니다. `--json`을 지정하지 않으면 JSON이 들여쓰기되어 출력됩니다. 백업 명령은 `--json`을 추가하지 않는 한 읽기 쉬운 줄로 출력합니다.
- 진행률은 대화형 stderr에서만 표시됩니다.
- `--json` 없이 발생한 오류는 서버 코드, 사유, 메시지, 다음 단계, 요청 ID가 포함된 stderr 한 줄로 출력됩니다. `--json`을 지정하면 stderr에 `code`, `exitCode`, `status`, `serverCode`, `reason`, `requestId`, `retryAfterSeconds`가 포함된 `{"error": {...}}`가 출력됩니다. 알 수 없는 코드는 `exitCode`로 판단하세요.

## 종료 코드 {#exit-codes}

| 코드 | 의미                                                            |
| ---- | --------------------------------------------------------------- |
| 0    | 성공                                                            |
| 2    | 잘못된 인수 또는 구성                                           |
| 3    | 키 없음 또는 액세스 거부(401, 403)                              |
| 4    | HTTP 또는 네트워크 오류, 시간 초과, 서버 사용 중, 찾을 수 없음  |
| 5    | 무결성 실패(SHA-256 불일치, 422 `integrity_mismatch`)           |
| 6    | 충돌: 리비전, 상태, 잠금, 기존 파일, 변경된 체크포인트(409)     |
| 7    | 로컬 파일 오류 또는 잘못된 서버 응답                            |
| 8    | 서버 용량 한도: 할당량, 디스크, 대기열(507 `capacity_exceeded`) |
| 9    | `backup status`: 심각한 백업 경고가 활성 상태임                 |
| 130  | 중단됨                                                          |

클라이언트는 `--retries` 한도 안에서 네트워크 실패와 HTTP 408, 429, 502, 503, 504만 재시도합니다.

## 문제 해결 {#troubleshooting}

| 메시지                                    | 원인과 해결 방법                                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `credential_required` (종료 코드 3)       | 키를 찾을 수 없습니다. `--token-file`, `ARKVORY_TOKEN_FILE`을 확인하거나, `ARKVORY_BASE_URL`을 사용하는 경우 키를 설정하세요. |
| `forbidden` (종료 코드 3)                 | 키에 필요한 권한이 없습니다. `doctor`를 실행하여 권한을 확인하세요.                                                           |
| `checkpoint_mismatch` (종료 코드 6)       | 파일, 서버, 리포지토리, 옵션이 저장된 체크포인트와 다릅니다. 원래 옵션을 사용하거나 새 `--state`를 사용하세요.                |
| `state_locked` (종료 코드 6)              | 다른 프로세스가 체크포인트를 사용 중이거나, 비정상 종료 후 이전 `.lock`이 남아 있습니다.                                      |
| `destination_exists` (종료 코드 6)        | 출력 파일이 이미 있습니다. 다른 이름을 선택하세요.                                                                            |
| `put`의 `revision_mismatch` (종료 코드 6) | 그사이 다른 사람이 경로를 변경했습니다. 경로의 기록을 확인한 다음 결정하세요.                                                 |
| 종료 코드 8                               | 할당량이나 디스크가 가득 찼습니다. 관리자에게 문의하세요.                                                                     |

## 관련 페이지 {#related-pages}

- [클라이언트 및 프로토콜](./index)
- [전송](../use/transfers) 및 [경로 기반 파일](../use/files)
- [TypeScript SDK](./sdk)
- [오류](../api/errors)
