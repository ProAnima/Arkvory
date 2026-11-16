---
title: イベント
description: 1つのカーソルでインストール全体の変更を追跡します。CloudEvents、権限、保持期間、再同期について説明します。
---

# イベント

イベントフィードは、インストール全体で何が変わったかを外部システムに伝えます。対象は、公開、削除、ファイルパス、パッケージ登録、注釈、添付ファイル、ステージ、プロモーション、コンテナーイメージ、npm、Git LFSです。読み取り可能なすべてのリポジトリを、[CloudEvents 1.0](https://cloudevents.io)形式の1つの順序付きストリームにまとめます。`arkvoryctl events tail`、[TypeScript SDK](./sdk)、または`GET /api/v1/events`で読み取ります。

イベントは、何かが変わったという手掛かりです。通常のAPIで現在の状態を読み取り、同じイベントが再び届いても問題が起きないように処理してください。

## フィードを読み取る {#read}

```bash
arkvoryctl events tail --cursor-file ./arkvory.cursor
```

コマンドは、イベントを1行に1件のJSONとして出力し、イベントごとに`--cursor-file`に位置を保存します。再実行すると、停止した位置から続行します。`--follow`を追加すると、Ctrl+Cまで新しいイベントを待ちます。`--types artifact.*,stage.added`で指定したタイプまたはプレフィックスだけを、`--repository releases`で1つのリポジトリだけを対象にします。`--after <id>`は指定したイベントの後から開始します。

TypeScriptでは、`follow`がページを順に読み取り、処理したイベントごとに`save`を呼び出します。

```ts
for await (const event of client.events.follow({ after: saved, save: (cursor) => store(cursor) })) {
  await handle(event);
}
```

HTTP経由の場合：

```bash
curl -H "Authorization: Bearer $ARKVORY_TOKEN" \
  "https://arkvory.example.com/api/v1/events?limit=100&types=artifact.*"
```

応答には`items`、`next`、`head`、`oldest`、`epoch`が含まれます。次のリクエストでは、`next`を`after`として渡してください。`after`がなければ、サーバーが保持している最も古いイベントから始まります。1回のリクエストは最大`limit`件のイベントを返します（1～500、既定で100）。`limit`件未満のページでも、フィードの終わりとは限りません。1回のリクエストが確認するのは最大5000件のイベントなので、`next`の位置が`head`と等しくなれば、すべて読み終えています。[listEvents](../api/reference/events#listEvents)を参照してください。

## イベント {#event}

```json
{
  "specversion": "1.0",
  "id": "0f7d8e3c-1d2b-4a5c-9e8f-0a1b2c3d4e5f:42",
  "source": "/arkvory/studio/repositories/releases",
  "type": "arkvory.artifact.published.v1",
  "subject": "9a7b6c5d-4e3f-4a1b-8c2d-1e0f9a8b7c6d",
  "time": "2026-10-17T09:30:00.000Z",
  "datacontenttype": "application/json",
  "dataschema": "urn:arkvory:event:artifact.published:1",
  "partitionkey": "repository:releases",
  "arkvoryposition": "42",
  "arkvoryepoch": "0f7d8e3c-1d2b-4a5c-9e8f-0a1b2c3d4e5f",
  "data": {
    "repository": "releases",
    "artifactId": "9a7b6c5d-4e3f-4a1b-8c2d-1e0f9a8b7c6d",
    "name": "game.upack",
    "size": "73400320",
    "sha256": "d563c767a739c2a9066a2668341a473c4cb0dcbc106c2d533133ad8311c3c007",
    "labels": ["ci"],
    "stages": []
  }
}
```

- `id`は、同じイベントの再配信では常に同じです。これを使って重複を排除してください。
- `data`には、アーティファクトの識別子と情報が含まれます。イベント時点の名前、10進文字列のサイズ、SHA-256、ラベル、ステージ、およびUPackパッケージです。ファイル、ステージ、イメージ、npm、Git LFSのイベントでは、パス、ステージ、ダイジェストまたはタグ付きのイメージ、npmパッケージ、オブジェクトIDが追加されます。
- メタデータの値、変更を行ったユーザー、秘密情報、ファイルの内容はイベントに含まれません。ラベルを含めると`data`が8 KiBを超える場合はラベルを省略し、`truncated`を`true`にします。
- `GET /api/v1/events/types`は、各タイプとその`data`のJSON Schemaを一覧表示します。

| グループ             | タイプ                                                                              |
| -------------------- | ----------------------------------------------------------------------------------- |
| アーティファクト     | `artifact.published`、`artifact.deleted`、`artifact.promoted`、`artifact.received`  |
| ファイルとパッケージ | `asset.revision.created`、`asset.restored`、`package.registered`                    |
| 説明                 | `annotation.updated`、`attachments.updated`、`stage.added`、`stage.removed`         |
| コンテナーイメージ   | `oci.manifest.pushed`、`oci.manifest.deleted`、`oci.tag.updated`、`oci.tag.deleted` |
| npmとGit LFS         | `npm.version.published`、`npm.tag.updated`、`npm.tag.deleted`、`lfs.object.stored`  |

## 順序と権限 {#order}

- 同じリポジトリのイベントは、変更がコミットされた順に届きます（`partitionkey`）。リポジトリ間の位置は、イベントが参照可能になった順序を示し、因果関係を示すものではありません。
- 位置は増加しますが、番号が飛ぶ場合があります。連続していると想定しないでください。
- ワーカーが番号を付けると、変更から約0.5秒後にイベントがフィードに現れます。ワーカーの停止中はイベントが待機し、失われることはありません。
- キーまたはアカウントが`artifact.list`を持つリポジトリのイベントを参照できます。[変更フィード](../api/reference/artifacts#listCatalogChanges)と同じ権限です。権限はリクエストごとに確認するため、取り消されるとイベントはすぐに非表示になります。
- `next`は、参照できないイベントも1リクエストあたり最大5000件まで通過するため、権限の狭いキーでも位置が停滞しません。分かるのは、その位置にサーバーの他のイベントがあったということだけです。

## 保持と復元 {#retention}

サーバーはイベントを168時間、最大5 000 000件保持します（`ARKVORY_EVENTS_RETENTION_HOURS`、`ARKVORY_EVENTS_MAX_ROWS`。[環境変数](../reference/environment)を参照）。フィードは一定期間を切り取ったもので、履歴ではありません。履歴はカタログの監査に保持します。イベントはバックアップに含まれません。

| 応答                                   | 起きたこと                                                        | 対処                                                                   |
| -------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `410`、`gone/events_cursor_expired`    | カーソルが`oldest`より古い                                        | APIで現在の状態を読み取り、`oldest`から続行します                      |
| `409`、`conflict/events_epoch_changed` | サーバーがバックアップから復元され、位置が新しい`epoch`を開始した | 現在の状態を読み取り、カーソルなし、または新しい先頭位置から続行します |

どちらの応答にも、現在の`epoch`、`oldest`、`head`を持つ`events`が含まれます。カーソルは`<epoch>:<position>`です。`arkvoryctl events tail`は終了コード6で終了し、SDKは同じフィールドを持つエラーを送出します。

## Webhook {#webhooks}

[Webhook](./webhooks)は、引き続き1つのリポジトリの変更フィードをHTTPアドレスに送信します。イベントフィードは、それを置き換えるものではありません。
