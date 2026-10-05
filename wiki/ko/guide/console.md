---
title: 웹 콘솔
---

# 웹 콘솔

웹 콘솔은 Arkvory의 브라우저 인터페이스입니다. 서버에 포함되어 있으므로 따로 설치하지 않습니다. 서버 주소 뒤에 `/console/`을 붙여 여세요. 서버에서는 `http://127.0.0.1:8080/console/`, [HTTPS](../install/https)를 설정한 뒤에는 `https://arkvory.example/console/` 같은 주소를 사용합니다.

콘솔은 [명령줄 클라이언트](../protocols/cli) 및 [SDK](../protocols/sdk)와 같은 HTTP API를 사용합니다. 서버가 모든 요청을 검사합니다. 버튼이 보이지 않는다면 사용 중인 계정이나 키로 해당 작업을 실행할 수 없다는 뜻일 뿐입니다.

## 화면 구성 {#layout}

사이드바는 섹션을 그룹으로 묶어 보여 줍니다. 화면이 좁으면 사이드바가 [[ui:navigationMenu]] 버튼으로 바뀝니다.

| 그룹                | 섹션                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [[ui:navLibrary]]   | [[ui:catalog]], [[ui:packages]], [[ui:history]], [[ui:metadata]]                                                          |
| [[ui:navTransfers]] | [[ui:upload]], [[ui:downloads]]                                                                                           |
| [[ui:navResources]] | [[ui:administration]], [[ui:repositories]], [[ui:services]], [[ui:updates]], [[ui:backups]], [[ui:navStart]], [[ui:help]] |

상단 표시줄에는 섹션 제목, [[ui:uploadFile]] 버튼, [[ui:reportOpen]] 버튼, 모양과 언어 컨트롤이 표시됩니다.

각 섹션에는 `#/catalog`, `#/packages`, `#/backups`처럼 고유한 주소가 있습니다. 열려 있는 아티팩트의 주소는 `#/artifact/<repository>/<id>`입니다. 이 주소를 북마크하거나 다른 사람에게 보낼 수 있습니다. 주소에는 비밀번호, 키, 검색어가 포함되지 않습니다. 로그인하기 전에 링크를 열면 콘솔이 로그인한 후에 그 링크를 엽니다.

일부 섹션은 특정 사용자에게만 표시됩니다.

| 섹션                  | 표시되는 대상                                |
| --------------------- | -------------------------------------------- |
| [[ui:administration]] | 관리자                                       |
| [[ui:repositories]]   | 로그인한 모든 사용자                         |
| [[ui:services]]       | 복구 키, 그리고 위임된 권한이 있는 운영자 키 |
| [[ui:updates]]        | 관리자                                       |
| [[ui:backups]]        | 관리자와 복구 키                             |

## 로그인 {#signing-in}

[[ui:connection]] 카드는 페이지 맨 위에 있습니다.

1. [[ui:accountName]] 필드와 [[ui:password]] 필드에 값을 입력하세요.
2. [[ui:signIn]] 버튼을 선택하세요. 세션은 12시간 동안 유지됩니다.
3. [[ui:repository]] 필드에는 읽을 수 있는 첫 번째 리포지토리가 자동으로 선택됩니다. 다른 리포지토리에서 작업하려면 이름을 입력하거나 목록에서 선택하세요.

비밀번호 대신 키로 연결하려면 [[ui:keySignIn]] 항목을 열고 키를 붙여 넣은 다음 [[ui:connect]] 버튼을 선택하세요. 키는 이 브라우저 탭의 메모리에만 남으며, 콘솔은 키를 저장하지 않습니다.

[[ui:signUp]] 버튼은 관리자가 직접 가입을 허용한 경우에만 표시됩니다. [[ui:disconnect]] 버튼은 연결을 종료합니다.

비밀번호로 로그인하면 [[ui:changeOwnPassword]] 및 [[ui:personalAccessTokens]] 항목을 사용할 수 있습니다. 개인용 액세스 토큰은 본인의 도구에서 사용하는 키입니다. [계정 및 액세스](../use/accounts)를 참조하세요.

### 첫 번째 소유자 {#the-first-owner}

