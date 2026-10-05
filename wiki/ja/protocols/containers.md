---
title: コンテナーイメージ
description: 各リポジトリが/v2に持つレジストリを使って、DockerおよびOCIのイメージ、Helmチャート、ORASアーティファクトをプッシュ／プルします。
---

# コンテナーイメージ

Arkvoryのすべてのリポジトリは、コンテナーレジストリでもあります。Docker、Podman、Buildx、containerd、Helm、ORASは、OCI Distributionプロトコルを使って、レジストリにプッシュし、レジストリからプルします。イメージのレイヤーとマニフェストは、通常のアーティファクトとして保存されます。リポジトリの権限、クォータ、SHA-256検証、バックアップ、ミラーは、ほかのファイルと同じように適用されます。

## 始める前に {#before-you-start}

次のものが必要です。

- HTTPSと信頼された証明書を備えたサーバーのアドレス（例：`arkvory.example`）。[HTTPS](../install/https)を参照してください。
- リポジトリ（例：`releases`）。
- キー：個人用アクセストークンまたはサービスキー。[アカウントとキー](../use/accounts)を参照してください。

レジストリは、ホストのルートの`/v2/`で応答します。Dockerはパスのプレフィックスに対応していないため、`https://example.com/arkvory/`のようなパスのプレフィックスの下では動作しません。リバースプロキシは、`/v2/`をそのまま通し、リクエストボディをバッファリングしてはいけません。nginxでは、`client_max_body_size 0`を設定し、リクエストのバッファリングをオフにします。

## イメージ名 {#image-names}

イメージ参照は、次の形式です。

```text
<host>/<repository>/<image>:<tag>
<host>/<repository>/<image>@sha256:<digest>
```

パスの最初のセグメントが、Arkvoryのリポジトリです。これがアクセスの境界になります。キーには、許可されたリポジトリだけが見えます。残りの部分がイメージ名で、1つ以上のコンポーネントからなります。

| 参照                                        | リポジトリ | イメージ        | 参照部分     |
| ------------------------------------------- | ---------- | --------------- | ------------ |
| `arkvory.example/releases/web:1.4`          | `releases` | `web`           | タグ`1.4`    |
| `arkvory.example/releases/team/web:1.4`     | `releases` | `team/web`      | タグ`1.4`    |
| `arkvory.example/qa/tools/builder@sha256:…` | `qa`       | `tools/builder` | ダイジェスト |

| 部分         | ルール                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| リポジトリ   | 小文字の英字、数字、`_`、`-`。英字または数字で始まります。最大64文字。                                                                     |
| イメージ     | `/`で区切られたコンポーネント。コンポーネントは小文字の英字と数字からなり、`.`、`_`、`__`、またはハイフンでつなぎます。全体で最大200文字。 |
| タグ         | 英字、数字、`_`、`.`、`-`。英字、数字、または`_`で始まります。最大128文字。                                                                |
| ダイジェスト | `sha256:`と、小文字の16進数64桁。ほかのアルゴリズムは拒否されます。                                                                        |

`arkvory.example/web:1.4`のように、イメージ部分のない参照は、`NAME_INVALID`で拒否されます。`web`がリポジトリとして扱われ、イメージ名が空になるためです。

## ログインする {#log-in}

レジストリは、ArkvoryのキーをHTTP Basic認証のパスワードとして受け取ります。ユーザー名は検証されないため、任意の名前（たとえばCIジョブの名前）を使えます。リクエストで、キーを`Authorization: Bearer <key>`として送ることもできます。別途トークンサービスは必要ありません。

```bash
docker login arkvory.example -u ci --password-stdin < ~/.arkvory/key
```

```powershell
Get-Content C:\Private\arkvory.key | docker login arkvory.example -u ci --password-stdin
```

ほかのクライアントも、同じ方法でログインします。

```bash
podman login arkvory.example -u ci --password-stdin < ~/.arkvory/key
helm registry login arkvory.example -u ci --password-stdin < ~/.arkvory/key
oras login arkvory.example -u ci --password-stdin < ~/.arkvory/key
```

