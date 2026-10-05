---
title: TypeScript SDK
---

# TypeScript SDK

TypeScript SDK는 콘솔과 `arkvoryctl`이 사용하는 클라이언트 라이브러리입니다. REST API `/api/v1`을 감싸고 있으며, 모든 응답을 런타임에 검증하고, 파트로 나누어 업로드하고, 중단된 전송을 이어서 진행하고, 다운로드를 SHA-256으로 검증합니다. 표준 웹 API(`fetch`, 스트림, Web Crypto)만 사용하므로 Node.js와 브라우저에서 모두 실행됩니다.

## SDK 가져오기 {#get-the-sdk}

SDK는 `ProAnima/Arkvory` 소스 리포지토리의 `packages/sdk` 폴더에 있는 워크스페이스 패키지 `@proanima/arkvory-sdk`입니다. **npm 레지스트리에는 게시되지 않습니다**. 워크스페이스 패키지 `@proanima/arkvory-contracts`에 의존합니다.

- 사용하려면 소스 리포지토리를 빌드하고(`npm ci`, 이어서 `npm run build`) 리포지토리의 자체 스크립트처럼 그 워크스페이스 안에서 도구를 작성하세요.
- 다른 언어이거나 워크스페이스를 사용할 수 없는 프로젝트에서는 `Authorization: Bearer <key>`로 [REST API](../api/index)를 직접 호출하세요.

소스 코드는 Arkvory 라이선스에 따라 제공됩니다. 조직 내부에서는 사용하고 수정할 수 있습니다. 사본을 배포할 수는 없습니다.

## 클라이언트 만들기 {#create-a-client}

```typescript
import { ArkvoryClient } from '@proanima/arkvory-sdk';

const client = new ArkvoryClient('https://arkvory.example/', () => process.env.ARKVORY_KEY ?? '', {
  requestTimeoutMs: 60_000,
  attemptTimeoutMs: 120_000,
  maxRetries: 20,
});
const releases = client.inRepository('releases');
```

- **기본 URL.** HTTPS가 필요합니다. 일반 HTTP는 `localhost`, `127.0.0.1`, `[::1]`에서만 허용됩니다. URL에는 사용자, 비밀번호, 쿼리, 프래그먼트를 포함할 수 없습니다. 경로 접두사는 포함할 수 있습니다. 리디렉션은 오류로 처리됩니다.
- **토큰 콜백.** SDK는 요청마다 이 콜백을 호출하며 결과를 캐시하지 않습니다. 새 클라이언트를 만들지 않고도 키를 교체할 수 있습니다.
- **`inRepository(id)`**는 리포지토리 하나에 연결된 클라이언트를 반환합니다. 편의 기능이며 보안 경계가 아닙니다.

| 옵션               | 기본값 | 의미                                                                                                                |
| ------------------ | ------ | ------------------------------------------------------------------------------------------------------------------- |
| `signal`           | 없음   | 이 클라이언트의 모든 요청을 취소합니다                                                                              |
| `requestTimeoutMs` | 없음   | 자체 신호가 없는 요청의 기한(1~3600000)                                                                             |
| `maxAttempts`      | 5      | 전송 요청 하나의 시도 횟수(첫 시도 포함, 1~10)                                                                      |
| `maxRetries`       | 20     | 업로드 또는 다운로드 작업 하나가 공유하는 재시도 횟수(0~100)                                                        |
| `attemptTimeoutMs` | 120000 | 전송 시도 한 번의 제한 시간(1~1800000)                                                                              |
| `baseDelayMs`      | 500    | 첫 백오프 지연(1~60000)                                                                                             |
| `maxDelayMs`       | 60000  | `Retry-After`를 포함한 최대 지연                                                                                    |
| `onRequest`        | 없음   | HTTP 요청마다 한 번 호출되며 메서드, 경로, 상태, 소요 시간, 요청 ID를 받습니다. 자격 증명은 절대 전달되지 않습니다. |

자동 재시도는 전송에만 적용됩니다. `create`, `resume` 안의 단계, `downloadVerified`가 해당합니다. 네트워크 실패와 HTTP 408, 429, 502, 503, 504를 지수 백오프로 재시도하며, `Retry-After`보다 일찍 재시도하지 않습니다. 다른 호출은 한 번만 실행됩니다. 리비전으로 보호되는 변경은 자동으로 반복되지 않습니다.

## 일반적인 작업 {#common-tasks}

### 탐색과 목록 조회 {#discover-and-list}

