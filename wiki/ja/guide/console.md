---
title: Webコンソール
---

# Webコンソール

Webコンソールは、ArkvoryのブラウザーUIです。サーバーの一部なので、別途インストールする必要はありません。サーバーのアドレスの`/console/`を開きます。たとえば、サーバー上では`http://127.0.0.1:8080/console/`、[HTTPS](../install/https)を設定した後は`https://arkvory.example/console/`です。

コンソールは、[コマンドラインクライアント](../protocols/cli)や[SDK](../protocols/sdk)と同じHTTP APIを使います。サーバーはすべてのリクエストを検証します。ボタンが表示されない場合、それは、お使いのアカウントまたはキーでその操作を使えないことを示しているだけです。

## 画面構成 {#layout}

サイドバーにセクションがグループ化されています。狭い画面では、サイドバーが[[ui:navigationMenu]]ボタンに変わります。

| グループ            | セクション                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [[ui:navLibrary]]   | [[ui:catalog]]、[[ui:packages]]、[[ui:history]]、[[ui:metadata]]                                                          |
| [[ui:navTransfers]] | [[ui:upload]]、[[ui:downloads]]                                                                                           |
| [[ui:navResources]] | [[ui:administration]]、[[ui:repositories]]、[[ui:services]]、[[ui:updates]]、[[ui:backups]]、[[ui:navStart]]、[[ui:help]] |

上部のバーには、セクションのタイトル、[[ui:uploadFile]]ボタン、[[ui:reportOpen]]ボタン、外観と言語のコントロールが表示されます。

各セクションには、`#/catalog`、`#/packages`、`#/backups`のような固有のアドレスがあります。開いているアーティファクトのアドレスは`#/artifact/<repository>/<id>`です。これらのアドレスはブックマークしたり、他の人に送ったりできます。アドレスに、パスワード、キー、検索テキストが含まれることはありません。サインインする前にリンクを開いた場合、コンソールはサインイン後にそのリンクを開きます。

一部のセクションは、特定のユーザーにのみ表示されます。

| セクション            | 表示されるユーザー                                 |
| --------------------- | -------------------------------------------------- |
| [[ui:administration]] | 管理者                                             |
| [[ui:repositories]]   | サインインしているすべてのユーザー                 |
| [[ui:services]]       | 回復キー、および権限を委任されたオペレーターのキー |
| [[ui:updates]]        | 管理者                                             |
| [[ui:backups]]        | 管理者と回復キー                                   |

## サインイン {#signing-in}

[[ui:connection]]カードはページの上部にあります。

1. [[ui:accountName]]と[[ui:password]]を入力します。
2. [[ui:signIn]]を選択します。セッションは12時間続きます。
3. コンソールは、読み取れる最初の[[ui:repository]]を選択します。別のリポジトリで作業するには、その名前を入力するか、一覧から選びます。

パスワードの代わりにキーで接続するには、[[ui:keySignIn]]を開き、キーを貼り付けて[[ui:connect]]を選択します。キーはこのブラウザータブのメモリ内にだけ保持されます。コンソールがキーを保存することはありません。

[[ui:signUp]]は、管理者がセルフ登録を許可している場合にのみ表示されます。[[ui:disconnect]]で接続を終了します。

パスワードでサインインすると、[[ui:changeOwnPassword]]と[[ui:personalAccessTokens]]を使えるようになります。個人用アクセストークンは、自分のツールで使うキーです。[アカウントとアクセス](../use/accounts)を参照してください。

### 最初の所有者 {#the-first-owner}

新しいインストールにはアカウントがありません。Windowsでは、セットアップが所有者を作成します。それ以外のインストールでは、コンソールで所有者を作成します。

1. [[ui:navStart]]を開き、[[ui:welcomeOwner]]を展開します。
2. インストールディレクトリの`config/bootstrap-token.txt`にある回復キーを貼り付けます。
3. 名前と12文字以上のパスワードを入力し、[[ui:welcomeCreate]]を選択します。
4. 新しい名前とパスワードでサインインします。

このフォームを使えるのは、アカウントが1つもない間だけです。所有者は管理者です。また、所有者は`arkvory-owners`グループを通じて、`releases`リポジトリへの書き込み権限も持ちます。

## ライブラリ {#library}

### アーティファクト {#artifacts}

