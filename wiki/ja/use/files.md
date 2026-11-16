---
title: パス指定ファイル
description: 完全な履歴を持つファイルをパスに保存し、以前のリビジョンを復元し、ラベル、メタデータ、コレクション、添付ファイルを追加します。
---

# パス指定ファイル

パス指定ファイルは、`builds/game/1.4/GameSetup.exe` のようなリポジトリ内の名前で、保存済みの 1 つのファイルを指します。同じパスに新しい内容を保存すると、パスは新しいファイルを指すようになります。古いファイルも残るため、元に戻せます。「現在の Setup.exe」を指す安定したアドレスが利用者やスクリプトに必要な場合は、パスを使ってください。

## パスとは {#what-it-is}

保存したファイルはすべて、ID と SHA-256 を持つ不変の**アーティファクト**です。パスはアーティファクトへのポインターです。ポインターを変更するたびに、1 から始まる番号付きの**リビジョン**になります。リビジョンが削除・編集されることはありません。

パスは 1～1024 文字です。`/` で区切ったセグメントからなります。セグメントは空にできず、`.` や `..` にできず、制御文字を含められません。パスには `\` と `:` を含められません。大文字と小文字を区別します。

パスとパッケージは、同じアーティファクトに対する 2 つの見方です。UPack アーカイブにパスを付けることもできます。[UPack パッケージ](./packages)を参照してください。

## パスへのファイルの保存 {#put}

`upload.create`、`upload.write`、`upload.complete` に加え、`asset.read`、`asset.write`、`artifact.read` の操作権限が必要です。グループでは書き込みアクセスが必要です。[権限](./accounts#permissions)を参照してください。

### arkvoryctl での保存 {#put-cli}

```bash
arkvoryctl put "./Build/Game Setup.exe" builds/game/1.4/GameSetup.exe
arkvoryctl put ./config.json config/settings.json --label test
arkvoryctl get builds/game/1.4/GameSetup.exe ./GameSetup.exe
```

`put` は、元ファイルの横にチェックポイントを保存しながら、パートに分けてファイルをアップロードし、そのパスの次のリビジョンに設定します。`path`、`revision`、アーティファクトの `id`、`created` を表示します。パスがすでに同じバイト列を指していれば、`put` は何もアップロードせず、`created` を `false` と表示します。ビルド手順を繰り返しても追加の転送は発生しません。アップロード中に他の人がパスを変更すると、`put` は `revision_mismatch`（終了コード 6）で停止し、その人の変更を上書きしません。履歴を読んで判断してください。アップロードが停止した場合は、同じコマンドを再実行します。[アップロードとダウンロード](./transfers#resume)を参照してください。

`get` は、再開と SHA-256 検証付きで現在のリビジョンをダウンロードします。パスの一覧表示や履歴の読み取り用のコマンドはありません。コンソールまたは API を使ってください。

### 1 回の HTTP リクエストでの保存 {#put-http}

Raw の `PUT` は、`curl -T` と同様に、1 回のリクエストでバイト列をパスに保存します。

```bash
curl -T ./GameSetup.exe -H "Authorization: Bearer $ARKVORY_KEY" \
  "$ARKVORY/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe"
