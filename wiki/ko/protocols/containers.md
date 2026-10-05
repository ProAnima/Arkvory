---
title: 컨테이너 이미지
description: 모든 리포지토리가 /v2 아래에 갖는 레지스트리를 통해 Docker 및 OCI 이미지, Helm 차트, ORAS 아티팩트를 push하고 pull합니다.
---

# 컨테이너 이미지

모든 Arkvory 리포지토리는 컨테이너 레지스트리이기도 합니다. Docker, Podman, Buildx, containerd, Helm, ORAS는 OCI Distribution 프로토콜로 이 레지스트리에 push하고 여기에서 pull합니다. 이미지 레이어와 매니페스트는 일반 아티팩트로 저장됩니다. 리포지토리 권한, 할당량, SHA-256 검증, 백업, 미러가 다른 파일과 마찬가지로 이들에게도 적용됩니다.

## 시작하기 전에 {#before-you-start}

다음이 필요합니다.

- HTTPS와 신뢰할 수 있는 인증서를 갖춘 서버 주소(예: `arkvory.example`). [HTTPS](../install/https)를 참조하세요.
- 리포지토리(예: `releases`).
- 키: 개인용 액세스 토큰 또는 서비스 키. [계정 및 키](../use/accounts)를 참조하세요.

레지스트리는 호스트의 루트, 즉 `/v2/` 아래에서 응답합니다. Docker가 경로 접두사를 지원하지 않으므로 `https://example.com/arkvory/` 같은 경로 접두사 아래에서는 동작할 수 없습니다. 리버스 프록시는 `/v2/`를 변경 없이 전달해야 하며 요청 본문을 버퍼링하면 안 됩니다. nginx에서는 `client_max_body_size 0`을 설정하고 요청 버퍼링을 끄세요.

## 이미지 이름 {#image-names}

이미지 참조는 다음 형식입니다.

```text
<host>/<repository>/<image>:<tag>
<host>/<repository>/<image>@sha256:<digest>
```

첫 번째 경로 세그먼트는 Arkvory 리포지토리입니다. 이 세그먼트가 액세스 경계입니다. 키는 부여받은 리포지토리만 볼 수 있습니다. 나머지는 이미지 이름이며 구성 요소가 하나 이상일 수 있습니다.

| 참조                                        | 리포지토리 | 이미지          | 참조 부분  |
| ------------------------------------------- | ---------- | --------------- | ---------- |
| `arkvory.example/releases/web:1.4`          | `releases` | `web`           | 태그 `1.4` |
| `arkvory.example/releases/team/web:1.4`     | `releases` | `team/web`      | 태그 `1.4` |
| `arkvory.example/qa/tools/builder@sha256:…` | `qa`       | `tools/builder` | 다이제스트 |

| 부분       | 규칙                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| 리포지토리 | 소문자, 숫자, `_`, `-`. 문자 또는 숫자로 시작합니다. 최대 64자.                                              |
| 이미지     | `/`로 구분된 구성 요소. 구성 요소는 소문자와 숫자를 `.`, `_`, `__`, 대시로 이어서 만듭니다. 전체 최대 200자. |
| 태그       | 문자, 숫자, `_`, `.`, `-`. 문자, 숫자 또는 `_`로 시작합니다. 최대 128자.                                     |
| 다이제스트 | `sha256:`과 소문자 16진수 64자리. 다른 알고리즘은 거부됩니다.                                                |

`arkvory.example/web:1.4`처럼 이미지 부분이 없는 참조는 `NAME_INVALID`로 거부됩니다. `web`이 리포지토리로 해석되어 이미지 이름이 비어 있기 때문입니다.

## 로그인 {#log-in}

레지스트리는 Arkvory 키를 HTTP Basic 인증의 비밀번호로 받습니다. 사용자 이름은 검사하지 않으므로 아무 이름(예: CI 작업의 이름)이나 사용하세요. 요청에서 키를 `Authorization: Bearer <key>`로 보낼 수도 있습니다. 별도의 토큰 서비스는 필요하지 않습니다.

