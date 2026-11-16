---
title: Rawファイル
description: 追加のインストールなしで、curl、wget、PowerShellを使い、1回のHTTPリクエストでパスを指定してファイルを保存・読み取りします。
---

# Rawファイル

リポジトリ内のファイルパスは、Webサーバー上のファイルのように動作します。`PUT`はボディをパスの次のバージョンとして保存します。`GET`は現在のバージョンを返します。`curl`やPowerShellだけを備えたビルドスクリプトやCIジョブから使えます。

3つのメソッドすべてでアドレスは同じです。

```text
https://<host>/api/v1/repositories/<repository>/raw/<path>
```

例：`https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe`。

## ファイルを保存する {#store-a-file}

リポジトリと、書き込みアクセスを持つキーが必要です。[アカウントとキー](../use/accounts)を参照してください。キーは`Authorization: Bearer <key>`として送信します。Rawファイルは、他の認証方式を受け付けません。

```bash
export ARKVORY_KEY="$(cat ~/.arkvory/key)"
URL="https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe"

curl --fail-with-body -sS -T ./GameSetup.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  "$URL"
```

```powershell
$headers = @{ Authorization = "Bearer $env:ARKVORY_KEY" }
$url = 'https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe'
Invoke-RestMethod -Method Put -InFile .\GameSetup.exe -Headers $headers -Uri $url
```

```bash
wget -qO- --method=PUT --body-file=GameSetup.exe \
  --header="Authorization: Bearer $ARKVORY_KEY" "$URL"
```

`curl -T`には、フォルダーではなくファイルの完全なアドレスを渡します。URLで使えないパス内の文字はエンコードしてください。空白は`%20`、`#`は`%23`、`?`は`%3F`と書きます。

応答はJSONです。新しいファイル、または新しいバイト列の場合は`201`を返します。

```json
{
  "path": "builds/game/1.4/GameSetup.exe",
  "revision": 1,
  "created": true,
  "artifact": { "id": "00000000-0000-4000-8000-000000000001", "size": "1048576", "sha256": "…" }
}
```

パスがすでにまったく同じバイト列を保持している場合、応答は`200`で、`"created": false`と同じリビジョンを返します。何も保存しません。CIジョブの手順を再実行しても、新しいバージョンを作成せずに済みます。`size`は10進数字の文字列です。

### チェックサムを送信する {#send-a-checksum}

ファイルのSHA-256を`X-Checksum-Sha256`、長さを`Content-Length`で送信します。`curl -T`とPowerShellは、ファイルの長さを送信します。この場合、サーバーはバイト列を1回の処理で直接ストレージに書き込み、そこで検証します。チェックサムが間違っていれば、コード`integrity_mismatch`で`422`を返し、何も保存せず、パスを以前のままに保ちます。

```bash
curl --fail-with-body -sS -T ./GameSetup.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  -H "X-Checksum-Sha256: $(sha256sum GameSetup.exe | cut -d' ' -f1)" \
  "$URL"
```

```powershell
$headers['X-Checksum-Sha256'] = (Get-FileHash .\GameSetup.exe -Algorithm SHA256).Hash.ToLower()
Invoke-RestMethod -Method Put -InFile .\GameSetup.exe -Headers $headers -Uri $url
```

チェックサムがない場合、または`Content-Length`のないチャンク転送のボディの場合、サーバーはまずボディを一時ファイルに書き込み、ハッシュを計算してから保存します。このため、短時間だけサーバーのディスクにファイルサイズの最大2倍の容量が必要となり、バイト列を2回処理します。失敗によって残った一時ファイルは、1日後にサーバーが削除します。

チェックサムと長さを送信し、パスがすでにそのバイト列を保持している場合、サーバーはボディを読まずに`200`を返し、接続を閉じます。

### 新規作成だけを許可する {#create-only}

`PUT`が読み取る条件は、`If-None-Match: *`の1つだけです。これを指定すると、サーバーはパスが存在しない場合にのみファイルを保存します。存在する場合は、バイト列が同じでも、理由`already_exists`で`409`を返します。`PUT`での`If-None-Match`の他の値は、`400`を返します。

```bash
curl --fail-with-body -sS -T ./notes.txt \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "If-None-Match: *" \
  "https://arkvory.example/api/v1/repositories/releases/raw/docs/notes.txt"
```

### 2つの書き込み元 {#two-writers}

