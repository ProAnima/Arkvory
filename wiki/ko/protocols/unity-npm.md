---
title: Unity 및 npm 패키지
description: '리포지토리를 Unity Package Manager의 범위 지정 레지스트리로, 패키지 게시 및 설치용 npm 레지스트리로 사용합니다.'
---

# Unity 및 npm 패키지

모든 Arkvory 리포지토리는 `https://<host>/npm/<repository>/`에서 npm 호환 레지스트리로 동작합니다. Unity Package Manager는 이를 범위 지정 레지스트리로 읽고, `npm`은 여기에 게시하고 여기에서 설치합니다. 스튜디오는 여러 Unity 프로젝트가 공유하는 SDK, 도구, 모듈을 각자의 버전과 함께 이곳에 둡니다.

패키지 tarball은 일반 아티팩트이므로 리포지토리 권한, 할당량, SHA-256 검사, 백업, 미러가 모두 적용됩니다.

## 시작하기 전에 {#before-you-start}

필요한 것:

- HTTPS가 설정된 서버 주소([HTTPS](../install/https) 참조).
- 리포지토리, 예를 들어 `games`. 레지스트리 주소는 `https://arkvory.example/npm/games/`입니다.
- 키. 개발자는 범위가 `read`인 개인용 액세스 토큰을 사용합니다. 게시하는 빌드 에이전트는 범위가 `read-write`인 개인용 토큰이나 서비스 키를 사용합니다. [계정 및 키](../use/accounts)를 참조하세요.

Arkvory는 패키지 데이터에서 각 tarball의 주소를 클라이언트에 보냅니다. 주소는 클라이언트가 접속한 호스트 이름으로 만들어집니다. 리버스 프록시가 HTTPS를 종료하는 경우, 설치 문서의 nginx 예제처럼 `Host` 헤더를 전달하고 `X-Forwarded-Proto: https`를 보내야 합니다. 그렇지 않으면 클라이언트는 tarball의 `http://` 주소를 받습니다.

## Unity 프로젝트에 레지스트리 추가 {#unity-manifest}

1. 프로젝트의 `Packages/manifest.json`을 열고 범위 지정 레지스트리를 추가합니다:

```json
{
  "scopedRegistries": [
    {
      "name": "Arkvory",
      "url": "https://arkvory.example/npm/games/",
      "scopes": ["com.proanima"]
    }
  ],
  "dependencies": {
    "com.proanima.tools": "1.2.0"
  }
}
```

2. Unity에 키를 전달합니다. 키를 프로젝트에 넣지 마세요. 사용자 폴더(Windows에서는 `%USERPROFILE%\.upmconfig.toml`, macOS와 Linux에서는 `~/.upmconfig.toml`)에 `.upmconfig.toml` 파일을 만듭니다:

```toml
[npmAuth."https://arkvory.example/npm/games/"]
token = "<your Arkvory key>"
alwaysAuth = true
```

3. Unity를 다시 시작합니다. Package Manager 창에서 **My Registries**를 열면 레지스트리의 패키지를 볼 수 있습니다.

참고:

- `scopes`는 패키지 이름의 접두사입니다. Unity는 이름이 스코프로 시작하는 패키지는 Arkvory에서, 나머지 모든 패키지는 Unity 레지스트리에서 가져옵니다.
- `.upmconfig.toml`의 주소는 마지막 슬래시를 포함해 매니페스트의 `url`과 같아야 합니다.
- `alwaysAuth = true`가 필요합니다. 레지스트리가 로그인 요청을 보내지 않으므로 Unity는 모든 요청에 토큰을 보내야 합니다.
- Unity 패키지 이름은 `com.company.package`처럼 소문자로 된 역방향 도메인 이름입니다. Unity는 `@scope/`가 있는 이름을 지원하지 않습니다.

`Packages/manifest.json`은 프로젝트와 함께 커밋하세요. 각 개발자는 자신의 `.upmconfig.toml`을 따로 보관합니다.

