---
title: 阶段与晋级
description: '用阶段标记构建，将它们晋级到另一个仓库，并让部署代理挑选某个阶段的最新构建。'
---

# 阶段与晋级

构建从 CI 到生产要经过多个步骤：已测试、已批准、已发布。Arkvory 为此提供两个工具。**阶段**是构建上的标记，例如 `qa` 或 `release`。**晋级**在另一个仓库中发布构建，而无需再次发送字节。可以单独使用其中之一，也可以两者一起使用。

## 阶段与仓库 {#concepts}

- **阶段**表示构建在何处获得批准。一个构建可以有多个阶段，最多 16 个。阶段属于某个仓库中的一个构建。只有阶段操作会更改它们，并且每次更改都会连同作者和可选注释记入日志。
- **晋级**将构建从一个仓库复制或移动到另一个仓库，例如从 `dev` 到 `staging` 再到 `prod`。副本是目标中的新制品。不会上传任何字节。
- **标签**只是一个没有历史记录的自由标记。阶段是部署可以依赖的受控标记。参见[路径文件](./files#labels)。

阶段名称有 1 到 32 个字符：小写字母、数字、`.`、`_` 或 `-`，以字母或数字开头。带有阶段的构建不能被删除，保留策略会保留它。请先移除阶段。

## 添加和移除阶段 {#stages}

在控制台中，在 [[ui:metadata]] 中打开该制品。[[ui:promotionTitle]] 区域显示 [[ui:stagesTitle]] 以及构建的各阶段。输入 [[ui:stageName]]，如果您愿意，还可以输入 [[ui:stageComment]]，然后选择 [[ui:stageAdd]]。每个阶段都有一个移除按钮，控制台会要求确认：请求此阶段的部署将挑选另一个版本。

阶段也会显示在目录中（作为每行的标签），以及 [[ui:packages]] 的 [[ui:packageStages]] 列中。

```bash
arkvoryctl stages add 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 qa --comment "smoke passed" --repository dev
arkvoryctl stages list 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository dev
arkvoryctl stages remove 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 qa --repository dev
arkvoryctl stages artifacts --stage release --repository prod
```

`stages artifacts` 每次列出 100 个带有某个阶段（或某个特定阶段）的构建。将 `next` 作为 `--after` 传入。

使用 API：

```bash
curl -X PUT "$ARKVORY/api/v1/repositories/dev/artifacts/$ID/stages/qa" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"comment":"smoke passed"}'
curl -X DELETE "$ARKVORY/api/v1/repositories/dev/artifacts/$ID/stages/qa" \
  -H "Authorization: Bearer $ARKVORY_KEY"
```

```typescript
await dev.stages.add(id, 'qa', 'smoke passed');
const { items } = await prod.stages.artifacts({ stage: 'release' });
```

操作为 `setArtifactStage`、`removeArtifactStage`、`listArtifactStages` 和 `listStagedArtifacts`。添加一个已经存在的阶段不会改变任何内容：最初的时间和注释保持不变。移除一个不存在的阶段会成功。有 16 个阶段的构建会以 `409 stage_limit` 拒绝另一个阶段。

## 晋级到另一个仓库 {#promote}

在控制台中打开该制品。当您可以读取该构建并且可以晋级到至少一个其他仓库时，会出现表单 [[ui:promoteTitle]]。从这些仓库中选择 [[ui:promoteTarget]]。输入要在目标中设置的 [[ui:promoteStages]]（以逗号分隔）和一个 [[ui:promoteComment]]。选择 [[ui:promoteSubmit]]。如果没有其他仓库允许这样做，控制台会显示 [[ui:promoteNoTargets]]。

```bash
arkvoryctl promote 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository staging --to prod --stage release --comment CAB-142
arkvoryctl promote 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository staging --to prod --move
```

`--repository` 是源，`--to` 是目标。结果包含目标 `repository`、新的 `artifactId`、`sourceArtifactId`、`mode`、`created` 和 `stages`。

```bash
curl -X POST "$ARKVORY/api/v1/repositories/staging/artifacts/$ID/promote" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"target":"prod","mode":"copy","stages":["release"],"comment":"CAB-142"}'
```

```typescript
await staging.promotions.promote(id, { target: 'prod', mode: 'copy', stages: ['release'] });
```

新副本的响应为 `201`，目标已有该副本时为 `200`。该操作为 `promoteArtifact`。

### 复制或移动 {#copy-move}

|              | 复制（默认） | 移动                                                     |
| ------------ | ------------ | -------------------------------------------------------- |
| 源           | 保留         | 在发布副本的同一步骤中被移除                             |
| 源的阶段     | 留在源上     | 除您指定的阶段外，还会传递到副本                         |
| 在控制台中   |              | 勾选 [[ui:promoteMove]]。控制台会要求确认                |
| 受阻止的情况 |              | 源仍被外部引用、文件路径或附件链接使用。不会发布任何内容 |

副本会得到什么，不会得到什么：

- 它会得到源的标签、元数据和集合、其 UPack 标识以及您指定的阶段。它是一个带有新 ID 的新制品。其 SHA-256 相同。
- 它不会得到附件，也不会得到路径指针。请在目标中重新链接它们。
- 不会上传任何字节。在同一台服务器上，存储的文件会被共享，直到使用它的最后一个制品消失。
- 它会像一次新上传一样计入目标的配额。
- 重复晋级会返回相同的副本。如果目标已经有一个具有相同组、名称、版本和校验和的包，则返回该制品。字节不同时，服务器会返回 `409 version_exists`。
- 目标必须与源不同。镜像不能作为目标，因为它是只读的。参见[仓库](./repositories#read-only)。

被中断的晋级会留下一个短期预留。请以相同账户再次运行相同的晋级以继续。

## 晋级历史记录 {#history}

控制台中的制品页面显示 [[ui:promotionHistory]]，最早的在前：谁添加或移除了阶段、谁将构建复制或移动到另一个仓库，以及接收到的副本来自哪里。[[ui:promotionMore]] 加载下一条记录。

```bash
arkvoryctl promotions history 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository prod
arkvoryctl promotions journal --repository prod --after 120 --json
```

仓库的日志供 CI 使用。使用您所见到的最后一个 `sequence` 作为 `--after` 轮询它，就能按顺序获取新事件。一个事件包含 `sequence`、`action`（`stage.added`、`stage.removed`、`promoted` 或 `received`）、`stage`、`mode`、对端仓库和制品、`actor`、`comment` 和时间。每页最多 100 个事件。操作为 `listArtifactPromotions` 和 `listRepositoryPromotions`。

## 为部署挑选构建 {#resolve}

部署代理请求“位于范围 `^1.4` 内且具有阶段 `release` 的包 `app` 的最新构建”。Arkvory 会返回恰好一个版本；如果没有，则返回 `404`。

```bash
arkvoryctl packages resolve app --group acme/game --range ^1.4 --stage release --repository prod --json
arkvoryctl packages download app ./app.upack --group acme/game --range ^1.4 --stage release --repository prod
```

`resolve` 会打印选择结果而不下载它：

```json
{
  "group": "acme/game",
  "name": "app",
  "version": "1.4.7",
  "artifactId": "3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11",
  "sha256": "…",
  "size": "73400320",
  "publishedAt": "2026-10-01T09:30:00.000Z",
  "stagedAt": "2026-10-02T12:00:00.000Z",
  "stages": ["qa", "release"]
}
```

使用 HTTP 时，`resolvePackage` 返回此结果，`downloadPackageContent` 在一次调用中发送相同选择的字节：

```bash
curl -fL -G -H "Authorization: Bearer $DEPLOY_KEY" -o app.upack \
  --data-urlencode "name=app" --data-urlencode "group=acme/game" \
  --data-urlencode "range=^1.4" --data-urlencode "stage=release" \
  "$ARKVORY/api/v1/repositories/prod/packages/content"
```

```typescript
const found = await prod.packages.resolve({ name: 'app', range: '^1.4', stage: 'release' });
```

每个工具中的过滤器都相同：包 `name`、`group`（如果包没有组则为空）、精确版本或范围、`stage`、是否包含预发布版本以及排序。范围在 [UPack 包](./packages#versions)中有说明。

默认情况下，最新的 SemVer 版本胜出。使用 `--order promoted`（HTTP 中为 `order=promoted`）时，最近一次被标记阶段的版本胜出，即使其编号更低。这需要一个阶段。

名称会在每个请求上解析，因此如果在两次调用之间有人进行晋级，两次调用可能返回不同的构建。对于必须续传的下载，请从 `resolve` 中获取 `artifactId` 并下载它。

## 回滚 {#rollback}

使用排序 `promoted` 时，回滚就是普通的一步。从有问题的版本移除阶段，之前被标记阶段的版本就会成为选择。要让一个更旧的版本重新成为当前版本，请移除其阶段并再次添加：添加一个已经存在的阶段不会更新其时间。

```bash
arkvoryctl stages remove <faulty artifact id> release --repository prod
arkvoryctl packages download app ./app.upack --stage release --order promoted --repository prod
```

## 权限 {#permissions}

| 操作                       | 密钥：仓库操作                                                  | 人员：组访问             |
| -------------------------- | --------------------------------------------------------------- | ------------------------ |
| 读取构建的阶段和历史记录   | `artifact.read`                                                 | 读取                     |
| 列出已标记阶段的构建和日志 | `artifact.list`                                                 | 读取                     |
| 添加或移除阶段             | `artifact.promote` 和 `artifact.read`                           | 写入                     |
| 复制晋级                   | 源：`artifact.read` 和 `content.read`。目标：`artifact.promote` | 对源的读取，对目标的写入 |
| 移动晋级                   | 同上，以及源上的 `artifact.promote`                             | 对两者的写入             |
| 解析版本                   | `package.read`                                                  | 读取                     |
| 按名称下载所选版本         | `content.read`                                                  | 读取                     |

只下载的部署代理的密钥，在它读取的仓库中需要 `content.read`。对于 `arkvoryctl packages download`，它还需要 `package.read` 和 `artifact.read`。参见[权限](./accounts#permissions)。

服务器也可以自行交换构建：一个仓库可以从另一个服务器的仓库导入带有某些阶段的版本。参见[镜像](../operate/mirrors)。

## 相关页面 {#related-pages}

- [UPack 包](./packages) 和 [仓库](./repositories)
- [账户与访问](./accounts)
- [命令行（arkvoryctl）](../protocols/cli#packages-and-promotion)
- API 参考：[阶段与晋级](../api/reference/promotion)