```bash
docker login arkvory.example -u ci --password-stdin < ~/.arkvory/key
```

```powershell
Get-Content C:\Private\arkvory.key | docker login arkvory.example -u ci --password-stdin
```

다른 클라이언트도 같은 방식으로 로그인합니다.

```bash
podman login arkvory.example -u ci --password-stdin < ~/.arkvory/key
helm registry login arkvory.example -u ci --password-stdin < ~/.arkvory/key
oras login arkvory.example -u ci --password-stdin < ~/.arkvory/key
```

| 키                                    | 용도                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------- |
| 개인용 액세스 토큰, 범위 `read`       | 워크스테이션에서 pull                                                  |
| 개인용 액세스 토큰, 범위 `read-write` | 워크스테이션에서 push                                                  |
| 서비스 키                             | CI/CD와 배포 에이전트. 이미지를 삭제할 수 있는 유일한 종류의 키입니다. |
| 서버 키 파일의 파일 키                | 설치 소유자와 기존 통합(`read` 또는 `write`)                           |

개인용 토큰은 만료됩니다. 만료된 후에는 모든 요청이 `401 UNAUTHORIZED`를 받습니다. 새 토큰을 만들고 다시 로그인하세요. Docker는 자격 증명 도우미를 구성하지 않으면 키를 `~/.docker/config.json`에 저장합니다. 이 파일을 보호하거나 자격 증명 저장소를 사용하세요.

## push와 pull {#push-and-pull}

```bash
docker tag web:1.4 arkvory.example/releases/team/web:1.4
docker push arkvory.example/releases/team/web:1.4
docker pull arkvory.example/releases/team/web:1.4
docker pull arkvory.example/releases/team/web@sha256:<digest>
```

레지스트리는 다음과 같이 동작합니다.

- 리포지토리에 이미 있는 레이어는 다른 이미지가 사용하더라도 다시 저장하지 않습니다.
- 레이어는 리포지토리 간에 공유되지 않습니다. 다른 리포지토리의 레이어를 마운트하라는 요청은 일반 업로드 세션을 받으므로, 클라이언트가 레이어를 다시 보냅니다.
- 모든 레이어와 매니페스트는 SHA-256 다이제스트와 대조해 검증합니다. 불일치하면 아무것도 저장하지 않고 `DIGEST_INVALID`를 반환합니다.
- 매니페스트가 참조하는 모든 항목이 이미 리포지토리에 있을 때만 매니페스트를 받아들입니다. 이미지의 구성과 레이어, 또는 인덱스의 플랫폼 매니페스트가 여기에 해당합니다. 플랫폼 매니페스트는 인덱스와 같은 이미지에 있어야 합니다. 그렇지 않으면 `MANIFEST_BLOB_UNKNOWN`이 반환됩니다.
- 레이어 다운로드는 `Range` 요청을 지원합니다.

레지스트리는 다음 매니페스트 유형을 받습니다.

| 미디어 유형                                                 | 용도                                         |
| ----------------------------------------------------------- | -------------------------------------------- |
| `application/vnd.oci.image.manifest.v1+json`                | OCI 이미지, Helm 차트, ORAS 아티팩트         |
| `application/vnd.oci.image.index.v1+json`                   | 멀티 플랫폼 이미지, BuildKit 레지스트리 캐시 |
| `application/vnd.docker.distribution.manifest.v2+json`      | Docker 이미지(스키마 2)                      |
| `application/vnd.docker.distribution.manifest.list.v2+json` | Docker 멀티 플랫폼 이미지                    |

매니페스트는 `schemaVersion: 2`를 가지며 최대 4 MiB입니다. Docker 스키마 1은 지원하지 않습니다. 유형은 `Content-Type` 헤더 또는 매니페스트의 `mediaType` 필드에서 결정되며, 둘은 일치해야 합니다. pull하면 매니페스트는 push한 그대로, 자체 미디어 유형과 함께 반환됩니다. 레지스트리는 형식 간 변환을 하지 않습니다.

