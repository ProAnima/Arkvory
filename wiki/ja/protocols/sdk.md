---
title: TypeScript SDK
---

# TypeScript SDK

TypeScript SDKは、コンソールと`arkvoryctl`が使うクライアントライブラリです。REST API `/api/v1`をラップしています。すべての応答を実行時に検証し、パートに分けてアップロードし、中断した転送を再開し、ダウンロードをSHA-256で検証します。標準のWeb API（`fetch`、ストリーム、Web Crypto）だけを使うため、Node.jsでもブラウザーでも動作します。

## SDKを入手する {#get-the-sdk}

SDKは、`ProAnima/Arkvory`ソースリポジトリの`packages/sdk`フォルダーにある、ワークスペースパッケージ`@proanima/arkvory-sdk`です。npmレジストリには**公開されていません**。ワークスペースパッケージ`@proanima/arkvory-contracts`に依存しています。

- 使うには、ソースリポジトリをビルドし（`npm ci`、続けて`npm run build`）、リポジトリ自身のスクリプトと同じように、そのワークスペース内でツールを書きます。
- 他の言語から使う場合や、ワークスペースを使えないプロジェクトからは、`Authorization: Bearer <key>`を付けて[REST API](../api/index)を直接呼び出します。

ソースコードは、Arkvoryのライセンスで提供されています。組織内での使用と変更は可能です。コピーの再配布はできません。

## クライアントを作成する {#create-a-client}

```typescript
import { ArkvoryClient } from '@proanima/arkvory-sdk';

const client = new ArkvoryClient('https://arkvory.example/', () => process.env.ARKVORY_KEY ?? '', {
  requestTimeoutMs: 60_000,
  attemptTimeoutMs: 120_000,
  maxRetries: 20,
});
const releases = client.inRepository('releases');
```

- **ベースURL**：HTTPSが必須です。平文のHTTPが許可されるのは、`localhost`、`127.0.0.1`、`[::1]`だけです。URLに、ユーザー、パスワード、クエリ、フラグメントを含めることはできません。パスのプレフィックスは含められます。リダイレクトはエラーとして扱われます。
- **トークンのコールバック**：SDKはリクエストのたびにこれを呼び出し、結果をキャッシュしません。新しいクライアントを作らなくても、キーをローテーションできます。
- `inRepository(id)`は、1つのリポジトリに紐づいたクライアントを返します。利便性のための機能で、セキュリティ上の境界ではありません。

| オプション         | 既定値 | 意味                                                                                                                        |
| ------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| `signal`           | なし   | このクライアントのすべてのリクエストをキャンセルします                                                                      |
| `requestTimeoutMs` | なし   | 独自のsignalを持たないリクエストの期限（1〜3600000）                                                                        |
| `maxAttempts`      | 5      | 1つの転送リクエストの試行回数（最初の試行を含む、1〜10）                                                                    |
| `maxRetries`       | 20     | 1つのアップロードまたはダウンロード操作で共有する再試行回数（0〜100）                                                       |
| `attemptTimeoutMs` | 120000 | 転送1回の試行の上限（1〜1800000）                                                                                           |
| `baseDelayMs`      | 500    | 最初のバックオフの待ち時間（1〜60000）                                                                                      |
| `maxDelayMs`       | 60000  | 最長の待ち時間（`Retry-After`を含む）                                                                                       |
| `onRequest`        | なし   | HTTPリクエストごとに1回呼び出され、メソッド、パス、ステータス、所要時間、リクエストIDが渡されます。認証情報は渡されません。 |

自動再試行が適用されるのは、転送だけです。`create`、`resume`内のステップ、`downloadVerified`が対象です。ネットワーク障害とHTTP 408、429、502、503、504を、指数バックオフで再試行します。`Retry-After`より前に再試行することはありません。それ以外の呼び出しは、1回だけ実行されます。リビジョンで保護された変更が、自動的に繰り返されることはありません。

## よく使う操作 {#common-tasks}

### 検出と一覧表示 {#discover-and-list}

