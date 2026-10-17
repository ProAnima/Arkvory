---
title: '事件'
description: '用一个游标跟进整个安装的每一次变更：CloudEvents、权限、保留期限和重新同步。'
---

# 事件

事件流告诉外部系统整个安装中发生了哪些变化：发布、删除、文件路径、包注册、注解、附件、阶段、晋级、容器镜像、npm 和 Git LFS。它是覆盖您可读取的所有仓库的单一有序流，格式为 [CloudEvents 1.0](https://cloudevents.io)。可以用 `arkvoryctl events tail`、[TypeScript SDK](./sdk) 或 `GET /api/v1/events` 读取。

事件只是"有东西变了"的提示。请通过常规 API 读取当前状态，并让事件处理在重复时也不会造成损害。

## 读取事件流 {#read}

```bash
arkvoryctl events tail --cursor-file ./arkvory.cursor
```

该命令每行输出一个 JSON 事件，并在每个事件之后把位置保存到 `--cursor-file`。再次运行时，它会从上次停下的地方继续。加上 `--follow` 会一直等待新事件，直到按下 Ctrl+C。`--types artifact.*,stage.added` 只保留指定的类型或前缀，`--repository releases` 只保留一个仓库，`--after <id>` 从指定事件之后开始。

在 TypeScript 中，`follow` 逐页读取，并在您处理完每个事件后调用 `save`：

```ts
for await (const event of client.events.follow({ after: saved, save: (cursor) => store(cursor) })) {
  await handle(event);
}
```

通过 HTTP：

```bash
curl -H "Authorization: Bearer $ARKVORY_TOKEN" \
  "https://arkvory.example.com/api/v1/events?limit=100&types=artifact.*"
```

响应包含 `items`、`next`、`head`、`oldest` 和 `epoch`。在下一次请求中把 `next` 作为 `after` 传入。不传 `after` 时，事件流从服务器保留的最早事件开始。一次请求最多返回 `limit` 个事件（1–500，默认 100）。返回的事件少于 `limit` 并不表示已到末尾：一次请求最多查看 5000 个事件，`next` 中的位置等于 `head` 时才表示已全部读完。参见 [listEvents](../api/reference/events#listEvents)。

## 事件 {#event}

```json
{
  "specversion": "1.0",
  "id": "0f7d8e3c-1d2b-4a5c-9e8f-0a1b2c3d4e5f:42",
  "source": "/arkvory/studio/repositories/releases",
  "type": "arkvory.artifact.published.v1",
  "subject": "9a7b6c5d-4e3f-4a1b-8c2d-1e0f9a8b7c6d",
  "time": "2026-10-17T09:30:00.000Z",
  "datacontenttype": "application/json",
  "dataschema": "urn:arkvory:event:artifact.published:1",
  "partitionkey": "repository:releases",
  "arkvoryposition": "42",
  "arkvoryepoch": "0f7d8e3c-1d2b-4a5c-9e8f-0a1b2c3d4e5f",
  "data": {
    "repository": "releases",
    "artifactId": "9a7b6c5d-4e3f-4a1b-8c2d-1e0f9a8b7c6d",
    "name": "game.upack",
    "size": "73400320",
    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "labels": ["ci"],
    "stages": []
  }
}
```

- 同一事件每次重复时 `id` 都相同：请按它去重。
- `data` 包含制品的标识和事实：名称、十进制字符串形式的大小、SHA-256、事件发生时的标签和阶段，以及 UPack 包。文件、阶段、镜像、npm 和 Git LFS 事件还会加上路径、阶段、带 digest 或 tag 的镜像、npm 包或对象 ID。
- 元数据的值、做出变更的用户、密钥和文件内容永远不会出现在事件中。如果标签会使 `data` 超过 8 KiB，则省略标签，并将 `truncated` 设为 `true`。
- `GET /api/v1/events/types` 列出每种类型及其 `data` 的 JSON Schema。

| 分组           | 类型                                                                                |
| -------------- | ----------------------------------------------------------------------------------- |
| 制品           | `artifact.published`、`artifact.deleted`、`artifact.promoted`、`artifact.received`  |
| 文件和包       | `asset.revision.created`、`asset.restored`、`package.registered`                    |
| 描述           | `annotation.updated`、`attachments.updated`、`stage.added`、`stage.removed`         |
| 容器镜像       | `oci.manifest.pushed`、`oci.manifest.deleted`、`oci.tag.updated`、`oci.tag.deleted` |
| npm 和 Git LFS | `npm.version.published`、`npm.tag.updated`、`npm.tag.deleted`、`lfs.object.stored`  |

## 顺序和权限 {#order}

- 同一仓库的事件按其变更提交的顺序到达（`partitionkey`）。跨仓库时，位置表示事件变为可见的顺序，而不是因果关系。
- 位置递增，但可能跳号。不要假定它们是连续的。
- 变更发生约半秒后，worker 为事件编号，事件随即出现在事件流中。worker 停止期间，事件会等待，不会丢失。
- 您能看到您的密钥或账户拥有 `artifact.list` 权限的仓库的事件，这与[变更流](../api/reference/artifacts#listCatalogChanges)所需的权限相同。每次请求都会检查权限，因此撤销权限会立即隐藏事件。
- `next` 也会越过您无权看到的事件，每个请求最多 5000 个，因此权限很窄的密钥也不会停滞不前。它只表明服务器在这些位置上有其他事件。

## 保留期限和恢复 {#retention}

服务器保留事件 168 小时，最多 5 000 000 个（`ARKVORY_EVENTS_RETENTION_HOURS`、`ARKVORY_EVENTS_MAX_ROWS`，参见[环境变量](../reference/environment)）。事件流是一个窗口，而不是历史：历史由目录审计保存。事件不包含在备份中。

| 响应                                   | 发生了什么                                   | 怎么做                                       |
| -------------------------------------- | -------------------------------------------- | -------------------------------------------- |
| `410`、`gone/events_cursor_expired`    | 您的游标早于 `oldest`                        | 通过 API 读取当前状态，然后从 `oldest` 继续  |
| `409`、`conflict/events_epoch_changed` | 服务器已从备份恢复，其位置开始了新的 `epoch` | 读取当前状态，然后不带游标或从新的流头部继续 |

两种响应都在 `events` 中带有当前的 `epoch`、`oldest` 和 `head`；游标的格式为 `<epoch>:<position>`。`arkvoryctl events tail` 以退出码 6 结束，SDK 抛出带有相同字段的错误。

## Webhook {#webhooks}

[Webhook](./webhooks) 仍然把单个仓库的变更流发送到一个 HTTP 地址。事件流并不取代它们。
