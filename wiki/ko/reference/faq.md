---
title: '자주 묻는 질문'
description: '한도, 가용성, 데이터베이스, 업데이트, 서버 이전, 액세스 및 라이선스에 관한 흔한 질문에 짧고 정확하게 답합니다.'
---

# 자주 묻는 질문

## 크기 및 가용성 {#size-and-availability}

### 저장할 수 있는 가장 큰 파일은 무엇인가요? {#max-object-size}

10,000 GiB(10 737 418 240 000 바이트)입니다. 하나의 업로드는 최대 1 GiB인 파트를 최대 10,000개까지 포함합니다. 관리자는 `ARKVORY_MAX_OBJECT_BYTES`로 더 낮은 한도를 설정할 수 있습니다. 선언한 크기가 더 크면 `400`으로 거부됩니다. 실제로는 여유 디스크 공간, 리포지토리 할당량, 1 GiB 여유 공간 예약이 먼저 막습니다. 이들은 `507`로 응답합니다. [개념](../guide/concepts#uploads) 및 [환경 변수](./environment)를 참조하세요.

### 서버 한 대는 얼마나 보관할 수 있나요? {#capacity}

Arkvory는 기본적으로 최대 10 TiB의 콘텐츠(`ARKVORY_CAPACITY_BYTES`)를 예약하며, 여기에는 게시된 파일, 완료되지 않은 업로드, 정리를 기다리는 콘텐츠가 포함됩니다. 이는 디스크 검사가 아니라 카운터입니다. 디스크와 예약 공간이 실제 한도입니다. 리포지토리는 자체 할당량을 가질 수 있습니다. [스토리지](../operate/storage)를 참조하세요.

### Arkvory는 고가용성을 지원하나요? {#high-availability}

아니요. 하나의 설치는 PostgreSQL 데이터베이스 하나와 로컬 콘텐츠 디렉터리 하나를 가진 서버 한 대입니다. 서버가 멈추면 클라이언트는 기다렸다가 전송을 재개합니다. 서비스는 충돌이나 중단 후 스스로 다시 시작합니다. 서버 손실에 대비하려면 [백업](../operate/backups)을 사용하세요. 두 번째 사이트에서 읽으려면 [미러](../operate/mirrors)를 사용하세요. 미러로 전환하는 것은 수동 단계이며, 미러가 아직 받지 못한 변경 사항은 손실됩니다.

### 오프라인에서도 동작하나요? {#offline}

서버는 인터넷 접속 없이 동작합니다. Windows 설치 프로그램에는 Node.js와 PostgreSQL이 포함되어 있어 오프라인으로 설치합니다. Linux 패키지에는 Node.js가 포함되어 있고, 패키지 관리자가 PostgreSQL을 설치합니다. 스크립트 설치 프로그램과 Docker는 파일을 다운로드합니다. 업데이트는 릴리스의 로컬 복사본에서 설치할 수 있습니다. 업데이트 허브에 연결할 수 없으면 업데이트 확인이 실패하고 콘솔에 표시되며, 그 밖에는 아무 영향이 없습니다. [설치 선택](../install/index) 및 [업데이트](../install/updates)를 참조하세요.

## 스토리지 및 데이터베이스 {#storage-and-database}

### 어떤 데이터베이스를 사용하나요? {#database}

PostgreSQL이며, 설치마다 데이터베이스 하나를 사용합니다. Windows 설치 프로그램에는 PostgreSQL 18.4가 포함되어 있습니다. Linux 패키지는 배포판의 PostgreSQL 16~19 서버의 전용 클러스터를 사용합니다. Docker Compose 스택은 컨테이너에서 PostgreSQL 18.4를 실행합니다. 스크립트 설치 프로그램은 자체 서버를 사용합니다. 두 설치를 하나의 데이터베이스에 연결하지 마세요. 파일 콘텐츠는 데이터베이스에 없으며, 데이터 디렉터리에 있습니다.

### S3나 다른 객체 스토리지를 사용할 수 있나요? {#s3}

아니요. 파일 콘텐츠는 로컬 디렉터리에 저장되며, 이 디렉터리는 하드 링크를 지원하는 로컬 파일 시스템에 있어야 하고 네트워크 공유에 두면 안 됩니다. Arkvory는 콘텐츠를 S3에 저장하지 않으며 S3 인터페이스도 제공하지 않습니다. 백업 보관소는 다른 디스크나 마운트된 네트워크 공유(Windows에서는 로컬 또는 iSCSI 볼륨)의 폴더입니다.

### 회사의 싱글 사인온을 사용할 수 있나요? {#sso}

아니요. 계정, 그룹, 비밀번호는 Arkvory에 속합니다. 자동화는 서비스 키로 로그인합니다. [인증](../api/authentication)을 참조하세요.

## 서버 실행 {#running}

### 설치된 버전을 어떻게 확인하나요? {#version}

콘솔에서 [[ui:updates]]를 열면 [[ui:updateCurrent]]에 표시됩니다. 서버에서는 `arkvory status --root <installation root>`를 실행하고 `current`를 읽으세요. 그래픽 설치 프로그램을 사용한 Windows에서는 관리자 권한 PowerShell에서 `& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' status --root 'C:\ProgramData\ProAnima\Arkvory'`를 실행하세요. 관리자는 `GET /api/v1/system/updates`를 호출할 수도 있으며, 이는 `currentVersion`을 반환합니다. `arkvoryctl --version` 명령은 서버가 아니라 클라이언트의 버전을 표시합니다.

### 자동 업데이트를 어떻게 켜나요? {#automatic-updates}

콘솔에서 [[ui:updates]]를 열고 [[ui:updateAutomatic]]을 선택한 다음 [[ui:updateHour]]를 고르고 [[ui:updateSave]]를 선택하세요. 서버에서는 `arkvory configure --root <installation root> --enable-updates`를 실행하세요. `--disable-updates`는 자동 업데이트를 끕니다. 설치 프로그램은 `--automatic`을 전달하지 않으면 자동 업데이트를 꺼 둡니다.

서버는 자동 설치가 꺼져 있어도 6시간마다 릴리스를 확인합니다. 켜져 있으면 안정 릴리스가 유지 관리 시간(기본 03:00 UTC)에 하루에 한 번 설치됩니다. 단, 버전이 고정된 경우는 설치되지 않습니다. 데이터베이스 스키마를 변경하는 릴리스는 서버가 새 백업을 만들고 검증한 후에만 설치됩니다. [업데이트](../install/updates)를 참조하세요.

### Arkvory는 ProAnimaStudio로 무엇을 전송하나요? {#hub-traffic}

파일과 데이터는 서버에 남아 있습니다. 서버는 세 가지 목적으로 ProAnimaStudio 허브(`hub.proanima.net`)에 연결하고, 허브에 연결할 수 없으면 GitHub에 연결합니다.

- **업데이트 확인.** 요청에는 프로젝트 이름, 운영 체제, 프로세서 아키텍처, 설치된 버전, 업데이트 채널이 포함됩니다. 통계가 켜져 있으면 무작위 설치 ID도 포함됩니다.
- **익명 통계.** 업데이트가 설치된 후 한 번 이벤트를 보내며, 여기에는 설치 ID, 버전, 시스템, 아키텍처, 채널이 포함됩니다. 이름, 주소, 콘텐츠, IP 주소는 저장되지 않습니다. 통계는 기본적으로 켜져 있으며, [[ui:updates]]의 [[ui:updateStatistics]] 또는 `arkvory configure --statistics off`로 끌 수 있습니다. 통계가 없으면 새 버전은 모든 사용자에게 배포될 때만 도달합니다.
- **피드백.** 로그인한 사람이 [[ui:reportOpen]]에서 보낼 때만 전송됩니다. 여기에는 메시지, 선택적 이메일 주소, 최대 6개의 스크린샷, 콘솔 로그가 포함됩니다. 관리자는 시크릿을 제외한 서버 로그와 버전 및 상태 요약을 추가할 수 있습니다. [[ui:reportShow]]는 전송될 내용을 정확히 보여 줍니다.

`arkvory configure --hub-off`는 허브 연결을 중단합니다. 그러면 릴리스는 GitHub에서만 오고, 피드백은 서비스 재시작 후 꺼집니다. `ARKVORY_HUB_URL`을 비우면 피드백만 꺼집니다. [라이선스](https://github.com/ProAnima/Arkvory/blob/main/LICENSE.md) 섹션 7을 참조하세요.

### 백업은 스스로 실행되나요? {#automatic-backups}

직접 설정하기 전에는 실행되지 않습니다. `arkvory configure --backup-vault <folder> --init-vault`로 보관소를 연결한 다음, [[ui:backups]]의 [[ui:backupPlan]]에서 매일 일정을 켜세요. 계획은 02:00 UTC에 시작하며 매일 7개, 매주 4개, 매월 6개의 복원 지점을 유지합니다. 일정이 켜지기 전까지 콘솔은 매일 일정이 꺼져 있다는 경고를 표시합니다. [백업](../operate/backups)을 참조하세요.

### 다른 서버로 어떻게 이동하나요? {#move-server}

1. 새 서버에 같은 버전 이상의 Arkvory를 설치합니다.
2. `arkvory-backup restore` 명령으로 보관소에서 가장 최신 복원 지점을 빈 데이터베이스와 빈 스토리지 디렉터리로 복원합니다. 이 명령은 모든 파일을 SHA-256으로 검사합니다. [백업](../operate/backups)을 참조하세요.
3. `config/runtime.json`의 `ARKVORY_DATABASE_URL`과 `ARKVORY_DATA_DIR`을 복원된 데이터베이스와 디렉터리로 지정하고, 서비스를 다시 시작한 다음 콘솔, 다운로드, 업로드를 확인합니다.
4. 주소(DNS 또는 CI 설정)를 새 서버로 옮깁니다.

사용자, 그룹, 비밀번호는 복원됩니다. 세션은 이전되지 않고, 개인용 토큰과 서비스 키는 폐기되므로 다시 로그인하고 새 키를 발급하세요. 보존 및 정리 정책은 꺼진 상태로 복원되므로 필요에 따라 켜세요. 완료되지 않은 업로드는 취소됩니다. 이전 서버를 계속 실행하면서 이동하려는 리포지토리의 경우, 새 서버가 [미러](../operate/mirrors)로 따라가게 한 뒤 전환할 때 분리할 수도 있습니다. 미러는 파일, 패키지, 이미지를 전달하지만 계정, 키, 첨부 파일, 정책은 전달하지 않습니다.

### 서버가 다시 시작되면 전송은 어떻게 되나요? {#interrupted-transfers}

클라이언트는 계속합니다. 업로드 세션은 7일 동안 유지되며 도착한 파트를 보존합니다. 명령줄 클라이언트와 SDK는 서버에 무엇을 가지고 있는지 묻고 나머지를 보냅니다. 다운로드는 `Range` 요청으로 계속됩니다. 원시 파일이나 Docker 레이어처럼 단일 `PUT` 요청은 첫 바이트부터 다시 시작합니다. [중단된 전송 재개](../protocols/cli#resume-interrupted-transfers)를 참조하세요.

### 무언가 실패하면 어디를 보나요? {#logs}

모든 오류에는 `requestId` 필드와 `X-Request-Id` 헤더에 요청 ID가 있습니다. 서버의 액세스 로그에서 찾으세요. 서비스는 Windows에서 `logs` 폴더에, Linux에서 저널(`journalctl -u arkvory-api`)에 로그를 기록합니다. [[ui:reportOpen]]으로 보고서를 보내 로그를 포함하세요. [문제 해결](../operate/troubleshooting) 및 [모니터링](../operate/monitoring)을 참조하세요.

## 액세스 {#access}

### 소유자의 비밀번호를 어떻게 재설정하나요? {#reset-owner-password}

다른 관리자는 [[ui:administration]]의 [[ui:resetPassword]]를 사용할 수 있습니다. 아무도 로그인할 수 없으면 `config/bootstrap-token.txt`의 복구 키를 사용하세요. `GET /api/v1/users`로 계정의 ID를 찾고 `{"password": "…"}`와 함께 `PATCH /api/v1/users/<id>`를 보내세요. 새 비밀번호는 12~128자입니다. 재설정은 계정의 모든 세션과 개인용 토큰을 종료합니다. [인증](../api/authentication#recovery-key)을 참조하세요.

### 복구 키는 무엇이며, 잃어버리면 어떻게 되나요? {#lost-recovery-key}

설치 루트의 `config/bootstrap-token.txt`에 있는 시크릿으로, 시스템 관리자만 읽을 수 있습니다. 첫 소유자를 만들고 서비스 계정을 관리합니다. 설치 도구가 이 파일을 읽으므로 삭제하지 마세요. 파일을 잃어버렸지만 관리자 계정이 남아 있으면 그 계정으로 계속 작업할 수 있습니다. 새 복구 키를 만들려면 [구성](../install/configuration)을 따르세요. [개념](../guide/concepts#owner-and-recovery-key)을 참조하세요.

### CI는 어떤 키를 사용해야 하나요? {#ci-key}

작업에 필요한 작업만 정책에 포함된 서비스 계정의 서비스 키입니다. 예를 들어 게시하려면 `upload.create`, `upload.write`, `upload.complete`, `upload.read`, `job.read`가 필요합니다. 콘솔의 [[ui:bindingRead]] 및 [[ui:bindingPublish]] 프리셋이 일반적인 집합을 채워 줍니다. CI에서는 복구 키나 개인의 토큰을 사용하지 마세요. 키는 기본적으로 90일 동안 유지되며 최대 365일이므로 교체를 계획하세요. [인증](../api/authentication#service-accounts)을 참조하세요.

### 관리자가 아티팩트를 삭제하거나 스토리지 정책을 변경할 수 없는 이유는 무엇인가요? {#delete-forbidden}

`artifact.delete`, `storage.read`, `storage.manage`, `diagnostics.read` 작업은 서비스 키에만 있습니다. 그룹 부여, 개인용 토큰, 세션, 복구 키에는 절대 포함되지 않습니다. 리포지토리에 대해 이 작업들을 가진 서비스 계정을 만들고 키를 발급한 다음, 그 키로 호출하세요(API, `arkvoryctl` 또는 콘솔의 [[ui:keySignIn]]). 오류는 `403`이며 사유는 `permission_missing`입니다. [인증](../api/authentication#repository-actions)을 참조하세요.

### Docker, Git LFS, Unity가 함께 동작하나요? {#protocols}

예. Arkvory는 `/v2/`에서 컨테이너 레지스트리를, `/lfs/<repository>`에서 Git LFS 서버를, Unity Package Manager가 사용할 수 있는 `/npm/<repository>/`에서 npm 레지스트리를 제공합니다. 이들은 Arkvory 키를 비밀번호로 받습니다. [클라이언트 및 프로토콜](../protocols/index)을 참조하세요.

## 라이선스 {#license}

### Arkvory는 오픈 소스인가요? {#open-source}

아니요. Arkvory는 무료이며 소스 코드는 읽을 수 있도록 공개되어 있지만 오픈 소스는 아닙니다. Ian Panaev의 ProAnima Arkvory License 1.0을 따르며, 이 라이선스는 포크나 사본의 배포를 허용하지 않습니다. "open source"라고 부르지 마세요. 전문은 [LICENSE.md](https://github.com/ProAnima/Arkvory/blob/main/LICENSE.md)에 있으며, 두 문서가 다르면 러시아어 본문이 우선합니다.

### 무엇을 할 수 있나요? {#license-allowed}

회사를 포함한 어떤 목적으로든 여러 사본을 설치하고 사용할 수 있습니다. 소스를 읽고 연구할 수 있으며, 변경하고, 변경한 버전을 조직 내부에서 사용할 수 있습니다. 자체 아티팩트를 저장하고 전달할 수 있으며, 자체 고객에게도 전달할 수 있습니다.

### 무엇이 허용되지 않나요? {#license-forbidden}

조직 외부의 누구에게도 소프트웨어나 변경된 버전을 배포할 수 없으며, 해당 코드를 포함하는 포크, 빌드, 컨테이너 이미지, 패치를 게시할 수 없고, 판매, 대여 또는 대출하거나 이에 대한 액세스를 제공하거나 요금을 부과하거나, 호스팅 또는 관리형 서비스로 제3자에게 제공할 수 없습니다. 저작권 고지, 라이선스, ProAnima Arkvory 및 ProAnimaStudio 이름을 제거하거나 변경된 버전을 원본으로 제시할 수 없습니다. Arkvory를 기반으로 구축한 시스템을 공개적으로 설명할 때는 출처를 밝히세요: "ProAnima Arkvory by ProAnimaStudio (Ian Panaev), https://github.com/ProAnima/Arkvory". 사본은 공식 출처에서만 받으세요. 그 밖의 권한은 info@proanima.net으로 문의하세요.

### 문제나 취약점은 어디에 보고하나요? {#report}

설치 관련 문제는 콘솔의 [[ui:reportOpen]]을 사용하세요. 보안 문제는 리포지토리의 [SECURITY.md](https://github.com/ProAnima/Arkvory/blob/main/SECURITY.md)를 따르고 공개적으로 게시하지 마세요.
