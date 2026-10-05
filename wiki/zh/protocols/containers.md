---
title: 容器镜像
description: 通过每个仓库在 /v2 下提供的注册表，推送和拉取 Docker 与 OCI 镜像、Helm chart 和 ORAS 制品。
---

# 容器镜像

每个 Arkvory 仓库同时也是一个容器镜像注册表（registry）。Docker、Podman、Buildx、containerd、Helm 和 ORAS 使用 OCI Distribution 协议向它推送内容并从中拉取内容。镜像层（layer）和 manifest 作为普通制品存储。仓库权限、配额、SHA-256 校验、备份和仓库镜像对它们的适用方式，与其他任何文件相同。

## 开始之前 {#before-you-start}

您需要：

- 带 HTTPS 和受信任证书的服务器地址，例如 `arkvory.example`。参见 [HTTPS](../install/https)。
- 一个仓库，例如 `releases`。
- 一个密钥：个人访问令牌或服务密钥。参见[账户与密钥](../use/accounts)。

注册表在主机根路径下的 `/v2/` 响应。它无法在路径前缀（例如 `https://example.com/arkvory/`）下工作，因为 Docker 不支持路径前缀。反向代理必须原样转发 `/v2/`，并且不得缓冲请求体。在 nginx 中，请设置 `client_max_body_size 0` 并关闭请求缓冲。

## 镜像名称 {#image-names}

镜像引用的格式如下：

```text
<host>/<repository>/<image>:<tag>
<host>/<repository>/<image>@sha256:<digest>
```

第一个路径段是 Arkvory 仓库。它是访问边界：密钥只能看到被授予访问权限的仓库。其余部分是镜像名称，由一个或多个组成部分构成。

| 引用                                        | 仓库       | 镜像            | 引用部分       |
| ------------------------------------------- | ---------- | --------------- | -------------- |
| `arkvory.example/releases/web:1.4`          | `releases` | `web`           | 镜像标签 `1.4` |
| `arkvory.example/releases/team/web:1.4`     | `releases` | `team/web`      | 镜像标签 `1.4` |
| `arkvory.example/qa/tools/builder@sha256:…` | `qa`       | `tools/builder` | 摘要           |

| 部分            | 规则                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| 仓库            | 小写字母、数字、`_` 和 `-`。以字母或数字开头。最多 64 个字符。                                                 |
| 镜像            | 由 `/` 分隔的组成部分。每个组成部分由小写字母和数字构成，用 `.`、`_`、`__` 或短横线连接。总计最多 200 个字符。 |
| 镜像标签（tag） | 字母、数字、`_`、`.` 和 `-`。以字母、数字或 `_` 开头。最多 128 个字符。                                        |
| 摘要（digest）  | `sha256:` 加 64 位小写十六进制数字。其他算法会被拒绝。                                                         |

没有镜像部分的引用（例如 `arkvory.example/web:1.4`）会被 `NAME_INVALID` 拒绝：`web` 会被当作仓库，镜像名称为空。

## 登录 {#log-in}

注册表把 Arkvory 密钥当作 HTTP Basic 认证的密码。用户名不会被检查：可以使用任意名称，例如 CI 作业的名称。请求也可以用 `Authorization: Bearer <key>` 发送密钥。不需要单独的令牌服务。

```bash
docker login arkvory.example -u ci --password-stdin < ~/.arkvory/key
```

```powershell
Get-Content C:\Private\arkvory.key | docker login arkvory.example -u ci --password-stdin
```

其他客户端的登录方式相同：

```bash
podman login arkvory.example -u ci --password-stdin < ~/.arkvory/key
helm registry login arkvory.example -u ci --password-stdin < ~/.arkvory/key
oras login arkvory.example -u ci --password-stdin < ~/.arkvory/key
```

