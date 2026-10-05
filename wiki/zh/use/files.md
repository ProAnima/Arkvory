---
title: 路径文件
description: '将文件保存在某个路径并保留完整历史记录，恢复较早的修订版本，以及添加标签、元数据、集合和附件。'
---

# 路径文件

路径文件是仓库中的一个名称，例如 `builds/game/1.4/GameSetup.exe`，它指向一个已存储的文件。当您在同一个路径放入新内容时，该路径会指向新文件。旧文件会保留，您可以回到它。当人和脚本需要“当前 Setup.exe”的稳定地址时，请使用路径。

## 路径是什么 {#what-it-is}

每个已存储的文件都是一个不可变的**制品**，带有 ID 和 SHA-256。路径是指向制品的指针。指针的每次更改都是一个**修订版本**，从 1 开始编号。修订版本绝不会被删除或编辑。

路径包含 1 到 1024 个字符。它由以 `/` 分隔的段组成。段不为空，不是 `.` 或 `..`，并且没有控制字符。路径不能包含 `\` 或 `:`。字母大小写有意义。

路径和包是同一批制品的两种视图：UPack 归档也可以有一个路径。参见 [UPack 包](./packages)。

## 将文件放到路径上 {#put}

您需要操作 `upload.create`、`upload.write` 和 `upload.complete`，以及 `asset.read`、`asset.write` 和 `artifact.read`。就组而言，您需要写入权限。参见[权限](./accounts#permissions)。

### 使用 arkvoryctl {#put-cli}

```bash
arkvoryctl put "./Build/Game Setup.exe" builds/game/1.4/GameSetup.exe
arkvoryctl put ./config.json config/settings.json --label test
arkvoryctl get builds/game/1.4/GameSetup.exe ./GameSetup.exe
```

`put` 会分片上传文件，在源文件旁保存一个检查点，并将其设为该路径的下一个修订版本。它会打印 `path`、`revision`、制品的 `id` 和 `created`。如果该路径已经保存了相同的字节，`put` 不会上传任何内容，并将 `created` 打印为 `false`：重复的构建步骤不产生任何开销。如果您上传期间有人更改了该路径，`put` 会以 `revision_mismatch`（退出码 6）停止，并且不会覆盖他们的工作。请查看历史记录后再决定。如果上传停止，请再次运行相同的命令。参见[上传与下载](./transfers#resume)。

`get` 会下载当前修订版本，支持续传并进行 SHA-256 校验。没有列出路径或读取历史记录的命令。请使用控制台或 API 来完成这些操作。

### 使用一个 HTTP 请求 {#put-http}

原始 `PUT` 可以在一个请求中将字节存储到该路径，如同 `curl -T` 所做的那样：

```bash
curl -T ./GameSetup.exe -H "Authorization: Bearer $ARKVORY_KEY" \
  "$ARKVORY/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe"
