---
title: 인증
description: Arkvory HTTP API에 인증하는 모든 방법, 각 자격 증명이 할 수 있는 일, 액세스 규칙과 리포지토리 작업이 동작하는 방식.
---

# 인증

`/api/v1`에 대한 모든 호출에는 자격 증명이 필요합니다. 공개 상태 확인, 로그인 옵션, 로그인, 등록은 예외입니다. 이 페이지에서는 자격 증명의 종류, 각각을 얻고 보내는 방법, [API 참조](./index#reference-pages)의 액세스 규칙이 의미하는 바를 설명합니다. 액세스를 관리하는 사람에 대한 규칙은 [계정과 액세스](../use/accounts)를 참조하세요.

## 자격 증명 한눈에 보기 {#credentials}

| 자격 증명          | 형태          | 얻는 방법                                           | 수명                  | 용도                                       |
| ------------------ | ------------- | --------------------------------------------------- | --------------------- | ------------------------------------------ |
| 콘솔 세션          | `dps_…`       | 이름과 비밀번호로 로그인                            | 12시간                | 콘솔의 사용자, 또는 로그인하는 스크립트    |
| 개인용 액세스 토큰 | `pat_…`       | 세션에서 생성                                       | 기본 90일, 최대 365일 | 한 사람의 스크립트와 도구                  |
| 서비스 키          | `arkvory_…`   | 서비스 계정에 발급한 뒤 활성화                      | 기본 90일, 최대 365일 | CI/CD, 배포 에이전트, 기타 시스템          |
| 복구 키            | 64자리 16진수 | 설치 프로그램이 `config/bootstrap-token.txt`에 기록 | 만료되지 않음         | 소유자 생성, 서비스 계정 관리, 액세스 복구 |
| 다운로드 링크      | `dtl_…`       | 하나의 아티팩트에 생성                              | 60초~24시간           | 키가 없는 사람에게 아티팩트 하나를 제공    |

자동화에는 서비스 키를, 개인의 도구에는 개인용 액세스 토큰을 사용하세요. 일상 작업에 복구 키를 사용하지 마세요.

## 헤더 형식 {#headers}

`/api/v1`은 하나의 헤더로 자격 증명을 받습니다:

```http
Authorization: Bearer <credential>
```

- 자격 증명은 32~512자입니다. 그 외의 길이는 즉시 `credential_invalid`입니다.
- 컨테이너 레지스트리(`/v2`), Git LFS(`/lfs`), npm 레지스트리(`/npm`)는 HTTP Basic도 허용합니다. `docker login`, git, npm이 그렇게 자격 증명을 보내기 때문입니다. 사용자 이름은 확인하지 않으며 비밀번호가 자격 증명입니다. [클라이언트와 프로토콜](../protocols/index#credentials)을 참조하세요.
- 다운로드 링크는 쿼리 문자열에 `?token=dtl_…` 형태로 들어가며, 하나의 아티팩트 콘텐츠 경로에서만 동작합니다. [다운로드 링크](#download-links)를 참조하세요. `Authorization` 헤더는 항상 쿼리보다 우선합니다.
- 유효한 자격 증명이 없는 요청은 `WWW-Authenticate: Bearer`와 사유 `credential_missing`, `credential_invalid`, `session_expired`, `token_expired` 중 하나와 함께 `401`을 받습니다. 만료된 자격 증명의 정확한 시크릿을 가진 사람만이 만료되었음을 알 수 있습니다.
- **쿠키 없음.** Arkvory는 쿠키를 설정하지도 읽지도 않으므로 브라우저가 스스로 자격 증명을 첨부하지 않으며 방어할 교차 사이트 요청 위조가 없습니다. 스크립트는 모든 호출에서 헤더를 보냅니다. 콘솔은 브라우저 탭의 메모리에 세션 토큰을 보관하고 탭을 닫으면 잊어버립니다.
- **다른 origin.** Arkvory와 같은 주소의 페이지는 아무것도 필요하지 않습니다. 다른 주소의 페이지는 관리자가 `ARKVORY_CORS_ORIGINS`에 origin을 나열하지 않는 한 유효한 자격 증명이 있어도 사유 `origin_not_allowed`와 함께 `403`으로 거부됩니다. HTTPS를 사용하세요. 일반 HTTP의 자격 증명은 네트워크에서 읽을 수 있습니다. [HTTPS](../install/https)를 참조하세요.

자격 증명이 무엇이고 무엇을 할 수 있는지 확인하세요:

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_KEY" "$ARKVORY_URL/api/v1/auth/me"
curl -fsS -H "Authorization: Bearer $ARKVORY_KEY" "$ARKVORY_URL/api/v1/auth/permissions"
```

## 콘솔 로그인 세션 {#sessions}

사용자는 이름과 비밀번호로 로그인하여 세션을 받습니다. 콘솔이 대신 처리하며, 스크립트도 같은 작업을 할 수 있습니다.

1. 이름과 비밀번호를 비공개 파일 `login.json`에 넣어 명령줄이나 프로세스 목록에 나타나지 않게 하세요:

   ```json
   { "name": "alice", "password": "a long password of 12 to 128 characters" }
   ```

2. `login`을 호출합니다:

   ```bash
   curl -fsS -X POST "$ARKVORY_URL/api/v1/auth/login" \
     -H "Content-Type: application/json" -d @login.json
   ```

3. 응답에는 세션 토큰과 종료 시각이 있습니다:

   ```json
   {
     "token": "dps_…",
     "expiresAt": "2026-10-05T21:30:00.000Z",
     "account": { "id": "…", "name": "alice", "administrator": false, "enabled": true }
   }
   ```

4. 토큰을 `Authorization: Bearer dps_…`로 보냅니다.

세션 규칙:

- 12시간 동안 지속되며 연장되지 않습니다. 그 이후 모든 호출은 사유 `session_expired`와 함께 `401`을 반환합니다. 다시 로그인하세요.
- 계정은 최대 32개의 세션을 가집니다. 새 로그인은 그 이상의 가장 오래된 세션을 종료합니다.
- `POST /api/v1/auth/logout`은 세션을 종료합니다. 비밀번호를 변경하거나 관리자가 재설정하면 계정의 모든 세션과 모든 개인용 토큰이 종료됩니다. 계정을 비활성화하면 이들도 중지됩니다.
- 세션은 관리자 플래그를 포함하여 계정의 모든 권한을 가집니다. 개인용 토큰을 만들고 폐기하며 계정 자체의 비밀번호를 변경할 수 있는 것은 세션뿐입니다.
- 이름은 대소문자를 구분하지 않고 비교됩니다. 잘못된 이름, 잘못된 비밀번호, 비활성화된 계정은 모두 사유 `invalid_credentials`와 함께 같은 `401`을 줍니다.
- 읽기 게이트웨이는 누구도 로그인시키지 않습니다. 작성자를 사용하세요.

### 자기 등록 {#self-registration}

`GET /api/v1/auth/options`는 공개이며 사용자가 스스로 계정을 만들 수 있는지 알려줍니다. 관리자가 `ARKVORY_ALLOW_REGISTRATION=true`로 설정하지 않으면 자기 등록은 꺼져 있습니다. 그 경우 로그인과 같은 본문으로 `POST /api/v1/auth/register`를 호출하면 일반 계정(관리자가 아니며 어떤 리포지토리에도 액세스할 수 없음)을 만들고 `201`과 함께 세션을 반환합니다. 그렇지 않으면 사유 `registration_disabled`와 함께 `403`을 응답합니다. 자기 등록은 900개 계정에서 멈추므로 관리자는 1,000개 한도까지 계정을 만들 수 있습니다.

## 개인용 액세스 토큰 {#personal-tokens}

개인용 액세스 토큰을 사용하면 스크립트가 비밀번호 없이 사용자로 행동할 수 있습니다. 로그인한 세션만이 만들 수 있습니다.

```bash
curl -fsS -X POST "$ARKVORY_URL/api/v1/auth/tokens" \
  -H "Authorization: Bearer $SESSION" -H "Content-Type: application/json" \
  -d '{"name":"laptop-cli","scope":"read-write","expiresAt":"2026-12-31T00:00:00Z"}'
```

콘솔에서 [[ui:personalAccessTokens]]를 열고, [[ui:connection]] 카드에서 [[ui:tokenName]]을 입력한 뒤 [[ui:tokenScope]]와 [[ui:tokenExpiry]]를 선택하고 [[ui:generateToken]]을 선택합니다.

| 필드        | 규칙                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `name`      | 1~64자.                                                                                                           |
| `scope`     | `read` 또는 `read-write`. 생략하면 API는 `read-write`를 사용하며, 콘솔은 [[ui:tokenScopeRead]]를 먼저 제공합니다. |
| `expiresAt` | 미래의 RFC 3339 시각으로, 최대 365일 이내입니다. 기본값은 90일입니다. 종료가 없는 토큰은 없습니다.                |

`201` 응답에는 토큰이 `token`으로 한 번 포함됩니다. 그때 저장하세요. 서버는 해시만 보관하고 목록에는 짧은 접두사만 표시됩니다. 그런 다음:

- 토큰은 계정의 리포지토리 액세스를 가질 뿐 그 이상은 없습니다. 관리자 플래그를 절대 가지지 않으므로 계정, 그룹, 업데이트, 백업을 관리할 수 없습니다.
- `read` 토큰은 읽기만 할 수 있습니다. `logout`을 제외하고 무언가를 변경하는 모든 요청은 작업이 실행되기 전에 `403`과 사유 `read_only_token`으로 거부됩니다.
- 토큰은 토큰을 만들거나 비밀번호를 변경할 수 없습니다. 그런 작업에는 세션이 필요합니다.
- 계정은 최대 50개의 활성 토큰을 가집니다. `GET /api/v1/auth/tokens`가 접두사, 범위, 종료, 마지막 사용과 함께 나열합니다. `DELETE /api/v1/auth/tokens/{id}`는 즉시 하나를 폐기합니다(콘솔의 [[ui:revokeToken]]). 관리자는 모든 계정의 토큰을 나열하고 폐기할 수 있습니다.
- 만료된 토큰은 사유 `token_expired`와 함께 `401`을 반환합니다.

## 서비스 계정과 키 {#service-accounts}

**서비스 계정**은 빌드 에이전트 같은 도구를 위한 ID입니다. **정책**을 가지며, 이는 **바인딩** 목록으로 각각 하나의 리포지토리와 그곳에서 허용되는 정확한 **작업**을 지정합니다([리포지토리 작업](#repository-actions) 참조). 정책은 최대 64개의 바인딩을 가집니다. 계정은 자신의 키가 시작한 업로드와 작업을 소유하므로 키를 교체해도 잃는 것이 없습니다. 서버는 최대 1,000개의 서비스 계정을 가집니다.

[복구 키](#recovery-key)만이 서비스 계정을 만듭니다. 복구 키 또는 [위임](#delegation)을 가진 운영자가 기존 계정을 변경합니다. 콘솔에서는 [[ui:services]]를 사용합니다: [[ui:serviceCreate]]를 누른 뒤 [[ui:servicePolicy]]를 설정합니다. [[ui:bindingRead]]는 일곱 개의 읽기 작업을 채우고, [[ui:bindingPublish]]는 패키지를 업로드하고 등록하는 데 필요한 작업을 추가합니다.

```bash
curl -fsS -X POST "$ARKVORY_URL/api/v1/service-accounts" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" \
  -d '{"name":"ci-release","bindings":[{"resource":{"kind":"repository","id":"releases"},
       "actions":["repository.read","artifact.read","upload.create","upload.read","upload.write",
                  "upload.complete","upload.cancel","job.read","package.publish"]}]}'