새로 설치한 환경에는 계정이 없습니다. Windows에서는 Setup이 소유자를 만듭니다. 다른 설치에서는 콘솔에서 소유자를 만드세요.

1. [[ui:navStart]] 섹션을 열고 [[ui:welcomeOwner]] 항목을 펼치세요.
2. 설치 디렉터리의 `config/bootstrap-token.txt`에 있는 복구 키를 붙여 넣으세요.
3. 이름과 12자 이상의 비밀번호를 입력한 다음 [[ui:welcomeCreate]] 버튼을 선택하세요.
4. 새 이름과 비밀번호로 로그인하세요.

이 양식은 계정이 하나도 없는 동안에만 작동합니다. 소유자는 관리자입니다. 또한 소유자는 `arkvory-owners` 그룹을 통해 `releases` 리포지토리에 대한 쓰기 액세스를 얻습니다.

## 라이브러리 {#library}

### 아티팩트 {#artifacts}

[[ui:catalog]] 섹션에는 리포지토리에 게시된 파일이 나열됩니다. 이름이나 메타데이터 값으로 검색할 수 있습니다. 특정 레이블만 보려면 [[ui:labelFilter]] 필드를, 키와 값이 정확히 일치하는 항목을 보려면 [[ui:metadataFilter]] 필드를 사용하세요. 각 행에는 이름, 크기, 게시 시각, 스테이지, 레이블이 표시됩니다. 파일을 다운로드하려면 [[ui:download]] 버튼을, 세부 정보를 보려면 [[ui:open]] 버튼을 선택하세요. [[ui:more]] 버튼은 다음 페이지를 표시합니다.

### 패키지 {#packages}

[[ui:packages]] 섹션에는 등록된 UPack 버전이 나열됩니다. [[ui:packageGroup]] 필드와 [[ui:packageName]] 필드로 필터링하고, [[ui:sortBy]] 및 [[ui:groupBy]] 옵션을 고른 다음 [[ui:apply]] 버튼을 선택하세요. 스테이지 열에는 각 버전이 어느 스테이지로 승격되었는지 표시됩니다. [패키지](../use/packages)를 참조하세요.

### 파일 기록 {#file-history}

`builds/game/1.4/GameSetup.exe` 같은 파일 경로는 새 콘텐츠를 여러 번 가리킬 수 있습니다. 변경할 때마다 새 버전이 만들어집니다. [[ui:history]] 섹션에서 경로를 입력하고 [[ui:historyLoad]] 버튼을 선택하세요. 각 버전이 작성자 및 시각과 함께 표시됩니다. 원하는 버전을 열어 원래 콘텐츠를 다운로드할 수 있습니다. 이전 버전을 복원하면 새 버전이 만들어지며, 아무것도 삭제되지 않습니다. [파일과 경로](../use/files)를 참조하세요.

### 아티팩트 세부 정보 {#artifact-details}

[[ui:metadata]] 섹션에는 아티팩트 하나가 표시됩니다.

- **요약**: [[ui:summarySize]], [[ui:summaryCreated]], [[ui:summaryHash]], 그리고 [[ui:copyHash]] 버튼.
- **속성**: [[ui:labels]], [[ui:collections]], [[ui:metadataFields]]. 저장하려면 [[ui:save]] 버튼을 선택하세요. 파일 자체는 변경되지 않습니다.
- **작업**: [[ui:download]] 버튼. [[ui:downloadLink]] 버튼은 키 없이 1시간 동안 유효한 링크를 만듭니다. [[ui:register]] 버튼은 UPack 아카이브를 인덱싱합니다.
- [[ui:assetTitle]]: [[ui:assign]] 버튼은 이 아티팩트를 파일 경로의 현재 콘텐츠로 지정합니다.
- [[ui:promotionTitle]]: [[ui:stageAdd]] 버튼은 `qa`나 `release` 같은 스테이지를 아티팩트에 표시합니다. [[ui:promoteSubmit]] 버튼은 아티팩트를 다른 리포지토리에 게시합니다. [승격](../use/promotion)을 참조하세요.
- [[ui:attachmentsTitle]]: [[ui:attachmentAdd]] 버튼은 매니페스트, SBOM, 서명, 보고서 또는 다른 파일을 이 빌드에 연결합니다. [[ui:attachmentHistory]] 버튼은 이전 세트를 보여 줍니다.
- [[ui:deletionTitle]]: [[ui:deletionInspect]] 버튼은 이 아티팩트를 아직 사용하고 있는 항목을 보여 줍니다. 삭제하려면 아티팩트 ID를 붙여 넣고 [[ui:deletionSubmit]] 버튼을 선택하세요.