```

响应包含 `path`、`revision`、`created`，以及带有 `id`、`size` 和 `sha256` 的 `artifact`。新修订版本返回 `201`。再次发送相同字节返回 `200`，且 `created` 为 false。有两个可选标头：`X-Checksum-Sha256` 让服务器在一次遍历中检查字节，`If-None-Match: *` 在路径已存在时拒绝请求。一个请求必须在 30 分钟内完成。大文件请使用 `put`。参见[原始文件](../protocols/raw-files)。

### 在控制台中 {#put-console}

1. 在 [[ui:upload]] 中上传文件。参见[上传与下载](./transfers)。
2. 使用 [[ui:open]] 在 [[ui:catalog]] 中打开该制品。
3. 在 [[ui:assetTitle]] 中输入 [[ui:assetPath]]，例如 `releases/current.upack`。
4. 输入 [[ui:currentRevision]]：新路径为 `0`，或 [[ui:history]] 中显示的当前修订版本。
5. 选择 [[ui:assign]]。

修订版本字段可以防止两个人同时更改一个路径。如果它不是当前修订版本，服务器会以冲突拒绝。请重新加载历史记录并重试。

### 使用 API 和 SDK {#put-api}

`setAsset` 将路径指向您已经上传的制品。`expectedRevision` 为 `0` 表示创建路径，否则为当前修订版本。

```bash
curl -X PUT "$ARKVORY/api/v1/repositories/releases/asset" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"path":"builds/game/1.4/GameSetup.exe","artifactId":"3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11","expectedRevision":0}'
```

```typescript
const current = await releases.assets.get('builds/game/1.4/GameSetup.exe');
await releases.assets.assign('builds/game/1.4/GameSetup.exe', artifactId, current.revision);
```

冲突会返回 `409 revision_mismatch`。不要使用猜测的修订版本重试。响应丢失后，请读取路径：如果新制品已经在那里，就完成了。

## 读取路径 {#read}

- `arkvoryctl get PATH OUTPUT` 下载当前文件。
- `GET /api/v1/repositories/<repository>/raw/<path>` 和 `GET /api/v1/repositories/<repository>/asset/content?path=<path>` 返回字节。两者都需要 `content.read`，并支持范围请求和 ETag。
- `getAsset`（`GET …/asset?path=`）返回指针：`path`、`revision`、`artifactId`。
- `listAssetPage`（`GET …/assets/page?prefix=`）列出指针。每页最多 100 个（默认 50 个），按 UTF-8 路径的字节顺序排列。前缀按字面匹配且区分大小写。将 `next` 作为 `after` 传入。较旧的 `listAssets` 最多返回 1000 个，并要求您缩小前缀。

```typescript
const page = await releases.assets.list({ prefix: 'builds/game/', limit: 100 });
```

## 修订版本与历史记录 {#history}

在控制台中打开 [[ui:history]]，在 [[ui:assetPath]] 中输入路径，然后选择 [[ui:historyLoad]]。表格显示 [[ui:revision]]、时间（[[ui:date]]）、作者（[[ui:actor]]），以及对于恢复的修订版本，它们来自哪个修订版本（[[ui:source]]）。最新的在前。[[ui:historyMore]] 每次加载 50 个较旧的修订版本。某一行上的 [[ui:open]] 会打开该修订版本的制品，您可以从中下载其原始内容。

使用 API 时，`getAssetHistory`（`…/asset/history?path=&before=`）返回各页，最新的在前，`before` 是上一页的最后一个修订版本。`getAssetRevision`（`…/asset/revision?path=&revision=`）返回一个修订版本。对于在历史记录开始记录之前写入的修订版本，作者和时间为空。读取需要 `asset.read`。

## 恢复较早的修订版本 {#restore}

恢复会使路径指向较早修订版本的制品。它不复制任何字节，也不删除任何修订版本：恢复是一个新的、最新的修订版本，历史记录会显示它来自哪里。

在控制台中，加载历史记录并选择您想要恢复的修订版本的恢复按钮。当前修订版本的按钮不可用。恢复需要 `asset.restore`、`asset.read` 和 `artifact.read`。

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/asset/restore" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"path":"builds/game/1.4/GameSetup.exe","sourceRevision":3,"expectedRevision":5}'
```

```typescript
await releases.assets.restore('builds/game/1.4/GameSetup.exe', 3, 5);
```

`expectedRevision` 是您所看到的最新修订版本。如果在此期间路径发生了更改，服务器会返回 `409 revision_mismatch`；控制台会显示一条消息并要求您重新加载历史记录。恢复不会带回旧的标签或元数据：它们保持当前状态。

## 标签、元数据和集合 {#labels}

每个制品都带有三种注释。您可以随时更改它们。文件本身永远不会改变。

| 种类   | 示例                                           | 规则                                                                                        |
| ------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 标签   | `test`、`staging`、`release`、`linux`          | 最多 32 个。每个 1 到 64 个字母、数字、`_`、`.`、`:` 或 `-`。区分大小写                     |
| 元数据 | `build.number` = `42`、`git.commit` = `abc123` | 最多 32 个文本字段。键以字母开头，最多 64 个字母、数字、`_`、`.` 或 `-`。值最多 1024 个字符 |
| 集合   | `desktop`、`nightly`                           | 最多 32 个。规则与标签相同。它们将制品分组，无论其版本或路径如何                            |

标签是自由文本。它们不授予访问权限，也不移动文件。控制台会建议 [[ui:labelPresets]]（`nightly`、`test`、`staging`、`release`），但任何标签都有效，并且不会纠正 `relase`。对于部署所依赖的批准，请使用阶段（[阶段与晋级](./promotion)）。

**控制台。** 在 [[ui:metadata]] 中打开该制品。输入以逗号分隔的 [[ui:labels]] 和 [[ui:collections]]。使用 [[ui:metadataAdd]] 在 [[ui:metadataFields]] 中添加字段：一个 [[ui:metadataKey]] 和一个 [[ui:metadataValue]]。[[ui:metadataJson]] 以 JSON 编辑相同的数据。选择 [[ui:save]]。

**arkvoryctl。** 在上传时，`--label test` 会添加一个标签，`--file metadata.json` 提供 `labels` 和 `metadata`：

```json
{ "labels": ["test"], "metadata": { "build.number": "42", "git.commit": "abc123" } }
```

要更改现有制品，请先读取它，然后使用您读取到的修订版本发送完整的新状态：

