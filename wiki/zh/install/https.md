---
title: HTTPS 和反向代理
description: '使用内置 TLS 或反向代理让 Arkvory 可安全地从其他计算机访问，并为另一个地址设置控制台和 CORS。'
---

# HTTPS 和反向代理

新安装通过明文 HTTP 监听 `127.0.0.1:8080`。只有服务器上的程序可以访问它。在客户端从其他计算机连接之前，请在其前面部署 HTTPS。密钥、密码和下载链接会在请求中传输：切勿在计算机之间通过明文 HTTP 发送它们。

## 选择一种方法 {#choose}

|                    | 内置 TLS                                     | 反向代理                                              |
| ------------------ | -------------------------------------------- | ----------------------------------------------------- |
| 安装方式           | Windows 服务和 Linux（原生）。不包括 Compose | 所有方式，也是 Compose 的唯一方法                     |
| 设置               | 一条带回滚的 `arkvory configure` 命令        | 代理配置，以及 Arkvory 中的 `ARKVORY_TRUSTED_PROXIES` |
| 端口               | API 端口，默认 8080                          | 任意端口，例如 443                                    |
| 证书续期           | API 自行读取续期后的文件                     | 由代理处理                                            |
| 客户端证书（mTLS） | 不支持                                       | 可在代理中实现                                        |

## 开始之前 {#before-you-start}

- 获取客户端所用名称的证书，证书须来自客户端信任的机构，例如使用 certbot、win-acme 或贵公司的机构。您需要证书（含其链）和私钥，二者均为 PEM 文件。私钥不得设有密码。
- 创建一个指向服务器的 DNS 名称。
- 在防火墙中只打开 HTTPS 端口，并且只对您的客户端网络开放。切勿打开数据库端口 54329。

## 内置 TLS {#built-in-tls}

### 准备文件 {#tls-files}

这些文件必须满足以下规则。命令会在更改任何内容之前检查所有规则。

- 路径是绝对路径。
- 每个文件是最大 1 MiB 的 PEM 文件。证书文件包含证书，其后是证书链。
- 私钥是与证书匹配的未加密 PEM 私钥。
- 证书尚未过期。
- 服务账户可以读取这两个文件：Linux 上为 `arkvory`，Windows 上为 `LocalService`。

Arkvory 引用这些文件而不会复制它们。请将它们放在续期时仍会保留的位置。在 Linux 上，不要放在 `/home` 下：单元看不到它。某些证书工具的目录只能由 `root` 读取；请将续期后的文件复制到服务组可以读取的目录，例如使用续期钩子。Linux 示例：

```bash
sudo install -d -m 0750 -o root -g arkvory /etc/arkvory/tls
sudo install -m 0644 -o root -g arkvory fullchain.pem /etc/arkvory/tls/fullchain.pem
sudo install -m 0640 -o root -g arkvory privkey.pem /etc/arkvory/tls/privkey.pem
```

在 Windows 上，将文件放入 `LocalService` 可以读取的文件夹，并只允许 SYSTEM、Administrators 和 `LocalService` 读取私钥。

### 开启内置 TLS {#tls-enable}

1. 使用路径和要监听的地址运行命令。`0.0.0.0` 监听所有 IPv4 接口，`::` 监听所有接口，或给出某一个接口的地址。

   ```bash
   sudo arkvory configure --root /opt/proanima-arkvory \
     --tls-cert /etc/arkvory/tls/fullchain.pem \
     --tls-key /etc/arkvory/tls/privkey.pem \
     --listen-host 0.0.0.0
   ```

   ```powershell
   & 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' configure --root C:\ProgramData\ProAnima\Arkvory `
     --tls-cert C:\ProgramData\ProAnima\Arkvory\tls\fullchain.pem `
     --tls-key C:\ProgramData\ProAnima\Arkvory\tls\privkey.pem `
     --listen-host 0.0.0.0
   ```

   该命令将 `ARKVORY_TLS_CERT_FILE`、`ARKVORY_TLS_KEY_FILE` 和 `ARKVORY_HOST` 写入 `config/runtime.json`，重启服务并等待 API 通过 HTTPS 应答其就绪检查。该检查只接受已配置的证书。成功时，命令会打印证书过期的日期。任何环节失败时，它会恢复之前的 `runtime.json`，用它重启服务并报告原因。

2. 在防火墙中为您的客户端网络打开 API 端口。
3. 从客户端计算机进行测试。除非您更改 `ARKVORY_PORT`，端口保持 8080：

   ```bash
   curl https://arkvory.example.com:8080/health/status
   ```

   应答为状态 200 和 `{"status":"ready"}`。控制台位于 `https://arkvory.example.com:8080/console/`。

