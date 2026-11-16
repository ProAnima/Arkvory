---
title: Webhook
description: リポジトリの変更時にHTTPリクエストを受け取るため、サブスクリプションを設定し、署名を検証し、再配信を処理します。
---

# Webhook

Webhookは、リポジトリで何かが変わったことを外部システムに通知し、ポーリングを不要にします。Arkvoryのワーカーは、リポジトリの[変更フィード](../api/reference/artifacts#listCatalogChanges)のイベントごとに、指定されたURLへHTTP `POST`を送信します。ビルドの公開時にデプロイを開始したり、パスに新しいバージョンが追加されたときにキャッシュを更新したりするために使えます。

管理者がファイルでサブスクリプションを設定します。設定用のAPIやコンソールページはまだありません。`GET /api/v1/repositories/<repository>/changes`でフィードを自身で読むこともできます。

## 配信の仕組み {#how-it-works}

- **1つのサブスクリプションは1つのリポジトリを追跡し**、1つのURLに送信します。
- **イベントは順に1件ずつ届きます。** 次のイベントは、受信側が`2xx`ステータスで応答するまで待ちます。
- **配信は少なくとも1回行われます。** 異常終了や応答の消失後に、同じイベントが再び届く場合があります。各イベントは固定の`id`を持つため、それを使って重複を排除してください。
- **新しいサブスクリプションが受け取るのは、新しいイベントだけです。** 作成前のイベントは送信しません。
- **停止した受信側が遅らせるのは、自身のサブスクリプションだけです。** イベントは待機します。Arkvoryは12秒後に再試行し、待機時間を最大1時間まで倍増させます。受信側が再び応答すると、イベントを順に送信します。アップロードやダウンロードがWebhookを待つことはありません。

## サブスクリプションを設定する {#set-up}

サーバーのファイルへのアクセスと、ワーカーを再起動する権限が必要です。[設定](../install/configuration)を参照してください。

1. 署名用シークレットを含むファイルを作成します。16文字以上のランダムな印字可能文字を使います。例：`/root/ci.secret`。受信側にも同じシークレットが必要です。
2. サブスクリプションを指定して`configure`を実行します。コマンドは入力を確認し、シークレットを`config/webhooks`の下にコピーし、サブスクリプションファイルと設定を書き込み、サービスを再起動します。サービスが準備完了にならない場合は、以前の設定を復元します。受信側には接続しません。

```bash
sudo arkvory configure --root /opt/proanima-arkvory \
  --webhook ci --webhook-repository releases \
  --webhook-url https://ci.example.com/hooks/arkvory \
  --webhook-secret-file /root/ci.secret \
  --webhook-actions artifact.publish
```

3. ワーカーログで`webhook.started`を探し、ファイルを公開して、受信側を確認します。

コマンドは`config/webhooks/webhooks.json`を書き込みます。このファイルを手動で作成し、`ARKVORY_WEBHOOKS_FILE`に指定することもできます。サブスクリプションを変更するには、同じ名前でコマンドを再実行します。`--webhook-detach ci`で削除すると、そのファイルが削除され、位置も破棄されます。1回の呼び出しで変更するのは1つのサブスクリプションだけで、他の`configure`オプションとは混在できません。

ファイルには次のフィールドがあります。

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

| フィールド       | 意味                                                                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | サブスクリプション名：`a-z`、`0-9`、`_`、`-`を使う1～64文字。進捗はこの名前で保持します                                                                                           |
| `repository`     | フィードを送信するリポジトリ                                                                                                                                                      |
| `url`            | 受信先。HTTPSで、ユーザー名、クエリ、フラグメントを含めず、最大2048文字。平文HTTPを許可するのは`localhost`、`127.0.0.1`、`[::1]`だけです                                          |
| `secretFile`     | 署名用シークレットのファイルへの絶対パス                                                                                                                                          |
| `nextSecretFile` | [ローテーション](#rotate-the-secret)用の任意の2つ目のシークレット                                                                                                                 |
| `actions`        | 送信するフィードのアクションの任意の一覧。例：`artifact.publish`、`artifact.delete`、`asset.replace`、`stage.added`、`package.register`。省略するとすべてのアクションを送信します |

ファイルが不正な場合、ワーカーは起動時に`worker.unavailable`で停止します。サブスクリプションは最大16個です。Composeのインストールでは、コマンドは`config/webhooks`をワーカーコンテナーにマウントする処理も行います。

## リクエスト {#request}

| ヘッダー              | 値                                                                    |
| --------------------- | --------------------------------------------------------------------- |
| `Content-Type`        | `application/json`                                                    |
| `X-Arkvory-Delivery`  | イベントの`id`。同じイベントの再配信では常に同じです                  |
| `X-Arkvory-Event`     | フィードのアクション。例：`artifact.publish`                          |
| `X-Arkvory-Timestamp` | リクエストに署名した時刻。秒単位のUnix時刻                            |
| `X-Arkvory-Signature` | `sha256=<hex>`。ローテーション中は、カンマで区切った2つの値になります |

ボディはJSONです。

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

`sequence`はフィード内の位置を表す10進文字列です。`detail`は、該当するアクションの場合、ファイルパスまたはステージです。ボディには、実行者、ファイルの内容、メタデータはありません。`artifactId`を使って[API](../api/index)から現在の状態を読み取ってください。

10秒以内に、任意の`2xx`ステータスで応答してください。`3xx`（リダイレクトは追跡しません）、`4xx`、`5xx`、接続エラー、タイムアウトは失敗として扱います。Arkvoryは応答を最大4 KiB読み取り、無視します。

## 署名を検証する {#verify}

署名は、シークレットを使ってテキスト`<timestamp>.<body>`に対して計算するHMAC-SHA256です。`sha256=`に16進ダイジェストを続けた形式です。リクエストを信頼する前に確認してください。

1. JSONを解析する前の、生のボディを読み取ります。
2. タイムスタンプが自身の時計と5分を超えて異なる場合は、リクエストを拒否します。
3. 署名を計算し、定数時間の比較関数で照合します。ヘッダーに2つの値がある場合は、どちらかと一致すれば受け付けます。

Node.js：

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

Python：

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

## 再配信を処理する {#repeats}

- 処理した各イベントの`id`を保存し、再配信は無視します。
- すばやく応答します。作業をキューに入れて`204`を返してください。遅い受信側は、そのサブスクリプションの後続イベントすべてを遅らせます。
- 再配信は、操作が2回実行されたという意味ではありません。イベントを変更の手掛かりとして扱い、APIから現在の状態を読み取ってください。

## シークレットをローテーションする {#rotate-the-secret}

1. 現在のシークレットを`--webhook-secret-file`、新しいものを`--webhook-next-secret-file`に指定して、同じコマンドを実行します。以後、各リクエストに2つの署名が付きます。
2. 受信側を新しいシークレットに切り替えます。どちらの署名も受け付ける受信側は、この間も動作を続けます。
3. 新しいシークレットのファイルを`--webhook-secret-file`に指定し、`--webhook-next-secret-file`を省いて、コマンドを再実行します。

## プライベートな受信先と証明書 {#private-receivers}

- Arkvoryは、ループバック、プライベート、リンクローカル、クラウドのメタデータアドレス上の受信先と、それらに解決される名前を拒否します。サーバーが内部サービスへのアクセスに悪用されるのを防ぐためです。
- 自身のネットワーク内の受信先に送信するには、`--webhook-allow-private`でネットワークを追加します。例：`--webhook-allow-private 10.20.0.0/16`（`ARKVORY_WEBHOOKS_ALLOW_PRIVATE`）。最後のサブスクリプションを削除するまで、この設定は残ります。
- 独自の認証局による証明書を使う受信先には、`--webhook-ca-file`（`ARKVORY_WEBHOOKS_CA_FILE`）で、その認証局を含むPEMファイルを追加します。証明書は常に検証します。

## Webhookを監視する {#monitor}

配信に失敗すると、ワーカーは`errorCode`を含む`webhook.step_failed`を書き込み、再び成功すると`webhook.recovered`を書き込みます。メトリクス`arkvory_webhook_failing`、`arkvory_webhook_last_success_timestamp_seconds`、アラート`ArkvoryWebhookFailing`は、[監視](../operate/monitoring)に記載しています。`webhook.stopped`は、終了時やワーカーがストレージの所有権を失ったときに、サブスクリプションのループが終了したことを示します。`webhook.prune_failed`は、起動時に削除済みサブスクリプションの記録を破棄できなかったことを意味します。次回起動時に再試行します。コード`unavailable`と`internal`はログにだけ表示され、`arkvory_webhook_failing`には現れません。

## 進まないサブスクリプション {#stuck}

Arkvoryはイベントを飛ばしません。それが配信の信頼性を支えます。そのため、たとえば解析できずに`400`を返し続けるなど、受信側が1件のイベントを拒否し続けると、そのサブスクリプション全体が止まります。そのサブスクリプションの後続イベントは送信せず、他のサブスクリプションは動作を続けます。ワーカーは`http_4xx`を含む`webhook.step_failed`を書き込み、最大1時間の間隔で再試行します。`arkvory_webhook_failing`は`1`となり、15分後にアラート`ArkvoryWebhookFailing`が発火します。

1. そのイベントに`2xx`で応答するよう、受信側を修正します。Arkvoryは次の再試行時、遅くとも約1時間後に送信し、その後、待機中のすべてのイベントを順に送ります。同じ名前とリポジトリで`configure`を再実行しても、位置は保持します。
2. そのイベントをどうしても受け付けられない場合は、`--webhook-detach`でサブスクリプションを削除してから、再度追加します。フィードの末尾から開始するため、待機中のイベントは**送信されません**。受信側が最後に処理した`sequence`より後のイベントを、[変更フィード](../api/reference/artifacts#listCatalogChanges)から読み取ってください。

## トラブルシューティング {#troubleshooting}

| `errorCode`   | 原因と対処                                                                                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blocked`     | 受信先のアドレスが許可されていません（ループバック、プライベート、リンクローカル、メタデータ）。公開アドレスを使うか、`ARKVORY_WEBHOOKS_ALLOW_PRIVATE`にネットワークを追加してください |
| `timeout`     | 10秒以内に応答がありません。より早く応答し、作業をキューに入れてください                                                                                                               |
| `network`     | 接続拒否、名前が見つからない、接続リセット。サーバーからURL、DNS、ファイアウォールを確認してください                                                                                   |
| `tls`         | 証明書が信頼されていない、期限切れ、または名前が間違っています。修正するか、`ARKVORY_WEBHOOKS_CA_FILE`を設定してください                                                               |
| `redirect`    | 受信側が`3xx`を返しました。リダイレクトは追跡しないため、最終的なURLを使ってください                                                                                                   |
| `http_4xx`    | 受信側がリクエストを拒否しました。署名検証、パス、キーを確認してください                                                                                                               |
| `http_5xx`    | 受信側で失敗しました。Arkvoryは最大1時間の間隔で再試行を続けます                                                                                                                       |
| `secret`      | シークレットのファイルがない、読み取れない、または16バイト未満です                                                                                                                     |
| `unavailable` | ワーカーがデータベースからフィードまたはサブスクリプションの状態を読み取れませんでした。何も送信せず、5秒後に再試行します。データベースを確認してください                              |
| `internal`    | ワーカーで予期しないエラーが発生しました。何も送信せず、5秒後に再試行します。ワーカーログを添えて報告してください                                                                      |

何も届かない場合は、ワーカーログに`webhook.started`があること、`ARKVORY_WEBHOOKS_FILE`が設定されていること、リポジトリ名、`actions`フィルターを確認してください。新しいサブスクリプションは、最初の処理ステップより後のイベントだけを送信します。

## 関連ページ {#related-pages}

- [設定](../install/configuration)
- [監視](../operate/monitoring)
- [APIリファレンスの変更フィード](../api/reference/artifacts#listCatalogChanges)
