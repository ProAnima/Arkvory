---
title: 계정 및 액세스
description: 사용자와 그룹을 만들고, 리포지토리에 대한 액세스를 부여하고, CI용 개인용 토큰과 서비스 키를 발급합니다.
---

# 계정 및 액세스

Arkvory는 네 가지 자격 증명을 사용합니다. 사람은 비밀번호로 로그인합니다. 본인의 도구는 개인용 액세스 토큰을 사용합니다. CI 시스템과 배포 에이전트는 서비스 키를 사용합니다. 설치 프로그램은 설정과 비상 상황을 위해 복구 키라는 키를 하나 더 만듭니다. 서버는 모든 요청을 그 요청과 함께 전달된 자격 증명을 기준으로 검사합니다.

## 누가 무엇을 할 수 있는가 {#overview}

| 자격 증명          | 생성 주체                    | 유효 기간             | 관리                               | 리포지토리 액세스                       |
| ------------------ | ---------------------------- | --------------------- | ---------------------------------- | --------------------------------------- |
| 비밀번호 세션      | 로그인                       | 12시간                | 계정이 관리자인 경우 사용자와 그룹 | 그룹을 통한 리포지토리별 읽기 또는 쓰기 |
| 개인용 액세스 토큰 | 본인(비밀번호 세션에서)      | 기본 90일, 최대 365일 | 불가                               | 본인이 속한 그룹(선택적으로 읽기 전용)  |
| 서비스 키          | 복구 키 또는 위임받은 운영자 | 기본 90일, 최대 365일 | 소유자가 위임한 범위만             | 서비스 계정 정책(키로 더 좁힘)          |
| 복구 키            | 설치 프로그램                | 교체할 때까지         | 사용자, 그룹, 서비스 계정, 백업    | `releases`에 대한 읽기 및 쓰기          |

놓치기 쉬운 점이 세 가지 있습니다.

- 관리자 계정은 사용자와 그룹을 관리합니다. 파일에 대한 액세스는 부여하지 않습니다. 파일에는 그룹에 부여된 권한을 통해서만 접근할 수 있습니다.
- 서비스 키는 비밀번호 세션이 아니라 복구 키 또는 운영자 키로 만듭니다. 비밀번호로 로그인한 관리자는 서비스 계정을 만들 수 없습니다.
- 개인용 토큰이나 서비스 키로는 사용자, 그룹, 다른 토큰을 만들 수 없습니다.

## 소유자와 복구 키 {#owner}

