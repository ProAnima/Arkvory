---
title: 账户与访问
description: '创建用户和组，授予它们对仓库的访问权限，并为 CI 签发个人令牌和服务密钥。'
---

# 账户与访问

Arkvory 识别四种凭据。人使用密码登录。他们自己的工具使用个人访问令牌。CI 系统和部署代理使用服务密钥。安装程序还会多创建一个密钥，即恢复密钥，用于初始设置和应急情况。服务器会根据每个请求所携带的凭据来检查该请求。

## 谁可以做什么 {#overview}

| 凭据         | 创建者                     | 有效期                  | 管理                           | 仓库访问                         |
| ------------ | -------------------------- | ----------------------- | ------------------------------ | -------------------------------- |
| 密码会话     | 登录                       | 12 小时                 | 用户和组，前提是该账户是管理员 | 通过组按仓库读取或写入           |
| 个人访问令牌 | 您本人，通过密码会话       | 默认 90 天，最长 365 天 | 从不                           | 您所属的组，可选只读             |
| 服务密钥     | 恢复密钥或获得委派的操作员 | 默认 90 天，最长 365 天 | 仅限所有者委派的内容           | 服务账户策略，并由密钥进一步收窄 |
| 恢复密钥     | 安装程序                   | 直到您替换它为止        | 用户、组、服务账户、备份       | 对 `releases` 的读取和写入       |

有三点容易被忽略：

- 管理员账户管理用户和组。它不授予对文件的访问权限。只有通过组授权才能访问文件。
- 服务密钥由恢复密钥或操作员密钥创建，而不是由密码会话创建。使用密码登录的管理员无法创建服务账户。
- 个人令牌或服务密钥绝不能创建用户、组或其他令牌。

## 所有者与恢复密钥 {#owner}

