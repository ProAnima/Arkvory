---
title: '용어집'
description: 'Arkvory와 그 문서에서 사용하는 용어를 알파벳 순으로 간단히 정의하고, 각 항목에 설명하는 페이지로 가는 링크를 제공합니다.'
---

# 용어집

용어는 알파벳 순으로 정렬되어 있습니다. 그 배경이 되는 개념은 [개념](../guide/concepts)을 참조하세요.

## A {#letter-a}

### 계정 {#account}

서버에서 한 사람의 로그인입니다. 3~64자의 이름과 12~128자의 비밀번호로 구성됩니다. 그룹 부여는 계정에 리포지토리 액세스를 제공합니다. [계정 및 키](../use/accounts)를 참조하세요.

### 작업 {#action}

리포지토리에 대한 하나의 정확한 권한입니다. 예를 들어 `upload.create` 또는 `content.read`가 있습니다. 서비스 키는 작업을 가지며, API 참조에는 각 오퍼레이션이 필요로 하는 작업이 나열됩니다. [인증](../api/authentication#repository-actions)을 참조하세요.

### 관리자 {#administrator}

계정, 그룹, 업데이트, 백업을 관리하는 계정입니다. 그룹이 그 액세스를 부여하지 않는 한 관리자는 리포지토리의 파일을 읽지 않습니다. [계정 및 키](../use/accounts)를 참조하세요.

### 동시 처리 한도 {#admission}

서버가 동시에 처리하는 요청과 전송 수의 한도입니다. 이 한도를 넘으면 전송은 잠시 기다린 뒤 서버가 코드 `busy`와 `Retry-After` 헤더와 함께 `503`을 응답합니다. [속도 제한과 사용 중인 서버](../api/index#rate-limits)를 참조하세요.

### 아티팩트 {#artifact}

SHA-256과 함께 저장된 하나의 변경 불가능한 파일입니다. 새 콘텐츠는 새 아티팩트를 만듭니다. [개념](../guide/concepts#artifacts)을 참조하세요.

### 첨부 파일 {#attachment}

빌드에서 같은 리포지토리의 다른 아티팩트로 가는 링크입니다. 매니페스트, SBOM, 서명, 보고서 또는 다른 파일일 수 있습니다. 빌드에는 최대 32개의 첨부 파일이 있습니다. [개념](../guide/concepts#annotations)을 참조하세요.

## B {#letter-b}

### 백업 {#backup}

데이터베이스와 모든 게시된 콘텐츠를 보관소로 복사하는 예약 작업입니다. [백업](../operate/backups)을 참조하세요.

### 백업 에이전트 {#backup-agent}

복사본을 만들고 검증하며 복원 지점에 보존을 적용하는 서비스입니다. [백업](../operate/backups)을 참조하세요.

### Bearer 토큰 {#bearer-token}

모든 클라이언트가 자격 증명을 `/api/v1`로 보내는 방식입니다. `Authorization: Bearer <credential>` 헤더를 사용합니다. [인증](../api/authentication#headers)을 참조하세요.

### 바인딩 {#binding}

서비스 정책의 한 항목입니다. 하나의 리포지토리와 그곳에서 허용되는 작업 목록으로 구성됩니다. 정책에는 최대 64개의 바인딩이 있습니다. [인증](../api/authentication#service-accounts)을 참조하세요.

### 빌드 {#build}

하나의 CI 실행 결과로, 아티팩트 또는 패키지 버전으로 저장됩니다. [패키지](../use/packages)를 참조하세요.

## C {#letter-c}

### 카탈로그 {#catalog}

리포지토리에 있는 아티팩트의 목록으로, 이름, 크기, 레이블, 스테이지를 포함합니다. [아티팩트 참조](../api/reference/artifacts)를 참조하세요.

### 상한 {#ceiling}

위임의 한도입니다. 운영자가 자신이 관리하는 계정의 정책과 키에 넣을 수 있는 리포지토리 작업을 말합니다. 운영자는 자신의 상한을 넘을 수 없습니다. [인증](../api/authentication#delegation)을 참조하세요.

### 체크섬 {#checksum}

바이트가 예상한 것임을 증명하는 SHA-256입니다. 업로드는 바이트가 도착하기 전에 이를 선언하며, 서버와 클라이언트가 검증합니다. [전송](../use/transfers)을 참조하세요.

### 정리 {#cleanup}

물리적 정리라고도 합니다. 삭제된 콘텐츠의 디스크 공간을 백그라운드에서 작은 배치로 비웁니다. [스토리지](../operate/storage)를 참조하세요.

### 컬렉션 {#collection}

이름이 있는 아티팩트 집합입니다. 컬렉션은 아티팩트 주석의 일부입니다. [개념](../guide/concepts#annotations)을 참조하세요.

### 비교 후 교체 {#compare-and-swap}

기대하는 리비전을 지정하는 변경입니다. 예를 들어 `expectedRevision`이 있습니다. 다른 변경이 먼저 있었다면 서버는 사유 `revision_mismatch`와 함께 `409`를 응답하고 아무것도 바꾸지 않습니다. [HTTP API 개요](../api/index#revisions)를 참조하세요.

### 완료 작업 {#completion-job}

대용량 업로드를 검사하고 게시하는 워커의 백그라운드 작업입니다. `GET /api/v1/jobs/{id}`로 따라갑니다. 상태는 `queued`, `running`, `completed` 또는 `failed`입니다. [업로드 참조](../api/reference/uploads#getCompletionJob)를 참조하세요.

### 콘솔 {#console}

`/console/`에서 제공되는 Arkvory의 웹 인터페이스입니다. [웹 콘솔](../guide/console)을 참조하세요.

### CORS {#cors}

다른 주소의 API를 호출하는 페이지에 대한 브라우저 규칙입니다. 다른 origin의 페이지는 관리자가 그 origin을 `ARKVORY_CORS_ORIGINS`에 나열한 경우에만 동작합니다. [환경 변수](./environment)를 참조하세요.

### 커서 {#cursor}

결과 페이지에 있는 `next` 값입니다. 다음 페이지를 읽으려면 `after`로 다시 보내세요. `next`가 `null`이면 목록이 끝난 것입니다. [HTTP API 개요](../api/index#pagination)를 참조하세요.

## D {#letter-d}

### 위임 {#delegation}

복구 키에서 운영자 키로의 부여입니다. 운영자는 상한 안에서 지정된 관리 작업으로 지정된 서비스 계정을 관리할 수 있습니다. [인증](../api/authentication#delegation)을 참조하세요.

### 다이제스트 {#digest}

`sha256:…`로 표기되는 컨테이너 이미지의 콘텐츠 주소입니다. [컨테이너 이미지](../protocols/containers)를 참조하세요.

### 다운로드 링크 {#download-link}

키 없이 하나의 아티팩트를 다운로드하는 시간 제한 링크입니다. 60초에서 24시간(기본 1시간) 동안 유지되며, 만료되기 전에는 아무도 폐기할 수 없습니다. [인증](../api/authentication#download-links)을 참조하세요.

## E {#letter-e}

### ETag {#etag}

다운로드의 검증자로, 아티팩트의 강한 값 `"sha256:<hex>"`입니다. `If-Range`와 함께 사용하면 안전하게 재개할 수 있고, `If-None-Match`와 함께 사용하면 반복 다운로드를 건너뜁니다. [HTTP API 개요](../api/index#range-downloads)를 참조하세요.

## F {#letter-f}

### 장애 조치 {#failover}

원본을 잃었을 때 클라이언트를 미러로 옮기는 것입니다. 운영자가 미러를 분리하면 미러는 변경을 받아들이는 일반 리포지토리가 됩니다. 아무것도 스스로 전환되지 않습니다. [미러](../operate/mirrors)를 참조하세요.

### 피드백 {#feedback}

로그인한 사용자가 콘솔에서 ProAnimaStudio로 보내는 스크린샷과 로그가 포함된 보고서입니다. 콘솔은 무언가를 보내기 전에 첨부되는 내용을 보여 줍니다. [웹 콘솔](../guide/console#feedback)을 참조하세요.

### 경로 기반 파일 {#file-by-path}

`builds/game/Setup.exe`처럼 리포지토리의 경로로 주소가 지정되며 이전 리비전을 보존하는 파일입니다. [파일과 경로](../use/files)를 참조하세요.

### 파일 키 {#file-key}

SHA-256이 서버의 키 파일(`ARKVORY_KEYS_FILE`)에 나열된 시크릿입니다. 복구 키는 파일 키입니다. [인증](../api/authentication#recovery-key)을 참조하세요.

## G {#letter-g}

### 유예 기간 {#grace-period}

삭제된 콘텐츠가 정리로 제거되기 전까지 디스크에 남아 있는 시간입니다. 기본 24시간입니다. [스토리지](../operate/storage)를 참조하세요.

### 그룹 {#group}

리포지토리 액세스를 공유하는 계정 집합입니다. 그룹은 리포지토리별로 `read` 또는 `write`("읽기 및 쓰기") 액세스를 받습니다. [계정 및 키](../use/accounts)를 참조하세요.

## H {#letter-h}

### 기록 {#history}

경로 기반 파일 또는 첨부 파일 집합의 이전 리비전입니다. [파일과 경로](../use/files)를 참조하세요.

### 허브 {#hub}

안정 릴리스를 알리고 피드백을 받는 `https://hub.proanima.net`의 ProAnimaStudio 서비스입니다. [업데이트](../install/updates)를 참조하세요.

## I {#letter-i}

### 멱등성 키 {#idempotency-key}

`Idempotency-Key` 헤더입니다. 1~128자의 값으로, 반복된 요청이 한 번만 적용되게 합니다. [HTTP API 개요](../api/index#idempotency)를 참조하세요.

### 이미지 {#image}

내장 레지스트리에 저장된 컨테이너 이미지입니다. [컨테이너 이미지](../protocols/containers)를 참조하세요.

### 설치 루트 {#installation-root}

데이터, 구성, 로그가 있는 폴더입니다. Windows에서는 `C:\ProgramData\ProAnima\Arkvory`, Linux에서는 `/opt/proanima-arkvory`입니다. [설치 선택](../install/index#installation-directory)을 참조하세요.

## L {#letter-l}

### 레이블 {#label}

`nightly` 또는 `tested` 같은 아티팩트의 짧은 태그입니다. 아티팩트에는 최대 32개의 레이블이 있습니다. [개념](../guide/concepts#annotations)을 참조하세요.

### 임대 {#lease}

한 프로세스만 작업을 수행하도록, 프로세스가 짧은 시간 동안 보유하고 갱신해야 하는 권리입니다. 백업 에이전트는 기본 60초의 임대를 보유하므로 두 에이전트가 동시에 실행되지 않습니다. [환경 변수](./environment#backups)를 참조하세요.

### 활성 상태 {#liveness}

`GET /health/live`의 응답으로, 프로세스가 실행 중임을 나타냅니다. 공개입니다. [시스템 참조](../api/reference/system)를 참조하세요.

### 잠금 {#lock}

두 사람이 같은 바이너리 파일을 변경하지 못하게 하는 Git LFS 파일 잠금입니다. [Git LFS](../protocols/git-lfs)를 참조하세요.

## M {#letter-m}

### 유지 관리 시간 {#maintenance-hour}

자동 업데이트가 설치될 수 있는 UTC 기준 하루 중 특정 시간입니다. 기본값은 03:00입니다. [업데이트](../install/updates)를 참조하세요.

### 메타데이터 {#metadata}

아티팩트의 키/값 텍스트 필드입니다. 최대 32개 필드이며 값은 최대 1,024자입니다. [개념](../guide/concepts#annotations)을 참조하세요.

### 미러 {#mirror}

두 번째 설치가 원본을 따라가며 유지하는 리포지토리의 읽기 전용 복사본입니다. [미러](../operate/mirrors)를 참조하세요.

### 원본 {#mirror-source}

미러가 복사해 오는 설치입니다. 미러는 읽기 전용 키로 원본에 로그인합니다. [미러](../operate/mirrors)를 참조하세요.

### 이동 {#move}

빌드를 원본 리포지토리에서도 제거하는 승격입니다. [승격](../use/promotion)을 참조하세요.

## O {#letter-o}

### 시작하기 {#onboarding}

설치 후의 첫 단계로, 콘솔의 시작하기 섹션에 표시됩니다. [빠른 시작](../guide/quick-start)을 참조하세요.

### OpenAPI {#openapi}

`/api/v1/openapi.json`에서 제공되는 HTTP API의 기계 판독 가능한 설명입니다. [HTTP API 개요](../api/index#discovery)를 참조하세요.

### 소유자 {#owner}

설치 중에 만들어지는 첫 계정입니다. 관리자이며 `releases`에 쓸 수 있는 `arkvory-owners` 그룹의 구성원입니다. [개념](../guide/concepts#owner-and-recovery-key)을 참조하세요.

## P {#letter-p}

### 패키지 {#package}

그룹, 이름, SemVer 버전을 가진 버전 관리 UPack 패키지입니다. [패키지](../use/packages)를 참조하세요.

### 패키지 그룹 {#package-group}

패키지 이름의 첫 부분입니다. 다른 그룹에 있는 같은 이름의 패키지는 서로 다른 패키지입니다. [패키지](../use/packages)를 참조하세요.

### 파트 {#part}

자체 요청으로 전송되는 대용량 파일의 한 조각입니다. 파트는 마지막을 제외하고 최소 8 MiB이며 최대 1 GiB입니다. [전송](../use/transfers)을 참조하세요.

### 권한 {#permission}

하나의 작업을 수행할 권리입니다. 사람은 그룹을 통해 `read` 또는 `write`를 받고, 서비스 키는 정확한 작업을 받습니다. [인증](../api/authentication#access-rules)을 참조하세요.

### 개인용 액세스 토큰 {#personal-access-token}

스크립트와 명령줄을 위한 개인의 시크릿입니다. `pat_`로 시작하고 기본 90일(최대 365일) 후 만료되며, 읽기 전용이거나 읽기 및 쓰기입니다. [인증](../api/authentication#personal-tokens)을 참조하세요.

### 고정 {#pin}

복원 지점처럼 자동 삭제에서 무언가를 보호하는 것입니다. [백업](../operate/backups)을 참조하세요.

### 정책 {#policy}

서비스 계정(그 바인딩), 리포지토리(그 스토리지 정책) 또는 백업 계획의 저장된 규칙입니다. [인증](../api/authentication#service-accounts)을 참조하세요.

### 승격하다 {#promote}

승격의 동사입니다. 다른 리포지토리에 빌드를 게시하거나, 스테이지로 표시합니다. [승격](../use/promotion)을 참조하세요.

### 승격 {#promotion}

빌드를 다시 업로드하지 않고 다른 리포지토리에 게시하는 것입니다. [승격](../use/promotion)을 참조하세요.

## Q {#letter-q}

### 할당량 {#quota}

리포지토리가 사용할 수 있는 최대 공간입니다. 이를 넘을 새 업로드는 사유 `storage_quota`와 함께 `507`로 거부됩니다. [스토리지](../operate/storage)를 참조하세요.

## R {#letter-r}

### 범위 {#range}

파일의 일부를 요청하는 HTTP 헤더 `Range: bytes=start-end`입니다. 다운로드는 요청당 하나의 범위를 지원하며, 이것이 재개에 필요합니다. [HTTP API 개요](../api/index#range-downloads)를 참조하세요.

### 속도 제한 {#rate-limit}

무언가를 시도할 수 있는 빈도에 대한 제한입니다. Arkvory는 로그인, 등록, 비밀번호, 피드백 시도를 제한하고 `Retry-After`와 함께 `429`를 응답합니다. [인증](../api/authentication#sign-in-limits)을 참조하세요.

### 읽기 게이트웨이 {#read-gateway}

같은 스토리지에 있는 다운로드 전용 추가 API 프로세스입니다. `GET`과 `HEAD`에 응답하고 변경은 `405`로 거부합니다. [읽기 게이트웨이](../operate/read-gateways)를 참조하세요.

### 준비 상태 {#readiness}

서버가 작업을 할 수 있는지 여부입니다. `GET /health/status`는 공개이며 `{"status":"ready"}` 또는 `unavailable`을 응답합니다. `GET /health/ready`는 자격 증명이 필요하고 세부 정보를 제공합니다. [시스템 참조](../api/reference/system)를 참조하세요.

### 복구 키 {#recovery-key}

부트스트랩 키라고도 합니다. `config/bootstrap-token.txt`에 있는 설치의 시크릿으로, 소유자를 만들고 서비스 계정을 관리하며 액세스를 복구합니다. [인증](../api/authentication#recovery-key)을 참조하세요.

### 레지스트리 {#registry}

Docker나 npm 같은 클라이언트가 푸시하고 풀하는 서버입니다. Arkvory에는 컨테이너 레지스트리(`/v2/`)와 npm 레지스트리(`/npm/`)가 있습니다. [클라이언트 및 프로토콜](../protocols/index)을 참조하세요.

### 리포지토리 {#repository}

자체 액세스 규칙과 스토리지 정책을 가진 이름이 있는 콘텐츠 공간입니다. [리포지토리](../use/repositories)를 참조하세요.

### 요청 ID {#request-id}

하나의 요청 식별자로, `X-Request-Id` 헤더와 모든 오류에 담겨 반환됩니다. 지원팀에 알려주세요. [HTTP API 개요](../api/index#request-ids)를 참조하세요.

### 확인 {#resolve}

스테이지와 버전 범위가 가리키는 빌드를 찾는 것입니다. [승격](../use/promotion)을 참조하세요.

### 복원 {#restore}

파일의 이전 리비전을 다시 현재로 만드는 것으로, 새 리비전을 추가합니다. 복원 지점에서 전체 설치를 복구하는 것이기도 합니다. [파일과 경로](../use/files) 및 [백업](../operate/backups)을 참조하세요.

### 복원 지점 {#restore-point}

복원할 수 있는 하나의 완전한 백업입니다. [백업](../operate/backups)을 참조하세요.

### 재개 {#resume}

중단된 업로드나 다운로드를 멈춘 지점부터 계속하는 것입니다. [전송](../use/transfers)을 참조하세요.

### 보존 {#retention}

콘텐츠나 백업을 얼마나 오래 보관하는지에 대한 규칙입니다. [스토리지](../operate/storage)를 참조하세요.

### 보존 정책 {#retention-policy}

리포지토리의 저장된 보존 규칙입니다. 빌드를 몇 개나 유지할지, 어떤 레이블을 보호할지, 제거 전에 빌드가 얼마나 오래되어야 하는지를 정합니다. 관리자가 켜기 전까지는 꺼져 있습니다. [스토리지](../operate/storage)를 참조하세요.

### Retry-After {#retry-after}

`429`나 `503` 이후 다시 시도하기 전에 몇 초를 기다려야 하는지 알려주는 헤더이자 오류의 `retryAfterSeconds` 필드입니다. [HTTP API 개요](../api/index#rate-limits)를 참조하세요.

### 리비전 {#revision}

경로 기반 파일, 아티팩트 주석 또는 설정의 번호가 매겨진 버전입니다. 리비전은 1부터 올라갑니다. [HTTP API 개요](../api/index#revisions)를 참조하세요.

### 폐기 {#revoke}

키나 토큰을 영구히 취소하는 것입니다. [인증](../api/authentication#service-keys)을 참조하세요.

### 롤백 {#rollback}

시작되지 않은 업데이트 후 이전 버전으로 돌아가는 것입니다. [업데이트](../install/updates)를 참조하세요.

### 교체 {#rotate}

이전 키가 계속 동작하는 동안 키를 새 키로 바꾸는 것입니다. 새 키를 활성화하면 이전 키는 24시간으로 제한됩니다. [인증](../api/authentication#service-keys)을 참조하세요.

## S {#letter-s}

### SBOM {#sbom}

소프트웨어 자재 명세서로, 빌드의 구성 요소 목록입니다. 빌드에 첨부할 수 있습니다. [개념](../guide/concepts#annotations)을 참조하세요.

### 자가 복구 {#self-healing}

충돌이나 중단 후 서비스가 스스로 다시 시작하는 것입니다. [자가 복구](../operate/self-healing)를 참조하세요.

### SemVer {#semver}

유의적 버전입니다. `MAJOR.MINOR.PATCH` 형식이며 `1.4.2` 또는 `2.0.0-rc.1`처럼 선택적 사전 릴리스 부분이 붙을 수 있습니다. [패키지](../use/packages)를 참조하세요.

### 서비스 계정 {#service-account}

CI나 자동화를 위한 계정입니다. 정책을 가지며 키로 로그인합니다. [인증](../api/authentication#service-accounts)을 참조하세요.

### 서비스 키 {#service-key}

서비스 계정이 로그인하는 시크릿입니다. `arkvory_`로 시작하고 한 번만 표시되며 활성화해야 합니다. [인증](../api/authentication#service-keys)을 참조하세요.

### 세션 {#session}

로그인한 콘솔 세션입니다. `dps_`로 시작하고 12시간 동안 지속됩니다. [인증](../api/authentication#sessions)을 참조하세요.

### SHA-256 {#sha-256}

Arkvory가 아티팩트, 파트, 릴리스에 사용하는 해시 함수입니다. 64자의 소문자 16진수로 표기됩니다. [전송](../use/transfers)을 참조하세요.

### 안정 릴리스 {#stable-release}

ProAnimaStudio가 안정 채널의 설치를 위해 승인한 릴리스입니다. [업데이트](../install/updates)를 참조하세요.

### 스테이지 {#stage}

`qa`, `release`, `prod` 같은 빌드의 표시입니다. [승격](../use/promotion)을 참조하세요.

### Surface {#surface}

API 작업의 여섯 그룹 중 하나입니다. `discovery`, `identity`, `catalog`, `transfers`, `administration`, `operations`가 있습니다. [HTTP API 개요](../api/index#surfaces)를 참조하세요.

## T {#letter-t}

### 태그 {#tag}

`latest` 또는 `1.4` 같은 컨테이너 이미지 버전의 이름입니다. [컨테이너 이미지](../protocols/containers)를 참조하세요.

## U {#letter-u}

### UPack {#upack}

Arkvory가 등록하는 패키지 형식입니다. 그룹, 이름, 버전을 제공하는 `upack.json` 매니페스트가 있는 아카이브입니다. [패키지](../use/packages)를 참조하세요.

### 업데이트 {#update}

Arkvory의 더 새로운 안정 릴리스, 그리고 그것을 설치하는 일입니다. [업데이트](../install/updates)를 참조하세요.

### 업로드 {#upload}

서버로 파일을 보내는 행위입니다. 이 단어는 파일을 예약하는 업로드 세션을 가리키기도 합니다. [전송](../use/transfers)을 참조하세요.

### 업로드 세션 {#upload-session}

하나의 파일에 대한 예약입니다. 7일 동안 유지되며 모든 바이트가 도착하면 완료됩니다. [업로드 참조](../api/reference/uploads)를 참조하세요.

## V {#letter-v}

### 백업 보관소 {#vault}

백업 스토리지입니다. 다른 디스크나 네트워크 공유의 폴더입니다. [백업](../operate/backups)을 참조하세요.

### 버전 {#version}

`1.4.2` 같은 패키지의 SemVer 버전입니다. [패키지](../use/packages)를 참조하세요.

### 버전 범위 {#version-range}

`^1.4` 같은 버전 집합입니다. [패키지](../use/packages)를 참조하세요.

## W {#letter-w}

### 워커 {#worker}

대용량 업로드를 완료하고 미러를 동기화하는 서비스입니다. [설치 선택](../install/index)을 참조하세요.

### 쓰기 서버 {#writer}

읽기 게이트웨이와 달리 변경을 받아들이는 API 프로세스입니다. [읽기 게이트웨이](../operate/read-gateways)를 참조하세요.
