---
title: 原始文件
description: 通过一个 HTTP 请求按路径存储和读取文件，可使用 curl、wget 或 PowerShell，无需安装任何东西。
---

# 原始文件

仓库中的文件路径就像 Web 服务器上的文件。`PUT` 把正文存储为路径的下一个版本。`GET` 返回当前版本。可在只有 `curl` 或 PowerShell 的构建脚本和 CI 作业中使用它。

这三种方法的地址相同：

```text
https://<host>/api/v1/repositories/<repository>/raw/<path>
```

例如：`https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe`。

## 存储文件 {#store-a-file}

您需要一个仓库和具有写访问权限的密钥。参见[账户与密钥](../use/accounts)。以 `Authorization: Bearer <key>` 发送密钥。原始文件不接受其他类型的认证。

```bash
export ARKVORY_KEY="$(cat ~/.arkvory/key)"
URL="https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe"

curl --fail-with-body -sS -T ./GameSetup.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  "$URL"
```

```powershell
$headers = @{ Authorization = "Bearer $env:ARKVORY_KEY" }
$url = 'https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe'
Invoke-RestMethod -Method Put -InFile .\GameSetup.exe -Headers $headers -Uri $url
```

```bash
wget -qO- --method=PUT --body-file=GameSetup.exe \
  --header="Authorization: Bearer $ARKVORY_KEY" "$URL"
```

请给 `curl -T` 提供文件的完整地址，而不是文件夹的地址。对路径中 URL 不允许的字符进行编码：空格写为 `%20`，`#` 写为 `%23`，`?` 写为 `%3F`。

响应是 JSON。新文件或新字节返回 `201`：

```json
{
  "path": "builds/game/1.4/GameSetup.exe",
  "revision": 1,
  "created": true,
  "artifact": { "id": "00000000-0000-4000-8000-000000000001", "size": "1048576", "sha256": "…" }
}
```

如果路径已经保存了完全相同的字节，响应是 `200`，带有 `"created": false` 和相同的修订版本。不会存储任何内容。CI 作业的某个步骤可以再次运行而不会创建新版本。`size` 是十进制数字组成的字符串。

### 发送校验和 {#send-a-checksum}

使用 `X-Checksum-Sha256` 发送文件的 SHA-256，使用 `Content-Length` 发送长度。`curl -T` 和 PowerShell 会为文件发送长度。随后服务器会一次性把字节直接写入存储并在那里校验它们。错误的校验和会返回 `422`，错误码为 `integrity_mismatch`，不存储任何内容，并保持路径不变。

```bash
curl --fail-with-body -sS -T ./GameSetup.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  -H "X-Checksum-Sha256: $(sha256sum GameSetup.exe | cut -d' ' -f1)" \
  "$URL"
```

```powershell
$headers['X-Checksum-Sha256'] = (Get-FileHash .\GameSetup.exe -Algorithm SHA256).Hash.ToLower()
Invoke-RestMethod -Method Put -InFile .\GameSetup.exe -Headers $headers -Uri $url
```

如果没有校验和，或使用没有 `Content-Length` 的分块正文，服务器会先把正文写入临时文件并对其进行哈希。然后才存储它。这会在短时间内需要服务器磁盘上最多两倍于文件大小的空间，并对字节进行第二遍处理。服务器会在一天后删除失败遗留的临时文件。

当您发送校验和和长度，且路径已经保存了这些字节时，服务器会返回 `200` 而不读取正文，并关闭连接。

### 仅创建 {#create-only}

`PUT` 只读取一个条件，`If-None-Match: *`。使用它时，服务器仅在路径不存在时才存储文件。否则会返回 `409`，原因为 `already_exists`，即使字节相同也是如此。`PUT` 上任何其他 `If-None-Match` 值都会返回 `400`。

```bash
curl --fail-with-body -sS -T ./notes.txt \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "If-None-Match: *" \
  "https://arkvory.example/api/v1/repositories/releases/raw/docs/notes.txt"
```

### 两个写入者 {#two-writers}

当两个请求同时更改同一路径时，先到的那个获胜。较晚的那个会收到 `409`，原因为 `revision_mismatch`，路径保留获胜者的内容。请再次运行请求以创建新的修订版本。失败者的上传字节会作为没有路径的制品保留，直到保留规则将其删除。

## 读取文件 {#read-a-file}

`GET` 返回路径的当前版本。`HEAD` 只返回请求头。

```bash
curl --fail-with-body -sS -H "Authorization: Bearer $ARKVORY_KEY" -o GameSetup.exe "$URL"
```