## 패키지 게시 {#publish}

패키지는 최상위에 `package.json`이 있는 폴더입니다. `npm`으로 게시합니다.

1. 패키지 폴더에 `.npmrc` 파일을 만듭니다:

```ini
registry=https://arkvory.example/npm/games/
//arkvory.example/npm/games/:_authToken=${ARKVORY_TOKEN}
```

2. 환경에 키를 설정하고 게시합니다:

```bash
export ARKVORY_TOKEN="$(cat ~/.arkvory/key)"
npm publish
```

```powershell
$env:ARKVORY_TOKEN = (Get-Content C:\Private\arkvory.key -Raw).Trim()
npm publish
```

`_authToken`이 있는 줄은 `https:`를 뺀 레지스트리 주소로 시작해야 합니다. 키를 `.npmrc`에 넣지 마세요. npm이 환경에서 `${ARKVORY_TOKEN}`을 대체합니다.

`.npmrc`의 `registry` 줄 대신 패키지의 `package.json`에서 레지스트리를 설정할 수 있습니다:

```json
{
  "name": "com.proanima.tools",
  "version": "1.2.0",
  "publishConfig": { "registry": "https://arkvory.example/npm/games/" }
}
```

레지스트리가 검사하는 항목:

- **이름과 버전.** tarball 안 `package.json`의 `name`과 `version`은 게시된 것과 일치해야 합니다. 버전은 SemVer 2.0.0을 따르며, 예를 들어 `1.2.0` 또는 `2.0.0-beta.1`입니다. 레지스트리는 클라이언트가 보낸 JSON이 아니라 이 파일에서 버전 데이터를 읽습니다.
- **체크섬.** 클라이언트가 선언한 길이, `shasum`, `integrity`가 바이트와 일치해야 합니다. 일치하지 않으면 `422 integrity_mismatch`를 반환합니다.
- **tarball.** `npm pack`이 만드는 것처럼 `<folder>/package.json`을 포함해야 합니다. 아카이브 안에 두 번째 `package.json`이 있으면 거부됩니다. npm과 레지스트리가 서로 다른 파일을 읽을 수 있기 때문입니다.
- **버전은 변경할 수 없습니다.** 같은 tarball을 다시 게시하면 성공하고 아무것도 바뀌지 않습니다(`200`). 기존 버전에 다른 콘텐츠를 게시하면 사유 `version_exists`와 함께 `409`를 반환합니다. 수정 사항은 다음 버전으로 게시하세요.

