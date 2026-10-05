---
title: UPack 패키지
description: '버전이 지정된 UPack 패키지를 게시하고, 나열·필터링하며, 정확한 버전 번호·범위·최신·스테이지로 버전을 다운로드합니다.'
---

# UPack 패키지

UPack 패키지는 이름과 SemVer 버전을 가진 ZIP 아카이브입니다. Arkvory는 각 버전을 한 번만 등록하며 절대 변경하지 않습니다. 배포 작업이 "app, 버전 `^1.4`, 스테이지 `release`"를 요청하면 정확히 하나의 파일을 받습니다.

## 패키지란 무엇인가 {#what-it-is}

UPack은 루트에 `upack.json` 파일이 있는 ZIP 파일입니다. 매니페스트가 패키지의 이름을 지정합니다:

```json
{
  "group": "acme/game",
  "name": "game-client",
  "version": "1.4.2"
}
```

| 필드      | 규칙                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------- |
| `name`    | 필수. 1~128자의 문자, 숫자, `.`, `_` 또는 `-`                                                  |
| `version` | 필수. SemVer: `1.4.2`, `1.5.0-rc.1`, `2.0.0+build.7`. 최대 128자                               |
| `group`   | 선택. 문자, 숫자, `.`, `_` 또는 `-`로 된 세그먼트를 `/`로 구분. 최대 128자. 기본값은 비어 있음 |

다른 필드는 작성한 그대로 남아 패키지 목록에 다시 나타납니다. 매니페스트는 최대 64 KiB입니다. 아카이브에는 절대 경로, `..`, 심볼릭 링크, 암호화된 항목, 중복 이름이 있어서는 안 되며, 항목은 최대 100 000개입니다. Arkvory는 아카이브를 바이트 단위 그대로 저장하며 압축을 풀지 않습니다.

패키지의 식별자는 그룹, 이름, 버전이며 대소문자를 구분하지 않고 비교합니다. 하나의 리포지토리 안에서 식별자는 영구히 하나의 아카이브에 속합니다. 기존 식별자로 다른 아카이브를 등록하면 `409 version_exists`로 거부됩니다. 같은 아카이브를 다시 등록해도 안전하며 아무것도 바뀌지 않습니다. 수정 사항은 새 버전으로 게시하세요.

## 패키지 게시 {#publish}