```powershell
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -Headers $headers -Uri $url -OutFile .\GameSetup.exe
```

```bash
wget --header="Authorization: Bearer $ARKVORY_KEY" -O GameSetup.exe "$URL"
```

响应头：

| 请求头                  | 值                                          |
| ----------------------- | ------------------------------------------- |
| `ETag`                  | `"sha256:<digest>"`：内容的 SHA-256，带引号 |
| `Content-Length`        | 文件大小                                    |
| `Accept-Ranges`         | `bytes`                                     |
| `Content-Type`          | 始终为 `application/octet-stream`           |
| `Content-Disposition`   | `attachment`，以路径的最后一段作为文件名    |
| `X-Arkvory-Artifact-Id` | 保存此版本的制品 ID                         |

未知路径返回 `404`。

### 范围与条件请求 {#ranges-and-conditional-requests}

| 请求头                      | 效果                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `Range: bytes=0-1023`       | `206`，带有请求的部分和 `Content-Range`。起始位置超过文件末尾时返回 `416` 和 `Content-Range: bytes */<size>`。 |
| `Range: bytes=-1024`        | 最后 1024 个字节                                                                                               |
| `Range: bytes=1048576-`     | 从偏移量到末尾                                                                                                 |
| `If-Range: "sha256:…"`      | 仅当 ETag 恰好为该值时才应用 `Range`。如果路径有新版本，您会得到完整的新文件。                                 |
| `If-None-Match: "sha256:…"` | 如果 ETag 相同，返回 `304` 且无正文。它也适用于 `HEAD`。                                                       |

每个请求只支持一个范围。包含多个范围的请求会返回整个文件。

路径随时可能获得新版本，而 `GET` 会重新解析路径。为了安全地继续下载，请记住第一个响应的 `ETag` 并把它作为 `If-Range` 发送：

```bash
etag=$(curl -sSI -H "Authorization: Bearer $ARKVORY_KEY" "$URL" | awk 'tolower($1)=="etag:" {print $2}' | tr -d '\r')
curl -sS -H "Authorization: Bearer $ARKVORY_KEY" -H "If-Range: $etag" \
  -H "Range: bytes=1048576-" "$URL" >> GameSetup.part
```

若要在文件未更改时跳过下载，请发送您上次保存的 ETag：

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $ARKVORY_KEY" \
  -H 'If-None-Match: "sha256:<digest>"' "$URL"
```

对于大文件，[`arkvoryctl get`](./cli) 会续传下载并为您校验 SHA-256。

## 路径与版本 {#paths-and-versions}

原始文件是一种[路径文件](../use/files)。每次带有新字节的 `PUT` 都会为路径添加一个修订版本：修订版本 1、2、3，依此类推。较早的修订版本会保留。字节绝不会被替换，因为每个修订版本都指向其自己的不可变制品，以路径的最后一段命名。

- 对原始地址执行 `GET` 始终返回当前修订版本。
- 要查看路径的所有修订版本，请读取其历史记录：[`getAssetHistory`](../api/reference/files#getAssetHistory)，或控制台中的 [[ui:history]]。
- 要读取较早的修订版本，[`getAssetRevision`](../api/reference/files#getAssetRevision) 会返回其制品。请使用制品的内容地址下载它。
- 要回到旧修订版本，请使用 [`restoreAsset`](../api/reference/files#restoreAsset)。它会添加一个指向旧字节的新修订版本。
- 要按前缀列出仓库的路径，请使用 [`listAssetPage`](../api/reference/files#listAssetPage)。
- 路径无法删除。历史记录会保留。保留规则不会删除路径修订版本使用的制品。

相同的操作也存在于 [SDK](./sdk#raw-files-by-path)（`client.raw.putRawFile`、`downloadRawFile`）和 [`arkvoryctl`](./cli#transfers)（`put`、`get`）中。

### 路径规则 {#path-rules}

| 规则   | 值                                                        |
| ------ | --------------------------------------------------------- |
| 长度   | 1 到 1024 个字符                                          |
| 文件夹 | 以 `/` 分隔的段                                           |
| 不允许 | 空段（`a//b`）、`.` 或 `..`、反斜杠、冒号和不可见控制字符 |

`curl` 和浏览器在发送 URL 之前会移除其中的 `.` 和 `..`，因此这样的路径永远不会到达。违反规则的路径会返回 `400`。

## 权限 {#permissions}

个人令牌和文件密钥会获得仓库的读或写访问权限。服务密钥获得精确的动作。

