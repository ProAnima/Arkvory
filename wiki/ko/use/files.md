---
title: 경로 기반 파일
description: '경로에 파일을 두고 전체 기록을 유지하며, 이전 리비전을 복원하고, 레이블·메타데이터·컬렉션·첨부 파일을 추가합니다.'
---

# 경로 기반 파일

경로 기반 파일은 `builds/game/1.4/GameSetup.exe`처럼 리포지토리 안에서 하나의 저장된 파일을 가리키는 이름입니다. 같은 경로에 새 콘텐츠를 두면 그 경로는 새 파일을 가리킵니다. 예전 파일은 그대로 남아 있으므로 언제든 되돌아갈 수 있습니다. 사람과 스크립트가 "현재의 Setup.exe"에 대한 안정적인 주소를 필요로 할 때 경로를 사용하세요.

## 경로란 무엇인가 {#what-it-is}

저장된 모든 파일은 ID와 SHA-256을 가진 변경 불가능한 **아티팩트**입니다. 경로는 아티팩트를 가리키는 포인터입니다. 포인터가 바뀔 때마다 1부터 번호가 매겨지는 **리비전**이 됩니다. 리비전은 삭제되거나 수정되지 않습니다.

경로는 1~1024자입니다. `/`로 구분된 세그먼트로 이루어집니다. 세그먼트는 비어 있지 않고 `.`이나 `..`이 아니며 제어 문자를 포함하지 않습니다. 경로에는 `\`나 `:`를 포함할 수 없습니다. 대소문자를 구분합니다.

경로와 패키지는 같은 아티팩트를 보는 두 가지 관점입니다. UPack 아카이브에도 경로를 지정할 수 있습니다. [UPack 패키지](./packages)를 참조하세요.

## 경로에 파일 두기 {#put}

`upload.create`, `upload.write`, `upload.complete` 작업과 `asset.read`, `asset.write`, `artifact.read` 작업이 필요합니다. 그룹 기준으로는 쓰기 액세스가 필요합니다. [권한](./accounts#permissions)을 참조하세요.

### arkvoryctl 사용 {#put-cli}

```bash
arkvoryctl put "./Build/Game Setup.exe" builds/game/1.4/GameSetup.exe
arkvoryctl put ./config.json config/settings.json --label test
arkvoryctl get builds/game/1.4/GameSetup.exe ./GameSetup.exe
```

`put`은 원본 파일 옆에 체크포인트를 두고 파일을 파트로 나누어 업로드한 뒤, 해당 경로의 다음 리비전으로 만듭니다. `path`, `revision`, 아티팩트 `id`, `created`를 출력합니다. 경로에 이미 같은 바이트가 있으면 `put`은 아무것도 업로드하지 않고 `created`를 `false`로 출력합니다. 반복되는 빌드 단계에 비용이 들지 않습니다. 업로드하는 동안 다른 사람이 경로를 변경했다면 `put`은 `revision_mismatch`(종료 코드 6)와 함께 중단되고 그 사람의 작업을 덮어쓰지 않습니다. 기록을 확인한 뒤 결정하세요. 업로드가 중단되면 같은 명령을 다시 실행하세요. [업로드와 다운로드](./transfers#resume)를 참조하세요.

`get`은 재개와 SHA-256 검증을 사용해 현재 리비전을 다운로드합니다. 경로를 나열하거나 기록을 읽는 명령은 없습니다. 그 작업에는 콘솔이나 API를 사용하세요.

### HTTP 요청 하나로 {#put-http}

원시 `PUT`은 `curl -T`처럼 한 번의 요청으로 경로에 바이트를 저장합니다:

```bash
curl -T ./GameSetup.exe -H "Authorization: Bearer $ARKVORY_KEY" \
  "$ARKVORY/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe"