게시는 업로드 후 등록으로 이루어집니다. 등록은 `upack.json`을 읽고 식별자를 기록합니다. 업로드 작업 외에 `package.publish`와 `artifact.read` 작업이 필요합니다. [권한](./accounts#permissions)을 참조하세요.

### 콘솔에서 {#publish-console}

1. [[ui:upload]]에서 아카이브를 업로드합니다. [업로드와 다운로드](./transfers)를 참조하세요.
2. [[ui:open]]으로 [[ui:catalog]]에서 아티팩트를 엽니다.
3. [[ui:metadata]]에서 [[ui:register]]를 선택합니다. 콘솔은 등록한 이름과 버전을 표시합니다.

이제 패키지가 [[ui:packages]]에 나타납니다.

### arkvoryctl 사용 {#publish-cli}

```bash
arkvoryctl packages publish ./build.upack --label test --state ./job-state/build.json --json
arkvoryctl packages register 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`packages publish`는 아카이브를 재개 가능한 방식으로 업로드하고 등록합니다. 업로드 후 등록에 실패하면 오류에 `artifactId`와 스테이지 `register`가 들어 있습니다. 같은 명령을 다시 실행하세요. 업로드는 반복되지 않고, 두 번 등록해도 안전합니다. `packages register ID`는 이미 업로드된 아티팩트를 등록합니다. [명령줄](../protocols/cli#packages-and-promotion)을 참조하세요.

### HTTP API와 SDK 사용 {#publish-api}

[업로드와 다운로드](./transfers#upload-http)에서처럼 아카이브를 업로드한 뒤 등록하세요:

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/package" \
  -H "Authorization: Bearer $ARKVORY_KEY"
```

```typescript
const entry = await releases.packages.register(uploaded.id);
console.log(entry.group, entry.name, entry.version);
```

이 작업은 `registerPackage`입니다. 손상된 아카이브, `upack.json` 누락 또는 잘못된 버전은 `400 invalid_input`을 냅니다.

## 나열과 필터링 {#list}

콘솔에서 [[ui:packages]]를 엽니다. [[ui:packageGroup]] 또는 [[ui:packageName]]을 입력하세요. 둘 다 대소문자를 무시하고 정확히 일치합니다. [[ui:sortBy]]에서 열을, [[ui:direction]] ([[ui:ascending]] 또는 [[ui:descending]])에서 순서를, [[ui:groupBy]] ([[ui:packageGroup]], [[ui:packageName]] 또는 [[ui:noGrouping]])에서 그룹화를 고른 뒤 [[ui:apply]]를 선택하세요. [[ui:clearFilters]]는 양식을 초기화합니다. 표에는 그룹, 이름, 버전과 각 버전의 스테이지가 표시됩니다. [[ui:open]]은 아티팩트를 보여 줍니다. [[ui:previousPage]]와 [[ui:nextPage]]는 페이지를 이동합니다.

```bash
arkvoryctl packages list --group acme/game --name game-client
arkvoryctl packages list --after <next from the previous answer>
```

API에서 `listPackages`는 `group`, `name`, `sort`(`group`, `name` 또는 `version`), `direction`(`asc` 또는 `desc`), `groupBy`(`none`, `group` 또는 `package`), `after`, `limit`(1~100, 기본 50)을 받습니다. 응답에는 `items`(그룹, 이름, 버전, `artifactId`와 전체 매니페스트), `groups`, `next`가 있습니다. 커서는 자신이 나온 필터에 속합니다. 같은 필터와 함께만 사용하세요.

```typescript
const page = await releases.packages.list({
  name: 'game-client',
  sort: 'version',
  direction: 'desc',
});
```

나열에는 `package.read`가 필요합니다. 대신 레이블이나 메타데이터로 검색하려면 [경로 기반 파일](./files#labels)을 참조하세요.

## 버전과 범위 {#versions}

Arkvory는 SemVer 우선순위로 버전을 비교합니다. `1.10.0`이 `1.9.0`보다 최신입니다. `1.5.0-rc.1`처럼 프리릴리스 부분이 있는 버전은 `1.5.0`보다 오래된 것입니다.

선택은 패키지 `name`과, 선택적으로 다음 필터를 받습니다:

| 필터        | 의미                                                                |
| ----------- | ------------------------------------------------------------------- |
| `group`     | 그룹. 기본값은 비어 있음: 그룹이 있는 패키지는 지정할 때만 찾습니다 |
| 정확한 버전 | 버전 하나. 대소문자를 무시합니다                                    |
| 범위        | SemVer 범위                                                         |
| `stage`     | 이 스테이지를 가진 버전만([스테이지와 승격](./promotion) 참조)      |
| 프리릴리스  | 프리릴리스를 포함합니다. 기본값은 꺼짐                              |
| 순서        | `version`(기본) 또는 `promoted`                                     |

범위는 `1.2.3`, `^1.2`, `~1.2.3`, `1.x`, `>=1.0.0 <2.0.0`, `1.0.0 - 1.4.0`, `^1 || ^3`처럼 쓸 수 있습니다. 범위는 최대 256자입니다. 정확한 버전과 범위는 함께 사용할 수 없습니다.

정확한 버전이나 범위가 없으면 선택은 가장 높은 안정 버전, 즉 최신 버전을 반환합니다. 프리릴리스는 프리릴리스 필터를 켰을 때만, 또는 정확한 버전이나 범위 자체가 같은 `major.minor.patch`의 프리릴리스를 지정할 때만 선택됩니다. `order promoted`는 가장 높은 것이 아니라 마지막으로 스테이지가 부여된 버전을 고르며, 스테이지가 필요합니다. 아무것도 일치하지 않으면 서버는 `404 not_found`로 응답합니다.

## 패키지 다운로드 {#download}

무엇을 받게 되는지 먼저 보려면 확인(resolve)하고, 아니면 바로 다운로드하세요.

```bash
arkvoryctl packages resolve game-client --group acme/game --range ^1.4 --stage release
arkvoryctl packages download game-client ./game-client.upack --group acme/game --range ^1.4 --stage release
arkvoryctl packages download game-client ./game-client.upack --exact 1.4.2 --group acme/game
arkvoryctl packages download game-client ./game-client.upack --group acme/game
```

옵션은 `--group`, `--exact`, `--range`, `--stage`, `--prerelease`, `--order promoted`입니다. 정확한 버전에는 `--exact`를 사용하세요. `--version`은 클라이언트 버전을 출력하기 때문입니다. `resolve`는 그룹, 이름, 버전, `artifactId`, `sha256`, `size`, `publishedAt`, `stagedAt`와 스테이지를 출력합니다. `download`는 확인한 뒤 [업로드와 다운로드](./transfers#download-cli)에서처럼 재개와 SHA-256 검증으로 해당 아티팩트를 다운로드합니다. 클라이언트에는 `package.read`, `artifact.read`, `content.read`가 필요합니다.

HTTP에는 두 가지 작업이 있습니다. `resolvePackage`는 `package.read`가 필요하며 `resolve`와 같은 정보를 반환합니다. `downloadPackageContent`는 선택한 버전의 바이트를 보내며 `content.read`만 필요합니다. `X-Arkvory-Artifact-Id`와 `X-Arkvory-Package-Version` 헤더를 추가합니다.

```bash
curl -fL -G -H "Authorization: Bearer $ARKVORY_KEY" -o game-client.upack \
  --data-urlencode "name=game-client" --data-urlencode "group=acme/game" \
  --data-urlencode "range=^1.4" --data-urlencode "stage=release" \
  "$ARKVORY/api/v1/repositories/prod/packages/content"
```

이름 기반 주소는 요청마다 새로 확인합니다. 범위로 다운로드를 재개하면 두 호출 사이에 파일이 바뀌었을 수 있습니다. 대신 `resolve`에서 얻은 `artifactId`로 다운로드하거나, `If-Range`에 `ETag`를 보내세요.

```typescript
const found = await prod.packages.resolve({
  name: 'game-client',
  group: 'acme/game',
  range: '^1.4',
  stage: 'release',
});
const stream = await prod.artifacts.downloadVerified(found.artifactId);
```

빌드만 가져와야 하는 배포 에이전트에는 HTTP 주소용으로 `content.read`만 가진 서비스 키를, `arkvoryctl`용으로는 읽기 프리셋을 부여합니다. [CI용 서비스 계정과 키](./accounts#service-accounts)를 참조하세요.

## 레이블, 메타데이터, 첨부 파일 {#labels}

패키지 버전은 평범한 아티팩트이므로 [경로 기반 파일](./files#labels)의 모든 내용이 적용됩니다: `test`, `staging`, `release` 같은 레이블, `git.commit` 같은 텍스트 메타데이터, 컬렉션, SBOM이나 서명 같은 첨부 파일입니다. 첫 레이블은 업로드할 때 `--label test`로 지정하세요. 레이블은 아카이브를 바꾸지 않습니다. 통제된 상태가 아니라 자유 텍스트입니다. 배포가 신뢰할 수 있는 승인에는 스테이지를 사용하세요. [스테이지와 승격](./promotion)을 참조하세요.

## 오래된 버전 보존 {#retention}

리포지토리의 보존 정책이 계산하는 대상은 등록된 패키지입니다. 기본적으로 활성화하면 각 패키지와 채널의 최근 10개 빌드를 유지합니다. 채널은 레이블 `test`, `staging`, `release`입니다. 스테이지, 보호된 레이블, 파일 경로 또는 첨부 파일 링크가 있는 버전은 보존으로 절대 제거되지 않습니다. 보존은 관리자가 활성화하고 삭제에 동의하기 전까지 꺼져 있습니다. [스토리지와 보존](../operate/storage)을 참조하세요.

## 오류 {#errors}

| 응답                             | 의미                                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 등록 시 `400 invalid_input`      | 유효한 UPack ZIP이 아니거나, 루트에 `upack.json`이 없거나, 이름이나 버전이 잘못됨                                                          |
| `409 version_exists`             | 그 식별자가 이미 다른 아카이브에 속함. 새 버전을 게시하세요. 다른 바이트로 같은 버전을 가진 리포지토리로 승격해도 같은 방식으로 실패합니다 |
| 확인(resolve) 시 `404 not_found` | 필터와 일치하는 것이 없음. 그룹, 범위, 스테이지를 확인하세요                                                                               |
| `403 permission_missing`         | 키에 `package.read`, `package.publish` 또는 `content.read`가 없음                                                                          |

## 관련 페이지 {#related-pages}

- [업로드와 다운로드](./transfers)
- [스테이지와 승격](./promotion)
- [명령줄(arkvoryctl)](../protocols/cli)
- API 참조: [패키지](../api/reference/packages), [스테이지와 승격](../api/reference/promotion)
