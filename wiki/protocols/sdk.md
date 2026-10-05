---
title: TypeScript SDK
---

# TypeScript SDK

The TypeScript SDK is the client library that the console and `arkvoryctl` use. It wraps the REST API `/api/v1`. It validates every response at runtime, uploads in parts, continues interrupted transfers and verifies downloads by SHA-256. It uses only standard web APIs (`fetch`, streams, Web Crypto), so it runs in Node.js and in browsers.

## Get the SDK {#get-the-sdk}

The SDK is the workspace package `@proanima/arkvory-sdk` in the folder `packages/sdk` of the `ProAnima/Arkvory` source repository. It is **not published to the npm registry**. It depends on the workspace package `@proanima/arkvory-contracts`.

- To use it, build the source repository (`npm ci`, then `npm run build`) and write your tool inside that workspace, as the repository's own scripts do.
- From another language, or from a project that cannot use the workspace, call the [REST API](../api/index) directly with `Authorization: Bearer <key>`.

The source code is available under the Arkvory license. You may use and change it inside your organization. You may not distribute copies.

## Create a client {#create-a-client}

```typescript
import { ArkvoryClient } from '@proanima/arkvory-sdk';

const client = new ArkvoryClient('https://arkvory.example/', () => process.env.ARKVORY_KEY ?? '', {
  requestTimeoutMs: 60_000,
  attemptTimeoutMs: 120_000,
  maxRetries: 20,
});
const releases = client.inRepository('releases');
```

- **Base URL.** HTTPS is required. Plain HTTP is allowed only for `localhost`, `127.0.0.1` and `[::1]`. The URL must not contain a user, password, query or fragment. It may contain a path prefix. Redirects are treated as errors.
- **Token callback.** The SDK calls it for every request and never caches the result. You can rotate keys without creating a new client.
- **`inRepository(id)`** returns a client bound to one repository. It is a convenience, not a security boundary.

| Option             | Default | Meaning                                                                                                      |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------ |
| `signal`           | none    | Cancels every request of this client                                                                         |
| `requestTimeoutMs` | none    | Deadline of a request that has no own signal (1 to 3600000)                                                  |
| `maxAttempts`      | 5       | Attempts of one transfer request, including the first (1 to 10)                                              |
| `maxRetries`       | 20      | Retries shared by one upload or download operation (0 to 100)                                                |
| `attemptTimeoutMs` | 120000  | Limit of one transfer attempt (1 to 1800000)                                                                 |
| `baseDelayMs`      | 500     | First backoff delay (1 to 60000)                                                                             |
| `maxDelayMs`       | 60000   | Longest delay, including `Retry-After`                                                                       |
| `onRequest`        | none    | Called once per HTTP request with method, path, status, duration and request ID. Never receives credentials. |

Automatic retries apply only to transfers: `create`, the steps inside `resume`, and `downloadVerified`. They retry network failures and HTTP 408, 429, 502, 503 and 504, with exponential backoff, and never earlier than `Retry-After`. Other calls run once. Changes protected by a revision are never repeated automatically.

## Common tasks {#common-tasks}

### Discover and list {#discover-and-list}

```typescript
const permissions = await client.permissions();
const repositories = await client.repositories({ limit: 50 });
const page = await releases.artifacts.list();
const found = await releases.artifacts.search({ q: 'build-42', label: 'staging' });
for (const item of found.items) console.log(item.id, item.name, item.size);
const artifact = await releases.artifacts.get('00000000-0000-4000-8000-000000000001');
```

Pages return `next`. Pass it as `after` to read the next page.

### Upload a large file with resume (Node.js) {#upload-a-large-file-with-resume-node-js}

```typescript
import { openAsBlob } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const file = await openAsBlob('./build/Game.zip'); // not read into memory
const hash = createHash('sha256');
for await (const chunk of file.stream()) hash.update(chunk);

const key = randomUUID(); // save it with the job state before the first request
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
await releases.assets.assign('builds/game/1.4/Game.zip', uploaded.id, 0); // 0: the path is new
```

- The same idempotency key with the same descriptor returns the same session, so a lost response does not create a second upload.
- `resume` reads the parts that the server already has, checks their hashes against your file and sends only the missing parts. After a crash, call `resume` again with the saved session ID.
- The server chooses the part size: 8 MiB, larger only for files that need more than 10,000 parts. The SDK holds one part in memory at a time.
- Files of 16 GiB and more are completed by the server worker. `resume` waits for it.
- `assets.assign(path, artifactId, expectedRevision)` fails with a conflict if the path has another revision. Read the path with `assets.get(path)` first.

### Download with verification {#download-with-verification}