```

응답에는 `path`, `revision`, `created`와 `id`, `size`, `sha256`을 담은 `artifact`가 있습니다. 새 리비전은 `201`로 응답합니다. 같은 바이트를 다시 보내면 `created`가 false인 `200`으로 응답합니다. 두 헤더는 선택 사항입니다. `X-Checksum-Sha256`은 서버가 한 번에 바이트를 확인하게 하고, `If-None-Match: *`는 경로가 이미 있으면 요청을 거부합니다. 요청 하나는 30분 안에 끝나야 합니다. 큰 파일에는 `put`을 사용하세요. [원시 파일](../protocols/raw-files)을 참조하세요.

### 콘솔에서 {#put-console}

1. [[ui:upload]]에서 파일을 업로드합니다. [업로드와 다운로드](./transfers)를 참조하세요.
2. [[ui:open]]으로 [[ui:catalog]]에서 아티팩트를 엽니다.
3. [[ui:assetTitle]]에서 [[ui:assetPath]]를 입력합니다. 예: `releases/current.upack`.
4. [[ui:currentRevision]]을 입력합니다. 새 경로이면 `0`, 아니면 [[ui:history]]에 표시된 현재 리비전을 입력합니다.
5. [[ui:assign]]을 선택합니다.

리비전 필드는 두 사람이 동시에 경로를 변경하는 것을 막습니다. 현재 리비전이 아니면 서버는 충돌로 거부합니다. 기록을 다시 불러온 뒤 재시도하세요.

### API와 SDK 사용 {#put-api}

`setAsset`은 이미 업로드한 아티팩트를 경로가 가리키게 합니다. `expectedRevision`은 경로를 만들 때는 `0`, 그 외에는 현재 리비전입니다.

```bash
curl -X PUT "$ARKVORY/api/v1/repositories/releases/asset" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"path":"builds/game/1.4/GameSetup.exe","artifactId":"3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11","expectedRevision":0}'
```

```typescript
const current = await releases.assets.get('builds/game/1.4/GameSetup.exe');
await releases.assets.assign('builds/game/1.4/GameSetup.exe', artifactId, current.revision);
```

충돌은 `409 revision_mismatch`로 응답합니다. 추측한 리비전으로 재시도하지 마세요. 응답이 유실되면 경로를 읽어 보세요. 새 아티팩트가 이미 있으면 끝난 것입니다.

## 경로 읽기 {#read}

- `arkvoryctl get PATH OUTPUT`은 현재 파일을 다운로드합니다.
- `GET /api/v1/repositories/<repository>/raw/<path>`와 `GET /api/v1/repositories/<repository>/asset/content?path=<path>`는 바이트를 반환합니다. 둘 다 `content.read`가 필요하며 범위와 ETag를 지원합니다.
- `getAsset`(`GET …/asset?path=`)은 포인터를 반환합니다: `path`, `revision`, `artifactId`.
- `listAssetPage`(`GET …/assets/page?prefix=`)는 포인터를 나열합니다. 페이지는 UTF-8 경로의 바이트 순서로 최대 100개(기본 50개)를 담습니다. 접두사는 리터럴이며 대소문자를 구분합니다. `next`를 `after`로 전달하세요. 예전 `listAssets`는 최대 1000개를 반환하며 접두사를 더 좁히도록 요구합니다.

```typescript
const page = await releases.assets.list({ prefix: 'builds/game/', limit: 100 });
```

## 리비전과 기록 {#history}

콘솔에서 [[ui:history]]를 열고 [[ui:assetPath]]에 경로를 입력한 뒤 [[ui:historyLoad]]를 선택하세요. 표에는 [[ui:revision]], 시각([[ui:date]]), 작성자([[ui:actor]])와, 복원된 리비전의 경우 그 원본 리비전([[ui:source]])이 표시됩니다. 최신이 먼저입니다. [[ui:historyMore]]는 오래된 항목을 한 번에 50개씩 불러옵니다. 행의 [[ui:open]]은 해당 리비전의 아티팩트를 열며, 여기서 원본 콘텐츠를 다운로드할 수 있습니다.

API에서는 `getAssetHistory`(`…/asset/history?path=&before=`)가 페이지를 최신순으로 반환하며, `before`는 이전 페이지의 마지막 리비전입니다. `getAssetRevision`(`…/asset/revision?path=&revision=`)은 리비전 하나를 반환합니다. 기록이 이 정보를 남기기 전에 작성된 리비전은 작성자와 시각이 비어 있습니다. 읽기에는 `asset.read`가 필요합니다.

## 이전 리비전 복원 {#restore}

복원은 경로가 이전 리비전의 아티팩트를 가리키게 합니다. 바이트를 복사하지 않고 리비전을 삭제하지도 않습니다. 복원은 새로운 최신 리비전이며, 기록은 그 원본이 어디인지 보여 줍니다.

콘솔에서 기록을 불러오고 원하는 리비전의 복원 버튼을 선택하세요. 현재 리비전의 버튼은 비활성화되어 있습니다. 복원에는 `asset.restore`, `asset.read`, `artifact.read`가 필요합니다.

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/asset/restore" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"path":"builds/game/1.4/GameSetup.exe","sourceRevision":3,"expectedRevision":5}'
```

