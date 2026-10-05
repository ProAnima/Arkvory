---
title: 'HTTP API 개요'
description: 'Arkvory HTTP API와 통합할 때 필요한 규칙: JSON과 크기, 탐색, 페이지 나누기, 리비전, 멱등성, 재시도, 범위, 오류, 한도.'
---

# HTTP API 개요

HTTP API는 웹 콘솔, 명령줄 클라이언트, SDK가 사용하는 인터페이스입니다. 이들이 하는 모든 작업은 어떤 언어로든 통합에서 수행할 수 있습니다. 이 페이지에서는 모든 작업에 적용되는 규칙을 설명합니다. [참조 페이지](#reference-pages) 아래의 페이지들은 각 작업을 액세스 규칙, 재시도 규칙, 매개변수, 응답과 함께 나열하며, 서버가 강제하는 계약에서 생성됩니다.

## 기본 {#basics}

- **기본 경로.** 모든 작업은 `/api/v1` 아래에 있습니다. 예: `https://arkvory.example/api/v1/repositories`. 유일한 예외는 `/health` 아래의 상태 확인입니다.
- **형식.** 요청과 응답은 JSON(`application/json`)입니다. JSON 본문은 64 KiB로 제한되며, JSON 작업에 다른 콘텐츠 유형을 보내는 요청은 `415`를 받습니다. 파일의 바이트는 `application/octet-stream`으로 전송됩니다.
- **알 수 없는 필드.** 대부분의 작업은 정의하지 않은 필드가 있는 요청을 거부합니다(`400`, `details`에 해당 필드 포함). 응답에서는 알 수 없는 필드를 무시하세요.
- **시간**은 UTC의 RFC 3339 타임스탬프입니다. 아티팩트, 업로드, 작업, 계정, 키의 **ID**는 UUID입니다.
- **이름.** 리포지토리 이름은 `[a-z0-9][a-z0-9_-]{0,63}`와 일치합니다. 파일 이름(아티팩트 이름)은 최대 240자이며 `/` 또는 `\`가 없습니다. 리포지토리의 경로는 최대 1,024자입니다.
- **캐싱.** 응답에는 `Cache-Control: private, no-store`가 포함됩니다.
- **기타 프로토콜.** `/v2`(컨테이너), `/lfs`(Git LFS), `/npm` 경로는 자체 클라이언트의 사양을 따르며 자체 오류 형식을 사용합니다. OpenAPI 문서에는 포함되지 않습니다. [클라이언트와 프로토콜](../protocols/index)을 참조하세요.

### 크기와 개수 {#sizes}

JSON 숫자는 모든 64비트 값을 담을 수 없습니다. 따라서 Arkvory는 **크기와 바이트 수를 10진수 문자열로 전송합니다**: `"size": "1048576"`. 업로드를 만들 때 선언하는 크기도 마찬가지입니다. 크기에는 부호와 선행 0이 없으며 최대 16자리입니다. 개수, 리비전, 한도, 파트 인덱스는 일반 JSON 정수입니다.

최대 객체 크기는 10,000 GiB(10 737 418 240 000 바이트)입니다. 단, 관리자가 더 낮은 `ARKVORY_MAX_OBJECT_BYTES`를 설정한 경우는 예외입니다. 더 큰 크기를 선언하면 `400`으로 거부됩니다.

## 인증 {#authentication}

로그인, 공개 상태 확인, 로그인 옵션을 제외한 모든 작업은 `Authorization: Bearer <credential>` 헤더에 자격 증명이 필요합니다. 자격 증명은 콘솔 세션, 개인용 액세스 토큰, 서비스 키 또는 복구 키입니다. 자격 증명이 할 수 있는 일은 종류와 각 작업의 **액세스 규칙**에 따라 다릅니다. 통합을 설계하기 전에 [인증](./authentication)을 읽고, 자동화에는 필요한 작업만 가진 서비스 키를 부여하세요.

## 탐색 {#discovery}

클라이언트는 추측하는 대신 서버에 지원 여부를 물을 수 있습니다. 이 모두에는 자격 증명이 필요합니다.

| 요청                           | 응답                                                                                                                                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/capabilities`     | API 버전(`v1`), 게이트웨이 역할(`api` 또는 `reader`), 기능 플래그, 이 서버의 한도: `maxObjectBytes`, `partBytes`(최소 파트, 8 MiB), `maxPartBytes`(1 GiB), `maxParts`(10,000), `maxPageSize`(100).                                                                                    |
| `GET /api/v1/operations`       | 이 자격 증명이 호출할 수 있을 것으로 보이는 작업들로, 각각 `operationId`, 메서드, 경로, `surface`, `retry` 클래스, 필요한 작업, 나머지 조건을 포함합니다. `repository`, `surface`, `after`, `limit`(1~100, 기본 50)으로 필터링하세요. 이 목록은 참고용이며, 실제 요청만이 결정합니다. |
| `GET /api/v1/openapi.json`     | 작성자 API의 OpenAPI 3.0.3 문서입니다. `?surface=<name>`을 추가하면 하나의 surface만 가져옵니다.                                                                                                                                                                                      |
| `GET /api/v1/auth/permissions` | 리포지토리별 호출 자격 증명의 작업.                                                                                                                                                                                                                                                   |
| `GET /api/v1/auth/me`          | 자격 증명이 무엇인지, 그 종류, 대략적인 `read`/`write` 권한.                                                                                                                                                                                                                          |
| `GET /api/v1/repositories`     | 자격 증명이 볼 수 있는 리포지토리.                                                                                                                                                                                                                                                    |

한도를 하드코딩하는 대신 `capabilities`로 읽으세요. 알 수 없는 기능 플래그는 `false`로 취급하세요.

### Surface {#surfaces}

작업은 여섯 개의 **surface**로 그룹화됩니다. 이는 계약의 레이블일 뿐 별도의 서비스가 아니며, URL은 바뀌지 않습니다.

| Surface          | 포함 범위                                                         |
| ---------------- | ----------------------------------------------------------------- |
| `discovery`      | 기능, 작업 카탈로그, OpenAPI, 리포지토리                          |
| `identity`       | 로그인, 호출자 자신의 ID, 토큰, 키 활성화                         |
| `catalog`        | 아티팩트, 주석, 패키지, 경로 기반 파일, 스테이지, 승격, 첨부 파일 |
| `transfers`      | 업로드 세션, 파트, 완료 작업, 다운로드                            |
| `administration` | 계정, 그룹, 서비스 계정, 키, 위임, 업데이트, 백업                 |
| `operations`     | 활성 상태, 준비 상태, 메트릭, 피드백                              |

상태 확인은 자격 증명 없이 `GET /health/live`(프로세스 실행 중)와 `GET /health/status`(공개; `{"status":"ready"}` 또는 `unavailable`), 자격 증명과 함께 `GET /health/ready`와 `GET /health/metrics`입니다. 이들은 요청 예산을 사용하지 않으므로, 부하 때문에 밸런서가 서버를 제외하지 않습니다.

## 페이지 나누기 {#pagination}

목록은 한 번에 한 페이지씩 반환됩니다. 응답에는 `items`와 `next`가 있습니다. `next`가 `null`이 아니면 다음 페이지를 읽기 위해 쿼리 매개변수 `after`에 그대로 다시 보내세요. `null`이면 목록이 끝난 것입니다. 커서는 불투명 문자열로 취급하고 직접 만들지 마세요.

`limit`은 페이지 크기를 1~100으로 설정합니다. 대부분의 목록은 생략하면 50개 항목을 반환합니다. 페이지는 스냅샷이 아닙니다. 읽는 동안 도착한 항목이 나타날 수도 있고 아닐 수도 있습니다. `next`를 따라가는 동안 필터와 정렬 순서는 같아야 합니다.

## 리비전과 비교 후 교체 {#revisions}

사람이 편집하는 대상에는 1부터 증가하는 **리비전**이 있습니다. 아티팩트의 레이블, 메타데이터, 컬렉션, 빌드의 첨부 파일, 파일 경로, 스토리지 정책, 백업 계획, 서비스 계정의 설정 등입니다. 변경 시에는 요청 본문에 예상하는 리비전을 `expectedRevision`으로 지정합니다:

```json
{ "expectedRevision": 3, "value": { "labels": ["tested"], "metadata": {}, "collections": [] } }
```

현재 리비전이 3이 아니면 아무것도 바뀌지 않고 서버는 `409`와 사유 `revision_mismatch`로 응답합니다. 이것이 **비교 후 교체(compare-and-swap)**입니다. 상태를 다시 읽고 변경을 적용한 뒤 새 리비전을 보내세요. 더 큰 숫자로 반복하여 강제로 쓰려고 하지 마세요. 새 경로처럼 아직 존재하지 않는 대상에는 `0`을 사용하세요. API는 `If-Match` 헤더를 사용하지 않습니다.

**다운로드한 아티팩트**에는 다른 검증자인 `ETag`가 있습니다. [범위 다운로드와 ETag](#range-downloads)를 참조하세요.

## 멱등성 키 {#idempotency}

`Idempotency-Key` 헤더는 반복된 요청이 한 번만 적용되게 합니다. 문자, 숫자, `_ . : -`로 이루어진 1~128자 값을 사용하고, 첫 요청 전에 작업 상태와 함께 보관하여 재시작된 작업이 같은 키를 반복하도록 하세요. 다음 쓰기에는 키가 필요합니다:

| 작업                                                                | 같은 키와 같은 본문으로 반복할 때                                                                        |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `createUpload`                                                      | 같은 업로드 세션을 반환합니다.                                                                           |
| `issueServiceKey`와 `rotateServiceKey`                              | 시크릿 없이 키의 메타데이터를 `200`으로 반환합니다. 시크릿을 잃어버렸다면 키를 폐기하고 새로 발급하세요. |
| `requestBackupRun`, `requestBackupVerify`, `requestBackupRetention` | 다른 요청을 대기열에 추가하는 대신 같은 요청을 반환합니다.                                               |

같은 키에 다른 본문을 보내면 `409`와 사유 `idempotency_mismatch`로 거부됩니다. 키는 호출자와 대상에 한정되므로 두 호출자가 같은 값을 사용할 수 있습니다.

다른 쓰기는 다른 이유로 반복해도 안전합니다. 상태를 설정하거나(스테이지 설정, 패키지 등록, 키 폐기) 비교 후 교체이기 때문입니다. 다음 섹션에서 어떤 것인지 설명합니다.

## 재시도 규칙 {#retry-rules}

모든 작업에는 **재시도 클래스**가 있습니다. 이 클래스는 응답을 받지 못했을 때 클라이언트가 무엇을 해야 하는지 알려줍니다. 참조에서는 각 작업에 "Retry"로 표시됩니다.

| 클래스             | 의미                                      | 할 일                                                                                                                                                     |
| ------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read`             | 읽기는 아무것도 바꾸지 않습니다.          | 백오프를 두고 반복합니다.                                                                                                                                 |
| `idempotent`       | 같은 요청은 같은 효과를 냅니다.           | 반복합니다. 응답은 세부적으로 다를 수 있습니다. 두 번 삭제하면 객체가 사라졌다고 보고할 수 있습니다.                                                      |
| `idempotency-key`  | 키가 있을 때만 안전합니다.                | 같은 `Idempotency-Key`와 같은 본문으로 반복합니다.                                                                                                        |
| `compare-and-swap` | 리비전에 의존하는 변경입니다.             | 상태를 읽고 다시 결정한 뒤 읽은 리비전으로 반복합니다. `409`를 통과하려고 `expectedRevision`을 올리지 마세요.                                             |
| `reconcile-upload` | 업로드 세션의 단계입니다.                 | 먼저 업로드와 파트를 읽고(`getUpload`, `listUploadParts`) 누락된 것을 보냅니다. 전체 파일 `PUT`은 중간에서 계속할 수 없으며 바이트 0부터 다시 시작합니다. |
| `reconcile-job`    | 완료 작업 대기열 추가.                    | 먼저 작업을 읽으세요(`getCompletionJob`). 실패한 작업은 다시 대기열에 추가할 수 있습니다.                                                                 |
| `never-automatic`  | 반복하면 작업이 두 번 수행될 수 있습니다. | 자동으로 반복하지 마세요. 결과를 확인한 뒤 결정하세요. 예: 계정, 토큰, 다운로드 링크 만들기, 스토리지 정책 실행, 피드백 보내기.                           |

네트워크 실패와 상태 `408`, `429`, `502`, `503`, `504`는 일시적입니다. 클래스에 따라 반복하고, 최소한 `Retry-After`만큼 기다리며, 시도 횟수 제한과 함께 지수 백오프를 추가하세요. 요청을 바꾸지 않고 `401`, `403`, 기타 `4xx` 응답을 반복하지 마세요. `500`을 무작정 반복하지 말고 지원팀에 요청 ID를 알려주세요. 변경에 대한 `503` 이후에는 결과를 알 수 없으므로, 클래스를 사용하여 무슨 일이 있었는지 확인하세요. SDK와 명령줄 클라이언트는 이 규칙을 적용합니다.

## 범위 다운로드와 ETag {#range-downloads}

`…/artifacts/{id}/content`의 `GET`과 `HEAD`는 `"sha256:<hex>"` 형식의 강한 `ETag`와 `Accept-Ranges: bytes`와 함께 원본 바이트를 반환합니다. 패키지별 다운로드(`…/packages/content`)와 파일 경로별 다운로드(`…/asset/content`, `…/raw/{path}`)에도 같은 규칙이 적용됩니다. 이들은 모든 요청에서 현재 아티팩트를 조회하며, `packages/content`와 `raw`는 선택한 아티팩트를 `X-Arkvory-Artifact-Id`에 명시하므로 재개를 위해 고정할 수 있습니다.

- `Range: bytes=0-1023`, `bytes=1024-`, `bytes=-1024`는 `Content-Range`와 함께 `206`을 반환합니다. 서버는 하나의 범위만 제공하며, 여러 범위 목록에는 전체 파일로 응답합니다.
- 파일 끝을 넘어가는 시작 위치는 코드 `invalid_input`, 사유 `range_not_satisfiable`, `Content-Range: bytes */<size>`와 함께 `416`을 반환합니다.
- 재개하려면 `Range`와 함께 `If-Range: "<the ETag you saw>"`를 보내세요. 이름 뒤의 콘텐츠가 바뀌었다면 `ETag`가 달라져 뒤섞인 파일 대신 새 파일 전체를 받습니다.
- `ETag`와 함께 `If-None-Match`를 보내면 본문 없이 `304`를 반환합니다.
- 저장한 내용의 SHA-256을 검증하세요. ETag에 포함되어 있습니다.

다운로드 링크(`?token=`)는 하나의 아티팩트 콘텐츠 경로에서 동작합니다. [인증](./authentication#download-links)을 참조하세요.

## 오류 {#errors}

모든 실패는 같은 JSON 봉투를 가집니다: `code`, `message`, `requestId`, 그리고 추가로 설명할 것이 있으면 `reason`, `details`, `retryAfterSeconds`입니다. `message`가 아니라 `code`와 `reason`으로 판단하세요. 알 수 없는 reason은 없는 것으로 간주하고, 알 수 없는 `code`는 HTTP 상태로 처리합니다. [오류](./errors)를 참조하세요.

## 속도 제한과 사용 중인 서버 {#rate-limits}

Arkvory는 분당 API 호출을 측정하지 않습니다. 동시에 수행하는 양을 제한하고, 비밀번호 추측 시도를 제한합니다:

- **사용 중.** 서버는 동시에 고정된 수의 요청과 전송을 허용합니다(`ARKVORY_MAX_REQUESTS`, 기본 128; 업로드 2, 다운로드 16 기본). 전송은 최대 20초 동안 제한된 대기열에서 기다릴 수 있습니다. 여유가 없으면 코드 `busy`와 함께 `503`을 응답합니다. `Retry-After` 이후 다시 시도하세요.
- **용량.** 디스크 예약 공간 부족, 할당량, 객체 수 한도는 `507`을 반환하며, 기다려도 나아지지 않습니다.
- **시도.** 로그인, 등록, 비밀번호, 피드백 시도가 너무 많으면 코드 `rate_limited`와 함께 `429`를 반환합니다. [인증](./authentication#sign-in-limits)을 참조하세요.

`429`와 `503` 모두 초 단위의 `Retry-After` 헤더(서버에 추정치가 없으면 2)와 같은 숫자를 `retryAfterSeconds`에 담습니다. 요청이 프록시를 거치면 프록시가 자체 한도를 추가할 수 있습니다.

## 요청 ID {#request-ids}

모든 응답에는 `X-Request-Id` 헤더가 있고, 모든 오류에는 같은 값이 `requestId`에 있습니다. 자신의 작업과 함께 기록하고 지원팀에 알려주세요. 보내는 요청 ID는 `ARKVORY_TRUSTED_PROXIES`에 나열된 프록시를 통해 도착하고 8~128자의 안전한 문자일 때만 사용되며, 그렇지 않으면 서버가 새로 만듭니다. W3C `traceparent` 헤더는 서버의 액세스 로그에만 기록됩니다.

## 브라우저와 CORS {#cors}

Arkvory와 같은 주소의 웹 페이지는 아무 설정 없이 동작합니다. 다른 주소의 페이지는 관리자가 정확한 origin을 `ARKVORY_CORS_ORIGINS`에 나열한 경우에만 동작합니다(최대 16개, HTTPS 또는 루프백 HTTP). 다른 origin은 키가 유효해도 사유 `origin_not_allowed`와 함께 `403`을 받습니다. 요청은 쿠키를 사용하지 않습니다. 키를 `Authorization` 헤더에 넣어 보내고 메모리에 보관하세요. [환경 변수](../reference/environment)를 참조하세요.

## 호환성 약속 {#evolution}

`/api/v1`은 추가로만 변경됩니다: 새 작업, 새 선택적 요청 필드, 새 응답 필드, 새 오류 사유, 새 기능 플래그. 클라이언트를 깨뜨리는 변경(의미 변경, 새 필수 필드, 다른 상태, 다른 페이지 나누기 등)은 API의 새 버전과 두 버전이 모두 동작하는 기간을 부여받습니다. 그 대가로 클라이언트는 다음을 해야 합니다:

- 알 수 없는 응답 필드를 무시합니다.
- 알 수 없는 `reason`은 없는 것으로, 알 수 없는 `code`는 HTTP 상태로 처리합니다.
- 한도를 `capabilities`에서 가져옵니다.
- 작업이 정의한 필드만 보냅니다.

`operationId` 값은 안정적인 이름입니다. 작업을 자신의 코드에 매핑할 때 사용하세요.

## 예제: 파일 하나를 업로드하고 다운로드하기 {#example}

이 순서는 파일을 한 요청으로 업로드합니다. 몇 기가바이트를 넘는 파일이나 불안정한 링크에서는 [`arkvoryctl`](../protocols/cli) 또는 [SDK](../protocols/sdk)를 사용하세요. 이들은 파트를 나누어 보내고 실패 후에도 계속합니다. 예제에서는 `jq`를 사용하여 JSON을 읽습니다.

먼저 주소와 키를 설정하고 파일의 크기와 SHA-256을 계산합니다:

```bash
export ARKVORY_URL=https://arkvory.example
export ARKVORY_KEY="$(cat ~/.arkvory/key)"
FILE=./Setup.exe
SIZE=$(stat -c %s "$FILE")
SHA=$(sha256sum "$FILE" | cut -d ' ' -f 1)
```

**1단계. 업로드를 예약합니다.** 같은 `Idempotency-Key`는 같은 세션을 반환하므로 이 호출을 안전하게 반복할 수 있습니다.

```bash
ID=$(curl -fsS -X POST "$ARKVORY_URL/api/v1/repositories/releases/uploads" \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  -H "Idempotency-Key: build-1042-setup" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Setup.exe\",\"size\":\"$SIZE\",\"sha256\":\"$SHA\",\"labels\":[\"nightly\"]}" \
  | jq -r .id)
```

**2단계. 바이트를 전송합니다.** 크기와 SHA-256이 일치하면 서버가 아티팩트를 게시합니다.

```bash
curl -fsS -X PUT "$ARKVORY_URL/api/v1/repositories/releases/uploads/$ID/content" \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  -H "Content-Type: application/octet-stream" \
  -T "$FILE" | jq '{id, status}'
```

**3단계. 다운로드합니다.** 아티팩트 ID는 업로드 ID입니다.

```bash
curl -fL -o Setup-copy.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  "$ARKVORY_URL/api/v1/repositories/releases/artifacts/$ID/content"
sha256sum Setup-copy.exe
```

2단계는 `{"id": "…", "status": "available"}`를 응답합니다. 2단계 중에 연결이 끊기면 `GET …/uploads/$ID`로 업로드를 읽으세요. 상태가 `pending`인 동안에는 파일을 처음부터 다시 보내세요. 업로드 세션은 7일 동안 유지됩니다. 키에는 `releases`에 대한 `upload.create`, `upload.write`, `upload.complete`, `content.read` 작업이 필요합니다. [업로드](./reference/uploads)와 [전송](../use/transfers)을 참조하세요.

## 참조 페이지 {#reference-pages}

각 페이지는 한 그룹의 작업을 액세스 규칙, 재시도 클래스, 매개변수, 응답과 함께 나열합니다.

- [시스템과 상태](./reference/system): 활성 상태, 준비 상태, 메트릭, OpenAPI, 기능
- [리포지토리](./reference/repositories)
- [업로드](./reference/uploads)
- [아티팩트와 카탈로그](./reference/artifacts)
- [패키지](./reference/packages)
- [경로 기반 파일](./reference/files)
- [스테이지와 승격](./reference/promotion)
- [스토리지 정책과 보존](./reference/storage)
- [미러](./reference/mirrors)
- [다운로드 링크](./reference/links)
- [빌드 첨부 파일](./reference/attachments)
- [계정과 로그인](./reference/accounts)
- [서비스 계정과 키](./reference/services)
- [백업](./reference/backups)
- [업데이트](./reference/updates)
- [피드백](./reference/feedback)

관련 페이지: [인증](./authentication), [오류](./errors), [TypeScript SDK](../protocols/sdk).