```

応答には `path`、`revision`、`created` と、`id`、`size`、`sha256` を含む `artifact` があります。新しいリビジョンは `201` を返します。同じバイト列を再送した場合は、`created` が false の `200` を返します。2 つの任意ヘッダーがあります。`X-Checksum-Sha256` はサーバーが 1 回の読み取りでバイト列を検証できるようにし、`If-None-Match: *` はパスがすでに存在すればリクエストを拒否します。1 回のリクエストは 30 分以内に完了する必要があります。大容量ファイルには `put` を使ってください。[Raw ファイル](../protocols/raw-files)を参照してください。

### コンソールでの保存 {#put-console}

1. [[ui:upload]] でファイルをアップロードします。[アップロードとダウンロード](./transfers)を参照してください。
2. [[ui:catalog]] で [[ui:open]] を使ってアーティファクトを開きます。
3. [[ui:assetTitle]] で [[ui:assetPath]] を入力します。例は `releases/current.upack` です。
4. [[ui:currentRevision]] を入力します。新しいパスには `0`、既存のパスには [[ui:history]] に表示される現在のリビジョンを指定します。
5. [[ui:assign]] を選択します。

リビジョンフィールドは、2 人が同時にパスを変更することを防ぎます。現在のリビジョンでない場合、サーバーは競合として拒否します。履歴を再度読み込み、やり直してください。

### API と SDK での保存 {#put-api}

`setAsset` は、アップロード済みのアーティファクトをパスが指すように設定します。`expectedRevision` は、パスを作成する場合は `0`、それ以外は現在のリビジョンです。

```bash
curl -X PUT "$ARKVORY/api/v1/repositories/releases/asset" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"path":"builds/game/1.4/GameSetup.exe","artifactId":"3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11","expectedRevision":0}'
```

```typescript
const current = await releases.assets.get('builds/game/1.4/GameSetup.exe');
await releases.assets.assign('builds/game/1.4/GameSetup.exe', artifactId, current.revision);
```

競合時の応答は `409 revision_mismatch` です。推測したリビジョンで再試行しないでください。応答が失われた場合はパスを読み取ります。新しいアーティファクトがすでに設定されていれば完了です。

## パスの読み取り {#read}

- `arkvoryctl get PATH OUTPUT` は現在のファイルをダウンロードします。
- `GET /api/v1/repositories/<repository>/raw/<path>` と `GET /api/v1/repositories/<repository>/asset/content?path=<path>` はバイト列を返します。どちらも `content.read` が必要で、範囲指定と ETag に対応します。
- `getAsset`（`GET …/asset?path=`）はポインターを返します。内容は `path`、`revision`、`artifactId` です。
- `listAssetPage`（`GET …/assets/page?prefix=`）はポインターを一覧表示します。1 ページは最大 100 件（既定 50 件）で、UTF-8 パスのバイト順です。プレフィックスは文字どおりに扱われ、大文字と小文字を区別します。`next` を `after` として渡します。旧来の `listAssets` は最大 1,000 件を返し、プレフィックスを絞り込むよう求めます。

```typescript
const page = await releases.assets.list({ prefix: 'builds/game/', limit: 100 });
```

## リビジョンと履歴 {#history}

コンソールで [[ui:history]] を開き、[[ui:assetPath]] にパスを入力して [[ui:historyLoad]] を選択します。表には [[ui:revision]]、時刻（[[ui:date]]）、作成者（[[ui:actor]]）、復元されたリビジョンの場合は復元元（[[ui:source]]）が表示されます。新しいものが先頭です。[[ui:historyMore]] は古いものを 50 件ずつ読み込みます。行の [[ui:open]] は、そのリビジョンのアーティファクトを開き、そこから当時の内容をダウンロードできます。

API の `getAssetHistory`（`…/asset/history?path=&before=`）は新しい順のページを返します。`before` は前のページの最後のリビジョンです。`getAssetRevision`（`…/asset/revision?path=&revision=`）は 1 つのリビジョンを返します。作成者と時刻の記録を始める前に書き込まれたリビジョンでは、これらの値は空です。読み取りには `asset.read` が必要です。

## 以前のリビジョンの復元 {#restore}

復元は、パスが古いリビジョンのアーティファクトを指すようにします。バイト列をコピーせず、リビジョンも削除しません。復元自体が新しい最新リビジョンとなり、履歴に復元元が表示されます。

コンソールで履歴を読み込み、目的のリビジョンの復元ボタンを選択します。現在のリビジョンのボタンは無効です。復元には `asset.restore`、`asset.read`、`artifact.read` が必要です。

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/asset/restore" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"path":"builds/game/1.4/GameSetup.exe","sourceRevision":3,"expectedRevision":5}'
```

```typescript
await releases.assets.restore('builds/game/1.4/GameSetup.exe', 3, 5);
```

`expectedRevision` は、最後に確認した最新リビジョンです。その後パスが変更されていれば、サーバーは `409 revision_mismatch` を返します。コンソールにはメッセージが表示され、履歴の再読み込みを求められます。復元しても古いラベルやメタデータは戻りません。現在のまま維持されます。

## ラベル、メタデータ、コレクション {#labels}

各アーティファクトには 3 種類の付加情報があります。いつでも変更できます。ファイル自体は変わりません。

| 種類         | 例                                             | 規則                                                                                                                 |
| ------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| ラベル       | `test`、`staging`、`release`、`linux`          | 最大 32 個。各ラベルは英字、数字、`_`、`.`、`:`、`-` の 1～64 文字。大文字と小文字を区別します                       |
| メタデータ   | `build.number` = `42`、`git.commit` = `abc123` | テキストフィールドを最大 32 個。キーは英字で始まり、英字、数字、`_`、`.`、`-` の最大 64 文字。値は最大 1024 文字です |
| コレクション | `desktop`、`nightly`                           | 最大 32 個。ラベルと同じ規則です。バージョンやパスにかかわらずアーティファクトをまとめます                           |

ラベルは自由なテキストです。アクセスを付与せず、ファイルを移動しません。コンソールは [[ui:labelPresets]]（`nightly`、`test`、`staging`、`release`）を候補として表示しますが、任意のラベルを使え、`relase` も修正されません。デプロイが依拠する承認にはステージを使ってください（[ステージとプロモーション](./promotion)）。

**コンソール。** [[ui:metadata]] でアーティファクトを開きます。[[ui:labels]] と [[ui:collections]] はカンマ区切りで入力します。[[ui:metadataFields]] のフィールドには [[ui:metadataAdd]] を使い、[[ui:metadataKey]] と [[ui:metadataValue]] を指定します。[[ui:metadataJson]] では同じデータを JSON として編集できます。[[ui:save]] を選択します。

**arkvoryctl。** アップロード時に `--label test` はラベルを 1 つ追加し、`--file metadata.json` は `labels` と `metadata` を指定します。

```json
{ "labels": ["test"], "metadata": { "build.number": "42", "git.commit": "abc123" } }
```

既存のアーティファクトを変更するには、まず読み取り、そのリビジョンと新しい状態全体を送信します。