[[ui:catalog]]には、リポジトリの公開済みファイルが一覧表示されます。名前またはメタデータの値で検索できます。[[ui:labelFilter]]で1つのラベルだけを表示し、[[ui:metadataFilter]]でキーと値を完全一致で絞り込みます。各行には、名前、サイズ、公開日時、ステージ、ラベルが表示されます。[[ui:download]]を選択するとファイルをダウンロードし、[[ui:open]]を選択すると詳細を表示します。[[ui:more]]で次のページを表示します。

### パッケージ {#packages}

[[ui:packages]]には、登録済みのUPackバージョンが一覧表示されます。[[ui:packageGroup]]と[[ui:packageName]]で絞り込み、[[ui:sortBy]]と[[ui:groupBy]]を選んで、[[ui:apply]]を選択します。ステージの列には、各バージョンがプロモートされている先が表示されます。[パッケージ](../use/packages)を参照してください。

### ファイル履歴 {#file-history}

`builds/game/1.4/GameSetup.exe`のようなファイルパスは、何度でも新しいコンテンツを指し示すことができます。変更のたびに、新しいバージョンが作られます。[[ui:history]]でパスを入力し、[[ui:historyLoad]]を選択します。各バージョンが、作成者と日時とともに表示されます。任意のバージョンを開いて、元のコンテンツをダウンロードできます。古いバージョンを復元すると新しいバージョンが作られ、何も削除されません。[ファイルとパス](../use/files)を参照してください。

### アーティファクトの詳細 {#artifact-details}

[[ui:metadata]]には、1つのアーティファクトが表示されます。

- **概要**：[[ui:summarySize]]、[[ui:summaryCreated]]、[[ui:summaryHash]]と、[[ui:copyHash]]ボタン。
- **プロパティ**：[[ui:labels]]、[[ui:collections]]、[[ui:metadataFields]]。[[ui:save]]を選択して保存します。ファイル自体は変わりません。
- **操作**：[[ui:download]]。[[ui:downloadLink]]は、キーなしで1時間有効なリンクを作成します。[[ui:register]]は、UPackアーカイブを索引に登録します。
- [[ui:assetTitle]]：[[ui:assign]]は、このアーティファクトをファイルパスの現在のコンテンツにします。
- [[ui:promotionTitle]]：[[ui:stageAdd]]は、`qa`や`release`などのステージをアーティファクトに付けます。[[ui:promoteSubmit]]は、別のリポジトリに公開します。[プロモーション](../use/promotion)を参照してください。
- [[ui:attachmentsTitle]]：[[ui:attachmentAdd]]は、マニフェスト、SBOM、署名、レポートなどのファイルをこのビルドに関連付けます。[[ui:attachmentHistory]]には、以前のセットが表示されます。
- [[ui:deletionTitle]]：[[ui:deletionInspect]]は、そのアーティファクトを今も使っているものを表示します。削除するには、アーティファクトのIDを貼り付けて[[ui:deletionSubmit]]を選択します。

## 転送 {#transfers}

### アップロード {#upload}

[[ui:upload]]でファイルを選び、[[ui:startUpload]]を選択します。コンソールはまずファイルのSHA-256を計算し、それからパートに分けて送信します。[[ui:pause]]で転送を止めます。アップロード済みのパートは保持されます。

後で再開するには、アップロードIDを控えておきます。[[ui:resumeTitle]]を開き、同じファイルを選択して、[[ui:uploadId]]を入力します。アップロード中にページを離れようとすると、ブラウザーが警告を表示します。[転送](../use/transfers)を参照してください。

### ダウンロード {#downloads}

[[ui:downloads]]は、コンソールからダウンロードするファイルのキューです。コンソールは、最終的なファイルを保存する前に、各ファイルのSHA-256を確認します。

- [[ui:downloadSettings]]で、[[ui:downloadConcurrency]]（1〜8）、[[ui:downloadInterval]]、[[ui:downloadWait]]を設定します。
- [[ui:downloadsPause]]、[[ui:downloadsResume]]、[[ui:downloadsClearWaiting]]、[[ui:downloadsCancel]]、[[ui:downloadsClearFinished]]は、キュー全体を操作します。
- ページを再読み込みした後は、もう一度サインインし、[[ui:downloadRestore]]を選択します。続いて各ファイルを再開し、保存先を選びます。

大きなファイルのダウンロードには、安全なアドレス（HTTPSまたはローカルコンピューター）上のChromeまたはEdgeが必要です。一時データは、ブラウザーのプライベートストレージに保存されます。

## リソース {#resources}

### ユーザーとアクセス {#users-and-access}