```typescript
const permissions = await client.permissions();
const repositories = await client.repositories({ limit: 50 });
const page = await releases.artifacts.list();
const found = await releases.artifacts.search({ q: 'build-42', label: 'staging' });
for (const item of found.items) console.log(item.id, item.name, item.size);
const artifact = await releases.artifacts.get('00000000-0000-4000-8000-000000000001');
```

목록은 페이지 단위로 반환되며 응답에 `next`가 포함됩니다. 다음 페이지를 읽으려면 이 값을 `after`로 전달하세요.

### 재개 가능한 대용량 파일 업로드(Node.js) {#upload-a-large-file-with-resume-node-js}

```typescript
import { openAsBlob } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const file = await openAsBlob('./build/Game.zip'); // 메모리에 읽어 들이지 않음
const hash = createHash('sha256');
for await (const chunk of file.stream()) hash.update(chunk);

const key = randomUUID(); // 첫 요청 전에 작업 상태와 함께 저장하세요
const session = await releases.uploads.create(key, {
  name: 'Game.zip',
  size: String(file.size),
  sha256: hash.digest('hex'),
  labels: ['test'],
  metadata: { commit: 'abc123' },
});
const uploaded = await releases.uploads.resume(session.id, file, {
  onProgress: (bytes) => console.log(`${bytes} of ${file.size} bytes`),
});
await releases.assets.assign('builds/game/1.4/Game.zip', uploaded.id, 0); // 0: 새 경로
```

- 같은 멱등성 키와 같은 설명자를 사용하면 같은 세션이 반환되므로, 응답이 유실되어도 업로드가 두 번 만들어지지 않습니다.
- `resume`은 서버에 이미 있는 파트를 읽어 해시를 사용자의 파일과 대조하고, 없는 파트만 보냅니다. 비정상 종료 후에는 저장해 둔 세션 ID로 `resume`을 다시 호출하세요.
- 파트 크기는 서버가 정합니다. 기본은 8 MiB이며, 10,000개를 넘는 파트가 필요한 파일에서만 더 커집니다. SDK는 한 번에 파트 하나만 메모리에 보관합니다.
- 16 GiB 이상의 파일은 서버 워커가 마무리합니다. `resume`은 워커가 끝나기를 기다립니다.
- 경로의 리비전이 다르면 `assets.assign(path, artifactId, expectedRevision)`은 충돌로 실패합니다. 먼저 `assets.get(path)`로 경로를 읽으세요.

### 검증하며 다운로드 {#download-with-verification}

```typescript
import { createWriteStream } from 'node:fs';
import { rename } from 'node:fs/promises';
import { Writable } from 'node:stream';

const stream = await releases.artifacts.downloadVerified(uploaded.id);
await stream.pipeTo(Writable.toWeb(createWriteStream('./Game.zip.part')));
await rename('./Game.zip.part', './Game.zip'); // pipeTo가 성공한 뒤에만
```

SDK는 콘텐츠를 8 MiB 범위로 읽으면서 각 범위의 크기, `Content-Range`, `ETag`를 확인합니다. 마지막 블록을 전달하기 전에 전체 파일의 SHA-256을 확인합니다. 검증에 실패하면 스트림이 `ArkvoryIntegrityError`로 실패합니다. 스트림에서 곧바로 배포하지 마세요. 임시 파일에 쓰고, 스트림이 성공적으로 끝난 뒤에만 사용하세요.

재시작한 뒤에 이어서 받으려면 이미 저장한 바이트를 `prefix`로 전달하세요. 그러면 스트림에는 나머지 부분만 들어 있습니다.

```typescript
const prefix = await openAsBlob('./Game.zip.part');
const rest = await releases.artifacts.downloadVerified(uploaded.id, { prefix });
await rest.pipeTo(Writable.toWeb(createWriteStream('./Game.zip.part', { flags: 'a' })));
```

검증 없이 바이트 범위 하나만 받으려면 `releases.artifacts.download(id, { start: 0, end: 1023 })`를 사용하세요. 원본 `Response`(상태 206)를 반환합니다.

### 경로 기반 원시 파일 {#raw-files-by-path}

```typescript
const body = new Blob([JSON.stringify({ level: 3 })]);
const result = await client.raw.putRawFile('releases', 'config/settings.json', body, {
  createOnly: true, // 선택 사항: 경로가 이미 있으면 거부
});
console.log(result.revision, result.created); // 바이트가 이미 있으면 created는 false
const response = await client.raw.downloadRawFile('releases', 'config/settings.json');
```