| 密钥                            | 用途                                               |
| ------------------------------- | -------------------------------------------------- |
| 个人访问令牌，范围 `read`       | 在工作站上拉取                                     |
| 个人访问令牌，范围 `read-write` | 在工作站上推送                                     |
| 服务密钥                        | CI/CD 和部署代理。唯一可以删除容器镜像的密钥类型。 |
| 来自服务器密钥文件的文件密钥    | 安装所有者和旧版集成（`read` 或 `write`）          |

个人令牌会过期。过期之后，每个请求都会收到 `401 UNAUTHORIZED`：请创建新令牌并重新登录。除非配置了 credential helper，否则 Docker 会把密钥保存在 `~/.docker/config.json` 中。请保护好该文件，或使用凭据存储。

## 推送与拉取 {#push-and-pull}

```bash
docker tag web:1.4 arkvory.example/releases/team/web:1.4
docker push arkvory.example/releases/team/web:1.4
docker pull arkvory.example/releases/team/web:1.4
docker pull arkvory.example/releases/team/web@sha256:<digest>
```

注册表的行为如下：

- 仓库中已有的镜像层不会再次存储，即使它被另一个镜像使用。
- 镜像层不会在仓库之间共享。从另一个仓库挂载镜像层的请求会得到一个普通的上传会话，因此客户端会重新发送该镜像层。
- 每个镜像层和每个 manifest 都会与其 SHA-256 摘要比对。不匹配时不会存储任何内容，并返回 `DIGEST_INVALID`。
- 只有当 manifest 引用的所有内容都已在仓库中时，它才会被接受：镜像的 config 和镜像层，或 index 的各平台 manifest。各平台 manifest 必须与它们的 index 属于同一个镜像。否则返回 `MANIFEST_BLOB_UNKNOWN`。
- 镜像层下载支持 `Range` 请求。

注册表接受以下 manifest 类型：

| 媒体类型                                                    | 用途                            |
| ----------------------------------------------------------- | ------------------------------- |
| `application/vnd.oci.image.manifest.v1+json`                | OCI 镜像、Helm chart、ORAS 制品 |
| `application/vnd.oci.image.index.v1+json`                   | 多平台镜像、BuildKit 注册表缓存 |
| `application/vnd.docker.distribution.manifest.v2+json`      | Docker 镜像（schema 2）         |
| `application/vnd.docker.distribution.manifest.list.v2+json` | Docker 多平台镜像               |

manifest 的 `schemaVersion: 2` 是必需的，且大小最多 4 MiB。不支持 Docker schema 1。类型来自 `Content-Type` 请求头或 manifest 的 `mediaType` 字段，两者必须一致。拉取时会按推送时的原样返回 manifest，并带有它自己的媒体类型。注册表不会在不同格式之间转换。

### 多平台镜像 {#multi-platform-images}

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t arkvory.example/releases/team/web:1.4 --push .
```

Buildx 先按摘要推送每个平台的 manifest，再以镜像标签推送 index。它们都推送到同一个镜像名称下，这是注册表的要求。

### 构建缓存 {#build-cache}

能够导出缓存的 BuildKit 构建器（例如使用 `docker-container` 驱动的 `docker buildx` 构建器）可以把它的注册表缓存保存在 Arkvory 中：

```bash
docker buildx build \
  --cache-from type=registry,ref=arkvory.example/releases/team/web:cache \
  --cache-to type=registry,ref=arkvory.example/releases/team/web:cache,mode=max \
  -t arkvory.example/releases/team/web:1.4 --push .
