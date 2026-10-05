---
title: Git LFS
description: Arkvory에 git 리포지토리의 대용량 파일을 저장하고, 예를 들어 Unity와 Unreal 프로젝트를 위한 바이너리 에셋을 잠급니다.
---

# Git LFS

모든 Arkvory 리포지토리는 Git LFS 서버입니다. git 리포지토리는 예를 들어 GitHub, GitLab 또는 Gitea에 그대로 둡니다. Git LFS가 추적하는 대용량 파일과 파일 잠금만 Arkvory로 갑니다. LFS 객체는 일반 아티팩트이므로 리포지토리 권한, 할당량, SHA-256 검사, 백업, 미러가 모두 적용됩니다.

## git 리포지토리 설정 {#set-up}

HTTPS가 설정된 서버 주소([HTTPS](../install/https) 참조), Arkvory 리포지토리(예: `games`), 그리고 키([계정 및 키](../use/accounts) 참조)가 필요합니다.

1. 리포지토리를 사용하는 모든 머신에 Git LFS를 설치하고, 사용자마다 한 번 `git lfs install`을 실행하세요.
2. git 리포지토리 루트에 `.lfsconfig` 파일을 만들고 커밋하세요. 그러면 팀 전체가 Arkvory를 사용하게 됩니다:

```ini
[lfs]
	url = https://arkvory.example/lfs/games
```

3. 파일 패턴을 추적하세요. 그러면 `.gitattributes`가 기록되며, 이것도 커밋합니다:

```bash
git lfs track "*.psd" "*.fbx" "*.wav" "*.uasset" "*.umap"
git add .gitattributes .lfsconfig
```