### 멀티 플랫폼 이미지 {#multi-platform-images}

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t arkvory.example/releases/team/web:1.4 --push .
```

Buildx는 각 플랫폼 매니페스트를 다이제스트로 push한 다음 태그로 인덱스를 push합니다. 레지스트리의 요구 사항에 따라 모두 같은 이미지 이름으로 push됩니다.

### 빌드 캐시 {#build-cache}

캐시를 내보낼 수 있는 BuildKit 빌더(예: `docker-container` 드라이버를 사용하는 `docker buildx` 빌더)는 레지스트리 캐시를 Arkvory에 보관할 수 있습니다.

```bash
docker buildx build \
  --cache-from type=registry,ref=arkvory.example/releases/team/web:cache \
  --cache-to type=registry,ref=arkvory.example/releases/team/web:cache,mode=max \
  -t arkvory.example/releases/team/web:1.4 --push .
```

캐시 인덱스에는 레이어와 캐시 구성이 나열됩니다. Arkvory는 이들을 이미지의 blob으로 저장하고, 저장된 다른 매니페스트의 레이어와 마찬가지로 보호합니다.

### Helm 차트 {#helm-charts}

Helm은 차트를 OCI 아티팩트로 저장합니다. `helm registry login`을 실행한 후 다음과 같이 합니다.

```bash
helm push web-1.4.0.tgz oci://arkvory.example/releases/charts
helm pull oci://arkvory.example/releases/charts/web --version 1.4.0
helm install web oci://arkvory.example/releases/charts/web --version 1.4.0
```

차트는 `releases` 리포지토리에서 태그가 `1.4.0`인 이미지 `charts/web`이 됩니다. Arkvory에는 `index.yaml` 파일이 있는 기존 방식의 차트 리포지토리가 없습니다.

### ORAS 아티팩트 {#oras-artifacts}

ORAS는 임의의 파일을 OCI 매니페스트의 레이어로 저장합니다.

```bash
oras push arkvory.example/releases/tools/settings:1.0 ./settings.json:application/json
oras pull arkvory.example/releases/tools/settings:1.0
```

Referrers API는 사용할 수 없습니다. `/v2/<name>/referrers/<digest>`는 `404`로 응답합니다. 그러면 ORAS처럼 OCI 사양을 따르는 클라이언트는 연결된 아티팩트를 다이제스트의 이름을 딴 태그로 보관합니다.

## 태그와 다이제스트 {#tags-and-digests}

- 태그로 매니페스트를 push하면 태그가 이동합니다. 이전에 태그가 가리키던 매니페스트는 레지스트리에 남아 있으며, 다이제스트로 여전히 pull할 수 있습니다.
- 다이제스트로 push하면(`PUT /v2/<name>/manifests/sha256:…`) 태그 없이 매니페스트를 저장합니다. 다이제스트는 본문의 SHA-256이어야 합니다.
- 태그는 바이트 순서로 나열되므로 대문자가 소문자보다 먼저 나옵니다.

이미지의 태그를 나열하세요.

```bash
curl -fsS -u "ci:$ARKVORY_KEY" https://arkvory.example/v2/releases/team/web/tags/list
```

응답은 `{"name": "releases/team/web", "tags": [...]}`입니다. 페이지 크기에는 `n`(기본 100, 최대 1000)을, 이전 페이지의 마지막 태그에는 `last`를 사용하세요. 태그가 더 있으면 `Link` 헤더에 다음 페이지의 주소가 들어 있습니다.

태그의 다이제스트를 찾으세요.

```bash
curl -fsSI -u "ci:$ARKVORY_KEY" \
  https://arkvory.example/v2/releases/team/web/manifests/1.4 | grep -i docker-content-digest