```

이름은 3~64자의 문자, 숫자, `_`, `.`, `-`를 사용합니다. 정책을 변경하려면 읽은 `expectedRevision`과 함께 `PUT /api/v1/service-accounts/{id}/policy`를 보내세요([비교 후 교체](./index#revisions)). 계정을 끄려면 `{"expectedRevision": n, "enabled": false}`와 함께 `PATCH /api/v1/service-accounts/{id}`를 보내세요. 다시 켤 때까지 모든 키가 작동을 멈춥니다.

### 서비스 키 {#service-keys}

키는 서비스 계정이 로그인하는 시크릿입니다. `arkvory_<uuid>.<secret>` 형태입니다. 키는 `pending`, `active`, `revoked` 세 가지 상태를 거칩니다.

1. **발급.** `Idempotency-Key`, `name`, 키가 사용할 수 있는 `bindings`, 그리고 원한다면 `expiresAt`(UTC, 365일 이내, 기본 90)과 함께 `POST /api/v1/service-accounts/{id}/keys`를 보내세요. 키의 바인딩은 계정의 정책 안에 있어야 합니다. `201` 응답에는 키의 메타데이터와, 이번 한 번만, `secret`이 포함됩니다. 같은 멱등성 키로 반복하면 시크릿 없이 메타데이터와 함께 `200`을 반환합니다.
2. **활성화.** 새 키는 `pending`이며 새 시크릿을 자격 증명으로 사용하는 한 번의 호출 `POST /api/v1/auth/activate-key` 외에는 사용할 수 없습니다. 응답은 `204`입니다. 15분 이내에 하세요. 그 이후에는 키가 사용되지 않고 만료됩니다. 콘솔에서 시크릿을 복사하고 [[ui:keySaved]]를 선택한 다음 [[ui:keyActivate]]를 선택합니다. 다시 활성화해도 무해합니다.
3. **사용.** 키는 `expiresAt`까지, 또는 폐기되거나 계정이 비활성화될 때까지 작동합니다.

```bash
curl -fsS -X POST "$ARKVORY_URL/api/v1/service-accounts/$ACCOUNT/keys" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Idempotency-Key: ci-release-2026-10" \
  -H "Content-Type: application/json" \
  -d '{"name":"ci-release-2026-10","bindings":[{"resource":{"kind":"repository","id":"releases"},
       "actions":["upload.create","upload.read","upload.write","upload.complete","job.read"]}]}'
