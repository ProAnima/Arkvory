---
title: Web 控制台
---

# Web 控制台

Web 控制台是 Arkvory 的浏览器界面。它是服务器的一部分，因此无需单独安装。在服务器地址后加上 `/console/` 即可打开，例如在服务器本机上是 `http://127.0.0.1:8080/console/`，设置好 [HTTPS](../install/https) 之后是 `https://arkvory.example/console/`。

控制台使用与[命令行客户端](../protocols/cli)和 [SDK](../protocols/sdk) 相同的 HTTP API。服务器会检查每一个请求。按钮被隐藏，只表示您的账户或密钥无权使用该操作。

## 布局 {#layout}

侧边栏把各个栏目分组。在窄屏幕上，侧边栏会变成 [[ui:navigationMenu]] 按钮。

| 分组                | 栏目                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [[ui:navLibrary]]   | [[ui:catalog]]、[[ui:packages]]、[[ui:history]]、[[ui:metadata]]                                                          |
| [[ui:navTransfers]] | [[ui:upload]]、[[ui:downloads]]                                                                                           |
| [[ui:navResources]] | [[ui:administration]]、[[ui:repositories]]、[[ui:services]]、[[ui:updates]]、[[ui:backups]]、[[ui:navStart]]、[[ui:help]] |

顶部栏显示栏目标题、[[ui:uploadFile]] 按钮、[[ui:reportOpen]] 按钮，以及外观和语言控件。

每个栏目都有自己的地址，例如 `#/catalog`、`#/packages` 或 `#/backups`。打开的制品的地址是 `#/artifact/<repository>/<id>`。您可以收藏这些地址，也可以发给其他人。地址中从不包含密码、密钥或搜索文本。如果在登录之前打开链接，控制台会在您登录之后打开它。

有些栏目只对部分用户显示：

| 栏目                  | 谁能看到                             |
| --------------------- | ------------------------------------ |
| [[ui:administration]] | 管理员                               |
| [[ui:repositories]]   | 所有已登录的用户                     |
| [[ui:services]]       | 恢复密钥，以及获得委派权限的运维密钥 |
| [[ui:updates]]        | 管理员                               |
| [[ui:backups]]        | 管理员和恢复密钥                     |

## 登录 {#signing-in}

[[ui:connection]] 卡片位于页面顶部。

1. 输入您的 [[ui:accountName]] 和 [[ui:password]]。
2. 选择 [[ui:signIn]]。会话持续 12 小时。
3. 控制台会选择您有权读取的第一个 [[ui:repository]]。若要在其他仓库中工作，请输入其名称，或从列表中选取。

若要用密钥代替密码连接，请打开 [[ui:keySignIn]]，粘贴密钥并选择 [[ui:connect]]。密钥只保留在此浏览器标签页的内存中，控制台绝不会保存它。

[[ui:signUp]] 仅在管理员允许自助注册时显示。[[ui:disconnect]] 会结束连接。

使用密码登录后，可以使用 [[ui:changeOwnPassword]] 和 [[ui:personalAccessTokens]]。个人访问令牌是用于您自己的工具的密钥。参见[账户与访问](../use/accounts)。

### 第一个所有者 {#the-first-owner}

全新安装没有任何账户。在 Windows 上，安装程序会创建所有者。在其他安装中，请在控制台中创建所有者：

1. 打开 [[ui:navStart]] 并展开 [[ui:welcomeOwner]]。
2. 粘贴安装目录中 `config/bootstrap-token.txt` 里的恢复密钥。
3. 输入名称和至少 12 个字符的密码，然后选择 [[ui:welcomeCreate]]。
4. 用新的名称和密码登录。

该表单仅在尚无任何账户时有效。所有者是管理员，并通过 `arkvory-owners` 组获得对 `releases` 仓库的写入权限。

## 库 {#library}

### 制品 {#artifacts}

[[ui:catalog]] 列出仓库中已发布的文件。可以按名称或元数据值搜索。使用 [[ui:labelFilter]] 只显示某一个标签，使用 [[ui:metadataFilter]] 按确切的键和值筛选。每一行显示名称、大小、发布时间、阶段和标签。选择 [[ui:download]] 下载文件，或选择 [[ui:open]] 查看其详细信息。[[ui:more]] 显示下一页。

