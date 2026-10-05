---
title: UPack 包
description: '发布带版本的 UPack 包，列出并筛选它们，以及按精确编号、范围、最新或阶段下载某个版本。'
---

# UPack 包

UPack 包是一个带有名称和 SemVer 版本的 ZIP 归档。Arkvory 对每个版本只注册一次，并且永不更改它。部署作业请求“app，版本 `^1.4`，阶段 `release`”，就会得到恰好一个文件。

## 包是什么 {#what-it-is}

UPack 是一个 ZIP 文件，其根目录中有一个 `upack.json` 文件。清单指定包的名称：

```json
{
  "group": "acme/game",
  "name": "game-client",
  "version": "1.4.2"
}
```

| 字段      | 规则                                                                                 |
| --------- | ------------------------------------------------------------------------------------ |
| `name`    | 必需。1 到 128 个字母、数字、`.`、`_` 或 `-`                                         |
| `version` | 必需。SemVer：`1.4.2`、`1.5.0-rc.1`、`2.0.0+build.7`。最多 128 个字符                |
| `group`   | 可选。由字母、数字、`.`、`_` 或 `-` 组成的段，以 `/` 分隔。最多 128 个字符。默认为空 |

其他字段保持您写入的内容，并会在包列表中返回。清单最大为 64 KiB。归档不得包含绝对路径、`..`、符号链接、加密条目或重复名称，并且最多包含 100 000 个条目。Arkvory 逐字节存储归档，不会解包它。

包的标识是其组、名称和版本，比较时不区分字母大小写。在一个仓库内，一个标识永远属于一个归档。在现有标识下注册不同的归档会被拒绝并返回 `409 version_exists`。再次注册相同的归档是安全的，不会改变任何内容。将修复作为新版本发布。

## 发布包 {#publish}

