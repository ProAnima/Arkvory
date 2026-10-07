---
title: 'Webhook'
description: '仓库变化时收到 HTTP 请求：配置订阅、验证签名并处理重复投递。'
---

# Webhook

Webhook 会在仓库发生变化时通知你的系统，这样它就不必轮询。Arkvory 的 worker 会针对仓库[变更订阅源](../api/reference/artifacts#listCatalogChanges)的每个事件，向你的 URL 发送一个 HTTP `POST`。可用它在构建发布时启动部署，或在某个路径有了新版本时刷新缓存。

订阅由管理员在文件中设置，目前还没有相应的 API 或控制台页面。你也可以自己读取变更订阅源：`GET /api/v1/repositories/<repository>/changes`。

## 投递如何工作 {#how-it-works}

- **一个订阅跟随一个仓库**，并发送到一个 URL。
- **事件按顺序逐个到达。** 下一个事件要等接收方返回 `2xx` 状态后才发送。
- **至少投递一次。** 崩溃或响应丢失后，同一事件可能再次到达。每个事件都有稳定的 `id`：请按它去重。
- **新订阅只收到新事件。** 创建之前的事件不会发送。
- **接收方宕机只会延迟它自己的订阅。** 事件会等待。Arkvory 在 12 秒后重试，把间隔翻倍直至一小时，并在接收方重新响应后按顺序发送事件。上传和下载从不等待 webhook。

## 设置订阅 {#set-up}

你需要能访问服务器文件，并有权重启 worker。参见[配置](../install/configuration)。

1. 创建一个至少包含 16 个随机字符的密钥文件，例如 `config/webhooks/ci.secret`。只有服务账户可以读取它。接收方需要使用相同的密钥。
2. 编写订阅文件，例如 `config/webhooks/webhooks.json`：

```json
{
  "webhooks": [
    {
      "id": "ci",
      "repository": "releases",
      "url": "https://ci.example.com/hooks/arkvory",
      "secretFile": "/opt/proanima-arkvory/config/webhooks/ci.secret",
      "actions": ["artifact.publish"]
    }
  ]
}
```

3. 在 `config/runtime.json` 中把 `ARKVORY_WEBHOOKS_FILE` 设为该文件的绝对路径，然后重启 worker。参见[应用更改](../install/configuration#apply-change)。
4. 在 worker 日志中查找 `webhook.started`，发布一个文件，并观察你的接收方。

文件有误会使 worker 在启动时以 `worker.unavailable` 停止。最多允许 16 个订阅。Compose 安装需要手动把这些文件挂载到 worker 容器中。

| 字段             | 含义                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | 订阅名称：1 到 64 个字符，可用 `a-z`、`0-9`、`_` 和 `-`。其进度按此名称保存。                                                                        |
| `repository`     | 要发送其变更订阅源的仓库。                                                                                                                           |
| `url`            | 接收方。使用 HTTPS，不含用户名、query 或 fragment，最长 2048 个字符。仅 `localhost`、`127.0.0.1` 和 `[::1]` 允许使用明文 HTTP。                      |
| `secretFile`     | 签名密钥文件的绝对路径。                                                                                                                             |
| `nextSecretFile` | 可选的第二个密钥，用于[轮换](#rotate-the-secret)。                                                                                                   |
| `actions`        | 可选的要发送的订阅源操作列表，例如 `artifact.publish`、`artifact.delete`、`asset.replace`、`stage.add` 和 `package.register`。不设置则发送所有操作。 |

## 请求 {#request}

| 请求头                | 值                                             |
| --------------------- | ---------------------------------------------- |
| `Content-Type`        | `application/json`                             |
| `X-Arkvory-Delivery`  | 事件的 `id`。同一事件的每次重复都相同。        |
| `X-Arkvory-Event`     | 订阅源操作，例如 `artifact.publish`。          |
| `X-Arkvory-Timestamp` | 请求签名时的 Unix 时间（秒）。                 |
| `X-Arkvory-Signature` | `sha256=<hex>`。轮换期间有两个值，以逗号分隔。 |

请求体是 JSON：

```json
{
  "id": "releases:128",
  "repository": "releases",
  "sequence": "128",
  "action": "artifact.publish",
  "artifactId": "00000000-0000-4000-8000-000000000001",
  "detail": null
}
```

`sequence` 是在订阅源中的位置，为十进制字符串。对于带有路径或阶段的操作，`detail` 就是文件路径或阶段。请求体不含作者、文件内容和元数据：请用 `artifactId` 通过 [API](../api/index) 读取当前状态。

请在 10 秒内返回任意 `2xx` 状态。`3xx`（不会跟随重定向）、`4xx`、`5xx`、连接错误或超时都算失败。Arkvory 最多读取响应的 4 KiB，并忽略其内容。

## 验证签名 {#verify}

签名是用你的密钥对文本 `<timestamp>.<body>` 计算的 HMAC-SHA256，写作 `sha256=` 加十六进制摘要。信任请求之前先检查它：

1. 在解析 JSON 之前读取原始请求体。
2. 如果时间戳与你的时钟相差超过 5 分钟，拒绝该请求。
3. 计算签名并用恒定时间函数比较。如果请求头有两个值，接受其中任意一个。

Node.js:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(secret, headers, rawBody) {
  const timestamp = headers['x-arkvory-timestamp'];
  if (!/^\d{1,12}$/.test(timestamp ?? '')) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = Buffer.from(
    'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex'),
  );
  return String(headers['x-arkvory-signature'] ?? '')
    .split(',')
    .some((given) => {
      const actual = Buffer.from(given.trim());
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    });
}
```

Python:

```python
import hashlib, hmac, time

def verify(secret: bytes, headers, raw_body: bytes) -> bool:
    timestamp = headers.get("X-Arkvory-Timestamp", "")
    if not timestamp.isdigit() or abs(time.time() - int(timestamp)) > 300:
        return False
    digest = hmac.new(secret, timestamp.encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    expected = "sha256=" + digest
    given = headers.get("X-Arkvory-Signature", "").split(",")
    return any(hmac.compare_digest(part.strip(), expected) for part in given)
```

## 处理重复投递 {#repeats}

- 保存每个已处理事件的 `id`，并忽略重复。
- 快速响应：把工作放入队列并返回 `204`。接收方过慢会延迟其订阅之后的所有事件。
- 重复并不意味着操作发生了两次。请把事件当作提示，并从 API 读取当前状态。

## 轮换密钥 {#rotate-the-secret}

1. 添加带有新密钥的 `nextSecretFile` 并重启 worker。此后每个请求都带有两个签名。
2. 把接收方切换到新密钥。在此期间，接受任一签名的接收方可继续工作。
3. 把新文件放到 `secretFile`，删除 `nextSecretFile`，再重启 worker。

## 内部接收方与证书 {#private-receivers}

- Arkvory 会拒绝位于环回、私有、链路本地和云元数据地址上的接收方，以及解析到这些地址的名称。这样服务器就不能被用来访问内部服务。
- 要向你网络内的接收方发送，请把该网络写入 `ARKVORY_WEBHOOKS_ALLOW_PRIVATE`，例如 `10.20.0.0/16`。
- 如果接收方的证书来自你自己的证书颁发机构，请把 `ARKVORY_WEBHOOKS_CA_FILE` 设为包含该机构的 PEM 文件。证书始终会被验证。

## 监控 webhook {#monitor}

投递失败时 worker 会写入带有 `errorCode` 的 `webhook.step_failed`，恢复后写入 `webhook.recovered`。指标 `arkvory_webhook_failing` 和 `arkvory_webhook_last_success_timestamp_seconds` 以及告警 `ArkvoryWebhookFailing` 见[监控](../operate/monitoring)。

## 故障排除 {#troubleshooting}

| `errorCode` | 原因与处理方法                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `blocked`   | 接收方地址不被允许（环回、私有、链路本地或元数据）。请使用公网地址，或把该网络加入 `ARKVORY_WEBHOOKS_ALLOW_PRIVATE`。 |
| `timeout`   | 10 秒内没有响应。请更快响应，并把工作放入队列。                                                                       |
| `network`   | 连接被拒绝、找不到名称或连接被重置。请从服务器检查 URL、DNS 和防火墙。                                                |
| `tls`       | 证书不受信任、已过期或名称不符。请修正，或设置 `ARKVORY_WEBHOOKS_CA_FILE`。                                           |
| `redirect`  | 接收方返回了 `3xx`。不会跟随重定向：请使用最终 URL。                                                                  |
| `http_4xx`  | 接收方拒绝了请求。请检查它的签名校验、路径和密钥。                                                                    |
| `http_5xx`  | 接收方出错。Arkvory 会持续重试，间隔最长一小时。                                                                      |
| `secret`    | 密钥文件不存在、无法读取或短于 16 字节。                                                                              |

什么都没收到？请检查 worker 日志中是否有 `webhook.started`，`ARKVORY_WEBHOOKS_FILE` 是否已设置，仓库名称以及 `actions` 过滤器。新订阅只发送其第一步之后的事件。

## 相关页面 {#related-pages}

- [配置](../install/configuration)
- [监控](../operate/monitoring)
- [API 参考中的变更订阅源](../api/reference/artifacts#listCatalogChanges)