`npm publish`는 게시하기 전에 레지스트리에서 패키지를 읽으므로, 게시용 키에 `upload.create`뿐 아니라 `content.read`와 `artifact.list`도 부여하세요. [권한](#permissions)을 참조하세요.

버전은 `npm publish`가 반환되는 즉시 사용할 수 있습니다. 버전의 tarball은 레이블 `npm`이 붙은 아티팩트 `<name>-<version>.tgz`로 저장됩니다. 스코프가 있는 이름의 경우 `@team/util`은 `util-<version>.tgz`가 됩니다.

## 패키지 설치 {#install}

Unity에서는 매니페스트에 의존성을 추가하거나 Package Manager 창의 **My Registries**에서 패키지를 선택하세요.

npm의 경우 프로젝트나 사용자의 `.npmrc`에서 레지스트리를 설정합니다. Arkvory가 공개 npm 레지스트리로 요청을 전달하지 않으므로 보통 하나의 스코프에 대한 레지스트리를 설정합니다:

```ini
@team:registry=https://arkvory.example/npm/games/
//arkvory.example/npm/games/:_authToken=${ARKVORY_TOKEN}
```

```bash
npm install @team/util
npm view @team/util versions
npm search tools
```

프로젝트 전체에 대해 `registry=`를 Arkvory로 설정하면 npm은 `lodash` 같은 공개 패키지를 포함한 모든 패키지를 이곳에서 찾다가 `404`로 실패합니다. 범위 지정 레지스트리를 사용하거나 자신의 패키지만 담긴 프로젝트를 사용하세요.

npm은 설치하는 동안 `dist.integrity`를 검사하고 레지스트리 주소를 `package-lock.json`에 씁니다.

## 버전과 dist-tag {#versions-and-tags}

dist-tag는 버전에 붙이는 이동 가능한 이름입니다. `npm publish`는 `latest`를 새 버전으로 설정합니다. 다른 태그는 릴리스 채널을 구분하는 데 도움이 됩니다.

```bash
npm publish --tag beta
npm dist-tag add com.proanima.tools@1.3.0 latest
npm dist-tag ls com.proanima.tools
npm dist-tag rm com.proanima.tools beta
```

```bash
npm install com.proanima.tools@beta
```

| 규칙        | 값                                                                  |
| ----------- | ------------------------------------------------------------------- |
| 태그 이름   | 문자로 시작합니다. 문자, 숫자, `.`, `_`, `-`. 최대 64자입니다.      |
| 금지된 태그 | 버전처럼 보이는 이름(`v1`, `v2.0`), 그리고 `x` 또는 `X`             |
| `latest`    | 항상 버전을 가리킵니다. 옮길 수 있지만 제거할 수는 없습니다(`409`). |
| 태그 옮기기 | `npm dist-tag add`, 또는 `--tag`로 게시. 새 버전이 존재해야 합니다. |

태그는 이름일 뿐이며, 다른 버전을 삭제하거나 숨기지 않습니다.

게시된 버전을 제거하는 방법은 없습니다. [지원되지 않는 기능](#not-supported)을 참조하세요.

## 검색 {#search}

Unity의 **My Registries** 목록과 `npm search`는 검색 주소 `/-/v1/search`를 사용합니다. 검색은 이름이나 설명에 해당 텍스트가 대소문자와 관계없이 포함된 패키지와, 텍스트를 온전한 키워드로 가진 패키지를 찾습니다. 텍스트가 없으면 모든 패키지를 나열합니다.

- 패키지마다 한 줄을 반환합니다: 태그 `latest`가 붙은 버전, 없으면 가장 최신 버전입니다.
- 결과는 이름순으로 정렬됩니다. 인기순 순위는 없습니다.
- `size`는 기본 20이고 최대 250입니다. `from`은 오프셋입니다.

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_TOKEN" \
  "https://arkvory.example/npm/games/-/v1/search?text=tools&from=0&size=20"
```

패키지를 직접 읽으려면 이름을 요청하세요. `@scope/name`은 `@scope%2fname`으로 보낼 수 있습니다:

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_TOKEN" https://arkvory.example/npm/games/com.proanima.tools
```

응답은 각 버전을 그 `package.json` 내용(Unity가 읽는 `unity`와 `displayName` 필드 포함), dist-tag, 게시 시각과 함께 나열합니다. `dist`에는 `tarball`, `shasum`(SHA-1), `integrity`(SHA-512)가 있습니다.

## 이름과 제한 {#limits}

| 항목                     | 규칙                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 패키지 이름              | 소문자, 숫자, `.`, `_`, `~`, `-`로 구성되며 문자나 숫자로 시작합니다. 최대 214자입니다. npm의 경우 `@scope/name`을 허용합니다.               |
| 버전                     | SemVer 2.0.0, 최대 256자                                                                                                                     |
| tarball의 `package.json` | 최대 256 KiB. 모든 버전의 데이터가 한 응답에 포함되므로 작게 유지하세요.                                                                     |
| tarball                  | 설치 환경의 최대 객체 크기 `ARKVORY_MAX_OBJECT_BYTES`(기본 약 10 TiB)까지. 100배에 64 MiB를 더한 것보다 많이 확장되는 아카이브는 거부됩니다. |
| 게시 요청의 나머지       | 최대 8 MiB의 JSON이며 최대 64단계까지 중첩됩니다. tarball은 스트림으로 읽고 메모리에 보관하지 않습니다.                                      |
| 게시 요청 하나           | 30분 안에 끝나야 하고 30초 넘게 멈춰서는 안 됩니다(`ARKVORY_UPLOAD_DEADLINE_MS`, `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`)                           |
| 동시 업로드              | 기본적으로 서버당 2개, 키당 1개입니다. 대기 중인 요청은 20초 후 포기합니다.                                                                  |
| 검색 텍스트              | 최대 256자                                                                                                                                   |

`npm publish`는 요청 하나이며, 실패하면 첫 바이트부터 다시 시작합니다. 수 GB 규모의 패키지는 [`arkvoryctl`](./cli)로 아티팩트나 [원시 파일](./raw-files)로 업로드하세요. 자주 바뀌는 대용량 바이너리 에셋은 [Git LFS](./git-lfs)에 두는 것이 좋고, 코드와 안정적인 리소스는 패키지에 두세요.

서버의 제한은 [환경 변수](../reference/environment#transfers-and-bandwidth)에 있습니다.

## 권한 {#permissions}

개인용 토큰과 파일 키는 리포지토리에 대한 읽기 또는 쓰기 액세스를 얻습니다. 서비스 키는 정확한 작업을 얻습니다.

| 작업                                  | 서비스 키 작업  | 개인용 토큰 또는 파일 키            |
| ------------------------------------- | --------------- | ----------------------------------- |
| 설치: 패키지 읽기 및 tarball 다운로드 | `content.read`  | 읽기 액세스                         |
| 검색, dist-tag 나열                   | `artifact.list` | 읽기 액세스                         |
| 게시, dist-tag 추가 및 제거           | `upload.create` | 쓰기 액세스, 토큰 범위 `read-write` |

패키지를 설치만 하는 개발자에게는 범위가 `read`인 토큰이 필요합니다. 게시하는 빌드 에이전트에게는 `upload.create`, `content.read`, `artifact.list`가 필요합니다. 게시된 버전은 누구도 삭제할 수 없습니다.

## 읽기 게이트웨이와 미러 {#read-gateways-and-mirrors}

- [읽기 게이트웨이](../operate/read-gateways)는 설치와 검색이 `GET` 요청이므로 이를 제공합니다. 게시는 `405`를 받습니다.
- [미러](../operate/mirrors)는 원본의 버전과 태그를 보관합니다. 설치와 검색은 동작합니다. 게시는 사유 `mirror_read_only`와 함께 `409`로 거부됩니다. 미러의 데이터에 있는 tarball 주소는 미러를 가리킵니다.

Unity에서 미러를 사용하려면 미러의 주소를 `url`에, 미러의 키를 `.upmconfig.toml`에 넣으세요.

## 지원되지 않는 기능 {#not-supported}

- 버전 제거(`npm unpublish`). 프로젝트는 버전을 고정하며, 제거하면 빌드가 깨질 수 있습니다. 대신 수정된 버전을 게시하고 태그를 옮기세요.
- `npm deprecate`, `npm login`, `npm owner`, `npm access` 및 기타 관리 명령. 다른 경로에서 데이터를 변경하는 요청은 "This registry supports publish, install and dist-tags"와 함께 `405`로 응답합니다. `npm login` 대신 콘솔에서 토큰을 만들어 `.npmrc`에 넣으세요.
- `/-/all`의 모든 패키지 목록, 그리고 `npm audit`.
- 공개 레지스트리에 대한 프록시. Arkvory는 사용자의 패키지를 저장합니다. npmjs.com이나 Unity 레지스트리의 패키지는 해당 위치에서 가져옵니다.
- 검색 결과 순위.
- 콘솔의 패키지 섹션. tarball은 레이블 `npm`이 붙은 아티팩트로 [[ui:catalog]]에 나타납니다.

## 문제 해결 {#troubleshooting}

오류는 `{"error": "...", "code": "...", "request_id": "..."}` 형식입니다. `npm`은 `error`를 출력합니다. 서버 로그에서 요청을 찾을 수 있도록 관리자에게 `request_id`를 알려주세요.

| 증상                                                  | 원인                                                                          | 해결 방법                                                                                                                                                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unity 또는 npm에서 `401`                              | 클라이언트가 키를 보내지 않았거나, 키가 잘못되었거나 만료 또는 폐기되었습니다 | Unity에서는 `.upmconfig.toml`의 주소가 매니페스트의 `url`과 같은지, `alwaysAuth = true`인지 확인하세요. npm에서는 `_authToken` 줄이 `registry`와 같은 호스트 및 경로로 시작하는지 확인하세요. |
| 게시할 때 `403`                                       | 토큰의 범위가 `read`이거나 키에 `upload.create`가 없습니다                    | 쓰기 액세스가 있는 키를 사용하세요                                                                                                                                                            |
| 패키지에 대한 `404`                                   | 이 리포지토리에 해당 패키지가 없거나, 키가 리포지토리를 볼 수 없습니다        | 주소의 리포지토리와 이름을 확인하세요. Unity 패키지의 경우 이름이 `scopes`의 스코프로 시작하는지 확인하세요.                                                                                  |
| 공개 패키지에 대한 `404`                              | `registry=`가 모든 패키지에 대해 Arkvory를 가리킵니다                         | `@scope:registry=`를 사용하세요                                                                                                                                                               |
| `version_exists`와 함께 `409`                         | 해당 버전이 다른 콘텐츠로 이미 존재합니다                                     | 새 버전을 게시하세요                                                                                                                                                                          |
| `state_conflict`와 함께 `409`                         | `latest`를 제거하려고 했습니다                                                | 대신 `latest`를 다른 버전으로 옮기세요                                                                                                                                                        |
| `mirror_read_only`와 함께 `409`                       | 리포지토리가 미러입니다                                                       | 주 서버에 게시하세요                                                                                                                                                                          |
| `integrity_mismatch`와 함께 `422`                     | 바이트가 선언된 `shasum` 또는 `integrity`와 다릅니다                          | 다시 패키징하고 게시하세요. 프록시가 본문을 바꾸지 않는지 확인하세요.                                                                                                                         |
| `400` "package.json names another package or version" | tarball 안 `package.json`이 게시된 이름 또는 버전과 다릅니다                  | 패키지를 깨끗하게 빌드한 뒤 `npm publish`를 실행하세요                                                                                                                                        |
| `400` "Only publishing a new version is supported"    | 명령이 변경된 패키지를 보냈습니다(예: `npm deprecate`)                        | 이러한 명령은 지원되지 않습니다                                                                                                                                                               |
| `405`                                                 | 이 레지스트리에서 지원하지 않는 명령입니다                                    | [지원되지 않는 기능](#not-supported)을 참조하세요                                                                                                                                             |
| `507`                                                 | 리포지토리 할당량이나 설치 환경의 용량에 도달했습니다                         | 공간을 확보하거나 더 큰 할당량을 요청하세요                                                                                                                                                   |
| `503`                                                 | 동시 업로드가 너무 많습니다                                                   | 기다렸다가 다시 시도하세요                                                                                                                                                                    |
| `http://`에서 tarball을 다운로드하다가 실패           | 프록시가 `X-Forwarded-Proto: https`를 보내지 않습니다                         | [시작하기 전에](#before-you-start)에 설명된 대로 프록시를 수정하세요                                                                                                                          |

## 관련 페이지 {#related-pages}

- [클라이언트 및 프로토콜](./index)
- [Git LFS](./git-lfs)
- [계정 및 키](../use/accounts)
- [HTTPS](../install/https)
- [미러](../operate/mirrors)