发布是一次上传，随后是一次注册。注册会读取 `upack.json` 并记录标识。除了上传操作外，您还需要操作 `package.publish` 和 `artifact.read`。参见[权限](./accounts#permissions)。

### 在控制台中 {#publish-console}

1. 在 [[ui:upload]] 中上传归档。参见[上传与下载](./transfers)。
2. 使用 [[ui:open]] 在 [[ui:catalog]] 中打开该制品。
3. 在 [[ui:metadata]] 中选择 [[ui:register]]。控制台会显示它注册的名称和版本。

该包现在会出现在 [[ui:packages]] 中。

### 使用 arkvoryctl {#publish-cli}

```bash
arkvoryctl packages publish ./build.upack --label test --state ./job-state/build.json --json
arkvoryctl packages register 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`packages publish` 会上传归档并支持续传，然后注册它。如果上传后注册失败，错误中会包含 `artifactId` 和阶段 `register`。请再次运行相同的命令：上传不会重复，并且注册两次是安全的。`packages register ID` 注册一个已经上传的制品。参见[命令行](../protocols/cli#packages-and-promotion)。

### 使用 HTTP API 和 SDK {#publish-api}

如[上传与下载](./transfers#upload-http)中所述上传归档，然后注册它：

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/package" \
  -H "Authorization: Bearer $ARKVORY_KEY"
```

```typescript
const entry = await releases.packages.register(uploaded.id);
console.log(entry.group, entry.name, entry.version);
```

该操作为 `registerPackage`。损坏的归档、缺少 `upack.json` 或版本错误会返回 `400 invalid_input`。

## 列出和筛选 {#list}

在控制台中打开 [[ui:packages]]。输入 [[ui:packageGroup]] 或 [[ui:packageName]]：两者都精确匹配，忽略字母大小写。在 [[ui:sortBy]] 中选择一列，在 [[ui:direction]]（[[ui:ascending]] 或 [[ui:descending]]）中选择顺序，并在 [[ui:groupBy]]（[[ui:packageGroup]]、[[ui:packageName]] 或 [[ui:noGrouping]]）中选择分组，然后选择 [[ui:apply]]。[[ui:clearFilters]] 会重置表单。表格显示每个版本的组、名称、版本和阶段。[[ui:open]] 显示制品。[[ui:previousPage]] 和 [[ui:nextPage]] 在各页之间移动。

```bash
arkvoryctl packages list --group acme/game --name game-client
arkvoryctl packages list --after <next from the previous answer>
```

使用 API 时，`listPackages` 接受 `group`、`name`、`sort`（`group`、`name` 或 `version`）、`direction`（`asc` 或 `desc`）、`groupBy`（`none`、`group` 或 `package`）、`after` 和 `limit`（1 到 100，默认 50）。响应包含 `items`（组、名称、版本、`artifactId` 和整个清单）、`groups` 和 `next`。游标属于它来源的过滤器。请仅在与相同过滤器一起使用时使用它。

```typescript
const page = await releases.packages.list({
  name: 'game-client',
  sort: 'version',
  direction: 'desc',
});
```

列出需要 `package.read`。若要改为按标签或元数据搜索，请参见[路径文件](./files#labels)。

## 版本与范围 {#versions}

Arkvory 按 SemVer 优先级比较版本。`1.10.0` 比 `1.9.0` 新。带有预发布部分的版本（例如 `1.5.0-rc.1`）比 `1.5.0` 旧。

一次选择接受包 `name`，以及可选的以下过滤器：

| 过滤器   | 含义                                                |
| -------- | --------------------------------------------------- |
| `group`  | 组。默认为空：只有在您提供组时，才能找到有组的包    |
| 精确版本 | 一个版本。忽略大小写                                |
| 范围     | 一个 SemVer 范围                                    |
| `stage`  | 仅带有此阶段的版本（参见[阶段与晋级](./promotion)） |
| 预发布   | 包含预发布版本。默认关闭                            |
| 排序     | `version`（默认）或 `promoted`                      |

范围可以写为 `1.2.3`、`^1.2`、`~1.2.3`、`1.x`、`>=1.0.0 <2.0.0`、`1.0.0 - 1.4.0` 和 `^1 || ^3`。范围最多 256 个字符。精确版本和范围不能组合使用。

如果没有精确版本或范围，选择会返回最高的稳定版本，也就是最新的版本。只有在预发布过滤器打开时，或者精确版本或范围本身指定了具有相同 `major.minor.patch` 的预发布版本时，才会选择预发布版本。`order promoted` 选择最近一次被标记阶段的版本，而不是最高的版本，并且需要一个阶段。如果没有匹配项，服务器会返回 `404 not_found`。

## 下载包 {#download}

如果您想先看看会得到什么，请先解析；否则直接下载。

```bash
arkvoryctl packages resolve game-client --group acme/game --range ^1.4 --stage release
arkvoryctl packages download game-client ./game-client.upack --group acme/game --range ^1.4 --stage release
arkvoryctl packages download game-client ./game-client.upack --exact 1.4.2 --group acme/game
arkvoryctl packages download game-client ./game-client.upack --group acme/game
```

选项有 `--group`、`--exact`、`--range`、`--stage`、`--prerelease` 和 `--order promoted`。精确版本请使用 `--exact`，因为 `--version` 会打印客户端版本。`resolve` 打印组、名称、版本、`artifactId`、`sha256`、`size`、`publishedAt`、`stagedAt` 和各个阶段。`download` 会先解析，然后下载该制品并支持续传和 SHA-256 校验，如[上传与下载](./transfers#download-cli)中所述。客户端需要 `package.read`、`artifact.read` 和 `content.read`。

使用 HTTP 时有两个操作。`resolvePackage` 需要 `package.read`，并返回与 `resolve` 相同的信息。`downloadPackageContent` 发送所选版本的字节，只需要 `content.read`。它会添加标头 `X-Arkvory-Artifact-Id` 和 `X-Arkvory-Package-Version`。

```bash
curl -fL -G -H "Authorization: Bearer $ARKVORY_KEY" -o game-client.upack \
  --data-urlencode "name=game-client" --data-urlencode "group=acme/game" \
  --data-urlencode "range=^1.4" --data-urlencode "stage=release" \
  "$ARKVORY/api/v1/repositories/prod/packages/content"
```

按名称访问的地址会在每个请求上解析。如果您使用范围续传下载，文件可能在两次调用之间发生了变化。请改为下载 `resolve` 得到的 `artifactId`，或在 `If-Range` 中发送 `ETag`。

```typescript
const found = await prod.packages.resolve({
  name: 'game-client',
  group: 'acme/game',
  range: '^1.4',
  stage: 'release',
});
const stream = await prod.artifacts.downloadVerified(found.artifactId);
```

只获取构建的部署代理，对于 HTTP 地址，只需一个带有 `content.read` 的服务密钥；对于 `arkvoryctl`，则使用读取预设。参见[用于 CI 的服务账户和密钥](./accounts#service-accounts)。

## 标签、元数据和附件 {#labels}

包版本是普通制品，因此[路径文件](./files#labels)中的所有内容都适用于它：`test`、`staging` 和 `release` 等标签，`git.commit` 等文本元数据，集合，以及 SBOM 或签名等附件。在上传时使用 `--label test` 设置第一批标签。标签不会改变归档的任何内容。它们是自由文本，不是受控状态。对于部署可以依赖的批准，请使用阶段。参见[阶段与晋级](./promotion)。

## 保留旧版本 {#retention}

仓库的保留策略统计的是已注册的包。默认情况下，启用后，它会为每个包和通道保留最近 10 个构建。通道是标签 `test`、`staging` 或 `release`。带有阶段、受保护的标签、文件路径或附件链接的版本绝不会被保留策略移除。保留功能在管理员开启并同意删除之前一直关闭。参见[存储与保留](../operate/storage)。

## 错误 {#errors}

| 响应                         | 含义                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| 注册时的 `400 invalid_input` | 不是有效的 UPack ZIP、根目录中没有 `upack.json`，或者名称或版本错误                        |
| `409 version_exists`         | 该标识已经属于另一个归档。请发布新版本。晋级到已有该版本但字节不同的仓库也会以相同方式失败 |
| 解析时的 `404 not_found`     | 没有匹配过滤器的内容。请检查组、范围和阶段                                                 |
| `403 permission_missing`     | 密钥缺少 `package.read`、`package.publish` 或 `content.read`                               |

## 相关页面 {#related-pages}

- [上传与下载](./transfers)
- [阶段与晋级](./promotion)
- [命令行（arkvoryctl）](../protocols/cli)
- API 参考：[包](../api/reference/packages)、[阶段与晋级](../api/reference/promotion)
