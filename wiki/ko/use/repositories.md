---
title: 리포지토리
description: 리포지토리란 무엇인지, 사용할 수 있는 리포지토리를 확인하는 방법, 콘솔에서 리포지토리를 선택하는 방법, 읽기 전용 리포지토리가 무엇인지 설명합니다.
---

# 리포지토리

리포지토리는 Arkvory에서 파일을 저장하고 액세스를 결정하는, 이름이 있는 공간입니다. 게시하는 모든 것은 리포지토리 하나에 들어가며, 모든 요청에는 리포지토리 이름이 포함됩니다.

## 리포지토리란 {#what-it-is}

리포지토리에는 ID가 있습니다. 영문 소문자, 숫자, `-`, `_`를 사용하며, 문자 또는 숫자로 시작하고 최대 64자입니다. 예를 들면 `releases`, `builds`, `game-prod`입니다. ID는 모든 주소의 일부입니다.

| 대상                                       | 주소                                  |
| ------------------------------------------ | ------------------------------------- |
| 아티팩트, 패키지, 경로 기반 파일(HTTP API) | `/api/v1/repositories/<repository>/…` |
| 컨테이너 이미지                            | `/v2/<repository>/<image>/…`          |
| Git LFS                                    | `/lfs/<repository>`                   |
| npm 및 Unity 패키지                        | `/npm/<repository>/…`                 |

[컨테이너 이미지](../protocols/containers), [Git LFS](../protocols/git-lfs), [Unity 및 npm](../protocols/unity-npm)을 참조하세요.

리포지토리에는 변경할 수 없는 아티팩트가 들어 있습니다. 아티팩트는 두 가지 방식으로 볼 수 있습니다. 버전이 있는 UPack 패키지([패키지](./packages))와 기록이 있는 경로 기반 파일([경로 기반 파일](./files))입니다. 스테이지와 승격은 리포지토리 사이에서 빌드를 이동합니다([스테이지 및 승격](./promotion)).