```

모든 이미지의 카탈로그(`/v2/_catalog`)는 없습니다. 콘솔에서는 레이어와 매니페스트가 리포지토리의 아티팩트 중에 `oci` 레이블과 함께 다이제스트 이름으로 나타납니다. [[ui:catalog]] 섹션의 [[ui:labelFilter]] 필드를 사용하여 표시하세요.

## 이미지 삭제와 공간 확보 {#delete-images}

이미지는 레지스트리 API로 삭제합니다. Docker 명령줄에는 삭제 명령이 없으므로 `curl`, `oras manifest delete` 또는 다른 레지스트리 도구를 사용하세요.

| 요청                                   | 효과                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `DELETE /v2/<name>/manifests/<tag>`    | 태그만 제거합니다. 매니페스트는 남아 있으며 다이제스트로 pull할 수 있습니다. |
| `DELETE /v2/<name>/manifests/<digest>` | 매니페스트와, 매니페스트를 가리키는 모든 태그를 제거합니다                   |
| `DELETE /v2/<name>/blobs/<digest>`     | `405`로 거부됩니다. 레이어는 매니페스트와 함께 사라집니다.                   |

두 삭제 모두 리포지토리에서 `artifact.delete` 작업이 허용된 서비스 키가 필요합니다. 개인용 토큰, 콘솔 세션, 파일 키로는 이미지를 삭제할 수 없습니다. 삭제는 `202`로 응답합니다.

```bash
curl -fsS -X DELETE -H "Authorization: Bearer $ARKVORY_CLEANUP_KEY" \
  https://arkvory.example/v2/releases/team/web/manifests/sha256:<digest>