```bash
arkvoryctl annotations get 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl annotations set 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --revision 3 --file annotations.json
```

`annotations.json` には `labels`、`metadata`、`collections` の 3 つのキーがすべて必要です。省略したものは空になります。保存すると集合全体が置き換わります。先に別の人が保存した場合、サーバーは `409 revision_mismatch` を返します。再度読み取って判断してください。SDK はこの保存を自動再試行しません。

```typescript
const current = await releases.annotations.get(id);
await releases.annotations.update(id, current.revision, {
  labels: [...current.labels, 'release'],
  metadata: current.metadata,
  collections: current.collections,
});
```

読み取りには `annotation.read`、書き込みには `annotation.write` と `artifact.read` が必要です。

**検索。** [[ui:catalog]] の [[ui:search]] にテキストを入力します。大文字と小文字を区別せずに、ファイル名とメタデータの値を検索します。[[ui:labelFilter]] は 1 つのラベルで絞り込みます。[[ui:metadataFilter]] は、大文字と小文字を含めてキーと値の両方が完全一致するものを探します。`arkvoryctl` では次を実行します。

```bash
arkvoryctl search --query game --label release
arkvoryctl search --collection nightly
arkvoryctl search --metadata-key git.commit --metadata-value abc123
```

`--metadata-key` と `--metadata-value` は一緒に指定します。1 ページの結果は最大 100 件です。`next` を `--after` として渡します。フィルターは AND で組み合わせます。

## 添付ファイル {#attachments}

添付ファイルは、マニフェスト、SBOM、署名、レポートなどの任意のファイルをビルドに関連付けます。添付ファイルは、名前と、同じリポジトリ内の別のアーティファクトへのリンクからなります。ビルドと添付ファイルは別々のファイルのままです。

| 規則           | 値                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| 種類           | `manifest`、`sbom`、`signature`、`report`、`file`                                                           |
| ビルドごとの数 | 最大 32 個                                                                                                  |
| 名前           | 1～240 文字。大文字と小文字を区別せず、ビルド内で一意。`/`、`\`、制御文字、先頭・末尾の空白は使用できません |
| 説明           | 最大 512 文字。空でも構いません                                                                             |
| 対象           | 同じリポジトリの公開済みアーティファクト。ビルド自体は指定できません                                        |

種類はファイルの用途を示すだけです。Arkvory は署名を検証せず、SBOM を読み取らず、マニフェストを実行しません。

コンソールでアーティファクトを開きます。[[ui:attachmentsTitle]] の [[ui:attachmentAdd]] フォームを展開します。[[ui:attachmentSource]] を選びます。[[ui:attachmentUpload]] は新しいファイルを送信して関連付け、[[ui:attachmentExisting]] は公開済みのアーティファクトを関連付けます。[[ui:attachmentKind]] を [[ui:attachmentManifest]]、[[ui:attachmentSbom]]、[[ui:attachmentSignature]]、[[ui:attachmentReport]]、[[ui:attachmentFile]] から選びます。[[ui:attachmentName]] と、必要に応じて [[ui:attachmentDescription]] を入力します。次に [[ui:attachmentAdd]] を選択します。[[ui:attachmentUnlink]] はリンクを削除し、ファイルは残します。[[ui:attachmentReload]] は一覧を再読み込みします。添付ファイルのアップロードが中断すると、[[ui:attachmentRecovery]] に再開用のアップロード ID が表示されます。

一覧の変更ごとに番号付きのバージョンが作成されます。[[ui:attachmentHistory]] は以前のバージョンを表示し、[[ui:attachmentRestore]] はその 1 つを新しいバージョンとして復元します。

`arkvoryctl` では、ファイルに一覧全体を JSON 配列として記述します。

```json
[
  {
    "name": "build.json",
    "kind": "manifest",
    "artifactId": "64b42380-902d-41cf-9151-10c12e4809dc",
    "description": "Build provenance from CI"
  }
]
```

```bash
arkvoryctl attachments get 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl attachments set 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --revision 0 --file attachments.json
arkvoryctl attachments history 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`--revision` は `get` で読み取った番号で、新しいビルドは `0` です。API では `replaceBuildAttachments` が `expectedRevision` と `items` を受け取り、`getBuildAttachments` と `getBuildAttachmentHistory` で読み取ります。添付ファイルをダウンロードするには、リンク先の `artifactId` を通常のダウンロードに使います。読み取りには `annotation.read`、変更には `annotation.write` と `artifact.read`、添付ファイルのアップロードにはアップロードの操作権限が必要です。

別のリポジトリへのプロモーションでは、添付ファイルとパスは引き継がれません。[ステージとプロモーション](./promotion)を参照してください。

## 関連ページ {#related-pages}

- [Raw ファイル](../protocols/raw-files)
- [アップロードとダウンロード](./transfers)と [UPack パッケージ](./packages)
- [コマンドライン（arkvoryctl）](../protocols/cli)
- API リファレンス：[パス指定ファイル](../api/reference/files)、[アーティファクトとカタログ](../api/reference/artifacts)、[ビルドの添付ファイル](../api/reference/attachments)