```typescript
await releases.assets.restore('builds/game/1.4/GameSetup.exe', 3, 5);
```

`expectedRevision`은 마지막으로 확인한 리비전입니다. 그사이 경로가 변경되었다면 서버는 `409 revision_mismatch`로 응답합니다. 콘솔은 메시지를 표시하고 기록을 다시 불러오도록 요청합니다. 복원은 예전 레이블이나 메타데이터를 되살리지 않습니다. 그것들은 지금 상태 그대로 유지됩니다.

## 레이블, 메타데이터, 컬렉션 {#labels}

모든 아티팩트는 세 가지 주석을 지닙니다. 언제든 변경할 수 있습니다. 파일 자체는 바뀌지 않습니다.

| 종류       | 예                                             | 규칙                                                                                                                        |
| ---------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 레이블     | `test`, `staging`, `release`, `linux`          | 최대 32개. 각각 1~64자의 문자, 숫자, `_`, `.`, `:` 또는 `-`. 대소문자를 구분합니다                                          |
| 메타데이터 | `build.number` = `42`, `git.commit` = `abc123` | 최대 32개의 텍스트 필드. 키는 문자로 시작하고 1~64자의 문자, 숫자, `_`, `.` 또는 `-`로 이루어집니다. 값은 최대 1024자입니다 |
| 컬렉션     | `desktop`, `nightly`                           | 최대 32개. 레이블과 같은 규칙입니다. 버전이나 경로에 관계없이 아티팩트를 묶습니다                                           |

레이블은 자유 텍스트입니다. 액세스 권한을 부여하지 않으며 파일을 이동시키지도 않습니다. 콘솔은 [[ui:labelPresets]] (`nightly`, `test`, `staging`, `release`)를 제안하지만 어떤 레이블이든 유효하며, `relase`도 바로잡지 않습니다. 배포가 의존하는 승인에는 스테이지를 사용하세요([스테이지와 승격](./promotion)).

**콘솔.** [[ui:metadata]]에서 아티팩트를 엽니다. [[ui:labels]]와 [[ui:collections]]를 쉼표로 구분해 입력하세요. [[ui:metadataFields]]에 필드를 추가하려면 [[ui:metadataAdd]]를 사용하세요: [[ui:metadataKey]]와 [[ui:metadataValue]]입니다. [[ui:metadataJson]]은 같은 데이터를 JSON으로 편집합니다. [[ui:save]]를 선택하세요.

**arkvoryctl.** 업로드할 때 `--label test`는 레이블 하나를 추가하고, `--file metadata.json`은 `labels`와 `metadata`를 지정합니다:

```json
{ "labels": ["test"], "metadata": { "build.number": "42", "git.commit": "abc123" } }
```

기존 아티팩트를 변경하려면 먼저 읽은 뒤, 읽은 리비전과 함께 전체 새 상태를 보내세요:

```bash
arkvoryctl annotations get 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl annotations set 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --revision 3 --file annotations.json
```

`annotations.json`에는 `labels`, `metadata`, `collections` 세 키가 모두 있어야 합니다. 빠뜨린 항목은 비어 있게 됩니다. 저장은 전체 집합을 교체합니다. 다른 사람이 먼저 저장했다면 서버는 `409 revision_mismatch`로 응답합니다. 다시 읽고 결정하세요. SDK는 그러한 저장을 반복하지 않습니다.

```typescript
const current = await releases.annotations.get(id);
await releases.annotations.update(id, current.revision, {
  labels: [...current.labels, 'release'],
  metadata: current.metadata,
  collections: current.collections,
});
```

읽으려면 `annotation.read`가, 쓰려면 `annotation.write`와 `artifact.read`가 필요합니다.

**검색.** [[ui:catalog]]에서 [[ui:search]]에 텍스트를 입력하세요. 파일 이름과 메타데이터 값을 대소문자 구분 없이 일치시킵니다. [[ui:labelFilter]]는 레이블 하나를 표시합니다. [[ui:metadataFilter]]는 키와 값을 대소문자를 포함해 정확히 일치시킵니다. `arkvoryctl`에서는:

