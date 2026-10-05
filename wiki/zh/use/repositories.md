---
title: 仓库
description: '什么是仓库，如何查看您可以使用哪些仓库，如何在控制台中选择一个仓库，以及什么是只读仓库。'
---

# 仓库

仓库是 Arkvory 中一个具名位置，文件存储于此，访问权限也在此决定。您发布的所有内容都会进入一个仓库，并且每个请求都会指明它。

## 仓库是什么 {#what-it-is}

仓库有一个 ID：小写拉丁字母、数字、`-` 和 `_`，以字母或数字开头，最多 64 个字符。例如 `releases`、`builds` 和 `game-prod`。ID 是每个地址的一部分：

| 内容                           | 地址                                  |
| ------------------------------ | ------------------------------------- |
| 制品、包、路径文件（HTTP API） | `/api/v1/repositories/<repository>/…` |
| 容器镜像                       | `/v2/<repository>/<image>/…`          |
| Git LFS                        | `/lfs/<repository>`                   |
| npm 和 Unity 包                | `/npm/<repository>/…`                 |

参见[容器镜像](../protocols/containers)、[Git LFS](../protocols/git-lfs) 和 [Unity 与 npm](../protocols/unity-npm)。

仓库保存不可变的制品。它们有两种视图：带版本的 UPack 包（[包](./packages)）和带历史记录的路径文件（[路径文件](./files)）。阶段和晋级在仓库之间移动构建（[阶段与晋级](./promotion)）。