| 操作          | 服务密钥动作                                                                                     | 个人令牌或文件密钥                |
| ------------- | ------------------------------------------------------------------------------------------------ | --------------------------------- |
| `GET`、`HEAD` | `content.read`                                                                                   | 读访问权限                        |
| `PUT`         | `upload.create`、`upload.write`、`upload.complete`、`asset.read`、`asset.write`、`artifact.read` | 写访问权限，令牌范围 `read-write` |

仅下载的部署代理需要 `content.read` 动作。

[读取网关](../operate/read-gateways)仅接受 `GET` 和 `HEAD`。[镜像](../operate/mirrors)提供读取服务，并以 `409` 和原因 `mirror_read_only` 拒绝 `PUT`。

## 限制 {#limits}

| 限制            | 值                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 文件大小        | 安装实例的最大对象大小，`ARKVORY_MAX_OBJECT_BYTES`（默认约 10 TiB）                                                                        |
| 单个 `PUT` 请求 | 必须在 30 分钟内完成，且暂停不得超过 30 秒（`ARKVORY_UPLOAD_DEADLINE_MS`、`ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`）。这些也是允许的最高值。       |
| 同时上传数      | 默认每台服务器 2 个，每个密钥 1 个（`ARKVORY_MAX_UPLOADS`、`ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`）。等待的请求会在 20 秒后放弃并返回 `503`。 |
| 同时下载数      | 默认每台服务器 16 个，每个密钥 4 个                                                                                                        |
| 配额            | 文件会计入仓库配额和安装实例的容量                                                                                                         |

单个 `PUT` 没有续传：失败后会从第一个字节重新开始。请对中小型文件和脚本使用原始文件。对于大文件或慢速网络，请使用 [`arkvoryctl put`](./cli) 或 [SDK](./sdk)。它们按分片上传，失败后可继续，并校验 SHA-256。它们还会把文件存储为路径的修订版本。这些变量在[环境变量](../reference/environment#transfers-and-bandwidth)中描述。

## 故障排查 {#troubleshooting}

错误是包含 `code`、`reason`、`message` 和 `requestId` 的 JSON 文档。参见[错误](../api/errors)。请把 `requestId` 提供给管理员，以便在服务器日志中查找该请求。

| 状态       | 原因                                                        | 起因                                                                | 处理方式                                                        |
| ---------- | ----------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| `400`      | `validation`                                                | 路径、`Content-Length`、`X-Checksum-Sha256` 或 `If-None-Match` 无效 | 检查路径规则并对 URL 编码                                       |
| `401`      | `credential_missing`、`credential_invalid`、`token_expired` | 没有密钥、密钥错误，或令牌已过期                                    | 发送 `Authorization: Bearer <key>`。原始文件不支持 Basic 认证。 |
| `403`      | `permission_missing`、`read_only_token`                     | 密钥无法写入，或它是只读令牌                                        | 使用具有[权限](#permissions)中动作的密钥                        |
| `404`      |                                                             | 路径不存在，或密钥看不到该仓库                                      | 检查仓库名称和路径                                              |
| `409`      | `already_exists`                                            | `If-None-Match: *` 且路径已存在                                     | 移除此请求头以添加修订版本                                      |
| `409`      | `revision_mismatch`                                         | 另一个请求先更改了路径                                              | 再次运行请求                                                    |
| `409`      | `mirror_read_only`                                          | 该仓库是镜像                                                        | 写入主服务器                                                    |
| `416`      | `range_not_satisfiable`                                     | 范围从文件末尾之后开始                                              | 使用 `HEAD` 检查大小                                            |
| `422`      | `integrity_mismatch`                                        | 正文与 `X-Checksum-Sha256` 或 `Content-Length` 不匹配               | 重新计算校验和；检查代理                                        |
| `503`      | `busy`                                                      | 同时有太多传输                                                      | 等待 `Retry-After` 中的时间并重试                               |
| `507`      | `storage_quota`                                             | 已达到仓库配额或安装实例的容量                                      | 释放空间或申请更大的配额                                        |
| 不是状态码 | 发送时出现 `curl: (55)` 或 `(56)`                           | 服务器关闭了连接。当路径已保存这些字节时，它会返回 `200` 并关闭。   | 运行 `curl -i` 并读取响应                                       |
| 不是状态码 | 连接在 30 分钟后关闭                                        | 上传截止时间                                                        | 使用 `arkvoryctl put`                                           |

## 相关页面 {#related-pages}

- [客户端与协议](./index)
- [命令行（arkvoryctl）](./cli)
- [TypeScript SDK](./sdk)
- [文件与路径](../use/files)
- [API 参考：按路径访问的文件](../api/reference/files)