2つのリクエストが同時に同じパスを変更すると、最初のリクエストが優先されます。後のリクエストには理由`revision_mismatch`で`409`を返し、パスは先のリクエストの内容を保持します。新しいリビジョンを作成するには、リクエストを再実行してください。後のリクエストでアップロードされたバイト列は、保持ポリシーで削除されるまで、パスのないアーティファクトとして残ります。

## ファイルを読み取る {#read-a-file}

`GET`はパスの現在のバージョンを返します。`HEAD`はヘッダーだけを返します。

```bash
curl --fail-with-body -sS -H "Authorization: Bearer $ARKVORY_KEY" -o GameSetup.exe "$URL"
```

```powershell
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -Headers $headers -Uri $url -OutFile .\GameSetup.exe
```

```bash
wget --header="Authorization: Bearer $ARKVORY_KEY" -O GameSetup.exe "$URL"
```

応答のヘッダー：

| ヘッダー                | 値                                                         |
| ----------------------- | ---------------------------------------------------------- |
| `ETag`                  | `"sha256:<digest>"`：引用符で囲んだ内容のSHA-256           |
| `Content-Length`        | ファイルのサイズ                                           |
| `Accept-Ranges`         | `bytes`                                                    |
| `Content-Type`          | 常に`application/octet-stream`                             |
| `Content-Disposition`   | `attachment`。パスの最後のセグメントをファイル名に使います |
| `X-Arkvory-Artifact-Id` | このバージョンを保持するアーティファクトのID               |

不明なパスには`404`を返します。

### 範囲指定と条件付きリクエスト {#ranges-and-conditional-requests}

| リクエストヘッダー          | 効果                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Range: bytes=0-1023`       | 指定した部分と`Content-Range`を含む`206`。開始位置がファイルの末尾より後なら、`Content-Range: bytes */<size>`を含む`416`を返します |
| `Range: bytes=-1024`        | 最後の1024バイト                                                                                                                   |
| `Range: bytes=1048576-`     | オフセットから末尾まで                                                                                                             |
| `If-Range: "sha256:…"`      | ETagがこの値と完全に一致する場合にのみ`Range`を適用します。パスが新しいバージョンになっていれば、新しいファイル全体を返します      |
| `If-None-Match: "sha256:…"` | ETagが同じなら、ボディなしの`304`。`HEAD`でも使えます                                                                              |

対応する範囲は1リクエストにつき1つだけです。複数の範囲を含むリクエストには、ファイル全体を返します。

パスはいつでも新しいバージョンになり得るため、`GET`はパスを再度解決します。ダウンロードを安全に続行するには、最初の応答の`ETag`を覚えておき、`If-Range`として送信します。

最初の `GET` の `ETag` を `GameSetup.etag` に保存し、`HEAD` で新しい値を取得しないでください。この例は既存の部分ファイルのサイズからオフセットを求め、`206` の場合だけ一時ファイルの応答を追記します。`200` またはリクエスト失敗の場合、部分ファイルは変更しません。別途、新しいダウンロードを開始してください。ファイルを使用する前に、最終的な SHA-256 を検証してください。

```bash
etag=$(cat GameSetup.etag) || exit 1
test -n "$etag" || exit 1
offset=$(wc -c < GameSetup.part) || exit 1
offset=$(printf '%s' "$offset" | tr -d '[:space:]')
segment=$(mktemp) || exit 1
status=$(curl -fsS -o "$segment" -w '%{http_code}' \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "If-Range: $etag" \
  -H "Range: bytes=$offset-" "$URL") || {
  rm -f "$segment"
  exit 1
}
if [ "$status" != 206 ]; then
  rm -f "$segment"
  exit 1
fi
cat "$segment" >> GameSetup.part
result=$?
rm -f "$segment"
test "$result" -eq 0
```

ファイルが変わっていない場合にダウンロードを省くには、前回保存したETagを送信します。

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $ARKVORY_KEY" \
  -H 'If-None-Match: "sha256:<digest>"' "$URL"
```

大きなファイルには、[`arkvoryctl get`](./cli)を使うと、再開付きのダウンロードとSHA-256の検証を行えます。

## パスとバージョン {#paths-and-versions}

Rawファイルは、[パス指定ファイル](../use/files)です。新しいバイト列を含む`PUT`のたびに、パスにリビジョン1、2、3と順に追加します。以前のリビジョンは残ります。各リビジョンは、パスの最後のセグメントを名前とする、それぞれの不変なアーティファクトを指すため、バイト列が置き換わることはありません。

