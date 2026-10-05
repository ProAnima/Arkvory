---
title: Unity 与 npm 包
description: 把仓库用作 Unity Package Manager 的作用域注册表和用于发布及安装包的 npm 注册表。
---

# Unity 与 npm 包

每个 Arkvory 仓库都是位于 `https://<host>/npm/<repository>/` 的兼容 npm 的注册表。Unity Package Manager 将其作为作用域注册表读取，`npm` 向其发布并从其安装。工作室用它来管理多个 Unity 项目共享的 SDK、工具和模块，它们各自带有版本。

包 tarball 是普通制品，因此仓库权限、配额、SHA-256 校验、备份和镜像同样适用于它们。

## 开始之前 {#before-you-start}

您需要：

- 服务器的 HTTPS 地址（参见 [HTTPS](../install/https)）。
- 一个仓库，例如 `games`。其注册表地址是 `https://arkvory.example/npm/games/`。
- 一个密钥。开发人员使用范围为 `read` 的个人访问令牌。负责发布的构建代理使用范围为 `read-write` 的个人令牌或服务密钥。参见[账户与密钥](../use/accounts)。

Arkvory 在包数据中把每个 tarball 的地址发送给客户端。该地址根据客户端访问时使用的主机名构建。当反向代理终止 HTTPS 时，它必须传递 `Host` 请求头并发送 `X-Forwarded-Proto: https`，如安装文档中的 nginx 示例所示。否则客户端会收到 tarball 的 `http://` 地址。

## 将注册表添加到 Unity 项目 {#unity-manifest}

1. 打开项目的 `Packages/manifest.json` 并添加一个作用域注册表：

```json
{
  "scopedRegistries": [
    {
      "name": "Arkvory",
      "url": "https://arkvory.example/npm/games/",
      "scopes": ["com.proanima"]
    }
  ],
  "dependencies": {
    "com.proanima.tools": "1.2.0"
  }
}
```

2. 把密钥提供给 Unity。不要把它放进项目。在用户文件夹中创建文件 `.upmconfig.toml`（Windows 上是 `%USERPROFILE%\.upmconfig.toml`，macOS 和 Linux 上是 `~/.upmconfig.toml`）：

```toml
[npmAuth."https://arkvory.example/npm/games/"]
token = "<your Arkvory key>"
alwaysAuth = true
```

3. 重启 Unity。在 Package Manager 窗口中打开 **My Registries** 以查看注册表中的包。

说明：

- `scopes` 是包名称的前缀。Unity 从 Arkvory 获取名称以某个范围开头的包，其他所有包则从 Unity 注册表获取。
- `.upmconfig.toml` 中的地址必须与清单中的 `url` 相同，包括末尾的斜杠。
- 必须设置 `alwaysAuth = true`。注册表不会发送登录质询，因此 Unity 必须在每个请求中发送令牌。
- Unity 包名是小写的反向域名，例如 `com.company.package`。Unity 不支持带 `@scope/` 的名称。

将 `Packages/manifest.json` 与项目一起提交。每位开发人员保留自己的 `.upmconfig.toml`。

## 发布包 {#publish}

包是顶层带有 `package.json` 的文件夹。使用 `npm` 发布它。

1. 在包的文件夹中创建 `.npmrc` 文件：

```ini
registry=https://arkvory.example/npm/games/
//arkvory.example/npm/games/:_authToken=${ARKVORY_TOKEN}
```

2. 在环境中设置密钥并发布：

```bash
export ARKVORY_TOKEN="$(cat ~/.arkvory/key)"
npm publish
```

```powershell
$env:ARKVORY_TOKEN = (Get-Content C:\Private\arkvory.key -Raw).Trim()
npm publish
```

带有 `_authToken` 的行必须以注册表地址开头，但不含 `https:`。不要把密钥放进 `.npmrc`：npm 会从环境变量中替换 `${ARKVORY_TOKEN}`。

除了在 `.npmrc` 中设置 `registry` 行，您也可以在包的 `package.json` 中设置注册表：

```json
{
  "name": "com.proanima.tools",
  "version": "1.2.0",
  "publishConfig": { "registry": "https://arkvory.example/npm/games/" }
}
```

注册表会检查：

- **名称和版本。** tarball 内 `package.json` 中的 `name` 和 `version` 必须与发布的一致。版本遵循 SemVer 2.0.0，例如 `1.2.0` 或 `2.0.0-beta.1`。注册表从该文件读取版本数据，而不是从客户端发送的 JSON 中读取。
- **校验和。** 客户端声明的长度、`shasum` 和 `integrity` 必须与字节一致。不匹配会返回 `422 integrity_mismatch`。
- **tarball。** 它必须包含 `<folder>/package.json`，与 `npm pack` 生成的一样。归档中的第二个 `package.json` 会被拒绝，因为 npm 和注册表可能会读取不同的文件。
- **版本不可变。** 再次发布相同的 tarball 会成功且不做任何更改（`200`）。为现有版本发布其他内容会返回 `409`，原因为 `version_exists`。请把修复作为下一个版本发布。