### 包 {#packages}

[[ui:packages]] 列出已注册的 UPack 版本。按 [[ui:packageGroup]] 和 [[ui:packageName]] 筛选，设置 [[ui:sortBy]] 和 [[ui:groupBy]]，然后选择 [[ui:apply]]。阶段列显示每个版本晋级到了哪些阶段。参见[包](../use/packages)。

### 文件历史 {#file-history}

一个文件路径（例如 `builds/game/1.4/GameSetup.exe`）可以多次指向新的内容。每次变更都是一个新版本。在 [[ui:history]] 中输入路径并选择 [[ui:historyLoad]]，即可看到每个版本及其作者和时间。可以打开任意版本来下载它的原始内容。恢复旧版本会创建一个新版本，不会删除任何内容。参见[文件与路径](../use/files)。

### 制品详情 {#artifact-details}

[[ui:metadata]] 显示单个制品的信息：

- **概要**：[[ui:summarySize]]、[[ui:summaryCreated]] 和 [[ui:summaryHash]]，并带有 [[ui:copyHash]] 按钮。
- **属性**：[[ui:labels]]、[[ui:collections]] 和 [[ui:metadataFields]]。选择 [[ui:save]] 保存它们。文件本身不会改变。
- **操作**：[[ui:download]]；[[ui:downloadLink]] 会创建一个无需密钥、一小时内有效的链接；[[ui:register]] 会为 UPack 归档建立索引。
- [[ui:assetTitle]]：[[ui:assign]] 会把此制品设为某个文件路径的当前内容。
- [[ui:promotionTitle]]：[[ui:stageAdd]] 会给制品标记一个阶段，例如 `qa` 或 `release`。[[ui:promoteSubmit]] 会把它发布到另一个仓库。参见[晋级](../use/promotion)。
- [[ui:attachmentsTitle]]：[[ui:attachmentAdd]] 会把清单、SBOM、签名、报告或其他文件关联到此构建。[[ui:attachmentHistory]] 显示之前的几组附件。
- [[ui:deletionTitle]]：[[ui:deletionInspect]] 显示仍在使用该制品的内容。若要删除，请粘贴制品 ID 并选择 [[ui:deletionSubmit]]。删除需要带有 `artifact.delete` 操作的服务密钥；密码登录、个人令牌和恢复密钥都不能删除。

## 传输 {#transfers}

### 上传 {#upload}

在 [[ui:upload]] 中选择文件，然后选择 [[ui:startUpload]]。控制台先计算文件的 SHA-256，然后按分片发送。[[ui:pause]] 会停止传输，并保留已上传的分片。

若要稍后继续，请记住上传 ID。打开 [[ui:resumeTitle]]，选择同一个文件并输入 [[ui:uploadId]]。上传期间离开页面之前，浏览器会发出警告。参见[传输](../use/transfers)。

### 下载 {#downloads}

[[ui:downloads]] 是您从控制台下载的文件队列。控制台在保存最终文件之前，会检查每个文件的 SHA-256。

- [[ui:downloadSettings]] 用于设置 [[ui:downloadConcurrency]]（1 到 8）、[[ui:downloadInterval]] 和 [[ui:downloadWait]]。
- [[ui:downloadsPause]]、[[ui:downloadsResume]]、[[ui:downloadsClearWaiting]]、[[ui:downloadsCancel]] 和 [[ui:downloadsClearFinished]] 用于控制整个队列。
- 页面重新加载后，请重新登录并选择 [[ui:downloadRestore]]。然后逐个继续每个文件，并选择保存位置。

大文件下载需要在安全地址（HTTPS 或本机）上使用 Chrome 或 Edge。临时数据保存在浏览器的私有存储中。

## 资源 {#resources}

### 用户与访问 {#users-and-access}

