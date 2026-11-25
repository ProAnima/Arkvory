---
title: Unityとnpmのパッケージ
description: リポジトリをUnity Package Managerのスコープ付きレジストリ、およびパッケージの公開とインストール用のnpmレジストリとして使います。
---

# Unityとnpmのパッケージ

すべてのArkvoryリポジトリは、`https://<host>/npm/<repository>/`でnpm互換のレジストリとして使えます。Unity Package Managerはスコープ付きレジストリとして読み取り、`npm`はそこに公開し、そこからインストールします。スタジオでは、複数のUnityプロジェクトで共有するSDK、ツール、モジュールを、それぞれのバージョンで提供するために使えます。

パッケージのtarballは通常のアーティファクトなので、リポジトリの権限、クォータ、SHA-256の確認、バックアップ、ミラーが適用されます。

## 始める前に {#before-you-start}

次のものが必要です。

- HTTPSのサーバーアドレス（[HTTPS](../install/https)を参照）。
- リポジトリ。たとえば`games`の場合、レジストリのアドレスは`https://arkvory.example/npm/games/`です。
- キー。開発者はスコープ`read`の個人用アクセストークンを使います。公開を行うビルドエージェントは、スコープ`read-write`の個人用トークン、またはサービスキーを使います。[アカウントとキー](../use/accounts)を参照してください。

Arkvoryは、パッケージのデータ内で各tarballのアドレスをクライアントに送信します。アドレスは、クライアントが接続に使ったホスト名から組み立てます。リバースプロキシでHTTPSを終端する場合は、インストールのnginxの例のように、`Host`ヘッダーを渡し、`X-Forwarded-Proto: https`を送信する必要があります。そうしないと、クライアントにはtarballの`http://`アドレスが返されます。

## Unityプロジェクトにレジストリを追加する {#unity-manifest}

1. プロジェクトの`Packages/manifest.json`を開き、スコープ付きレジストリを追加します。

```json
{
  "scopedRegistries": [
    {
      "name": "Arkvory",
      "url": "https://arkvory.example/npm/games/",
      "scopes": ["com.proanima"]
    }
  ],
  "dependencies": {
    "com.proanima.tools": "1.2.0"
  }
}
```

2. Unityにキーを渡します。プロジェクトには入れないでください。ユーザーフォルダーに`.upmconfig.toml`ファイルを作成します（Windowsでは`%USERPROFILE%\.upmconfig.toml`、macOSとLinuxでは`~/.upmconfig.toml`）。

```toml
[npmAuth."https://arkvory.example/npm/games/"]
token = "<your Arkvory key>"
alwaysAuth = true
```

3. Unityを再起動します。Package Managerウィンドウで**マイレジストリ**を開くと、レジストリのパッケージを確認できます。

注意事項：

- `scopes`はパッケージ名のプレフィックスです。Unityは、スコープで名前が始まるパッケージをArkvoryから、それ以外をUnityレジストリから取得します。
- `.upmconfig.toml`のアドレスは、末尾のスラッシュも含めて、マニフェストの`url`と一致する必要があります。
- `alwaysAuth = true`は必須です。レジストリはログインチャレンジを送信しないため、Unityは各リクエストでトークンを送信する必要があります。
- Unityのパッケージ名は、`com.company.package`のような小文字の逆ドメイン名です。Unityは`@scope/`付きの名前には対応していません。

`Packages/manifest.json`はプロジェクトとともにコミットします。各開発者が自身の`.upmconfig.toml`を保持します。

## パッケージを公開する {#publish}

パッケージは、最上位に`package.json`があるフォルダーです。`npm`で公開します。

1. パッケージのフォルダーに`.npmrc`ファイルを作成します。

```ini
registry=https://arkvory.example/npm/games/
//arkvory.example/npm/games/:_authToken=${ARKVORY_TOKEN}
```

2. 環境変数にキーを設定して公開します。

```bash
export ARKVORY_TOKEN="$(cat ~/.arkvory/key)"
npm publish
```

```powershell
$env:ARKVORY_TOKEN = (Get-Content C:\Private\arkvory.key -Raw).Trim()
npm publish
```

`_authToken`の行は、`https:`を除いたレジストリのアドレスで始める必要があります。`.npmrc`にキーを入れないでください。npmが環境変数の値で`${ARKVORY_TOKEN}`を置き換えます。