4. 평소처럼 커밋하고 푸시하세요. 첫 요청에서 자격 증명을 묻습니다: [로그인](#sign-in)을 참조하세요.

리포지토리의 LFS 주소는 항상 `https://<host>/lfs/<repository>`입니다.

다른 서버의 LFS에 이미 있는 파일을 옮기려면, 먼저 이전 서버에서 모든 객체를 내려받은 다음 `lfs.url`을 바꾸고 업로드하세요:

```bash
git lfs fetch --all origin
git config lfs.url https://arkvory.example/lfs/games
git lfs push --all origin
```

## 로그인 {#sign-in}

Arkvory는 HTTP Basic 인증의 비밀번호로 키를 받습니다. 사용자 이름은 확인하지 않으므로 아무 이름이나 사용하세요. 키는 Bearer 토큰으로 올 수도 있습니다.

Git은 서버가 처음 `401`로 응답할 때 자격 증명 도우미를 통해 사용자 이름과 비밀번호를 묻습니다. 도우미는 이를 저장합니다. Windows와 macOS에서는 Git Credential Manager, Linux에서는 `credential.helper store` 또는 `cache`입니다.

| 대상          | 키                                                                                      |
| ------------- | --------------------------------------------------------------------------------------- |
| 개발자        | 개인용 액세스 토큰. 푸시와 잠금에는 `read-write` 범위, 클론과 풀만 할 때는 `read` 범위. |
| 빌드 서버, CI | [권한](#permissions)에 있는 작업을 가진 서비스 키                                       |

Git은 호스트별로 자격 증명을 보관합니다. Arkvory용 키는 git 리포지토리의 호스트(예: GitHub) 자격 증명을 대체하지 않습니다.

자격 증명 도우미가 없는 CI 러너에서는 키를 체크아웃의 로컬 구성에 넣으세요. 그러면 키는 그 작업 공간의 `.git/config`에만 있고 `.lfsconfig`에는 절대 들어가지 않습니다:

```bash
git config lfs.url "https://ci:${ARKVORY_KEY}@arkvory.example/lfs/games"
```

키를 커밋하지 마세요. 로그에 출력하지 마세요. 작업이 끝나면 작업 공간을 제거하세요.

## 일상적인 작업 {#daily-work}

Git LFS는 다른 LFS 서버와 똑같이 동작합니다. 사용하는 명령은 다음과 같습니다:

| 명령                                    | 하는 일                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `git push`                              | 커밋을 푸시하기 전에 새 LFS 객체를 Arkvory에 업로드합니다                  |
| `git clone`, `git pull`, `git checkout` | 작업 트리에 필요한 객체를 내려받습니다                                     |
| `git lfs fetch --all`                   | 모든 브랜치의 객체를 내려받습니다                                          |
| `git lfs ls-files`                      | 추적 중인 파일과 짧은 ID를 나열합니다                                      |
| `git lfs push --all origin`             | 로컬 객체를 모두 다시 업로드합니다. Arkvory에 있는 객체는 보내지 않습니다. |

Arkvory에 이미 있는 객체는 ID와 크기가 같으면 다시 보내지 않습니다. 중단 후 다시 푸시하면 없는 것만 보냅니다.

## 파일 잠금 {#locks}

바이너리 에셋은 병합할 수 없습니다. 잠금은 한 사람이 파일을 편집 중임을 팀에 알립니다. 잠금은 브랜치가 아니라 Arkvory 리포지토리에 속합니다.

```bash
git lfs lock Content/Maps/Level01.umap
git lfs locks
git lfs unlock Content/Maps/Level01.umap
```

- 같은 경로에 두 번째 `git lfs lock`을 하면 "already created lock"과 함께 실패하고 소유자를 알려 줍니다.
- 소유자는 잠금이 만들어질 당시의 사용자 또는 서비스 계정 이름으로 표시됩니다. 파일 키는 자신의 ID를 표시합니다.
- 파일을 잠금 해제할 수 있는 것은 소유자뿐입니다. 다른 사람의 잠금에 `git lfs unlock --force`를 쓰려면 리포지토리의 `artifact.delete` 작업이 있는 서비스 키가 필요합니다. 개인용 토큰은 잠금을 깰 수 없습니다.
- 잠금 경로는 git 리포지토리의 경로입니다. 최대 1024자이며, 폴더 사이는 `/`, 빈 세그먼트, `.` 또는 `..`, 백슬래시, 콜론은 허용되지 않습니다.
- `git lfs locks`는 페이지당 100개의 잠금을 표시합니다.

다른 사람이 잠근 파일에 대한 변경을 git이 푸시하지 못하도록 푸시 전 검사를 켜세요. 설정은 서버 주소별입니다:

```bash
git config lfs.https://arkvory.example/lfs/games.locksverify true
```

편집하기 전에 잠가야 할 파일 타입을 표시하세요. 그러면 Git LFS는 잠글 때까지 해당 파일을 읽기 전용으로 유지합니다:

```bash
git lfs track --lockable "*.umap" "*.uasset"
```

푸시 시 잠금 검사에는 쓰기 액세스가 필요하므로 읽기 전용 토큰은 사용할 수 없습니다. 잠금 목록은 읽기 액세스로 가능한 `git lfs locks`로 확인하세요.

## Unity 및 Unreal 팁 {#game-engines}

- Unity: 텍스트 에셋(`.unity`, `.prefab`, `.asset`)은 git에 두고, 에셋 직렬화를 Force Text로 설정하세요. 대용량 바이너리는 LFS로 추적합니다. 예: `*.png`, `*.psd`, `*.fbx`, `*.wav`, `*.mp4`, `*.exr`. LFS로 추적하는 텍스트 파일도 허용됩니다.
- Unreal Engine: `*.uasset`, `*.umap`과 대용량 소스 파일을 추적하고, `*.uasset`과 `*.umap`을 잠금 가능으로 표시하세요.
- LFS 잠금 명령을 호출하는 에디터 통합은 Git LFS의 표준 파일 잠금 프로토콜을 사용합니다. Arkvory는 `git` 및 `git-lfs` 명령줄 클라이언트로 테스트했습니다.
- 수십 GB의 변경되는 빌드 결과물을 LFS에 넣지 마세요. 아티팩트로 업로드하거나 [`arkvoryctl`](./cli)로 [원시 파일](./raw-files)로 업로드하세요. LFS 객체는 보존으로 삭제되지 않으므로 영구히 남습니다.
- Unity 프로젝트가 공유하는 재사용 가능한 대용량 코드나 도구에는 [Unity 패키지](./unity-npm)를 사용하는 편이 낫습니다.

## 저장되는 내용 {#what-is-stored}

- LFS 객체는 Arkvory 리포지토리의 아티팩트입니다. 이름과 ID는 콘텐츠의 SHA-256(LFS의 `oid`)이며, `lfs` 레이블을 가집니다. 이 아티팩트는 콘솔의 [[ui:catalog]]에서 볼 수 있습니다.
- Arkvory는 객체를 받는 동안 크기와 SHA-256을 검증합니다. `oid`와 다르면 업로드가 `422`로 실패하고 아무것도 저장되지 않습니다.
- 객체는 리포지토리에 속합니다. 두 Arkvory 리포지토리는 같은 파일의 사본을 각자 보관합니다.
- 서버는 어떤 커밋이 아직 객체를 필요로 하는지 알 수 없으므로 보존이 LFS 객체를 제거하지 않습니다. LFS 객체를 삭제하는 명령은 없습니다. 에셋의 전체 이력을 기준으로 리포지토리 할당량을 계획하세요.
- 잠금은 데이터베이스의 행입니다. 백업에 포함됩니다.

## 권한 {#permissions}

개인용 토큰과 파일 키는 리포지토리에 대한 읽기 또는 쓰기 액세스를 가집니다. 서비스 키는 정확한 작업을 가집니다.

| 작업                               | 서비스 키 작업    | 개인용 토큰 또는 파일 키            |
| ---------------------------------- | ----------------- | ----------------------------------- |
| 다운로드(`clone`, `fetch`, `pull`) | `content.read`    | 읽기 액세스                         |
| 업로드(`push`)                     | `upload.create`   | 쓰기 액세스, 토큰 범위 `read-write` |
| 잠금 나열                          | `artifact.list`   | 읽기 액세스                         |
| 자신의 잠금 생성, 검증 및 해제     | `upload.create`   | 쓰기 액세스, 토큰 범위 `read-write` |
| 다른 사람의 잠금 해제(`--force`)   | `artifact.delete` | 불가능                              |

푸시와 풀을 모두 하는 CI 작업에는 `content.read`, `upload.create`, `artifact.list`가 필요합니다. 푸시만 할 수 있는 키도 객체의 존재를 알 수 있으므로 같은 객체를 두 번 업로드하지 않습니다.

읽기 전용 개인용 토큰은 다운로드 목록 요청이 `POST`임에도 클론과 풀을 할 수 있습니다. 푸시와 잠금은 할 수 없습니다. 미러와 읽기 게이트웨이는 [미러 및 읽기 게이트웨이](#mirrors-and-read-gateways)에서 다룹니다.

## 전송 방식 {#how-it-works}

일상적인 작업에는 이 세부 정보가 필요하지 않습니다. 프록시나 방화벽을 디버그할 때 도움이 됩니다.

1. Git LFS는 작업(`download` 또는 `upload`)과 객체 목록을 담아 `POST /lfs/<repository>/objects/batch`를 한 번 보냅니다. 요청당 최대 1000개의 객체입니다. Git LFS는 기본적으로 최대 100개를 보냅니다.
2. Arkvory는 전송해야 할 각 객체에 대해 한 시간 동안 유효한 링크로 응답합니다. 업로드의 경우 이미 가진 객체는 빼놓습니다.
3. Git LFS는 각 객체를 `/lfs/<repository>/objects/<oid>`로 `PUT`으로 보내거나 `GET`으로 내려받습니다. 요청은 배치 요청과 같은 키를 전달합니다.
4. `PUT`에는 `Content-Length` 헤더가 필요합니다. 청크 업로드는 `422`로 거부됩니다.

지원:

| 항목          | 값                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------- |
| 전송 어댑터   | `basic`만                                                                                         |
| 해시 알고리즘 | `sha256`만. 다른 것을 요청하는 클라이언트는 `409`를 받습니다.                                     |
| 인증          | Basic(비밀번호로 키) 또는 Bearer                                                                  |
| 다운로드      | `Range` 요청을 지원하는 `GET`과 `HEAD`                                                            |
| 미디어 타입   | JSON 요청에는 `application/vnd.git-lfs+json`. 모든 미디어 타입의 객체 본문은 바이트로 저장됩니다. |

오류는 `message`와 `request_id`가 있는 JSON 문서입니다. 관리자에게 도움을 요청할 때 `request_id`를 함께 알려 주세요.

링크는 클라이언트가 서버에 도달한 주소를 가리킵니다. 리버스 프록시가 HTTPS를 종료할 때는 설치 예제의 nginx처럼 `Host` 헤더를 전달하고 `X-Forwarded-Proto: https`를 보내야 링크가 `https`를 사용합니다. Arkvory는 링크가 `https`이거나 로컬 컴퓨터를 가리킬 때만 링크에 키를 넣습니다. 다른 호스트로의 일반 HTTP에서는 git이 객체와 함께 키를 보낼 수 없어 전송이 실패합니다.

## 대용량 파일과 재개 {#large-files}

- Git LFS는 각 객체를 하나의 `PUT` 요청으로 보냅니다. 실패하면 객체를 처음 바이트부터 다시 시작합니다. 객체 내부에서 재개하는 `tus` 어댑터는 지원하지 않습니다.
- 업로드 요청은 30분 안에 끝나야 하고 30초 넘게 멈추면 안 됩니다(`ARKVORY_UPLOAD_DEADLINE_MS`, `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`). 수 GB의 파일에는 빠르고 안정적인 네트워크가 필요합니다. 더 큰 파일에는 파트로 나누어 업로드하는 [`arkvoryctl`](./cli)을 사용하세요.
- 다운로드는 `Range` 요청을 받습니다.
- 객체는 설치의 최대 객체 크기(`ARKVORY_MAX_OBJECT_BYTES`, 기본 약 10 TiB)만큼 클 수 있습니다. 더 큰 객체는 배치 응답에서 `422`로 거부됩니다.

기본적으로 서버는 동시 업로드 2개, 키당 1개를 실행합니다(`ARKVORY_MAX_UPLOADS`, `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`). Git LFS는 기본적으로 객체 8개를 동시에 보냅니다. 다른 업로드는 빈 슬롯을 기다리다가 20초 후 `503`과 함께 포기합니다(`ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS`). Git LFS는 실패한 객체를 몇 번 반복하지만, 대용량 파일 푸시는 병렬 전송을 줄이는 편이 더 안정적입니다:

```bash
git config lfs.concurrenttransfers 1
```

관리자에게 한도를 올려 달라고 요청할 수도 있습니다. 이에 대한 설명은 [환경 변수](../reference/environment#transfers-and-bandwidth)에 있습니다.

## 미러 및 읽기 게이트웨이 {#mirrors-and-read-gateways}

| 위치                                        | 클론 및 페치                                                                  | 푸시 및 잠금                                                             |
| ------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 주 서버                                     | 예                                                                            | 예                                                                       |
| [미러](../operate/mirrors)                  | 예. 미러는 원본의 객체를 가지므로 `lfs.url`을 미러로 지정하세요.              | 거부됨(`409`, 사유 `mirror_read_only`). 잠금은 미러로 복사되지 않습니다. |
| [읽기 게이트웨이](../operate/read-gateways) | 아니요. 다운로드 목록이 `POST` 요청인데 읽기 게이트웨이는 이를 받지 않습니다. | 아니요                                                                   |

`lfs.url`은 항상 주 서버를, 읽기 전용 머신이라면 미러를 가리키세요.

## 문제 해결 {#troubleshooting}

| 메시지 또는 증상                                   | 원인                                                                | 해결 방법                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `401` 또는 권한 부여 오류                          | 키가 없거나, 잘못된 키이거나, 만료·폐기된 토큰                      | 자격 증명 관리자에서 저장된 자격 증명을 제거하고 유효한 키로 다시 푸시하세요 |
| "Read-only personal access token"과 함께 `403`     | 토큰에 `read` 범위가 있음                                           | `read-write` 범위의 토큰을 만드세요                                          |
| `403`                                              | 키에 이 작업에 대한 액세스가 없거나 리포지토리가 키에 부여되지 않음 | [권한](#permissions)의 작업을 추가하세요                                     |
| `Lock failed: already created lock`                | 누군가 잠금을 보유 중                                               | 소유자에게 잠금 해제를 요청하거나, 관리자에게 `--force` 사용을 요청하세요    |
| `422` "Object exceeds the maximum size"            | 객체가 설치의 한도보다 큼                                           | 이런 파일에는 `arkvoryctl`을 사용하세요                                      |
| 업로드 시 `422`                                    | 콘텐츠가 `oid`와 일치하지 않음. 푸시 중에 파일이 변경됨             | `git lfs push`를 다시 실행하세요                                             |
| `503` 또는 `Retry-After`                           | 동시 전송이 너무 많음                                               | `lfs.concurrenttransfers`를 낮추고 다시 시도하세요                           |
| `507`                                              | 리포지토리 할당량 또는 설치 용량에 도달함                           | 공간을 확보하거나 더 큰 할당량을 요청하세요                                  |
| 업로드 시 `409`                                    | 리포지토리가 미러임                                                 | 주 서버로 푸시하세요                                                         |
| 작업 트리의 파일이 `oid`가 있는 작은 텍스트 파일임 | 객체를 내려받지 않았거나 `git lfs install`을 실행하지 않음          | `git lfs install`을 실행한 다음 `git lfs pull`을 실행하세요                  |
| `x509: certificate signed by unknown authority`    | 클라이언트가 인증서를 신뢰하지 않음                                 | 시스템의 신뢰 저장소에 인증 기관을 추가하거나 `http.sslCAInfo`를 설정하세요  |

TLS 검증을 끄지 마세요(`GIT_SSL_NO_VERIFY`). 키가 모든 요청과 함께 전송됩니다.

## 관련 페이지 {#related-pages}

- [클라이언트 및 프로토콜](./index)
- [계정 및 키](../use/accounts)
- [HTTPS](../install/https)
- [미러](../operate/mirrors)
- [Unity 및 npm 패키지](./unity-npm)