管理员在这里管理人员。[[ui:accountsHeading]] 列出账户，[[ui:groupsHeading]] 列出组。可使用 [[ui:createUser]]、[[ui:resetPassword]]、[[ui:createGroup]] 和 [[ui:manageMembers]]。在 [[ui:manageGrants]] 中，按名称为组授予对某个仓库的 [[ui:read]] 或 [[ui:write]] 访问权限。仓库没有单独的创建步骤：只要有授权或服务策略提到某个仓库名称，它就存在了。

### 仓库 {#repositories}

[[ui:repositories]] 显示您能看到的仓库，以及 [[ui:repositoryRights]]。每张卡片上有 [[ui:repositoryOpen]]、[[ui:repositoryStorage]]（配额、自动清理和物理清理；需要带有 `storage.read` 或 `storage.manage` 操作的服务密钥），管理员还能看到 [[ui:repositoryAccess]]。镜像仓库会显示 [[ui:mirrorBadge]] 徽标。参见[仓库](../use/repositories)和[存储](../operate/storage)。

### 服务访问 {#service-access}

在这里为工具和 CI 系统创建账户。要看到此栏目，请使用恢复密钥或运维密钥连接。选择 [[ui:serviceCreate]]，然后设置 [[ui:servicePolicy]]。[[ui:bindingRead]] 和 [[ui:bindingPublish]] 会填入常用的权限组合。

若要签发密钥，请打开 [[ui:serviceKeys]] 并选择 [[ui:keyIssue]]。机密只显示一次。复制它，勾选 [[ui:keySaved]]，然后选择 [[ui:keyActivate]]。未激活的密钥会在 15 分钟后过期。使用 [[ui:keyRotate]] 替换密钥，使用 [[ui:keyRevoke]] 停用密钥。[[ui:delegations]] 允许所有者向运维人员授予有限的管理权限。

### 更新 {#updates}

[[ui:updates]] 显示 [[ui:updateCurrent]] 和 [[ui:updateLatest]]。选择 [[ui:updateCheck]] 或 [[ui:updateInstall]]。在 [[ui:updateSettings]] 中，打开 [[ui:updateAutomatic]]，并选择 [[ui:updateHour]]。参见[更新](../install/updates)。

### 备份 {#backups}

[[ui:backups]] 显示备份是否正常、最新的备份、下次运行时间、备份代理和备份存储。选择 [[ui:backupRun]] 启动备份。[[ui:backupPoints]] 列出恢复点；可以逐字节验证某个恢复点，也可以固定它。[[ui:backupPlan]] 设置每日时间、时区和保留多少个恢复点。恢复是在服务器上执行的命令。参见[备份](../operate/backups)。

### 入门与 API 参考 {#getting-started-and-api-reference}

[[ui:navStart]] 显示新服务器的第一步操作。[[ui:help]] 列出示例命令。[[ui:helpLoad]] 显示您当前的账户或密钥可以调用的 API 操作。

## 反馈 {#feedback}

登录后，[[ui:reportOpen]] 会通过中心（hub）向 ProAnimaStudio 发送消息。可以添加最多 6 张图片和一个用于回复的电子邮件地址。管理员可以附上服务器日志。选择 [[ui:reportShow]] 可以确切看到发送了哪些内容。

## 外观与语言 {#appearance-and-language}

[[ui:theme]] 有三个选项：[[ui:system]]、[[ui:light]] 和 [[ui:dark]]。[[ui:language]] 以各自的名称列出控制台的所有语言：English、Русский、Español、Français、Deutsch、Português、中文、日本語、한국어、हिन्दी 和 العربية。页面会立即切换，无需重新加载，也不会丢失您已输入的内容；阿拉伯语从右向左显示。首次访问时，控制台会遵循浏览器的首选语言，若无匹配则回退到英语。[[ui:help]] 中的 [[ui:helpDocs]] 会用控制台当前的语言打开本文档。浏览器只保存主题和语言，不保存任何关于您的账户或仓库的信息。

## 相关页面 {#related-pages}

- [快速入门](./quick-start)
- [概念](./concepts)
- [账户与访问](../use/accounts)
- [故障排查](../operate/troubleshooting)
