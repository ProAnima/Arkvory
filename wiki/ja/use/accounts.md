---
title: アカウントとアクセス
description: ユーザーとグループを作成してリポジトリへのアクセスを付与し、個人用トークンと CI 用サービスキーを発行します。
---

# アカウントとアクセス

Arkvory には 4 種類の認証情報があります。利用者はパスワードでサインインします。自分のツールには個人用アクセストークンを使います。CI システムとデプロイエージェントにはサービスキーを使います。インストーラーは、セットアップと緊急時のために回復キーも作成します。サーバーは、各リクエストに付属する認証情報に基づいてアクセスを確認します。

## 誰が何をできるか {#overview}

| 認証情報               | 作成方法・作成者                     | 有効期間                | 管理操作                                                   | リポジトリへのアクセス                                 |
| ---------------------- | ------------------------------------ | ----------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| パスワードセッション   | サインイン                           | 12 時間                 | 管理者アカウントの場合、ユーザーとグループの管理           | グループを通じてリポジトリごとに読み取りまたは書き込み |
| 個人用アクセストークン | パスワードセッションから自分で作成   | 既定 90 日、最大 365 日 | 不可                                                       | 自分のグループの権限。読み取り専用に制限可能           |
| サービスキー           | 回復キーまたは委任を受けた運用担当者 | 既定 90 日、最大 365 日 | 所有者が委任した操作のみ                                   | サービスアカウントのポリシーをキーでさらに制限         |
| 回復キー               | インストーラー                       | 交換するまで            | ユーザー、グループ、サービスアカウント、バックアップの管理 | `releases` の読み取りと書き込み                        |

次の 3 点に注意してください。

- 管理者アカウントはユーザーとグループを管理します。それだけではファイルにアクセスできません。ファイルへのアクセスはグループへの権限付与を通じてのみ得られます。
- サービスキーは、回復キーまたは運用担当者のキーから作成します。パスワードセッションからは作成できません。パスワードでサインインした管理者はサービスアカウントを作成できません。
- 個人用トークンやサービスキーは、ユーザー、グループ、他のトークンを作成できません。

## 所有者と回復キー {#owner}