```bash
arkvoryctl annotations get 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl annotations set 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --revision 3 --file annotations.json
```

`annotations.json` 必须包含全部三个键：`labels`、`metadata` 和 `collections`。您遗漏的任何内容都会变为空。一次保存会替换整个集合。如果别人先保存了，服务器会返回 `409 revision_mismatch`：请重新读取后再决定。SDK 不会重试此类保存。

```typescript
const current = await releases.annotations.get(id);
await releases.annotations.update(id, current.revision, {
  labels: [...current.labels, 'release'],
  metadata: current.metadata,
  collections: current.collections,
});
```

读取需要 `annotation.read`，写入需要 `annotation.write` 和 `artifact.read`。

**搜索。** 在 [[ui:catalog]] 中，在 [[ui:search]] 里输入文本：它会匹配文件名和元数据值，忽略大小写。[[ui:labelFilter]] 显示一个标签。[[ui:metadataFilter]] 精确匹配键和值，包括大小写。使用 `arkvoryctl`：

```bash
arkvoryctl search --query game --label release
arkvoryctl search --collection nightly
arkvoryctl search --metadata-key git.commit --metadata-value abc123
```

`--metadata-key` 和 `--metadata-value` 要一起使用。每页最多 100 个结果。将 `next` 作为 `--after` 传入。各个过滤器之间以 AND 组合。

## 附件 {#attachments}

附件将其他文件链接到构建：清单、SBOM、签名、报告或任何文件。附件是一个名称和一个指向同一仓库中另一个制品的链接。构建和附件始终是独立的文件。

| 规则     | 值                                                                                 |
| -------- | ---------------------------------------------------------------------------------- |
| 种类     | `manifest`、`sbom`、`signature`、`report`、`file`                                  |
| 每个构建 | 最多 32 个                                                                         |
| 名称     | 1 到 240 个字符，在构建内唯一（忽略大小写），不包含 `/`、`\`、控制字符或两端的空格 |
| 描述     | 最多 512 个字符，可以为空                                                          |
| 目标     | 同一仓库中已发布的制品。不能是构建本身                                             |

种类只说明该文件的用途。Arkvory 不检查签名、不读取 SBOM，也不运行清单。

在控制台中打开该制品。在 [[ui:attachmentsTitle]] 下展开表单 [[ui:attachmentAdd]]。选择 [[ui:attachmentSource]]：[[ui:attachmentUpload]] 发送一个新文件并链接它，[[ui:attachmentExisting]] 链接一个已发布的制品。选择 [[ui:attachmentKind]]：[[ui:attachmentManifest]]、[[ui:attachmentSbom]]、[[ui:attachmentSignature]]、[[ui:attachmentReport]] 或 [[ui:attachmentFile]]。为它指定一个 [[ui:attachmentName]]，如果您愿意，还可以添加一个 [[ui:attachmentDescription]]。然后选择 [[ui:attachmentAdd]]。[[ui:attachmentUnlink]] 移除链接并保留文件。[[ui:attachmentReload]] 重新读取列表。如果附件的上传中断，[[ui:attachmentRecovery]] 会显示可用于继续的上传 ID。

列表的每次更改都是一个带编号的版本。[[ui:attachmentHistory]] 显示较早的版本，[[ui:attachmentRestore]] 将其中一个作为新版本恢复。

使用 `arkvoryctl` 时，文件以 JSON 数组的形式保存整个列表：

```json
[
  {
    "name": "build.json",
    "kind": "manifest",
    "artifactId": "64b42380-902d-41cf-9151-10c12e4809dc",
    "description": "Build provenance from CI"
  }
]
```

```bash
arkvoryctl attachments get 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl attachments set 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --revision 0 --file attachments.json
arkvoryctl attachments history 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`--revision` 是您使用 `get` 读取到的编号；新构建为 `0`。使用 API 时，`replaceBuildAttachments` 接受 `expectedRevision` 和 `items`；`getBuildAttachments` 和 `getBuildAttachmentHistory` 用于读取。要下载附件，请使用其链接中的 `artifactId` 进行普通下载。读取需要 `annotation.read`，更改需要 `annotation.write` 和 `artifact.read`，上传附件文件需要上传操作。

附件和路径不会随晋级一起转移到另一个仓库。参见[阶段与晋级](./promotion)。

## 相关页面 {#related-pages}

- [原始文件](../protocols/raw-files)
- [上传与下载](./transfers) 和 [UPack 包](./packages)
- [命令行（arkvoryctl）](../protocols/cli)
- API 参考：[路径文件](../api/reference/files)、[制品与目录](../api/reference/artifacts)、[构建附件](../api/reference/attachments)
