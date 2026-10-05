---
title: HTTP API 概览
description: '与 Arkvory HTTP API 集成所需的规则：JSON 与大小、发现、分页、修订版本、幂等性、重试、范围、错误和限制。'
---

# HTTP API 概览

HTTP API 是 Web 控制台、命令行客户端和 SDK 使用的接口。它们能做的任何事，您的集成都可以用任何语言完成。本页说明适用于每个操作的规则。[参考页面](#reference-pages)下的页面列出每个操作及其访问规则、重试规则、参数和响应，它们根据服务器强制执行的契约生成。

## 基础 {#basics}

- **基础路径。** 每个操作都位于 `/api/v1` 下，例如 `https://arkvory.example/api/v1/repositories`。唯一的例外是 `/health` 下的健康检查。
- **格式。** 请求和响应是 JSON（`application/json`）。JSON 正文限制为 64 KiB，对 JSON 操作发送其他内容类型的请求会收到 `415`。文件的字节以 `application/octet-stream` 发送。
- **未知字段。** 大多数操作会拒绝包含其未定义字段的请求（`400`，字段位于 `details` 中）。在响应中，请忽略您不认识的字段。
- **时间**是 UTC 的 RFC 3339 时间戳。制品、上传、任务、账户和密钥的 **ID** 是 UUID。
- **名称。** 仓库名称匹配 `[a-z0-9][a-z0-9_-]{0,63}`。文件名（制品名称）最多 240 个字符，且不能包含 `/` 或 `\`。仓库中的路径最多 1,024 个字符。
- **缓存。** 响应带有 `Cache-Control: private, no-store`。
- **其他协议。** 路由 `/v2`（容器）、`/lfs`（Git LFS）和 `/npm` 遵循各自客户端的规范并使用各自的错误格式。它们不属于 OpenAPI 文档。参见[客户端与协议](../protocols/index)。

### 大小与计数 {#sizes}

JSON 数字无法表示所有 64 位值。因此，Arkvory 将**大小和字节计数器作为十进制字符串**发送：`"size": "1048576"`。您创建上传时声明的大小也是如此。大小没有符号、没有前导零，且不超过 16 位数字。计数、修订版本、限制和分片索引是普通 JSON 整数。

最大对象为 10,000 GiB（10 737 418 240 000 字节），除非管理员设置了更低的 `ARKVORY_MAX_OBJECT_BYTES`。声明的大小更大时会以 `400` 拒绝。

## 身份验证 {#authentication}

除登录、公开健康检查和登录选项外，每个操作都需要头部 `Authorization: Bearer <credential>` 中的凭据。凭据是控制台会话、个人访问令牌、服务密钥或恢复密钥。凭据可以做什么取决于其种类以及每个操作的**访问规则**。在设计集成之前，请阅读[身份验证](./authentication)，并给自动化提供一个仅具有所需操作的服务密钥。

## 发现 {#discovery}

客户端可以询问服务器它支持什么，而不是靠猜。以下所有操作都需要凭据。

| 请求                           | 响应                                                                                                                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/capabilities`     | API 版本（`v1`）、网关角色（`api` 或 `reader`）、功能标志以及此服务器的限制：`maxObjectBytes`、`partBytes`（最小分片，8 MiB）、`maxPartBytes`（1 GiB）、`maxParts`（10,000）和 `maxPageSize`（100）。                               |
| `GET /api/v1/operations`       | 此凭据可能可以调用的操作，每个操作带有其 `operationId`、方法、路径、`surface`、`retry` 类别、所需操作和其余条件。使用 `repository`、`surface`、`after` 和 `limit` 筛选（1 到 100，默认 50）。该列表仅供参考：只有实际请求才能决定。 |
| `GET /api/v1/openapi.json`     | 写入 API 的 OpenAPI 3.0.3 文档。添加 `?surface=<name>` 以仅获取一个 surface。                                                                                                                                                       |
| `GET /api/v1/auth/permissions` | 调用凭据在每个仓库上的操作。                                                                                                                                                                                                        |
| `GET /api/v1/auth/me`          | 凭据是谁、其种类以及其粗粒度的 `read`/`write` 授权。                                                                                                                                                                                |
| `GET /api/v1/repositories`     | 凭据可以看到的仓库。                                                                                                                                                                                                                |

使用 `capabilities` 读取限制，而不是硬编码。将您不知道的功能标志视为 `false`。

### Surface {#surfaces}

操作分为六个 **surface**。它们是契约的标签，而不是单独的服务；URL 不会改变。

| Surface          | 涵盖内容                                   |
| ---------------- | ------------------------------------------ |
| `discovery`      | 功能、操作目录、OpenAPI 和仓库             |
| `identity`       | 登录、调用者自身的身份、令牌和密钥激活     |
| `catalog`        | 制品、注解、包、路径文件、阶段、晋级、附件 |
| `transfers`      | 上传会话、分片、完成任务和下载             |
| `administration` | 账户、组、服务账户、密钥、委派、更新和备份 |
| `operations`     | 存活、就绪、指标和反馈                     |

健康检查为 `GET /health/live`（进程正在运行）和 `GET /health/status`（公开；`{"status":"ready"}` 或 `unavailable`），无需凭据；以及 `GET /health/ready` 和 `GET /health/metrics`，需要凭据。它们不占用请求预算，因此负载不会使负载均衡器移除服务器。

## 分页 {#pagination}

列表一次返回一页。响应包含 `items` 和 `next`。当 `next` 不为 `null` 时，将其原样放入查询参数 `after` 发回，以读取下一页；当它为 `null` 时，列表已完整。将游标视为不透明字符串，不要自己构造。

`limit` 设置页大小，从 1 到 100。省略时大多数列表返回 50 项。页面不是快照：您阅读期间到达的项可能会也可能不会出现。在跟随 `next` 时，筛选条件和排序顺序必须保持不变。

## 修订版本与比较并交换 {#revisions}

人们编辑的内容都有一个从 1 开始递增的**修订版本**：制品的标签、元数据和集合，构建的附件，文件路径，存储策略，备份计划以及服务账户的设置。更改在请求正文中用 `expectedRevision` 指明它期望的修订版本：

```json
{ "expectedRevision": 3, "value": { "labels": ["tested"], "metadata": {}, "collections": [] } }
```

如果当前修订版本不是 3，则不会有任何更改，服务器以原因 `revision_mismatch` 应答 `409`。这就是**比较并交换**。请再次读取状态，对其应用更改并发送新的修订版本。切勿用更大的数字循环以强制写入。对于尚不存在的内容（例如新路径），使用 `0`。API 不使用 `If-Match` 头部。

**下载的制品**有不同的验证器，即 `ETag`。参见[范围下载与 ETag](#range-downloads)。

## 幂等键 {#idempotency}

`Idempotency-Key` 头部使重复的请求只生效一次。使用由字母、数字和 `_ . : -` 组成的 1 到 128 个字符的值，并在第一个请求之前将其与作业状态一起保存，以便重启的作业重复相同的键。以下写入需要它：

| 操作                                                                | 使用相同键和相同正文重复时                                                          |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `createUpload`                                                      | 返回相同的上传会话。                                                                |
| `issueServiceKey` 和 `rotateServiceKey`                             | 以 `200` 返回密钥的元数据，但不含机密。如果您丢失了机密，请撤销该密钥并签发另一个。 |
| `requestBackupRun`、`requestBackupVerify`、`requestBackupRetention` | 返回相同的请求，而不是排入另一个。                                                  |

相同键但不同正文会以 `409` 和原因 `idempotency_mismatch` 拒绝。键的作用域限定为调用者和目标，因此两个调用者可以使用相同的值。

其他写入出于另一个原因可以安全地重复：它们设置状态（设置阶段、注册包、撤销密钥），或者是比较并交换。下一节会告诉您是哪种。

## 重试规则 {#retry-rules}

每个操作都有一个**重试类别**。该类别告诉客户端在未收到响应时该怎么做。参考文档在每个操作上将其显示为“Retry”。

| 类别               | 含义                       | 如何处理                                                                                                                      |
| ------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `read`             | 读取不会改变任何内容。     | 使用退避重复。                                                                                                                |
| `idempotent`       | 相同的请求具有相同的效果。 | 重复。响应在细节上可能不同：删除两次可能报告对象已不存在。                                                                    |
| `idempotency-key`  | 仅在带键时安全。           | 使用相同的 `Idempotency-Key` 和相同的正文重复。                                                                               |
| `compare-and-swap` | 取决于修订版本的更改。     | 读取状态，重新决定，并使用您读取到的修订版本重复。切勿提高 `expectedRevision` 来通过 `409`。                                  |
| `reconcile-upload` | 上传会话的一个步骤。       | 先读取上传及其分片（`getUpload`、`listUploadParts`），然后发送缺失的部分。整文件 `PUT` 无法从中途继续：它会从字节零重新开始。 |
| `reconcile-job`    | 将完成任务排队。           | 先读取任务（`getCompletionJob`）。失败的任务可以再次排队。                                                                    |
| `never-automatic`  | 重复可能使操作执行两次。   | 不要自动重复。检查结果后再决定。例如：创建账户、令牌或下载链接，运行存储策略，发送反馈。                                      |

网络故障以及状态 `408`、`429`、`502`、`503` 和 `504` 是临时的：按类别重复，至少等待 `Retry-After` 指定的时间，并加入带尝试次数上限的指数退避。不要在不更改请求的情况下重复 `401`、`403` 和其他 `4xx` 响应。不要盲目重复 `500`；请将请求 ID 提供给支持人员。更改操作收到 `503` 后，结果未知，因此请使用类别来查明发生了什么。SDK 和命令行客户端会应用这些规则。

## 范围下载与 ETag {#range-downloads}

`GET` 和 `HEAD` `…/artifacts/{id}/content` 返回原始字节，带有形式为 `"sha256:<hex>"` 的强 `ETag` 和 `Accept-Ranges: bytes`。按包下载（`…/packages/content`）和按文件路径下载（`…/asset/content`、`…/raw/{path}`）同样如此。它们在每次请求时查找当前制品；`packages/content` 和 `raw` 在 `X-Arkvory-Artifact-Id` 中指明它们所选的那个，因此您可以将其固定以进行续传。

- `Range: bytes=0-1023`、`bytes=1024-` 和 `bytes=-1024` 返回 `206` 和 `Content-Range`。服务器只提供一个范围；范围列表会以整个文件应答。
- 起点超过文件末尾会返回 `416`，代码为 `invalid_input`，原因为 `range_not_satisfiable`，并带有 `Content-Range: bytes */<size>`。
- 要续传，请将 `Range` 与 `If-Range: "<您看到的 ETag>"` 一起发送。如果某个名称背后的内容已更改，`ETag` 会不同，您将收到整个新文件，而不是混合文件。
- 带有 `ETag` 的 `If-None-Match` 返回 `304`，不带正文。
- 验证您保存内容的 SHA-256。ETag 中包含它。

下载链接（`?token=`）仅在一个制品的内容路由上有效。参见[身份验证](./authentication#download-links)。

## 错误 {#errors}

每个失败都有相同的 JSON 信封：`code`、`message`、`requestId`，以及在有更多要说明时的 `reason`、`details` 和 `retryAfterSeconds`。请根据 `code` 和 `reason` 判断，绝不要根据 `message`。未知原因视为不存在，未知 `code` 按其 HTTP 状态处理。参见[错误](./errors)。

## 速率限制与繁忙服务器 {#rate-limits}

Arkvory 不按分钟计量 API 调用。它限制一次执行的工作量，并限制猜测密码的尝试：

- **繁忙。** 服务器同时接纳固定数量的请求和传输（`ARKVORY_MAX_REQUESTS`，默认 128；默认 2 个上传和 16 个下载）。传输可能在有界队列中等待最多 20 秒。没有空间时，响应为 `503`，代码为 `busy`。请在 `Retry-After` 之后重复。
- **容量。** 磁盘保留空间已满、配额或对象数量限制会返回 `507`，等待不会改善。
- **尝试。** 过多的登录、注册、密码或反馈尝试会返回 `429`，代码为 `rate_limited`。参见[身份验证](./authentication#sign-in-limits)。

`429` 和 `503` 都带有以秒为单位的 `Retry-After` 头部（服务器无法估计时为 2），并在 `retryAfterSeconds` 中包含相同的数字。如果请求经过代理，代理可能会添加自己的限制。

## 请求 ID {#request-ids}

每个响应都有 `X-Request-Id` 头部，每个错误都在 `requestId` 中包含相同的值。请将其与您自己的作业一起记录，并提供给支持人员。您发送的请求 ID 仅在它经由 `ARKVORY_TRUSTED_PROXIES` 中列出的代理到达且包含 8 到 128 个安全字符时才会被使用；否则服务器会生成一个新的。W3C `traceparent` 头部仅记录在服务器的访问日志中。

## 浏览器与 CORS {#cors}

与 Arkvory 位于同一地址的网页无需任何设置即可工作。位于另一地址的页面只有在管理员将其确切来源列入 `ARKVORY_CORS_ORIGINS`（最多 16 个，HTTPS 或回环 HTTP）时才可用。其他来源即使密钥有效也会收到 `403`，原因为 `origin_not_allowed`。请求从不使用 cookie：请在 `Authorization` 头部中发送密钥并将其保存在内存中。参见[环境变量](../reference/environment)。

## 兼容性承诺 {#evolution}

`/api/v1` 仅通过新增而变化：新操作、新的可选请求字段、新的响应字段、新的错误原因和新的功能标志。会破坏客户端的更改，例如不同的含义、新的必填字段、不同的状态或不同的分页，会获得一个新版本的 API 以及两者都可用的一段时间。作为回报，您的客户端必须：

- 忽略它不认识的响应字段；
- 将未知 `reason` 视为不存在，并根据 HTTP 状态处理未知 `code`；
- 从 `capabilities` 获取限制；
- 只发送操作定义的字段。

`operationId` 值是稳定的名称。在将操作映射到您自己的代码时使用它们。

## 示例：上传一个文件并下载它 {#example}

此序列在一个请求中上传一个文件。对于几 GB 以上的文件，或在不可靠的链路上，请使用 [`arkvoryctl`](../protocols/cli) 或 [SDK](../protocols/sdk)：它们发送分片并在失败后继续。该示例使用 `jq` 读取 JSON。

首先，设置地址和密钥，并计算文件的大小和 SHA-256：

```bash
export ARKVORY_URL=https://arkvory.example
export ARKVORY_KEY="$(cat ~/.arkvory/key)"
FILE=./Setup.exe
SIZE=$(stat -c %s "$FILE")
SHA=$(sha256sum "$FILE" | cut -d ' ' -f 1)
```

**步骤 1。预留上传。** 相同的 `Idempotency-Key` 返回相同的会话，因此您可以安全地重复此调用。

```bash
ID=$(curl -fsS -X POST "$ARKVORY_URL/api/v1/repositories/releases/uploads" \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  -H "Idempotency-Key: build-1042-setup" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Setup.exe\",\"size\":\"$SIZE\",\"sha256\":\"$SHA\",\"labels\":[\"nightly\"]}" \
  | jq -r .id)
```

**步骤 2。发送字节。** 当大小和 SHA-256 匹配时，服务器发布该制品。

```bash
curl -fsS -X PUT "$ARKVORY_URL/api/v1/repositories/releases/uploads/$ID/content" \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  -H "Content-Type: application/octet-stream" \
  -T "$FILE" | jq '{id, status}'
```

**步骤 3。下载它。** 制品 ID 就是上传 ID。

```bash
curl -fL -o Setup-copy.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  "$ARKVORY_URL/api/v1/repositories/releases/artifacts/$ID/content"
sha256sum Setup-copy.exe
```

步骤 2 应答 `{"id": "…", "status": "available"}`。如果连接在步骤 2 期间中断，请用 `GET …/uploads/$ID` 读取上传：当其状态为 `pending` 时，从头重新发送文件。上传会话存活 7 天。密钥需要在 `releases` 上具有操作 `upload.create`、`upload.write`、`upload.complete` 和 `content.read`。参见[上传](./reference/uploads)和[传输](../use/transfers)。

## 参考页面 {#reference-pages}

每个页面列出一组操作及其访问规则、重试类别、参数和响应。

- [系统与健康](./reference/system)：存活、就绪、指标、OpenAPI、功能
- [仓库](./reference/repositories)
- [上传](./reference/uploads)
- [制品与目录](./reference/artifacts)
- [包](./reference/packages)
- [路径文件](./reference/files)
- [阶段与晋级](./reference/promotion)
- [存储策略与保留](./reference/storage)
- [镜像](./reference/mirrors)
- [下载链接](./reference/links)
- [构建附件](./reference/attachments)
- [账户与登录](./reference/accounts)
- [服务账户与密钥](./reference/services)
- [备份](./reference/backups)
- [更新](./reference/updates)
- [反馈](./reference/feedback)

相关页面：[身份验证](./authentication)、[错误](./errors)、[TypeScript SDK](../protocols/sdk)。
