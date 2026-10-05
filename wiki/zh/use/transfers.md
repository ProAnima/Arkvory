---
title: 上传与下载
description: '发送和获取任意大小的文件，在中断后继续，检查校验和，并在没有密钥的情况下共享文件。'
---

# 上传与下载

任意大小的文件都会分片发送到 Arkvory，中断的传输可以从停止的地方继续。本页展示如何在控制台、使用 `arkvoryctl`、使用 SDK 以及使用 HTTP API 进行操作。

一次上传需要操作 `upload.create`、`upload.read`、`upload.write` 和 `upload.complete`。就组而言，它需要写入权限。一次下载需要 `content.read`。参见[权限](./accounts#permissions)。

## 上传文件 {#upload}

每次上传都执行相同的步骤。客户端计算整个文件的 SHA-256，并使用文件名、大小和校验和启动一个上传会话。它分片发送文件。当所有分片都到达后，服务器将它们组装起来，检查校验和，并将文件发布为不可变制品。

### 在控制台中 {#upload-console}

1. 在侧边栏中选择 [[ui:upload]]，或在顶部栏中选择 [[ui:uploadFile]]。
2. 在 [[ui:chooseFile]] 下选择文件。控制台会完整读取一次文件以计算其校验和（[[ui:hashing]]）。对于数十 GB 的文件，在发送第一个字节之前会花一些时间。
3. 选择 [[ui:startUpload]]。[[ui:transferTitle]] 下方的进度条显示进度。
4. 文件发布后会显示其 ID。打开 [[ui:catalog]] 即可看到它。

[[ui:pause]] 停止传输并保留已到达的分片。上传期间离开页面时，浏览器会向您发出警告。控制台不会随文件发送标签或元数据。请之后在 [[ui:metadata]] 中添加它们；参见[路径文件](./files#labels)。

### 使用 arkvoryctl {#upload-cli}

```bash
arkvoryctl upload ./Build/Game.zip --label test
arkvoryctl upload ./Build/Game.zip --file metadata.json --state ./job-state/game.json
arkvoryctl uploads status 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl uploads cancel 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`upload` 在制品发布后打印它。`--label` 添加一个标签。`--file` 指向一个包含 `labels` 和 `metadata` 的 JSON 文件，并具有优先权。要将文件存储到某个路径下，请使用 `put`；要发布 UPack，请使用 `packages publish`。参见[命令行](../protocols/cli#transfers)。

### 使用 SDK {#upload-sdk}

```typescript
const session = await releases.uploads.create(idempotencyKey, {
  name: 'Game.zip',
  size: String(file.size),
  sha256,
  labels: ['test'],
  metadata: { commit: 'abc123' },
});
const artifact = await releases.uploads.resume(session.id, file, {
  onProgress: (bytes) => console.log(bytes),
});
```

`resume` 发送服务器没有的分片并完成上传。完整示例（包括在 Node.js 中进行哈希计算）见 [TypeScript SDK](../protocols/sdk#upload-a-large-file-with-resume-node-js)。

### 使用 HTTP API {#upload-http}

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/uploads" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Idempotency-Key: game-1234" \
  -H "Content-Type: application/json" \
  -d '{"name":"Game.zip","size":"73400320","sha256":"<64 hex digits>"}'

curl "$ARKVORY/api/v1/repositories/releases/uploads/$ID/parts" -H "Authorization: Bearer $ARKVORY_KEY"

curl -X PUT "$ARKVORY/api/v1/repositories/releases/uploads/$ID/parts/0" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/octet-stream" \
  -H "X-Content-SHA256: <64 hex digits of this part>" --data-binary @part-0.bin

curl -X POST "$ARKVORY/api/v1/repositories/releases/uploads/$ID/complete" \
  -H "Authorization: Bearer $ARKVORY_KEY"
```

大小是十进制字符串。`Idempotency-Key` 为 1 到 128 个字母、数字、`.`、`_`、`:` 或 `-`。第一次调用的响应包含上传 `id` 和 `expiresAt`。第二次调用返回分片大小 `partBytes` 以及已经存储的分片。除最后一个分片外，每个分片都恰好是该大小。操作为 `createUpload`、`listUploadParts`、`putUploadPart` 和 `completeUpload`（[上传](../api/reference/uploads)）。

对于小文件，您可以使用两种更简单的方式。`PUT /uploads/{id}/content` 在一个请求中发送整个文件。`PUT /raw/<path>` 在一个请求中创建会话、发送字节并将它们存储到某个路径，如同 `curl -T` 所做的那样。两个请求都必须在 30 分钟内完成。对于任何较大或较慢的内容，请使用分片。参见[原始文件](../protocols/raw-files)。空文件可以在一个请求中发送。

## 文件可以有多大 {#limits}

| 限制             | 值                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 分片大小         | 对于最大约 78 GiB 的文件为 8 MiB。更大的文件使用 16、32、64 MiB 等，最大到 1 GiB，因此一个文件永远不需要超过 10 000 个分片。 |
| 每次上传的分片数 | 10 000（索引 0 到 9999）                                                                                                     |
| 最大文件         | 10 000 个 1 GiB 的分片，约 10 TiB                                                                                            |
| 更低的上限       | 管理员可以使用 `ARKVORY_MAX_OBJECT_BYTES` 设置                                                                               |
| 文件名           | 1 到 240 个字符，不包含 `/`、`\` 或控制字符                                                                                  |

服务器在创建上传时选择分片大小，并在整个上传过程中保持不变。`GET /api/v1/capabilities` 显示 `maxObjectBytes`、`partBytes`、`maxPartBytes` 和 `maxParts`。控制台会在开始之前拒绝超过服务器限制的文件。

客户端在哈希和发送一个分片时会将其保存在内存中。对于超过 78 GiB 的文件，分片（以及因此占用的内存）会增长到最多 1 GiB。

服务器上的可用磁盘空间必须能在一段时间内容纳这些分片和组装后的文件。如果磁盘已满，服务器会以 `507 storage_full` 拒绝上传。

## 续传上传 {#resume}

上传会话在失败后会保留其分片。要继续，请向客户端提供相同的文件和相同的会话。

**控制台。** 在打开的标签页中，[[ui:pause]] 之后再次选择 [[ui:startUpload]]。关闭标签页后，请记下上传 ID。展开 [[ui:resumeTitle]]：上传运行时字段 [[ui:uploadId]] 会显示 ID。之后，选择相同的文件，在那里输入 ID 并选择 [[ui:startUpload]]。控制台会将分片与您的文件进行比较。如果文件不同，它会停止并告知您。[[ui:newUpload]] 会清除两个字段并开始新的上传。

字段 [[ui:idempotency]] 是第二种恢复方式。控制台会自动填充它。相同的键与相同的文件会返回相同的会话，而不是第二个会话。

**arkvoryctl。** 使用相同的选项运行相同的命令。客户端在第一个请求之前，在源文件旁保存了检查点 `<file>.arkvory-upload.json`，或您在 `--state` 中指定的文件。要将相同的字节发布为新制品，请使用新的 `--state`。在 CI 中，请在重试之间保留源文件和状态文件夹。文件、服务器、仓库或选项发生变化会产生 `checkpoint_mismatch`（退出码 6）。

**SDK。** 使用保存的会话 ID 和相同的文件再次调用 `resume`。如果在连 `create` 的响应都丢失时需要恢复，请使用相同的幂等键和相同的描述符调用 `create`：它会返回相同的会话。

**HTTP。** 使用 `listUploadParts` 读取已存储的分片，然后发送缺失的索引。使用相同的字节再次发送某个分片是安全的。为已存储的索引发送其他字节会被拒绝并返回 `409 upload_state`。

客户端还会在网络故障之后，或在 `408`、`429`、`502`、`503` 和 `504` 之后自行重试请求：单个操作最多重试 20 次，暂停时间从 0.5 秒增长到 60 秒，并遵循 `Retry-After`。`arkvoryctl` 有适用于慢速链路的选项 `--retries` 和 `--attempt-timeout`。

只有创建上传的账户或密钥才能继续它。对任何其他人来说，它都不存在。轮换服务密钥会保留该账户，因此新密钥可以继续上传。

## 校验和 {#checksums}

- **上传之前。** 控制台、CLI 和 SDK 计算文件的 SHA-256 并在会话中发送它。
- **每个分片。** 标头 `X-Content-SHA256` 包含该分片的校验和。字节不匹配的分片会被拒绝并返回 `422 integrity_mismatch`，且不会被存储。
- **结束时。** 服务器在发布之前会根据会话检查组装后文件的大小和 SHA-256。不匹配会返回 `422 integrity_mismatch`；CLI 以退出码 5 退出。制品不会出现。
- **下载。** 控制台、CLI 和 SDK 在交出文件之前会检查整个文件的 SHA-256。最终文件只有在检查通过后才会出现。

文件的 ETag 就是它的校验和：`"sha256:<64 hex digits>"`。制品详细信息显示 SHA-256，[[ui:copyHash]] 会复制它。

## 完成作业 {#completion}

组装大文件需要时间。对于小于 16 GiB 的文件，`completeUpload` 会在请求内组装它们，这可能需要长达 30 分钟。从 16 GiB 起，SDK（因此也包括控制台和 CLI）会请求工作进程来完成它：`enqueueCompletion` 返回 `202` 和一个作业，客户端轮询 `getCompletionJob` 直到状态为 `completed` 或 `failed`。失败的作业带有错误代码，例如 `integrity_mismatch`。

工作进程服务必须运行才能处理作业。它会最多尝试一个作业 5 次，暂停时间逐渐增长，并且对于重试无法修复的错误会立即放弃。重复的 `enqueueCompletion` 会返回相同的作业。如果服务器重启，作业会继续。您不必重新开始上传。

## 上传过期 {#expiry}

未完成的上传会话在创建 7 天后过期。时间记录在 `expiresAt` 中，不会延长，也不会在您发送分片时改变。过期后，分片和 `complete` 会被拒绝并返回 `409 upload_expired`。请开始新的上传。已发布的文件永不过期。

服务器会在后台移除过期的会话及其分片。要提前放弃某个会话，请使用 `arkvoryctl uploads cancel ID` 或 `cancelUpload`。取消不是暂停：分片会被丢弃。

## 下载文件 {#download}

### 在控制台中 {#download-console}

在 [[ui:catalog]] 中或制品详细信息中，选择文件旁的 [[ui:download]]。浏览器会询问将文件保存到哪里。文件会进入 [[ui:downloads]] 中的队列。队列会将数据写入一个临时副本，检查 SHA-256，然后才会替换目标文件。

该队列需要在 HTTPS 或本地计算机上使用 Chrome 或 Edge，因为它通过浏览器的文件系统访问来写入大文件。其他浏览器应使用 CLI 或 SDK。

下载的状态有 [[ui:downloadQueued]]、[[ui:downloadRunning]]、[[ui:downloadRetrying]]、[[ui:downloadPaused]]、[[ui:downloadSaving]]、[[ui:downloadCompleted]]、[[ui:downloadFailed]] 和 [[ui:downloadCancelled]]。按钮有：

| 按钮                                           | 效果                                         |
| ---------------------------------------------- | -------------------------------------------- |
| [[ui:downloadResume]]                          | 从已保存的分片继续暂停或失败的下载           |
| [[ui:downloadCancel]]                          | 取消一个下载并删除其临时副本                 |
| [[ui:downloadsPause]] / [[ui:downloadsResume]] | 保持和释放整个队列                           |
| [[ui:downloadsClearWaiting]]                   | 取消正在等待的下载                           |
| [[ui:downloadsCancel]]                         | 取消所有下载                                 |
| [[ui:downloadsClearFinished]]                  | 移除已完成的行以腾出空间（队列可容纳 64 个） |
| [[ui:downloadRestore]]                         | 页面重新加载后，恢复未完成的下载             |

[[ui:downloadSettings]] 包含 [[ui:downloadConcurrency]]（1 到 8，默认 2）、[[ui:downloadInterval]]（0 到 60 000 毫秒，默认 250）和 [[ui:downloadWait]]（1 到 1800 秒，默认 300）。选择 [[ui:downloadApply]] 以使用它们。它们不会提高服务器的限制。

在重新加载或关闭标签页之后，以相同账户再次登录同一服务器，打开 [[ui:downloads]] 并选择 [[ui:downloadRestore]]。恢复的下载处于暂停等待状态。对每个下载选择 [[ui:downloadResume]] 并再次选择目标文件。浏览器需要为临时副本留出可用空间。

### 使用 arkvoryctl {#download-cli}

```bash
arkvoryctl download 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game.zip
arkvoryctl get builds/game/1.4/Game.zip ./Game.zip
arkvoryctl packages download app ./app.upack --range ^1.4 --stage release
```

下载运行时，`<output>.arkvory-part` 和 `<output>.arkvory-download.json` 会留在目标文件旁。中断后再次运行相同的命令。最终文件只有在 SHA-256 检查之后才会出现。已存在的目标文件绝不会被覆盖（`destination_exists`，退出码 6）。

### 使用 HTTP：范围请求和 ETag {#download-http}

`downloadArtifact` 返回制品的字节。`HEAD` 只返回标头。

```bash
curl -fL -H "Authorization: Bearer $ARKVORY_KEY" -C - -o Game.zip \
  "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/content"
```

- `Accept-Ranges: bytes`。为一个范围发送 `Range: bytes=1048576-`、`bytes=0-1023` 或 `bytes=-500`。响应为 `206` 并带有 `Content-Range`。不支持同时请求多个范围：服务器会发送整个文件。起始位置超出末尾会返回 `416`。
- `ETag` 为 `"sha256:<hex>"`。将它用于 `If-None-Match` 会返回 `304`。将它用于 `If-Range` 时，只有在文件仍然相同时才继续范围请求；否则会返回整个文件。
- `curl -C -` 续传下载。按名称访问的地址会在每个请求上解析，例如 `packages/content?name=app&range=^1.4`，因此文件可能在两次调用之间发生变化。要安全地续传它们，请在 `If-Range` 中发送您获得的 ETag，或先解析名称再按制品 ID 下载。

SDK 以 8 MiB 的范围读取内容并逐一验证。参见 [TypeScript SDK](../protocols/sdk#download-with-verification)。

## 供没有密钥的人使用的链接 {#links}

下载链接让某人无需任何密钥即可获取一个文件：测试人员、客户、不持有凭据的构建机器。该链接在过期之前仅对 `GET` 和 `HEAD` 开放该制品。它适用于 `curl -C -` 和范围请求。

在控制台中，在 [[ui:metadata]] 中打开该制品并选择 [[ui:downloadLink]]。控制台会复制该链接并连同其过期时间一起显示。链接的有效期为一小时。只有当您可以下载该文件时，按钮才会出现。

```bash
arkvoryctl link 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --ttl 900
```

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/links" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"ttlSeconds":900}'
```

有效期从 60 秒到 24 小时（86 400 秒），默认一小时。响应包含以 `dtl_` 开头的 `token`、一个 `url` 和 `expiresAt`。CLI 和 SDK 会打印完整的 URL。API 返回路径，您需要将其添加到服务器地址。

链接是一个机密。任何拥有它的人都可以下载该文件。您无法在链接过期之前撤销它，因此请将其有效期设短。把 URL 当作密钥：不要让它出现在聊天室和公开日志中。代理日志和浏览器历史记录可能会记录它。参见[下载链接](../api/reference/links)。

## 限制与队列 {#queues}

管理员设置服务器同时运行多少传输以及速度多快。默认情况下，一台服务器同时运行 2 个上传和 16 个下载，一个账户运行 1 个上传和 4 个下载。更多请求会在队列中等待最多 20 秒。如果队列已满或等待结束，服务器会返回带 `Retry-After` 的 `503`，客户端会等待并重试。设置每秒字节预算后会使传输变慢，但不会停止它们。用户无法查看或更改这些预算。这些值位于[环境变量](../reference/environment#transfers-and-bandwidth)中。

## 错误 {#errors}

| 响应                       | 原因                                             | 处理方法                                   |
| -------------------------- | ------------------------------------------------ | ------------------------------------------ |
| `409 upload_expired`       | 会话已超过 7 天                                  | 开始新的上传                               |
| `409 upload_state`         | 上传已发布或已取消，或者已存储的分片具有其他字节 | 开始新的上传，或检查您是否使用了相同的文件 |
| `409 parts_incomplete`     | 某些分片尚未到达                                 | 续传上传                                   |
| `409 part_mismatch`        | 分片与计划的分片大小或索引不匹配                 | 从 `listUploadParts` 获取分片大小并续传    |
| `409 idempotency_mismatch` | 该键已用于另一个文件                             | 使用新的键                                 |
| `422 integrity_mismatch`   | 校验和不匹配                                     | 再次发送原始文件                           |
| `507 storage_quota`        | 仓库配额已用完                                   | 删除旧构建或申请更大的配额                 |
| `507 storage_full`         | 服务器磁盘已满                                   | 联系管理员                                 |
| 带 `Retry-After` 的 `503`  | 服务器繁忙                                       | 等待，客户端会自行重试                     |

完整列表见[错误](../api/errors)。

## 相关页面 {#related-pages}

- [命令行（arkvoryctl）](../protocols/cli) 和 [TypeScript SDK](../protocols/sdk)
- [路径文件](./files) 和 [包](./packages)
- API 参考：[上传](../api/reference/uploads)、[下载链接](../api/reference/links)、[制品](../api/reference/artifacts)