```typescript
const permissions = await client.permissions();
const repositories = await client.repositories({ limit: 50 });
const page = await releases.artifacts.list();
const found = await releases.artifacts.search({ q: 'build-42', label: 'staging' });
for (const item of found.items) console.log(item.id, item.name, item.size);
const artifact = await releases.artifacts.get('00000000-0000-4000-8000-000000000001');
```

ページは`next`を返します。次のページを読むには、それを`after`として渡します。

### 大きなファイルを再開付きでアップロードする（Node.js） {#upload-a-large-file-with-resume-node-js}

```typescript
import { openAsBlob } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const file = await openAsBlob('./build/Game.zip'); // メモリには読み込まれない
const hash = createHash('sha256');
for await (const chunk of file.stream()) hash.update(chunk);

const key = randomUUID(); // 最初のリクエストの前に、ジョブの状態と一緒に保存する
const session = await releases.uploads.create(key, {
  name: 'Game.zip',
  size: String(file.size),
  sha256: hash.digest('hex'),
  labels: ['test'],
  metadata: { commit: 'abc123' },
});
const uploaded = await releases.uploads.resume(session.id, file, {
  onProgress: (bytes) => console.log(`${bytes} of ${file.size} bytes`),
});
await releases.assets.assign('builds/game/1.4/Game.zip', uploaded.id, 0); // 0：パスは新規
```

- 同じ冪等キーと同じ記述子を使うと同じセッションが返るため、応答が失われても、2つ目のアップロードは作られません。
- `resume`は、サーバーがすでに持っているパートを読み取り、そのハッシュをファイルと照合して、足りないパートだけを送信します。クラッシュの後は、保存しておいたセッションIDで`resume`をもう一度呼び出します。
- パートのサイズはサーバーが決めます。8 MiBで、10,000パートを超えるファイルでのみ、それより大きくなります。SDKがメモリに保持するパートは、一度に1つだけです。
- 16 GiB以上のファイルは、サーバーのワーカーが完了処理を行います。`resume`はその完了を待ちます。
- `assets.assign(path, artifactId, expectedRevision)`は、パスが別のリビジョンになっている場合、競合で失敗します。先に`assets.get(path)`でパスを読み取ってください。

### 検証付きでダウンロードする {#download-with-verification}

```typescript
import { createWriteStream } from 'node:fs';
import { rename } from 'node:fs/promises';
import { Writable } from 'node:stream';

const stream = await releases.artifacts.downloadVerified(uploaded.id);
await stream.pipeTo(Writable.toWeb(createWriteStream('./Game.zip.part')));
await rename('./Game.zip.part', './Game.zip'); // pipeToが成功した後にのみ実行する
```

SDKは、コンテンツを8 MiBのRangeで読み取り、各Rangeのサイズ、`Content-Range`、`ETag`を確認します。最後のブロックを渡す前に、ファイル全体のSHA-256を確認します。確認に失敗すると、ストリームは`ArkvoryIntegrityError`で失敗します。ストリームから直接デプロイしないでください。一時ファイルに書き込み、ストリームが正常に終了した後でのみ、そのファイルを使用します。

再起動の後に続行するには、すでに保存したバイト列を`prefix`として渡します。ストリームには、残りの部分だけが含まれます。

```typescript
const prefix = await openAsBlob('./Game.zip.part');
const rest = await releases.artifacts.downloadVerified(uploaded.id, { prefix });
await rest.pipeTo(Writable.toWeb(createWriteStream('./Game.zip.part', { flags: 'a' })));
```

検証なしで1つのバイト範囲を取得するには、`releases.artifacts.download(id, { start: 0, end: 1023 })`を使います。生の`Response`（ステータス206）が返されます。

### パス指定のRawファイル {#raw-files-by-path}

```typescript
const body = new Blob([JSON.stringify({ level: 3 })]);
const result = await client.raw.putRawFile('releases', 'config/settings.json', body, {
  createOnly: true, // 任意：パスがすでに存在する場合は拒否する
});
console.log(result.revision, result.created); // バイト列がすでにあった場合、createdはfalse
const response = await client.raw.downloadRawFile('releases', 'config/settings.json');
```

オプション`sha256`（16進数64桁）を指定すると、サーバーはバイト列を1回のパスで書き込み、不一致を拒否します。`releases.assets.put(path, blob, options)`と`releases.assets.download(path, range)`は、同じ呼び出しです。アップロードは毎回1つのリクエストなので、小〜中サイズのファイルに使ってください。[Rawファイル](./raw-files)を参照してください。

