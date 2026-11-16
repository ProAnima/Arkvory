---
title: ステージとプロモーション
description: ビルドにステージを付けて別のリポジトリへプロモートし、デプロイエージェントがステージの最新ビルドを選べるようにします。
---

# ステージとプロモーション

ビルドは、テスト済み、承認済み、リリース済みという段階を経て、CI から本番環境へ進みます。Arkvory にはそのための 2 つの手段があります。**ステージ**は、`qa` や `release` のようにビルドに付ける印です。**プロモーション**は、バイト列を再送せずに別のリポジトリへビルドを公開します。どちらか一方でも、両方を組み合わせても使えます。

## ステージとリポジトリ {#concepts}

- **ステージ**は、ビルドがどの用途で承認されたかを示します。1 つのビルドに複数のステージを付けられ、最大 16 個です。ステージは、あるリポジトリ内のビルドに属します。専用のステージ操作でのみ変更でき、変更ごとに操作者と任意のコメントがジャーナルに記録されます。
- **プロモーション**は、`dev` から `staging`、さらに `prod` へというように、リポジトリ間でビルドをコピーまたは移動します。コピーは、移動先の新しいアーティファクトです。バイト列のアップロードは行いません。
- **ラベル**は履歴のない自由なタグです。ステージは、デプロイが依拠できる管理対象の印です。[パス指定ファイル](./files#labels)を参照してください。

ステージ名は英小文字、数字、`.`、`_`、`-` の 1～32 文字で、英字または数字で始めます。ステージを持つビルドは削除できず、保持処理でも残されます。先にステージを削除してください。

## ステージの追加と削除 {#stages}

コンソールで [[ui:metadata]] のアーティファクトを開きます。[[ui:promotionTitle]] セクションの [[ui:stagesTitle]] に、そのビルドのステージが表示されます。[[ui:stageName]] と、必要に応じて [[ui:stageComment]] を入力し、[[ui:stageAdd]] を選択します。各ステージには削除ボタンがあります。削除すると、そのステージを要求するデプロイは別のバージョンを選ぶようになるため、コンソールが確認を求めます。

ステージは、カタログの各行のチップと、[[ui:packages]] の [[ui:packageStages]] 列にも表示されます。

```bash
arkvoryctl stages add 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 qa --comment "smoke passed" --repository dev
arkvoryctl stages list 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository dev
arkvoryctl stages remove 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 qa --repository dev
arkvoryctl stages artifacts --stage release --repository prod
```

`stages artifacts` は、何らかのステージを持つすべてのビルド、または指定した 1 つのステージを持つビルドを、100 件ずつ一覧表示します。`next` を `--after` として渡します。

API では次のように操作します。

```bash
curl -X PUT "$ARKVORY/api/v1/repositories/dev/artifacts/$ID/stages/qa" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"comment":"smoke passed"}'
curl -X DELETE "$ARKVORY/api/v1/repositories/dev/artifacts/$ID/stages/qa" \
  -H "Authorization: Bearer $ARKVORY_KEY"
```

```typescript
await dev.stages.add(id, 'qa', 'smoke passed');
const { items } = await prod.stages.artifacts({ stage: 'release' });
```

操作は `setArtifactStage`、`removeArtifactStage`、`listArtifactStages`、`listStagedArtifacts` です。すでにあるステージを追加しても何も変わらず、最初の時刻とコメントが残ります。存在しないステージの削除は成功します。すでに 16 個のステージを持つビルドへの追加は、`409 stage_limit` で拒否されます。

## 別のリポジトリへのプロモーション {#promote}

コンソールでアーティファクトを開きます。そのビルドを読み取れ、少なくとも 1 つの他のリポジトリにプロモートできる場合、[[ui:promoteTitle]] フォームが表示されます。それらのリポジトリから [[ui:promoteTarget]] を選びます。移動先で設定する [[ui:promoteStages]] をカンマ区切りで入力し、[[ui:promoteComment]] を入力します。[[ui:promoteSubmit]] を選択します。許可する他のリポジトリがなければ、[[ui:promoteNoTargets]] が表示されます。

```bash
arkvoryctl promote 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository staging --to prod --stage release --comment CAB-142
arkvoryctl promote 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository staging --to prod --move
```

`--repository` が移動元、`--to` が移動先です。結果には、移動先の `repository`、新しい `artifactId`、`sourceArtifactId`、`mode`、`created`、`stages` が含まれます。

```bash
curl -X POST "$ARKVORY/api/v1/repositories/staging/artifacts/$ID/promote" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"target":"prod","mode":"copy","stages":["release"],"comment":"CAB-142"}'
```

```typescript
await staging.promotions.promote(id, { target: 'prod', mode: 'copy', stages: ['release'] });
```

新しいコピーへの応答は `201`、移動先にすでにある場合は `200` です。操作は `promoteArtifact` です。

### コピーと移動 {#copy-move}

| 項目               | コピー（既定）       | 移動                                                                                               |
| ------------------ | -------------------- | -------------------------------------------------------------------------------------------------- |
| 元のビルド         | 残ります             | コピーの公開と同じ処理で削除されます                                                               |
| 元のステージ       | 元のビルドに残ります | 指定したステージに加え、コピーに引き継がれます                                                     |
| コンソールでの指定 |                      | [[ui:promoteMove]] にチェックを付けます。コンソールが確認を求めます                                |
| 拒否される条件     |                      | 元のビルドが外部参照、ファイルパス、添付ファイルのリンクでまだ使われている場合。何も公開されません |

コピーに引き継がれる内容と、引き継がれない内容は次のとおりです。

- 元のビルドのラベル、メタデータ、コレクション、UPack の識別情報、指定したステージを引き継ぎます。新しい ID を持つ新しいアーティファクトです。SHA-256 は同じです。
- 添付ファイルとパスのポインターは引き継ぎません。移動先で再度関連付けてください。
- バイト列はアップロードしません。同じサーバー上では、それを使う最後のアーティファクトがなくなるまで、保存済みファイルを共有します。
- 新しいアップロードと同様に、移動先のクォータに算入されます。
- プロモーションを繰り返すと同じコピーが返されます。移動先に同じグループ、名前、バージョン、チェックサムのパッケージがすでにある場合、そのアーティファクトが返されます。バイト列が異なれば、サーバーは `409 version_exists` を返します。
- 移動先は移動元と異なる必要があります。ミラーは読み取り専用なので移動先にできません。[リポジトリ](./repositories#read-only)を参照してください。

中断したプロモーションは、短期間の予約を残します。同じアカウントで同じプロモーションを再実行して継続してください。

## プロモーション履歴 {#history}

コンソールのアーティファクトページには、[[ui:promotionHistory]] が古い順に表示されます。誰がステージを追加・削除したか、誰が別のリポジトリへビルドをコピー・移動したか、受け取ったコピーがどこから来たかを確認できます。[[ui:promotionMore]] は次の項目を読み込みます。

```bash
arkvoryctl promotions history 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository prod
arkvoryctl promotions journal --repository prod --after 120 --json
```

リポジトリのジャーナルは CI 用です。最後に確認した `sequence` を `--after` として指定してポーリングすると、新しいイベントを順番に取得できます。イベントには `sequence`、`action`（`stage.added`、`stage.removed`、`promoted`、`received`）、`stage`、`mode`、相手のリポジトリとアーティファクト、`actor`、`comment`、時刻が含まれます。1 ページは最大 100 イベントです。操作は `listArtifactPromotions` と `listRepositoryPromotions` です。

## デプロイ用ビルドの選択 {#resolve}

デプロイエージェントは「パッケージ `app` のうち、範囲 `^1.4` に含まれ、ステージ `release` を持つ最新ビルド」を要求します。Arkvory は正確に 1 つのバージョンを返し、該当するものがなければ `404` を返します。

```bash
arkvoryctl packages resolve app --group acme/game --range ^1.4 --stage release --repository prod --json
arkvoryctl packages download app ./app.upack --group acme/game --range ^1.4 --stage release --repository prod
```

`resolve` は、ダウンロードせずに選択結果を表示します。

```json
{
  "group": "acme/game",
  "name": "app",
  "version": "1.4.7",
  "artifactId": "3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11",
  "sha256": "…",
  "size": "73400320",
  "publishedAt": "2026-10-01T09:30:00.000Z",
  "stagedAt": "2026-10-02T12:00:00.000Z",
  "stages": ["qa", "release"]
}
```

HTTP では `resolvePackage` がこの情報を返し、`downloadPackageContent` は同じ選択条件で選んだバイト列を 1 回の呼び出しで送信します。

```bash
curl -fL -G -H "Authorization: Bearer $DEPLOY_KEY" -o app.upack \
  --data-urlencode "name=app" --data-urlencode "group=acme/game" \
  --data-urlencode "range=^1.4" --data-urlencode "stage=release" \
  "$ARKVORY/api/v1/repositories/prod/packages/content"
```

```typescript
const found = await prod.packages.resolve({
  name: 'app',
  group: 'acme/game',
  range: '^1.4',
  stage: 'release',
});
```

すべてのツールでフィルターは共通です。パッケージの `name`、`group`（グループがない場合は空）、正確なバージョンまたは範囲、`stage`、プレリリースを含めるかどうか、順序を指定します。範囲については [UPack パッケージ](./packages#versions)を参照してください。

既定では、SemVer で最も新しいバージョンが選ばれます。`--order promoted`（HTTP では `order=promoted`）では、番号が小さくても、最後にステージを付けたバージョンが選ばれます。ステージの指定が必要です。

名前はリクエストごとに解決されるため、2 回の呼び出しの間に誰かがプロモートすると、異なるビルドが返される可能性があります。再開が必要なダウンロードでは、`resolve` から `artifactId` を取得し、それをダウンロードしてください。

## ロールバック {#rollback}

順序が `promoted` の場合、ロールバックは通常の操作で行えます。問題のあるバージョンからステージを削除すると、その前にステージを付けたバージョンが選ばれます。古いバージョンを再び現在の対象にするには、そのステージを一度削除し、再度追加してください。すでにあるステージを追加しても時刻は更新されません。

```bash
arkvoryctl stages remove <faulty artifact id> release --repository prod
arkvoryctl packages download app ./app.upack --stage release --order promoted --repository prod
```

## 権限 {#permissions}

| 操作                                     | キー：リポジトリ操作権限                                              | 利用者：グループのアクセス         |
| ---------------------------------------- | --------------------------------------------------------------------- | ---------------------------------- |
| ビルドのステージと履歴の読み取り         | `artifact.read`                                                       | 読み取り                           |
| ステージ付きビルドとジャーナルの一覧表示 | `artifact.list`                                                       | 読み取り                           |
| ステージの追加・削除                     | `artifact.promote` と `artifact.read`                                 | 書き込み                           |
| コピーによるプロモーション               | 移動元：`artifact.read` と `content.read`。移動先：`artifact.promote` | 移動元の読み取り、移動先の書き込み |
| 移動によるプロモーション                 | 上記に加え、移動元の `artifact.promote`                               | 両方の書き込み                     |
| バージョンの解決                         | `package.read`                                                        | 読み取り                           |
| 名前で選んだバージョンのダウンロード     | `content.read`                                                        | 読み取り                           |

ダウンロードだけを行うデプロイエージェントのキーには、読み取るリポジトリの `content.read` が必要です。`arkvoryctl packages download` では、さらに `package.read` と `artifact.read` も必要です。[権限](./accounts#permissions)を参照してください。

サーバー同士で自動的にビルドを交換することもできます。リポジトリは、別サーバーのリポジトリで特定のステージを持つバージョンをインポートできます。[ミラー](../operate/mirrors)を参照してください。

## 関連ページ {#related-pages}

- [UPack パッケージ](./packages)と[リポジトリ](./repositories)
- [アカウントとアクセス](./accounts)
- [コマンドライン（arkvoryctl）](../protocols/cli#packages-and-promotion)
- API リファレンス：[ステージとプロモーション](../api/reference/promotion)
