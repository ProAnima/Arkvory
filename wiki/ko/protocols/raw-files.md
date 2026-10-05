---
title: 원시 파일
description: curl, wget 또는 PowerShell로 HTTP 요청 한 번으로 경로를 통해 파일을 저장하고 읽습니다. 아무것도 설치하지 않아도 됩니다.
---

# 원시 파일

리포지토리의 파일 경로는 웹 서버의 파일처럼 동작합니다. `PUT`은 본문을 경로의 다음 버전으로 저장합니다. `GET`은 현재 버전을 반환합니다. `curl`이나 PowerShell만 있고 다른 도구가 없는 빌드 스크립트와 CI 작업에서 사용하세요.

주소는 세 가지 메서드 모두 같습니다:

```text
https://<host>/api/v1/repositories/<repository>/raw/<path>
```

예: `https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe`.

## 파일 저장 {#store-a-file}

리포지토리와 쓰기 액세스가 있는 키가 필요합니다. [계정 및 키](../use/accounts)를 참조하세요. 키를 `Authorization: Bearer <key>`로 보내세요. 원시 파일은 다른 종류의 인증을 받지 않습니다.

```bash
export ARKVORY_KEY="$(cat ~/.arkvory/key)"
URL="https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe"

curl --fail-with-body -sS -T ./GameSetup.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  "$URL"
```

```powershell
$headers = @{ Authorization = "Bearer $env:ARKVORY_KEY" }
$url = 'https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe'
Invoke-RestMethod -Method Put -InFile .\GameSetup.exe -Headers $headers -Uri $url
```

```bash
wget -qO- --method=PUT --body-file=GameSetup.exe \
  --header="Authorization: Bearer $ARKVORY_KEY" "$URL"
```

`curl -T`에는 폴더가 아니라 파일의 전체 주소를 주세요. URL이 허용하지 않는 문자는 경로에서 인코딩하세요. 공백은 `%20`, `#`은 `%23`, `?`는 `%3F`로 씁니다.

응답은 JSON입니다. 새 파일이나 새 바이트는 `201`을 반환합니다:

```json
{
  "path": "builds/game/1.4/GameSetup.exe",
  "revision": 1,
  "created": true,
  "artifact": { "id": "00000000-0000-4000-8000-000000000001", "size": "1048576", "sha256": "…" }
}
```

경로에 이미 정확히 이 바이트가 있으면 `"created": false`와 같은 리비전으로 `200`을 반환합니다. 아무것도 저장되지 않습니다. CI 작업의 한 단계는 새 버전을 만들지 않고 다시 실행할 수 있습니다. `size`는 십진수 문자열입니다.

### 체크섬 보내기 {#send-a-checksum}

`X-Checksum-Sha256`으로 파일의 SHA-256을, `Content-Length`로 길이를 보내세요. `curl -T`와 PowerShell은 파일의 길이를 보냅니다. 그러면 서버는 바이트를 한 번에 스토리지에 직접 쓰고 그곳에서 검사합니다. 잘못된 체크섬은 `integrity_mismatch` 코드와 함께 `422`를 반환하고, 아무것도 저장하지 않으며, 경로를 그대로 유지합니다.

```bash
curl --fail-with-body -sS -T ./GameSetup.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  -H "X-Checksum-Sha256: $(sha256sum GameSetup.exe | cut -d' ' -f1)" \
  "$URL"
```

```powershell
$headers['X-Checksum-Sha256'] = (Get-FileHash .\GameSetup.exe -Algorithm SHA256).Hash.ToLower()
Invoke-RestMethod -Method Put -InFile .\GameSetup.exe -Headers $headers -Uri $url
```

체크섬 없이, 또는 `Content-Length`가 없는 청크 본문으로 보내면 서버는 먼저 본문을 임시 파일에 쓰고 해시합니다. 그런 다음 저장합니다. 이 경우 잠시 동안 서버 디스크에 파일 크기의 최대 두 배가 필요하고, 바이트를 두 번 처리합니다. 실패로 남은 임시 파일은 서버가 하루 뒤에 제거합니다.