目前，仓库除了访问权限、[存储设置](#settings) 以及（对于另一个服务器的副本而言）其[镜像状态](#read-only)之外，没有显示名称、没有描述，也没有自己的设置。您不能重命名仓库。您不能删除仓库：撤销访问权限后，文件仍留在磁盘上。

## 创建仓库 {#create}

没有创建仓库的命令。只要授予了对仓库的访问权限，它就会存在。在第一次上传之前，仓库是空的。

管理员会执行以下操作之一：

- 授予组对新名称的访问权限。在控制台中，打开 [[ui:administration]]，展开 [[ui:manageGrants]]，选择组，在 [[ui:repository]] 中输入名称，选择 [[ui:read]] 或 [[ui:write]]，然后选择 [[ui:saveGrant]]。所有者所属的组 `arkvory-owners` 是第一次授权的好选择。参见[组与仓库访问](./accounts#groups)。
- 在服务账户的策略中指定仓库名称。参见[用于 CI 的服务账户和密钥](./accounts#service-accounts)。

使用 API 时，`setGroupGrant` 和 `setServicePolicy` 完成同样的操作。输入错误会创建一个新的、错误的名称：请检查拼写。安装后名称 `releases` 就已存在，组 `arkvory-owners` 对它拥有写入权限。

## 查看您可以使用的仓库 {#list}

您只能看到您的凭据拥有权限的仓库。您没有权限的仓库不会出现，直接请求它会返回 `404`。您有权访问的空仓库也会出现。

在控制台中打开 [[ui:repositories]]。每张卡片显示仓库名称，并在 [[ui:repositoryRights]] 下显示您在其中拥有的操作。按钮有：

- [[ui:repositoryOpen]] 打开仓库的目录。当您可以列出制品时它会出现。
- [[ui:repositoryStorage]] 打开带存储设置的目录。当您可以读取存储策略或诊断信息时它会出现。
- [[ui:repositoryAccess]] 通向用户和服务管理。它对管理员和服务管理员显示。

列表一次显示 50 个仓库；[[ui:managementMore]] 加载下一页，[[ui:managementReload]] 刷新它。镜像会显示 [[ui:mirrorBadge]] 徽章。

使用 `arkvoryctl`：

```bash
arkvoryctl repositories
arkvoryctl doctor
```

`repositories` 打印每个仓库及其 `formats` 和您的 `permissions`。当响应包含 `next` 值时，将它作为 `--after` 传入。`doctor` 显示服务器、功能以及当前密钥的权限。

使用 API 时，`listRepositories` 接受 `limit`（1 到 100，默认 50）和 `after`，即上一页的最后一个 ID。`getRepository` 返回一张卡片。

```bash
curl -H "Authorization: Bearer $ARKVORY_KEY" "$ARKVORY/api/v1/repositories?limit=100"
```

```typescript
const page = await client.repositories({ limit: 50 });
const card = await client.repository('releases');
```

一张卡片包含 `id`、`formats`（始终为 `upack` 和 `assets`）和 `permissions`。它不说明大小或文件数量。操作名称参见[权限](./accounts#permissions)。

## 在控制台中选择仓库 {#choose}

[[ui:connection]] 卡片中有字段 [[ui:repository]]，其中列出您可以读取的仓库。该字段初始为 `releases`。登录后，如果您能读取它，控制台会保留它；否则会挑选您能读取的第一个仓库。要在另一个仓库中工作，请输入其名称或从列表中选择它。目录、包、上传和详细信息随后都会使用该仓库。卡片上的 [[ui:repositoryOpen]] 会为您填充该字段。

控制台中制品的地址包含其仓库：`#/artifact/<repository>/<id>`。指向您无法读取的仓库中制品的链接会显示一条消息和目录。

`arkvoryctl` 使用配置文件中的仓库；除非您在添加配置文件时设置了另一个，否则为 `releases`。使用 `--repository` 可为单条命令覆盖它：

```bash
arkvoryctl profile add production --server https://arkvory.example --token-file ~/.arkvory/key --repository builds
arkvoryctl list --repository releases
```

在 SDK 中，`client.inRepository('builds')` 返回绑定到某个仓库的客户端。在 HTTP 中，仓库位于路径中。

## 仓库设置 {#settings}

目前您可以为仓库设置的内容：

- **访问。** 谁可以读取和写入。参见[账户与访问](./accounts)。
- **存储。** 以 GiB 为单位的配额、警告和严重阈值、保留规则（为每个包和通道保留最近 N 个构建、受保护的标签、最短存在时间）、自动清理和物理清理。这些设置需要 `storage.read` 操作来查看，需要 `storage.manage` 操作来更改；人员的组级别不会授予它们，服务密钥则会。在控制台中它们位于 [[ui:storageTitle]] 下，由 [[ui:repositoryStorage]] 打开。使用 `arkvoryctl` 时，`storage usage` 和 `storage policy` 读取它们。超过配额的新上传会被拒绝并返回 `507 storage_quota`。参见[存储与保留](../operate/storage)。
- **镜像。** 服务器管理员可以将该仓库设为另一个服务器仓库的副本。参见下一节。

## 只读仓库 {#read-only}

**镜像**是另一个 Arkvory 服务器上某个仓库的只读副本。服务器会自行保持同步。每个拥有读取权限的人都可以列出和下载。没有人可以更改它：无论人员的组级别或密钥的操作如何，上传、发布、更改标签、添加阶段、分配路径和删除都会被拒绝并返回 `409 mirror_read_only`。要更改内容，请使用主服务器。

控制台会在目录上方显示镜像徽章，并隐藏上传按钮：

| 徽章                 | 含义                       |
| -------------------- | -------------------------- |
| [[ui:mirrorBadge]]   | 副本是最新的               |
| [[ui:mirrorBehind]]  | 服务器仍在追赶             |
| [[ui:mirrorFailing]] | 上次同步失败；下载仍然可用 |

选择徽章旁的 [[ui:mirrorHelpLabel]]，可查看源、上次同步的时间和错误代码。

第二种是**导入**。它是一个普通仓库，会从另一个服务器的仓库中自动接管带有某些阶段的版本（例如从 `dev` 到 `prod`）。它的徽章是 [[ui:mirrorImport]]。仍然可以向它上传，并且之后在源处的更改或删除不会影响已复制的内容。

使用 API 时，`getRepositoryMirror` 返回状态：`mode`（`mirror` 或 `import`）、`phase`（`pending`、`seeding` 或 `following`）、`caughtUp`、`syncedAt` 和 `errorCode`。对于普通仓库，它会返回 `404`。

镜像由服务器管理员设置。参见[镜像](../operate/mirrors)。**读取网关**是另一回事：一个只为相同仓库提供下载服务的地址。通过它进行的更改会被拒绝并返回 `405 read_only`。参见[读取网关](../operate/read-gateways)。

## 相关页面 {#related-pages}

- [账户与访问](./accounts)
- [路径文件](./files) 和 [包](./packages)
- [存储与保留](../operate/storage)
- API 参考：[仓库](../api/reference/repositories)、[镜像](../api/reference/mirrors)
