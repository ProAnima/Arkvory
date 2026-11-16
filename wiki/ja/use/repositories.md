---
title: リポジトリ
description: リポジトリの役割、利用できるリポジトリの確認方法、コンソールでの選択方法、読み取り専用リポジトリについて説明します。
---

# リポジトリ

リポジトリは、Arkvory でファイルを保存し、アクセスを制御する名前付きの領域です。公開するものはすべて 1 つのリポジトリに属し、各リクエストでリポジトリを指定します。

## リポジトリとは {#what-it-is}

リポジトリには ID があります。英小文字、数字、`-`、`_` を使い、英字または数字で始め、最大 64 文字とします。例は `releases`、`builds`、`game-prod` です。ID はすべてのアドレスに含まれます。

| 対象                                                       | アドレス                              |
| ---------------------------------------------------------- | ------------------------------------- |
| アーティファクト、パッケージ、パス指定ファイル（HTTP API） | `/api/v1/repositories/<repository>/…` |
| コンテナイメージ                                           | `/v2/<repository>/<image>/…`          |
| Git LFS                                                    | `/lfs/<repository>`                   |
| npm と Unity のパッケージ                                  | `/npm/<repository>/…`                 |

[コンテナイメージ](../protocols/containers)、[Git LFS](../protocols/git-lfs)、[Unity と npm](../protocols/unity-npm)を参照してください。

リポジトリは不変のアーティファクトを保持します。アーティファクトには、バージョン付きの UPack パッケージ（[パッケージ](./packages)）と、履歴付きのパス指定ファイル（[パス指定ファイル](./files)）という 2 つの見方があります。ステージとプロモーションで、リポジトリ間のビルドの移動を扱います（[ステージとプロモーション](./promotion)）。