管理者はここで人を管理します。[[ui:accountsHeading]]にアカウント、[[ui:groupsHeading]]にグループが一覧表示されます。[[ui:createUser]]、[[ui:resetPassword]]、[[ui:createGroup]]、[[ui:manageMembers]]を使います。[[ui:manageGrants]]で、リポジトリ名を指定して、グループに[[ui:read]]または[[ui:write]]のアクセス権を付与します。リポジトリを個別に作成する手順はありません。アクセス権の付与またはサービスポリシーでその名前が指定された時点で、リポジトリが存在するようになります。

### リポジトリ {#repositories}

[[ui:repositories]]には、表示できるリポジトリが[[ui:repositoryRights]]とともに表示されます。各カードには[[ui:repositoryOpen]]と[[ui:repositoryStorage]]（クォータ、自動クリーンアップ、物理クリーンアップ）があり、管理者には[[ui:repositoryAccess]]も表示されます。ミラーされたリポジトリには[[ui:mirrorBadge]]のバッジが表示されます。[リポジトリ](../use/repositories)と[ストレージ](../operate/storage)を参照してください。

### サービスアクセス {#service-access}

ここでは、ツールやCIシステム用のアカウントを作成します。このセクションを表示するには、回復キーまたはオペレーターのキーで接続します。[[ui:serviceCreate]]を選択し、[[ui:servicePolicy]]を設定します。[[ui:bindingRead]]と[[ui:bindingPublish]]は、よく使う権限のセットを入力します。

キーを発行するには、[[ui:serviceKeys]]を開いて[[ui:keyIssue]]を選択します。シークレットが表示されるのは1回だけです。コピーして、[[ui:keySaved]]にチェックを入れ、[[ui:keyActivate]]を選択します。有効化されていないキーは、15分後に期限切れになります。キーを置き換えるには[[ui:keyRotate]]、停止するには[[ui:keyRevoke]]を使います。[[ui:delegations]]では、所有者がオペレーターに限定的な管理権限を付与できます。

### 更新 {#updates}

[[ui:updates]]には、[[ui:updateCurrent]]と[[ui:updateLatest]]が表示されます。[[ui:updateCheck]]または[[ui:updateInstall]]を選択します。[[ui:updateSettings]]で[[ui:updateAutomatic]]をオンにし、[[ui:updateHour]]を選びます。[更新](../install/updates)を参照してください。

### バックアップ {#backups}

[[ui:backups]]には、バックアップが正常かどうか、最新のバックアップ、次回の実行、バックアップエージェント、バックアップの保管庫が表示されます。[[ui:backupRun]]を選択するとバックアップを開始します。[[ui:backupPoints]]には復元ポイントが一覧表示され、ポイントの全バイトを検証したり、固定したりできます。[[ui:backupPlan]]では、毎日の実行時刻、タイムゾーン、保持するポイントの数を設定します。復元は、サーバー上で実行するコマンドです。[バックアップ](../operate/backups)を参照してください。

### はじめにとAPIリファレンス {#getting-started-and-api-reference}

[[ui:navStart]]には、新しいサーバーの最初の手順が表示されます。[[ui:help]]には、コマンドの例が一覧表示されます。[[ui:helpLoad]]は、現在のアカウントまたはキーで呼び出せるAPI操作を表示します。

## フィードバック {#feedback}

サインイン後に[[ui:reportOpen]]を使うと、ハブ経由でProAnimaStudioにメッセージを送信できます。画像を最大6枚と、返信用のメールアドレスを添付できます。管理者はサーバーログも添付できます。[[ui:reportShow]]を選択すると、送信される内容をそのまま確認できます。

## 外観と言語 {#appearance-and-language}

[[ui:theme]]には3つの選択肢があります。[[ui:system]]、[[ui:light]]、[[ui:dark]]です。[[ui:language]]には、コンソールのすべての言語が、その言語自身の名前で一覧表示されます。English、Русский、Español、Français、Deutsch、Português、中文、日本語、한국어、हिन्दी、العربيةです。ページは、再読み込みも入力内容の消失もなく、すぐに切り替わります。アラビア語は右から左に表示されます。初回アクセス時は、コンソールはブラウザーの言語に従い、一致するものがなければ英語になります。[[ui:help]]の[[ui:helpDocs]]を開くと、コンソールの言語でこのドキュメントが開きます。ブラウザーが保存するのはテーマと言語だけで、アカウントやリポジトリに関する情報は保存しません。

## 関連ページ {#related-pages}

- [クイックスタート](./quick-start)
- [基本概念](./concepts)
- [アカウントとアクセス](../use/accounts)
- [トラブルシューティング](../operate/troubleshooting)
