---
title: HTTPSとリバースプロキシ
description: 内蔵TLSまたはリバースプロキシで他のコンピューターからArkvoryに安全に接続できるようにし、別のアドレスのコンソールとCORSを設定します。
---

# HTTPSとリバースプロキシ

新しいインストールは、平文HTTPで`127.0.0.1:8080`を待ち受けます。接続できるのはサーバー上のプログラムだけです。他のコンピューターからクライアントが接続する前に、HTTPSを設けてください。キー、パスワード、ダウンロードリンクはリクエストで送られます。コンピューター間で平文HTTPを使って送信しないでください。

## 方法を選ぶ {#choose}

| 項目                       | 内蔵TLS                                               | リバースプロキシ                                     |
| -------------------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| インストール               | WindowsサービスとLinux（ネイティブ）。Composeは非対応 | すべて。Composeでは唯一の方法です                    |
| セットアップ               | ロールバックを備えた1回の`arkvory configure`コマンド  | プロキシの設定と、Arkvoryの`ARKVORY_TRUSTED_PROXIES` |
| ポート                     | APIのポート。既定は8080                               | 443など任意                                          |
| 証明書の更新               | APIが更新済みファイルを自動で読み取ります             | プロキシが処理します                                 |
| クライアント証明書（mTLS） | 非対応                                                | プロキシで対応可能                                   |

## 始める前に {#before-you-start}

- クライアントが使う名前の証明書を、クライアントが信頼する認証局から取得します。たとえばcertbot、win-acme、組織内の認証局を使います。証明書とそのチェーン、秘密キーが必要で、どちらもPEMファイルにします。キーにパスワードを設定しないでください。
- サーバーを指すDNS名を作成します。
- ファイアウォールではHTTPSポートだけを、クライアントのネットワークに対してのみ開放します。データベースのポート（54329または45329～45348）は開放しないでください。

## 内蔵TLS {#built-in-tls}

### ファイルを準備する {#tls-files}

ファイルは次の条件を満たす必要があります。コマンドは、変更前にすべてを確認します。

- パスは絶対パスです。
- 各ファイルは最大1 MiBのPEMファイルです。証明書ファイルには証明書を置き、その後にチェーンを置きます。
- キーは暗号化されていないPEM秘密キーで、証明書と一致する必要があります。
- 証明書の有効期限が切れていません。
- サービスアカウントが両方のファイルを読み取れます。Linuxでは`arkvory`、Windowsでは`LocalService`です。

Arkvoryはファイルを参照し、コピーはしません。更新時も同じ場所に残るように配置してください。Linuxでは`/home`の下に置かないでください。ユニットからは見えません。証明書ツールによっては、ディレクトリを`root`しか読み取れない場合があります。更新フックなどを使って、更新済みファイルをサービスのグループが読めるディレクトリにコピーしてください。Linuxでの例：

```bash
sudo install -d -m 0750 -o root -g arkvory /etc/arkvory/tls
sudo install -m 0644 -o root -g arkvory fullchain.pem /etc/arkvory/tls/fullchain.pem
sudo install -m 0640 -o root -g arkvory privkey.pem /etc/arkvory/tls/privkey.pem
```

Windowsでは、`LocalService`が読めるフォルダーにファイルを置き、キーを読めるのはSYSTEM、Administrators、`LocalService`だけにしてください。

### 内蔵TLSを有効にする {#tls-enable}

1. パスと待ち受けるアドレスを指定してコマンドを実行します。`0.0.0.0`はすべてのIPv4インターフェイス、`::`はすべてのインターフェイスで待ち受けます。1つのインターフェイスのアドレスを指定することもできます。

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

   コマンドは`config/runtime.json`に`ARKVORY_TLS_CERT_FILE`、`ARKVORY_TLS_KEY_FILE`、`ARKVORY_HOST`を書き込み、サービスを再起動して、APIがHTTPS経由の準備状態チェックに応答するまで待ちます。チェックは設定した証明書だけを受け付けます。成功すると、証明書の有効期限の日付を表示します。何かに失敗した場合は、以前の`runtime.json`を復元し、その設定でサービスを再起動して、理由を報告します。

2. ファイアウォールで、クライアントのネットワークに対してAPIポートを開放します。
3. クライアントのコンピューターからテストします。`ARKVORY_PORT`を変更しなければ、ポートは8080のままです。

   ```bash
   curl https://arkvory.example.com:8080/health/status
   ```

   応答はステータス200で、`{"status":"ready"}`です。コンソールのアドレスは`https://arkvory.example.com:8080/console/`です。