```

缓存 index 列出镜像层和一份缓存配置。Arkvory 把它们作为镜像的 blob 存储，并像保护任何已存储 manifest 的镜像层一样保护它们。

### Helm chart {#helm-charts}

Helm 把 chart 作为 OCI 制品存储。在执行 `helm registry login` 之后：

```bash
helm push web-1.4.0.tgz oci://arkvory.example/releases/charts
helm pull oci://arkvory.example/releases/charts/web --version 1.4.0
helm install web oci://arkvory.example/releases/charts/web --version 1.4.0
```

该 chart 会成为仓库 `releases` 中带有镜像标签 `1.4.0` 的镜像 `charts/web`。Arkvory 没有带 `index.yaml` 文件的传统 chart 仓库。

### ORAS 制品 {#oras-artifacts}

ORAS 把任意文件存储为 OCI manifest 的镜像层：

```bash
oras push arkvory.example/releases/tools/settings:1.0 ./settings.json:application/json
oras pull arkvory.example/releases/tools/settings:1.0
```

Referrers API 不可用：`/v2/<name>/referrers/<digest>` 返回 `404`。遵循 OCI 规范的客户端（例如 ORAS）随后会改为把附加的制品保存在以摘要命名的镜像标签下。

## 镜像标签与摘要 {#tags-and-digests}

- 以某个镜像标签推送 manifest 会移动该标签。该标签此前指向的 manifest 仍保留在注册表中，仍然可以按摘要拉取。
- 按摘要推送（`PUT /v2/<name>/manifests/sha256:…`）会存储不带镜像标签的 manifest。摘要必须是请求体的 SHA-256。
- 镜像标签按字节顺序列出，因此大写字母排在小写字母之前。

列出某个镜像的所有镜像标签：

```bash
curl -fsS -u "ci:$ARKVORY_KEY" https://arkvory.example/v2/releases/team/web/tags/list
```

响应为 `{"name": "releases/team/web", "tags": [...]}`。用 `n` 指定每页大小（默认 100，最大 1000），用 `last` 指定上一页的最后一个镜像标签。还有更多镜像标签时，`Link` 响应头包含下一页的地址。

查找某个镜像标签的摘要：

```bash
curl -fsSI -u "ci:$ARKVORY_KEY" \
  https://arkvory.example/v2/releases/team/web/manifests/1.4 | grep -i docker-content-digest
```

没有列出所有镜像的目录（`/v2/_catalog`）。在控制台中，镜像层和 manifest 会作为仓库中的制品显示，带有标签 `oci`，以其摘要命名。在 [[ui:catalog]] 中使用 [[ui:labelFilter]] 即可显示它们。

## 删除镜像与释放空间 {#delete-images}

通过注册表 API 删除镜像。Docker 命令行没有对应的命令：请使用 `curl`、`oras manifest delete` 或其他注册表工具。

| 请求                                   | 作用                                                |
| -------------------------------------- | --------------------------------------------------- |
| `DELETE /v2/<name>/manifests/<tag>`    | 只删除镜像标签。manifest 仍然保留，仍可按摘要拉取。 |
| `DELETE /v2/<name>/manifests/<digest>` | 删除该 manifest 以及指向它的所有镜像标签            |
| `DELETE /v2/<name>/blobs/<digest>`     | 以 `405` 拒绝。镜像层随其 manifest 一同移除。       |

这两种删除都需要在该仓库中具有 `artifact.delete` 操作权限的服务密钥。个人令牌、控制台会话和文件密钥无法删除镜像。删除请求返回 `202`。

```bash
curl -fsS -X DELETE -H "Authorization: Bearer $ARKVORY_CLEANUP_KEY" \
  https://arkvory.example/v2/releases/team/web/manifests/sha256:<digest>