| キー                                           | 用途                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| 個人用アクセストークン（スコープ`read`）       | ワークステーションでのプル                                                      |
| 個人用アクセストークン（スコープ`read-write`） | ワークステーションからのプッシュ                                                |
| サービスキー                                   | CI/CDとデプロイエージェント。イメージを削除できるのは、この種類のキーだけです。 |
| サーバーのキーファイルにあるファイルキー       | インストールの所有者と従来の連携（`read`または`write`）                         |

個人用トークンには有効期限があります。期限が切れると、すべてのリクエストが`401 UNAUTHORIZED`になります。新しいトークンを作成して、もう一度ログインしてください。認証情報ヘルパーを設定しない限り、Dockerはキーを`~/.docker/config.json`に保存します。このファイルを保護するか、認証情報ストアを使用してください。

## プッシュとプル {#push-and-pull}

```bash
docker tag web:1.4 arkvory.example/releases/team/web:1.4
docker push arkvory.example/releases/team/web:1.4
docker pull arkvory.example/releases/team/web:1.4
docker pull arkvory.example/releases/team/web@sha256:<digest>
```

レジストリの動作は次のとおりです。

- リポジトリがすでに保持しているレイヤーは、別のイメージで使われている場合でも、再度保存されません。
- レイヤーは、リポジトリ間で共有されません。別のリポジトリからレイヤーをマウントするリクエストには、通常のアップロードセッションが返されるため、クライアントはレイヤーをもう一度送信します。
- すべてのレイヤーとマニフェストは、そのSHA-256ダイジェストと照合されます。不一致の場合は、何も保存されず、`DIGEST_INVALID`が返されます。
- マニフェストが受け付けられるのは、参照先がすべてリポジトリにすでに存在する場合だけです。イメージのconfigとレイヤー、またはインデックスのプラットフォーム別マニフェストです。プラットフォーム別マニフェストは、そのインデックスと同じイメージ内にある必要があります。そうでない場合の応答は、`MANIFEST_BLOB_UNKNOWN`です。
- レイヤーのダウンロードは、`Range`リクエストに対応しています。

レジストリが受け付けるマニフェストの種類は、次のとおりです。

| メディアタイプ                                              | 用途                                                           |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| `application/vnd.oci.image.manifest.v1+json`                | OCIイメージ、Helmチャート、ORASアーティファクト                |
| `application/vnd.oci.image.index.v1+json`                   | マルチプラットフォームイメージ、BuildKitのレジストリキャッシュ |
| `application/vnd.docker.distribution.manifest.v2+json`      | Dockerイメージ（スキーマ2）                                    |
| `application/vnd.docker.distribution.manifest.list.v2+json` | Dockerのマルチプラットフォームイメージ                         |

マニフェストには`schemaVersion: 2`が必要で、サイズは最大4 MiBです。Dockerのスキーマ1には対応していません。種類は、`Content-Type`ヘッダー、またはマニフェストの`mediaType`フィールドから決まり、両方が一致している必要があります。プルでは、マニフェストは、プッシュされたとおりに、そのメディアタイプのまま返されます。レジストリが形式を変換することはありません。

### マルチプラットフォームイメージ {#multi-platform-images}

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t arkvory.example/releases/team/web:1.4 --push .
```

Buildxは、各プラットフォームのマニフェストをダイジェスト指定でプッシュし、その後でインデックスをタグ付きでプッシュします。レジストリの要件に従い、すべて同じイメージ名にプッシュされます。

### ビルドキャッシュ {#build-cache}

キャッシュをエクスポートできるBuildKitビルダー（たとえば、`docker-container`ドライバーを使う`docker buildx`ビルダー）は、レジストリキャッシュをArkvoryに保存できます。

```bash
docker buildx build \
  --cache-from type=registry,ref=arkvory.example/releases/team/web:cache \
  --cache-to type=registry,ref=arkvory.example/releases/team/web:cache,mode=max \
  -t arkvory.example/releases/team/web:1.4 --push .