在 Linux 上，服务账户通常无法监听低于 1024 的端口。要在端口 443 上提供 HTTPS，请使用[反向代理](#reverse-proxy)。

如果证书在启动时无效，API 会因错误而停止。它绝不会回退到明文 HTTP。

### 设置 {#tls-settings}

`configure` 设置文件和地址。还有两个设置需要手动写入 `runtime.json`。更改它们后请重启服务：参见[应用更改](./configuration#apply-change)。

| 变量                         | 默认值    | 含义                                                                  |
| ---------------------------- | --------- | --------------------------------------------------------------------- |
| `ARKVORY_TLS_MIN_VERSION`    | `TLSv1.2` | `TLSv1.2` 或 `TLSv1.3`                                                |
| `ARKVORY_TLS_RELOAD_SECONDS` | `300`     | API 重新读取证书文件的频率：30 到 86400 秒，或 `0` 表示仅在启动时读取 |

每个响应都带有 `Strict-Transport-Security: max-age=31536000`。

### 续期证书 {#tls-renewal}

将续期后的证书和私钥写入相同的路径。您不需要命令，也不需要重启。

- API 每隔 `ARKVORY_TLS_RELOAD_SECONDS` 比较这些文件。新连接使用新证书。已打开的连接在结束前继续使用旧证书。
- 失败的续期（文件不可读、私钥不匹配、证书已过期）绝不会替换正在使用的证书。API 会记录 `tls.reload_failed`，并在下一个间隔再次尝试。
- 在到期前的最后 14 天内，API 每天记录一次 `tls.expiring`。指标 `arkvory_tls_certificate_expiry_timestamp_seconds` 适合用于告警。参见[监控](../operate/monitoring)。

### 关闭内置 TLS {#tls-off}

```bash
sudo arkvory configure --root /opt/proanima-arkvory --tls-off --listen-host 127.0.0.1
```

单独使用 `--tls-off` 会让监听地址保持不变。若不添加 `--listen-host 127.0.0.1`，API 随后会在您打开的每个接口上提供明文 HTTP。

## 反向代理 {#reverse-proxy}

代理接受来自客户端的 HTTPS，并将明文 HTTP 转发给 API。请将 API 保持在 `127.0.0.1:8080`，并在同一台主机上安装代理。Compose 安装始终只发布 `127.0.0.1:8080`，因此主机上的代理可直接适配。

1. 安装代理并为其获取证书。
2. 按[代理必须做什么](#proxy-requirements)所述配置代理。
3. 将代理的地址添加到 `ARKVORY_TRUSTED_PROXIES`。参见[受信任的代理](#trusted-proxies)。
4. 确保 API 端口无法从其他计算机访问。
5. 测试：`curl https://arkvory.example.com/health/status` 返回 `{"status":"ready"}`。

### 代理必须做什么 {#proxy-requirements}

| 要求                                                                         | 原因                                                                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 接受任意大小的请求体（nginx 中为 `client_max_body_size 0`）                  | 文件有数十 GB 甚至更大。每个分片最大可达 1 GiB                                        |
| 不缓冲请求体或响应体（`proxy_request_buffering off`、`proxy_buffering off`） | 字节以流式传输。缓冲会填满代理的磁盘并延迟传输                                        |
| 允许至少 1900 秒的请求（`proxy_read_timeout`、`proxy_send_timeout`）         | 单个上传请求最长可能需要 30 分钟（`ARKVORY_UPLOAD_DEADLINE_MS`，默认 1 800 000 毫秒） |
| 对 API 使用 HTTP/1.1 并保持连接                                              | 流式传输所需                                                                          |
| 在 `Host` 中转发公共名称                                                     | 服务器据此构建绝对链接，例如 Git LFS 和 npm 应答中的链接                              |
| 发送 `X-Forwarded-For` 和 `X-Forwarded-Proto: https`                         | 用于日志和登录限制的客户端地址，以及绝对链接的协议                                    |
| 用自己的 ID 覆盖 `X-Request-Id`                                              | API 保留来自受信任代理的 ID。客户端不得自行选择它                                     |
| 不将查询字符串写入其访问日志                                                 | 下载链接在 `?token=` 中携带机密                                                       |
| 如果需要，自行设置 `Strict-Transport-Security`                               | API 只从内置监听器发送它                                                              |

### nginx {#nginx}

将此内容放入现有 nginx 的 `http` 上下文中。替换名称和证书路径。`log_format` 写入路径而不包含查询字符串。

```nginx
log_format arkvory_path '$remote_addr [$time_local] "$request_method $uri $server_protocol" '
                        '$status $body_bytes_sent $request_time $request_id';
server {
    listen 443 ssl;
    server_name arkvory.example.com;
    ssl_certificate /etc/arkvory/tls/fullchain.pem;
    ssl_certificate_key /etc/arkvory/tls/privkey.pem;
    access_log /var/log/nginx/arkvory.access.log arkvory_path;
    client_max_body_size 0;
    client_body_timeout 60s;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Request-Id $request_id;
        proxy_set_header Connection "";
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 1900s;
        proxy_send_timeout 1900s;
    }
}
```

使用此配置时，请将代理列入 `ARKVORY_TRUSTED_PROXIES`，例如 `127.0.0.1`。指令 `proxy_set_header X-Request-Id $request_id` 必须保留：它会覆盖客户端可能发送的 ID。

### Caddy {#caddy}

```caddyfile
arkvory.example.com {
    reverse_proxy 127.0.0.1:8080 {
        header_up X-Request-Id {http.request.uuid}
        flush_interval -1
    }
}
```

Caddy 会自行获取证书、以流式传输请求体、默认没有请求体大小限制也没有上游超时，并设置 `X-Forwarded-For`、`X-Forwarded-Proto` 和 `X-Forwarded-Host`。除非您启用 `log`，否则 Caddy 不写访问日志。如果启用，请从记录的地址中移除查询字符串。

### IIS 和其他代理 {#iis}

本项目的参考配置是上面的 nginx 文件。以下是 IIS 配合 Application Request Routing 和 URL Rewrite 的等效设置。本项目未测试它们。请对照您的 IIS 版本检查名称。

- 将服务器代理的超时提高到至少 1900 秒，并将响应缓冲区阈值设为 `0`。
- 将请求筛选中的 `maxAllowedContentLength` 提高到其最大值 4 294 967 295 字节。IIS 无法接受 4 GiB 或更大的请求体，因此用单条 `curl -T` 上传此类文件会失败。`arkvoryctl` 会分片发送大文件。
- 发送原始主机、`X-Forwarded-Proto: https` 以及 `X-Forwarded-For` 中的客户端地址。在 URL Rewrite 规则中设置新的 `X-Request-Id`。
- 让查询字符串不进入 IIS 日志。

### 受信任的代理 {#trusted-proxies}

`ARKVORY_TRUSTED_PROXIES` 最多接受 32 个地址或 CIDR 范围，以逗号分隔。主机名和通配符会被拒绝。只有来自这些地址之一的请求才可以设置：

- 客户端地址，使用 `X-Forwarded-For`。API 取最近的一个不受信任的地址，
- 请求 ID，使用 `X-Request-Id`，
- 绝对链接的主机，使用 `X-Forwarded-Host`。

没有该列表时，每个客户端看起来都来自代理的地址。此时登录限制会把所有人计为一个客户端，访问日志会在 `clientIp` 中显示代理地址。请只列出您控制的代理。

在 Compose 主机上，API 可能看到代理的地址是 Compose 网络网关的地址，而不是 `127.0.0.1`。请通过代理发送一个请求，在 API 日志的 `http.access` 记录中找到 `clientIp`，并列出该地址。

编辑 `config/runtime.json` 并重启服务。参见[应用更改](./configuration#apply-change)。

```json
{ "ARKVORY_TRUSTED_PROXIES": "127.0.0.1,::1" }
```

当 API 在没有 TLS 且没有受信任代理的情况下监听非环回地址时，它会在启动时记录 `http.plaintext_exposed`。正确的代理设置不会触发它。

## 控制台及其 API 地址 {#console-api-address}

Arkvory 提供的控制台使用打开它时所处的地址。它只与自己的服务器通信：其内容安全策略不允许其他地址。在代理后面，它可照常在 `https://arkvory.example.com/console/` 工作。

要将控制台托管在另一个 Web 服务器上，例如放在门户旁边：

1. 将安装根目录中 `releases/<version>/apps/web/public/` 的控制台文件复制到另一台服务器。通过 HTTPS 在路径 `/console/` 上提供它们，并为 `.js` 和 `.css` 使用正确的 MIME 类型。每次 Arkvory 更新后请重新复制它们。
2. 在复制后的 `index.html` 中，设置 Arkvory 的地址：

   ```html
   <meta name="arkvory-api-base-url" content="https://arkvory.example.com/" />
   ```

3. 如果另一台服务器设置了内容安全策略，请允许 `connect-src` 指向 Arkvory 地址，并允许本地 script worker。
4. 在 Arkvory 中允许该控制台的源。参见 [CORS](#cors)。

### CORS {#cors}

在 `ARKVORY_CORS_ORIGINS` 中设置其他地址上 Web 应用的源，并重启 API。

```json
{ "ARKVORY_CORS_ORIGINS": "https://portal.example.com,https://tools.example.com" }
```

- 该列表最多包含 16 个源，每个源包含协议、主机和可选端口，且不含路径。必须使用 HTTPS。明文 HTTP 仅允许用于 `localhost`、`127.0.0.1` 和 `[::1]`。
- CORS 适用于 `/api/v1/*` 和 `/health/ready`。来自未列出源的请求会收到状态 403，原因为 `origin_not_allowed`。来自服务器自身地址的请求无需条目。
- 列表中的源不会获得任何权限。每个请求仍然需要密钥或会话，并通过服务器的访问检查。Web 应用在 `Authorization` 请求头中发送密钥，而不是在 cookie 中。
- 允许的方法为 GET、HEAD、POST、PUT、PATCH 和 DELETE。浏览器可以缓存预检请求的应答 10 分钟。

测试预检请求。应答必须是状态 204，并且 `Access-Control-Allow-Origin` 中包含您的源：

```bash
curl -i -X OPTIONS https://arkvory.example.com/api/v1/auth/me \
  -H 'Origin: https://portal.example.com' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'
```

## 检查设置 {#check}

1. `curl https://arkvory.example.com/health/status` 返回状态 200 和 `{"status":"ready"}`。证书链验证通过，无异常。
2. 打开控制台，登录并通过相同的地址上传一个大文件。
3. 使用指向 HTTPS 地址的配置文件运行 `arkvoryctl doctor`。请勿在客户端关闭证书检查：命令行客户端无法关闭，并且它仅对本地计算机接受明文 HTTP。参见[命令行客户端](../protocols/cli)。
4. API 重启后，日志中没有 `http.plaintext_exposed` 记录。

## 故障排查 {#troubleshooting}

| 问题                                                                         | 原因和解决方法                                                                                                           |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `HTTPS was not enabled; the previous configuration is restored`              | 原因随后在消息中给出：文件不是 PEM、私钥有密码、私钥不匹配、证书已过期，或服务账户无法读取某个文件。修复后再次运行该命令 |
| `TLS files must be given as absolute paths`                                  | 提供完整路径                                                                                                             |
| `Built-in TLS is for native installations; use a reverse proxy with Compose` | Compose 没有内置 TLS。请使用[反向代理](#reverse-proxy)                                                                   |
| 来自代理的状态 413                                                           | 请求体限制太低。在 nginx 中使用 `client_max_body_size 0`                                                                 |
| 状态 502 或 504，或几分钟后上传中断                                          | 代理缓冲了请求体，或其超时短于 1900 秒                                                                                   |
| 所有人在登录时都受到限制，或 `clientIp` 始终是代理                           | 代理未列入 `ARKVORY_TRUSTED_PROXIES`                                                                                     |
| Git LFS 或 npm 应答中的链接显示 `http` 或内部名称                            | 代理未转发 `Host` 或 `X-Forwarded-Proto: https`                                                                          |
| 浏览器应用收到 403 `origin_not_allowed`                                      | 将其源添加到 `ARKVORY_CORS_ORIGINS` 并重启                                                                               |

更多提示见[故障排查](../operate/troubleshooting)和[安全](../operate/security)。