```

空间是这样释放的：

1. 只要 manifest 仍被存储（无论有没有镜像标签），Arkvory 都会保护它以及它引用的每个镜像层。保留规则会因阻止原因 `reference` 而跳过它们。
2. 移动或删除镜像标签不会释放任何空间。旧的 manifest 会一直保留它们的镜像层，直到您按摘要删除这些 manifest。
3. 按摘要删除 manifest 之后，它对应的制品以及不被其他 manifest 使用的镜像层就失去了这种保护。它们会继续保留，直到有人通过保留规则移除它们，或将它们作为制品删除。参见[存储](../operate/storage)。
4. 在没有 manifest 的情况下推送的镜像层（例如推送失败时留下的）不受保护。
5. 当已被移除的镜像层再次被需要时，注册表会将它报告为未知，下一次推送会重新上传它。

## 权限 {#permissions}

个人令牌和文件密钥获得对仓库的读取或写入权限。服务密钥获得精确指定的操作权限。

| 操作                    | 服务密钥的操作                                     | 个人令牌或文件密钥                   |
| ----------------------- | -------------------------------------------------- | ------------------------------------ |
| 拉取 manifest 和镜像层  | `content.read`                                     | 读取权限                             |
| 列出镜像标签            | `artifact.list`                                    | 读取权限                             |
| 推送                    | `upload.create`、`upload.write`、`upload.complete` | 写入权限；令牌需要 `read-write` 范围 |
| 删除镜像标签或 manifest | `artifact.delete`                                  | 无法删除                             |

负责推送的 CI 密钥通常也要拉取，例如基础镜像或构建缓存。请同时授予它 `content.read` 和 `artifact.list`。对于未授予该密钥的仓库，返回 `403 DENIED`。

## 读取网关与仓库镜像 {#read-gateways-and-mirrors}

- [读取网关](../operate/read-gateways)提供拉取服务。推送会收到 `405`。
- [仓库镜像](../operate/mirrors)会接收其源的容器镜像，连同镜像标签和删除操作。客户端从仓库镜像自己的地址拉取。推送会收到 `409 DENIED`，原因为 `mirror_read_only`。

## 限制 {#limits}

| 限制             | 值                                                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| manifest 大小    | 4 MiB                                                                                                                                                                 |
| 镜像层大小       | 安装允许的最大对象大小，即 `ARKVORY_MAX_OBJECT_BYTES`（默认约 10 TiB）                                                                                                |
| 单个上传请求     | 必须在 30 分钟内完成，且停顿不得超过 30 秒（`ARKVORY_UPLOAD_DEADLINE_MS`、`ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`）。30 分钟也是允许的最大值。                               |
| 未完成的上传     | 24 小时无活动后，连同其字节一并移除                                                                                                                                   |
| 临时磁盘空间     | 上传期间最多为镜像层大小的两倍                                                                                                                                        |
| 同时进行的上传   | 默认每个密钥 1 个、每台服务器 2 个（`ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`、`ARKVORY_MAX_UPLOADS`）。等待中的请求在 20 秒后放弃（`ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS`）。 |
| 同时进行的下载   | 默认每个密钥 4 个、每台服务器 16 个                                                                                                                                   |
| 每页的镜像标签数 | 1000                                                                                                                                                                  |
| 配额             | 镜像层、manifest 和未完成上传的字节都计入仓库配额和安装容量                                                                                                           |

Docker 在一个请求中发送一个镜像层。因此镜像层必须在上传期限内送达，镜像层上传失败后会从第一个字节重新开始。对于数十 GB 的文件，请改用 [`arkvoryctl`](./cli)：它按分片上传，失败后可以继续。这些变量在[环境变量](../reference/environment#transfers-and-bandwidth)中有说明。

## 不支持的功能 {#not-supported}

- Referrers API。它返回 `404`，客户端会回退到使用镜像标签。
- 所有镜像的目录 `/v2/_catalog`。
- 从另一个仓库挂载镜像层。客户端会重新上传该镜像层。
- 用于 Bearer 令牌的令牌服务。请直接以 Basic 或 Bearer 方式发送密钥本身。
- Docker Hub 或其他注册表的拉取穿透缓存（pull-through cache）。
- Docker schema 1 manifest，以及 `sha256` 以外的摘要。
- 删除单个镜像层。
- 控制台中的镜像专属栏目。

## 用于测试的明文 HTTP {#plain-http-for-tests}

Docker 会拒绝没有 HTTPS 的注册表。默认情况下，只有本机地址（`localhost`、`127.0.0.0/8`）可以使用明文 HTTP。对于位于其他主机上的测试服务器，请把它添加到 Docker 守护进程配置（Linux 上是 `/etc/docker/daemon.json`）的 `insecure-registries` 中，然后重启 Docker：

```json
{
  "insecure-registries": ["arkvory.test:8080"]
}
```

Podman 使用选项 `--tls-verify=false`。使用明文 HTTP 时，密钥以明文传输。仅在测试网络中使用。

如果使用自己的证书颁发机构签发的证书，Linux 上的 Docker 会从 `/etc/docker/certs.d/<host>/ca.crt` 读取 CA（如果端口不是 443，则目录名带端口）。Docker Desktop 使用系统的信任存储。

## 故障排查 {#troubleshooting}

Docker 以带空格的小写形式显示注册表错误码，例如 `denied` 或 `name invalid`，后面是服务器返回的消息。每个错误还在 `detail.requestId` 中带有请求 ID。请把它提供给管理员：管理员可以据此在服务器日志中找到该请求。

| 错误                                              | 原因                                                                                         | 解决方法                                                                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `UNAUTHORIZED`（401）                             | 密钥缺失、错误、已过期或已被撤销                                                             | 使用有效的密钥重新登录                                                                                                       |
| `DENIED`（403）                                   | 密钥无法写入，或看不到该仓库。范围为 `read` 的令牌会收到 "Read-only personal access token"。 | 使用对此仓库具有写入权限的密钥                                                                                               |
| `DENIED`（409）                                   | 该仓库是仓库镜像                                                                             | 推送到主服务器                                                                                                               |
| `DENIED`（507）                                   | 已达到仓库配额或安装容量上限。未完成的上传也计入。                                           | 释放空间或申请更大的配额                                                                                                     |
| `NAME_INVALID`                                    | 引用在仓库之后没有镜像部分，或包含大写字母                                                   | 使用小写的 `<host>/<repository>/<image>:<tag>`                                                                               |
| `MANIFEST_UNKNOWN`                                | 此镜像中不存在该镜像标签或摘要                                                               | 用 `tags/list` 检查名称                                                                                                      |
| `MANIFEST_BLOB_UNKNOWN`                           | manifest 引用了不在此仓库中的镜像层或平台 manifest                                           | 重新推送整个镜像，让客户端上传缺失的部分                                                                                     |
| `DIGEST_INVALID`                                  | 字节与摘要不匹配                                                                             | 再次推送。如果反复出现，请检查代理。                                                                                         |
| `TOOMANYREQUESTS`（503 或 429）                   | 此密钥同时进行的传输过多，或服务器繁忙                                                       | 稍等后重试。降低客户端的并行上传数，例如在 Docker 守护进程配置中设置 `"max-concurrent-uploads": 1`，或请管理员提高传输限制。 |
| `http: server gave HTTP response to HTTPS client` | 服务器没有 HTTPS                                                                             | 设置 [HTTPS](../install/https)，或对测试服务器使用 `insecure-registries`                                                     |
| `x509: certificate signed by unknown authority`   | Docker 不信任该证书                                                                          | 按上文所述安装 CA 证书                                                                                                       |
| `413 Request Entity Too Large`                    | 反向代理限制了请求大小                                                                       | 在 nginx 中设置 `client_max_body_size 0`                                                                                     |
| 较大的镜像层在 30 分钟后中断                      | 单个请求的上传期限                                                                           | 使用更快的网络，或不要把这类文件放进镜像，而是用 `arkvoryctl` 上传                                                           |

## 相关页面 {#related-pages}

- [客户端与协议](./index)
- [账户与密钥](../use/accounts)
- [HTTPS](../install/https)
- [存储](../operate/storage)
- [仓库镜像](../operate/mirrors)和[读取网关](../operate/read-gateways)