`npm publish` 在发布前会先从注册表读取包，因此请为发布密钥授予 `content.read` 和 `artifact.list` 以及 `upload.create`。参见[权限](#permissions)。

`npm publish` 一返回，版本就可用。版本的 tarball 作为制品 `<name>-<version>.tgz` 存储，并带有标签 `npm`。对于带作用域的名称，`@team/util` 会变成 `util-<version>.tgz`。

## 安装包 {#install}

在 Unity 中，在清单里添加依赖，或在 Package Manager 窗口的 **My Registries** 下选择该包。

对于 npm，请在项目或用户的 `.npmrc` 中设置注册表。通常选择为某个作用域设置注册表，因为 Arkvory 不会把请求转发到公共 npm 注册表：

```ini
@team:registry=https://arkvory.example/npm/games/
//arkvory.example/npm/games/:_authToken=${ARKVORY_TOKEN}
```

```bash
npm install @team/util
npm view @team/util versions
npm search tools
```

如果您为整个项目把 `registry=` 设置为 Arkvory，npm 会在那里查找每个包，包括像 `lodash` 这样的公共包，并因 `404` 失败。请使用作用域注册表，或只包含您自己包的项目。

npm 在安装时会检查 `dist.integrity`，并把注册表地址写入 `package-lock.json`。

## 版本与 dist-tag {#versions-and-tags}

dist-tag 是版本的可移动名称。`npm publish` 会把 `latest` 设置为新版本。其他标签有助于区分发布渠道。

```bash
npm publish --tag beta
npm dist-tag add com.proanima.tools@1.3.0 latest
npm dist-tag ls com.proanima.tools
npm dist-tag rm com.proanima.tools beta
```

```bash
npm install com.proanima.tools@beta
```

| 规则       | 值                                                              |
| ---------- | --------------------------------------------------------------- |
| 标签名     | 以字母开头。可包含字母、数字、`.`、`_` 和 `-`。最多 64 个字符。 |
| 禁止的标签 | 看起来像版本号的名称（`v1`、`v2.0`），以及 `x` 或 `X`           |
| `latest`   | 始终指向一个版本。可以移动，不能删除（`409`）。                 |
| 移动标签   | `npm dist-tag add`，或使用 `--tag` 发布。新版本必须存在。       |

标签只是一个名称：它不会删除或隐藏其他版本。

无法删除已发布的版本。参见[不支持](#not-supported)。

## 搜索 {#search}

Unity 中的 **My Registries** 列表和 `npm search` 使用搜索地址 `/-/v1/search`。搜索会查找名称或描述包含该文本（不区分大小写）的包，以及把该文本作为完整关键字的包。不带文本时，它会列出所有包。

- 它为每个包返回一行：带有 `latest` 标签的版本，否则是最新版本。
- 结果按名称排序。没有按流行度排名。
- `size` 默认是 20，最大为 250。`from` 是偏移量。

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_TOKEN" \
  "https://arkvory.example/npm/games/-/v1/search?text=tools&from=0&size=20"
```

若要直接读取包，请请求其名称。`@scope/name` 可以作为 `@scope%2fname` 发送：

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_TOKEN" https://arkvory.example/npm/games/com.proanima.tools
```

响应会列出每个版本及其 `package.json` 的内容（包括 Unity 读取的 `unity` 和 `displayName` 字段）、dist-tag 和发布时间。`dist` 包含 `tarball`、`shasum`（SHA-1）和 `integrity`（SHA-512）。

## 名称与限制 {#limits}

| 项目                        | 规则                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 包名                        | 小写字母、数字、`.`、`_`、`~` 和 `-`，以字母或数字开头。最多 214 个字符。npm 允许 `@scope/name`。                      |
| 版本                        | SemVer 2.0.0，最多 256 个字符                                                                                          |
| tarball 中的 `package.json` | 最多 256 KiB。所有版本的数据会出现在一个响应中，因此请保持其精简。                                                     |
| Tarball                     | 最大为安装实例的最大对象大小，`ARKVORY_MAX_OBJECT_BYTES`（默认约 10 TiB）。解压后超过 100 倍加 64 MiB 的归档会被拒绝。 |
| 发布请求的其余部分          | 最多 8 MiB 的 JSON，最多嵌套 64 层。tarball 以流的方式读取，不保留在内存中。                                           |
| 单个发布请求                | 必须在 30 分钟内完成，且暂停不得超过 30 秒（`ARKVORY_UPLOAD_DEADLINE_MS`、`ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`）           |
| 同时上传数                  | 默认每台服务器 2 个，每个密钥 1 个。等待的请求会在 20 秒后放弃。                                                       |
| 搜索文本                    | 最多 256 个字符                                                                                                        |

`npm publish` 是一个请求，失败后会从第一个字节重新开始。对于数十 GB 的包，请使用 [`arkvoryctl`](./cli) 把文件作为制品或[原始文件](./raw-files)上传。经常变化的大型二进制资源更适合放在 [Git LFS](./git-lfs) 中；把代码和稳定的资源保留在包中。

服务器的限制在[环境变量](../reference/environment#transfers-and-bandwidth)中。

## 权限 {#permissions}

个人令牌和文件密钥会获得仓库的读或写访问权限。服务密钥获得精确的动作。

| 操作                       | 服务密钥动作    | 个人令牌或文件密钥                |
| -------------------------- | --------------- | --------------------------------- |
| 安装：读取包并下载 tarball | `content.read`  | 读访问权限                        |
| 搜索、列出 dist-tag        | `artifact.list` | 读访问权限                        |
| 发布、添加和删除 dist-tag  | `upload.create` | 写访问权限，令牌范围 `read-write` |

仅安装包的开发人员需要范围为 `read` 的令牌。负责发布的构建代理需要 `upload.create`、`content.read` 和 `artifact.list`。没有人能删除已发布的版本。

## 读取网关与镜像 {#read-gateways-and-mirrors}

- [读取网关](../operate/read-gateways)提供安装和搜索服务，因为它们是 `GET` 请求。发布请求会收到 `405`。
- [镜像](../operate/mirrors)保存其源的版本和标签。安装和搜索可以正常工作。发布会以 `409` 和原因 `mirror_read_only` 被拒绝。镜像数据中的 tarball 地址指向该镜像。

若要在 Unity 中使用镜像，请把镜像的地址放入 `url`，把其密钥放入 `.upmconfig.toml`。

## 不支持 {#not-supported}

- 删除版本（`npm unpublish`）。项目会固定版本，删除会破坏它们的构建。请发布修正后的版本并改为移动标签。
- `npm deprecate`、`npm login`、`npm owner`、`npm access` 以及其他管理命令。更改其他路径数据的请求会返回 `405`，并提示 "This registry supports publish, install and dist-tags"。请在控制台中创建令牌并放入 `.npmrc`，而不要使用 `npm login`。
- `/-/all` 处的所有包列表，以及 `npm audit`。
- 到公共注册表的代理。Arkvory 存储您自己的包。来自 npmjs.com 或 Unity 注册表的包会从那里获取。
- 搜索结果的排名。
- 控制台中的包专区。Tarball 会作为带有标签 `npm` 的制品出现在 [[ui:catalog]] 中。

## 故障排查 {#troubleshooting}

错误的形式为 `{"error": "...", "code": "...", "request_id": "..."}`。`npm` 会打印 `error`。请把 `request_id` 提供给管理员，以便在服务器日志中查找该请求。

| 症状                                                  | 起因                                               | 处理方式                                                                                                                                                                |
| ----------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unity 或 npm 中 `401`                                 | 客户端未发送密钥，或密钥错误、已过期或已撤销       | 在 Unity 中，检查 `.upmconfig.toml` 中的地址是否等于清单中的 `url`，以及 `alwaysAuth = true`。在 npm 中，检查 `_authToken` 行是否以与 `registry` 相同的主机和路径开头。 |
| 发布时 `403`                                          | 令牌的范围为 `read`，或密钥缺少 `upload.create`    | 使用具有写访问权限的密钥                                                                                                                                                |
| 包 `404`                                              | 该仓库中没有这样的包，或密钥看不到该仓库           | 检查地址中的仓库和名称。对于 Unity 包，检查其名称是否以 `scopes` 中的某个范围开头。                                                                                     |
| 公共包 `404`                                          | `registry=` 为所有包指向 Arkvory                   | 使用 `@scope:registry=`                                                                                                                                                 |
| `409` 且 `version_exists`                             | 该版本已存在但内容不同                             | 发布新版本                                                                                                                                                              |
| `409` 且 `state_conflict`                             | 您试图删除 `latest`                                | 改为把 `latest` 移动到另一个版本                                                                                                                                        |
| `409` 且 `mirror_read_only`                           | 该仓库是镜像                                       | 发布到主服务器                                                                                                                                                          |
| `422` 且 `integrity_mismatch`                         | 字节与声明的 `shasum` 或 `integrity` 不同          | 重新打包并发布。检查是否有代理更改了正文。                                                                                                                              |
| `400` "package.json names another package or version" | tarball 内的 `package.json` 与发布的名称或版本不同 | 在包的干净构建中运行 `npm publish`                                                                                                                                      |
| `400` "Only publishing a new version is supported"    | 命令发送了更改过的包，例如 `npm deprecate`         | 不支持这些命令                                                                                                                                                          |
| `405`                                                 | 此注册表不支持该命令                               | 参见[不支持](#not-supported)                                                                                                                                            |
| `507`                                                 | 已达到仓库配额或安装实例的容量                     | 释放空间或申请更大的配额                                                                                                                                                |
| `503`                                                 | 同时有太多上传                                     | 等待并重试                                                                                                                                                              |
| Tarball 从 `http://` 下载并失败                       | 代理未发送 `X-Forwarded-Proto: https`              | 按[开始之前](#before-you-start)中所述修复代理                                                                                                                           |

## 相关页面 {#related-pages}

- [客户端与协议](./index)
- [Git LFS](./git-lfs)
- [账户与密钥](../use/accounts)
- [HTTPS](../install/https)
- [镜像](../operate/mirrors)