curl -fsS -X POST "$ARKVORY_URL/api/v1/auth/activate-key" -H "Authorization: Bearer $NEW_SECRET"
```

한도: 계정은 동시에 최대 3개의 활성 키와 2개의 대기 중 키를 가집니다(사유 `key_limit`과 함께 `507`).

**교체.** `POST /api/v1/api-keys/{id}/rotate`는 같은 계정에 새 대기 중 키를 발급하며, 발급과 같은 본문과 `Idempotency-Key`를 사용합니다. 그 바인딩은 이전 키의 범위 안에 있어야 합니다. 새 키를 활성화하면 이전 키의 종료가 그 시점부터 최대 24시간으로 줄어듭니다. 도구를 새 키로 옮긴 뒤 이전 키를 폐기하세요. 콘솔: [[ui:keyRotate]].

**폐기.** `POST /api/v1/api-keys/{id}/revoke`는 키를 영구히 종료합니다. 반복해도 무해합니다. 콘솔: [[ui:keyRevoke]]. 키를 폐기해도 이미 시작된 전송은 멈추지 않습니다. 대기 중 키의 시크릿을 잃어버렸나요? 폐기하고 새 멱등성 키로 새로 발급하세요.

### 위임 {#delegation}

복구 키는 관리의 일부를 **운영자**에게 넘길 수 있습니다. 운영자는 다른 서비스 계정을 관리할 수 있는 키를 가진 서비스 계정입니다. **위임**은 운영자의 키, 대상 계정, 운영자가 대상에 사용할 수 있는 **관리 작업**, 그리고 운영자가 부여할 수 있는 리포지토리 작업인 **상한**을 지정합니다. 일곱 개의 관리 작업은 다음과 같습니다:

| 작업                     | 허용                                  |
| ------------------------ | ------------------------------------- |
| `service-account.read`   | 목록에서 계정을 보고 카드를 읽습니다. |
| `service-account.manage` | 계정을 켜거나 끕니다.                 |
| `policy.read`            | 계정의 정책을 읽습니다.               |
| `policy.manage`          | 계정의 정책을 교체합니다.             |
| `credential.read`        | 계정의 키를 나열하고 키를 읽습니다.   |
| `credential.manage`      | 키를 발급, 교체, 폐기합니다.          |
| `service-audit.read`     | 계정의 키 기록을 읽습니다.            |

규칙: 운영자의 키는 복구 키가 발급한 것이어야 합니다. 운영자는 자신의 계정을 관리하지 않습니다. 상한 밖이나 계정 정책을 넘어서는 것은 부여할 수 없습니다. 운영자가 발급한 키는 운영자 자신의 키보다 오래 살 수 없습니다. 위임을 끝내도 이미 활성화된 키는 폐기되지 않습니다. 계정을 만들고 위임을 설정하는 것은 복구 키뿐입니다(`PUT`, `DELETE /api/v1/api-keys/{id}/delegations/{accountId}`). 하나의 운영자 키는 최대 64개의 위임을 가질 수 있습니다. 콘솔에서는 [[ui:delegations]]를 사용하세요. 위임 범위 밖의 것이 필요한 운영자는 관리하지 않는 계정에 대해 `404` 또는 `403`을 받습니다.

## 복구 키 {#recovery-key}

설치 프로그램은 **복구 키**를 한 번 만들고 [설치 루트](../install/index#installation-directory)의 `config/bootstrap-token.txt`에 기록합니다. Windows에서는 Administrators 그룹만, Linux에서는 root만 파일을 읽을 수 있습니다. 해시는 서버의 키 파일(`ARKVORY_KEYS_FILE`)에 `bootstrap-owner`라는 이름으로 있습니다. 설치 프로그램은 리포지토리 권한이 전혀 없는 두 번째 키인 `config/health-token.txt`도 만듭니다. 이 키는 인증된 상태 확인과 메트릭을 호출할 수 있습니다.

복구 키가 할 수 있는 일:

- 첫 계정과 그 이후의 모든 계정을 만들고, 비밀번호를 재설정하고, 계정을 비활성화하며, 그룹과 그룹의 리포지토리 권한을 관리합니다.
- 보안 감사를 읽고 모든 계정의 개인용 토큰을 폐기합니다.
- 서비스 계정을 만들고, 정책을 설정하고, 키를 발급 및 폐기하며, 위임을 설정합니다.
- 백업과 업데이트를 읽고 요청하며, 피드백을 위해 서버 로그를 다운로드합니다.
- [[ui:write]] 액세스를 가진 그룹의 구성원처럼 `releases` 리포지토리를 읽고 씁니다.

할 수 없는 일: `releases` 이외의 리포지토리에 액세스할 수 없고, 아티팩트를 삭제하거나 스토리지 정책을 관리할 수 없으며(이러한 작업은 서비스 키에만 있음), 세션이 아니므로 개인용 토큰을 만들거나 비밀번호를 변경할 수 없습니다. 서버에 보관하세요. 설치 도구가 거기서 읽습니다. CI에 넣지 말고 도구에 붙여 넣지 마세요. 대신 서비스 키를 만드세요. 교체하려면 [구성](../install/configuration)을 참조하세요.

콘솔의 [[ui:welcomeOwner]] 양식([[ui:navStart]] 아래)은 복구 키를 사용하여 첫 소유자를 만듭니다. 계정이 하나도 없을 때만 동작합니다. 세션 없이 기존 계정의 비밀번호를 재설정하려면 `GET /api/v1/users`로 ID를 찾고, 새 비밀번호(12~128자)를 비공개 파일에 넣어 복구 키와 함께 보내세요. 재설정은 해당 계정의 모든 세션과 토큰을 종료합니다.

```bash
echo '{"password": "a new password of 12 to 128 characters"}' > reset.json
curl -fsS -X PATCH "$ARKVORY_URL/api/v1/users/$USER_ID" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" -d @reset.json
rm reset.json
```

관리자는 키 파일에 다른 파일 키를 추가할 수 있습니다. 각 항목에는 `id`, 시크릿의 `sha256`, 받는 `repositories`와 `permissions`(`read`와 `write`), 그리고 선택적으로 `administrator`와 `serviceAdministrator` 플래그가 있습니다. 파일은 시작 시 읽히므로 변경 후 API와 워커를 다시 시작하세요.

## 다운로드 링크 {#download-links}

`POST /api/v1/repositories/{repository}/artifacts/{id}/links`는 하나의 아티팩트에 대해 `token`(`dtl_…`)과 `url`을 반환합니다. `ttlSeconds`로 수명을 요청합니다: 60~86,400, 기본 3,600. 호출자에게는 `content.read`가 필요합니다.

이 링크는 `/api/v1/repositories/{repository}/artifacts/{id}/content?token=…`의 `GET` 또는 `HEAD`로만, 해당 리포지토리의 해당 아티팩트에만, 읽기 전용으로 동작합니다. 시크릿입니다. 서버는 만료 전에 폐기할 수 없으며 로그에 나타나지 않습니다. 필요한 만큼 가장 짧은 수명의 링크를 만드세요.

## 액세스 규칙의 의미 {#access-rules}

참조의 모든 작업에는 **액세스** 줄이 있습니다. 다음과 같은 종류의 규칙이 있습니다:

| 참조의 규칙                                    | 요구 사항                                                                                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 키 없이 누구나                                 | 없음. 활성 상태, 준비 상태, 로그인 옵션, 로그인, 등록.                                                                                                                   |
| 유효한 키 또는 세션                            | 유효한 모든 자격 증명. 예: 기능, 작업 목록, 자신의 ID, 준비 상태 세부 정보, 메트릭.                                                                                      |
| 로그인한 계정 세션(키 아님)                    | 사용자의 세션. 개인용 토큰과 키는 거부됩니다(`session_required`). 예: 자신의 토큰 생성 및 폐기, 비밀번호 변경.                                                           |
| 관리자                                         | 관리자 계정의 세션, 또는 복구 키 같은 관리자 플래그가 있는 파일 키. 개인용 토큰과 서비스 키는 거부됩니다(`administrator_required`). 예: 계정, 그룹, 보안 감사, 업데이트. |
| 부트스트랩 키(설치 복구 키)                    | 서비스 관리 플래그가 있는 파일 키. 복구 키에 있습니다. 예: 서비스 계정 생성 및 위임 설정.                                                                                |
| 부트스트랩 키 또는 키 자체                     | 복구 키, 또는 위임이 나열되는 키.                                                                                                                                        |
| 발급된 키(활성화 전후)                         | 대기 중 키를 받는 유일한 작업: 활성화.                                                                                                                                   |
| 호출자가 볼 수 있는 리포지토리                 | 해당 리포지토리에 대한 `repository.read` 작업, 또는 세션/파일 키의 모든 액세스. 호출자가 볼 수 없는 리포지토리는 목록에서 빠지고 `404`를 응답합니다.                     |
| 시스템 권한 `backup.read` 또는 `backup.manage` | 관리자 세션과 관리자 플래그가 있는 파일 키가 가집니다. 서비스 키와 개인용 토큰은 절대 가지지 않습니다. `backup.manage`에는 `backup.read`가 포함됩니다.                   |
| 서비스 관리 권한                               | 위임 또는 복구 키에서 대상 계정에 대한 일곱 개의 [관리 작업](#delegation) 중 하나.                                                                                       |
| 리포지토리 권한                                | 경로에 명명된 리포지토리에서 나열된 **모든** 리포지토리 작업. 일부 액세스 규칙은 조건을 추가합니다: 업로드, 작업 또는 참조가 호출자에게 속해야 합니다.                   |

리포지토리 줄의 두 번째 부분(예: "file keys: `read`, `write`")은 사람과 파일 키가 정확한 작업 대신 필요한 대략적인 권한입니다. [그룹 권한](#group-grants)을 참조하세요.

액세스 규칙 외에도, 서버는 미러인 리포지토리의 변경을 거부하며(`409`, `mirror_read_only`), 읽기 게이트웨이는 모든 변경을 거부합니다(`405`, `read_only`).

## 리포지토리 권한 {#repository-permissions}

### 그룹 권한 {#group-grants}

사용자는 **그룹**을 통해 리포지토리 액세스를 얻습니다. 관리자가 그룹에 리포지토리의 `read` 또는 `write`("읽기 및 쓰기"로 표시)를 부여하고 그룹에 계정을 추가합니다. 콘솔에서: [[ui:administration]], 그다음 [[ui:manageGrants]]와 [[ui:saveGrant]]. API 호출은 `{"access": "read"}` 또는 `{"access": "write"}`와 함께 `PUT /api/v1/access-groups/{id}/grants/{repository}`, 그리고 `PUT /api/v1/access-groups/{id}/members/{userId}`입니다. 권한은 모든 요청에서 다시 계산되므로 변경이 즉시 적용됩니다.

`read` 권한은 다음 작업을 부여합니다: `repository.read`, `artifact.read`, `artifact.list`, `content.read`, `package.read`, `asset.read`, `annotation.read`. `write` 권한은 `upload.create`, `upload.read`, `upload.write`, `upload.complete`, `upload.cancel`, `job.read`, `package.publish`, `asset.write`, `asset.restore`, `annotation.write`, `reference.write`, `artifact.promote`, `audit.read`를 추가합니다. `artifact.delete`, `storage.read`, `storage.manage`, `diagnostics.read` 작업은 그룹에서 나올 수 없습니다: 서비스 키만 가질 수 있습니다.

### 리포지토리 작업 {#repository-actions}

서비스 키는 리포지토리별로 정확한 작업을 가집니다. 24개가 있습니다:

| 작업               | 허용                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `repository.read`  | 리포지토리와 미러 상태를 봅니다.                                                                                  |
| `artifact.read`    | 아티팩트의 세부 정보, 스테이지, 승격을 읽습니다. 아티팩트 변경 시에도 필요합니다.                                 |
| `artifact.list`    | 아티팩트를 나열하고 검색하며, 스테이지된 아티팩트를 나열하고, 승격 일지와 변경 피드를 읽습니다.                   |
| `artifact.promote` | 스테이지를 설정 및 제거하고, 다른 리포지토리로 승격(복사 또는 이동)합니다.                                        |
| `artifact.delete`  | 아티팩트를 삭제하고, 보존을 미리 보고 적용하며, 컨테이너 이미지를 제거하고 Git LFS 파일의 잠금을 강제 해제합니다. |
| `content.read`     | ID, 패키지, 경로별로 바이트를 다운로드하고 다운로드 링크를 만듭니다.                                              |
| `upload.create`    | 업로드 세션을 만듭니다. 레지스트리로의 푸시와 Git LFS가 사용합니다.                                               |
| `upload.read`      | 자신의 업로드 세션과 파트를 읽습니다.                                                                             |
| `upload.write`     | 자신의 업로드 파트 또는 전체 콘텐츠를 보냅니다.                                                                   |
| `upload.complete`  | 자신의 업로드를 완료하거나 완료를 대기열에 추가합니다.                                                            |
| `upload.cancel`    | 자신의 대기 중 업로드를 취소합니다.                                                                               |
| `job.read`         | 자신의 완료 작업을 읽습니다.                                                                                      |
| `package.read`     | 패키지를 나열하고, 버전을 확인하고, 패키지를 다운로드합니다.                                                      |
| `package.publish`  | UPack 아카이브를 패키지로 등록합니다.                                                                             |
| `asset.read`       | 경로별 파일을 나열하고 포인터, 기록, 리비전을 읽습니다. 바이트 다운로드에는 `content.read`가 필요합니다.          |
| `asset.write`      | 경로를 아티팩트로 지정하거나 원시 파일을 저장합니다.                                                              |
| `asset.restore`    | 경로의 이전 리비전을 복원합니다.                                                                                  |
| `annotation.read`  | 레이블, 메타데이터, 컬렉션, 첨부 파일을 읽습니다.                                                                 |
| `annotation.write` | 레이블, 메타데이터, 컬렉션, 첨부 파일을 교체합니다.                                                               |
| `reference.write`  | 아티팩트를 보호하는 참조를 추가 및 제거합니다.                                                                    |
| `audit.read`       | 리포지토리의 카탈로그 감사를 읽습니다.                                                                            |
| `storage.read`     | 할당량, 사용량, 스토리지 정책, 정리 설정을 읽습니다.                                                              |
| `storage.manage`   | 스토리지 정책과 정리 설정을 변경하고 정리를 실행합니다.                                                           |
| `diagnostics.read` | 스토리지 이벤트를 읽습니다.                                                                                       |

작업에 필요한 정확한 집합은 참조의 해당 줄에 있습니다. 예를 들어 `putUploadContent`에는 `upload.write`와 `upload.complete`가 필요합니다. 리포지토리 변경에는 대응하는 `read` 작업도 필요합니다. 예: `annotation.write`와 함께 `artifact.read`.

소유자 조건은 업로드와 작업에 적용됩니다: 자신의 계정이 만든 업로드 세션과 완료 작업에만 작용합니다. 하나의 서비스 계정의 모든 키와 한 사람의 모든 세션 및 토큰은 같은 소유자로 간주됩니다. 따라서 한 리포지토리의 여러 서비스는 경로 접두사가 아니라 계정과 리포지토리로 구분됩니다.

### 관리 및 시스템 권한 {#administration-permissions}

다른 두 종류의 권한은 리포지토리 작업이 아닙니다. 일곱 개의 관리 작업은 [위임](#delegation) 아래에 나열되어 있습니다. 두 시스템 권한 `backup.read`와 `backup.manage`는 관리자와 복구 키에만 속합니다.

## 로그인 한도 {#sign-in-limits}

서버는 비밀번호를 확인하기 전에 비밀번호 추측을 늦춥니다. 카운터는 각 API 프로세스의 메모리에 있으며 다시 시작하면 초기화됩니다. 클라이언트 주소별로 적용되며, IPv6 주소는 /64 접두사로 계산됩니다. 리버스 프록시 뒤에서는 `ARKVORY_TRUSTED_PROXIES`를 설정하세요. 그렇지 않으면 모든 클라이언트가 프록시로 나타납니다.

| 제한                   | 값                                                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 주소당 로그인 시도     | 처음 10회까지 버스트, 이후 15초마다 1회. 성공한 로그인은 시도를 사용하지 않습니다.                                                                                                                                                          |
| 계정당 실패한 비밀번호 | 잘못된 비밀번호마다 부채가 1 증가하며 6초마다 1 감소합니다. 20을 넘으면 계정은 1초 동안 시도를 거부하고, 추가 실패마다 2분까지 두 배로 늘어납니다. 그동안은 올바른 비밀번호도 `429`를 받습니다. 성공한 로그인이나 재설정은 부채를 지웁니다. |
| 주소당 등록            | 3회, 이후 20분마다 1회.                                                                                                                                                                                                                     |
| 서버당 등록            | 20회, 이후 3분마다 1회.                                                                                                                                                                                                                     |
| 진행 중인 로그인 요청  | API 프로세스당 16개이며 본문은 10초 안에 도착해야 합니다. 초과하면 코드 `busy`와 함께 `503`을 반환합니다.                                                                                                                                   |

거부된 시도는 코드 `rate_limited`, 사유 `login_attempts`, `registration_attempts`, `password_attempts` 중 하나, 그리고 초 단위의 `Retry-After`와 함께 `429`를 반환합니다. 그만큼 기다리세요. 반복문으로 재시도하지 마세요. 비밀번호 변경이나 재설정에는 자체 게이트와 사유 `password_attempts`가 있습니다. 모든 로그인, 등록, 비밀번호 변경, 토큰 변경은 보안 감사(`GET /api/v1/security/audit`, 관리자 전용)에 기록되며 365일 보관됩니다.

## 관련 페이지 {#related}

- [HTTP API 개요](./index)
- [오류](./errors)
- [계정과 액세스](../use/accounts)
- [보안](../operate/security)
- [클라이언트와 프로토콜](../protocols/index)
- 참조: [계정과 로그인](./reference/accounts), [서비스 계정과 키](./reference/services)
