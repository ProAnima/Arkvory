---
title: 身份验证
description: '对 Arkvory HTTP API 进行身份验证的每一种方式、每种凭据可以做什么，以及访问规则和仓库操作如何运作。'
---

# 身份验证

对 `/api/v1` 的每次调用都需要凭据，公开健康检查、登录选项、登录和注册除外。本页列出凭据的种类、如何获取和发送每种凭据，以及 [API 参考](./index#reference-pages)中的访问规则的含义。有关管理访问权限的人员的规则，参见[账户与访问](../use/accounts)。

## 凭据一览 {#credentials}

| 凭据         | 形式              | 获取方式                                      | 有效期                  | 用途                                 |
| ------------ | ----------------- | --------------------------------------------- | ----------------------- | ------------------------------------ |
| 控制台会话   | `dps_…`           | 使用名称和密码登录                            | 12 小时                 | 控制台中的人员，或执行登录的脚本     |
| 个人访问令牌 | `pat_…`           | 从会话创建                                    | 默认 90 天，最多 365 天 | 某个人的脚本和工具                   |
| 服务密钥     | `arkvory_…`       | 为服务账户签发，然后激活                      | 默认 90 天，最多 365 天 | CI/CD、部署代理、其他系统            |
| 恢复密钥     | 64 个十六进制数字 | 安装程序将其写入 `config/bootstrap-token.txt` | 不过期                  | 创建所有者、管理服务账户、恢复访问   |
| 下载链接     | `dtl_…`           | 为一个制品创建                                | 60 秒到 24 小时         | 在没有密钥的情况下将一个制品交给某人 |

自动化请使用服务密钥，某个人的工具请使用个人访问令牌。不要在日常工作中使用恢复密钥。

## 头部格式 {#headers}

`/api/v1` 在一个头部中接受凭据：

```http
Authorization: Bearer <credential>
```

- 凭据长度为 32 到 512 个字符。其他任何情况都会立即返回 `credential_invalid`。
- 容器注册表（`/v2`）、Git LFS（`/lfs`）和 npm 注册表（`/npm`）也接受 HTTP Basic，因为 `docker login`、git 和 npm 以这种方式发送凭据。用户名不检查；密码就是凭据。参见[客户端与协议](../protocols/index#credentials)。
- 下载链接放在查询字符串中，形式为 `?token=dtl_…`，且仅在一个制品的内容路由上有效。参见[下载链接](#download-links)。`Authorization` 头部始终优先于查询。
- 没有有效凭据的请求会收到 `401`、`WWW-Authenticate: Bearer` 和一个原因：`credential_missing`、`credential_invalid`、`session_expired` 或 `token_expired`。只有持有已过期凭据确切机密的人才会得知它已过期。
- **不使用 cookie。** Arkvory 既不设置也不读取任何 cookie，因此浏览器绝不会自行附带凭据，也就没有需要防御的跨站请求伪造。脚本在每次调用时发送头部。控制台将会话令牌保存在浏览器标签页的内存中，并在您关闭标签页时忘记它。
- **其他来源。** 与 Arkvory 位于同一地址的页面无需任何操作。位于另一地址的页面会以 `403` 和原因 `origin_not_allowed` 被拒绝，除非管理员将其来源列入 `ARKVORY_CORS_ORIGINS`，即使凭据有效也是如此。请使用 HTTPS：明文 HTTP 中的凭据可在网络上被读取。参见 [HTTPS](../install/https)。

检查凭据是什么以及它可以做什么：

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_KEY" "$ARKVORY_URL/api/v1/auth/me"
curl -fsS -H "Authorization: Bearer $ARKVORY_KEY" "$ARKVORY_URL/api/v1/auth/permissions"
```

## 控制台登录会话 {#sessions}

人员使用名称和密码登录并获得一个会话。控制台为您完成此操作；脚本也可以这样做。

1. 将名称和密码放入私有文件 `login.json`，这样它们绝不会出现在命令行或进程列表中：

   ```json
   { "name": "alice", "password": "a long password of 12 to 128 characters" }
   ```

2. 调用 `login`：

   ```bash
   curl -fsS -X POST "$ARKVORY_URL/api/v1/auth/login" \
     -H "Content-Type: application/json" -d @login.json
   ```

3. 响应包含会话令牌及其结束时间：

   ```json
   {
     "token": "dps_…",
     "expiresAt": "2026-10-05T21:30:00.000Z",
     "account": { "id": "…", "name": "alice", "administrator": false, "enabled": true }
   }
   ```

4. 将令牌作为 `Authorization: Bearer dps_…` 发送。

会话的规则：

- 它持续 12 小时且不会延长。之后，每次调用都会返回 `401`，原因为 `session_expired`。请重新登录。
- 一个账户最多有 32 个会话。新的登录会结束超出此数量的最旧会话。
- `POST /api/v1/auth/logout` 结束会话。更改您的密码，或管理员重置密码，会结束该账户的所有会话和所有个人令牌。禁用账户会使其停止。
- 会话携带账户的完整权限，包括管理员标志。只有会话可以创建和撤销个人令牌并更改账户自己的密码。
- 名称比较不区分大小写。错误的名称、错误的密码和已禁用的账户都会给出相同的 `401`，原因为 `invalid_credentials`。
- 读取网关不让任何人登录；请使用写入端。

### 自助注册 {#self-registration}

`GET /api/v1/auth/options` 是公开的，用于告知人们是否可以创建自己的账户。除非管理员设置 `ARKVORY_ALLOW_REGISTRATION=true`，否则自助注册处于关闭状态；此时，使用与登录相同的正文调用 `POST /api/v1/auth/register` 会创建一个普通账户（不是管理员，无权访问任何仓库）并以 `201` 返回一个会话。否则它会以原因 `registration_disabled` 应答 `403`。自助注册在 900 个账户时停止，以便管理员仍可创建账户，直到 1,000 的上限。

## 个人访问令牌 {#personal-tokens}

个人访问令牌让脚本无需您的密码即可代表您行事。只有已登录的会话才能创建一个。

```bash
curl -fsS -X POST "$ARKVORY_URL/api/v1/auth/tokens" \
  -H "Authorization: Bearer $SESSION" -H "Content-Type: application/json" \
  -d '{"name":"laptop-cli","scope":"read-write","expiresAt":"2026-12-31T00:00:00Z"}'
```

在控制台中，打开 [[ui:connection]] 卡片中的 [[ui:personalAccessTokens]]，输入 [[ui:tokenName]]，选择 [[ui:tokenScope]] 和 [[ui:tokenExpiry]]，然后选择 [[ui:generateToken]]。

| 字段        | 规则                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------- |
| `name`      | 1 到 64 个字符。                                                                             |
| `scope`     | `read` 或 `read-write`。省略时 API 使用 `read-write`；控制台首先提供 [[ui:tokenScopeRead]]。 |
| `expiresAt` | 未来的 RFC 3339 时间，最多 365 天之后。默认是 90 天。不存在没有结束时间的令牌。              |

`201` 响应会以 `token` 形式包含令牌一次。请在此时保存它：服务器只保存哈希，列表显示一个短前缀。然后：

- 令牌具有其账户的仓库访问权限，仅此而已。它永远不会具有管理员标志，因此无法管理账户、组、更新或备份。
- `read` 令牌只能读取。除 `logout` 外，任何更改内容的请求都会在操作运行之前以 `403` 和原因 `read_only_token` 被拒绝。
- 令牌不能创建令牌或更改密码；这些需要会话。
- 一个账户最多有 50 个活动令牌。`GET /api/v1/auth/tokens` 列出它们及其前缀、范围、结束时间和最近一次使用。`DELETE /api/v1/auth/tokens/{id}` 立即撤销一个（控制台中的 [[ui:revokeToken]]）。管理员可以列出并撤销任何账户的令牌。
- 过期的令牌返回 `401`，原因为 `token_expired`。

## 服务账户与密钥 {#service-accounts}

**服务账户**是供工具（例如构建代理）使用的身份。它有一个**策略**：一个**绑定**列表，每个绑定指明一个仓库以及在那里允许的确切**操作**（参见[仓库操作](#repository-actions)）。一个策略最多有 64 个绑定。该账户拥有其密钥启动的上传和任务，因此轮换密钥不会丢失任何内容。一台服务器最多有 1,000 个服务账户。

只有[恢复密钥](#recovery-key)可以创建服务账户。它，或拥有[委派](#delegation)的操作员，可以更改已存在的账户。在控制台中，使用 [[ui:services]]：[[ui:serviceCreate]]，然后设置 [[ui:servicePolicy]]。[[ui:bindingRead]] 填入七个读取操作，[[ui:bindingPublish]] 添加上传和注册包所需的操作。

```bash
curl -fsS -X POST "$ARKVORY_URL/api/v1/service-accounts" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" \
  -d '{"name":"ci-release","bindings":[{"resource":{"kind":"repository","id":"releases"},
       "actions":["repository.read","artifact.read","upload.create","upload.read","upload.write",
                  "upload.complete","upload.cancel","job.read","package.publish"]}]}'
