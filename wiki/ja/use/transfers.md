---
title: アップロードとダウンロード
description: あらゆるサイズのファイルを送受信し、中断後に再開し、チェックサムを確認し、キーを持たない相手にファイルを共有します。
---

# アップロードとダウンロード

あらゆるサイズのファイルをパートに分けて Arkvory に送信でき、転送が停止しても停止した位置から再開できます。このページでは、コンソール、`arkvoryctl`、SDK、HTTP API での方法を説明します。

アップロードには `upload.create`、`upload.read`、`upload.write`、`upload.complete` の操作権限が必要です。グループでは書き込みアクセスに相当します。ダウンロードには `content.read` が必要です。[権限](./accounts#permissions)を参照してください。

## ファイルのアップロード {#upload}

アップロードの手順は共通です。クライアントはファイル全体の SHA-256 を計算し、ファイル名、サイズ、チェックサムを指定してアップロードセッションを開始します。ファイルをパートに分けて送信します。すべてのパートがそろうと、サーバーが結合してチェックサムを検証し、不変のアーティファクトとしてファイルを公開します。

### コンソールでのアップロード {#upload-console}

1. サイドバーの [[ui:upload]]、または上部バーの [[ui:uploadFile]] を選択します。
2. [[ui:chooseFile]] でファイルを選びます。コンソールはチェックサムを計算するため、ファイル全体を 1 回読み取ります（[[ui:hashing]]）。数十ギガバイトのファイルでは、最初のバイトを送信するまでに時間がかかります。
3. [[ui:startUpload]] を選択します。[[ui:transferTitle]] の下のバーに進行状況が表示されます。
4. ファイルが公開されると、その ID が表示されます。[[ui:catalog]] を開いて確認します。

[[ui:pause]] は転送を停止し、到着済みのパートを保持します。アップロード中にページを離れようとすると、ブラウザーが警告します。コンソールはファイルと一緒にラベルやメタデータを送信しません。後から [[ui:metadata]] で追加してください。[パス指定ファイル](./files#labels)を参照してください。

### arkvoryctl でのアップロード {#upload-cli}

```bash
arkvoryctl upload ./Build/Game.zip --label test
arkvoryctl upload ./Build/Game.zip --file metadata.json --state ./job-state/game.json
arkvoryctl uploads status 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl uploads cancel 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`upload` は公開後にアーティファクトを表示します。`--label` はラベルを 1 つ追加します。`--file` は `labels` と `metadata` を含む JSON ファイルを指定し、こちらが優先されます。パスを指定してファイルを保存するには `put`、UPack を公開するには `packages publish` を使います。[コマンドライン](../protocols/cli#transfers)を参照してください。

### SDK でのアップロード {#upload-sdk}

```typescript
const session = await releases.uploads.create(idempotencyKey, {
  name: 'Game.zip',
  size: String(file.size),
  sha256,
  labels: ['test'],
  metadata: { commit: 'abc123' },
});
const artifact = await releases.uploads.resume(session.id, file, {
  onProgress: (bytes) => console.log(bytes),
});
```

`resume` はサーバーにないパートを送信し、アップロードを完了します。Node.js でのハッシュ計算を含む完全な例は、[TypeScript SDK](../protocols/sdk#upload-a-large-file-with-resume-node-js)にあります。

### HTTP API でのアップロード {#upload-http}

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/uploads" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Idempotency-Key: game-1234" \
  -H "Content-Type: application/json" \
  -d '{"name":"Game.zip","size":"73400320","sha256":"<64 hex digits>"}'

curl "$ARKVORY/api/v1/repositories/releases/uploads/$ID/parts" -H "Authorization: Bearer $ARKVORY_KEY"

curl -X PUT "$ARKVORY/api/v1/repositories/releases/uploads/$ID/parts/0" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/octet-stream" \
  -H "X-Content-SHA256: <64 hex digits of this part>" --data-binary @part-0.bin

curl -X POST "$ARKVORY/api/v1/repositories/releases/uploads/$ID/complete" \
  -H "Authorization: Bearer $ARKVORY_KEY"
```

サイズは 10 進数の文字列です。`Idempotency-Key` は英字、数字、`.`、`_`、`:`、`-` の 1～128 文字です。最初の呼び出しの応答にはアップロードの `id` と `expiresAt` が含まれます。2 回目はパートサイズ `partBytes` と保存済みパートを返します。最後のパート以外は、すべて正確にそのサイズでなければなりません。操作は `createUpload`、`listUploadParts`、`putUploadPart`、`completeUpload` です（[アップロード](../api/reference/uploads)）。

小さいファイルには、より簡単な 2 つの方法を使えます。`PUT /uploads/{id}/content` はファイル全体を 1 回のリクエストで送信します。`PUT /raw/<path>` は、`curl -T` と同様に、1 回のリクエストでセッションを作成し、バイト列を送信して指定パスに保存します。どちらも 30 分以内にリクエストを完了する必要があります。大容量のファイルや低速な転送にはパートを使ってください。[Raw ファイル](../protocols/raw-files)を参照してください。空のファイルは 1 回のリクエストで送信します。

## ファイルサイズの上限 {#limits}

| 制限                       | 値                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| パートサイズ               | 約 78 GiB までのファイルでは 8 MiB。それ以上では、パート数が 10,000 を超えないよう、16、32、64 MiB と増え、最大 1 GiB になります。 |
| アップロードごとのパート数 | 10,000（インデックス 0～9999）                                                                                                     |
| 最大ファイルサイズ         | 1 GiB のパート 10,000 個、約 10 TiB                                                                                                |
| 上限の引き下げ             | 管理者が `ARKVORY_MAX_OBJECT_BYTES` で設定できます                                                                                 |
| ファイル名                 | 1～240 文字。`/`、`\`、制御文字は使用できません                                                                                    |

サーバーはアップロードの作成時にパートサイズを選び、そのアップロード全体で維持します。`GET /api/v1/capabilities` は `maxObjectBytes`、`partBytes`、`maxPartBytes`、`maxParts` を示します。コンソールは、サーバーの上限を超えるファイルを開始前に拒否します。

クライアントは、ハッシュ計算と送信の間、1 パートをメモリに保持します。78 GiB を超えるファイルではパートが大きくなり、それに伴ってメモリ使用量も最大 1 GiB まで増えます。

サーバーには、パートと結合後のファイルを一時的に同時保持できる空きディスク容量が必要です。ディスクがいっぱいの場合、サーバーは `507 storage_full` でアップロードを拒否します。

## アップロードの再開 {#resume}

アップロードセッションは、失敗後もパートを保持します。再開するには、同じファイルと同じセッションをクライアントに渡します。

**コンソール。** タブを開いたままなら、[[ui:pause]] の後に [[ui:startUpload]] を再び選択します。タブを閉じる場合は、アップロード ID を控えてください。[[ui:resumeTitle]] を展開すると、アップロード実行中は [[ui:uploadId]] フィールドに ID が表示されます。後で同じファイルを選び、そこに ID を入力して [[ui:startUpload]] を選択します。コンソールはパートと手元のファイルを比較します。ファイルが異なると停止して通知します。[[ui:newUpload]] は両方のフィールドを消去し、新しいアップロードを開始します。

[[ui:idempotency]] フィールドも、元のセッションに戻る方法です。コンソールが自動入力します。同じキーと同じファイルを使うと、2 つ目のセッションを作らずに同じセッションが返されます。

**arkvoryctl。** 同じオプションで同じコマンドを実行します。クライアントは最初のリクエスト前に、元ファイルの横の `<file>.arkvory-upload.json`、または `--state` で指定したファイルにチェックポイントを保存しています。同じバイト列を新しいアーティファクトとして公開するには、新しい `--state` を使います。CI では、再試行の間も元ファイルと状態フォルダーを保持してください。ファイル、サーバー、リポジトリ、オプションが変わると、`checkpoint_mismatch`（終了コード 6）になります。

**SDK。** 保存したセッション ID と同じファイルで `resume` を再び呼び出します。`create` の応答自体が失われた場合も、同じ冪等キーと同じ記述情報で `create` を呼び出すと、同じセッションが返されます。

**HTTP。** `listUploadParts` で保存済みパートを読み取り、不足するインデックスを送信します。同じバイト列でパートを再送しても安全です。保存済みインデックスに異なるバイト列を送ると、`409 upload_state` で拒否されます。

クライアントはネットワーク障害や `408`、`429`、`502`、`503`、`504` の後にも、自動的にリクエストを再試行します。1 操作につき最大 20 回で、待ち時間は 0.5 秒から 60 秒まで増え、`Retry-After` に従います。`arkvoryctl` には、低速回線向けの `--retries` と `--attempt-timeout` オプションがあります。

アップロードを再開できるのは、それを作成したアカウントまたはキーだけです。他の利用者からは存在しないものとして扱われます。サービスキーをローテーションしてもアカウントは変わらないため、新しいキーでアップロードを再開できます。

## チェックサム {#checksums}

- **アップロード前。** コンソール、CLI、SDK はファイルの SHA-256 を計算し、セッションに送信します。
- **各パート。** `X-Content-SHA256` ヘッダーにパートのチェックサムを指定します。バイト列が一致しないパートは `422 integrity_mismatch` で拒否され、保存されません。
- **完了時。** サーバーは公開前に、結合したファイルのサイズと SHA-256 をセッションの情報と照合します。不一致は `422 integrity_mismatch` となり、CLI は終了コード 5 で終了します。アーティファクトは表示されません。
- **ダウンロード。** コンソール、CLI、SDK は、ファイルを引き渡す前に全体の SHA-256 を検証します。最終ファイルは検証を通過した後にだけ現れます。

ファイルの ETag は、そのチェックサム `"sha256:<64 hex digits>"` です。アーティファクトの詳細に SHA-256 が表示され、[[ui:copyHash]] でコピーできます。

## 完了ジョブ {#completion}

大容量ファイルの結合には時間がかかります。16 GiB 未満のファイルでは、`completeUpload` がリクエスト内で結合し、最大 30 分かかることがあります。16 GiB 以上では、SDK、それを使うコンソールと CLI は、ワーカーに完了処理を依頼します。`enqueueCompletion` はジョブを含む `202` を返し、クライアントは状態が `completed` または `failed` になるまで `getCompletionJob` をポーリングします。失敗したジョブには `integrity_mismatch` などのエラーコードが含まれます。

ジョブにはワーカーサービスの実行が必要です。ワーカーは待ち時間を増やしながら最大 5 回試行し、再試行では解消できないエラーの場合は直ちに打ち切ります。`enqueueCompletion` を繰り返すと同じジョブが返されます。サーバーが再起動してもジョブは継続します。アップロードをやり直す必要はありません。

## アップロードの有効期限 {#expiry}

未完了のアップロードセッションは、作成から 7 日後に期限が切れます。時刻は `expiresAt` に示され、延長されず、パートを送信しても変わりません。期限後は、パート送信と `complete` が `409 upload_expired` で拒否されます。新しいアップロードを開始してください。公開済みファイルには有効期限がありません。

サーバーは、期限切れセッションとそのパートをバックグラウンドで削除します。期限前に破棄するには `arkvoryctl uploads cancel ID` または `cancelUpload` を使います。キャンセルは一時停止とは異なり、パートは破棄されます。

## ファイルのダウンロード {#download}

### コンソールでのダウンロード {#download-console}

[[ui:catalog]] のファイルの横、またはアーティファクトの詳細で [[ui:download]] を選択します。ブラウザーが保存先を尋ねます。ファイルは [[ui:downloads]] のキューに入ります。キューは一時コピーにデータを書き込み、SHA-256 を検証してから保存先ファイルを置き換えます。

キューは、ブラウザーのファイルシステムアクセス機能を通じて大容量ファイルを書き込むため、HTTPS またはローカルコンピューター上で動作する Chrome か Edge が必要です。他のブラウザーでは CLI または SDK を使ってください。

ダウンロードの状態は [[ui:downloadQueued]]、[[ui:downloadRunning]]、[[ui:downloadRetrying]]、[[ui:downloadPaused]]、[[ui:downloadSaving]]、[[ui:downloadCompleted]]、[[ui:downloadFailed]]、[[ui:downloadCancelled]] です。ボタンは次のとおりです。

| ボタン                                         | 動作                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| [[ui:downloadResume]]                          | 一時停止または失敗したダウンロードを、保存済みの部分から再開します |
| [[ui:downloadCancel]]                          | 1 件のダウンロードをキャンセルし、一時コピーを削除します           |
| [[ui:downloadsPause]] / [[ui:downloadsResume]] | キュー全体を停止・再開します                                       |
| [[ui:downloadsClearWaiting]]                   | 待機中のダウンロードをキャンセルします                             |
| [[ui:downloadsCancel]]                         | すべてのダウンロードをキャンセルします                             |
| [[ui:downloadsClearFinished]]                  | 完了した行を削除して空きを作ります（キューは 64 件まで保持します） |
| [[ui:downloadRestore]]                         | ページの再読み込み後に未完了のダウンロードを復元します             |

[[ui:downloadSettings]] には [[ui:downloadConcurrency]]（1～8、既定 2）、[[ui:downloadInterval]]（0～60,000 ms、既定 250）、[[ui:downloadWait]]（1～1800 秒、既定 300）があります。適用するには [[ui:downloadApply]] を選択します。これらの設定でサーバーの上限を引き上げることはできません。

再読み込みやタブを閉じた後は、同じサーバーに同じアカウントでサインインし直し、[[ui:downloads]] を開いて [[ui:downloadRestore]] を選択します。復元したダウンロードは一時停止状態で待機します。それぞれの [[ui:downloadResume]] を選択し、保存先ファイルを再び選んでください。ブラウザーには一時コピー用の空き容量が必要です。

### arkvoryctl でのダウンロード {#download-cli}

```bash
arkvoryctl download 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game.zip
arkvoryctl get builds/game/1.4/Game.zip ./Game.zip
arkvoryctl packages download app ./app.upack --range ^1.4 --stage release
```

ダウンロード中は、保存先の横に `<output>.arkvory-part` と `<output>.arkvory-download.json` が残ります。中断後は同じコマンドを再実行してください。最終ファイルは SHA-256 の検証後にだけ現れます。既存の保存先は上書きされません（`destination_exists`、終了コード 6）。

### HTTP：範囲と ETag {#download-http}

`downloadArtifact` はアーティファクトのバイト列を返します。`HEAD` はヘッダーだけを返します。

```bash
curl -fL -H "Authorization: Bearer $ARKVORY_KEY" -C - -o Game.zip \
  "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/content"
```

- `Accept-Ranges: bytes`。単一の範囲には `Range: bytes=1048576-`、`bytes=0-1023`、`bytes=-500` を送ります。応答は `206` で、`Content-Range` が付きます。複数範囲の同時指定には対応しておらず、その場合はサーバーがファイル全体を送ります。開始位置が終端を超えると `416` になります。
- `ETag` は `"sha256:<hex>"` です。この値を `If-None-Match` に指定すると `304` が返されます。`If-Range` に指定した場合は、ファイルが同じときだけ範囲の続きを取得し、それ以外はファイル全体が返されます。
- `curl -C -` はダウンロードを再開します。`packages/content?name=app&range=^1.4` などの名前指定アドレスは、リクエストごとに解決されるため、2 回の呼び出しの間にファイルが変わる可能性があります。安全に再開するには、取得した ETag を `If-Range` に指定するか、先に名前を解決してからアーティファクト ID でダウンロードします。

SDK は 8 MiB の範囲ごとに内容を読み取り、それぞれ検証します。[TypeScript SDK](../protocols/sdk#download-with-verification)を参照してください。

## キーを持たない相手へのリンク {#links}

ダウンロードリンクを使うと、テスター、顧客、認証情報を持たないビルドマシンなどに、キーなしで 1 つのファイルを取得してもらえます。リンクは期限まで、そのアーティファクトだけに `GET` と `HEAD` でアクセスできます。`curl -C -` と範囲指定にも対応します。

コンソールで [[ui:metadata]] のアーティファクトを開き、[[ui:downloadLink]] を選択します。コンソールはリンクをコピーし、有効期限とともに表示します。リンクの有効期間は 1 時間です。このボタンは、ファイルをダウンロードできる場合にだけ表示されます。

```bash
arkvoryctl link 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --ttl 900
```

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/links" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"ttlSeconds":900}'
```

有効期間は 60 秒～24 時間（86,400 秒）で、既定は 1 時間です。応答には `dtl_` で始まる `token`、`url`、`expiresAt` が含まれます。CLI と SDK は完全な URL を表示します。API はパスを返すため、サーバーのアドレスに付加します。

リンクは秘密情報です。持っている人は誰でもファイルをダウンロードできます。期限前にリンクを取り消すことはできないため、有効期間を短くしてください。URL をキーとして扱い、チャットルームや公開ログに残さないでください。プロキシのログやブラウザーの履歴には記録される可能性があります。[ダウンロードリンク](../api/reference/links)を参照してください。

## 制限とキュー {#queues}

管理者は、サーバーで同時に実行できる転送数と転送速度を設定します。既定では、サーバー全体でアップロード 2 件とダウンロード 16 件、1 アカウントでアップロード 1 件とダウンロード 4 件を同時に実行できます。超過分はキューで最大 20 秒待ちます。キューが満杯か待ち時間が終了すると、サーバーは `Retry-After` 付きの `503` を返し、クライアントは待機して再試行します。毎秒のバイト数の予算を設定すると転送は遅くなりますが、停止はしません。利用者はこれらの予算を確認・変更できません。値は[環境変数](../reference/environment#transfers-and-bandwidth)を参照してください。

## エラー {#errors}

| 応答                       | 理由                                                                                     | 対処                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `409 upload_expired`       | セッション作成から 7 日を超えました                                                      | 新しいアップロードを開始します                                       |
| `409 upload_state`         | アップロードがすでに公開済みかキャンセル済み、または保存済みパートのバイト列が異なります | 新しいアップロードを開始するか、同じファイルを使っているか確認します |
| `409 parts_incomplete`     | 到着していないパートがあります                                                           | アップロードを再開します                                             |
| `409 part_mismatch`        | パートが予定されたパートサイズまたはインデックスに一致しません                           | `listUploadParts` のパートサイズを使って再開します                   |
| `409 idempotency_mismatch` | キーが別のファイルに使われました                                                         | 新しいキーを使います                                                 |
| `422 integrity_mismatch`   | チェックサムが一致しません                                                               | 元のファイルを再送します                                             |
| `507 storage_quota`        | リポジトリのクォータを使い切りました                                                     | 古いビルドを削除するか、クォータの拡大を依頼します                   |
| `507 storage_full`         | サーバーのディスクがいっぱいです                                                         | 管理者に連絡します                                                   |
| `Retry-After` 付きの `503` | サーバーが混雑しています                                                                 | 待機します。クライアントは自動的に再試行します                       |

全一覧は[エラー](../api/errors)を参照してください。

## 関連ページ {#related-pages}

- [コマンドライン（arkvoryctl）](../protocols/cli)と [TypeScript SDK](../protocols/sdk)
- [パス指定ファイル](./files)と[パッケージ](./packages)
- API リファレンス：[アップロード](../api/reference/uploads)、[ダウンロードリンク](../api/reference/links)、[アーティファクト](../api/reference/artifacts)
