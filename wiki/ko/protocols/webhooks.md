---
title: '웹훅'
description: '리포지토리가 바뀌면 HTTP 요청을 받습니다. 구독을 설정하고, 서명을 검증하고, 반복 전달을 처리하세요.'
---

# 웹훅

웹훅은 리포지토리에서 무언가 바뀌었음을 시스템에 알려 주므로 폴링할 필요가 없습니다. Arkvory worker는 리포지토리 [변경 피드](../api/reference/artifacts#listCatalogChanges)의 이벤트마다 지정한 URL로 HTTP `POST`를 보냅니다. 빌드가 게시될 때 배포를 시작하거나, 경로에 새 버전이 생겼을 때 캐시를 갱신하는 데 사용하세요.

구독은 관리자가 파일로 설정합니다. 아직 이를 위한 API나 콘솔 페이지는 없습니다. 피드는 직접 읽을 수도 있습니다: `GET /api/v1/repositories/<repository>/changes`.

## 전달 방식 {#how-it-works}

- **구독 하나는 리포지토리 하나를 따라가며** URL 하나로 보냅니다.
- **이벤트는 순서대로 하나씩 도착합니다.** 다음 이벤트는 수신자가 `2xx` 상태로 응답할 때까지 기다립니다.
- **전달은 최소 한 번 이루어집니다.** 충돌이나 응답 유실 뒤에는 같은 이벤트가 다시 올 수 있습니다. 모든 이벤트에는 고정된 `id`가 있으니 이것으로 중복을 제거하세요.
- **새 구독은 새 이벤트만 받습니다.** 만들기 전의 이벤트는 보내지 않습니다.
- **수신자가 멈추면 자기 구독만 지연됩니다.** 이벤트는 기다립니다. Arkvory는 12초 뒤에 다시 시도하고, 대기 시간을 최대 한 시간까지 두 배로 늘리며, 수신자가 다시 응답하면 이벤트를 순서대로 보냅니다. 업로드와 다운로드는 웹훅을 기다리지 않습니다.

## 구독 설정 {#set-up}

서버 파일에 접근할 수 있어야 하며 worker를 다시 시작할 권한이 필요합니다. [구성](../install/configuration)을 참고하세요.

1. 무작위 문자 16자 이상으로 시크릿 파일을 만드세요. 예: `config/webhooks/ci.secret`. 서비스 계정만 읽을 수 있어야 합니다. 수신자도 같은 시크릿이 필요합니다.
2. 구독 파일을 작성하세요. 예: `config/webhooks/webhooks.json`:

```json
{
  "webhooks": [
    {
      "id": "ci",
      "repository": "releases",
      "url": "https://ci.example.com/hooks/arkvory",
      "secretFile": "/opt/proanima-arkvory/config/webhooks/ci.secret",
      "actions": ["artifact.publish"]
    }
  ]
}
```

3. `config/runtime.json`에서 `ARKVORY_WEBHOOKS_FILE`을 그 파일의 절대 경로로 설정하고 worker를 다시 시작하세요. [변경 적용](../install/configuration#apply-change)을 참고하세요.
4. worker 로그에서 `webhook.started`를 찾고, 파일을 게시한 뒤 수신자를 확인하세요.

잘못된 파일은 시작 시 `worker.unavailable`로 worker를 멈춥니다. 구독은 최대 16개까지 허용됩니다. Compose 설치에서는 파일을 worker 컨테이너에 직접 마운트해야 합니다.

| 필드             | 의미                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | 구독 이름: `a-z`, `0-9`, `_`, `-` 1~64자. 진행 상태가 이 이름으로 저장됩니다.                                                                           |
| `repository`     | 피드를 보낼 리포지토리.                                                                                                                                 |
| `url`            | 수신자. HTTPS이며 사용자 이름, query, fragment가 없어야 하고 2048자 이하입니다. 일반 HTTP는 `localhost`, `127.0.0.1`, `[::1]`에서만 허용됩니다.         |
| `secretFile`     | 서명 시크릿이 들어 있는 파일의 절대 경로.                                                                                                               |
| `nextSecretFile` | [교체](#rotate-the-secret)를 위한 선택적 두 번째 시크릿.                                                                                                |
| `actions`        | 보낼 피드 동작의 선택적 목록. 예: `artifact.publish`, `artifact.delete`, `asset.replace`, `stage.add`, `package.register`. 없으면 모든 동작을 보냅니다. |

## 요청 {#request}

| 헤더                  | 값                                                                  |
| --------------------- | ------------------------------------------------------------------- |
| `Content-Type`        | `application/json`                                                  |
| `X-Arkvory-Delivery`  | 이벤트의 `id`. 이벤트가 반복되어도 같습니다.                        |
| `X-Arkvory-Event`     | 피드 동작. 예: `artifact.publish`.                                  |
| `X-Arkvory-Timestamp` | 요청에 서명한 시각(Unix 초).                                        |
| `X-Arkvory-Signature` | `sha256=<hex>`. 교체 중에는 쉼표로 구분된 값이 두 개 들어 있습니다. |

본문은 JSON입니다.

```json
{
  "id": "releases:128",
  "repository": "releases",
  "sequence": "128",
  "action": "artifact.publish",
  "artifactId": "00000000-0000-4000-8000-000000000001",
  "detail": null
}
```

`sequence`는 피드 안의 위치이며 십진 문자열입니다. `detail`은 해당하는 동작에서 파일 경로나 단계입니다. 본문에는 작성자, 파일 내용, 메타데이터가 없습니다. 현재 상태는 `artifactId`로 [API](../api/index)에서 읽으세요.

10초 안에 아무 `2xx` 상태로 응답하세요. `3xx`(리디렉션은 따라가지 않음), `4xx`, `5xx`, 연결 오류, 시간 초과는 실패로 간주됩니다. Arkvory는 응답을 최대 4 KiB만 읽고 무시합니다.

## 서명 검증 {#verify}

서명은 시크릿으로 `<timestamp>.<body>` 텍스트에 대해 계산한 HMAC-SHA256이며 `sha256=`과 16진수 다이제스트로 표기합니다. 요청을 신뢰하기 전에 확인하세요.

1. JSON을 파싱하기 전에 원본 본문을 읽으세요.
2. 타임스탬프가 내 시계와 5분 넘게 차이 나면 요청을 거부하세요.
3. 서명을 계산해 상수 시간 함수로 비교하세요. 헤더에 값이 두 개면 어느 쪽이든 받아들이세요.

Node.js:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(secret, headers, rawBody) {
  const timestamp = headers['x-arkvory-timestamp'];
  if (!/^\d{1,12}$/.test(timestamp ?? '')) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = Buffer.from(
    'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex'),
  );
  return String(headers['x-arkvory-signature'] ?? '')
    .split(',')
    .some((given) => {
      const actual = Buffer.from(given.trim());
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    });
}
```

Python:

```python
import hashlib, hmac, time

def verify(secret: bytes, headers, raw_body: bytes) -> bool:
    timestamp = headers.get("X-Arkvory-Timestamp", "")
    if not timestamp.isdigit() or abs(time.time() - int(timestamp)) > 300:
        return False
    digest = hmac.new(secret, timestamp.encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    expected = "sha256=" + digest
    given = headers.get("X-Arkvory-Signature", "").split(",")
    return any(hmac.compare_digest(part.strip(), expected) for part in given)
```

## 반복 전달 처리 {#repeats}

- 처리한 모든 이벤트의 `id`를 저장하고 반복은 무시하세요.
- 빠르게 응답하세요. 작업을 큐에 넣고 `204`를 반환하세요. 수신자가 느리면 그 구독의 이후 이벤트가 모두 지연됩니다.
- 반복이 작업이 두 번 일어났다는 뜻은 아닙니다. 이벤트를 힌트로 보고 API에서 현재 상태를 읽으세요.

## 시크릿 교체 {#rotate-the-secret}

1. 새 시크릿을 가리키는 `nextSecretFile`을 추가하고 worker를 다시 시작하세요. 이제 모든 요청에 서명이 두 개 들어갑니다.
2. 수신자를 새 시크릿으로 바꾸세요. 두 서명 중 어느 쪽이든 받아들이는 수신자는 그동안 계속 동작합니다.
3. 새 파일을 `secretFile`에 넣고 `nextSecretFile`을 제거한 뒤 worker를 다시 시작하세요.

## 사설 수신자와 인증서 {#private-receivers}

- Arkvory는 루프백, 사설, 링크 로컬, 클라우드 메타데이터 주소의 수신자와 그 주소로 확인되는 이름을 거부합니다. 서버가 내부 서비스에 접근하는 데 쓰이는 것을 막기 위해서입니다.
- 내 네트워크의 수신자에게 보내려면 그 네트워크를 `ARKVORY_WEBHOOKS_ALLOW_PRIVATE`에 지정하세요. 예: `10.20.0.0/16`.
- 수신자의 인증서가 자체 인증 기관에서 발급되었다면 `ARKVORY_WEBHOOKS_CA_FILE`을 그 기관이 담긴 PEM 파일로 설정하세요. 인증서는 항상 검증됩니다.

## 웹훅 모니터링 {#monitor}

전달이 실패하면 worker가 `errorCode`가 포함된 `webhook.step_failed`를, 다시 정상이 되면 `webhook.recovered`를 기록합니다. 지표 `arkvory_webhook_failing`, `arkvory_webhook_last_success_timestamp_seconds`와 알림 `ArkvoryWebhookFailing`은 [모니터링](../operate/monitoring)에 설명되어 있습니다.

## 문제 해결 {#troubleshooting}

| `errorCode` | 원인과 조치                                                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blocked`   | 수신자 주소가 허용되지 않습니다(루프백, 사설, 링크 로컬 또는 메타데이터). 공인 주소를 쓰거나 해당 네트워크를 `ARKVORY_WEBHOOKS_ALLOW_PRIVATE`에 추가하세요. |
| `timeout`   | 10초 안에 응답이 없습니다. 더 빠르게 응답하고 작업을 큐에 넣으세요.                                                                                         |
| `network`   | 연결이 거부되었거나 이름을 찾을 수 없거나 연결이 재설정되었습니다. 서버에서 URL, DNS, 방화벽을 확인하세요.                                                  |
| `tls`       | 인증서를 신뢰할 수 없거나 만료되었거나 이름이 맞지 않습니다. 고치거나 `ARKVORY_WEBHOOKS_CA_FILE`을 설정하세요.                                              |
| `redirect`  | 수신자가 `3xx`로 응답했습니다. 리디렉션은 따라가지 않으니 최종 URL을 사용하세요.                                                                            |
| `http_4xx`  | 수신자가 요청을 거부했습니다. 수신자의 서명 검사, 경로, 키를 확인하세요.                                                                                    |
| `http_5xx`  | 수신자에 장애가 있습니다. Arkvory는 최대 한 시간 간격으로 계속 다시 시도합니다.                                                                             |
| `secret`    | 시크릿 파일이 없거나 읽을 수 없거나 16바이트보다 짧습니다.                                                                                                  |

아무것도 오지 않나요? worker 로그에 `webhook.started`가 있는지, `ARKVORY_WEBHOOKS_FILE`이 설정되었는지, 리포지토리 이름과 `actions` 필터를 확인하세요. 새 구독은 첫 단계 이후의 이벤트만 보냅니다.

## 관련 페이지 {#related-pages}

- [구성](../install/configuration)
- [모니터링](../operate/monitoring)
- [API 레퍼런스의 변경 피드](../api/reference/artifacts#listCatalogChanges)