```

名称使用 3 到 64 个字母、数字、`_`、`.` 和 `-`。要更改策略，请使用您读取到的 `expectedRevision` 发送 `PUT /api/v1/service-accounts/{id}/policy`（[比较并交换](./index#revisions)）。要关闭账户，请发送 `PATCH /api/v1/service-accounts/{id}`，正文为 `{"expectedRevision": n, "enabled": false}`；其所有密钥都会停止工作，直到您重新开启它。

### 服务密钥 {#service-keys}

密钥是服务账户用于登录的机密。它的形式为 `arkvory_<uuid>.<secret>`。密钥经历三种状态：`pending`、`active` 和 `revoked`。

1. **签发。** 发送 `POST /api/v1/service-accounts/{id}/keys`，带上 `Idempotency-Key`、`name`、密钥可以使用的 `bindings`，以及（如果需要）`expiresAt`（UTC，365 天内；默认是 90）。密钥的绑定必须位于账户的策略之内。响应 `201` 包含密钥的元数据，并且仅此一次包含其 `secret`。使用相同幂等键重复会返回 `200`，只含元数据而不含机密。
2. **激活。** 新密钥处于 `pending` 状态，除了一次调用 `POST /api/v1/auth/activate-key`（以新机密作为凭据）之外不可用。响应为 `204`。请在 15 分钟内完成；之后密钥会因未使用而过期。在控制台中，复制机密，选择 [[ui:keySaved]]，然后选择 [[ui:keyActivate]]。再次激活是无害的。
3. **使用。** 密钥一直有效，直到其 `expiresAt`，或被撤销，或其账户被禁用。

```bash
curl -fsS -X POST "$ARKVORY_URL/api/v1/service-accounts/$ACCOUNT/keys" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Idempotency-Key: ci-release-2026-10" \
  -H "Content-Type: application/json" \
  -d '{"name":"ci-release-2026-10","bindings":[{"resource":{"kind":"repository","id":"releases"},
       "actions":["upload.create","upload.read","upload.write","upload.complete","job.read"]}]}'