最初のアカウントが所有者です。所有者は管理者です。Windows ではセットアップウィザードが作成します。Linux と Docker では、[Web コンソール](../guide/console#the-first-owner)の説明に従い、回復キーを使ってコンソールで作成します。

所有者は、リポジトリ `releases` への書き込みアクセスを持つ `arkvory-owners` グループに属します。他のリポジトリについては、自分でグループにアクセスを付与してください。[グループとリポジトリへのアクセス](#groups)を参照してください。

回復キーは、インストールディレクトリ内のファイル `config/bootstrap-token.txt` です。サーバーの管理者だけが読み取れます。CI やクライアント端末にコピーしないでください。インストール・更新ツールが読み取るため、削除しないでください。[セキュリティ](../operate/security)を参照してください。

## ユーザーの作成 {#users}

ユーザーを作成できるのは管理者だけです。名前は英字、数字、`.`、`_`、`-` の 3～64 文字です。パスワードは 12～128 文字です。1 つのインストールに最大 1,000 アカウントを登録できます。

コンソールでは、次の手順で作成します。

1. 管理者としてサインインし、[[ui:administration]] を開きます。
2. [[ui:createUser]] を展開します。
3. [[ui:accountName]] と [[ui:password]] を入力します。ユーザーを管理する人に限り、[[ui:administrator]] にチェックを付けます。
4. [[ui:createUser]] を選択します。

[[ui:accountsHeading]] の表にアカウントが表示されます。[[ui:disableUser]] はアカウントを無効にします。セッションは直ちに終了し、[[ui:enableUser]] を選択するまで個人用トークンも使えなくなります。他の利用者に新しいパスワードを設定するには、[[ui:resetPassword]] を展開します。この操作はそのアカウントのセッションを終了し、すべての個人用トークンを取り消します。

API では、管理者セッションまたは回復キーで `createUser`、`updateUser`、`listUsers` を呼び出します。

```bash
curl -X POST "$ARKVORY/api/v1/users" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"anna","password":"a long password here","administrator":false}'
```

```typescript
await client.administration.users.create('anna', 'a long password here', false);
```

`arkvoryctl` にアカウント用コマンドはありません。コンソールまたは API を使ってください。

自己登録は既定で無効です。サーバー管理者が `ARKVORY_ALLOW_REGISTRATION=true` で有効にします（[環境変数](../reference/environment)を参照）。有効にすると、サインインカードに [[ui:signUp]] が表示されます。新しいアカウントは、管理者がグループに追加するまで、どのリポジトリにもアクセスできません。自己登録は 900 アカウントで停止し、管理者用に 100 アカウント分の空きを確保します。

## グループとリポジトリへのアクセス {#groups}

利用者はグループを通じてアクセスを得ます。グループにはメンバーが属し、リポジトリごとに次のいずれかのアクセスレベルを設定します。

| コンソールのレベル | 意味                                                                               |
| ------------------ | ---------------------------------------------------------------------------------- |
| [[ui:read]]        | 閲覧とダウンロード                                                                 |
| [[ui:write]]       | 読み取りのすべてに加え、アップロード、公開、メタデータの変更、プロモーション、復元 |

リポジトリには専用の作成手順がありません。権限付与またはサービスポリシーで名前を指定すると存在するようになります。名前には英小文字、数字、`-`、`_` を使い、英字または数字で始め、最大 64 文字とします。[リポジトリ](./repositories)を参照してください。

コンソールで [[ui:administration]] を開きます。

1. [[ui:createGroup]] を展開し、[[ui:accessGroup]] の名前（英字、数字、`.`、`_`、`-` の 2～64 文字）を入力して、[[ui:createGroup]] を選択します。
2. [[ui:manageMembers]] を展開し、グループとアカウントを選んで [[ui:addMember]] を選択します。[[ui:removeMember]] はアカウントをグループから外します。
3. [[ui:manageGrants]] を展開し、グループを選び、[[ui:repository]] の名前を入力し、[[ui:access]] のレベルを選んで [[ui:saveGrant]] を選択します。[[ui:removeGrant]] はアクセスを取り消します。

フォームの下の表には、各グループの [[ui:members]] と [[ui:grants]] が表示されます。メンバーまたは権限付与の削除は、そのアカウントの次のリクエストから反映されます。ファイルはそのまま残ります。

1 つのインストールには、合計で最大 100 グループ、10,000 件のメンバー所属、10,000 件の権限付与を登録できます。

API の操作は `createAccessGroup`、`addGroupMember`、`removeGroupMember`、`setGroupGrant`、`removeGroupGrant` です。

```bash
curl -X PUT "$ARKVORY/api/v1/access-groups/$GROUP_ID/grants/builds" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"access":"write"}'
```

```typescript
await client.administration.groups.setGrant(groupId, 'builds', 'write');
```

## 権限 {#permissions}

読み取りと書き込みの 2 つのレベルの背後には、24 種類のリポジトリ操作があります。サービスキーでは、これらの操作を個別に指定します。`arkvoryctl doctor` と `GET /api/v1/auth/permissions` は、現在の認証情報が持つ操作権限をリポジトリごとに表示します。

| 操作               | コンソールの表示                   | 許可する内容                                                                     |
| ------------------ | ---------------------------------- | -------------------------------------------------------------------------------- |
| `repository.read`  | [[ui:permission.repository.read]]  | リポジトリの一覧と自分の権限の確認。ファイルへのアクセスは含まれません。         |
| `artifact.list`    | [[ui:permission.artifact.list]]    | アーティファクトの一覧・検索、ステージ一覧とプロモーションジャーナルの読み取り   |
| `artifact.read`    | [[ui:permission.artifact.read]]    | 1 つのアーティファクトの詳細、ステージ、プロモーション履歴の読み取り             |
| `content.read`     | [[ui:permission.content.read]]     | バイト列のダウンロード、ダウンロードリンクの作成、ダウンロード用パッケージの解決 |
| `upload.create`    | [[ui:permission.upload.create]]    | アップロードの開始                                                               |
| `upload.read`      | [[ui:permission.upload.read]]      | 自分のアップロードの状態とパートの読み取り                                       |
| `upload.write`     | [[ui:permission.upload.write]]     | 自分のアップロードのバイト列の送信                                               |
| `upload.complete`  | [[ui:permission.upload.complete]]  | 自分のアップロードの完了、完了ジョブの開始                                       |
| `upload.cancel`    | [[ui:permission.upload.cancel]]    | 自分のアップロードのキャンセル                                                   |
| `job.read`         | [[ui:permission.job.read]]         | 自分の完了ジョブの読み取り                                                       |
| `package.read`     | [[ui:permission.package.read]]     | UPack パッケージの一覧とバージョンの解決                                         |
| `package.publish`  | [[ui:permission.package.publish]]  | アップロード済みアーカイブのパッケージ登録                                       |
| `asset.read`       | [[ui:permission.asset.read]]       | ファイルパス、その履歴とリビジョンの読み取り                                     |
| `asset.write`      | [[ui:permission.asset.write]]      | アーティファクトをパスの現在の内容に設定                                         |
| `asset.restore`    | [[ui:permission.asset.restore]]    | パスの以前のリビジョンの復元                                                     |
| `annotation.read`  | [[ui:permission.annotation.read]]  | ラベル、メタデータ、コレクション、添付ファイルの読み取り                         |
| `annotation.write` | [[ui:permission.annotation.write]] | ラベル、メタデータ、コレクション、添付ファイルの変更                             |
| `artifact.promote` | [[ui:permission.artifact.promote]] | ステージの追加・削除、リポジトリへのプロモーション                               |
| `reference.write`  | [[ui:permission.reference.write]]  | アーティファクトに対する自分の外部参照の追加・削除                               |
| `audit.read`       | [[ui:permission.audit.read]]       | リポジトリのカタログ監査の読み取り                                               |
| `artifact.delete`  | [[ui:permission.artifact.delete]]  | アーティファクトの確認・削除、保持処理のプレビューと適用                         |
| `storage.read`     | [[ui:permission.storage.read]]     | ストレージポリシー、使用量、クリーンアップ設定の読み取り                         |
| `storage.manage`   | [[ui:permission.storage.manage]]   | ストレージポリシーとクリーンアップ設定の変更・実行                               |
| `diagnostics.read` | [[ui:permission.diagnostics.read]] | ストレージイベントの読み取り                                                     |

グループのレベルと操作の対応は次のとおりです。

- **読み取り**は `repository.read`、`artifact.list`、`artifact.read`、`content.read`、`package.read`、`asset.read`、`annotation.read` を付与します。
- **書き込み**は読み取りのすべてに加え、`upload.create`、`upload.read`、`upload.write`、`upload.complete`、`upload.cancel`、`job.read`、`package.publish`、`asset.write`、`asset.restore`、`annotation.write`、`artifact.promote`、`reference.write`、`audit.read` を付与します。
- **どのグループレベルも** `artifact.delete`、`storage.read`、`storage.manage`、`diagnostics.read` は付与しません。アーティファクトの削除とストレージ管理には、これらの操作を明示したサービスキーが必要です。[ストレージと保持](../operate/storage)を参照してください。

ミラーは、別のリポジトリの読み取り専用コピーです（[ミラー](../operate/mirrors)）。権限付与の内容にかかわらず、変更する操作はすべて `409 mirror_read_only` で拒否されます。

## パスワードとセッション {#passwords}

[[ui:connection]] カードの [[ui:accountName]] と [[ui:password]] でサインインします。セッションの有効期間は 12 時間です。[[ui:disconnect]] で終了します。

自分のパスワードを変更するには、同じカードの [[ui:changeOwnPassword]] を使います。[[ui:currentPassword]] と [[ui:newPassword]] を入力します。すべてのセッションと個人用トークンが無効になるため、サインインし直して新しいトークンを作成してください。管理者は、古いパスワードを知らなくても、他のアカウントのパスワードをリセットできます。

サーバーはパスワードの推測を遅らせます。

- 1 つのネットワークアドレスからは、短時間に 10 回、その後は 15 秒ごとに 1 回サインインを試行できます。
- 同じアカウントでパスワードの誤入力が続くと、待ち時間が段階的に増え、最大 2 分になります。この待機中は正しいパスワードも拒否されます。応答は `429 rate_limited` で、`Retry-After` が付きます。
- リバースプロキシの背後では、管理者が `ARKVORY_TRUSTED_PROXIES` にプロキシを登録します。登録しないと、すべての利用者が 1 つのアドレスを共有します。

API では、`login` が名前とパスワードを Bearer セッションに交換し、`changeOwnPassword` がパスワードを変更します。

```bash
curl -X POST "$ARKVORY/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"name":"anna","password":"a long password here"}'
```

## 個人用アクセストークン {#tokens}

個人用アクセストークンは、自分の端末のスクリプト、`arkvoryctl`、SDK など、自分のツール用のキーです。自分として動作し、自分が属するグループのリポジトリにアクセスします。

トークンを作成できるのはパスワードセッションだけです。トークンは別のトークンを作成できず、管理者権限も持ちません。

1. パスワードでサインインします。
2. [[ui:connection]] カードで [[ui:personalAccessTokens]] を展開します。
3. [[ui:tokenName]] を入力します。[[ui:tokenExpiry]] を [[ui:tokenDays30]]、[[ui:tokenDays90]]、[[ui:tokenDays365]] から選びます。
4. [[ui:tokenScope]] を [[ui:tokenScopeRead]] または [[ui:tokenScopeReadWrite]] から選びます。読み取り用トークンは、すべての変更を `403 read_only_token` で拒否します。
5. [[ui:generateToken]]、続いて [[ui:copyToken]] を選択します。トークンは 1 度だけ表示され、`pat_` で始まります。

表には各トークンの [[ui:tokenPrefix]]、[[ui:tokenCreated]]、[[ui:tokenExpires]]、[[ui:tokenLastUsed]]、[[ui:tokenStatus]] が表示されます。状態は [[ui:tokenActive]]、[[ui:tokenExpired]]、[[ui:tokenRevokedState]] です。トークンを停止するには [[ui:revokeToken]] を選択し、[[ui:tokenRevokeConfirmSubmit]] で確認します。そのトークンを使うクライアントは直ちにアクセスできなくなります。

1 アカウントで有効なトークンを 50 個保持できます。管理者は、`listAccountTokens` と `revokeAccountToken` で任意のアカウントのトークンを一覧表示し、取り消すことができます。

API では、トークンに名前を指定し、必要に応じて有効期限（現在から最大 365 日）とスコープを指定します。

```bash
curl -X POST "$ARKVORY/api/v1/auth/tokens" \
  -H "Authorization: Bearer $SESSION" \
  -H "Content-Type: application/json" \
  -d '{"name":"laptop","scope":"read-write","expiresAt":"2027-01-31T00:00:00Z"}'
```

```typescript
const created = await client.identity.createToken('laptop', { scope: 'read-write' });
console.log(created.token); // 1 度だけ表示されます
```

API の既定スコープは `read-write` です。コンソールでは [[ui:tokenScopeRead]] があらかじめ選択されています。

非公開ファイルでトークンを `arkvoryctl` に渡してください。[コマンドライン](../protocols/cli#connect-to-a-server)を参照してください。

## CI 用のサービスアカウントとキー {#service-accounts}

サービスアカウントは、利用者ではなくツールの識別情報です。使用できるリポジトリと操作を定める**ポリシー**を持ちます。サービスアカウントにはキーがあります。キーにも独自のリポジトリと操作の一覧があります。有効な権限は、操作ごとに両方の一覧が重なる範囲です。空のポリシーではファイルにアクセスできません。

サービスアクセスは、回復キー、または所有者が権限を委任した運用担当者のキーで管理します。コンソールでは、次の手順で開きます。

1. サインイン中なら [[ui:disconnect]] を選択します。次に [[ui:keySignIn]] を開き、[[ui:serviceKey]] に回復キーを貼り付け、[[ui:connect]] を選択します。
2. [[ui:services]] を開きます。このセクションは回復キーと運用担当者のキーでのみ表示されます。

### アカウントとポリシーの作成 {#service-policy}

1. [[ui:services]] で [[ui:serviceCreate]] を展開します。
2. [[ui:serviceName]] を入力します（英字、数字、`.`、`_`、`-` の 3～64 文字）。
3. [[ui:servicePolicy]] で [[ui:bindingAdd]] を選択し、[[ui:repository]] の名前を入力します。
4. 権限を設定します。[[ui:bindingRead]] と [[ui:bindingPublish]] は標準的な権限セットを設定し、[[ui:bindingNone]] は選択を解除します。[[ui:bindingPermissions]] にすべての操作が表示されます。リポジトリを外すには [[ui:bindingRemove]] を選択します。
5. [[ui:serviceCreate]] を選択します。

2 つのプリセットは次のとおりです。

| プリセット            | 操作                                                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [[ui:bindingRead]]    | `repository.read`、`artifact.read`、`artifact.list`、`content.read`、`package.read`、`asset.read`、`annotation.read`                                                       |
| [[ui:bindingPublish]] | 読み取りセットに加え、`upload.create`、`upload.read`、`upload.write`、`upload.complete`、`upload.cancel`、`job.read`、`package.publish`、`asset.write`、`annotation.write` |

どちらのプリセットにも、プロモーション、復元、削除は含まれません。プロモーションジョブには `artifact.promote` を追加してください。ダウンロードだけを行うデプロイエージェントが `arkvoryctl` を使う場合は読み取りセットが必要です。パッケージ名を指定する通常の HTTP ダウンロードには、`content.read` だけで十分です。

ポリシーには最大 64 リポジトリ、1 つのインストールには最大 1,000 サービスアカウントを登録できます。保存したポリシーにはバージョンがあります。編集中に別の人が変更すると、コンソールは競合を表示し、下書きを保持します。[[ui:serviceRefresh]] を選択し、変更を再度適用してください。[[ui:serviceDisable]] はそのアカウントのすべてのキーを無効にします。すでに実行中の転送は完了することがあります。

### キーの発行、保存、有効化 {#service-key-issue}

1. アカウントを開き、[[ui:serviceKeys]] を開きます。
2. [[ui:keyIssue]] を展開します。[[ui:keyName]] を入力します。[[ui:keyExpiry]] に有効期限を設定します。空欄の場合は 90 日です。最長の有効期間は 365 日です。
3. キーにアカウントより少ない権限を与える場合は、権限を制限します。[[ui:keyIssue]] を選択します。
4. [[ui:keySecret]] ウィンドウに秘密情報が 1 度だけ表示されます。[[ui:keyCopy]] を選択し、CI のシークレットストアに保存します。秘密情報は `arkvory_` で始まります。
5. [[ui:keySaved]] にチェックを付け、[[ui:keyActivate]] を選択します。

有効化していないキーは使用できず、15 分後に失効します。有効化するまでは [[ui:keyPending]] と表示されます。1 アカウントで同時に保持できるのは、有効なキー 3 個と有効化待ちのキー 2 個です。状態は [[ui:keyPending]]、[[ui:keyActive]]、[[ui:keyRevoked]]、[[ui:keyExpired]] です。[[ui:keyDetails]] にキーの ID と権限が表示されます。

秘密情報をコピーする前に応答が失われた場合、サーバーは再表示できません。そのキーを取り消し、別のキーを発行してください。

API では、回復キーでアカウントを作成し、その後キーを発行します。`Idempotency-Key` ヘッダー（英字、数字、`.`、`_`、`:`、`-` の 1～128 文字）を使うと安全に再送できますが、再送への応答には秘密情報が含まれません。キー自身で `activateServiceKey` を呼び出して有効化します。

```bash
curl -X POST "$ARKVORY/api/v1/service-accounts" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" \
  -d '{"name":"ci-prod","bindings":[{"resource":{"kind":"repository","id":"releases"},"actions":["repository.read","artifact.read","artifact.list","content.read","package.read","upload.create","upload.read","upload.write","upload.complete","job.read","package.publish","asset.read","asset.write"]}]}'

curl -X POST "$ARKVORY/api/v1/service-accounts/$ACCOUNT_ID/keys" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: ci-prod-2026-10" \
  -d '{"name":"pipeline-2026","bindings":[{"resource":{"kind":"repository","id":"releases"},"actions":["content.read","package.read","artifact.read"]}]}'

curl -X POST "$ARKVORY/api/v1/auth/activate-key" -H "Authorization: Bearer $NEW_SECRET"
```

SDK でも同じ手順です。

```typescript
const account = await root.administration.services.create('ci-prod', bindings);
const issued = await root.administration.credentials.issue(account.id, requestId, {
  name: 'pipeline-2026',
  bindings,
});
if (!issued.secret) throw new Error('Lost response: revoke the key and issue another');
await saveToSecretStore(issued.secret);
await new ArkvoryClient(url, () => issued.secret ?? '').identity.activateKey();
```

有効化したキーは `ARKVORY_TOKEN_FILE` または `ARKVORY_TOKEN` としてジョブに渡します。[CI の例](../protocols/cli#ci-example)を参照してください。

### ローテーションと取り消し {#service-key-rotate}

期限が切れる前に、空白期間を作らずにキーをローテーションします。

1. キーの横で [[ui:keyRotate]] を選択します。フォームには古いキーの権限が入ります。権限は維持または縮小することだけができます。
2. 新しいキーを発行し、秘密情報を保存して有効化します。
3. ジョブを新しい秘密情報に切り替えます。
4. 古いキーの [[ui:keyRevoke]] を選択します。

新しいキーを有効化すると、古いキーの残りの有効期間は最大 24 時間に制限され、忘れられたキーが残り続けることを防ぎます。取り消しは恒久的な操作で、キー名の入力を求められます。そのキーによる新しいリクエストは直ちに拒否されます。すでに実行中の転送は完了することがあります。API の操作は `rotateServiceKey` と `revokeServiceKey` です。

アカウントの [[ui:serviceAudit]] には、誰がいつキーを発行、有効化、ローテーション、取り消ししたかが表示されます。秘密情報は記録しません。サーバーは全アカウントを合わせて最新 100,000 件のイベントを保持します。

### 管理の委任 {#delegation}

日常業務には回復キーを使わないでください。所有者は、サービス管理の一部を**運用担当者のキー**に委任し、回復キーをオフラインで保管できます。

1. 回復キーを使い、運用担当者用にポリシーが空のサービスアカウントを作成し、そのキーを発行して有効化します。
2. そのアカウントの [[ui:serviceKeys]] を開き、キーの [[ui:delegations]] を選択します。
3. [[ui:delegationNew]] を展開します。運用担当者が管理するアカウントを [[ui:delegationTarget]] に入力します。
4. [[ui:delegationActions]] にチェックを付け、リポジトリで付与できる権限の上限を [[ui:delegationCeiling]] に設定します。
5. [[ui:delegationSave]] を選択します。

7 種類の操作があります。

| 操作                     | コンソールの表示                         | 運用担当者ができること               |
| ------------------------ | ---------------------------------------- | ------------------------------------ |
| `service-account.read`   | [[ui:permission.service-account.read]]   | アカウントの閲覧                     |
| `service-account.manage` | [[ui:permission.service-account.manage]] | アカウントの有効化・無効化           |
| `policy.read`            | [[ui:permission.policy.read]]            | ポリシーの読み取り                   |
| `policy.manage`          | [[ui:permission.policy.manage]]          | ポリシーの置き換え                   |
| `credential.read`        | [[ui:permission.credential.read]]        | キーの一覧表示                       |
| `credential.manage`      | [[ui:permission.credential.manage]]      | キーの発行、ローテーション、取り消し |
| `service-audit.read`     | [[ui:permission.service-audit.read]]     | 操作ログの読み取り                   |

規則は次のとおりです。

- 運用担当者が設定する内容は、すべて上限の範囲内でなければなりません。発行するキーの有効期限は、自分自身のキーの有効期限を超えることができません。
- 運用担当者は対象アカウントのキーを発行できるため、委任は上限が許す範囲すべてを信頼することを意味します。
- 運用担当者は自分自身のアカウントを管理できず、さらに委任することもできません。アカウントは管理対象と運用担当者を兼ねることはできません。
- [[ui:delegationRemove]] で委任を削除しても、その運用担当者がすでに有効化したキーは取り消されません。自分で取り消してください。
- 運用担当者は [[ui:delegationOwn]] で自分への割り当てを確認できます。

委任を設定できるのは回復キーだけです。操作は `listServiceDelegations`、`setServiceDelegation`、`removeServiceDelegation` です。

## 監査 {#audit}

管理者は、インストールのセキュリティジャーナルを読み取れます。記録されるのは、サインインとその失敗、登録、パスワードの変更・リセット、ユーザー・グループ・権限付与の変更、トークンの作成・取り消しです。各項目には時刻、操作者、認証情報の種類、クライアントアドレス、対象、結果（`success`、`failure`、`denied`）が含まれます。パスワードや秘密情報は含まれません。サーバーは 365 日間または 1,000,000 件のうち、先に達する上限まで保持します。

コンソールにこのジャーナル用の画面はありません。管理者セッションまたは回復キーを使い、API で読み取ります。1 ページは既定で 50 件、最大 100 件で、新しい順です。次のページでは `next` を `after` として渡します。

```bash
curl -H "Authorization: Bearer $ADMIN_KEY" "$ARKVORY/api/v1/security/audit?limit=20"
```

```typescript
const page = await client.administration.security.audit({ limit: 20 });
```

サービスアカウントの操作ログは別です。[キーの発行、保存、有効化](#service-key-issue)を参照してください。

## 所有者がサインインできなくなった場合 {#recovery}

誰も管理者としてサインインできなくなった場合は、回復キーを使います。

1. サーバー上でキーを読み取ります。インストールディレクトリ内の `config/bootstrap-token.txt` です。サーバー管理者だけがこの操作を行えます。
2. コンソールで [[ui:keySignIn]] を開き、[[ui:serviceKey]] にキーを貼り付け、[[ui:connect]] を選択します。
3. [[ui:administration]] を開きます。[[ui:resetPassword]] を展開し、アカウントを選び、[[ui:newPassword]] を入力して [[ui:resetPassword]] を選択します。無効なアカウントとして表示される場合は、[[ui:enableUser]] を選択します。
4. 新しいパスワードでサインインします。

[[ui:createUser]] で新しい管理者を作成し、[[ui:administrator]] にチェックを付けることもできます。

[[ui:welcomeOwner]] フォームは、インストールにアカウントが 1 つもない間だけ使えます。それ以降は回復キーでアカウントを修復してください。最初からやり直すためのものではありません。

回復キー自体を紛失した場合は、サーバー管理者が `config/keys.json` 内のキーの SHA-256 を置き換え、API を再起動します。[セキュリティ](../operate/security)を参照してください。

## 関連ページ {#related-pages}

- [Web コンソール](../guide/console)
- [リポジトリ](./repositories)
- [コマンドライン（arkvoryctl）](../protocols/cli)
- [認証](../api/authentication)と API リファレンス：[アカウントとサインイン](../api/reference/accounts)、[サービスアカウントとキー](../api/reference/services)
- [セキュリティ](../operate/security)