```

キャッシュのインデックスには、レイヤーとキャッシュの構成が一覧されます。Arkvoryはそれらをイメージのblobとして保存し、保存されたマニフェストのレイヤーと同じように保護します。

### Helmチャート {#helm-charts}

Helmは、チャートをOCIアーティファクトとして保存します。`helm registry login`の後で、次のように操作します。

```bash
helm push web-1.4.0.tgz oci://arkvory.example/releases/charts
helm pull oci://arkvory.example/releases/charts/web --version 1.4.0
helm install web oci://arkvory.example/releases/charts/web --version 1.4.0
```

チャートは、リポジトリ`releases`にある、タグが`1.4.0`のイメージ`charts/web`になります。Arkvoryには、`index.yaml`ファイルを持つ従来のチャートリポジトリはありません。

### ORASアーティファクト {#oras-artifacts}

ORASは、任意のファイルをOCIマニフェストのレイヤーとして保存します。

```bash
oras push arkvory.example/releases/tools/settings:1.0 ./settings.json:application/json
oras pull arkvory.example/releases/tools/settings:1.0
```

Referrers APIは利用できません。`/v2/<name>/referrers/<digest>`は`404`を返します。その場合、ORASなどOCI仕様に従うクライアントは、関連付けられたアーティファクトを、ダイジェストにちなんだ名前のタグの下に保持します。

## タグとダイジェスト {#tags-and-digests}

- マニフェストをタグ付きでプッシュすると、タグが移動します。それまでそのタグが指していたマニフェストはレジストリに残り、ダイジェストを指定してプルできます。
- ダイジェスト指定のプッシュ（`PUT /v2/<name>/manifests/sha256:…`）は、タグなしでマニフェストを保存します。ダイジェストは、本文のSHA-256である必要があります。
- タグはバイト順に一覧されるため、大文字は小文字より前に並びます。

イメージのタグを一覧表示します。

```bash
curl -fsS -u "ci:$ARKVORY_KEY" https://arkvory.example/v2/releases/team/web/tags/list
```

応答は`{"name": "releases/team/web", "tags": [...]}`です。ページサイズには`n`（既定は100、最大1000）、前のページの最後のタグには`last`を使います。さらにタグがある場合、`Link`ヘッダーに次のページのアドレスが含まれます。

タグのダイジェストを調べます。

```bash
curl -fsSI -u "ci:$ARKVORY_KEY" \
  https://arkvory.example/v2/releases/team/web/manifests/1.4 | grep -i docker-content-digest
```

すべてのイメージのカタログ（`/v2/_catalog`）はありません。コンソールでは、レイヤーとマニフェストが、ラベル`oci`の付いたリポジトリのアーティファクトとして、ダイジェストの名前で表示されます。[[ui:catalog]]で[[ui:labelFilter]]を使うと、それらを表示できます。

## イメージの削除と容量の解放 {#delete-images}

イメージの削除は、レジストリAPIで行います。Dockerのコマンドラインには削除のコマンドがないため、`curl`、`oras manifest delete`、またはほかのレジストリツールを使います。

| リクエスト                             | 効果                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| `DELETE /v2/<name>/manifests/<tag>`    | タグだけを削除します。マニフェストは残り、ダイジェストを指定してプルできます。 |
| `DELETE /v2/<name>/manifests/<digest>` | マニフェストと、それを指すすべてのタグを削除します                             |
| `DELETE /v2/<name>/blobs/<digest>`     | `405`で拒否されます。レイヤーは、そのマニフェストとともに削除されます。        |

どちらの削除にも、リポジトリで`artifact.delete`の操作を持つサービスキーが必要です。個人用トークン、コンソールのセッション、ファイルキーでは、イメージを削除できません。削除は`202`で応答します。

```bash
curl -fsS -X DELETE -H "Authorization: Bearer $ARKVORY_CLEANUP_KEY" \
  https://arkvory.example/v2/releases/team/web/manifests/sha256:<digest>
