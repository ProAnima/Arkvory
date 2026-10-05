---
title: 客户端与协议
---

# 客户端与协议

Arkvory 只有一套存储和一种访问模型，但有多种访问方式。每一种方式都是某个工具本来就支持的客户端或协议。它们都把数据保存为 Arkvory 制品。因此，无论使用哪一种方式，都适用相同的权限、配额、SHA-256 校验、保留规则、备份和镜像。

本页列出与 Arkvory 交互的所有方式、每种方式的用途，以及它接受的凭据。请据此为任务选择合适的工具。

## 概览 {#overview}

| 方式                  | 地址                                           | 用途                                                                                      | 凭据                                                                                   |
| --------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Web 控制台            | `https://arkvory.example/console/`             | 浏览仓库，在浏览器中上传和下载，管理用户、密钥和备份                                      | 使用用户名和密码登录，或使用服务密钥                                                   |
| `arkvoryctl` 命令行   | `/api/v1`                                      | CI 脚本、可续传的上传和下载、路径文件、晋级、备份                                         | 来自文件或环境变量的密钥（以 Bearer 方式发送）                                         |
| TypeScript SDK        | `/api/v1`                                      | 用 TypeScript 或 JavaScript 编写、运行在 Node.js 或浏览器中的自有工具                     | 来自回调函数的密钥（以 Bearer 方式发送）                                               |
| REST API              | `/api/v1/...`                                  | 使用任意语言的集成                                                                        | 仅支持 `Authorization: Bearer <key>`                                                   |
| 容器镜像注册表（OCI） | `/v2/`                                         | Docker、Podman、Buildx、containerd、Helm chart、ORAS 制品                                 | Basic 认证，以密钥作为密码（`docker login`），或 Bearer                                |
| Git LFS               | `/lfs/<repository>`                            | git 仓库的大文件，用于 Unity 和 Unreal 的文件锁                                           | Basic 认证，以密钥作为密码（git credential helper），或 Bearer                         |
| npm 注册表            | `/npm/<repository>/`                           | Unity Package Manager 的作用域注册表（scoped registries）、`npm publish` 和 `npm install` | Bearer（`.npmrc` 中的 `_authToken`，`.upmconfig.toml` 中的 `token`），或 Basic `_auth` |
| 按路径访问的原始文件  | `/api/v1/repositories/<repository>/raw/<path>` | 使用 `curl -T` 或 PowerShell 的单次请求                                                   | 仅支持 `Authorization: Bearer <key>`                                                   |

`/v2`、`/lfs` 和 `/npm` 下的路由遵循各自协议的规范。它们不属于 `/api/v1` 的 OpenAPI 文档，并且以各自客户端所期望的格式报告错误。

## 凭据 {#credentials}

除公开的健康检查外，每个请求都需要凭据。Arkvory 接受以下几种：

| 类型         | 外观                | 来源                                                                                          | 典型用途                                |
| ------------ | ------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------- |
| 个人访问令牌 | `pat_...`           | 由用户在控制台中创建。范围为 `read` 或 `read-write`。会过期（默认 90 天，最长 365 天）。      | 开发人员：工作站上的 Unity、git、Docker |
| 服务密钥     | `arkvory_...`       | 为服务账户签发，并按仓库精确限定操作，由恢复密钥签发，或由受委派的操作员密钥签发              | CI/CD、部署代理、构建服务器             |
| 文件密钥     | 任意机密字符串      | 服务器密钥文件（`ARKVORY_KEYS_FILE`），按仓库设置 `read` 或 `write`；所有者密钥还具有管理权限 | 安装所有者、旧版集成                    |
| 会话         | `dps_...`           | 控制台登录；有效期 12 小时                                                                    | 在控制台中的交互操作                    |
| 下载链接     | 带 `?token=` 的 URL | 为单个制品创建；有效期 60 秒到 24 小时                                                        | 不提供密钥即可把单个文件交给他人        |

各协议的区别只在于发送密钥的方式：