## 전송 {#transfers}

### 업로드 {#upload}

[[ui:upload]] 섹션에서 파일을 선택하고 [[ui:startUpload]] 버튼을 선택하세요. 콘솔은 먼저 파일의 SHA-256을 계산한 다음 파트로 나누어 전송합니다. [[ui:pause]] 버튼은 전송을 멈추고 업로드된 파트를 유지합니다.

나중에 이어서 올리려면 업로드 ID를 보관하세요. [[ui:resumeTitle]] 항목을 열고 같은 파일을 선택한 다음 [[ui:uploadId]] 필드에 ID를 입력하세요. 업로드 중에 페이지를 벗어나려고 하면 브라우저가 경고합니다. [전송](../use/transfers)을 참조하세요.

### 다운로드 {#downloads}

[[ui:downloads]] 섹션은 콘솔에서 다운로드하는 파일의 대기열입니다. 콘솔은 최종 파일을 저장하기 전에 각 파일의 SHA-256을 확인합니다.

- [[ui:downloadSettings]] 항목에서는 [[ui:downloadConcurrency]] (1~8), [[ui:downloadInterval]], [[ui:downloadWait]] 값을 설정합니다.
- [[ui:downloadsPause]], [[ui:downloadsResume]], [[ui:downloadsClearWaiting]], [[ui:downloadsCancel]], [[ui:downloadsClearFinished]] 버튼으로 대기열 전체를 제어합니다.
- 페이지를 새로 고친 뒤에는 다시 로그인하고 [[ui:downloadRestore]] 버튼을 선택하세요. 그런 다음 각 파일을 재개하고 저장할 위치를 선택하세요.

대용량 다운로드에는 보안 주소(HTTPS 또는 로컬 컴퓨터)에서 연 Chrome 또는 Edge가 필요합니다. 임시 데이터는 브라우저의 비공개 저장소에 보관됩니다.

## 리소스 {#resources}

### 사용자 및 액세스 {#users-and-access}

관리자는 여기에서 사용자를 관리합니다. [[ui:accountsHeading]] 영역에는 계정이, [[ui:groupsHeading]] 영역에는 그룹이 나열됩니다. [[ui:createUser]], [[ui:resetPassword]], [[ui:createGroup]], [[ui:manageMembers]] 버튼을 사용하세요. [[ui:manageGrants]] 항목에서는 그룹에 리포지토리 이름으로 [[ui:read]] 또는 [[ui:write]] 액세스를 부여합니다. 리포지토리를 만드는 별도의 단계는 없습니다. 액세스 부여나 서비스 정책에 이름이 지정되는 즉시 리포지토리가 존재합니다.

### 리포지토리 {#repositories}

[[ui:repositories]] 섹션에는 볼 수 있는 리포지토리가 표시되며, 각 리포지토리에 [[ui:repositoryRights]] 정보가 함께 나옵니다. 각 카드에는 [[ui:repositoryOpen]] 버튼, [[ui:repositoryStorage]] 항목(할당량, 자동 정리, 물리적 정리), 그리고 관리자용 [[ui:repositoryAccess]] 항목이 있습니다. 미러링된 리포지토리에는 [[ui:mirrorBadge]] 배지가 표시됩니다. [리포지토리](../use/repositories)와 [스토리지](../operate/storage)를 참조하세요.

### 서비스 액세스 {#service-access}

여기에서 도구와 CI 시스템용 계정을 만듭니다. 이 섹션을 보려면 복구 키 또는 운영자 키로 연결해야 합니다. [[ui:serviceCreate]] 버튼을 선택한 다음 [[ui:servicePolicy]] 항목을 설정하세요. [[ui:bindingRead]] 버튼과 [[ui:bindingPublish]] 버튼은 일반적인 권한 집합을 자동으로 채워 줍니다.