`sha256` 옵션(16진수 64자리)을 지정하면 서버가 바이트를 한 번에 쓰고 불일치를 거부합니다. `releases.assets.put(path, blob, options)`와 `releases.assets.download(path, range)`는 같은 호출입니다. 업로드는 요청 하나로 끝나므로 작은 파일과 중간 크기 파일에 사용하세요. [원시 파일](./raw-files)을 참조하세요.

### 패키지, 승격, 링크 {#packages-promotion-and-links}

```typescript
await releases.packages.register(uploaded.id); // UPack 아카이브
const selected = await releases.packages.resolve({ name: 'app', range: '^1.4', stage: 'release' });
await releases.promotions.promote(selected.artifactId, {
  target: 'prod',
  mode: 'copy',
  stages: ['release'],
});
const link = await releases.artifacts.link(selected.artifactId, { ttlSeconds: 900 });
```

링크 URL은 `expiresAt`까지 아티팩트 하나를 읽을 수 있는 시크릿입니다. 일찍 폐기할 수 없습니다.

### 백업 {#backups}

```typescript
const status = await client.backup.status();
const job = await client.backup.run(); // 백업 에이전트의 대기열에 추가됨
const points = await client.backup.points({ limit: 20 });
```

백업 호출에는 계정 관리자 세션 또는 소유자 파일 키가 필요합니다. 서비스 키와 개인용 토큰은 403을 받습니다.

## 오류 {#errors}

```typescript
import {
  ArkvoryClientError,
  ArkvoryHttpError,
  ArkvoryIntegrityError,
  ArkvoryNetworkError,
} from '@proanima/arkvory-sdk';

try {
  await releases.artifacts.get(id);
} catch (error) {
  if (error instanceof ArkvoryHttpError) {
    console.error(error.status, error.code, error.reason, error.requestId, error.retryAfterSeconds);
  } else if (error instanceof ArkvoryClientError) {
    console.error(error.code);
  }
}
```

| 클래스                  | 의미                                                                                                                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ArkvoryHttpError`      | 서버가 오류로 응답했습니다. 필드: `status`, `code`, `reason`, `details`, `requestId`, `retryAfterMs`, `retryAfterSeconds`, `serverMessage`. 프록시가 Arkvory 형식이 아닌 응답을 보낸 경우 `code`는 `http_error`입니다. |
| `ArkvoryNetworkError`   | 모든 재시도 후에도 연결에 실패했거나 시간이 초과되었습니다                                                                                                                                                             |
| `ArkvoryIntegrityError` | 다운로드한 바이트가 아티팩트와 일치하지 않습니다                                                                                                                                                                       |
| `ArkvoryClientError`    | `code`가 있는 로컬 오류: `invalid_argument`, `insecure_url`, `invalid_response`, `response_too_large`, `size_mismatch`, `file_changed`, `upload_cancelled`, `completion_failed`                                        |

메시지 텍스트가 아니라 `code`와 `reason`으로 판단하세요. 알 수 없는 코드는 HTTP 상태로 처리하세요. `Error.message`에는 서버가 보낸 텍스트가 포함되지 않습니다. [오류](../api/errors)를 참조하세요.

## 브라우저와 Node.js {#browser-and-node-js}

- **다른 출처의 브라우저.** 관리자가 서버의 `ARKVORY_CORS_ORIGINS`에 페이지의 정확한 출처를 등록해야 합니다. SDK는 키를 `Authorization` 헤더로 보내며 쿠키는 절대 보내지 않습니다.
- **브라우저의 키.** 키는 메모리에만 보관하세요. URL, `localStorage`, 로그, 페이지 소스에 넣지 마세요. 사용자는 `client.login(name, password)`로 로그인하여 세션 토큰을 받을 수 있습니다.
- **Node.js의 파일.** 파일을 메모리에 읽어 들이지 않고 전달하려면 `node:fs`의 `openAsBlob`을 사용하세요.
- **다운로드 대기열.** `DownloadQueue`와 `checkpointedDownload`는 일시 중지, 재개, 취소를 지원하는 제한된 대기열을 제공합니다. 스토리지 어댑터는 직접 제공해야 합니다.

## 제한 {#limits}

- JSON 응답은 2 MiB로 제한됩니다(패키지 페이지는 8 MiB, 아티팩트 목록은 24 MiB). 이보다 큰 응답은 `response_too_large`로 실패합니다.
- 크기는 10진수 문자열이므로 2^53을 넘는 값도 정밀도가 그대로 유지됩니다.

## 관련 페이지 {#related-pages}

- [명령줄(arkvoryctl)](./cli)
- [전송](../use/transfers)
- [API 개요](../api/index) 및 [인증](../api/authentication)
- [원시 파일](./raw-files)
