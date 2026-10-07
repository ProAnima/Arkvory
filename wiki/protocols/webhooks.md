---
title: 'Webhooks'
description: 'Get an HTTP request when a repository changes: configure a subscription, verify the signature and handle repeated deliveries.'
---

# Webhooks

A webhook tells your system that something changed in a repository, so that it does not have to poll. The Arkvory worker sends an HTTP `POST` to your URL for every event of the repository [change feed](../api/reference/artifacts#listCatalogChanges). Use it to start a deployment when a build is published, or to refresh a cache when a path gets a new version.

The administrator sets subscriptions in a file. There is no API or console page for them yet. You can also read the feed yourself with `GET /api/v1/repositories/<repository>/changes`.

## How delivery works {#how-it-works}

- **One subscription follows one repository** and sends to one URL.
- **Events come in order, one at a time.** The next event waits until the receiver has answered with a `2xx` status.
- **Delivery happens at least once.** After a crash or a lost answer the same event can arrive again. Every event has a stable `id`: deduplicate by it.
- **A new subscription gets only new events.** Events from before it was created are not sent.
- **A receiver that is down delays only its own subscription.** The event waits. Arkvory retries after 12 seconds, doubles the pause up to one hour, and sends the events in order when the receiver answers again. Uploads and downloads never wait for a webhook.

## Set up a subscription {#set-up}

You need access to the server files and the right to restart the worker. See [Configuration](../install/configuration).

1. Create a file with the signing secret: at least 16 random printable characters, for example `/root/ci.secret`. The receiver needs the same secret.
2. Run `configure` with the subscription. The command checks your input, copies the secret under `config/webhooks`, writes the subscription file and the setting, restarts the services, and restores the previous configuration when they do not become ready. It does not contact the receiver.

```bash
sudo arkvory configure --root /opt/proanima-arkvory \
  --webhook ci --webhook-repository releases \
  --webhook-url https://ci.example.com/hooks/arkvory \
  --webhook-secret-file /root/ci.secret \
  --webhook-actions artifact.publish
```

3. Look for `webhook.started` in the worker log, publish a file and watch your receiver.

The command writes `config/webhooks/webhooks.json`, which you can also write by hand and name in `ARKVORY_WEBHOOKS_FILE`. Run the command again with the same name to change a subscription. `--webhook-detach ci` removes it: its files are deleted and its position is forgotten. One call changes one subscription and cannot be mixed with other `configure` options.

The file has these fields:

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

| Field            | Meaning                                                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | Name of the subscription: 1 to 64 characters `a-z`, `0-9`, `_` and `-`. Its progress is kept under this name.                                                                      |
| `repository`     | The repository whose feed is sent.                                                                                                                                                 |
| `url`            | The receiver. HTTPS, with no user name, query or fragment, up to 2048 characters. Plain HTTP is allowed only for `localhost`, `127.0.0.1` and `[::1]`.                             |
| `secretFile`     | Absolute path to the file with the signing secret.                                                                                                                                 |
| `nextSecretFile` | Optional second secret for a [rotation](#rotate-the-secret).                                                                                                                       |
| `actions`        | Optional list of feed actions to send, for example `artifact.publish`, `artifact.delete`, `asset.replace`, `stage.added` and `package.register`. Without it, every action is sent. |

A wrong file stops the worker at startup with `worker.unavailable`. Up to 16 subscriptions are allowed. On a Compose installation the command also mounts `config/webhooks` into the worker container.

## The request {#request}

| Header                | Value                                                                         |
| --------------------- | ----------------------------------------------------------------------------- |
| `Content-Type`        | `application/json`                                                            |
| `X-Arkvory-Delivery`  | The event `id`. It is the same for every repeat of an event.                  |
| `X-Arkvory-Event`     | The feed action, for example `artifact.publish`.                              |
| `X-Arkvory-Timestamp` | Unix time in seconds at which the request was signed.                         |
| `X-Arkvory-Signature` | `sha256=<hex>`. During a rotation there are two values, separated by a comma. |

The body is JSON:

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

`sequence` is the position in the feed, a decimal string. `detail` is the file path or the stage for actions that have one. The body has no author, no file content and no metadata: use `artifactId` to read the current state through the [API](../api/index).

Answer with any `2xx` status within 10 seconds. A `3xx` status (redirects are not followed), `4xx`, `5xx`, a connection error or a timeout counts as a failure. Arkvory reads at most 4 KiB of the answer and ignores it.

## Verify the signature {#verify}

The signature is HMAC-SHA256 with your secret over the text `<timestamp>.<body>`, written as `sha256=` and the hex digest. Check it before you trust a request:

1. Read the raw body, before any JSON parsing.
2. Refuse the request when the timestamp differs from your clock by more than 5 minutes.
3. Compute the signature and compare it with a constant-time function. If the header has two values, accept either.

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

## Handle repeated deliveries {#repeats}

- Store the `id` of every event you handled and ignore a repeat.
- Answer fast: queue the work and return `204`. A slow receiver delays every later event of its subscription.
- A repeat does not mean that the operation happened twice. Treat an event as a hint and read the current state from the API.

## Rotate the secret {#rotate-the-secret}

1. Run the same command with `--webhook-secret-file` for the current secret and `--webhook-next-secret-file` for the new one. Every request now carries two signatures.
2. Change the receiver to the new secret. A receiver that accepts either signature keeps working meanwhile.
3. Run the command again with the new secret file as `--webhook-secret-file` and without `--webhook-next-secret-file`.

## Private receivers and certificates {#private-receivers}

- Arkvory refuses receivers on loopback, private, link-local and cloud metadata addresses, and names that resolve to them. This stops the server from being used to reach internal services.
- To send to a receiver in your network, add the network with `--webhook-allow-private`, for example `--webhook-allow-private 10.20.0.0/16` (`ARKVORY_WEBHOOKS_ALLOW_PRIVATE`). It stays until the last subscription is removed.
- For a receiver whose certificate comes from your own authority, add a PEM file with that authority through `--webhook-ca-file` (`ARKVORY_WEBHOOKS_CA_FILE`). The certificate is always verified.

## Monitor webhooks {#monitor}

The worker writes `webhook.step_failed` with an `errorCode` when a delivery fails, and `webhook.recovered` when it works again. The metrics `arkvory_webhook_failing` and `arkvory_webhook_last_success_timestamp_seconds` and the alert `ArkvoryWebhookFailing` are described in [Monitoring](../operate/monitoring). `webhook.stopped` marks the end of a subscription's loop, at shutdown or when the worker loses storage ownership. `webhook.prune_failed` means the worker could not forget removed subscriptions at startup; it tries again at the next start. The codes `unavailable` and `internal` appear only in the log, not in `arkvory_webhook_failing`.

## A subscription that does not move {#stuck}

Arkvory never skips an event: that is what makes delivery reliable. A receiver that keeps refusing one event, for example with `400` because it cannot parse it, therefore stops its whole subscription. No later event of that subscription is sent; other subscriptions keep working. The worker writes `webhook.step_failed` with `http_4xx` and retries up to one hour apart, `arkvory_webhook_failing` is `1`, and the alert `ArkvoryWebhookFailing` fires after 15 minutes.

1. Fix the receiver so that it answers the event with `2xx`. Arkvory sends it at the next retry, at most about an hour later, and then every waiting event in order. Running `configure` again with the same name and repository keeps the position.
2. If the event can never be accepted, remove the subscription with `--webhook-detach` and add it again. It starts at the end of the feed: the waiting events are **not** sent. Read them from the [change feed](../api/reference/artifacts#listCatalogChanges) after the last `sequence` your receiver handled.

## Troubleshooting {#troubleshooting}

| `errorCode`   | Cause and what to do                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blocked`     | The receiver address is not allowed (loopback, private, link-local or metadata). Use a public address or add the network to `ARKVORY_WEBHOOKS_ALLOW_PRIVATE`. |
| `timeout`     | No answer within 10 seconds. Answer faster and queue the work.                                                                                                |
| `network`     | Connection refused, name not found or connection reset. Check the URL, the DNS and the firewall from the server.                                              |
| `tls`         | The certificate is not trusted, expired or has the wrong name. Fix it, or set `ARKVORY_WEBHOOKS_CA_FILE`.                                                     |
| `redirect`    | The receiver answered `3xx`. Redirects are not followed: use the final URL.                                                                                   |
| `http_4xx`    | The receiver refused the request. Check its signature check, its path and its key.                                                                            |
| `http_5xx`    | The receiver failed. Arkvory keeps retrying, up to one hour apart.                                                                                            |
| `secret`      | The secret file is missing, unreadable or shorter than 16 bytes.                                                                                              |
| `unavailable` | The worker could not read the feed or the subscription state from the database. Nothing was sent; it tries again after 5 seconds. Check the database.         |
| `internal`    | An unexpected error in the worker. Nothing was sent; it tries again after 5 seconds. Report it with the worker log.                                           |

Nothing arrives? Check that `webhook.started` is in the worker log, that `ARKVORY_WEBHOOKS_FILE` is set, the name of the repository and the `actions` filter. A new subscription sends only events after its first step.

## Related pages {#related-pages}

- [Configuration](../install/configuration)
- [Monitoring](../operate/monitoring)
- [The change feed in the API reference](../api/reference/artifacts#listCatalogChanges)
