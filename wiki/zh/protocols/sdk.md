---
title: TypeScript SDK
---

# TypeScript SDK

TypeScript SDK 是控制台和 `arkvoryctl` 使用的客户端库。它封装了 REST API `/api/v1`。它在运行时校验每个响应，按分片上传，继续被中断的传输，并用 SHA-256 校验下载。它只使用标准的 Web API（`fetch`、流、Web Crypto），因此可以在 Node.js 和浏览器中运行。

## 获取 SDK {#get-the-sdk}

SDK 是 `ProAnima/Arkvory` 源码仓库 `packages/sdk` 文件夹中的工作区包 `@proanima/arkvory-sdk`。它**没有发布到 npm 注册表**。它依赖工作区包 `@proanima/arkvory-contracts`。

- 要使用它，请构建源码仓库（先 `npm ci`，再 `npm run build`），并像仓库自带的脚本那样，在该工作区内编写您的工具。
- 如果使用其他语言，或项目无法使用该工作区，请直接用 `Authorization: Bearer <key>` 调用 [REST API](../api/index)。

源代码依据 Arkvory 许可证提供。您可以在自己的组织内部使用和修改它，但不得分发副本。

## 创建客户端 {#create-a-client}

```typescript
import { ArkvoryClient } from '@proanima/arkvory-sdk';

const client = new ArkvoryClient('https://arkvory.example/', () => process.env.ARKVORY_KEY ?? '', {
  requestTimeoutMs: 60_000,
  attemptTimeoutMs: 120_000,
  maxRetries: 20,
});
const releases = client.inRepository('releases');
```

- **基础 URL**：必须使用 HTTPS。明文 HTTP 仅允许用于 `localhost`、`127.0.0.1` 和 `[::1]`。URL 不得包含用户名、密码、查询字符串或片段。它可以包含路径前缀。重定向会被视为错误。
- **令牌回调**：SDK 在每个请求时都会调用它，并且从不缓存结果。您可以在不创建新客户端的情况下轮换密钥。
- **`inRepository(id)`** 返回绑定到某个仓库的客户端。它只是一种便利，不是安全边界。

| 选项               | 默认值 | 含义                                                                          |
| ------------------ | ------ | ----------------------------------------------------------------------------- |
| `signal`           | 无     | 取消此客户端的所有请求                                                        |
| `requestTimeoutMs` | 无     | 没有自己 signal 的请求的截止时间（1 到 3600000）                              |
| `maxAttempts`      | 5      | 单个传输请求的尝试次数，含第一次（1 到 10）                                   |
| `maxRetries`       | 20     | 一次上传或下载操作共用的重试次数（0 到 100）                                  |
| `attemptTimeoutMs` | 120000 | 单次传输尝试的时限（1 到 1800000）                                            |
| `baseDelayMs`      | 500    | 第一次退避延迟（1 到 60000）                                                  |
| `maxDelayMs`       | 60000  | 最长延迟，包括 `Retry-After`                                                  |
| `onRequest`        | 无     | 每个 HTTP 请求调用一次，传入方法、路径、状态、耗时和请求 ID。绝不会收到凭据。 |

自动重试只适用于传输：`create`、`resume` 内部的各步骤，以及 `downloadVerified`。它们会对网络故障以及 HTTP 408、429、502、503 和 504 进行重试，采用指数退避，且绝不早于 `Retry-After`。其他调用只执行一次。受修订版本保护的更改绝不会被自动重复。

## 常见任务 {#common-tasks}

### 发现与列出 {#discover-and-list}

```typescript
const permissions = await client.permissions();
const repositories = await client.repositories({ limit: 50 });
const page = await releases.artifacts.list();
const found = await releases.artifacts.search({ q: 'build-42', label: 'staging' });
for (const item of found.items) console.log(item.id, item.name, item.size);
const artifact = await releases.artifacts.get('00000000-0000-4000-8000-000000000001');
```

分页结果会返回 `next`。将它作为 `after` 传入即可读取下一页。

### 上传大文件并支持续传（Node.js） {#upload-a-large-file-with-resume-node-js}

```typescript
import { openAsBlob } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const file = await openAsBlob('./build/Game.zip'); // 不会读入内存
const hash = createHash('sha256');
for await (const chunk of file.stream()) hash.update(chunk);

const key = randomUUID(); // 在第一个请求之前，把它与作业状态一起保存
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
await releases.assets.assign('builds/game/1.4/Game.zip', uploaded.id, 0); // 0：该路径是新的
```

- 相同的幂等键配合相同的描述信息会返回同一个会话，因此即使响应丢失，也不会产生第二次上传。
- `resume` 会读取服务器已有的分片，把它们的哈希与您的文件比对，并且只发送缺失的分片。崩溃之后，请用保存的会话 ID 再次调用 `resume`。
- 分片大小由服务器决定：8 MiB；只有需要超过 10,000 个分片的文件才会使用更大的分片。SDK 每次只在内存中保留一个分片。
- 16 GiB 及以上的文件由服务器的 worker 完成。`resume` 会等待它完成。
- 如果该路径的修订版本不同，`assets.assign(path, artifactId, expectedRevision)` 会因冲突而失败。请先用 `assets.get(path)` 读取该路径。

### 带校验的下载 {#download-with-verification}