### パッケージ、プロモーション、リンク {#packages-promotion-and-links}

```typescript
await releases.packages.register(uploaded.id); // UPackアーカイブ
const selected = await releases.packages.resolve({ name: 'app', range: '^1.4', stage: 'release' });
await releases.promotions.promote(selected.artifactId, {
  target: 'prod',
  mode: 'copy',
  stages: ['release'],
});
const link = await releases.artifacts.link(selected.artifactId, { ttlSeconds: 900 });
```

リンクのURLはシークレットで、`expiresAt`まで1つのアーティファクトを読み取れます。途中で取り消すことはできません。

### バックアップ {#backups}

```typescript
const status = await client.backup.status();
const job = await client.backup.run(); // バックアップエージェント用にキューに追加される
const points = await client.backup.points({ limit: 20 });
```

バックアップの呼び出しには、アカウント管理者のセッションまたは所有者のファイルキーが必要です。サービスキーと個人用トークンでは、403になります。

## エラー {#errors}

```typescript
import {
  ArkvoryClientError,
  ArkvoryHttpError,
  ArkvoryIntegrityError,
  ArkvoryNetworkError,
} from '@proanima/arkvory-sdk';

try {
  await releases.artifacts.get(id);
} catch (error) {
  if (error instanceof ArkvoryHttpError) {
    console.error(error.status, error.code, error.reason, error.requestId, error.retryAfterSeconds);
  } else if (error instanceof ArkvoryClientError) {
    console.error(error.code);
  }
}
```

| クラス                  | 意味                                                                                                                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ArkvoryHttpError`      | サーバーがエラーで応答しました。フィールド：`status`、`code`、`reason`、`details`、`requestId`、`retryAfterMs`、`retryAfterSeconds`、`serverMessage`。プロキシがArkvoryの形式ではなく応答した場合、`code`は`http_error`になります。 |
| `ArkvoryNetworkError`   | すべての再試行の後で、接続に失敗したか、タイムアウトしました                                                                                                                                                                        |
| `ArkvoryIntegrityError` | ダウンロードしたバイト列が、アーティファクトと一致しません                                                                                                                                                                          |
| `ArkvoryClientError`    | `code`付きのローカルな失敗：`invalid_argument`、`insecure_url`、`invalid_response`、`response_too_large`、`size_mismatch`、`file_changed`、`upload_cancelled`、`completion_failed`                                                  |

メッセージのテキストではなく、`code`と`reason`で判断してください。未知のコードは、HTTPステータスで処理します。`Error.message`にサーバーのテキストが含まれることはありません。[エラー](../api/errors)を参照してください。

## ブラウザーとNode.js {#browser-and-node-js}

- **別のオリジンのブラウザー**：管理者が、サーバーの`ARKVORY_CORS_ORIGINS`に、ページの正確なオリジンを登録する必要があります。SDKはキーを`Authorization`ヘッダーで送信し、Cookieは送信しません。
- **ブラウザーでのキー**：キーはメモリ内だけに保持してください。URL、`localStorage`、ログ、ページのソースには入れないでください。ユーザーは`client.login(name, password)`でサインインして、セッショントークンを取得できます。
- **Node.jsでのファイル**：`node:fs`の`openAsBlob`を使うと、ファイルをメモリに読み込まずに渡せます。
- **ダウンロードキュー**：`DownloadQueue`と`checkpointedDownload`は、一時停止、再開、キャンセルを備えた、上限付きのキューを提供します。ストレージのアダプターは利用者が用意します。

## 制限 {#limits}

- JSONの応答は2 MiBに制限されます（パッケージのページは8 MiB、アーティファクトの一覧は24 MiB）。これより大きい応答は、`response_too_large`で失敗します。
- サイズは10進数の文字列なので、2^53を超える値も精度が失われません。

## 関連ページ {#related-pages}

- [コマンドライン（arkvoryctl）](./cli)
- [転送](../use/transfers)
- [API概要](../api/index)と[認証](../api/authentication)
- [Rawファイル](./raw-files)