```

공간이 확보되는 방식은 다음과 같습니다.

1. 매니페스트가 저장되어 있는 동안에는 태그 유무와 관계없이 Arkvory가 매니페스트와, 매니페스트가 참조하는 모든 레이어를 보호합니다. 보존 규칙은 `reference`라는 차단 사유로 이들을 건너뜁니다.
2. 태그를 옮기거나 삭제해도 공간은 확보되지 않습니다. 이전 매니페스트는 다이제스트로 삭제하기 전까지 자신의 레이어를 유지합니다.
3. 매니페스트를 다이제스트로 삭제하면 해당 아티팩트와, 다른 매니페스트가 사용하지 않는 레이어는 이 보호를 잃습니다. 누군가 보존 규칙으로 제거하거나 아티팩트로서 삭제하기 전까지는 저장된 상태로 남아 있습니다. [스토리지](../operate/storage)를 참조하세요.
4. 매니페스트 없이 push된 레이어(예: 실패한 push)는 보호되지 않습니다.
5. 제거된 레이어가 다시 필요해지면 레지스트리는 해당 레이어를 알 수 없다고 응답하며, 다음 push에서 다시 업로드됩니다.

## 권한 {#permissions}

개인용 토큰과 파일 키는 리포지토리에 대한 읽기 또는 쓰기 액세스를 받습니다. 서비스 키는 정확한 작업을 받습니다.

| 작업                      | 서비스 키의 작업                                   | 개인용 토큰 또는 파일 키                             |
| ------------------------- | -------------------------------------------------- | ---------------------------------------------------- |
| 매니페스트와 레이어 pull  | `content.read`                                     | 읽기 액세스                                          |
| 태그 나열                 | `artifact.list`                                    | 읽기 액세스                                          |
| push                      | `upload.create`, `upload.write`, `upload.complete` | 쓰기 액세스. 토큰에는 `read-write` 범위가 필요합니다 |
| 태그 또는 매니페스트 삭제 | `artifact.delete`                                  | 불가능                                               |

push하는 CI 키는 보통 pull도 합니다(예: 베이스 이미지나 빌드 캐시). 이 키에는 `content.read`와 `artifact.list`도 부여하세요. 키에 부여되지 않은 리포지토리는 `403 DENIED`로 응답합니다.

## 읽기 게이트웨이와 미러 {#read-gateways-and-mirrors}

- [읽기 게이트웨이](../operate/read-gateways)는 pull을 처리합니다. push는 `405`를 받습니다.
- [미러](../operate/mirrors)는 원본의 이미지를 태그와 삭제 내역까지 함께 받습니다. 클라이언트는 미러 자체 주소에서 pull합니다. push는 사유 `mirror_read_only`와 함께 `409 DENIED`를 받습니다.

## 제한 {#limits}

| 제한                 | 값                                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 매니페스트 크기      | 4 MiB                                                                                                                                                                  |
| 레이어 크기          | 설치에서 가장 큰 객체 크기인 `ARKVORY_MAX_OBJECT_BYTES`(기본값은 약 10 TiB)                                                                                            |
| 업로드 요청 하나     | 30분 안에 끝나야 하며 30초를 넘게 멈춰 있으면 안 됩니다(`ARKVORY_UPLOAD_DEADLINE_MS`, `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`). 30분은 허용되는 최댓값이기도 합니다.          |
| 완료되지 않은 업로드 | 24시간 동안 활동이 없으면 바이트와 함께 제거됩니다                                                                                                                     |
| 임시 디스크 공간     | 업로드하는 동안 레이어 크기의 최대 두 배                                                                                                                               |
| 동시 업로드          | 기본값은 키당 1개, 서버당 2개(`ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`, `ARKVORY_MAX_UPLOADS`). 대기 중인 요청은 20초 후에 포기합니다(`ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS`). |
| 동시 다운로드        | 기본값은 키당 4개, 서버당 16개                                                                                                                                         |
| 페이지당 태그 수     | 1000                                                                                                                                                                   |
| 할당량               | 레이어, 매니페스트, 완료되지 않은 업로드의 바이트는 리포지토리 할당량과 설치 용량에 포함됩니다                                                                         |

Docker는 각 레이어를 요청 하나로 보냅니다. 따라서 레이어는 업로드 기한 안에 도착해야 하며, 레이어 업로드가 실패하면 첫 바이트부터 다시 시작합니다. 수 GB 이상의 파일에는 대신 [`arkvoryctl`](./cli)을 사용하세요. 파트로 나누어 업로드하고 실패한 뒤에도 이어서 진행합니다. 변수는 [환경 변수](../reference/environment#transfers-and-bandwidth)에 설명되어 있습니다.

## 지원하지 않는 항목 {#not-supported}

- Referrers API. `404`로 응답하며, 클라이언트는 태그로 대체합니다.
- 모든 이미지의 카탈로그 `/v2/_catalog`.
- 다른 리포지토리의 레이어 마운트. 클라이언트가 레이어를 다시 업로드합니다.
- Bearer 토큰용 토큰 서비스. 키 자체를 Basic 또는 Bearer로 보내세요.
- Docker Hub 또는 다른 레지스트리의 풀스루 캐시.
- Docker 스키마 1 매니페스트와 `sha256` 이외의 다이제스트.
- 개별 레이어 삭제.
- 콘솔의 이미지 섹션.

## 테스트용 일반 HTTP {#plain-http-for-tests}

Docker는 HTTPS가 없는 레지스트리를 거부합니다. 기본적으로 로컬 컴퓨터의 주소(`localhost`, `127.0.0.0/8`)만 일반 HTTP로 동작합니다. 다른 호스트의 테스트 서버는 Docker 데몬 구성(Linux에서는 `/etc/docker/daemon.json`)의 `insecure-registries`에 추가하고 Docker를 다시 시작하세요.

```json
{
  "insecure-registries": ["arkvory.test:8080"]
}
```

Podman은 `--tls-verify=false` 옵션을 사용합니다. 일반 HTTP에서는 키가 평문으로 전송됩니다. 테스트 네트워크에서만 사용하세요.

자체 인증 기관의 인증서를 사용하는 경우, Linux의 Docker는 `/etc/docker/certs.d/<host>/ca.crt`에서 CA를 읽습니다(포트가 443이 아니면 포트를 포함). Docker Desktop은 시스템의 신뢰 저장소를 사용합니다.

## 문제 해결 {#troubleshooting}

Docker는 레지스트리 오류 코드를 `denied`나 `name invalid`처럼 소문자와 공백으로 출력하고, 그 뒤에 서버의 메시지를 표시합니다. 모든 오류에는 `detail.requestId`에 요청 ID도 들어 있습니다. 이 ID를 관리자에게 전달하면 서버 로그에서 해당 요청을 찾을 수 있습니다.

| 오류                                              | 원인                                                                                                                       | 해결 방법                                                                                                                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNAUTHORIZED` (401)                              | 키가 없거나, 잘못되었거나, 만료되었거나, 폐기되었습니다                                                                    | 유효한 키로 다시 로그인하세요                                                                                                                                         |
| `DENIED` (403)                                    | 키에 쓰기 권한이 없거나 리포지토리가 보이지 않습니다. 범위가 `read`인 토큰은 "Read-only personal access token"을 받습니다. | 이 리포지토리에 쓰기 액세스가 있는 키를 사용하세요                                                                                                                    |
| `DENIED` (409)                                    | 리포지토리가 미러입니다                                                                                                    | 주 서버에 push하세요                                                                                                                                                  |
| `DENIED` (507)                                    | 리포지토리 할당량 또는 설치 용량에 도달했습니다. 완료되지 않은 업로드도 포함됩니다.                                        | 공간을 확보하거나 더 큰 할당량을 요청하세요                                                                                                                           |
| `NAME_INVALID`                                    | 참조에 리포지토리 뒤의 이미지 부분이 없거나 대문자가 있습니다                                                              | 소문자로 `<host>/<repository>/<image>:<tag>` 형식을 사용하세요                                                                                                        |
| `MANIFEST_UNKNOWN`                                | 이 이미지에 해당 태그나 다이제스트가 없습니다                                                                              | `tags/list`로 이름을 확인하세요                                                                                                                                       |
| `MANIFEST_BLOB_UNKNOWN`                           | 매니페스트가 이 리포지토리에 없는 레이어나 플랫폼 매니페스트를 참조합니다                                                  | 클라이언트가 누락된 부분을 업로드하도록 이미지 전체를 다시 push하세요                                                                                                 |
| `DIGEST_INVALID`                                  | 바이트가 다이제스트와 일치하지 않습니다                                                                                    | 다시 push하세요. 반복되면 프록시를 확인하세요.                                                                                                                        |
| `TOOMANYREQUESTS` (503 또는 429)                  | 이 키의 동시 전송이 너무 많거나 서버가 사용 중입니다                                                                       | 기다린 후 다시 시도하세요. Docker 데몬 구성에서 `"max-concurrent-uploads": 1`처럼 클라이언트의 병렬 업로드를 줄이거나, 관리자에게 전송 한도를 올려 달라고 요청하세요. |
| `http: server gave HTTP response to HTTPS client` | 서버에 HTTPS가 없습니다                                                                                                    | [HTTPS](../install/https)를 설정하거나, 테스트 서버에는 `insecure-registries`를 사용하세요                                                                            |
| `x509: certificate signed by unknown authority`   | Docker가 인증서를 신뢰하지 않습니다                                                                                        | 위에서 설명한 대로 CA 인증서를 설치하세요                                                                                                                             |
| `413 Request Entity Too Large`                    | 리버스 프록시가 요청 크기를 제한합니다                                                                                     | nginx에서 `client_max_body_size 0`을 설정하세요                                                                                                                       |
| 큰 레이어가 30분 후에 멈춥니다                    | 요청 하나의 업로드 기한입니다                                                                                              | 더 빠른 네트워크를 사용하거나, 이런 파일은 이미지에 넣지 말고 `arkvoryctl`로 업로드하세요                                                                             |

## 관련 페이지 {#related-pages}

- [클라이언트 및 프로토콜](./index)
- [계정 및 키](../use/accounts)
- [HTTPS](../install/https)
- [스토리지](../operate/storage)
- [미러](../operate/mirrors) 및 [읽기 게이트웨이](../operate/read-gateways)
