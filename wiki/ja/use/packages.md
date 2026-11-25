---
title: UPack パッケージ
description: バージョン付きの UPack パッケージを公開して一覧表示・絞り込みを行い、正確な番号、範囲、最新版、ステージを指定してバージョンをダウンロードします。
---

# UPack パッケージ

UPack パッケージは、名前と SemVer バージョンを持つ ZIP アーカイブです。Arkvory は各バージョンを 1 度だけ登録し、変更しません。デプロイジョブが「app、バージョン `^1.4`、ステージ `release`」を要求すると、ファイルが 1 つだけ返されます。

## パッケージとは {#what-it-is}

UPack は、ルートに `upack.json` を含む ZIP ファイルです。このマニフェストでパッケージを識別します。

```json
{
  "group": "acme/game",
  "name": "game-client",
  "version": "1.4.2"
}
```

| フィールド | 規則                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| `name`     | 必須。英字、数字、`.`、`_`、`-` の 1～128 文字                                                         |
| `version`  | 必須。SemVer：`1.4.2`、`1.5.0-rc.1`、`2.0.0+build.7`。最大 128 文字                                    |
| `group`    | 省略可能。英字、数字、`.`、`_`、`-` からなるセグメントを `/` で区切ります。最大 128 文字。既定は空です |

他のフィールドは記述したまま保持され、パッケージ一覧で返されます。マニフェストは最大 64 KiB です。アーカイブには絶対パス、`..`、シンボリックリンク、暗号化されたエントリ、重複する名前を含められず、エントリ数は最大 100,000 です。Arkvory はアーカイブのバイト列をそのまま保存し、展開しません。

パッケージはグループ、名前、バージョンで識別し、大文字と小文字を区別せずに比較します。1 つのリポジトリでは、同じ識別情報が 1 つのアーカイブに恒久的に対応します。既存の識別情報で別のアーカイブを登録しようとすると、`409 version_exists` で拒否されます。同じアーカイブを再登録しても安全で、何も変わりません。修正は新しいバージョンとして公開してください。

## パッケージの公開 {#publish}