```typescript
import { createWriteStream } from 'node:fs';
import { rename } from 'node:fs/promises';
import { Writable } from 'node:stream';

const stream = await releases.artifacts.downloadVerified(uploaded.id);
await stream.pipeTo(Writable.toWeb(createWriteStream('./Game.zip.part')));
await rename('./Game.zip.part', './Game.zip'); // 仅在 pipeTo 成功之后
```

SDK 以 8 MiB 为单位按范围读取内容，并检查每个范围的大小、`Content-Range` 和 `ETag`。在交付最后一个数据块之前，它会校验整个文件的 SHA-256。如果校验失败，流会以 `ArkvoryIntegrityError` 失败。切勿直接从流中进行部署：请写入临时文件，并且只在流成功结束之后才使用它。

要在重启之后继续，请把已保存的字节作为 `prefix` 传入。这样流中只包含剩余的部分：

```typescript
const prefix = await openAsBlob('./Game.zip.part');
const rest = await releases.artifacts.downloadVerified(uploaded.id, { prefix });
await rest.pipeTo(Writable.toWeb(createWriteStream('./Game.zip.part', { flags: 'a' })));
```

如果只需要不带校验的某一段字节范围，`releases.artifacts.download(id, { start: 0, end: 1023 })` 会返回原始的 `Response`（状态码 206）。

### 按路径访问原始文件 {#raw-files-by-path}

```typescript
const body = new Blob([JSON.stringify({ level: 3 })]);
const result = await client.raw.putRawFile('releases', 'config/settings.json', body, {
  createOnly: true, // 可选：如果路径已存在则拒绝
});
console.log(result.revision, result.created); // 如果这些字节已经存在，created 为 false
const response = await client.raw.downloadRawFile('releases', 'config/settings.json');
```

选项 `sha256`（64 位十六进制数字）让服务器一次写入这些字节，并拒绝不匹配的内容。`releases.assets.put(path, blob, options)` 和 `releases.assets.download(path, range)` 是同样的调用。每次上传都是一个请求，因此请把它们用于中小型文件。参见[原始文件](./raw-files)。

### 包、晋级与链接 {#packages-promotion-and-links}

```typescript
await releases.packages.register(uploaded.id); // UPack 归档
const selected = await releases.packages.resolve({ name: 'app', range: '^1.4', stage: 'release' });
await releases.promotions.promote(selected.artifactId, {
  target: 'prod',
  mode: 'copy',
  stages: ['release'],
});
const link = await releases.artifacts.link(selected.artifactId, { ttlSeconds: 900 });
```

链接 URL 是机密信息，在 `expiresAt` 之前都可以用它读取一个制品。它无法提前撤销。

### 备份 {#backups}

```typescript
const status = await client.backup.status();
const job = await client.backup.run(); // 已加入备份代理的队列
const points = await client.backup.points({ limit: 20 });
```

备份相关调用需要账户管理员的会话或所有者的文件密钥。服务密钥和个人令牌会收到 403。

## 错误 {#errors}

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

| 类                      | 含义                                                                                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ArkvoryHttpError`      | 服务器返回了错误。字段：`status`、`code`、`reason`、`details`、`requestId`、`retryAfterMs`、`retryAfterSeconds`、`serverMessage`。当代理在没有使用 Arkvory 格式的情况下作出响应时，`code` 为 `http_error`。 |
| `ArkvoryNetworkError`   | 在全部重试之后，连接失败或超时                                                                                                                                                                              |
| `ArkvoryIntegrityError` | 下载的字节与制品不匹配                                                                                                                                                                                      |
| `ArkvoryClientError`    | 本地失败，带有 `code`：`invalid_argument`、`insecure_url`、`invalid_response`、`response_too_large`、`size_mismatch`、`file_changed`、`upload_cancelled`、`completion_failed`                               |

请根据 `code` 和 `reason` 判断，不要依赖消息文本。遇到未知的错误码时，按 HTTP 状态码处理。`Error.message` 从不包含服务器返回的文本。参见[错误](../api/errors)。

## 浏览器与 Node.js {#browser-and-node-js}

- **浏览器位于另一个源**：管理员必须在服务器的 `ARKVORY_CORS_ORIGINS` 中列出您页面的确切源。SDK 在 `Authorization` 请求头中发送密钥，从不发送 Cookie。
- **浏览器中的密钥**：只把密钥保存在内存中。不要把它放进 URL、`localStorage`、日志或页面源代码。用户可以用 `client.login(name, password)` 登录，以获取会话令牌。
- **Node.js 中的文件**：使用 `node:fs` 中的 `openAsBlob` 传入文件，而无需把它读入内存。
- **下载队列**：`DownloadQueue` 和 `checkpointedDownload` 提供带暂停、继续和取消功能的有界队列。存储适配器由您提供。

## 限制 {#limits}

- JSON 响应限制为 2 MiB（包分页 8 MiB，制品列表 24 MiB）。更大的响应会以 `response_too_large` 失败。
- 大小以十进制字符串表示，因此大于 2^53 的值也能保持完整精度。

## 相关页面 {#related-pages}

- [命令行（arkvoryctl）](./cli)
- [传输](../use/transfers)
- [API 概览](../api/index)和[认证](../api/authentication)
- [原始文件](./raw-files)