現在、リポジトリには表示名や説明はなく、独自の設定はアクセス、[ストレージ設定](#settings)、別サーバーのコピーの場合の[ミラー状態](#read-only)に限られます。リポジトリの名前変更はできません。削除もできません。アクセスを取り消しても、ファイルはディスクに残ります。

## リポジトリの作成 {#create}

リポジトリを作成するコマンドはありません。アクセスを付与するとリポジトリが存在するようになります。最初のアップロードまでは空です。

管理者は次のいずれかを行います。

- 新しい名前へのアクセスをグループに付与します。コンソールで [[ui:administration]] を開き、[[ui:manageGrants]] を展開し、グループを選び、[[ui:repository]] に名前を入力し、[[ui:read]] または [[ui:write]] を選んで [[ui:saveGrant]] を選択します。最初の権限付与には、所有者が属する `arkvory-owners` グループが適しています。[グループとリポジトリへのアクセス](./accounts#groups)を参照してください。
- サービスアカウントのポリシーにリポジトリ名を指定します。[CI 用のサービスアカウントとキー](./accounts#service-accounts)を参照してください。

API では、`setGroupGrant` と `setServicePolicy` が同じ操作を行います。入力を間違えると、誤った新しい名前が作成されます。綴りを確認してください。インストール後には `releases` が存在し、`arkvory-owners` グループに書き込みアクセスが付与されています。

## 利用できるリポジトリの確認 {#list}

認証情報が何らかの権限を持つリポジトリだけが表示されます。権限のないリポジトリは表示されず、直接要求しても `404` が返されます。アクセス権がある空のリポジトリも表示されます。

コンソールで [[ui:repositories]] を開きます。各カードにはリポジトリ名と、[[ui:repositoryRights]] の下に自分が持つ操作権限が表示されます。ボタンは次のとおりです。

- [[ui:repositoryOpen]] はリポジトリのカタログを開きます。アーティファクトを一覧表示できる場合に表示されます。
- [[ui:repositoryStorage]] はストレージ設定を含むカタログを開きます。ストレージポリシーまたは診断情報を読み取れる場合に表示されます。
- [[ui:repositoryAccess]] はユーザー管理とサービス管理に移動します。管理者とサービス管理者に表示されます。

一覧には一度に 50 リポジトリが表示されます。[[ui:managementMore]] は次のページを読み込み、[[ui:managementReload]] は一覧を更新します。ミラーには [[ui:mirrorBadge]] バッジが表示されます。

`arkvoryctl` では次を実行します。

```bash
arkvoryctl repositories
arkvoryctl doctor
```

`repositories` は各リポジトリの `formats` と自分の `permissions` を表示します。応答に `next` がある場合は、`--after` として渡します。`doctor` はサーバー、機能、現在のキーの権限を表示します。

API の `listRepositories` は、`limit`（1～100、既定 50）と、前のページの最後の ID である `after` を受け取ります。`getRepository` は 1 つのカードを返します。

```bash
curl -H "Authorization: Bearer $ARKVORY_KEY" "$ARKVORY/api/v1/repositories?limit=100"
```

```typescript
const page = await client.repositories({ limit: 50 });
const card = await client.repository('releases');
```

カードの内容は `id`、`formats`（常に `upack` と `assets`）、`permissions` です。ファイルのサイズや数は含まれません。操作名は[権限](./accounts#permissions)を参照してください。

## コンソールでのリポジトリの選択 {#choose}

[[ui:connection]] カードの [[ui:repository]] フィールドには、読み取れるリポジトリの一覧があります。初期値は `releases` です。サインイン後、読み取り可能ならその値を維持し、そうでなければ読み取り可能な最初のリポジトリを選びます。他のリポジトリで作業するには、名前を入力するか一覧から選択します。以後、カタログ、パッケージ、アップロード、詳細はそのリポジトリを使います。カードの [[ui:repositoryOpen]] を選択すると、フィールドが自動入力されます。

コンソールのアーティファクトのアドレスには、リポジトリが含まれます：`#/artifact/<repository>/<id>`。読み取り権限のないリポジトリのアーティファクトへのリンクを開くと、メッセージとカタログが表示されます。

`arkvoryctl` はプロファイルのリポジトリを使います。プロファイル追加時に別のものを設定しなければ、`releases` です。1 つのコマンドだけ変更するには `--repository` を指定します。

```bash
arkvoryctl profile add production --server https://arkvory.example --token-file ~/.arkvory/key --repository builds
arkvoryctl list --repository releases
```

SDK では、`client.inRepository('builds')` が 1 つのリポジトリに結び付いたクライアントを返します。HTTP では、パスにリポジトリを含めます。

## リポジトリの設定 {#settings}

現在、リポジトリに設定できるのは次の項目です。

- **アクセス。** 誰が読み取り・書き込みできるかを設定します。[アカウントとアクセス](./accounts)を参照してください。
- **ストレージ。** GiB 単位のクォータ、警告・重大しきい値、保持（パッケージとチャネルごとに最新 N ビルドを保持、保護ラベル、最低経過時間）、自動クリーンアップ、物理クリーンアップを設定します。閲覧には `storage.read`、変更には `storage.manage` が必要です。利用者のグループレベルでは付与されず、サービスキーで付与されます。コンソールでは [[ui:repositoryStorage]] から開く [[ui:storageTitle]] にあります。`arkvoryctl` では `storage usage` と `storage policy` で読み取ります。クォータを超える新しいアップロードは `507 storage_quota` で拒否されます。[ストレージと保持](../operate/storage)を参照してください。
- **ミラー。** サーバー管理者は、リポジトリを別サーバーのリポジトリのコピーにできます。次の節を参照してください。

## 読み取り専用リポジトリ {#read-only}

**ミラー**は、別の Arkvory サーバーのリポジトリの読み取り専用コピーです。サーバーが自動的に同期を維持します。読み取り権限がある利用者は一覧表示とダウンロードができます。変更は誰にもできません。アップロード、公開、ラベルの変更、ステージの追加、パスの割り当て、削除は、利用者のグループレベルやキーの操作権限にかかわらず、すべて `409 mirror_read_only` で拒否されます。内容を変更するにはメインサーバーを使ってください。

コンソールでは、カタログの上にミラーのバッジが表示され、アップロードボタンは非表示になります。

| バッジ               | 意味                                                         |
| -------------------- | ------------------------------------------------------------ |
| [[ui:mirrorBadge]]   | コピーは最新です                                             |
| [[ui:mirrorBehind]]  | サーバーはまだ同期を進めています                             |
| [[ui:mirrorFailing]] | 前回の同期に失敗しました。ダウンロードは引き続き利用できます |

バッジの横の [[ui:mirrorHelpLabel]] を選択すると、ソース、前回の同期時刻、エラーコードを確認できます。

別の種類として**インポート**があります。これは、別サーバーのリポジトリで特定のステージを持つバージョンを自動的に取り込む、通常のリポジトリです（例：`dev` から `prod`）。バッジは [[ui:mirrorImport]] です。アップロードも引き続き可能で、取り込み後にソースで変更・削除されても、コピーした内容には影響しません。

API では、`getRepositoryMirror` が状態を返します。内容は `mode`（`mirror` または `import`）、`phase`（`pending`、`seeding`、`following`）、`caughtUp`、`syncedAt`、`errorCode` です。通常のリポジトリには `404` を返します。

ミラーはサーバー管理者が設定します。[ミラー](../operate/mirrors)を参照してください。**読み取りゲートウェイ**は別のものです。同じリポジトリのダウンロードだけを提供するアドレスです。そこを経由する変更は `405 read_only` で拒否されます。[読み取りゲートウェイ](../operate/read-gateways)を参照してください。

## 関連ページ {#related-pages}

- [アカウントとアクセス](./accounts)
- [パス指定ファイル](./files)と[パッケージ](./packages)
- [ストレージと保持](../operate/storage)
- API リファレンス：[リポジトリ](../api/reference/repositories)、[ミラー](../api/reference/mirrors)