公開は、アップロードとその後の登録からなります。登録では `upack.json` を読み取り、識別情報を記録します。アップロードの操作権限に加え、`package.publish` と `artifact.read` が必要です。[権限](./accounts#permissions)を参照してください。

### コンソールでの公開 {#publish-console}

1. [[ui:upload]] でアーカイブをアップロードします。[アップロードとダウンロード](./transfers)を参照してください。
2. [[ui:catalog]] で [[ui:open]] を使ってアーティファクトを開きます。
3. [[ui:metadata]] で [[ui:register]] を選択します。コンソールに登録した名前とバージョンが表示されます。

パッケージが [[ui:packages]] に表示されるようになります。

### arkvoryctl での公開 {#publish-cli}

```bash
arkvoryctl packages publish ./build.upack --label test --state ./job-state/build.json --json
arkvoryctl packages register 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`packages publish` は、再開可能なアップロードを行ってからアーカイブを登録します。アップロード後に登録が失敗すると、エラーに `artifactId` と処理段階 `register` が含まれます。同じコマンドを再実行してください。アップロードは繰り返されず、登録を 2 回行っても安全です。`packages register ID` はアップロード済みのアーティファクトを登録します。[コマンドライン](../protocols/cli#packages-and-promotion)を参照してください。

### HTTP API と SDK での公開 {#publish-api}

[アップロードとダウンロード](./transfers#upload-http)の手順でアーカイブをアップロードし、その後登録します。

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/package" \
  -H "Authorization: Bearer $ARKVORY_KEY"
```

```typescript
const entry = await releases.packages.register(uploaded.id);
console.log(entry.group, entry.name, entry.version);
```

操作は `registerPackage` です。アーカイブの破損、`upack.json` の欠落、不正なバージョンの場合は、`400 invalid_input` が返されます。

## 一覧表示と絞り込み {#list}

コンソールで [[ui:packages]] を開きます。[[ui:packageGroup]] または [[ui:packageName]] を入力します。どちらも大文字と小文字を区別しない完全一致です。[[ui:sortBy]] で列、[[ui:direction]] で順序（[[ui:ascending]] または [[ui:descending]]）、[[ui:groupBy]] でグループ化（[[ui:packageGroup]]、[[ui:packageName]]、[[ui:noGrouping]]）を選び、[[ui:apply]] を選択します。[[ui:clearFilters]] はフォームをリセットします。表には各バージョンのグループ、名前、バージョン、ステージが表示されます。[[ui:open]] はアーティファクトを開きます。[[ui:previousPage]] と [[ui:nextPage]] でページを移動します。

```bash
arkvoryctl packages list --group acme/game --name game-client
arkvoryctl packages list --after <next from the previous answer>
```

API の `listPackages` は、`group`、`name`、`sort`（`group`、`name`、`version`）、`direction`（`asc` または `desc`）、`groupBy`（`none`、`group`、`package`）、`after`、`limit`（1～100、既定 50）を受け取ります。応答には `items`（グループ、名前、バージョン、`artifactId`、マニフェスト全体）、`groups`、`next` が含まれます。カーソルは取得時のフィルターに結び付いています。同じフィルターでのみ使用してください。

```typescript
const page = await releases.packages.list({
  name: 'game-client',
  sort: 'version',
  direction: 'desc',
});
```

一覧表示には `package.read` が必要です。ラベルやメタデータで検索する場合は、[パス指定ファイル](./files#labels)を参照してください。

## バージョンと範囲 {#versions}

Arkvory は SemVer の優先順位に従ってバージョンを比較します。`1.10.0` は `1.9.0` より新しく、`1.5.0-rc.1` などのプレリリース部分を持つバージョンは `1.5.0` より古いと扱われます。

選択時にはパッケージの `name` を指定し、必要に応じて次のフィルターを指定します。

| フィルター       | 意味                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `group`          | グループ。既定は空です。グループを持つパッケージは、そのグループを指定した場合にだけ見つかります |
| 正確なバージョン | 1 つのバージョン。大文字と小文字は区別しません                                                   |
| 範囲             | SemVer の範囲                                                                                    |
| `stage`          | このステージを持つバージョンのみ（[ステージとプロモーション](./promotion)を参照）                |
| プレリリース     | プレリリースを含めます。既定は無効です                                                           |
| 順序             | `version`（既定）または `promoted`                                                               |

範囲は `1.2.3`、`^1.2`、`~1.2.3`、`1.x`、`>=1.0.0 <2.0.0`、`1.0.0 - 1.4.0`、`^1 || ^3` などと記述できます。最大 256 文字です。正確なバージョンと範囲は同時に指定できません。

正確なバージョンも範囲も指定しなければ、最大の安定版バージョン、つまり最新版が選ばれます。プレリリースが選ばれるのは、プレリリースフィルターが有効な場合、または正確なバージョンや範囲自体が同じ `major.minor.patch` のプレリリースを指定する場合だけです。`order promoted` は最大のバージョンではなく、最後にステージを付けたバージョンを選びます。ステージの指定が必要です。一致するものがなければ、サーバーは `404 not_found` を返します。

## パッケージのダウンロード {#download}

取得対象を確認したければ先に解決し、そのまま取得したければ直接ダウンロードします。

```bash
arkvoryctl packages resolve game-client --group acme/game --range ^1.4 --stage release
arkvoryctl packages download game-client ./game-client.upack --group acme/game --range ^1.4 --stage release
arkvoryctl packages download game-client ./game-client.upack --exact 1.4.2 --group acme/game
arkvoryctl packages download game-client ./game-client.upack --group acme/game
```

オプションは `--group`、`--exact`、`--range`、`--stage`、`--prerelease`、`--order promoted` です。正確なバージョンには `--exact` を使います。`--version` はクライアントのバージョンを表示します。`resolve` はグループ、名前、バージョン、`artifactId`、`sha256`、`size`、`publishedAt`、`stagedAt`、ステージを表示します。`download` は解決後、そのアーティファクトを再開と SHA-256 検証付きでダウンロードします。[アップロードとダウンロード](./transfers#download-cli)を参照してください。クライアントには `package.read`、`artifact.read`、`content.read` が必要です。

HTTP には 2 つの操作があります。`resolvePackage` は `package.read` を必要とし、`resolve` と同じ情報を返します。`downloadPackageContent` は選択したバージョンのバイト列を送信し、`content.read` だけを必要とします。応答には `X-Arkvory-Artifact-Id` と `X-Arkvory-Package-Version` ヘッダーが追加されます。

```bash
curl -fL -G -H "Authorization: Bearer $ARKVORY_KEY" -o game-client.upack \
  --data-urlencode "name=game-client" --data-urlencode "group=acme/game" \
  --data-urlencode "range=^1.4" --data-urlencode "stage=release" \
  "$ARKVORY/api/v1/repositories/prod/packages/content"
```

名前指定のアドレスはリクエストごとに解決されます。範囲指定でダウンロードを再開する場合、2 回の呼び出しの間にファイルが変わっている可能性があります。代わりに `resolve` で得た `artifactId` を使ってダウンロードするか、`If-Range` に `ETag` を指定してください。

```typescript
const found = await prod.packages.resolve({
  name: 'game-client',
  group: 'acme/game',
  range: '^1.4',
  stage: 'release',
});
const stream = await prod.artifacts.downloadVerified(found.artifactId);
```

ビルドの取得だけを行うデプロイエージェントには、HTTP アドレス用なら `content.read` だけ、`arkvoryctl` 用なら読み取りプリセットを持つサービスキーを付与します。[CI 用のサービスアカウントとキー](./accounts#service-accounts)を参照してください。

## ラベル、メタデータ、添付ファイル {#labels}

パッケージのバージョンは通常のアーティファクトなので、[パス指定ファイル](./files#labels)で説明するすべての機能を利用できます。`test`、`staging`、`release` などのラベル、`git.commit` などのテキストメタデータ、コレクション、SBOM や署名などの添付ファイルです。最初のラベルは、アップロード時に `--label test` で設定します。ラベルはアーカイブを変更しません。自由なテキストであり、管理された状態ではありません。デプロイが依拠する承認にはステージを使います。[ステージとプロモーション](./promotion)を参照してください。

## 古いバージョンの保持 {#retention}

リポジトリの保持ポリシーが数えるのは、登録済みパッケージです。有効にすると、既定ではパッケージとチャネルごとに最新 10 ビルドを保持します。チャネルは `test`、`staging`、`release` のラベルです。ステージ、保護ラベル、ファイルパス、添付ファイルのリンクを持つバージョンは、保持処理で削除されません。管理者が有効にして削除に同意するまで、保持処理は無効です。[ストレージと保持](../operate/storage)を参照してください。

## エラー {#errors}

| 応答                         | 意味                                                                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 登録時の `400 invalid_input` | 有効な UPack ZIP ではない、ルートに `upack.json` がない、または名前やバージョンが不正です                                                                                                                          |
| 登録時の `503 unavailable`   | 保存したアーカイブを読み取れません。ストレージが応答しないか、アーカイブがありません。SDK とコマンドラインクライアントはリクエストを再試行します。この応答が続く場合は、管理者にストレージの確認を依頼してください |
| `409 version_exists`         | 識別情報はすでに別のアーカイブに対応しています。新しいバージョンを公開してください。同じバージョンを異なるバイト列で持つリポジトリへのプロモーションも同じエラーで失敗します                                       |
| 解決時の `404 not_found`     | フィルターに一致するものがありません。グループ、範囲、ステージを確認してください                                                                                                                                   |
| `403 permission_missing`     | キーに `package.read`、`package.publish`、`content.read` のいずれかが不足しています                                                                                                                                |

## 関連ページ {#related-pages}

- [アップロードとダウンロード](./transfers)
- [ステージとプロモーション](./promotion)
- [コマンドライン（arkvoryctl）](../protocols/cli)
- API リファレンス：[パッケージ](../api/reference/packages)、[ステージとプロモーション](../api/reference/promotion)