체크섬과 길이를 보냈는데 경로에 이미 이 바이트가 있으면, 서버는 본문을 읽지 않고 `200`으로 응답하고 연결을 닫습니다.

### 생성만 {#create-only}

`PUT`은 조건을 하나만 읽습니다: `If-None-Match: *`. 이를 사용하면 서버는 경로가 없을 때만 파일을 저장합니다. 그렇지 않으면 바이트가 같아도 사유 `already_exists`와 함께 `409`로 응답합니다. `PUT`의 `If-None-Match`에 다른 값을 쓰면 `400`을 반환합니다.

```bash
curl --fail-with-body -sS -T ./notes.txt \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "If-None-Match: *" \
  "https://arkvory.example/api/v1/repositories/releases/raw/docs/notes.txt"
```

### 두 작성자 {#two-writers}

두 요청이 동시에 같은 경로를 변경하면 먼저 온 쪽이 이깁니다. 나중 요청은 사유 `revision_mismatch`와 함께 `409`를 받고, 경로는 이긴 쪽의 내용을 유지합니다. 새 리비전을 만들려면 요청을 다시 실행하세요. 진 쪽이 업로드한 바이트는 보존이 제거할 때까지 경로 없는 아티팩트로 남습니다.

## 파일 읽기 {#read-a-file}

`GET`은 경로의 현재 버전을 반환합니다. `HEAD`는 헤더만 반환합니다.

```bash
curl --fail-with-body -sS -H "Authorization: Bearer $ARKVORY_KEY" -o GameSetup.exe "$URL"
```

```powershell
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -Headers $headers -Uri $url -OutFile .\GameSetup.exe
```

```bash
wget --header="Authorization: Bearer $ARKVORY_KEY" -O GameSetup.exe "$URL"
```

응답 헤더:

| 헤더                    | 값                                                     |
| ----------------------- | ------------------------------------------------------ |
| `ETag`                  | `"sha256:<digest>"`: 콘텐츠의 SHA-256(따옴표 포함)     |
| `Content-Length`        | 파일 크기                                              |
| `Accept-Ranges`         | `bytes`                                                |
| `Content-Type`          | 항상 `application/octet-stream`                        |
| `Content-Disposition`   | 경로의 마지막 세그먼트를 파일 이름으로 한 `attachment` |
| `X-Arkvory-Artifact-Id` | 이 버전을 담고 있는 아티팩트의 ID                      |

알 수 없는 경로는 `404`를 반환합니다.

### 범위와 조건부 요청 {#ranges-and-conditional-requests}

| 요청 헤더                   | 효과                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `Range: bytes=0-1023`       | 요청한 부분과 `Content-Range`가 있는 `206`. 파일 끝을 넘는 시작은 `Content-Range: bytes */<size>`와 함께 `416`을 반환합니다. |
| `Range: bytes=-1024`        | 마지막 1024바이트                                                                                                            |
| `Range: bytes=1048576-`     | 오프셋부터 끝까지                                                                                                            |
| `If-Range: "sha256:…"`      | ETag가 정확히 이것일 때만 `Range`를 적용합니다. 경로가 새 버전이면 새 파일 전체를 받습니다.                                  |
| `If-None-Match: "sha256:…"` | ETag가 같으면 본문 없이 `304`. `HEAD`에서도 동작합니다.                                                                      |

한 요청에 범위 하나만 지원합니다. 여러 범위를 가진 요청은 파일 전체를 반환합니다.

경로는 언제든 새 버전이 될 수 있고, `GET`은 경로를 다시 확인합니다. 다운로드를 안전하게 이어서 하려면 첫 응답의 `ETag`를 기억해 `If-Range`로 보내세요:

```bash
etag=$(curl -sSI -H "Authorization: Bearer $ARKVORY_KEY" "$URL" | awk 'tolower($1)=="etag:" {print $2}' | tr -d '\r')
curl -sS -H "Authorization: Bearer $ARKVORY_KEY" -H "If-Range: $etag" \
  -H "Range: bytes=1048576-" "$URL" >> GameSetup.part
```

파일이 변경되지 않았을 때 다운로드를 건너뛰려면, 지난번에 저장한 ETag를 보내세요:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $ARKVORY_KEY" \
  -H 'If-None-Match: "sha256:<digest>"' "$URL"