`.npmrc`の`registry`行の代わりに、パッケージの`package.json`でレジストリを設定することもできます。

```json
{
  "name": "com.proanima.tools",
  "version": "1.2.0",
  "publishConfig": { "registry": "https://arkvory.example/npm/games/" }
}
```

レジストリは次を確認します。

- **名前とバージョン。** tarball内の`package.json`の`name`と`version`は、公開するものと一致する必要があります。バージョンはSemVer 2.0.0に従います。例：`1.2.0`、`2.0.0-beta.1`。レジストリは、クライアントが送信するJSONではなく、このファイルからバージョンのデータを読み取ります。
- **チェックサム。** クライアントが宣言する長さ、`shasum`、`integrity`は、バイト列と一致する必要があります。不一致の場合は`422 integrity_mismatch`を返します。
- **tarball。** `npm pack`が作成するように、`<folder>/package.json`を含める必要があります。アーカイブ内の2つ目の`package.json`は、npmとレジストリが別々のファイルを読むおそれがあるため拒否します。
- **バージョンは不変です。** 同じtarballを再公開すると成功し、何も変更しません（`200`）。既存のバージョンに別の内容を公開すると、理由`version_exists`で`409`を返します。修正は次のバージョンとして公開してください。

`npm publish`は公開前にレジストリからパッケージを読み取るため、公開用のキーには`upload.create`に加えて`content.read`と`artifact.list`も付与してください。[権限](#permissions)を参照してください。

バージョンは、`npm publish`が戻るとすぐに利用できます。バージョンのtarballは、ラベル`npm`を持つアーティファクト`<name>-<version>.tgz`として保存します。スコープ付きの名前では、`@team/util`は`util-<version>.tgz`になります。

## パッケージをインストールする {#install}

Unityでは、マニフェストに依存関係を追加するか、Package Managerウィンドウの**マイレジストリ**でパッケージを選びます。

npmでは、プロジェクトまたはユーザーの`.npmrc`にレジストリを設定します。Arkvoryは公開npmレジストリにリクエストを転送しないため、通常は1つのスコープ用のレジストリを設定します。

```ini
@team:registry=https://arkvory.example/npm/games/
//arkvory.example/npm/games/:_authToken=${ARKVORY_TOKEN}
```

```bash
npm install @team/util
npm view @team/util versions
npm search tools
```

プロジェクト全体の`registry=`をArkvoryに設定すると、npmは`lodash`などの公開パッケージも含め、すべてのパッケージをそこで探し、`404`で失敗します。スコープ付きレジストリ、または自分のパッケージだけを含むプロジェクトを使ってください。

npmはインストール中に`dist.integrity`を確認し、`package-lock.json`にレジストリのアドレスを書き込みます。

## バージョンとdist-tags {#versions-and-tags}

dist-tagは、参照先を変更できるバージョンの名前です。`npm publish`は`latest`を新しいバージョンに設定します。他のタグは、リリースチャネルを分けるために使えます。

```bash
npm publish --tag beta
npm dist-tag add com.proanima.tools@1.3.0 latest
npm dist-tag ls com.proanima.tools
npm dist-tag rm com.proanima.tools beta
```

```bash
npm install com.proanima.tools@beta
```

| ルール         | 値                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------- |
| タグ名         | 文字で始めます。文字、数字、`.`、`_`、`-`を使えます。最大64文字                               |
| 禁止されるタグ | バージョンのように見える名前（`v1`、`v2.0`）、および`x`、`X`                                  |
| `latest`       | 常にバージョンを指します。参照先は変更できますが、削除できません（`409`）                     |
| タグの移動     | `npm dist-tag add`、または`--tag`付きの公開。新しい参照先のバージョンは存在する必要があります |

タグは名前にすぎません。他のバージョンを削除したり非表示にしたりしません。

公開済みのバージョンを削除する方法はありません。[非対応の機能](#not-supported)を参照してください。

## 検索 {#search}

Unityの**マイレジストリ**の一覧と`npm search`は、検索アドレス`/-/v1/search`を使います。検索は、大文字と小文字を区別せず、名前または説明に指定したテキストが含まれるパッケージ、およびキーワード全体がそのテキストと一致するパッケージを見つけます。テキストを指定しなければ、すべてのパッケージを一覧表示します。

- パッケージごとに1行を返します。タグ`latest`のバージョン、なければ最も新しいバージョンです。
- 結果は名前順です。人気順のランキングはありません。
- `size`は既定で20、最大250です。`from`はオフセットです。

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_TOKEN" \
  "https://arkvory.example/npm/games/-/v1/search?text=tools&from=0&size=20"
```

パッケージを直接読むには、その名前をリクエストします。`@scope/name`は`@scope%2fname`として送信できます。

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_TOKEN" https://arkvory.example/npm/games/com.proanima.tools
```

応答には、すべてのバージョンと各`package.json`の内容（Unityが読み取る`unity`、`displayName`フィールドを含む）、dist-tags、公開日時が含まれます。`dist`には`tarball`、`shasum`（SHA-1）、`integrity`（SHA-512）があります。

## 名前と制限 {#limits}

| 項目                       | ルール                                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| パッケージ名               | 小文字、数字、`.`、`_`、`~`、`-`を使い、文字または数字で始めます。最大214文字。npmでは`@scope/name`を使えます                                                   |
| バージョン                 | SemVer 2.0.0、最大256文字                                                                                                                                       |
| tarball内の`package.json`  | 最大256 KiB。すべてのバージョンのデータが1つの応答に入るため、小さく保ってください                                                                              |
| tarball                    | インストールの最大オブジェクトサイズ`ARKVORY_MAX_OBJECT_BYTES`まで（既定で約10 TiB）。展開後のサイズが元の100倍に64 MiBを加えた値を超えるアーカイブは拒否します |
| 公開リクエストの残りの部分 | 最大8 MiBのJSON、ネストは最大64階層。tarballはストリームとして読み取り、メモリには保持しません                                                                  |
| 1件の公開リクエスト        | 30分以内に完了する必要があり、30秒を超えて停止できません（`ARKVORY_UPLOAD_DEADLINE_MS`、`ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`）                                      |
| 同時アップロード           | 既定でサーバーごとに8件、キーごとに4件。待機中のリクエストは20秒後に断念します                                                                                  |
| 検索テキスト               | 最大256文字                                                                                                                                                     |

`npm publish`は1つのリクエストであり、失敗すると最初のバイトからやり直します。何ギガバイトもあるパッケージでは、[`arkvoryctl`](./cli)でファイルをアーティファクトまたは[Rawファイル](./raw-files)としてアップロードしてください。頻繁に変わる大きなバイナリアセットには、[Git LFS](./git-lfs)が適しています。パッケージにはコードと安定したリソースを保持してください。

サーバーの制限は[環境変数](../reference/environment#transfers-and-bandwidth)に記載しています。

## 権限 {#permissions}

個人用トークンとファイルキーには、リポジトリへの読み取りまたは書き込みアクセスが付与されます。サービスキーには、個別のアクションが付与されます。

| 操作                                                      | サービスキーのアクション | 個人用トークンまたはファイルキー                 |
| --------------------------------------------------------- | ------------------------ | ------------------------------------------------ |
| インストール：パッケージの読み取りとtarballのダウンロード | `content.read`           | 読み取りアクセス                                 |
| 検索、dist-tagsの一覧                                     | `artifact.list`          | 読み取りアクセス                                 |
| 公開、dist-tagsの追加と削除                               | `upload.create`          | 書き込みアクセス、トークンのスコープ`read-write` |

パッケージをインストールするだけの開発者には、スコープ`read`のトークンが必要です。公開するビルドエージェントには、`upload.create`、`content.read`、`artifact.list`が必要です。公開済みのバージョンは誰も削除できません。

## 読み取りゲートウェイとミラー {#read-gateways-and-mirrors}

- [読み取りゲートウェイ](../operate/read-gateways)は、インストールと検索を提供します。これらは`GET`リクエストだからです。公開には`405`を返します。
- [ミラー](../operate/mirrors)は、ミラー元のバージョンとタグを保持します。インストールと検索は利用できます。公開は`409`、理由`mirror_read_only`で拒否します。ミラーのデータ内のtarballアドレスは、ミラーを指します。

Unityでミラーを使うには、`url`にミラーのアドレスを、`.upmconfig.toml`にそのキーを設定します。

## 非対応の機能 {#not-supported}

- バージョンの削除（`npm unpublish`）。プロジェクトはバージョンを固定するため、削除するとビルドが壊れます。代わりに修正版を公開し、タグを移動してください。
- `npm deprecate`、`npm login`、`npm owner`、`npm access`、その他の管理コマンド。他のパスでデータを変更するリクエストには、「This registry supports publish, install and dist-tags」とともに`405`を返します。`npm login`の代わりに、コンソールでトークンを作成して`.npmrc`に設定してください。
- `/-/all`での全パッケージ一覧、および`npm audit`。
- 公開レジストリへのプロキシ。Arkvoryは、自分のパッケージを保存します。npmjs.comやUnityレジストリのパッケージは、それぞれから取得します。
- 検索結果のランキング。
- コンソールのパッケージ専用セクション。tarballは、ラベル`npm`を持つアーティファクトとして[[ui:catalog]]に表示されます。

## トラブルシューティング {#troubleshooting}

エラーは`{"error": "...", "code": "...", "request_id": "..."}`形式です。`npm`は`error`を表示します。管理者がサーバーログでリクエストを探せるように、`request_id`を伝えてください。

| 症状                                                   | 原因                                                                             | 対処                                                                                                                                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unityまたはnpmで`401`                                  | クライアントがキーを送信していない、またはキーが間違っている、期限切れ、失効済み | Unityでは、`.upmconfig.toml`のアドレスがマニフェストの`url`と一致し、`alwaysAuth = true`であることを確認します。npmでは、`_authToken`の行が`registry`と同じホストとパスで始まることを確認します |
| 公開時に`403`                                          | トークンのスコープが`read`、またはキーに`upload.create`がない                    | 書き込みアクセスのあるキーを使います                                                                                                                                                            |
| パッケージに`404`                                      | このリポジトリにそのパッケージがない、またはキーからリポジトリが見えない         | アドレス内のリポジトリと名前を確認します。Unityパッケージでは、名前が`scopes`内のスコープで始まることを確認します                                                                               |
| 公開パッケージに`404`                                  | すべてのパッケージの`registry=`がArkvoryを指している                             | `@scope:registry=`を使います                                                                                                                                                                    |
| `409`と`version_exists`                                | 別の内容でバージョンが存在する                                                   | 新しいバージョンを公開します                                                                                                                                                                    |
| `409`と`state_conflict`                                | `latest`を削除しようとした                                                       | 代わりに`latest`を別のバージョンに移動します                                                                                                                                                    |
| `409`と`mirror_read_only`                              | リポジトリがミラーである                                                         | メインサーバーに公開します                                                                                                                                                                      |
| `422`と`integrity_mismatch`                            | バイト列が宣言された`shasum`または`integrity`と異なる                            | 再度パックして公開します。プロキシがボディを変更していないことを確認します                                                                                                                      |
| `400`「package.json names another package or version」 | tarball内の`package.json`が、公開する名前またはバージョンと異なる                | パッケージのクリーンなビルドから`npm publish`を実行します                                                                                                                                       |
| `400`「Only publishing a new version is supported」    | `npm deprecate`などのコマンドが、変更済みパッケージを送信した                    | これらのコマンドには対応していません                                                                                                                                                            |
| `405`                                                  | コマンドがこのレジストリで非対応                                                 | [非対応の機能](#not-supported)を参照してください                                                                                                                                                |
| `507`                                                  | リポジトリのクォータ、またはインストールの容量に達した                           | 空き容量を確保するか、クォータの引き上げを依頼します                                                                                                                                            |
| `503`                                                  | 同時アップロードが多すぎる                                                       | 待って再試行します                                                                                                                                                                              |
| tarballを`http://`からダウンロードして失敗する         | プロキシが`X-Forwarded-Proto: https`を送信していない                             | [始める前に](#before-you-start)の説明に従ってプロキシを修正します                                                                                                                               |

## 関連ページ {#related-pages}

- [クライアントとプロトコル](./index)
- [Git LFS](./git-lfs)
- [アカウントとキー](../use/accounts)
- [HTTPS](../install/https)
- [ミラー](../operate/mirrors)