- `/api/v1`、CLI、SDK 和原始文件使用 `Authorization: Bearer <key>`。
- `/v2`、`/lfs` 和 `/npm` 也接受 HTTP Basic。用户名不会被检查，密码就是 Arkvory 密钥。`docker login`、git credential helper 和 npm 的 `_auth` 就是这样发送凭据的。
- 只读的个人令牌绝不会更改数据。它仍然可以下载 Git LFS 对象，因为下载时的 Git LFS batch 请求也是 `POST`。

如何创建令牌和密钥：[账户与密钥](../use/accounts)。请求头的详细说明：[认证](../api/authentication)。

## 该用哪一种？ {#which-one-should-i-use}

| 任务                                                        | 推荐方式                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| 从 CI 上传构建制品，并在网络故障后续传                      | [`arkvoryctl upload`](./cli) 或 [`arkvoryctl put`](./cli)            |
| 从 CI 发布 UPack 包                                         | [`arkvoryctl packages publish`](./cli)                               |
| 把“最新的 1.4 发布版本”部署到服务器                         | [`arkvoryctl packages download --range ^1.4 --stage release`](./cli) |
| 在不安装任何软件的情况下，从 shell 脚本按路径上传中小型文件 | 使用 `curl -T` 或 PowerShell 的[原始文件](./raw-files)               |
| 存储容器镜像或 Helm chart                                   | [容器镜像](./containers)                                             |
| 把游戏的贴图、模型和关卡保存在 git 主机之外                 | [Git LFS](./git-lfs)                                                 |
| 在项目之间共享 Unity 包                                     | [Unity 与 npm 包](./unity-npm)                                       |
| 构建自己的工具或 Web 界面                                   | [TypeScript SDK](./sdk)                                              |
| 从 Python、Go、C# 或其他语言集成                            | [REST API](../api/index)                                             |
| 浏览、管理用户、密钥和备份                                  | [Web 控制台](../guide/console)                                       |

经验法则：

- **大文件（数十 GB 以上）**：使用 `arkvoryctl` 或 SDK。它们按分片上传，中断后可以继续。单个 `PUT` 请求（原始文件、Git LFS 对象、npm 发布、Docker 层）失败后会从第 0 个字节重新开始。
- **工具本来就支持某个协议**：使用该协议。Docker、git 和 Unity 不需要额外软件。
- **机器只读取**：给它一个只读令牌，或只带读取操作的服务密钥。

## 通用规则 {#shared-rules}

**HTTPS**：每个客户端都应使用 HTTPS。CLI 和 SDK 拒绝明文 HTTP，回环地址（`localhost`、`127.0.0.1`、`[::1]`）除外。Docker 需要受信任的证书。Git 会在每个请求中发送密钥。参见 [HTTPS](../install/https)。

**同一套存储**：镜像层、Git LFS 对象、npm tarball 和原始文件都是制品。它们计入仓库配额和安装容量。存储时会用 SHA-256 校验。它们都包含在备份中。

**读取网关与镜像**：读取网关只接受 `GET` 和 `HEAD`。镜像是仓库在另一个安装实例上的只读副本。

| 方式                | 在读取网关上                  | 在镜像上                                     |
| ------------------- | ----------------------------- | -------------------------------------------- |
| `/api/v1`、CLI、SDK | 仅读取                        | 读取；更改会被拒绝（`409 mirror_read_only`） |
| 容器镜像注册表      | 拉取                          | 拉取；推送会被拒绝                           |
| Git LFS             | 不支持（batch 请求是 `POST`） | 克隆和获取；推送和加锁会被拒绝               |
| npm 注册表          | 安装和搜索                    | 安装和搜索；发布会被拒绝                     |
| 原始文件            | `GET` 和 `HEAD`               | `GET` 和 `HEAD`                              |

参见[读取网关](../operate/read-gateways)和[镜像](../operate/mirrors)。

## 相关页面 {#related-pages}

- [命令行（arkvoryctl）](./cli)
- [TypeScript SDK](./sdk)
- [容器镜像](./containers)
- [Git LFS](./git-lfs)
- [Unity 与 npm 包](./unity-npm)
- [原始文件](./raw-files)
- [API 概览](../api/index)和[错误](../api/errors)