```

대용량 파일에는 [`arkvoryctl get`](./cli)이 재개와 SHA-256 검증을 대신 처리합니다.

## 경로와 버전 {#paths-and-versions}

원시 파일은 [경로 기반 파일](../use/files)입니다. 새 바이트로 하는 모든 `PUT`은 경로에 리비전을 추가합니다: 리비전 1, 2, 3 등입니다. 이전 리비전은 남습니다. 각 리비전이 경로의 마지막 세그먼트 이름을 딴 자체 불변 아티팩트를 가리키므로 바이트는 절대 대체되지 않습니다.

- 원시 주소의 `GET`은 항상 현재 리비전을 제공합니다.
- 경로의 모든 리비전을 보려면 기록을 읽으세요: [`getAssetHistory`](../api/reference/files#getAssetHistory) 또는 콘솔의 [[ui:history]].
- 이전 리비전을 읽으려면 [`getAssetRevision`](../api/reference/files#getAssetRevision)이 해당 아티팩트를 반환합니다. 아티팩트의 콘텐츠 주소로 내려받으세요.
- 이전 리비전으로 되돌리려면 [`restoreAsset`](../api/reference/files#restoreAsset)을 사용하세요. 이전 바이트를 가리키는 새 리비전을 추가합니다.
- 리포지토리의 경로를 접두사로 나열하려면 [`listAssetPage`](../api/reference/files#listAssetPage)를 사용하세요.
- 경로는 삭제할 수 없습니다. 기록은 남습니다. 보존은 경로 리비전이 사용하는 아티팩트를 제거하지 않습니다.

같은 작업이 [SDK](./sdk#raw-files-by-path)(`client.raw.putRawFile`, `downloadRawFile`)와 [`arkvoryctl`](./cli#transfers)(`put`, `get`)에 있습니다.

### 경로 규칙 {#path-rules}

| 규칙       | 값                                                            |
| ---------- | ------------------------------------------------------------- |
| 길이       | 1~1024자                                                      |
| 폴더       | `/`로 구분된 세그먼트                                         |
| 허용 안 함 | 빈 세그먼트(`a//b`), `.` 또는 `..`, 백슬래시, 콜론, 제어 문자 |

`curl`과 브라우저는 보내기 전에 URL에서 `.`과 `..`을 제거하므로 그런 경로는 도달하지 않습니다. 규칙을 어긴 경로는 `400`을 반환합니다.

## 권한 {#permissions}

개인용 토큰과 파일 키는 리포지토리에 대한 읽기 또는 쓰기 액세스를 가집니다. 서비스 키는 정확한 작업을 가집니다.

| 작업          | 서비스 키 작업                                                                                   | 개인용 토큰 또는 파일 키            |
| ------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------- |
| `GET`, `HEAD` | `content.read`                                                                                   | 읽기 액세스                         |
| `PUT`         | `upload.create`, `upload.write`, `upload.complete`, `asset.read`, `asset.write`, `artifact.read` | 쓰기 액세스, 토큰 범위 `read-write` |

다운로드만 하는 배포 에이전트에는 `content.read` 작업이 필요합니다.

[읽기 게이트웨이](../operate/read-gateways)는 `GET`과 `HEAD`만 받습니다. [미러](../operate/mirrors)는 읽기를 제공하고 `409`와 사유 `mirror_read_only`로 `PUT`을 거부합니다.

## 제한 {#limits}

| 제한              | 값                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 파일 크기         | 설치의 최대 객체 크기, `ARKVORY_MAX_OBJECT_BYTES`(기본 약 10 TiB)                                                                                      |
| 하나의 `PUT` 요청 | 30분 안에 끝나야 하고 30초 넘게 멈추면 안 됩니다(`ARKVORY_UPLOAD_DEADLINE_MS`, `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`). 이것이 허용되는 최댓값이기도 합니다. |
| 동시 업로드       | 기본적으로 서버당 2개, 키당 1개(`ARKVORY_MAX_UPLOADS`, `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`). 대기 중인 요청은 20초 후 `503`과 함께 포기합니다.         |
| 동시 다운로드     | 기본적으로 서버당 16개, 키당 4개                                                                                                                       |
| 할당량            | 파일이 리포지토리 할당량과 설치 용량에 포함됨                                                                                                          |