```typescript
import { createWriteStream } from 'node:fs';
import { rename } from 'node:fs/promises';
import { Writable } from 'node:stream';

const stream = await releases.artifacts.downloadVerified(uploaded.id);
await stream.pipeTo(Writable.toWeb(createWriteStream('./Game.zip.part')));
await rename('./Game.zip.part', './Game.zip'); // only after pipeTo succeeded
```

The SDK reads the content in 8 MiB ranges and checks the size, `Content-Range` and `ETag` of each range. It checks the SHA-256 of the whole file before it delivers the last block. If the check fails, the stream fails with `ArkvoryIntegrityError`. Never deploy from the stream directly: write to a temporary file and use it only after the stream ends successfully.

To continue after a restart, pass the bytes you already saved as `prefix`. The stream then contains only the rest:

```typescript
const prefix = await openAsBlob('./Game.zip.part');
const rest = await releases.artifacts.downloadVerified(uploaded.id, { prefix });
await rest.pipeTo(Writable.toWeb(createWriteStream('./Game.zip.part', { flags: 'a' })));
```

For one byte range without verification, `releases.artifacts.download(id, { start: 0, end: 1023 })` returns the raw `Response` (status 206).

### Raw files by path {#raw-files-by-path}

```typescript
const body = new Blob([JSON.stringify({ level: 3 })]);
const result = await client.raw.putRawFile('releases', 'config/settings.json', body, {
  createOnly: true, // optional: refuse if the path exists
});
console.log(result.revision, result.created); // created is false when the bytes were already there
const response = await client.raw.downloadRawFile('releases', 'config/settings.json');
```

The option `sha256` (64 hex digits) lets the server write the bytes in one pass and reject a mismatch. `releases.assets.put(path, blob, options)` and `releases.assets.download(path, range)` are the same calls. Each upload is one request, so use them for small and medium files. See [Raw files](./raw-files).

### Packages, promotion and links {#packages-promotion-and-links}

```typescript
await releases.packages.register(uploaded.id); // UPack archive
const selected = await releases.packages.resolve({ name: 'app', range: '^1.4', stage: 'release' });
await releases.promotions.promote(selected.artifactId, {
  target: 'prod',
  mode: 'copy',
  stages: ['release'],
});
const link = await releases.artifacts.link(selected.artifactId, { ttlSeconds: 900 });
```

The link URL is a secret that reads one artifact until `expiresAt`. It cannot be revoked early.

### Backups {#backups}

```typescript
const status = await client.backup.status();
const job = await client.backup.run(); // queued for the backup agent
const points = await client.backup.points({ limit: 20 });
```

Backup calls need an account administrator session or the owner file key. Service keys and personal tokens get 403.

## Errors {#errors}

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

| Class                   | Meaning                                                                                                                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ArkvoryHttpError`      | The server answered with an error. Fields: `status`, `code`, `reason`, `details`, `requestId`, `retryAfterMs`, `retryAfterSeconds`, `serverMessage`. `code` is `http_error` when a proxy answered without the Arkvory format. |
| `ArkvoryNetworkError`   | Connection failed or timed out after all retries                                                                                                                                                                              |
| `ArkvoryIntegrityError` | Downloaded bytes do not match the artifact                                                                                                                                                                                    |
| `ArkvoryClientError`    | Local failure with `code`: `invalid_argument`, `insecure_url`, `invalid_response`, `response_too_large`, `size_mismatch`, `file_changed`, `upload_cancelled`, `completion_failed`                                             |

Decide by `code` and `reason`, not by message text. Handle unknown codes by HTTP status. `Error.message` never contains server text. See [Errors](../api/errors).

## Browser and Node.js {#browser-and-node-js}

- **Browser on another origin.** The administrator must list the exact origin of your page in `ARKVORY_CORS_ORIGINS` on the server. The SDK sends the key in the `Authorization` header and never sends cookies.
- **Keys in a browser.** Keep the key in memory only. Do not put it in URLs, `localStorage`, logs or the page source. A user can sign in with `client.login(name, password)` to get a session token.
- **Files in Node.js.** Use `openAsBlob` from `node:fs` to pass a file without reading it into memory.
- **Download queue.** `DownloadQueue` and `checkpointedDownload` provide a bounded queue with pause, resume and cancel. You supply the storage adapter.

## Limits {#limits}

- JSON responses are limited to 2 MiB (package pages 8 MiB, artifact lists 24 MiB). Larger answers fail with `response_too_large`.
- Sizes are decimal strings, so values above 2^53 keep full precision.

## Related pages {#related-pages}

- [Command line (arkvoryctl)](./cli)
- [Transfers](../use/transfers)
- [API overview](../api/index) and [Authentication](../api/authentication)
- [Raw files](./raw-files)
