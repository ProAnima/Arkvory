---
title: よくある質問
description: 制限、可用性、データベース、更新、サーバー移行、アクセス、ライセンスに関するよくある質問に、短く正確に答えます。
---

# よくある質問

## サイズと可用性 {#size-and-availability}

### 保存できるファイルの最大サイズは？ {#max-object-size}

10,000 GiB（10 737 418 240 000バイト）です。1アップロードは、各最大1 GiBのパートを最大10,000個使用できます。管理者は`ARKVORY_MAX_OBJECT_BYTES`で上限を引き下げられます。上限を超える申告サイズは`400`で拒否します。実際には、ディスクの空き容量、リポジトリのクォータ、1 GiBの空き容量予備領域が先に制約となり、`507`を返します。[概念](../guide/concepts#uploads)と[環境変数](./environment)を参照してください。

### 1台のサーバーにどれだけ保存できる？ {#capacity}

デフォルトでは最大10 TiBのコンテンツを予約できます（`ARKVORY_CAPACITY_BYTES`）。公開済みファイル、未完了アップロード、物理クリーンアップ待ちのコンテンツを含みます。これはカウンターであり、ディスクの確認ではありません。実際の制約はディスクと予備領域です。リポジトリごとに独自のクォータも設定できます。[ストレージ](../operate/storage)を参照してください。

### Arkvoryは高可用性に対応する？ {#high-availability}

はい。同一サイトのLinuxクラスターで対応します。ha-2は2台のデータサーバーと独立したウィットネス、ha-3は3台のデータサーバーを使用します。DRBD 9、Pacemaker、検証済みのフェンシングが必要です。通常、書き込みには2つの完全なコピーが必要です。WindowsとDocker Composeはスタンドアロンのままです。HAはバックアップを代替せず、サイト全体の喪失にも対応しません。別サイトのミラーは非同期で、切り替えは手動です。[クラスター](../operate/cluster)、[バックアップ](../operate/backups)、[ミラー](../operate/mirrors)を参照してください。

### オフラインでも動作する？ {#offline}

無料コアはインターネット接続なしで動作します。WindowsインストーラーはNode.jsとPostgreSQLを同梱します。LinuxパッケージはNode.jsを同梱し、PostgreSQLをパッケージマネージャーから取得します。スクリプトインストーラーとDockerはダウンロードが必要な場合があります。更新にはローカルのリリースを使用できます。ハブに接続できなければ、更新の検出はGitHubにフォールバックできます。両方に接続できなければ検出は失敗しますが、ストレージは停止しません。有料モジュールには、オンラインまたはオフラインの別のライセンス有効期間があります。期限前の更新を計画してください。[インストール](../install/index)、[更新](../install/updates)、[ライセンス](../operate/licenses)を参照してください。

## ストレージとデータベース {#storage-and-database}

### 使用するデータベースは？ {#database}

PostgreSQLで、インストールごとに1つのデータベースを使用します。WindowsインストーラーはPostgreSQL 18.7を同梱します。Linuxパッケージは、ディストリビューションのPostgreSQL 16～19サーバー内に専用クラスターを使用します。Docker Compose構成はコンテナでPostgreSQL 18.7を実行します。スクリプトインストーラーは自分で用意したサーバーを使います。2つのインストールを1つのデータベースに接続しないでください。ファイル内容はデータベースではなく、データディレクトリに保存します。

### S3や他のオブジェクトストアを使える？ {#s3}

いいえ。ファイル内容はローカルディレクトリに保存し、ネットワーク共有ではなく、ハードリンクに対応するローカルファイルシステムが必要です。ArkvoryはS3にコンテンツを保存せず、S3インターフェースも提供しません。バックアップ保管庫は、別のディスクやマウント済みネットワーク共有上のフォルダーです（WindowsではローカルまたはiSCSIボリューム）。

### 社内のシングルサインオンを使える？ {#sso}

いいえ。アカウント、グループ、パスワードはArkvoryが管理します。自動化はサービスキーでサインインします。[認証](../api/authentication)を参照してください。

## サーバーの運用 {#running}

### インストール済みバージョンを確認するには？ {#version}

コンソールで[[ui:updates]]を開くと、[[ui:updateCurrent]]に表示します。サーバーでは`arkvory status --root <installation root>`を実行し、`current`を確認します。グラフィカルインストーラーを使うWindowsでは、管理者権限のPowerShellで`& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' status --root 'C:\ProgramData\ProAnima\Arkvory'`を実行します。管理者は`GET /api/v1/system/updates`の`currentVersion`でも確認できます。`arkvoryctl --version`が表示するのはサーバーではなく、クライアントのバージョンです。

### 自動更新を有効にするには？ {#automatic-updates}

コンソールで[[ui:updates]]を開き、[[ui:updateAutomatic]]を選択し、[[ui:updateHour]]を選んで[[ui:updateSave]]を選択します。サーバーでは`arkvory configure --root <installation root> --enable-updates`を実行します。`--disable-updates`で無効にします。インストーラーは、`--automatic`を指定しない限り無効にしておきます。

自動インストールが無効でも、サーバーは6時間ごとにリリースを確認します。有効な場合は、バージョンを固定していなければ、1日1回メンテナンス時間帯（デフォルト03:00 UTC）に安定版リリースをインストールします。データベーススキーマを変更するリリースは、サーバーが新しいバックアップを作成して検証した後にだけインストールします。[更新](../install/updates)を参照してください。

### ArkvoryはProAnimaStudioに何を送る？ {#hub-traffic}

保存したコンテンツは自分のサーバーに残ります。インストールは、次の目的でProAnimaStudioハブ（`hub.proanima.net`）に接続します。GitHubはリリース検出の代替であり、ライセンス有効化の代替ではありません。

- **更新の確認。** リクエストには、プロジェクト名、OS、プロセッサーアーキテクチャ、インストール済みバージョン、更新チャネルを含めます。統計が有効なら、ランダムなインストールIDも含めます。
- **匿名統計。** 更新をインストールするたびに、インストールID、バージョン、システム、アーキテクチャ、チャネルを含むイベントを1回送ります。名前、住所、コンテンツ、IPアドレスは保存しません。統計はデフォルトで有効です。[[ui:updates]]の[[ui:updateStatistics]]、または`arkvory configure --statistics off`で無効にします。統計が無効な場合、新しいバージョンは全員に展開されて初めて届きます。
- **フィードバック。** サインイン済みユーザーが[[ui:reportOpen]]から送信した場合だけです。メッセージ、任意のメールアドレス、最大6枚のスクリーンショット、コンソールログを含みます。管理者は、秘密情報を含まないサーバーログと、バージョン・状態の概要を追加できます。[[ui:reportShow]]で正確な送信内容を確認できます。

`arkvory configure --hub-off`はハブへの接続を停止します。以後はGitHubからだけリリースを取得し、サービス再起動後にフィードバックを無効にします。`ARKVORY_HUB_URL`を空にすると、フィードバックだけを無効にします。[ライセンス](https://github.com/ProAnima/Arkvory/blob/main/LICENSE.md)の第7節を参照してください。

有料モジュールの有効化と更新もハブに接続し、ライセンス・インストールの識別子、モジュールのバージョン、有効化の認証情報を交換します。有効化しなければ、ライセンスの通信はありません。統計を無効にしても、ライセンス管理は無効になりません。`--hub-off`ではオンラインの有効化と更新は利用できません。[オフラインライセンスの手順](../operate/licenses#offline)を使い、有効期限を管理してください。有料機能にライセンスが必要であることは変わりません。

### バックアップは自動で動く？ {#automatic-backups}

設定するまでは動きません。`arkvory configure --backup-vault <folder> --vault-key-file <file>`で保管庫を接続し、[[ui:backups]]の[[ui:backupPlan]]で日次スケジュールを有効にします。計画は02:00 UTCに開始し、日次7個、週次4個、月次6個の復元ポイントを保持します。有効にするまで、コンソールに日次スケジュールが無効である警告を表示します。[バックアップ](../operate/backups)を参照してください。

### 別のサーバーに移行するには？ {#move-server}

1. 新しいサーバーに、同じか新しいバージョンのArkvoryをインストールします。
2. `arkvory-backup restore`で、保管庫の最新復元ポイントを空のデータベースと空のストレージディレクトリに復元します。すべてのファイルをSHA-256で確認します。[バックアップ](../operate/backups)を参照してください。
3. `config/runtime.json`の`ARKVORY_DATABASE_URL`と`ARKVORY_DATA_DIR`に復元済みデータベースとディレクトリを指定し、サービスを再起動して、コンソール、ダウンロード、アップロードを確認します。
4. アドレス（DNSまたはCI設定）を新しいサーバーに移します。

ユーザー、グループ、パスワードは戻ります。セッションは引き継がず、個人用トークンとサービスキーは取り消すため、再度サインインして新しいキーを発行してください。保持ポリシーと物理クリーンアップの設定は無効で戻るため、意図を確認して有効にしてください。未完了のアップロードはキャンセルします。古いサーバーを動かしたままリポジトリを移す場合、新しいサーバーで[ミラー](../operate/mirrors)として追跡し、切り替え時に切り離すこともできます。ミラーはファイル、パッケージ、イメージを転送しますが、アカウント、キー、添付ファイル、ポリシーは転送しません。

### サーバー再起動時、転送はどうなる？ {#interrupted-transfers}

クライアントが継続します。アップロードセッションは7日間有効で、到着済みのパートを保持します。コマンドラインクライアントとSDKは、サーバーにあるものを問い合わせ、残りを送信します。ダウンロードは`Range`リクエストで再開します。rawファイルやDockerレイヤーなど、単一の`PUT`リクエストは最初のバイトから再送します。[中断した転送の再開](../protocols/cli#resume-interrupted-transfers)を参照してください。

### 問題が起きたらどこを見る？ {#logs}

すべてのエラーには、`requestId`フィールドと`X-Request-Id`ヘッダーにリクエストIDがあります。サーバーのアクセスログから探してください。サービスのログは、Windowsでは`logs`フォルダー、Linuxではジャーナル（`journalctl -u arkvory-api`）に記録します。[[ui:reportOpen]]からログを含むレポートを送れます。[トラブルシューティング](../operate/troubleshooting)と[監視](../operate/monitoring)を参照してください。

## アクセス {#access}

### 所有者のパスワードをリセットするには？ {#reset-owner-password}

別の管理者が、[[ui:administration]]の[[ui:resetPassword]]を使えます。誰もサインインできなければ、`config/bootstrap-token.txt`の回復キーを使います。`GET /api/v1/users`でアカウントIDを調べ、`{"password": "…"}`を指定して`PATCH /api/v1/users/<id>`を送信します。新しいパスワードは12～128文字です。リセットは、そのアカウントのすべてのセッションと個人用トークンを終了します。[認証](../api/authentication#recovery-key)を参照してください。

### 回復キーとは？ 失った場合は？ {#lost-recovery-key}

インストールルートの`config/bootstrap-token.txt`にある秘密情報で、システム管理者だけが読み取れます。最初の所有者の作成と、サービスアカウントの管理に使用します。インストールツールが読むため、ファイルを削除しないでください。ファイルを失っても管理者アカウントがあれば、そのアカウントで作業を続けられます。新しい回復キーの作成は[設定](../install/configuration)に従ってください。[概念](../guide/concepts#owner-and-recovery-key)を参照してください。

### CIにはどのキーを使う？ {#ci-key}

ジョブに必要な操作だけをポリシーに持つサービスアカウントの、サービスキーを使います。例えば公開には`upload.create`、`upload.write`、`upload.complete`、`upload.read`、`job.read`を使います。コンソールのプリセット[[ui:bindingRead]]と[[ui:bindingPublish]]で典型的な組み合わせを設定できます。CIに回復キーや個人のトークンを使わないでください。キーの有効期間はデフォルト90日、最長365日なので、ローテーションを計画してください。[認証](../api/authentication#service-accounts)を参照してください。

### 管理者がアーティファクトを削除したりストレージポリシーを変更したりできないのはなぜ？ {#delete-forbidden}

`artifact.delete`、`storage.read`、`storage.manage`、`diagnostics.read`はサービスキーだけが持つ操作権限です。グループの許可、個人用トークン、セッション、回復キーには含みません。対象リポジトリのこれらの操作を持つサービスアカウントを作成し、キーを発行して、そのキーで呼び出してください（API、`arkvoryctl`、またはコンソールの[[ui:keySignIn]]）。エラーは理由`permission_missing`付きの`403`です。[認証](../api/authentication#repository-actions)を参照してください。

### Docker、Git LFS、Unityに対応する？ {#protocols}

はい。Arkvoryは、`/v2/`にコンテナレジストリ、`/lfs/<repository>`にGit LFSサーバー、`/npm/<repository>/`にUnity Package Managerが使えるnpmレジストリを提供します。Arkvoryのキーをパスワードとして受け付けます。[クライアントとプロトコル](../protocols/index)を参照してください。

## ライセンス {#license}

### Arkvoryはオープンソース？ {#open-source}

いいえ。Arkvoryは無料で、ソースコードを読むことはできますが、オープンソースではありません。Ian PanaevのProAnima Arkvory License 1.0に基づき、フォークやコピーの配布は認めていません。「オープンソース」と呼ばないでください。全文は[LICENSE.md](https://github.com/ProAnima/Arkvory/blob/main/LICENSE.md)にあり、両言語の内容が異なる場合はロシア語版が優先します。

### 何をしてよい？ {#license-allowed}

企業内での利用を含む任意の目的で、任意の数のコピーをインストールして使用できます。ソースを閲覧・学習・変更し、変更版を組織内で使用できます。自分のアーティファクトを保存・配信し、自分の顧客に届けることもできます。

### 何が禁止されている？ {#license-forbidden}

ソフトウェアや変更版を組織外に配布すること、コードを含むフォーク、ビルド、コンテナイメージ、パッチを公開すること、ソフトウェアやそのアクセスを販売・賃貸・貸与すること、料金を請求すること、第三者にホステッドサービスやマネージドサービスとして提供することは禁止です。著作権表示、ライセンス、ProAnima ArkvoryとProAnimaStudioの名称を削除したり、変更版を原版として提示したりしてはいけません。Arkvoryを使用したシステムを公に説明する場合は、出典として「ProAnima Arkvory by ProAnimaStudio (Ian Panaev), <https://github.com/ProAnima/Arkvory>」と記載してください。コピーは公式の取得元からだけ入手してください。他の許諾についてはinfo@proanima.netに連絡してください。

### 問題や脆弱性はどこに報告する？ {#report}

インストールに関する問題は、コンソールの[[ui:reportOpen]]を使ってください。セキュリティの問題は、リポジトリの[SECURITY.md](https://github.com/ProAnima/Arkvory/blob/main/SECURITY.md)に従い、公開投稿しないでください。
