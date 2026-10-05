---
title: 업로드 및 다운로드
description: 크기와 관계없는 파일을 보내고 가져오며, 중단된 뒤에도 이어서 진행하고, 체크섬을 확인하며, 키 없이 파일을 공유합니다.
---

# 업로드 및 다운로드

크기와 관계없는 파일이 파트로 나뉘어 Arkvory로 전송되며, 중단된 전송은 중단된 지점부터 이어서 진행할 수 있습니다. 이 페이지에서는 콘솔, `arkvoryctl`, SDK, HTTP API에서 이를 수행하는 방법을 설명합니다.

업로드에는 `upload.create`, `upload.read`, `upload.write`, `upload.complete` 작업이 필요합니다. 그룹 기준으로는 쓰기 액세스가 필요합니다. 다운로드에는 `content.read`가 필요합니다. [권한](./accounts#permissions)을 참조하세요.

## 파일 업로드 {#upload}

모든 업로드는 같은 단계를 거칩니다. 클라이언트가 파일 전체의 SHA-256을 계산하고 파일 이름, 크기, 체크섬과 함께 업로드 세션을 시작합니다. 파일을 파트로 나누어 전송합니다. 모든 파트가 도착하면 서버가 이를 조립하고, 체크섬을 확인한 다음 파일을 변경 불가능한 아티팩트로 게시합니다.

### 콘솔에서 {#upload-console}

1. 사이드바에서 [[ui:upload]]를 선택하거나, 상단 바에서 [[ui:uploadFile]]를 선택합니다.
2. [[ui:chooseFile]]에서 파일을 선택합니다. 콘솔이 체크섬을 계산하기 위해 파일 전체를 한 번 읽습니다([[ui:hashing]]). 수십 GB의 파일이라면 첫 바이트를 보내기까지 시간이 걸립니다.
3. [[ui:startUpload]]를 선택합니다. [[ui:transferTitle]] 아래의 막대가 진행률을 표시합니다.
4. 파일이 게시되면 ID가 표시됩니다. [[ui:catalog]]를 열어 확인하세요.

[[ui:pause]]는 전송을 중지하고 도착한 파트를 보관합니다. 업로드 중에 페이지를 떠나려 하면 브라우저가 경고합니다. 콘솔은 파일과 함께 레이블이나 메타데이터를 보내지 않습니다. 나중에 [[ui:metadata]]에서 추가하세요. [경로 기반 파일](./files#labels)을 참조하세요.

### arkvoryctl 사용 {#upload-cli}

```bash
arkvoryctl upload ./Build/Game.zip --label test
arkvoryctl upload ./Build/Game.zip --file metadata.json --state ./job-state/game.json
arkvoryctl uploads status 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl uploads cancel 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`upload`는 파일이 게시되면 아티팩트를 출력합니다. `--label`은 레이블 하나를 추가합니다. `--file`은 `labels`와 `metadata`가 담긴 JSON 파일을 가리키며 우선합니다. 파일을 경로에 저장하려면 `put`을, UPack을 게시하려면 `packages publish`를 사용하세요. [명령줄](../protocols/cli#transfers)을 참조하세요.

### SDK 사용 {#upload-sdk}

```typescript
const session = await releases.uploads.create(idempotencyKey, {
  name: 'Game.zip',
  size: String(file.size),
  sha256,
  labels: ['test'],
  metadata: { commit: 'abc123' },
});
const artifact = await releases.uploads.resume(session.id, file, {
  onProgress: (bytes) => console.log(bytes),
});
```

`resume`은 서버에 없는 파트를 보내고 업로드를 완료합니다. Node.js에서 해싱하는 전체 예제는 [TypeScript SDK](../protocols/sdk#upload-a-large-file-with-resume-node-js)에 있습니다.

### HTTP API 사용 {#upload-http}

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/uploads" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Idempotency-Key: game-1234" \
  -H "Content-Type: application/json" \
  -d '{"name":"Game.zip","size":"73400320","sha256":"<64 hex digits>"}'

curl "$ARKVORY/api/v1/repositories/releases/uploads/$ID/parts" -H "Authorization: Bearer $ARKVORY_KEY"

curl -X PUT "$ARKVORY/api/v1/repositories/releases/uploads/$ID/parts/0" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/octet-stream" \
  -H "X-Content-SHA256: <64 hex digits of this part>" --data-binary @part-0.bin

curl -X POST "$ARKVORY/api/v1/repositories/releases/uploads/$ID/complete" \
  -H "Authorization: Bearer $ARKVORY_KEY"
```

크기는 10진수 문자열입니다. `Idempotency-Key`는 1~128자이며 영문자, 숫자, `.`, `_`, `:` 또는 `-`를 사용합니다. 첫 번째 호출의 응답에는 업로드 `id`와 `expiresAt`이 있습니다. 두 번째 호출은 파트 크기 `partBytes`와 이미 저장된 파트를 반환합니다. 마지막 파트를 제외한 모든 파트는 정확히 그 크기입니다. 작업은 `createUpload`, `listUploadParts`, `putUploadPart`, `completeUpload`입니다([업로드](../api/reference/uploads)).

작은 파일에는 두 가지 더 간단한 방법을 사용할 수 있습니다. `PUT /uploads/{id}/content`는 파일 전체를 한 요청으로 보냅니다. `PUT /raw/<path>`는 세션을 만들고, 바이트를 보내고, `curl -T`처럼 한 요청으로 경로에 저장합니다. 두 요청 모두 30분 이내에 끝나야 합니다. 크거나 느린 파일에는 파트를 사용하세요. [원시 파일](../protocols/raw-files)을 참조하세요. 빈 파일은 한 요청으로 전송됩니다.

## 파일 크기 제한 {#limits}

| 제한             | 값                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 파트 크기        | 약 78 GiB 이하 파일에는 8 MiB. 더 큰 파일은 16, 32, 64 MiB 등을 사용하며 최대 1 GiB까지이므로, 파일에 10 000개를 초과하는 파트가 필요하지 않습니다. |
| 업로드당 파트 수 | 10 000개(인덱스 0~9999)                                                                                                                             |
| 최대 파일 크기   | 1 GiB 파트 10 000개, 약 10 TiB                                                                                                                      |
| 더 낮은 상한     | 관리자가 `ARKVORY_MAX_OBJECT_BYTES`로 설정할 수 있습니다                                                                                            |
| 파일 이름        | 1~240자, `/`, `\` 또는 제어 문자를 포함할 수 없습니다                                                                                               |

서버는 업로드가 생성될 때 파트 크기를 선택하고 업로드 전체 동안 유지합니다. `GET /api/v1/capabilities`는 `maxObjectBytes`, `partBytes`, `maxPartBytes`, `maxParts`를 표시합니다. 콘솔은 서버 한도를 초과하는 파일을 시작하기 전에 거부합니다.

클라이언트는 파트를 해싱하고 전송하는 동안 메모리에 한 파트를 보관합니다. 78 GiB를 초과하는 파일에서는 파트가, 따라서 메모리가 최대 1 GiB까지 커집니다.

서버의 여유 디스크 공간은 한동안 파트와 조립된 파일을 보관할 수 있어야 합니다. 디스크가 가득 차면 서버가 `507 storage_full`로 업로드를 거부합니다.

## 업로드 재개 {#resume}

업로드 세션은 실패 후에도 파트를 유지합니다. 계속하려면 클라이언트에 같은 파일과 같은 세션을 제공하세요.

**콘솔.** 열려 있는 탭에서는 [[ui:pause]] 후 [[ui:startUpload]]를 다시 선택합니다. 탭을 닫은 뒤에는 업로드 ID를 보관하세요. [[ui:resumeTitle]]을 펼치세요: [[ui:uploadId]] 필드는 업로드가 실행되는 동안 ID를 표시합니다. 나중에 같은 파일을 선택하고 그곳에 ID를 입력한 다음 [[ui:startUpload]]를 선택하세요. 콘솔이 파트를 파일과 비교합니다. 파일이 다르면 중지하고 알려 줍니다. [[ui:newUpload]]는 두 필드를 지우고 새 업로드를 시작합니다.

[[ui:idempotency]] 필드는 두 번째 복귀 수단입니다. 콘솔이 스스로 채웁니다. 같은 파일에 같은 키를 사용하면 두 번째 세션이 아니라 같은 세션을 반환합니다.

**arkvoryctl.** 같은 옵션으로 같은 명령을 실행하세요. 클라이언트는 첫 요청 전에 원본 파일 옆에, 또는 `--state`로 지정한 파일에 체크포인트 `<file>.arkvory-upload.json`을 저장했습니다. 같은 바이트를 새 아티팩트로 게시하려면 새 `--state`를 사용하세요. CI에서는 재시도하는 동안 원본 파일과 상태 폴더를 유지하세요. 파일, 서버, 리포지토리 또는 옵션이 바뀌면 `checkpoint_mismatch`(종료 코드 6)가 발생합니다.

**SDK.** 저장한 세션 ID와 같은 파일로 `resume`을 다시 호출하세요. `create`의 응답조차 유실된 경우를 복구하려면 같은 멱등성 키와 같은 설명자로 `create`를 호출하세요: 같은 세션을 반환합니다.

**HTTP.** `listUploadParts`로 저장된 파트를 읽은 다음 누락된 인덱스를 보내세요. 같은 바이트로 파트를 다시 보내는 것은 안전합니다. 저장된 인덱스에 다른 바이트를 보내면 `409 upload_state`로 거부됩니다.

클라이언트는 네트워크 장애 후 또는 `408`, `429`, `502`, `503`, `504` 후에 요청을 스스로 반복하기도 합니다: 작업 하나에 최대 20회이며, 0.5초에서 60초까지 늘어나는 대기 시간을 두고 `Retry-After`를 존중합니다. `arkvoryctl`에는 느린 연결을 위한 `--retries`와 `--attempt-timeout` 옵션이 있습니다.

업로드를 만든 계정이나 키만이 업로드를 계속할 수 있습니다. 다른 사람에게는 존재하지 않습니다. 서비스 키를 교체해도 계정은 유지되므로 새 키가 업로드를 계속합니다.

## 체크섬 {#checksums}

- **업로드 전.** 콘솔, CLI, SDK가 파일의 SHA-256을 계산하여 세션에 보냅니다.
- **각 파트.** `X-Content-SHA256` 헤더에 파트의 체크섬이 있습니다. 바이트가 일치하지 않는 파트는 `422 integrity_mismatch`로 거부되며 저장되지 않습니다.
- **마지막.** 서버는 게시하기 전에 조립된 파일의 크기와 SHA-256을 세션과 대조하여 확인합니다. 불일치하면 `422 integrity_mismatch`이며, CLI는 코드 5로 종료됩니다. 아티팩트는 나타나지 않습니다.
- **다운로드.** 콘솔, CLI, SDK는 파일을 넘겨주기 전에 파일 전체의 SHA-256을 확인합니다. 최종 파일은 확인을 통과한 뒤에만 나타납니다.

파일의 ETag는 체크섬입니다: `"sha256:<64 hex digits>"`. 아티팩트 세부 정보에 SHA-256이 표시되며 [[ui:copyHash]]가 이를 복사합니다.

## 완료 작업 {#completion}

큰 파일을 조립하는 데는 시간이 걸립니다. 16 GiB 미만 파일은 `completeUpload`가 요청 안에서 조립하며, 최대 30분이 걸릴 수 있습니다. 16 GiB 이상이면 SDK가, 따라서 콘솔과 CLI가, 워커에 완료를 요청합니다: `enqueueCompletion`이 작업과 함께 `202`로 응답하고, 클라이언트는 상태가 `completed` 또는 `failed`가 될 때까지 `getCompletionJob`을 폴링합니다. 실패한 작업에는 오류 코드가 있습니다(예: `integrity_mismatch`).

작업을 처리하려면 워커 서비스가 실행 중이어야 합니다. 워커는 늘어나는 대기 시간을 두고 작업을 최대 5회 시도하며, 재시도로 해결할 수 없는 오류에는 즉시 포기합니다. `enqueueCompletion`을 반복하면 같은 작업이 반환됩니다. 서버가 다시 시작되면 작업은 계속됩니다. 업로드를 다시 시작할 필요가 없습니다.

## 업로드 만료 {#expiry}

완료되지 않은 업로드 세션은 생성된 지 7일 후에 만료됩니다. 시각은 `expiresAt`에 있으며 연장되지 않고, 파트를 보내도 바뀌지 않습니다. 그 이후에는 파트와 `complete`가 `409 upload_expired`로 거부됩니다. 새 업로드를 시작하세요. 게시된 파일은 만료되지 않습니다.

서버는 백그라운드에서 만료된 세션과 그 파트를 제거합니다. 더 일찍 포기하려면 `arkvoryctl uploads cancel ID` 또는 `cancelUpload`를 사용하세요. 취소는 일시 중지가 아닙니다: 파트가 폐기됩니다.

## 파일 다운로드 {#download}

### 콘솔에서 {#download-console}

[[ui:catalog]]의 파일 옆이나 아티팩트 세부 정보에서 [[ui:download]]를 선택합니다. 브라우저가 파일을 저장할 위치를 묻습니다. 파일은 [[ui:downloads]]의 대기열로 들어갑니다. 대기열은 데이터를 임시 복사본에 쓰고, SHA-256을 확인한 다음에야 대상 파일을 교체합니다.

대기열은 브라우저의 파일 시스템 액세스를 통해 큰 파일을 쓰기 때문에 HTTPS 또는 로컬 컴퓨터에서 Chrome이나 Edge가 필요합니다. 다른 브라우저는 CLI 또는 SDK를 사용해야 합니다.

다운로드의 상태는 [[ui:downloadQueued]], [[ui:downloadRunning]], [[ui:downloadRetrying]], [[ui:downloadPaused]], [[ui:downloadSaving]], [[ui:downloadCompleted]], [[ui:downloadFailed]], [[ui:downloadCancelled]]입니다. 버튼은 다음과 같습니다:

| 버튼                                           | 효과                                                         |
| ---------------------------------------------- | ------------------------------------------------------------ |
| [[ui:downloadResume]]                          | 저장된 파트부터 일시 중지되거나 실패한 다운로드를 계속합니다 |
| [[ui:downloadCancel]]                          | 다운로드 하나를 취소하고 임시 복사본을 삭제합니다            |
| [[ui:downloadsPause]] / [[ui:downloadsResume]] | 대기열 전체를 일시 중지하고 다시 시작합니다                  |
| [[ui:downloadsClearWaiting]]                   | 대기 중인 다운로드를 취소합니다                              |
| [[ui:downloadsCancel]]                         | 모든 다운로드를 취소합니다                                   |
| [[ui:downloadsClearFinished]]                  | 완료된 행을 제거하여 공간을 확보합니다(대기열은 64개를 보관) |
| [[ui:downloadRestore]]                         | 페이지를 새로 고친 뒤 완료되지 않은 다운로드를 복원합니다    |

[[ui:downloadSettings]]에는 [[ui:downloadConcurrency]] (1~8, 기본값 2), [[ui:downloadInterval]] (0~60 000 ms, 기본값 250), [[ui:downloadWait]] (1~1800초, 기본값 300)이 있습니다. 이를 적용하려면 [[ui:downloadApply]]를 선택하세요. 이 설정은 서버 한도를 높이지 않습니다.

새로 고침하거나 탭을 닫은 뒤에는 같은 서버에 같은 계정으로 다시 로그인하고, [[ui:downloads]]를 열고 [[ui:downloadRestore]]를 선택하세요. 복원된 다운로드는 일시 중지 상태로 대기합니다. 각각에서 [[ui:downloadResume]]를 선택하고 대상 파일을 다시 선택하세요. 브라우저에는 임시 복사본을 위한 여유 공간이 필요합니다.

### arkvoryctl 사용 {#download-cli}

```bash
arkvoryctl download 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game.zip
arkvoryctl get builds/game/1.4/Game.zip ./Game.zip
arkvoryctl packages download app ./app.upack --range ^1.4 --stage release
```

다운로드가 실행되는 동안 `<output>.arkvory-part`와 `<output>.arkvory-download.json`이 대상 옆에 남습니다. 중단 후 같은 명령을 다시 실행하세요. 최종 파일은 SHA-256 확인 후에만 나타납니다. 이미 있는 대상은 절대 덮어쓰지 않습니다(`destination_exists`, 종료 코드 6).

### HTTP 사용: 범위와 ETag {#download-http}

`downloadArtifact`는 아티팩트의 바이트를 반환합니다. `HEAD`는 헤더만 반환합니다.

```bash
curl -fL -H "Authorization: Bearer $ARKVORY_KEY" -C - -o Game.zip \
  "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/content"
```

- `Accept-Ranges: bytes`. 하나의 범위에 대해 `Range: bytes=1048576-`, `bytes=0-1023` 또는 `bytes=-500`을 보냅니다. 응답은 `Content-Range`가 포함된 `206`입니다. 한 번에 여러 범위는 지원되지 않습니다: 서버가 파일 전체를 보냅니다. 끝을 넘어선 시작은 `416`을 반환합니다.
- `ETag`는 `"sha256:<hex>"`입니다. 이를 사용한 `If-None-Match`는 `304`를 반환합니다. 이를 사용한 `If-Range`는 파일이 여전히 같을 때만 범위를 이어서 받으며, 그렇지 않으면 파일 전체가 전송됩니다.
- `curl -C -`는 다운로드를 재개합니다. 이름 기반 주소는 요청할 때마다 확인됩니다. 예를 들어 `packages/content?name=app&range=^1.4`이며, 따라서 두 호출 사이에 파일이 바뀔 수 있습니다. 안전하게 재개하려면 받은 ETag를 `If-Range`로 보내거나, 이름을 먼저 확인한 다음 아티팩트 ID로 다운로드하세요.

SDK는 콘텐츠를 8 MiB 범위로 읽고 각 범위를 검증합니다. [TypeScript SDK](../protocols/sdk#download-with-verification)를 참조하세요.

## 키가 없는 사람을 위한 링크 {#links}

다운로드 링크를 사용하면 어떤 키도 없이 파일 하나를 가져올 수 있습니다: 테스터, 고객, 자격 증명이 없는 빌드 머신 등입니다. 링크는 만료될 때까지 해당 아티팩트만 `GET`과 `HEAD`로 열어 줍니다. `curl -C -`와 범위 요청에서 작동합니다.

콘솔에서 [[ui:metadata]]에서 아티팩트를 열고 [[ui:downloadLink]]를 선택합니다. 콘솔이 링크를 복사하고 만료 시각과 함께 표시합니다. 링크는 1시간 동안 유효합니다. 파일을 다운로드할 수 있는 경우에만 버튼이 나타납니다.

```bash
arkvoryctl link 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --ttl 900
```

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/links" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"ttlSeconds":900}'
```

유효 기간은 60초에서 24시간(86 400초)이며 기본값은 1시간입니다. 응답에는 `dtl_`로 시작하는 `token`, `url`, `expiresAt`이 있습니다. CLI와 SDK는 완전한 URL을 출력합니다. API는 경로를 반환하며, 이 경로를 서버 주소에 추가하세요.

링크는 시크릿입니다. 링크를 가진 사람은 누구나 파일을 다운로드할 수 있습니다. 만료되기 전에는 링크를 폐기할 수 없으므로 짧게 만드세요. URL을 키처럼 취급하세요: 채팅방과 공개 로그에 남기지 마세요. 프록시 로그와 브라우저 기록에 기록될 수 있습니다. [다운로드 링크](../api/reference/links)를 참조하세요.

## 한도와 대기열 {#queues}

관리자는 서버가 동시에 실행하는 전송 수와 속도를 설정합니다. 기본적으로 서버는 업로드 2개와 다운로드 16개를 동시에 실행하고, 계정 하나는 업로드 1개와 다운로드 4개를 실행합니다. 그 이상은 최대 20초 동안 대기열에서 기다립니다. 대기열이 가득 차거나 대기 시간이 끝나면 서버가 `Retry-After`와 함께 `503`으로 응답하고, 클라이언트는 기다렸다가 재시도합니다. 초당 바이트 예산이 설정되면 전송이 느려질 뿐 중단되지는 않습니다. 사용자는 이 예산을 보고 변경할 수 없습니다. 값은 [환경 변수](../reference/environment#transfers-and-bandwidth)에 있습니다.

## 오류 {#errors}

| 응답                       | 원인                                                                          | 해결 방법                                                 |
| -------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------- |
| `409 upload_expired`       | 세션이 7일보다 오래되었습니다                                                 | 새 업로드를 시작합니다                                    |
| `409 upload_state`         | 업로드가 이미 게시되었거나 취소되었거나, 저장된 파트에 다른 바이트가 있습니다 | 새 업로드를 시작하거나, 같은 파일을 사용하는지 확인합니다 |
| `409 parts_incomplete`     | 일부 파트가 도착하지 않았습니다                                               | 업로드를 재개합니다                                       |
| `409 part_mismatch`        | 파트가 계획된 파트 크기나 인덱스와 일치하지 않습니다                          | `listUploadParts`에서 파트 크기를 가져와 재개합니다       |
| `409 idempotency_mismatch` | 키가 다른 파일에 사용되었습니다                                               | 새 키를 사용합니다                                        |
| `422 integrity_mismatch`   | 체크섬이 일치하지 않습니다                                                    | 원본 파일을 다시 보냅니다                                 |
| `507 storage_quota`        | 리포지토리 할당량이 모두 사용되었습니다                                       | 오래된 빌드를 삭제하거나 더 큰 할당량을 요청합니다        |
| `507 storage_full`         | 서버 디스크가 가득 찼습니다                                                   | 관리자에게 문의합니다                                     |
| `503`와 `Retry-After`      | 서버가 사용 중입니다                                                          | 기다리세요, 클라이언트가 스스로 재시도합니다              |

전체 목록은 [오류](../api/errors)에 있습니다.

## 관련 페이지 {#related-pages}

- [명령줄(arkvoryctl)](../protocols/cli) 및 [TypeScript SDK](../protocols/sdk)
- [경로 기반 파일](./files) 및 [패키지](./packages)
- API 참조: [업로드](../api/reference/uploads), [다운로드 링크](../api/reference/links), [아티팩트](../api/reference/artifacts)