curl -fsS -X POST "$ARKVORY_URL/api/v1/auth/activate-key" -H "Authorization: Bearer $NEW_SECRET"
```

限制：一个账户同时最多有 3 个活动密钥和 2 个待处理密钥（`507`，原因为 `key_limit`）。

**轮换。** `POST /api/v1/api-keys/{id}/rotate` 为同一账户签发一个新的待处理密钥，正文与签发相同并带有 `Idempotency-Key`。其绑定必须位于旧密钥的绑定之内。当您激活新密钥时，旧密钥的结束时间会被缩短为从那时起最多 24 小时。将您的工具迁移到新密钥，然后撤销旧密钥。在控制台中：[[ui:keyRotate]]。

**撤销。** `POST /api/v1/api-keys/{id}/revoke` 永久结束一个密钥；重复它是无害的。在控制台中：[[ui:keyRevoke]]。撤销密钥不会停止已经开始的传输。丢失了待处理密钥的机密？请撤销它并使用新的幂等键签发另一个。

### 委派 {#delegation}

恢复密钥可以将部分管理权限交给一个**操作员**：一个其密钥可以管理其他服务账户的服务账户。**委派**指明操作员的密钥、目标账户、操作员可以对其使用的**管理操作**，以及**上限**，即它可以给出的仓库操作。七个管理操作是：

| 操作                     | 允许                             |
| ------------------------ | -------------------------------- |
| `service-account.read`   | 在列表中看到该账户并读取其卡片。 |
| `service-account.manage` | 开启或关闭该账户。               |
| `policy.read`            | 读取账户的策略。                 |
| `policy.manage`          | 替换账户的策略。                 |
| `credential.read`        | 列出账户的密钥并读取密钥。       |
| `credential.manage`      | 签发、轮换和撤销密钥。           |
| `service-audit.read`     | 读取账户的密钥历史记录。         |

规则：操作员的密钥必须是恢复密钥签发的密钥；操作员绝不管理自己的账户；它不能给出超出其上限或超出账户策略的任何内容；它签发的密钥不能比它自己的密钥存活更久；结束委派不会撤销已经激活的密钥。只有恢复密钥可以创建账户并设置委派（`PUT` 和 `DELETE /api/v1/api-keys/{id}/delegations/{accountId}`）。一个操作员密钥最多可以有 64 个委派。在控制台中，使用 [[ui:delegations]]。需要其委派之外内容的操作员，对于它不管理的账户会收到 `404`，或收到 `403`。

## 恢复密钥 {#recovery-key}

安装程序创建一次**恢复密钥**，并将其写入[安装根目录](../install/index#installation-directory)中的 `config/bootstrap-token.txt`。只有 Windows 上的 Administrators 组或 Linux 上的 root 可以读取该文件。其哈希位于服务器的密钥文件（`ARKVORY_KEYS_FILE`）中，名称为 `bootstrap-owner`。安装程序还创建 `config/health-token.txt`，这是第二个没有任何仓库权限的密钥，可以调用经过身份验证的健康检查和指标。

恢复密钥可以做什么：

- 创建第一个账户以及其后的每个账户，重置密码，禁用账户，并管理组及其仓库授权。
- 读取安全审计并撤销任何账户的个人令牌。
- 创建服务账户，设置其策略，签发和撤销其密钥，并设置委派。
- 读取和请求备份与更新，并下载服务器日志以提供反馈。
- 像具有 [[ui:write]] 访问权限的组成员一样读取和写入仓库 `releases`。

它不能做什么：它无法访问 `releases` 以外的仓库，不能删除制品或管理存储策略（这些操作仅对服务密钥存在），并且它不是会话，因此不能创建个人令牌或更改密码。请将其保存在服务器上。安装工具会在那里读取它。不要将其放入 CI，也不要将其粘贴到工具中；请改为创建服务密钥。要替换它，参见[配置](../install/configuration)。

控制台的 [[ui:welcomeOwner]] 表单（位于 [[ui:navStart]] 下）使用恢复密钥创建第一个所有者。它仅在不存在任何账户时有效。要在没有会话的情况下重置现有账户的密码，请用 `GET /api/v1/users` 找到其 ID，将新密码（12 到 128 个字符）放入私有文件，并使用恢复密钥发送。重置会结束该账户的所有会话和令牌。

```bash
echo '{"password": "a new password of 12 to 128 characters"}' > reset.json
curl -fsS -X PATCH "$ARKVORY_URL/api/v1/users/$USER_ID" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" -d @reset.json
rm reset.json
```

管理员可以在密钥文件中添加其他文件密钥。每个条目都有一个 `id`、机密的 `sha256`、它获得的 `repositories` 和 `permissions`（`read` 和 `write`），以及可选的标志 `administrator` 和 `serviceAdministrator`。该文件在启动时读取，因此在更改后请重启 API 和工作进程。

## 下载链接 {#download-links}

`POST /api/v1/repositories/{repository}/artifacts/{id}/links` 为一个制品返回 `token`（`dtl_…`）和 `url`。使用 `ttlSeconds` 请求有效期：60 到 86,400，默认 3,600。调用者需要 `content.read`。

该链接仅作为 `/api/v1/repositories/{repository}/artifacts/{id}/content?token=…` 的 `GET` 或 `HEAD` 有效，针对该仓库中的该制品，且仅用于读取。它是机密。服务器无法在其过期之前撤销它，它也不会出现在日志中。请创建您所需的最短生命周期的链接。

## 访问规则的含义 {#access-rules}

参考中的每个操作都有一行**访问**。以下是规则的种类：

| 参考中的规则                              | 要求                                                                                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 任何人，无需密钥                          | 无。存活、就绪状态、登录选项、登录和注册。                                                                                                         |
| 任何有效的密钥或会话                      | 任何有效的凭据。例如：功能、操作列表、您自己的身份、就绪详情和指标。                                                                               |
| 已登录的账户会话（不是密钥）              | 人员的会话。个人令牌和密钥会被拒绝（`session_required`）。例如：创建和撤销您自己的令牌，更改您的密码。                                             |
| 管理员                                    | 管理员账户的会话，或带管理员标志的文件密钥，例如恢复密钥。个人令牌和服务密钥会被拒绝（`administrator_required`）。例如：账户、组、安全审计、更新。 |
| 引导密钥（安装恢复密钥）                  | 带服务管理标志的文件密钥。恢复密钥具有它。例如：创建服务账户和设置委派。                                                                           |
| 引导密钥，或密钥本身                      | 恢复密钥，或列出了委派的密钥。                                                                                                                     |
| 已签发的密钥，激活之前或之后              | 唯一接受待处理密钥的操作：激活。                                                                                                                   |
| 调用者可以看到的仓库                      | 该仓库上的 `repository.read` 操作，或者会话或文件密钥对它的任何访问。调用者无法看到的仓库会被排除在列表之外并应答 `404`。                          |
| 系统权限 `backup.read` 或 `backup.manage` | 由管理员会话和带管理员标志的文件密钥持有。服务密钥和个人令牌永远没有它们。`backup.manage` 包含 `backup.read`。                                     |
| 服务管理权限                              | 目标账户上的七个[管理操作](#delegation)之一，来自委派，或恢复密钥。                                                                                |
| 仓库权限                                  | 路径中所指仓库上列出的**所有**仓库操作。多条访问规则会添加条件：上传、任务或引用必须属于调用者。                                                   |

仓库规则行的第二部分，例如“file keys: `read`, `write`”，是人员和文件密钥所需的粗粒度授权，而不是确切的操作。参见[组授权](#group-grants)。

除了访问规则之外，服务器还会拒绝在作为镜像的仓库中进行更改（`409`、`mirror_read_only`），读取网关会拒绝每一处更改（`405`、`read_only`）。

## 仓库权限 {#repository-permissions}

### 组授权 {#group-grants}

人们通过**组**获得仓库访问权限。管理员在仓库上授予组 `read` 或 `write`（显示为“Read and write”），并将账户添加到组中。在控制台中：[[ui:administration]]，然后 [[ui:manageGrants]] 和 [[ui:saveGrant]]。API 调用是 `PUT /api/v1/access-groups/{id}/grants/{repository}`，正文为 `{"access": "read"}` 或 `{"access": "write"}`，以及 `PUT /api/v1/access-groups/{id}/members/{userId}`。权限在每次请求时重新计算，因此更改会立即生效。

`read` 授权提供以下操作：`repository.read`、`artifact.read`、`artifact.list`、`content.read`、`package.read`、`asset.read` 和 `annotation.read`。`write` 授权添加 `upload.create`、`upload.read`、`upload.write`、`upload.complete`、`upload.cancel`、`job.read`、`package.publish`、`asset.write`、`asset.restore`、`annotation.write`、`reference.write`、`artifact.promote` 和 `audit.read`。操作 `artifact.delete`、`storage.read`、`storage.manage` 和 `diagnostics.read` 不能来自组：只有服务密钥可以拥有它们。

### 仓库操作 {#repository-actions}

服务密钥逐仓库携带确切的操作。共有 24 个：

| 操作               | 允许                                                                        |
| ------------------ | --------------------------------------------------------------------------- |
| `repository.read`  | 查看仓库及其镜像状态。                                                      |
| `artifact.read`    | 读取制品的详情、阶段和晋级。对制品的每次更改也需要它。                      |
| `artifact.list`    | 列出和搜索制品，列出已分阶段的制品，读取晋级日志和变更流。                  |
| `artifact.promote` | 设置和移除阶段，并晋级（复制或移动）到另一个仓库。                          |
| `artifact.delete`  | 删除制品，预览和应用保留规则，以及移除容器镜像并强制解锁 Git LFS 文件。     |
| `content.read`     | 按 ID、按包或按路径下载字节，并创建下载链接。                               |
| `upload.create`    | 创建上传会话。推送到注册表和 Git LFS 会使用它。                             |
| `upload.read`      | 读取您自己的上传会话及其分片。                                              |
| `upload.write`     | 发送您自己上传的分片或完整内容。                                            |
| `upload.complete`  | 完成您自己的上传，或将其完成操作排队。                                      |
| `upload.cancel`    | 取消您自己的待处理上传。                                                    |
| `job.read`         | 读取您自己的完成任务。                                                      |
| `package.read`     | 列出包、解析版本并下载包。                                                  |
| `package.publish`  | 将 UPack 归档注册为包。                                                     |
| `asset.read`       | 列出路径文件并读取其指针、历史记录和修订版本。下载字节需要 `content.read`。 |
| `asset.write`      | 让路径指向一个制品，或存储一个原始文件。                                    |
| `asset.restore`    | 恢复路径的较早修订版本。                                                    |
| `annotation.read`  | 读取标签、元数据、集合和附件。                                              |
| `annotation.write` | 替换标签、元数据、集合和附件。                                              |
| `reference.write`  | 添加和移除保护制品的引用。                                                  |
| `audit.read`       | 读取仓库的目录审计。                                                        |
| `storage.read`     | 读取配额、用量、存储策略和物理清理设置。                                    |
| `storage.manage`   | 更改存储策略和物理清理设置，并运行物理清理。                                |
| `diagnostics.read` | 读取存储事件。                                                              |

操作所需的确切集合在其参考行中，例如 `putUploadContent` 需要 `upload.write` 和 `upload.complete`。对仓库的更改也需要匹配的 `read` 操作，例如 `annotation.write` 搭配 `artifact.read`。

所有者条件适用于上传和任务：您只能对您的账户创建的上传会话和完成任务进行操作。一个服务账户的所有密钥，以及一个人的所有会话和令牌，都算作同一个所有者。因此，一个仓库中的多个服务是按账户和仓库区分，而不是按路径前缀区分。

### 管理与系统权限 {#administration-permissions}

另外两种权限不是仓库操作。七个管理操作列在[委派](#delegation)下。两个系统权限 `backup.read` 和 `backup.manage` 仅属于管理员和恢复密钥。

## 登录限制 {#sign-in-limits}

服务器在检查任何密码之前会减缓密码猜测。计数器位于每个 API 进程的内存中，并在重启后重新开始。它们按客户端地址生效，IPv6 地址按其 /64 前缀计数。在反向代理后面，请设置 `ARKVORY_TRUSTED_PROXIES`，否则每个客户端都会显示为代理。

| 限制               | 值                                                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 每个地址的登录尝试 | 突发 10 次，然后每 15 秒再增加一次。成功的登录不使用尝试次数。                                                                                                                      |
| 每个账户的失败密码 | 每个错误密码使债务增加 1，债务每 6 秒减少 1。超过 20 时，账户会拒绝尝试 1 秒，每次进一步失败都会加倍，最多 2 分钟；在此期间即使密码正确也会收到 `429`。成功的登录或重置会清除债务。 |
| 每个地址的注册     | 3 次，然后每 20 分钟再增加一次。                                                                                                                                                    |
| 每台服务器的注册   | 20 次，然后每 3 分钟再增加一次。                                                                                                                                                    |
| 进行中的登录请求   | 每个 API 进程 16 个，正文有 10 秒时间到达。更多会返回 `503`，代码为 `busy`。                                                                                                        |

被拒绝的尝试返回 `429`，代码为 `rate_limited`，原因为 `login_attempts`、`registration_attempts` 或 `password_attempts`，并带有以秒为单位的 `Retry-After`。请等待那么久；不要循环重试。更改或重置密码有其自己的闸门和原因 `password_attempts`。所有登录、注册、密码更改和令牌更改都会写入安全审计（`GET /api/v1/security/audit`，仅限管理员），保留 365 天。

## 相关页面 {#related}

- [HTTP API 概览](./index)
- [错误](./errors)
- [账户与访问](../use/accounts)
- [安全](../operate/security)
- [客户端与协议](../protocols/index)
- 参考：[账户与登录](./reference/accounts)、[服务账户与密钥](./reference/services)