키를 발급하려면 [[ui:serviceKeys]] 항목을 열고 [[ui:keyIssue]] 버튼을 선택하세요. 시크릿은 한 번만 표시됩니다. 시크릿을 복사한 뒤 [[ui:keySaved]] 확인란을 선택하고 [[ui:keyActivate]] 버튼을 선택하세요. 활성화하지 않은 키는 15분 후에 만료됩니다. 키를 교체하려면 [[ui:keyRotate]] 버튼을, 키를 중지하려면 [[ui:keyRevoke]] 버튼을 사용하세요. [[ui:delegations]] 항목에서는 소유자가 운영자에게 제한된 관리 권한을 부여할 수 있습니다.

### 업데이트 {#updates}

[[ui:updates]] 섹션에는 [[ui:updateCurrent]] 및 [[ui:updateLatest]] 정보가 표시됩니다. [[ui:updateCheck]] 버튼 또는 [[ui:updateInstall]] 버튼을 선택하세요. [[ui:updateSettings]] 영역에서 [[ui:updateAutomatic]] 확인란을 선택하고 [[ui:updateHour]] 목록에서 시간을 선택하세요. [업데이트](../install/updates)를 참조하세요.

### 백업 {#backups}

[[ui:backups]] 섹션에는 백업 상태가 정상인지, 가장 최근 백업, 다음 실행 시각, 백업 에이전트, 백업 보관소가 표시됩니다. 백업을 시작하려면 [[ui:backupRun]] 버튼을 선택하세요. [[ui:backupPoints]] 영역에는 복원 지점이 나열되며, 지점의 모든 바이트를 검증하거나 지점을 고정할 수 있습니다. [[ui:backupPlan]] 영역에서는 매일 실행 시각, 시간대, 보관할 지점 수를 설정합니다. 복원은 서버에서 실행하는 명령입니다. [백업](../operate/backups)을 참조하세요.

### 시작하기와 API 참조 {#getting-started-and-api-reference}

[[ui:navStart]] 섹션에는 새 서버의 첫 단계가 표시됩니다. [[ui:help]] 섹션에는 예제 명령이 나열됩니다. [[ui:helpLoad]] 버튼은 현재 계정이나 키로 호출할 수 있는 API 작업을 보여 줍니다.

## 피드백 {#feedback}

로그인한 후 [[ui:reportOpen]] 버튼을 사용하면 허브를 통해 ProAnimaStudio에 메시지를 보낼 수 있습니다. 이미지를 최대 6개까지 추가할 수 있으며, 답장을 받을 이메일 주소도 입력할 수 있습니다. 관리자는 서버 로그를 첨부할 수 있습니다. [[ui:reportShow]] 버튼을 선택하면 전송되는 내용을 정확히 확인할 수 있습니다.

## 모양과 언어 {#appearance-and-language}

[[ui:theme]] 설정에는 세 가지 옵션이 있습니다: [[ui:system]], [[ui:light]], [[ui:dark]]. [[ui:language]] 목록에는 콘솔의 모든 언어가 각 언어 자신의 이름으로 표시됩니다: English, Русский, Español, Français, Deutsch, Português, 中文, 日本語, 한국어, हिन्दी, العربية. 페이지는 새로 고침 없이, 입력한 내용을 잃지 않고 즉시 전환됩니다. 아랍어는 오른쪽에서 왼쪽으로 표시됩니다. 처음 방문하면 콘솔은 브라우저의 언어 설정을 따르고, 맞는 언어가 없으면 영어를 사용합니다. [[ui:help]] 섹션의 [[ui:helpDocs]] 카드에서 콘솔 언어로 된 이 문서를 열 수 있습니다. 브라우저에는 테마와 언어만 저장되며, 계정이나 리포지토리에 관한 정보는 저장되지 않습니다.

## 관련 페이지 {#related-pages}

- [빠른 시작](./quick-start)
- [개념](./concepts)
- [계정 및 액세스](../use/accounts)
- [문제 해결](../operate/troubleshooting)