```bash
arkvoryctl search --query game --label release
arkvoryctl search --collection nightly
arkvoryctl search --metadata-key git.commit --metadata-value abc123
```

`--metadata-key`와 `--metadata-value`는 함께 사용합니다. 페이지는 최대 100개의 결과를 담습니다. `next`를 `--after`로 전달하세요. 필터는 AND로 결합됩니다.

## 첨부 파일 {#attachments}

첨부 파일은 매니페스트, SBOM, 서명, 보고서 또는 임의의 파일을 빌드에 연결합니다. 첨부 파일은 이름과 같은 리포지토리의 다른 아티팩트로의 링크입니다. 빌드와 첨부 파일은 별개의 파일로 남습니다.

| 규칙   | 값                                                                                            |
| ------ | --------------------------------------------------------------------------------------------- |
| 종류   | `manifest`, `sbom`, `signature`, `report`, `file`                                             |
| 빌드당 | 최대 32개                                                                                     |
| 이름   | 1~240자, 빌드 안에서 고유(대소문자 무시), `/`, `\`, 제어 문자 또는 양끝 공백을 포함할 수 없음 |
| 설명   | 최대 512자, 비어 있을 수 있음                                                                 |
| 대상   | 같은 리포지토리의 게시된 아티팩트. 빌드 자체는 안 됨                                          |

종류는 파일의 용도만 나타냅니다. Arkvory는 서명을 검증하지 않고, SBOM을 읽지 않으며, 매니페스트를 실행하지 않습니다.

콘솔에서 아티팩트를 엽니다. [[ui:attachmentsTitle]] 아래에서 [[ui:attachmentAdd]] 양식을 펼치세요. [[ui:attachmentSource]]를 선택합니다. [[ui:attachmentUpload]]는 새 파일을 보내고 연결하며, [[ui:attachmentExisting]]은 이미 게시된 아티팩트를 연결합니다. [[ui:attachmentKind]]를 선택합니다: [[ui:attachmentManifest]], [[ui:attachmentSbom]], [[ui:attachmentSignature]], [[ui:attachmentReport]] 또는 [[ui:attachmentFile]]. [[ui:attachmentName]]을 지정하고, 원하면 [[ui:attachmentDescription]]도 지정합니다. 그런 다음 [[ui:attachmentAdd]]를 선택하세요. [[ui:attachmentUnlink]]는 링크를 제거하고 파일은 유지합니다. [[ui:attachmentReload]]는 목록을 다시 읽습니다. 첨부 파일 업로드가 중단되면 [[ui:attachmentRecovery]]가 이어서 진행할 업로드 ID를 보여 줍니다.

목록이 바뀔 때마다 번호가 매겨진 버전이 됩니다. [[ui:attachmentHistory]]는 이전 버전을 보여 주고, [[ui:attachmentRestore]]는 그중 하나를 새 버전으로 되돌립니다.

`arkvoryctl`에서는 파일이 전체 목록을 JSON 배열로 담습니다:

```json
[
  {
    "name": "build.json",
    "kind": "manifest",
    "artifactId": "64b42380-902d-41cf-9151-10c12e4809dc",
    "description": "Build provenance from CI"
  }
]
```

```bash
arkvoryctl attachments get 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl attachments set 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --revision 0 --file attachments.json
arkvoryctl attachments history 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`--revision`은 `get`으로 읽은 번호이며, 새 빌드는 `0`입니다. API에서는 `replaceBuildAttachments`가 `expectedRevision`과 `items`를 받고, `getBuildAttachments`와 `getBuildAttachmentHistory`가 읽습니다. 첨부 파일을 다운로드하려면 일반 다운로드에 링크의 `artifactId`를 사용하세요. 읽기에는 `annotation.read`, 변경에는 `annotation.write`와 `artifact.read`가 필요하며, 첨부 파일 업로드에는 업로드 작업들이 필요합니다.

첨부 파일과 경로는 다른 리포지토리로의 승격과 함께 이동하지 않습니다. [스테이지와 승격](./promotion)을 참조하세요.

## 관련 페이지 {#related-pages}

- [원시 파일](../protocols/raw-files)
- [업로드와 다운로드](./transfers)와 [UPack 패키지](./packages)
- [명령줄(arkvoryctl)](../protocols/cli)
- API 참조: [경로 기반 파일](../api/reference/files), [아티팩트와 카탈로그](../api/reference/artifacts), [빌드 첨부 파일](../api/reference/attachments)