Linuxのサービスアカウントは、通常1024未満のポートで待ち受けられません。ポート443でHTTPSを提供するには、[リバースプロキシ](#reverse-proxy)を使ってください。

起動時に証明書が無効な場合、APIはエラーで停止します。平文HTTPに切り替わることはありません。

### 設定 {#tls-settings}

`configure`はファイルとアドレスを設定します。他の2つの設定は、手動で`runtime.json`に追加します。変更後はサービスを再起動してください。[変更を適用する](./configuration#apply-change)を参照してください。

| 変数                         | 既定値    | 意味                                                                                |
| ---------------------------- | --------- | ----------------------------------------------------------------------------------- |
| `ARKVORY_TLS_MIN_VERSION`    | `TLSv1.2` | `TLSv1.2`または`TLSv1.3`                                                            |
| `ARKVORY_TLS_RELOAD_SECONDS` | `300`     | APIが証明書ファイルを再読み込みする間隔。30～86400秒。`0`なら起動時だけ読み取ります |

すべての応答に`Strict-Transport-Security: max-age=31536000`が付きます。

### 証明書を更新する {#tls-renewal}

更新した証明書とキーを同じパスに書き込みます。コマンドも再起動も不要です。

- APIは`ARKVORY_TLS_RELOAD_SECONDS`ごとにファイルを比較します。新しい接続は新しい証明書を使います。既存の接続は終了まで古い証明書を使い続けます。
- 不正な更新（読み取れないファイル、一致しないキー、期限切れの証明書）で、動作中の証明書が置き換わることはありません。APIは`tls.reload_failed`を記録し、次の間隔で再試行します。
- 有効期限までの最後の14日間、APIは1日1回`tls.expiring`を記録します。メトリクス`arkvory_tls_certificate_expiry_timestamp_seconds`をアラートに使えます。[監視](../operate/monitoring)を参照してください。

### 内蔵TLSを無効にする {#tls-off}

```bash
sudo arkvory configure --root /opt/proanima-arkvory --tls-off --listen-host 127.0.0.1
```

`--tls-off`だけでは待ち受けアドレスがそのまま残ります。`--listen-host 127.0.0.1`を指定しないと、開放したすべてのインターフェイスでAPIが平文HTTPを提供することになります。

## リバースプロキシ {#reverse-proxy}

プロキシはクライアントからHTTPSを受け付け、APIに平文HTTPで転送します。APIを`127.0.0.1:8080`のままにし、同じホストにプロキシをインストールします。Composeのインストールは常に`127.0.0.1:8080`だけを公開するため、ホスト上のプロキシをそのまま接続できます。

1. プロキシをインストールし、その証明書を取得します。
2. [プロキシに必要な動作](#proxy-requirements)の手順でプロキシを設定します。
3. `ARKVORY_TRUSTED_PROXIES`にプロキシのアドレスを追加します。[信頼済みプロキシ](#trusted-proxies)を参照してください。
4. 他のコンピューターからAPIポートに到達できないことを確認します。
5. テストします：`curl https://arkvory.example.com/health/status`が`{"status":"ready"}`を返します。

### プロキシに必要な動作 {#proxy-requirements}

| 要件                                                                                                             | 理由                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 任意のサイズのリクエストボディを受け付ける（nginxでは`client_max_body_size 0`）                                  | ファイルは数十ギガバイト以上になります。パートは最大1 GiBです                                                 |
| リクエストボディもレスポンスボディもバッファリングしない（`proxy_request_buffering off`、`proxy_buffering off`） | バイト列をストリーミングします。バッファリングはプロキシのディスクを使い果たし、転送を遅らせます              |
| 少なくとも1900秒のリクエストを許可する（`proxy_read_timeout`、`proxy_send_timeout`）                             | アップロードリクエスト1件には最大30分かかる場合があります（`ARKVORY_UPLOAD_DEADLINE_MS`、既定で1 800 000 ms） |
| APIとはHTTP/1.1で通信し、接続を維持する                                                                          | ストリーミングに必要です                                                                                      |
| `Host`で公開名を転送する                                                                                         | サーバーは、Git LFSやnpmの応答内のリンクなど、絶対リンクをその値から組み立てます                              |
| `X-Forwarded-For`と`X-Forwarded-Proto: https`を送信する                                                          | ログとサインイン制限に使うクライアントのアドレス、および絶対リンクのスキームのためです                        |
| `X-Request-Id`をプロキシ自身のIDで上書きする                                                                     | APIは信頼済みプロキシからのIDを保持します。クライアントに選ばせてはいけません                                 |
| アクセスログにクエリ文字列を書き込まない                                                                         | ダウンロードリンクは`?token=`に秘密情報を含みます                                                             |
| 必要なら`Strict-Transport-Security`をプロキシ自身で設定する                                                      | APIがこのヘッダーを送るのは内蔵リスナーからだけです                                                           |

### nginx {#nginx}

既存のnginxの`http`コンテキストに次を配置します。名前と証明書のパスを置き換えてください。`log_format`はクエリ文字列を除いたパスを書き込みます。

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

この設定では、`ARKVORY_TRUSTED_PROXIES`にプロキシを列挙します。例：`127.0.0.1`。ディレクティブ`proxy_set_header X-Request-Id $request_id`は残す必要があります。クライアントが送信する可能性のあるIDを上書きするためです。

### Caddy {#caddy}

```caddyfile
arkvory.example.com {
    reverse_proxy 127.0.0.1:8080 {
        header_up X-Request-Id {http.request.uuid}
        flush_interval -1
    }
}
```

Caddyは証明書を自動で取得し、リクエストボディをストリーミングします。既定ではボディサイズの制限もアップストリームのタイムアウトもなく、`X-Forwarded-For`、`X-Forwarded-Proto`、`X-Forwarded-Host`を設定します。`log`を有効にしなければ、Caddyはアクセスログを書き込みません。有効にする場合は、記録するアドレスからクエリ文字列を取り除いてください。

### IISとその他のプロキシ {#iis}

このプロジェクトの参照設定は、上記のnginxファイルです。以下は、Application Request RoutingとURL Rewriteを備えたIISの同等の設定です。このプロジェクトでは検証していません。使用するIISバージョンで名前を確認してください。

- サーバープロキシのタイムアウトを少なくとも1900秒に延ばし、応答バッファーのしきい値を`0`に設定します。
- リクエストフィルターの`maxAllowedContentLength`を最大の4 294 967 295バイトに引き上げます。IISは4 GiB以上のリクエストボディを受け付けられないため、そのサイズのファイルを単一の`curl -T`でアップロードすると失敗します。`arkvoryctl`は大きなファイルをパートに分けて送信します。
- 元のホスト、`X-Forwarded-Proto: https`、`X-Forwarded-For`内のクライアントのアドレスを送信します。URL Rewriteのルールで、新しい`X-Request-Id`を設定してください。
- IISのログにクエリ文字列を残さないでください。

### 信頼済みプロキシ {#trusted-proxies}

`ARKVORY_TRUSTED_PROXIES`には、最大32個のアドレスまたはCIDR範囲をカンマで区切って指定できます。ホスト名とワイルドカードは拒否します。これらのアドレスから来たリクエストだけが、次を設定できます。

- `X-Forwarded-For`によるクライアントのアドレス。APIは、信頼されていない最も近いアドレスを採用します。
- `X-Request-Id`によるリクエストID。
- `X-Forwarded-Host`による絶対リンクのホスト。

この一覧がない場合、すべてのクライアントがプロキシのアドレスから接続しているように見えます。そのため、サインイン制限は全員を1つのクライアントとして数え、アクセスログの`clientIp`にはプロキシのアドレスが表示されます。自身が管理するプロキシだけを列挙してください。

Composeホストでは、APIから見たプロキシのアドレスが`127.0.0.1`ではなく、Composeネットワークのゲートウェイのアドレスになる場合があります。プロキシ経由でリクエストを1件送信し、APIログの`http.access`レコードで`clientIp`を探し、そのアドレスを列挙してください。

`config/runtime.json`を編集し、サービスを再起動します。[変更を適用する](./configuration#apply-change)を参照してください。

```json
{ "ARKVORY_TRUSTED_PROXIES": "127.0.0.1,::1" }
```

APIがTLSも信頼済みプロキシもなく、ループバック以外のアドレスで待ち受ける場合、起動時に`http.plaintext_exposed`を記録します。正しいプロキシ設定では、この記録は出ません。

## コンソールとAPIのアドレス {#console-api-address}

Arkvoryが提供するコンソールは、開いたときのアドレスを使います。通信先は自身のサーバーだけです。コンテンツセキュリティポリシーが他のアドレスを許可しません。プロキシの背後でも、変更せずに`https://arkvory.example.com/console/`で動作します。

コンソールを、ポータルの隣など、別のWebサーバーでホストするには、次の手順を行います。

1. インストールルート内の`releases/<version>/apps/web/public/`から、別のサーバーにコンソールのファイルをコピーします。HTTPSで、パス`/console/`に配置し、`.js`と`.css`に正しいMIMEタイプを設定して配信します。Arkvoryを更新するたびに再度コピーしてください。
2. コピーした`index.html`で、Arkvoryのアドレスを設定します。

   ```html
   <meta name="arkvory-api-base-url" content="https://arkvory.example.com/" />
   ```

3. 別のサーバーがコンテンツセキュリティポリシーを設定する場合は、Arkvoryのアドレスへの`connect-src`を許可し、ローカルのスクリプトワーカーを許可します。
4. Arkvoryでコンソールのオリジンを許可します。[CORS](#cors)を参照してください。

### CORS {#cors}

別のアドレスのWebアプリケーションのオリジンを`ARKVORY_CORS_ORIGINS`に設定し、APIを再起動します。

```json
{ "ARKVORY_CORS_ORIGINS": "https://portal.example.com,https://tools.example.com" }
```

- 一覧には最大16個のオリジンを指定できます。各オリジンにはスキーム、ホスト、任意のポートがあり、パスは含めません。HTTPSが必要です。平文HTTPを受け付けるのは`localhost`、`127.0.0.1`、`[::1]`だけです。
- CORSは`/api/v1/*`と`/health/ready`に適用します。一覧にないオリジンからのリクエストは、理由`origin_not_allowed`でステータス403になります。サーバー自身のアドレスからのリクエストには、エントリは不要です。
- 一覧にあるオリジンに権限が付与されるわけではありません。各リクエストには引き続きキーまたはセッションが必要で、サーバーのアクセスチェックを受けます。Webアプリケーションは、Cookieではなく`Authorization`ヘッダーでキーを送信します。
- 許可されるメソッドはGET、HEAD、POST、PUT、PATCH、DELETEです。ブラウザーはプリフライトリクエストへの応答を10分間キャッシュできます。

プリフライトリクエストをテストします。応答はステータス204で、`Access-Control-Allow-Origin`に指定したオリジンが含まれている必要があります。

```bash
curl -i -X OPTIONS https://arkvory.example.com/api/v1/auth/me \
  -H 'Origin: https://portal.example.com' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'
```

## 設定を確認する {#check}

1. `curl https://arkvory.example.com/health/status`がステータス200と`{"status":"ready"}`を返します。証明書チェーンの検証が例外なしで成功します。
2. コンソールを開いてサインインし、同じアドレス経由で大きなファイルをアップロードします。
3. HTTPSアドレスを使うプロファイルで`arkvoryctl doctor`を実行します。クライアントで証明書の検証を無効にしないでください。コマンドラインクライアントでは無効にできず、平文HTTPを受け付けるのはローカルコンピューターだけです。[コマンドラインクライアント](../protocols/cli)を参照してください。
4. APIを再起動した後、ログに`http.plaintext_exposed`レコードがありません。

## トラブルシューティング {#troubleshooting}

| 問題                                                                         | 原因と対処                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HTTPS was not enabled; the previous configuration is restored`              | メッセージの続きに理由があります。ファイルがPEMでない、キーにパスワードがある、キーが一致しない、証明書の有効期限が切れている、サービスアカウントがファイルを読めない、のいずれかです。修正してコマンドを再実行してください |
| `TLS files must be given as absolute paths`                                  | 完全なパスを指定してください                                                                                                                                                                                                |
| `Built-in TLS is for native installations; use a reverse proxy with Compose` | Composeには内蔵TLSがありません。[リバースプロキシ](#reverse-proxy)を使ってください                                                                                                                                          |
| プロキシからステータス413が返る                                              | ボディの制限が小さすぎます。nginxでは`client_max_body_size 0`を使ってください                                                                                                                                               |
| ステータス502または504、あるいは数分後にアップロードが途切れる               | プロキシがボディをバッファリングしているか、タイムアウトが1900秒より短くなっています                                                                                                                                        |
| 全員がサインイン制限を受ける、または`clientIp`が常にプロキシになる           | プロキシが`ARKVORY_TRUSTED_PROXIES`にありません                                                                                                                                                                             |
| Git LFSやnpmの応答のリンクに`http`や内部の名前が表示される                   | プロキシが`Host`または`X-Forwarded-Proto: https`を転送していません                                                                                                                                                          |
| ブラウザーアプリケーションが403 `origin_not_allowed`を受け取る               | そのオリジンを`ARKVORY_CORS_ORIGINS`に追加し、再起動してください                                                                                                                                                            |

その他のヒントは、[トラブルシューティング](../operate/troubleshooting)と[セキュリティ](../operate/security)を参照してください。