첫 번째 계정이 소유자입니다. 소유자는 관리자입니다. Windows에서는 설치 마법사가 소유자를 만듭니다. Linux와 Docker에서는 [웹 콘솔](../guide/console#the-first-owner)에 설명된 대로 콘솔에서 복구 키로 소유자를 만듭니다.

소유자는 `arkvory-owners` 그룹의 구성원이며, 이 그룹은 `releases` 리포지토리에 대한 쓰기 액세스를 가집니다. 다른 리포지토리에는 직접 그룹 액세스를 부여하세요. [그룹과 리포지토리 액세스](#groups)를 참조하세요.

복구 키는 설치 디렉터리의 `config/bootstrap-token.txt` 파일입니다. 서버 관리자만 읽을 수 있습니다. CI나 클라이언트 컴퓨터에 복사하지 마세요. 설치 및 업데이트 도구가 이 키를 읽으므로 삭제하지 마세요. [보안](../operate/security)을 참조하세요.

## 사용자 만들기 {#users}

사용자는 관리자만 만들 수 있습니다. 이름은 문자, 숫자, `.`, `_`, `-`로 이루어진 3~64자입니다. 비밀번호는 12~128자입니다. 설치 하나에 최대 1000개의 계정을 둘 수 있습니다.

콘솔에서 만드는 방법은 다음과 같습니다.

1. 관리자로 로그인하고 [[ui:administration]] 섹션을 여세요.
2. [[ui:createUser]] 항목을 펼치세요.
3. [[ui:accountName]] 필드와 [[ui:password]] 필드에 값을 입력하세요. 사용자를 관리하는 사람에게만 [[ui:administrator]] 확인란을 선택하세요.
4. [[ui:createUser]] 버튼을 선택하세요.

[[ui:accountsHeading]] 표에 계정이 나열됩니다. [[ui:disableUser]] 버튼은 계정을 차단합니다. 계정의 세션이 즉시 종료되고, [[ui:enableUser]] 버튼을 선택할 때까지 개인용 토큰이 작동하지 않습니다. 다른 사람의 비밀번호를 새로 설정하려면 [[ui:resetPassword]] 항목을 펼치세요. 이렇게 하면 해당 계정의 세션이 종료되고 모든 개인용 토큰이 폐기됩니다.

API에서는 관리자 세션 또는 복구 키로 `createUser`, `updateUser`, `listUsers` 작업을 호출합니다.

```bash
curl -X POST "$ARKVORY/api/v1/users" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"anna","password":"a long password here","administrator":false}'
```

```typescript
await client.administration.users.create('anna', 'a long password here', false);
```

`arkvoryctl`에는 계정 관련 명령이 없습니다. 콘솔이나 API를 사용하세요.

직접 가입은 기본적으로 꺼져 있습니다. 서버 관리자가 `ARKVORY_ALLOW_REGISTRATION=true`로 켭니다([환경 변수](../reference/environment) 참조). 그러면 로그인 카드에 [[ui:signUp]] 버튼이 나타납니다. 새 계정은 관리자가 그룹에 추가하기 전까지 어떤 리포지토리에도 접근할 수 없습니다. 직접 가입은 계정이 900개가 되면 중단되므로, 관리자용으로 100개의 자리가 남습니다.

## 그룹과 리포지토리 액세스 {#groups}

사람은 그룹을 통해 액세스를 얻습니다. 그룹에는 구성원이 있으며, 리포지토리마다 액세스 수준이 하나씩 지정됩니다.

| 콘솔의 수준  | 의미                                                               |
| ------------ | ------------------------------------------------------------------ |
| [[ui:read]]  | 조회 및 다운로드                                                   |
| [[ui:write]] | 읽기의 모든 작업, 그리고 업로드, 게시, 메타데이터 변경, 승격, 복원 |

리포지토리를 만드는 별도의 단계는 없습니다. 액세스 부여나 서비스 정책에 이름이 지정되는 즉시 리포지토리가 존재합니다. 이름은 영문 소문자, 숫자, `-`, `_`를 사용하고, 문자 또는 숫자로 시작하며, 최대 64자입니다. [리포지토리](./repositories)를 참조하세요.

콘솔에서 [[ui:administration]] 섹션을 여세요.

1. [[ui:createGroup]] 항목을 펼치고 [[ui:accessGroup]] 이름(문자, 숫자, `.`, `_`, `-`로 이루어진 2~64자)을 입력한 다음 [[ui:createGroup]] 버튼을 선택하세요.
2. [[ui:manageMembers]] 항목을 펼치고 그룹과 계정을 선택한 다음 [[ui:addMember]] 버튼을 선택하세요. [[ui:removeMember]] 버튼은 계정을 그룹에서 제거합니다.
3. [[ui:manageGrants]] 항목을 펼치고 그룹을 선택하세요. [[ui:repository]] 필드에 리포지토리 이름을 입력하고 [[ui:access]] 수준을 선택한 다음 [[ui:saveGrant]] 버튼을 선택하세요. [[ui:removeGrant]] 버튼은 액세스를 제거합니다.

양식 아래의 표에는 모든 그룹의 [[ui:members]] 정보와 [[ui:grants]] 정보가 표시됩니다. 구성원이나 부여된 권한을 제거하면 해당 계정의 다음 요청부터 적용됩니다. 파일은 그대로 남습니다.

설치 하나에는 그룹을 최대 100개, 구성원 관계를 총 10 000개, 부여된 권한을 총 10 000개까지 둘 수 있습니다.

API 작업은 `createAccessGroup`, `addGroupMember`, `removeGroupMember`, `setGroupGrant`, `removeGroupGrant`입니다.

```bash
curl -X PUT "$ARKVORY/api/v1/access-groups/$GROUP_ID/grants/builds" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"access":"write"}'
```

```typescript
await client.administration.groups.setGrant(groupId, 'builds', 'write');
```

## 권한 {#permissions}

읽기와 쓰기 두 수준 뒤에는 24개의 리포지토리 작업이 있습니다. 서비스 키는 이러한 작업을 하나씩 지정합니다. `arkvoryctl doctor`와 `GET /api/v1/auth/permissions`는 현재 자격 증명이 리포지토리별로 가진 작업을 보여 줍니다.

| 작업               | 콘솔 레이블                        | 허용하는 내용                                                                    |
| ------------------ | ---------------------------------- | -------------------------------------------------------------------------------- |
| `repository.read`  | [[ui:permission.repository.read]]  | 리포지토리를 나열하고 본인의 권한을 확인합니다. 파일 액세스는 포함되지 않습니다. |
| `artifact.list`    | [[ui:permission.artifact.list]]    | 아티팩트를 나열하고 검색하며, 스테이지 목록과 승격 저널을 읽습니다               |
| `artifact.read`    | [[ui:permission.artifact.read]]    | 아티팩트 하나의 세부 정보, 스테이지, 승격 기록                                   |
| `content.read`     | [[ui:permission.content.read]]     | 바이트 다운로드, 다운로드 링크 생성, 다운로드할 패키지 선택                      |
| `upload.create`    | [[ui:permission.upload.create]]    | 업로드 시작                                                                      |
| `upload.read`      | [[ui:permission.upload.read]]      | 본인 업로드의 상태와 파트 읽기                                                   |
| `upload.write`     | [[ui:permission.upload.write]]     | 본인 업로드의 바이트 전송                                                        |
| `upload.complete`  | [[ui:permission.upload.complete]]  | 본인 업로드 완료, 완료 작업 시작                                                 |
| `upload.cancel`    | [[ui:permission.upload.cancel]]    | 본인 업로드 취소                                                                 |
| `job.read`         | [[ui:permission.job.read]]         | 본인의 완료 작업 읽기                                                            |
| `package.read`     | [[ui:permission.package.read]]     | UPack 패키지 나열, 버전 선택                                                     |
| `package.publish`  | [[ui:permission.package.publish]]  | 업로드된 아카이브를 패키지로 등록                                                |
| `asset.read`       | [[ui:permission.asset.read]]       | 파일 경로, 경로의 기록, 리비전 읽기                                              |
| `asset.write`      | [[ui:permission.asset.write]]      | 아티팩트를 경로의 현재 콘텐츠로 지정                                             |
| `asset.restore`    | [[ui:permission.asset.restore]]    | 경로의 이전 리비전 복원                                                          |
| `annotation.read`  | [[ui:permission.annotation.read]]  | 레이블, 메타데이터, 컬렉션, 첨부 파일 읽기                                       |
| `annotation.write` | [[ui:permission.annotation.write]] | 레이블, 메타데이터, 컬렉션, 첨부 파일 변경                                       |
| `artifact.promote` | [[ui:permission.artifact.promote]] | 스테이지 추가 및 제거, 리포지토리로 승격                                         |
| `reference.write`  | [[ui:permission.reference.write]]  | 아티팩트에 본인의 외부 참조 추가 및 제거                                         |
| `audit.read`       | [[ui:permission.audit.read]]       | 리포지토리의 카탈로그 감사 읽기                                                  |
| `artifact.delete`  | [[ui:permission.artifact.delete]]  | 아티팩트 확인 및 삭제, 보존 규칙 미리 보기 및 적용                               |
| `storage.read`     | [[ui:permission.storage.read]]     | 스토리지 정책, 사용량, 정리 설정 읽기                                            |
| `storage.manage`   | [[ui:permission.storage.manage]]   | 스토리지 정책과 정리 설정 변경 및 실행                                           |
| `diagnostics.read` | [[ui:permission.diagnostics.read]] | 스토리지 이벤트 읽기                                                             |

그룹의 수준이 작업에 대응하는 방식은 다음과 같습니다.

- **읽기** 수준에는 `repository.read`, `artifact.list`, `artifact.read`, `content.read`, `package.read`, `asset.read`, `annotation.read`가 포함됩니다.
- **쓰기** 수준에는 읽기 수준의 모든 작업과 함께 `upload.create`, `upload.read`, `upload.write`, `upload.complete`, `upload.cancel`, `job.read`, `package.publish`, `asset.write`, `asset.restore`, `annotation.write`, `artifact.promote`, `reference.write`, `audit.read`가 포함됩니다.
- **어떤 그룹 수준에도 포함되지 않는** 작업은 `artifact.delete`, `storage.read`, `storage.manage`, `diagnostics.read`입니다. 아티팩트 삭제와 스토리지 관리는 이러한 작업을 지정한 서비스 키의 몫입니다. [스토리지 및 보존](../operate/storage)을 참조하세요.

미러는 다른 리포지토리의 읽기 전용 복사본입니다([미러](../operate/mirrors)). 부여된 권한과 관계없이 미러를 변경하는 모든 작업은 `409 mirror_read_only`로 거부됩니다.

## 비밀번호와 세션 {#passwords}

[[ui:connection]] 카드에서 [[ui:accountName]] 필드와 [[ui:password]] 필드로 로그인하세요. 세션은 12시간 동안 유지됩니다. [[ui:disconnect]] 버튼은 세션을 종료합니다.

내 비밀번호를 변경하려면 같은 카드의 [[ui:changeOwnPassword]] 항목을 사용하세요. [[ui:currentPassword]] 필드와 [[ui:newPassword]] 필드에 값을 입력합니다. 모든 세션과 개인용 토큰이 종료되므로, 다시 로그인하고 새 토큰을 만들어야 합니다. 관리자는 이전 비밀번호를 몰라도 다른 계정의 비밀번호를 재설정할 수 있습니다.

서버는 비밀번호 추측 시도를 늦춥니다.

- 네트워크 주소 하나에서 한 번에 10회까지 로그인을 시도할 수 있고, 그 이후에는 15초마다 1회씩 시도할 수 있습니다.
- 한 계정에 잘못된 비밀번호가 여러 번 입력되면 계정의 대기 시간이 점점 길어지며 최대 2분까지 늘어납니다. 이 대기 시간에는 올바른 비밀번호도 거부됩니다. 응답은 `Retry-After`가 포함된 `429 rate_limited`입니다.
- 리버스 프록시 뒤에서는 관리자가 프록시를 `ARKVORY_TRUSTED_PROXIES`에 지정합니다. 그렇지 않으면 모든 사용자가 하나의 주소를 공유하게 됩니다.

API에서 `login`은 이름과 비밀번호를 베어러 세션으로 교환하고, `changeOwnPassword`는 비밀번호를 변경합니다.

```bash
curl -X POST "$ARKVORY/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"name":"anna","password":"a long password here"}'
```

## 개인용 액세스 토큰 {#tokens}

개인용 액세스 토큰은 내 컴퓨터의 스크립트, `arkvoryctl`, SDK 같은 본인의 도구에서 사용하는 키입니다. 본인의 권한으로, 본인이 속한 그룹의 리포지토리에 대해 동작합니다.

토큰은 비밀번호 세션에서만 만들 수 있습니다. 토큰으로 다른 토큰을 만들 수 없으며 관리자 권한도 없습니다.

1. 비밀번호로 로그인하세요.
2. [[ui:connection]] 카드에서 [[ui:personalAccessTokens]] 항목을 펼치세요.
3. [[ui:tokenName]] 필드에 이름을 입력하세요. [[ui:tokenExpiry]] 목록에서 [[ui:tokenDays30]], [[ui:tokenDays90]], [[ui:tokenDays365]] 중 하나를 선택하세요.
4. [[ui:tokenScope]] 목록에서 [[ui:tokenScopeRead]] 옵션 또는 [[ui:tokenScopeReadWrite]] 옵션을 선택하세요. 읽기 토큰은 모든 변경을 `403 read_only_token`으로 거부합니다.
5. [[ui:generateToken]] 버튼을 선택한 다음 [[ui:copyToken]] 버튼을 선택하세요. 토큰은 한 번만 표시됩니다. 토큰은 `pat_`로 시작합니다.

표의 [[ui:tokenPrefix]], [[ui:tokenCreated]], [[ui:tokenExpires]], [[ui:tokenLastUsed]], [[ui:tokenStatus]] 열에 각 토큰의 정보가 표시됩니다. 상태는 [[ui:tokenActive]], [[ui:tokenExpired]], [[ui:tokenRevokedState]] 중 하나입니다. 토큰을 중지하려면 [[ui:revokeToken]] 버튼을 선택하고 [[ui:tokenRevokeConfirmSubmit]] 버튼으로 확인하세요. 해당 토큰을 사용하는 클라이언트는 즉시 액세스를 잃습니다.

계정 하나에 활성 토큰을 50개까지 둘 수 있습니다. 관리자는 `listAccountTokens`와 `revokeAccountToken`으로 모든 계정의 토큰을 나열하고 폐기할 수 있습니다.

API에서 토큰에는 이름이 있고, 선택적으로 만료 시각(지금부터 최대 365일)과 범위가 있습니다.

```bash
curl -X POST "$ARKVORY/api/v1/auth/tokens" \
  -H "Authorization: Bearer $SESSION" \
  -H "Content-Type: application/json" \
  -d '{"name":"laptop","scope":"read-write","expiresAt":"2027-01-31T00:00:00Z"}'
```

```typescript
const created = await client.identity.createToken('laptop', { scope: 'read-write' });
console.log(created.token); // shown once
```

API의 기본 범위는 `read-write`입니다. 콘솔에서는 [[ui:tokenScopeRead]] 옵션이 미리 선택되어 있습니다.

토큰은 비공개 파일에 저장하여 `arkvoryctl`에 전달하세요. [명령줄 클라이언트](../protocols/cli#connect-to-a-server)를 참조하세요.

## CI용 서비스 계정과 키 {#service-accounts}

서비스 계정은 사람이 아닌 도구를 위한 ID입니다. 서비스 계정에는 **정책**, 즉 사용할 수 있는 리포지토리와 작업이 있습니다. 서비스 계정에는 키가 있습니다. 키에도 자체 리포지토리와 작업 목록이 있습니다. 실제로 적용되는 권한은 두 목록의 교집합이며, 작업별로 계산됩니다. 정책이 비어 있으면 파일에 접근할 수 없습니다.

서비스 액세스는 복구 키 또는 소유자가 권한을 위임한 운영자 키로 관리합니다. 콘솔에서는 다음과 같이 합니다.

1. 로그인되어 있다면 [[ui:disconnect]] 버튼을 선택하세요. 그런 다음 [[ui:keySignIn]] 항목을 열고 복구 키를 [[ui:serviceKey]] 필드에 붙여 넣은 다음 [[ui:connect]] 버튼을 선택하세요.
2. [[ui:services]] 섹션을 여세요. 이 섹션은 복구 키와 운영자 키로 연결했을 때만 표시됩니다.

### 계정과 정책 만들기 {#service-policy}

1. [[ui:services]] 섹션에서 [[ui:serviceCreate]] 항목을 펼치세요.
2. [[ui:serviceName]] 필드에 이름(문자, 숫자, `.`, `_`, `-`로 이루어진 3~64자)을 입력하세요.
3. [[ui:servicePolicy]] 항목에서 [[ui:bindingAdd]] 버튼을 선택하고 [[ui:repository]] 필드에 리포지토리 이름을 입력하세요.
4. 권한을 채우세요. [[ui:bindingRead]] 버튼과 [[ui:bindingPublish]] 버튼은 일반적인 권한 집합을 채우고, [[ui:bindingNone]] 버튼은 권한을 지우며, [[ui:bindingPermissions]] 항목에는 모든 작업이 나열됩니다. 리포지토리를 제거하려면 [[ui:bindingRemove]] 버튼을 선택하세요.
5. [[ui:serviceCreate]] 버튼을 선택하세요.

프리셋은 두 가지입니다.

| 프리셋                | 작업                                                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [[ui:bindingRead]]    | `repository.read`, `artifact.read`, `artifact.list`, `content.read`, `package.read`, `asset.read`, `annotation.read`                                                  |
| [[ui:bindingPublish]] | 읽기 집합과 함께 `upload.create`, `upload.read`, `upload.write`, `upload.complete`, `upload.cancel`, `job.read`, `package.publish`, `asset.write`, `annotation.write` |

두 프리셋 모두 승격, 복원, 삭제를 포함하지 않습니다. 승격 작업에는 `artifact.promote`를 추가하세요. 다운로드만 하는 배포 에이전트가 `arkvoryctl`을 사용하려면 읽기 집합이 필요합니다. 이름으로 패키지를 일반 HTTP로 다운로드할 때는 `content.read`만으로 충분합니다.

정책에는 리포지토리를 최대 64개까지 지정할 수 있고, 설치 하나에는 서비스 계정을 최대 1000개까지 둘 수 있습니다. 저장된 정책에는 버전이 있습니다. 그사이 다른 사람이 정책을 변경하면 콘솔이 충돌을 표시하고 작성 중인 내용을 유지합니다. [[ui:serviceRefresh]] 버튼을 선택한 다음 변경 사항을 다시 적용하세요. [[ui:serviceDisable]] 버튼은 계정의 모든 키를 차단합니다. 이미 진행 중인 전송은 완료될 수 있습니다.

### 키 발급, 저장, 활성화 {#service-key-issue}

1. 계정을 열고 [[ui:serviceKeys]] 항목을 여세요.
2. [[ui:keyIssue]] 항목을 펼치세요. [[ui:keyName]] 필드에 이름을 입력하세요. [[ui:keyExpiry]] 필드에 만료 시각을 설정하거나, 비워 두면 90일이 적용됩니다. 가장 긴 만료 기간은 365일입니다.
3. 키에 계정보다 적은 권한이 필요하면 권한을 좁히세요. [[ui:keyIssue]] 버튼을 선택하세요.
4. [[ui:keySecret]] 창에 시크릿이 한 번만 표시됩니다. [[ui:keyCopy]] 버튼을 선택하고 CI의 시크릿 저장소에 보관하세요. 시크릿은 `arkvory_`로 시작합니다.
5. [[ui:keySaved]] 확인란을 선택한 다음 [[ui:keyActivate]] 버튼을 선택하세요.

활성화하지 않은 키는 쓸 수 없으며 15분 후에 만료됩니다. 활성화하기 전까지는 [[ui:keyPending]] 상태로 표시됩니다. 계정 하나에는 활성 키 3개와 활성화 대기 키 2개를 동시에 둘 수 있습니다. 상태는 [[ui:keyPending]], [[ui:keyActive]], [[ui:keyRevoked]], [[ui:keyExpired]]이며, [[ui:keyDetails]] 항목에는 키의 ID와 권한이 나열됩니다.

시크릿을 복사하기 전에 응답이 유실되면 서버는 시크릿을 다시 표시할 수 없습니다. 키를 폐기하고 다른 키를 발급하세요.

API에서는 복구 키로 계정을 만든 다음 키를 발급합니다. `Idempotency-Key` 헤더(문자, 숫자, `.`, `_`, `:`, `-`로 이루어진 1~128자)를 사용하면 반복된 요청이 안전하지만, 반복된 요청은 시크릿을 반환하지 않습니다. 키는 `activateServiceKey`를 호출할 때 스스로 활성화됩니다.

```bash
curl -X POST "$ARKVORY/api/v1/service-accounts" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" \
  -d '{"name":"ci-prod","bindings":[{"resource":{"kind":"repository","id":"releases"},"actions":["repository.read","artifact.read","artifact.list","content.read","package.read","upload.create","upload.read","upload.write","upload.complete","job.read","package.publish","asset.read","asset.write"]}]}'

curl -X POST "$ARKVORY/api/v1/service-accounts/$ACCOUNT_ID/keys" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: ci-prod-2026-10" \
  -d '{"name":"pipeline-2026","bindings":[{"resource":{"kind":"repository","id":"releases"},"actions":["content.read","package.read","artifact.read"]}]}'

curl -X POST "$ARKVORY/api/v1/auth/activate-key" -H "Authorization: Bearer $NEW_SECRET"
```

SDK에서의 같은 단계는 다음과 같습니다.

```typescript
const account = await root.administration.services.create('ci-prod', bindings);
const issued = await root.administration.credentials.issue(account.id, requestId, {
  name: 'pipeline-2026',
  bindings,
});
if (!issued.secret) throw new Error('Lost response: revoke the key and issue another');
await saveToSecretStore(issued.secret);
await new ArkvoryClient(url, () => issued.secret ?? '').identity.activateKey();
```

활성화한 키를 작업에 `ARKVORY_TOKEN_FILE` 또는 `ARKVORY_TOKEN`으로 전달하세요. [CI 예제](../protocols/cli#ci-example)를 참조하세요.

### 교체와 폐기 {#service-key-rotate}

키가 만료되기 전에, 공백 없이 교체하세요.

1. 키 옆의 [[ui:keyRotate]] 버튼을 선택하세요. 이전 키의 권한이 양식에 채워집니다. 권한은 유지하거나 줄이기만 할 수 있습니다.
2. 새 키를 발급하고, 시크릿을 저장한 다음 활성화하세요.
3. 작업이 새 시크릿을 사용하도록 전환하세요.
4. 이전 키에서 [[ui:keyRevoke]] 버튼을 선택하세요.

새 키를 활성화하면 이전 키는 최대 24시간만 더 유효하게 제한되므로, 잊힌 이전 키가 계속 남지 않습니다. 폐기는 되돌릴 수 없으며 키 이름을 입력해야 합니다. 폐기한 키의 새 요청은 즉시 거부됩니다. 이미 진행 중인 전송은 완료될 수 있습니다. API 작업은 `rotateServiceKey`와 `revokeServiceKey`입니다.

계정의 [[ui:serviceAudit]] 항목에는 키를 발급, 활성화, 교체, 폐기한 사람이 시각과 함께 표시됩니다. 시크릿은 저장되지 않습니다. 서버는 모든 계정의 최근 이벤트 100 000개를 보관합니다.

### 위임된 관리 {#delegation}

평소에는 복구 키를 사용하지 마세요. 소유자는 서비스 관리의 일부를 **운영자 키**에 맡기고, 복구 키는 오프라인으로 보관할 수 있습니다.

1. 복구 키로 운영자용 서비스 계정을 빈 정책으로 만들고, 이 계정의 키를 발급하여 활성화하세요.
2. 해당 계정의 [[ui:serviceKeys]] 항목을 열고 키에서 [[ui:delegations]] 버튼을 선택하세요.
3. [[ui:delegationNew]] 항목을 펼치세요. 운영자가 관리할 계정을 [[ui:delegationTarget]] 필드에 입력하세요.
4. [[ui:delegationActions]] 항목에서 작업을 선택하고, 운영자가 리포지토리에서 부여할 수 있는 최대 범위인 [[ui:delegationCeiling]] 항목을 설정하세요.
5. [[ui:delegationSave]] 버튼을 선택하세요.

일곱 가지 작업은 다음과 같습니다.

| 작업                     | 콘솔 레이블                              | 운영자가 할 수 있는 일  |
| ------------------------ | ---------------------------------------- | ----------------------- |
| `service-account.read`   | [[ui:permission.service-account.read]]   | 계정 조회               |
| `service-account.manage` | [[ui:permission.service-account.manage]] | 계정 활성화 및 비활성화 |
| `policy.read`            | [[ui:permission.policy.read]]            | 정책 읽기               |
| `policy.manage`          | [[ui:permission.policy.manage]]          | 정책 교체               |
| `credential.read`        | [[ui:permission.credential.read]]        | 키 나열                 |
| `credential.manage`      | [[ui:permission.credential.manage]]      | 키 발급, 교체, 폐기     |
| `service-audit.read`     | [[ui:permission.service-audit.read]]     | 활동 로그 읽기          |

규칙은 다음과 같습니다.

- 운영자가 설정하는 모든 값은 상한 안에 있어야 합니다. 운영자가 발급한 키는 운영자 본인의 키보다 늦게 만료될 수 없습니다.
- 운영자는 대상 계정의 키를 발급할 수 있으므로, 위임은 상한이 허용하는 모든 것에 대한 신뢰로 취급하세요.
- 운영자는 자기 계정을 관리할 수 없고 다시 위임할 수 없습니다. 한 계정이 대상이면서 동시에 운영자일 수는 없습니다.
- [[ui:delegationRemove]] 버튼으로 위임을 제거해도 운영자가 이미 활성화한 키는 폐기되지 않습니다. 해당 키는 직접 폐기하세요.
- 운영자는 [[ui:delegationOwn]] 항목에서 본인에게 할당된 내용을 볼 수 있습니다.

위임은 복구 키만 설정할 수 있습니다. API 작업은 `listServiceDelegations`, `setServiceDelegation`, `removeServiceDelegation`입니다.

## 감사 {#audit}

관리자는 설치의 보안 저널을 읽을 수 있습니다. 저널에는 로그인과 실패, 가입, 비밀번호 변경과 재설정, 사용자·그룹·부여된 권한의 변경, 토큰 생성과 폐기가 기록됩니다. 각 항목에는 시각, 행위자, 자격 증명의 종류, 클라이언트 주소, 대상, 결과(`success`, `failure`, `denied`)가 있습니다. 비밀번호나 시크릿은 포함되지 않습니다. 서버는 항목을 365일 동안 또는 1 000 000개까지 보관하며, 둘 중 먼저 도달하는 기준이 적용됩니다.

콘솔에는 이 저널을 위한 화면이 없습니다. 관리자 세션 또는 복구 키로 API를 사용해 읽으세요. 페이지에는 기본적으로 50개, 최대 100개의 항목이 최신순으로 들어 있습니다. 다음 페이지를 읽으려면 `next` 값을 `after`로 전달하세요.

```bash
curl -H "Authorization: Bearer $ADMIN_KEY" "$ARKVORY/api/v1/security/audit?limit=20"
```

```typescript
const page = await client.administration.security.audit({ limit: 20 });
```

서비스 계정의 활동 로그는 별개입니다. [키 발급, 저장, 활성화](#service-key-issue)를 참조하세요.

## 소유자가 로그인할 수 없을 때 {#recovery}

관리자로 로그인할 수 있는 사람이 없으면 복구 키를 사용하세요.

1. 서버에서 키를 읽으세요. 설치 디렉터리의 `config/bootstrap-token.txt`입니다. 서버 관리자만 읽을 수 있습니다.
2. 콘솔에서 [[ui:keySignIn]] 항목을 열고 키를 [[ui:serviceKey]] 필드에 붙여 넣은 다음 [[ui:connect]] 버튼을 선택하세요.
3. [[ui:administration]] 섹션을 여세요. [[ui:resetPassword]] 항목을 펼치고 계정을 선택한 다음 [[ui:newPassword]] 필드에 비밀번호를 입력하고 [[ui:resetPassword]] 버튼을 선택하세요. 계정이 비활성화되어 있으면 [[ui:enableUser]] 버튼을 선택하세요.
4. 새 비밀번호로 로그인하세요.

[[ui:createUser]] 버튼으로 새 관리자를 만들고 [[ui:administrator]] 확인란을 선택할 수도 있습니다.

[[ui:welcomeOwner]] 양식은 설치에 계정이 하나도 없는 동안에만 작동합니다. 그 이후에는 복구 키를 처음부터 다시 시작하는 데 쓰지 말고 계정을 복구하는 데 사용하세요.

복구 키 자체를 잃어버린 경우 서버 관리자가 `config/keys.json`에 있는 키의 SHA-256을 교체하고 API를 다시 시작합니다. [보안](../operate/security)을 참조하세요.

## 관련 페이지 {#related-pages}

- [웹 콘솔](../guide/console)
- [리포지토리](./repositories)
- [명령줄(arkvoryctl)](../protocols/cli)
- [인증](../api/authentication) 및 API 참조: [계정 및 로그인](../api/reference/accounts), [서비스 계정 및 키](../api/reference/services)
- [보안](../operate/security)