```

容量が空く仕組みは、次のとおりです。

1. マニフェストが保存されている間は、タグの有無にかかわらず、Arkvoryがそのマニフェストと、それが参照するすべてのレイヤーを保護します。保持ルールは、ブロッカー`reference`によってこれらをスキップします。
2. タグの移動や削除では、何も解放されません。古いマニフェストは、ダイジェストを指定してそのマニフェストを削除するまで、レイヤーを保持し続けます。
3. ダイジェスト指定でマニフェストを削除すると、そのアーティファクトと、ほかのマニフェストが使っていないレイヤーは、この保護を失います。これらは、保持ルールで削除するか、アーティファクトとして削除するまで、保存されたままです。[ストレージ](../operate/storage)を参照してください。
4. マニフェストなしでプッシュされたレイヤー（たとえば、失敗したプッシュで残ったもの）は、保護されません。
5. 削除されたレイヤーが再び必要になると、レジストリはそれを不明として報告し、次のプッシュで再びアップロードされます。

## 権限 {#permissions}

個人用トークンとファイルキーには、リポジトリへの読み取りまたは書き込みアクセスが付与されます。サービスキーには、許可する操作を正確に指定します。

| 操作                         | サービスキーの操作                                 | 個人用トークンまたはファイルキー                         |
| ---------------------------- | -------------------------------------------------- | -------------------------------------------------------- |
| マニフェストとレイヤーのプル | `content.read`                                     | 読み取りアクセス                                         |
| タグの一覧表示               | `artifact.list`                                    | 読み取りアクセス                                         |
| プッシュ                     | `upload.create`、`upload.write`、`upload.complete` | 書き込みアクセス。トークンにはスコープ`read-write`が必要 |
| タグまたはマニフェストの削除 | `artifact.delete`                                  | 不可                                                     |

プッシュを行うCIのキーは、通常、ベースイメージやビルドキャッシュなどのプルも行います。`content.read`と`artifact.list`も付与してください。キーに許可されていないリポジトリには、`403 DENIED`が返されます。

## 読み取りゲートウェイとミラー {#read-gateways-and-mirrors}

- [読み取りゲートウェイ](../operate/read-gateways)は、プルに応答します。プッシュには`405`が返されます。
- [ミラー](../operate/mirrors)は、ソースのイメージを、そのタグと削除とともに受け取ります。クライアントは、ミラー自身のアドレスからプルします。プッシュには、理由が`mirror_read_only`の`409 DENIED`が返されます。

## 制限 {#limits}

| 制限                        | 値                                                                                                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| マニフェストのサイズ        | 4 MiB                                                                                                                                                                                   |
| レイヤーのサイズ            | インストールで許可される最大のオブジェクト、`ARKVORY_MAX_OBJECT_BYTES`（既定は約10 TiB）                                                                                                |
| 1回のアップロードリクエスト | 30分以内に完了する必要があり、30秒を超えて停止してはいけません（`ARKVORY_UPLOAD_DEADLINE_MS`、`ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`）。30分は、設定できる最大値でもあります。                |
| 未完了のアップロード        | 24時間操作がないと、そのバイト列とともに削除されます                                                                                                                                    |
| 一時的なディスク容量        | アップロード中は、レイヤーのサイズの最大2倍                                                                                                                                             |
| 同時アップロード数          | 既定では、キーあたり1、サーバーあたり2（`ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`、`ARKVORY_MAX_UPLOADS`）。待機中のリクエストは、20秒であきらめます（`ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS`）。 |
| 同時ダウンロード数          | 既定では、キーあたり4、サーバーあたり16                                                                                                                                                 |
| ページあたりのタグ数        | 1000                                                                                                                                                                                    |
| クォータ                    | レイヤー、マニフェスト、未完了のアップロードのバイト数は、リポジトリのクォータとインストールの容量に計上されます                                                                        |

Dockerは、各レイヤーを1つのリクエストで送信します。そのため、レイヤーはアップロードの期限内に届く必要があり、レイヤーのアップロードに失敗すると、最初のバイトからやり直しになります。数ギガバイトのファイルには、代わりに[`arkvoryctl`](./cli)を使ってください。パートに分けてアップロードし、失敗後も続行できます。変数については、[環境変数](../reference/environment#transfers-and-bandwidth)で説明しています。

## 非対応の機能 {#not-supported}

- Referrers API。`404`を返し、クライアントはタグにフォールバックします。
- すべてのイメージのカタログ、`/v2/_catalog`。
- 別のリポジトリからのレイヤーのマウント。クライアントがレイヤーをもう一度アップロードします。
- Bearerトークン用のトークンサービス。キー自体を、BasicまたはBearerで送信してください。
- Docker Hubやほかのレジストリのプルスルーキャッシュ。
- Dockerのスキーマ1のマニフェストと、`sha256`以外のダイジェスト。
- 個別のレイヤーの削除。
- コンソールのイメージ用セクション。

## テスト用の平文HTTP {#plain-http-for-tests}

Dockerは、HTTPSのないレジストリを拒否します。既定で平文のHTTPで動作するのは、ローカルコンピューターのアドレス（`localhost`、`127.0.0.0/8`）だけです。別のホストにあるテスト用サーバーでは、Dockerデーモンの設定（Linuxでは`/etc/docker/daemon.json`）の`insecure-registries`に追加し、Dockerを再起動します。

```json
{
  "insecure-registries": ["arkvory.test:8080"]
}
```

Podmanでは、オプション`--tls-verify=false`を使います。平文のHTTPでは、キーが暗号化されずに送信されます。テスト用のネットワークでのみ使用してください。

独自の認証局の証明書を使う場合、LinuxのDockerは`/etc/docker/certs.d/<host>/ca.crt`にあるCAを読み取ります（443以外のポートの場合は、ポートも付けます）。Docker Desktopは、システムの信頼ストアを使用します。

## トラブルシューティング {#troubleshooting}

Dockerは、レジストリのエラーコードを、`denied`や`name invalid`のように小文字とスペースで表示し、その後にサーバーのメッセージを続けます。各エラーには、`detail.requestId`にリクエストIDも含まれます。このIDを管理者に伝えてください。サーバーログでそのリクエストを見つけられます。

| エラー                                            | 原因                                                                                                                                | 対処                                                                                                                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNAUTHORIZED`（401）                             | キーがない、間違っている、期限切れ、または取り消されています                                                                        | 有効なキーでもう一度ログインする                                                                                                                                          |
| `DENIED`（403）                                   | キーに書き込み権限がないか、リポジトリが見えません。スコープ`read`のトークンでは、「Read-only personal access token」が返されます。 | このリポジトリへの書き込みアクセスを持つキーを使う                                                                                                                        |
| `DENIED`（409）                                   | リポジトリがミラーです                                                                                                              | メインサーバーにプッシュする                                                                                                                                              |
| `DENIED`（507）                                   | リポジトリのクォータまたはインストールの容量に達しました。未完了のアップロードも計上されます。                                      | 容量を空けるか、より大きなクォータを依頼する                                                                                                                              |
| `NAME_INVALID`                                    | 参照にリポジトリの後のイメージ部分がないか、大文字が含まれています                                                                  | 小文字で`<host>/<repository>/<image>:<tag>`の形式にする                                                                                                                   |
| `MANIFEST_UNKNOWN`                                | このイメージに、タグまたはダイジェストが存在しません                                                                                | `tags/list`で名前を確認する                                                                                                                                               |
| `MANIFEST_BLOB_UNKNOWN`                           | マニフェストが、このリポジトリにないレイヤーまたはプラットフォーム別マニフェストを参照しています                                    | イメージ全体をもう一度プッシュし、クライアントに不足している部分をアップロードさせる                                                                                      |
| `DIGEST_INVALID`                                  | バイト列がダイジェストと一致しません                                                                                                | もう一度プッシュする。繰り返す場合は、プロキシを確認する。                                                                                                                |
| `TOOMANYREQUESTS`（503または429）                 | このキーの同時転送が多すぎるか、サーバーがビジー状態です                                                                            | 待ってから再試行する。クライアントの並列アップロード数を減らす（たとえば、Dockerデーモンの設定で`"max-concurrent-uploads": 1`）か、管理者に転送制限の引き上げを依頼する。 |
| `http: server gave HTTP response to HTTPS client` | サーバーにHTTPSがありません                                                                                                         | [HTTPS](../install/https)を設定する。テスト用サーバーなら`insecure-registries`を使う                                                                                      |
| `x509: certificate signed by unknown authority`   | Dockerが証明書を信頼していません                                                                                                    | 上で説明したとおりに、CA証明書をインストールする                                                                                                                          |
| `413 Request Entity Too Large`                    | リバースプロキシがリクエストのサイズを制限しています                                                                                | nginxで`client_max_body_size 0`を設定する                                                                                                                                 |
| 大きなレイヤーが30分で止まる                      | 1回のリクエストのアップロード期限です                                                                                               | より高速なネットワークを使うか、そのようなファイルをイメージに含めずに、`arkvoryctl`でアップロードする                                                                    |

## 関連ページ {#related-pages}

- [クライアントとプロトコル](./index)
- [アカウントとキー](../use/accounts)
- [HTTPS](../install/https)
- [ストレージ](../operate/storage)
- [ミラー](../operate/mirrors)と[読み取りゲートウェイ](../operate/read-gateways)