- rawアドレスへの`GET`は、常に現在のリビジョンを返します。
- パスのすべてのリビジョンを確認するには、履歴を読みます。[`getAssetHistory`](../api/reference/files#getAssetHistory)、またはコンソールの[[ui:history]]を使います。
- 古いリビジョンを読むには、[`getAssetRevision`](../api/reference/files#getAssetRevision)がそのアーティファクトを返します。アーティファクトのコンテンツアドレスでダウンロードします。
- 古いリビジョンに戻すには、[`restoreAsset`](../api/reference/files#restoreAsset)を使います。古いバイト列を指す新しいリビジョンを追加します。
- プレフィックスでリポジトリ内のパスを一覧表示するには、[`listAssetPage`](../api/reference/files#listAssetPage)を使います。
- パスは削除できません。履歴は残ります。保持ポリシーは、パスのリビジョンが使うアーティファクトを削除しません。

同じ操作は、[SDK](./sdk#raw-files-by-path)（`client.raw.putRawFile`、`downloadRawFile`）と[`arkvoryctl`](./cli#transfers)（`put`、`get`）にもあります。

### パスのルール {#path-rules}

| ルール     | 値                                                                      |
| ---------- | ----------------------------------------------------------------------- |
| 長さ       | 1～1024文字                                                             |
| フォルダー | `/`で区切ったセグメント                                                 |
| 使用不可   | 空のセグメント（`a//b`）、`.`、`..`、バックスラッシュ、コロン、制御文字 |

`curl`とブラウザーは送信前にURLから`.`と`..`を取り除くため、そのようなパスは到達しません。ルールに違反するパスには`400`を返します。

## 権限 {#permissions}

個人用トークンとファイルキーには、リポジトリへの読み取りまたは書き込みアクセスが付与されます。サービスキーには、個別のアクションが付与されます。

| 操作          | サービスキーのアクション                                                                         | 個人用トークンまたはファイルキー                 |
| ------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `GET`、`HEAD` | `content.read`                                                                                   | 読み取りアクセス                                 |
| `PUT`         | `upload.create`、`upload.write`、`upload.complete`、`asset.read`、`asset.write`、`artifact.read` | 書き込みアクセス、トークンのスコープ`read-write` |

ダウンロードだけを行うデプロイエージェントには、アクション`content.read`が必要です。

[読み取りゲートウェイ](../operate/read-gateways)は`GET`と`HEAD`だけを受け付けます。[ミラー](../operate/mirrors)は読み取りを提供し、`PUT`には`409`、理由`mirror_read_only`で拒否します。

## 制限 {#limits}

| 制限                 | 値                                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ファイルサイズ       | インストールの最大オブジェクトサイズ`ARKVORY_MAX_OBJECT_BYTES`（既定で約10 TiB）                                                                                 |
| 1件の`PUT`リクエスト | 30分以内に完了する必要があり、30秒を超えて停止できません（`ARKVORY_UPLOAD_DEADLINE_MS`、`ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`）。これらは設定可能な最大値でもあります |
| 同時アップロード     | 既定でサーバーごとに8件、キーごとに4件（`ARKVORY_MAX_UPLOADS`、`ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`）。待機中のリクエストは20秒後に`503`で断念します              |
| 同時ダウンロード     | 既定でサーバーごとに16件、キーごとに4件                                                                                                                          |
| クォータ             | ファイルは、リポジトリのクォータとインストールの容量に算入されます                                                                                               |

単一の`PUT`には再開機能がありません。失敗すると、最初のバイトからやり直します。Rawファイルの方式は、小～中サイズのファイルとスクリプトに使ってください。大きなファイルや低速なネットワークでは、[`arkvoryctl put`](./cli)または[SDK](./sdk)を使います。パートに分けてアップロードし、失敗後も続行して、SHA-256を確認します。これらもファイルをパスのリビジョンとして保存します。変数は[環境変数](../reference/environment#transfers-and-bandwidth)に記載しています。

## Unity Addressables {#addressables}

Addressablesは、通常の`GET`リクエストでカタログとバンドルを読み込むため、ビルドフォルダーをrawパスの下に配置できます。社内ビルド、QA、ツールに適しています。公開インターネット上のプレイヤーには適していません。rawの読み取りには常にキーが必要で、ダウンロードリンクは24時間以内に期限切れになり、配布済みプレイヤー内のキーは秘密にはならないためです。

`arkvoryctl put`でフォルダーをアップロードします。バイト列が変わっていないファイルは再送信しません。パスは常に最新のリビジョンを返し、古いカタログが新しいバンドルを読み込んではいけないため、ビルドごとに1つのフォルダーを使ってください。

```bash
cd ServerData/StandaloneWindows64
find . -type f | while read -r file; do
  arkvoryctl put "$file" "addressables/game/$BUILD/StandaloneWindows64/${file#./}" || exit 1
done
```

```powershell
$root = (Resolve-Path .\ServerData\StandaloneWindows64).Path
Get-ChildItem $root -Recurse -File | ForEach-Object {
  $relative = $_.FullName.Substring($root.Length + 1) -replace '\\', '/'
  arkvoryctl put $_.FullName "addressables/game/$env:BUILD/StandaloneWindows64/$relative"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

Addressablesプロファイルのリモートロードパスに、そのフォルダーのrawアドレスを設定します。例：`https://arkvory.example/api/v1/repositories/releases/raw/addressables/game/<build>/[BuildTarget]`。読み取りアクセスのある個人用アクセストークン、またはアクション`content.read`を持つサービスキーという、読み取り専用のキーをプレイヤーに渡します。Rawファイルは`Authorization`ヘッダーのキーだけを受け付けるため、各リクエストに設定してください。

```csharp
Addressables.WebRequestOverride = request =>
{
    if (request.url.StartsWith("https://arkvory.example/"))
        request.SetRequestHeader("Authorization", "Bearer " + readKey);
};
```

Addressables 1.xでは、プロパティは`Addressables.WebRequestOverride`です。使用するバージョンで名前を確認してください。これは実装の例であり、検証済みの連携ではありません。

## トラブルシューティング {#troubleshooting}

エラーは、`code`、`reason`、`message`、`requestId`を含むJSON文書です。[エラー](../api/errors)を参照してください。管理者がサーバーログでリクエストを探せるように、`requestId`を伝えてください。

| ステータス     | 理由                                                        | 原因                                                                                    | 対処                                                                            |
| -------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `400`          | `validation`                                                | パス、`Content-Length`、`X-Checksum-Sha256`、`If-None-Match`のいずれかが無効            | パスのルールを確認し、URLをエンコードします                                     |
| `401`          | `credential_missing`、`credential_invalid`、`token_expired` | キーがない、間違っている、またはトークンが期限切れ                                      | `Authorization: Bearer <key>`を送信します。RawファイルではBasic認証を使えません |
| `403`          | `permission_missing`、`read_only_token`                     | キーに書き込み権限がない、または読み取り専用トークンである                              | [権限](#permissions)のアクションを持つキーを使います                            |
| `404`          |                                                             | パスが存在しない、またはキーからリポジトリが見えない                                    | リポジトリ名とパスを確認します                                                  |
| `409`          | `already_exists`                                            | `If-None-Match: *`が指定され、パスが存在する                                            | リビジョンを追加するには、ヘッダーを取り除きます                                |
| `409`          | `revision_mismatch`                                         | 別のリクエストが先にパスを変更した                                                      | リクエストを再実行します                                                        |
| `409`          | `mirror_read_only`                                          | リポジトリがミラーである                                                                | メインサーバーに書き込みます                                                    |
| `416`          | `range_not_satisfiable`                                     | 範囲の開始位置がファイルの末尾より後にある                                              | `HEAD`でサイズを確認します                                                      |
| `422`          | `integrity_mismatch`                                        | ボディが`X-Checksum-Sha256`または`Content-Length`と一致しない                           | チェックサムを再計算し、プロキシを確認します                                    |
| `503`          | `busy`                                                      | 同時転送が多すぎる                                                                      | `Retry-After`で指定された時間だけ待って再試行します                             |
| `507`          | `storage_quota`                                             | リポジトリのクォータ、またはインストールの容量に達した                                  | 空き容量を確保するか、クォータの引き上げを依頼します                            |
| ステータス以外 | 送信中の`curl: (55)`または`(56)`                            | サーバーが接続を閉じた。パスがすでにバイト列を保持している場合は、`200`を返して閉じます | `curl -i`を実行し、応答を読みます                                               |
| ステータス以外 | 30分後に接続が閉じる                                        | アップロードの期限                                                                      | `arkvoryctl put`を使います                                                      |

## 関連ページ {#related-pages}

- [クライアントとプロトコル](./index)
- [コマンドライン（arkvoryctl）](./cli)
- [TypeScript SDK](./sdk)
- [ファイルとパス](../use/files)
- [APIリファレンス：パス指定ファイル](../api/reference/files)