현재 리포지토리에는 액세스, [스토리지 설정](#settings), 그리고 다른 서버의 복사본인 경우 [미러 상태](#read-only) 외에 표시 이름, 설명, 자체 설정이 없습니다. 리포지토리의 이름을 바꿀 수 없습니다. 리포지토리를 삭제할 수도 없습니다. 액세스를 제거해도 파일은 디스크에 남습니다.

## 리포지토리 만들기 {#create}

리포지토리를 만드는 명령은 없습니다. 리포지토리는 액세스가 부여되는 즉시 존재합니다. 첫 업로드 전까지는 비어 있습니다.

관리자가 다음 중 하나를 수행합니다.

- 새 이름에 대해 그룹에 액세스를 부여합니다. 콘솔에서 [[ui:administration]] 섹션을 열고 [[ui:manageGrants]] 항목을 펼친 다음, 그룹을 선택하고 [[ui:repository]] 필드에 이름을 입력하세요. 그리고 [[ui:read]] 수준 또는 [[ui:write]] 수준을 선택하고 [[ui:saveGrant]] 버튼을 선택하세요. 첫 번째 부여에는 소유자가 속한 `arkvory-owners` 그룹이 좋은 선택입니다. [그룹과 리포지토리 액세스](./accounts#groups)를 참조하세요.
- 서비스 계정의 정책에 리포지토리 이름을 지정합니다. [CI용 서비스 계정과 키](./accounts#service-accounts)를 참조하세요.

API에서는 `setGroupGrant`와 `setServicePolicy`가 같은 일을 합니다. 오타를 입력하면 잘못된 이름의 새 리포지토리가 만들어지므로 철자를 확인하세요. 설치 후에는 `arkvory-owners` 그룹에 쓰기 액세스가 부여된 `releases` 리포지토리가 존재합니다.

## 사용할 수 있는 리포지토리 확인 {#list}

자격 증명에 권한이 있는 리포지토리만 보입니다. 권한이 없는 리포지토리는 표시되지 않으며, 직접 요청하면 `404`가 반환됩니다. 액세스 권한이 있는 빈 리포지토리는 표시됩니다.

콘솔에서 [[ui:repositories]] 섹션을 여세요. 각 카드에는 리포지토리 이름이 표시되고, [[ui:repositoryRights]] 정보 아래에 해당 리포지토리에서 보유한 작업이 나옵니다. 버튼은 다음과 같습니다.

- [[ui:repositoryOpen]] 버튼은 리포지토리의 카탈로그를 엽니다. 아티팩트를 나열할 수 있을 때 표시됩니다.
- [[ui:repositoryStorage]] 버튼은 스토리지 설정이 있는 카탈로그를 엽니다. 스토리지 정책이나 진단 정보를 읽을 수 있을 때 표시됩니다.
- [[ui:repositoryAccess]] 버튼은 사용자 및 서비스 관리로 이동합니다. 관리자와 서비스 관리자에게 표시됩니다.

목록에는 한 번에 리포지토리 50개가 표시됩니다. [[ui:managementMore]] 버튼은 다음 페이지를 불러오고 [[ui:managementReload]] 버튼은 목록을 새로 고칩니다. 미러에는 [[ui:mirrorBadge]] 배지가 표시됩니다.

`arkvoryctl`에서는 다음과 같이 합니다.

```bash
arkvoryctl repositories
arkvoryctl doctor
```

`repositories`는 각 리포지토리를 `formats` 및 `permissions`와 함께 출력합니다. 응답에 `next` 값이 있으면 `--after`로 전달하세요. `doctor`는 서버, 기능, 현재 키의 권한을 보여 줍니다.

API에서 `listRepositories`는 `limit`(1~100, 기본 50)과 `after`(이전 페이지의 마지막 ID)를 받습니다. `getRepository`는 카드 하나를 반환합니다.

```bash
curl -H "Authorization: Bearer $ARKVORY_KEY" "$ARKVORY/api/v1/repositories?limit=100"
```

```typescript
const page = await client.repositories({ limit: 50 });
const card = await client.repository('releases');
```

카드는 `id`, `formats`(항상 `upack`과 `assets`), `permissions`로 구성됩니다. 크기나 파일 수는 알려 주지 않습니다. 작업 이름은 [권한](./accounts#permissions)을 참조하세요.

## 콘솔에서 리포지토리 선택 {#choose}

[[ui:connection]] 카드에는 읽을 수 있는 리포지토리 목록이 있는 [[ui:repository]] 필드가 있습니다. 이 필드는 처음에 `releases`로 시작합니다. 로그인하면 콘솔은 그 리포지토리를 읽을 수 있을 경우 그대로 유지하고, 그렇지 않으면 읽을 수 있는 첫 번째 리포지토리를 선택합니다. 다른 리포지토리에서 작업하려면 이름을 입력하거나 목록에서 선택하세요. 그러면 카탈로그, 패키지, 업로드, 세부 정보가 해당 리포지토리를 사용합니다. 카드의 [[ui:repositoryOpen]] 버튼은 이 필드를 자동으로 채웁니다.

콘솔에서 아티팩트의 주소에는 리포지토리가 포함됩니다: `#/artifact/<repository>/<id>`. 읽을 수 없는 리포지토리에 있는 아티팩트의 링크를 열면 메시지와 카탈로그가 표시됩니다.

`arkvoryctl`은 프로필의 리포지토리를 사용합니다. 프로필을 추가할 때 다른 리포지토리를 지정하지 않으면 `releases`입니다. 명령 하나에만 다른 리포지토리를 쓰려면 `--repository`를 사용하세요.

```bash
arkvoryctl profile add production --server https://arkvory.example --token-file ~/.arkvory/key --repository builds
arkvoryctl list --repository releases
```

SDK에서는 `client.inRepository('builds')`가 리포지토리 하나에 바인딩된 클라이언트를 반환합니다. HTTP에서는 리포지토리가 경로에 들어갑니다.

## 리포지토리 설정 {#settings}

현재 리포지토리에 설정할 수 있는 항목은 다음과 같습니다.

- **액세스.** 누가 읽고 쓸 수 있는지입니다. [계정 및 액세스](./accounts)를 참조하세요.
- **스토리지.** GiB 단위의 할당량, 경고 및 심각 임계값, 보존(각 패키지와 채널의 최근 N개 빌드 유지, 보호 레이블, 최소 경과 기간), 자동 정리, 물리적 정리입니다. 설정을 보려면 `storage.read` 작업이, 변경하려면 `storage.manage` 작업이 필요합니다. 사람의 그룹 수준으로는 이 작업을 얻을 수 없고, 서비스 키로는 얻을 수 있습니다. 콘솔에서는 [[ui:repositoryStorage]] 버튼이 여는 [[ui:storageTitle]] 영역에 있습니다. `arkvoryctl`에서는 `storage usage`와 `storage policy`로 읽습니다. 할당량을 초과하게 되는 새 업로드는 `507 storage_quota`로 거부됩니다. [스토리지 및 보존](../operate/storage)을 참조하세요.
- **미러.** 서버 관리자는 리포지토리를 다른 서버에 있는 리포지토리의 복사본으로 만들 수 있습니다. 다음 섹션을 참조하세요.

## 읽기 전용 리포지토리 {#read-only}

**미러**는 다른 Arkvory 서버에 있는 리포지토리의 읽기 전용 복사본입니다. 서버가 스스로 동기화를 유지합니다. 읽기 권한이 있는 사람은 누구나 목록을 보고 다운로드할 수 있습니다. 아무도 변경할 수 없습니다. 업로드, 게시, 레이블 변경, 스테이지 추가, 경로 할당, 삭제는 사람의 그룹 수준이나 키의 작업과 관계없이 모두 `409 mirror_read_only`로 거부됩니다. 콘텐츠를 변경하려면 주 서버를 사용하세요.

콘솔은 미러를 카탈로그 위의 배지로 표시하고 업로드 버튼을 숨깁니다.

| 배지                 | 의미                                                     |
| -------------------- | -------------------------------------------------------- |
| [[ui:mirrorBadge]]   | 복사본이 최신 상태입니다                                 |
| [[ui:mirrorBehind]]  | 서버가 아직 따라잡는 중입니다                            |
| [[ui:mirrorFailing]] | 마지막 동기화가 실패했습니다. 다운로드는 계속 작동합니다 |

배지 옆의 [[ui:mirrorHelpLabel]] 버튼을 선택하면 원본, 마지막 동기화 시각, 오류 코드가 표시됩니다.

두 번째 종류는 **가져오기**입니다. 다른 서버의 리포지토리에서 특정 스테이지를 가진 버전을 자동으로 가져오는 일반 리포지토리입니다(예: `dev`에서 `prod`로). 배지는 [[ui:mirrorImport]]입니다. 이 리포지토리에는 계속 업로드할 수 있으며, 원본에서 이후에 변경하거나 삭제해도 이미 복사된 내용에는 영향이 없습니다.

API에서 `getRepositoryMirror`는 상태를 반환합니다. `mode`(`mirror` 또는 `import`), `phase`(`pending`, `seeding`, `following`), `caughtUp`, `syncedAt`, `errorCode`가 포함됩니다. 일반 리포지토리에는 `404`로 응답합니다.

미러는 서버 관리자가 설정합니다. [미러](../operate/mirrors)를 참조하세요. **읽기 게이트웨이**는 다른 것입니다. 같은 리포지토리에 대해 다운로드만 제공하는 주소입니다. 읽기 게이트웨이를 통한 변경은 `405 read_only`로 거부됩니다. [읽기 게이트웨이](../operate/read-gateways)를 참조하세요.

## 관련 페이지 {#related-pages}

- [계정 및 액세스](./accounts)
- [경로 기반 파일](./files) 및 [패키지](./packages)
- [스토리지 및 보존](../operate/storage)
- API 참조: [리포지토리](../api/reference/repositories), [미러](../api/reference/mirrors)