하나의 `PUT`에는 재개가 없습니다. 실패하면 처음 바이트부터 다시 시작합니다. 원시 파일은 작은 파일과 중간 크기 파일, 그리고 스크립트에 사용하세요. 대용량 파일이나 느린 네트워크에는 [`arkvoryctl put`](./cli) 또는 [SDK](./sdk)를 사용하세요. 파트로 나누어 업로드하고, 실패 후 이어서 진행하며, SHA-256을 검사합니다. 또한 파일을 경로의 리비전으로 저장합니다. 변수에 대한 설명은 [환경 변수](../reference/environment#transfers-and-bandwidth)에 있습니다.

## 문제 해결 {#troubleshooting}

오류는 `code`, `reason`, `message`, `requestId`가 있는 JSON 문서입니다. [오류](../api/errors)를 참조하세요. 서버 로그에서 요청을 찾을 수 있도록 관리자에게 `requestId`를 알려 주세요.

| 상태      | 사유                                                        | 원인                                                                             | 해결 방법                                                                               |
| --------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `400`     | `validation`                                                | 경로, `Content-Length`, `X-Checksum-Sha256` 또는 `If-None-Match`가 유효하지 않음 | 경로 규칙을 확인하고 URL을 인코딩하세요                                                 |
| `401`     | `credential_missing`, `credential_invalid`, `token_expired` | 키가 없거나, 잘못된 키이거나, 만료된 토큰                                        | `Authorization: Bearer <key>`를 보내세요. 원시 파일에는 Basic 인증이 동작하지 않습니다. |
| `403`     | `permission_missing`, `read_only_token`                     | 키가 쓸 수 없거나 읽기 전용 토큰                                                 | [권한](#permissions)의 작업을 가진 키를 사용하세요                                      |
| `404`     |                                                             | 경로가 없거나 키가 리포지토리를 볼 수 없음                                       | 리포지토리 이름과 경로를 확인하세요                                                     |
| `409`     | `already_exists`                                            | `If-None-Match: *`인데 경로가 존재                                               | 헤더를 제거하고 리비전을 추가하세요                                                     |
| `409`     | `revision_mismatch`                                         | 다른 요청이 먼저 경로를 변경함                                                   | 요청을 다시 실행하세요                                                                  |
| `409`     | `mirror_read_only`                                          | 리포지토리가 미러임                                                              | 주 서버에 쓰세요                                                                        |
| `416`     | `range_not_satisfiable`                                     | 범위가 파일 끝 뒤에서 시작                                                       | `HEAD`로 크기를 확인하세요                                                              |
| `422`     | `integrity_mismatch`                                        | 본문이 `X-Checksum-Sha256` 또는 `Content-Length`와 일치하지 않음                 | 체크섬을 다시 계산하고 프록시를 확인하세요                                              |
| `503`     | `busy`                                                      | 동시 전송이 너무 많음                                                            | `Retry-After`의 시간을 기다린 뒤 다시 시도하세요                                        |
| `507`     | `storage_quota`                                             | 리포지토리 할당량 또는 설치 용량에 도달함                                        | 공간을 확보하거나 더 큰 할당량을 요청하세요                                             |
| 상태 아님 | 전송 중 `curl: (55)` 또는 `(56)`                            | 서버가 연결을 닫음. 경로에 이미 바이트가 있으면 `200`으로 응답하고 닫습니다.     | `curl -i`를 실행하고 응답을 읽으세요                                                    |
| 상태 아님 | 30분 후 연결이 닫힘                                         | 업로드 기한                                                                      | `arkvoryctl put`을 사용하세요                                                           |

## 관련 페이지 {#related-pages}

- [클라이언트 및 프로토콜](./index)
- [명령줄(arkvoryctl)](./cli)
- [TypeScript SDK](./sdk)
- [파일과 경로](../use/files)
- [API 참조: 경로 기반 파일](../api/reference/files)