第一个账户是所有者。它是一个管理员账户。Windows 安装向导会创建它。在 Linux 和 Docker 上，您使用恢复密钥在控制台中创建它，如 [Web 控制台](../guide/console#the-first-owner)所述。

所有者是组 `arkvory-owners` 的成员，该组对仓库 `releases` 具有写入权限。对于任何其他仓库，请自行授予组访问权限。参见[组与仓库访问](#groups)。

恢复密钥是安装目录中的文件 `config/bootstrap-token.txt`。只有服务器的管理员才能读取它。不要将它复制到 CI 或客户端计算机。安装和更新工具会读取它，因此不要删除它。参见[安全性](../operate/security)。

## 创建用户 {#users}

只有管理员可以创建用户。名称由 3 到 64 个字母、数字、`.`、`_` 或 `-` 组成。密码包含 12 到 128 个字符。一个安装实例最多容纳 1000 个账户。

在控制台中：

1. 以管理员身份登录，并打开 [[ui:administration]]。
2. 展开 [[ui:createUser]]。
3. 输入 [[ui:accountName]] 和 [[ui:password]]。仅为管理用户的人勾选 [[ui:administrator]]。
4. 选择 [[ui:createUser]]。

表格 [[ui:accountsHeading]] 列出各个账户。[[ui:disableUser]] 会阻止某个账户：其会话立即结束，个人令牌停止工作，直到您选择 [[ui:enableUser]]。要为某人设置新密码，请展开 [[ui:resetPassword]]。这会结束该账户的会话并撤销其所有个人令牌。

使用 API 时，管理员会话或恢复密钥可以调用以下操作：`createUser`、`updateUser` 和 `listUsers`。

```bash
curl -X POST "$ARKVORY/api/v1/users" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"anna","password":"a long password here","administrator":false}'
```

```typescript
await client.administration.users.create('anna', 'a long password here', false);
```

`arkvoryctl` 没有用于账户的命令。请使用控制台或 API。

默认情况下关闭自主注册。服务器管理员使用 `ARKVORY_ALLOW_REGISTRATION=true` 将其开启（参见[环境变量](../reference/environment)）。之后登录卡片上会出现 [[ui:signUp]]。在管理员将新账户添加到组之前，新账户无法访问任何仓库。自主注册在达到 900 个账户时停止，从而为管理员保留 100 个位置。

## 组与仓库访问 {#groups}

人们通过组获得访问权限。一个组有成员，并且对每个仓库有一个访问级别：

| 控制台中的级别 | 含义                                                   |
| -------------- | ------------------------------------------------------ |
| [[ui:read]]    | 查看和下载                                             |
| [[ui:write]]   | 读取的全部权限，以及上传、发布、更改元数据、晋级和恢复 |

仓库没有单独的创建步骤。只要某个授权或服务策略提及它，它就存在。名称使用小写拉丁字母、数字、`-` 和 `_`，以字母或数字开头，最多 64 个字符。参见[仓库](./repositories)。

在控制台中，打开 [[ui:administration]]：

1. 展开 [[ui:createGroup]]，输入 [[ui:accessGroup]] 名称（2 到 64 个字母、数字、`.`、`_` 或 `-`），然后选择 [[ui:createGroup]]。
2. 展开 [[ui:manageMembers]]，选择组和账户，然后选择 [[ui:addMember]]。[[ui:removeMember]] 会将账户从组中移除。
3. 展开 [[ui:manageGrants]]，选择组，输入 [[ui:repository]] 名称，选择 [[ui:access]] 级别，然后选择 [[ui:saveGrant]]。[[ui:removeGrant]] 会撤销访问权限。

表单下方的表格显示每个组的 [[ui:members]] 和 [[ui:grants]]。移除成员或授权会在该账户的下一个请求时生效。文件保持原样。

一个安装实例最多容纳 100 个组、10 000 个成员关系和总计 10 000 个授权。

使用 API 时，操作为 `createAccessGroup`、`addGroupMember`、`removeGroupMember`、`setGroupGrant` 和 `removeGroupGrant`：

```bash
curl -X PUT "$ARKVORY/api/v1/access-groups/$GROUP_ID/grants/builds" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"access":"write"}'
```

```typescript
await client.administration.groups.setGrant(groupId, 'builds', 'write');
```

## 权限 {#permissions}

在读取和写入这两个级别背后，有 24 个仓库操作。服务密钥会逐一列出这些操作。`arkvoryctl doctor` 和 `GET /api/v1/auth/permissions` 会按仓库显示当前凭据所拥有的操作。

| 操作               | 控制台标签                         | 允许的内容                                 |
| ------------------ | ---------------------------------- | ------------------------------------------ |
| `repository.read`  | [[ui:permission.repository.read]]  | 列出仓库并查看您自己的权限。无法访问文件。 |
| `artifact.list`    | [[ui:permission.artifact.list]]    | 列出和搜索制品、读取阶段列表和晋级日志     |
| `artifact.read`    | [[ui:permission.artifact.read]]    | 单个制品的详细信息、阶段和晋级历史记录     |
| `content.read`     | [[ui:permission.content.read]]     | 下载字节、创建下载链接、解析用于下载的包   |
| `upload.create`    | [[ui:permission.upload.create]]    | 开始上传                                   |
| `upload.read`      | [[ui:permission.upload.read]]      | 读取您自己上传的状态和分片                 |
| `upload.write`     | [[ui:permission.upload.write]]     | 发送您自己上传的字节                       |
| `upload.complete`  | [[ui:permission.upload.complete]]  | 完成您自己的上传、启动完成作业             |
| `upload.cancel`    | [[ui:permission.upload.cancel]]    | 取消您自己的上传                           |
| `job.read`         | [[ui:permission.job.read]]         | 读取您自己的完成作业                       |
| `package.read`     | [[ui:permission.package.read]]     | 列出 UPack 包并解析版本                    |
| `package.publish`  | [[ui:permission.package.publish]]  | 将已上传的归档注册为包                     |
| `asset.read`       | [[ui:permission.asset.read]]       | 读取文件路径、它们的历史记录和修订版本     |
| `asset.write`      | [[ui:permission.asset.write]]      | 使某个制品成为路径的当前内容               |
| `asset.restore`    | [[ui:permission.asset.restore]]    | 恢复路径的较早修订版本                     |
| `annotation.read`  | [[ui:permission.annotation.read]]  | 读取标签、元数据、集合和附件               |
| `annotation.write` | [[ui:permission.annotation.write]] | 更改标签、元数据、集合和附件               |
| `artifact.promote` | [[ui:permission.artifact.promote]] | 添加和移除阶段、晋级到仓库中               |
| `reference.write`  | [[ui:permission.reference.write]]  | 在制品上添加和移除您自己的外部引用         |
| `audit.read`       | [[ui:permission.audit.read]]       | 读取仓库的目录审计                         |
| `artifact.delete`  | [[ui:permission.artifact.delete]]  | 检查和删除制品、预览并应用保留规则         |
| `storage.read`     | [[ui:permission.storage.read]]     | 读取存储策略、用量和物理清理设置           |
| `storage.manage`   | [[ui:permission.storage.manage]]   | 更改存储策略和物理清理设置并运行它们       |
| `diagnostics.read` | [[ui:permission.diagnostics.read]] | 读取存储事件                               |

组的级别如何映射到操作：

- **读取**授予 `repository.read`、`artifact.list`、`artifact.read`、`content.read`、`package.read`、`asset.read` 和 `annotation.read`。
- **写入**授予读取的全部内容，以及 `upload.create`、`upload.read`、`upload.write`、`upload.complete`、`upload.cancel`、`job.read`、`package.publish`、`asset.write`、`asset.restore`、`annotation.write`、`artifact.promote`、`reference.write` 和 `audit.read`。
- **没有任何组级别会授予** `artifact.delete`、`storage.read`、`storage.manage` 和 `diagnostics.read`。删除制品和管理存储属于明确列出这些操作的服务密钥。参见[存储与保留](../operate/storage)。

镜像 是另一个仓库的只读副本（[镜像](../operate/mirrors)）。无论授权如何，任何更改它的操作都会被拒绝并返回 `409 mirror_read_only`。

## 密码与会话 {#passwords}

在 [[ui:connection]] 卡片中使用 [[ui:accountName]] 和 [[ui:password]] 登录。会话持续 12 小时。[[ui:disconnect]] 会结束会话。

要更改您自己的密码，请使用同一卡片中的 [[ui:changeOwnPassword]]。输入 [[ui:currentPassword]] 和 [[ui:newPassword]]。您的所有会话和个人令牌都会结束，因此您需要重新登录并创建新令牌。管理员可以在不知道旧密码的情况下重置另一个账户的密码。

服务器会减缓猜测：

- 一个网络地址可以突发尝试 10 次登录，之后每 15 秒再尝试一次。
- 某个账户在多次输入错误密码后，等待时间会越来越长，最多 2 分钟。在此期间，即使是正确的密码也会被拒绝。响应为带 `Retry-After` 的 `429 rate_limited`。
- 在反向代理之后，管理员会在 `ARKVORY_TRUSTED_PROXIES` 中列出该代理。否则所有人共用一个地址。

使用 API 时，`login` 会用名称和密码换取 bearer 会话，`changeOwnPassword` 则更改密码：

```bash
curl -X POST "$ARKVORY/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"name":"anna","password":"a long password here"}'
```

## 个人访问令牌 {#tokens}

个人访问令牌是用于您自己工具的密钥：您计算机上的脚本、`arkvoryctl` 或 SDK。它以您的身份行动，并可访问您所属组的仓库。

只有密码会话可以创建令牌。令牌不能创建另一个令牌，也没有管理员权限。

1. 使用您的密码登录。
2. 在 [[ui:connection]] 卡片中，展开 [[ui:personalAccessTokens]]。
3. 输入 [[ui:tokenName]]。选择 [[ui:tokenExpiry]]：[[ui:tokenDays30]]、[[ui:tokenDays90]] 或 [[ui:tokenDays365]]。
4. 选择 [[ui:tokenScope]]：[[ui:tokenScopeRead]] 或 [[ui:tokenScopeReadWrite]]。只读令牌会以 `403 read_only_token` 拒绝任何更改。
5. 选择 [[ui:generateToken]]，然后选择 [[ui:copyToken]]。令牌只显示一次。它以 `pat_` 开头。

表格显示每个令牌的 [[ui:tokenPrefix]]、[[ui:tokenCreated]]、[[ui:tokenExpires]]、[[ui:tokenLastUsed]] 和 [[ui:tokenStatus]]：[[ui:tokenActive]]、[[ui:tokenExpired]] 或 [[ui:tokenRevokedState]]。要停止某个令牌，请选择 [[ui:revokeToken]] 并使用 [[ui:tokenRevokeConfirmSubmit]] 确认。使用该令牌的客户端会立即失去访问权限。

一个账户最多可以拥有 50 个活动令牌。管理员可以使用 `listAccountTokens` 和 `revokeAccountToken` 列出并撤销任何账户的令牌。

使用 API 时，令牌有一个名称，以及可选的到期时间（自当前时间起最多 365 天）和作用域：

```bash
curl -X POST "$ARKVORY/api/v1/auth/tokens" \
  -H "Authorization: Bearer $SESSION" \
  -H "Content-Type: application/json" \
  -d '{"name":"laptop","scope":"read-write","expiresAt":"2027-01-31T00:00:00Z"}'
```

```typescript
const created = await client.identity.createToken('laptop', { scope: 'read-write' });
console.log(created.token); // shown once
```

API 的默认作用域是 `read-write`。控制台会预先选择 [[ui:tokenScopeRead]]。

通过私有文件将令牌提供给 `arkvoryctl`。参见[命令行](../protocols/cli#connect-to-a-server)。

## 用于 CI 的服务账户和密钥 {#service-accounts}

服务账户是工具的身份，而不是人的身份。它有一个**策略**：它可以使用的仓库和操作。服务账户拥有密钥。密钥也有自己的仓库和操作列表。实际权限是两个列表逐项操作的交集。空策略不授予对文件的访问权限。

您可以使用恢复密钥，或所有者为其委派了权限的操作员密钥来管理服务访问。在控制台中：

1. 如果您已登录，请选择 [[ui:disconnect]]。然后打开 [[ui:keySignIn]]，将恢复密钥粘贴到 [[ui:serviceKey]] 中，并选择 [[ui:connect]]。
2. 打开 [[ui:services]]。该区域仅对恢复密钥和操作员密钥显示。

### 创建账户及其策略 {#service-policy}

1. 在 [[ui:services]] 中，展开 [[ui:serviceCreate]]。
2. 输入 [[ui:serviceName]]（3 到 64 个字母、数字、`.`、`_` 或 `-`）。
3. 在 [[ui:servicePolicy]] 下选择 [[ui:bindingAdd]]，并输入 [[ui:repository]] 名称。
4. 填写权限：[[ui:bindingRead]] 和 [[ui:bindingPublish]] 设置典型集合，[[ui:bindingNone]] 清除它们，[[ui:bindingPermissions]] 列出每个操作。选择 [[ui:bindingRemove]] 可移除仓库。
5. 选择 [[ui:serviceCreate]]。

两个预设是：

| 预设                  | 操作                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [[ui:bindingRead]]    | `repository.read`, `artifact.read`, `artifact.list`, `content.read`, `package.read`, `asset.read`, `annotation.read`                                                |
| [[ui:bindingPublish]] | 读取集合，以及 `upload.create`, `upload.read`, `upload.write`, `upload.complete`, `upload.cancel`, `job.read`, `package.publish`, `asset.write`, `annotation.write` |

两个预设都不包含晋级、恢复或删除。为晋级作业添加 `artifact.promote`。只下载的部署代理在 `arkvoryctl` 中需要读取集合。对于按名称进行的普通 HTTP 包下载，仅 `content.read` 就足够了。

一个策略最多包含 64 个仓库，一个安装实例最多包含 1000 个服务账户。已保存的策略有一个版本。如果在此期间有人更改了它，控制台会显示冲突并保留您的草稿：选择 [[ui:serviceRefresh]] 并再次应用您的更改。[[ui:serviceDisable]] 会阻止该账户的所有密钥。已在进行的传输可以完成。

### 签发、保存并激活密钥 {#service-key-issue}

1. 打开该账户及其 [[ui:serviceKeys]]。
2. 展开 [[ui:keyIssue]]。输入 [[ui:keyName]]。在 [[ui:keyExpiry]] 中设置到期时间，或将其留空以使用 90 天。最长的到期时间为 365 天。
3. 如果密钥需要的权限少于账户，请收窄权限。选择 [[ui:keyIssue]]。
4. 窗口 [[ui:keySecret]] 会显示一次机密。选择 [[ui:keyCopy]] 并将其存储到您的 CI 机密存储中。机密以 `arkvory_` 开头。
5. 勾选 [[ui:keySaved]] 并选择 [[ui:keyActivate]]。

未激活的密钥没有用处，并会在 15 分钟后过期。在您激活它之前，它会显示为 [[ui:keyPending]]。一个账户一次最多可以拥有 3 个活动密钥和 2 个待处理密钥。状态有 [[ui:keyPending]]、[[ui:keyActive]]、[[ui:keyRevoked]] 和 [[ui:keyExpired]]；[[ui:keyDetails]] 列出密钥的 id 和权限。

如果在您复制机密之前响应丢失，服务器无法再次显示它。请撤销该密钥并重新签发。

使用 API 时，恢复密钥先创建账户，然后签发密钥。标头 `Idempotency-Key`（1 到 128 个字母、数字、`.`、`_`、`:` 或 `-`）使重复请求安全，但重复请求不会返回机密。密钥在调用 `activateServiceKey` 时会自行激活：

```bash
curl -X POST "$ARKVORY/api/v1/service-accounts" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" \
  -d '{"name":"ci-prod","bindings":[{"resource":{"kind":"repository","id":"releases"},"actions":["repository.read","artifact.read","artifact.list","content.read","package.read","upload.create","upload.read","upload.write","upload.complete","job.read","package.publish","asset.read","asset.write"]}]}'

curl -X POST "$ARKVORY/api/v1/service-accounts/$ACCOUNT_ID/keys" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: ci-prod-2026-10" \
  -d '{"name":"pipeline-2026","bindings":[{"resource":{"kind":"repository","id":"releases"},"actions":["content.read","package.read","artifact.read"]}]}'

curl -X POST "$ARKVORY/api/v1/auth/activate-key" -H "Authorization: Bearer $NEW_SECRET"
```

SDK 中的相同步骤：

```typescript
const account = await root.administration.services.create('ci-prod', bindings);
const issued = await root.administration.credentials.issue(account.id, requestId, {
  name: 'pipeline-2026',
  bindings,
});
if (!issued.secret) throw new Error('Lost response: revoke the key and issue another');
await saveToSecretStore(issued.secret);
await new ArkvoryClient(url, () => issued.secret ?? '').identity.activateKey();
```

将已激活的密钥通过 `ARKVORY_TOKEN_FILE` 或 `ARKVORY_TOKEN` 提供给作业。参见 [CI 示例](../protocols/cli#ci-example)。

### 轮换与撤销 {#service-key-rotate}

在密钥过期之前轮换它，且不出现空档：

1. 在密钥旁选择 [[ui:keyRotate]]。表单中会填入旧密钥的权限。您只能保留或减少这些权限。
2. 签发新密钥，保存其机密并激活它。
3. 将您的作业切换到新机密。
4. 在旧密钥上选择 [[ui:keyRevoke]]。

激活新密钥会将旧密钥的有效期限制在最多再 24 小时，因此被遗忘的旧密钥不会继续有效。撤销是永久性的，并要求输入密钥名称。使用该密钥的新请求会立即被拒绝。已在进行的传输可以完成。使用 API 时，操作为 `rotateServiceKey` 和 `revokeServiceKey`。

账户上的 [[ui:serviceAudit]] 会显示谁在何时签发、激活、轮换和撤销了密钥。它不保留机密。服务器保留所有账户最近 100 000 个事件。

### 委派管理 {#delegation}

日常操作中不要使用恢复密钥。所有者可以将部分服务管理交给**操作员密钥**，并将恢复密钥离线保存。

1. 使用恢复密钥为操作员创建一个空策略的服务账户，并为其签发并激活一个密钥。
2. 打开该账户的 [[ui:serviceKeys]]，并在密钥上选择 [[ui:delegations]]。
3. 展开 [[ui:delegationNew]]。输入 [[ui:delegationTarget]]，即操作员将管理的账户。
4. 勾选 [[ui:delegationActions]] 并设置 [[ui:delegationCeiling]]，即操作员在仓库中最多可以授予的范围。
5. 选择 [[ui:delegationSave]]。

这七个操作是：

| 操作                     | 控制台标签                               | 操作员可以             |
| ------------------------ | ---------------------------------------- | ---------------------- |
| `service-account.read`   | [[ui:permission.service-account.read]]   | 查看账户               |
| `service-account.manage` | [[ui:permission.service-account.manage]] | 启用和禁用它           |
| `policy.read`            | [[ui:permission.policy.read]]            | 读取其策略             |
| `policy.manage`          | [[ui:permission.policy.manage]]          | 替换其策略             |
| `credential.read`        | [[ui:permission.credential.read]]        | 列出其密钥             |
| `credential.manage`      | [[ui:permission.credential.manage]]      | 签发、轮换和撤销其密钥 |
| `service-audit.read`     | [[ui:permission.service-audit.read]]     | 读取其活动日志         |

规则：

- 操作员设置的所有内容都必须在上限之内。它签发的密钥到期时间不得晚于它自己的密钥。
- 操作员可以为目标账户签发密钥，因此请将委派视为对上限所允许的一切的信任。
- 操作员不能管理自己的账户，也不能进一步委派。一个账户不能同时是目标和操作员。
- 使用 [[ui:delegationRemove]] 移除委派不会撤销操作员已激活的密钥。请自行撤销它们。
- 操作员在 [[ui:delegationOwn]] 中查看自己的委派任务。

只有恢复密钥可以设置委派。操作为 `listServiceDelegations`、`setServiceDelegation` 和 `removeServiceDelegation`。

## 审计 {#audit}

管理员可以读取安装实例的安全日志：登录与失败、注册、密码更改和重置、用户、组和授权更改，以及令牌创建和撤销。每条记录包含时间、操作者、凭据类型、客户端地址、目标和结果（`success`、`failure` 或 `denied`）。它不包含密码或机密。服务器保留记录 365 天或 1 000 000 条，以先到者为准。

控制台没有用于此日志的界面。请使用管理员会话或恢复密钥通过 API 读取它。每页默认 50 条记录，最多 100 条，最新的在前。将 `next` 作为 `after` 传入以获取下一页。

```bash
curl -H "Authorization: Bearer $ADMIN_KEY" "$ARKVORY/api/v1/security/audit?limit=20"
```

```typescript
const page = await client.administration.security.audit({ limit: 20 });
```

服务账户的活动日志是独立的。参见[签发、保存并激活密钥](#service-key-issue)。

## 如果所有者被锁定在外 {#recovery}

当没有人能以管理员身份登录时，请使用恢复密钥：

1. 在服务器上读取密钥：安装目录中的 `config/bootstrap-token.txt`。只有服务器管理员才能这样做。
2. 在控制台中打开 [[ui:keySignIn]]，将密钥粘贴到 [[ui:serviceKey]] 中并选择 [[ui:connect]]。
3. 打开 [[ui:administration]]。展开 [[ui:resetPassword]]，选择账户，输入 [[ui:newPassword]] 并选择 [[ui:resetPassword]]。如果账户显示为已禁用，请选择 [[ui:enableUser]]。
4. 使用新密码登录。

您也可以使用 [[ui:createUser]] 创建新的管理员，并勾选 [[ui:administrator]]。

表单 [[ui:welcomeOwner]] 仅在安装实例没有任何账户时可用。之后，请使用恢复密钥修复账户，而不是从头开始。

如果恢复密钥本身丢失，服务器管理员会替换 `config/keys.json` 中该密钥的 SHA-256 并重启 API。参见[安全性](../operate/security)。

## 相关页面 {#related-pages}

- [Web 控制台](../guide/console)
- [仓库](./repositories)
- [命令行（arkvoryctl）](../protocols/cli)
- [身份验证](../api/authentication) 和 API 参考：[账户与登录](../api/reference/accounts)、[服务账户和密钥](../api/reference/services)
- [安全性](../operate/security)
