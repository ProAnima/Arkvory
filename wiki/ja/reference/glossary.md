---
title: 用語集
description: Arkvoryとそのドキュメントで使う用語の短い定義を、英語のアルファベット順に、説明ページへのリンクとともに掲載します。
---

# 用語集

用語は英語のアルファベット順に並んでいます。背景にある考え方は[概念](../guide/concepts)を参照してください。

## A {#letter-a}

### アカウント {#account}

サーバーにサインインする個人の登録情報です。名前は3～64文字、パスワードは12～128文字です。グループの許可によってリポジトリにアクセスできます。[アカウントとアクセス](../use/accounts)を参照してください。

### 操作 {#action}

`upload.create`、`content.read`など、リポジトリに対する1つの正確な権限です。サービスキーが持ち、APIリファレンスに各操作で必要なものを示します。[認証](../api/authentication#repository-actions)を参照してください。

### 管理者 {#administrator}

アカウント、グループ、更新、バックアップを管理するアカウントです。グループからもアクセスを付与されない限り、リポジトリのファイルは読めません。[アカウントとアクセス](../use/accounts)を参照してください。

### 受付制限 {#admission}

サーバーが同時に処理するリクエストと転送の数の制限です。超過した転送は短時間待機し、その後、コード`busy`と`Retry-After`ヘッダー付きの`503`を返します。[レート制限とビジー状態のサーバー](../api/index#rate-limits)を参照してください。

### アーティファクト {#artifact}

SHA-256を持つ、保存済みの1つの不変ファイルです。新しい内容は新しいアーティファクトになります。[概念](../guide/concepts#artifacts)を参照してください。

### 添付ファイル {#attachment}

ビルドから、同じリポジトリの別のアーティファクトへのリンクです。マニフェスト、SBOM、署名、レポートなどのファイルを関連付けます。1ビルドに最大32個設定できます。[概念](../guide/concepts#annotations)を参照してください。

## B {#letter-b}

### バックアップ {#backup}

スケジュールに従って、データベースとすべての公開済みコンテンツを保管庫にコピーすることです。[バックアップ](../operate/backups)を参照してください。

### バックアップエージェント {#backup-agent}

コピーを作成して検証し、復元ポイントに保持規則を適用するサービスです。[バックアップ](../operate/backups)を参照してください。

### Bearerトークン {#bearer-token}

すべてのクライアントが`/api/v1`に認証情報を送る方式で、`Authorization: Bearer <credential>`ヘッダーを使用します。[認証](../api/authentication#headers)を参照してください。

### バインディング {#binding}

サービスポリシーの1つのエントリで、リポジトリと、そこで許可する操作の一覧です。1ポリシーに最大64個設定できます。[認証](../api/authentication#service-accounts)を参照してください。

### ビルド {#build}

1回のCI実行の出力を、アーティファクトまたはパッケージバージョンとして保存したものです。[パッケージ](../use/packages)を参照してください。

## C {#letter-c}

### カタログ {#catalog}

リポジトリ内のアーティファクトと、その名前、サイズ、ラベル、ステージの一覧です。[アーティファクトのリファレンス](../api/reference/artifacts)を参照してください。

### 権限の上限 {#ceiling}

委任の上限です。オペレーターが、管理対象アカウントのポリシーとキーに設定できるリポジトリ操作を示します。オペレーターはこの上限を超えられません。[認証](../api/authentication#delegation)を参照してください。

### チェックサム {#checksum}

バイト列が期待どおりであることを検証するSHA-256です。アップロードではバイト列の到着前に申告し、サーバーとクライアントが検証します。[転送](../use/transfers)を参照してください。

### 物理クリーンアップ {#cleanup}

クリーンアップとも呼びます。バックグラウンドで小さなバッチを処理し、削除済みコンテンツのディスク容量を解放します。[ストレージ](../operate/storage)を参照してください。

### コレクション {#collection}

アーティファクトをまとめる、名前付きの集合です。アーティファクトの注釈の一部です。[概念](../guide/concepts#annotations)を参照してください。

### 比較交換 {#compare-and-swap}

`expectedRevision`などで、期待するリビジョンを指定する変更です。他の変更が先に行われていれば、何も変更せず、理由`revision_mismatch`付きの`409`を返します。[HTTP APIの概要](../api/index#revisions)を参照してください。

### 完了ジョブ {#completion-job}

大きなアップロードを検証して公開する、ワーカーのバックグラウンドジョブです。`GET /api/v1/jobs/{id}`で追跡できます。状態は`queued`、`running`、`completed`、`failed`です。[アップロードのリファレンス](../api/reference/uploads#getCompletionJob)を参照してください。

### コンソール {#console}

`/console/`で提供するArkvoryのWebインターフェースです。[Webコンソール](../guide/console)を参照してください。

### CORS {#cors}

別のアドレスのAPIを呼び出すページに適用するブラウザーの規則です。別のオリジンのページは、管理者が`ARKVORY_CORS_ORIGINS`にそのオリジンを登録した場合だけ動作します。[環境変数](./environment)を参照してください。

### カーソル {#cursor}

結果ページの`next`の値です。`after`として送り返すと次ページを読み取れます。`next`が`null`なら一覧は完了です。[HTTP APIの概要](../api/index#pagination)を参照してください。

## D {#letter-d}

### 委任 {#delegation}

回復キーからオペレーターキーに付与する権限です。指定したサービスアカウントを、指定した管理操作で、権限の上限内で管理できます。[認証](../api/authentication#delegation)を参照してください。

### ダイジェスト {#digest}

コンテナイメージのコンテンツアドレスで、`sha256:…`と表記します。[コンテナイメージ](../protocols/containers)を参照してください。

### ダウンロードリンク {#download-link}

キーなしで1つのアーティファクトをダウンロードできる、期限付きリンクです。有効期間は60秒～24時間（デフォルト1時間）で、期限前に取り消すことはできません。[認証](../api/authentication#download-links)を参照してください。

## E {#letter-e}

### ETag {#etag}

ダウンロードの検証子で、アーティファクトの強い値`"sha256:<hex>"`です。安全な再開には`If-Range`、重複するダウンロードの省略には`If-None-Match`と組み合わせます。[HTTP APIの概要](../api/index#range-downloads)を参照してください。

## F {#letter-f}

### フェイルオーバー {#failover}

アクティブサーバーが故障した後、サービスを別のサーバーへ移すことです。同一サイト内の高可用性（HA）クラスターは、レプリケーションとフェンシングの規則に従って自動的に切り替えられます。MIRRORリポジトリでは、オペレーターがミラーを手動で切り離して、書き込み可能な通常のリポジトリにする必要があります。ミラーは自動では切り替わりません。[クラスター](../operate/cluster)と[ミラー](../operate/mirrors)を参照してください。

### フィードバック {#feedback}

サインイン済みユーザーがコンソールからProAnimaStudioに送る、スクリーンショットとログ付きの報告です。送信前に、添付内容をコンソールで確認できます。[Webコンソール](../guide/console#feedback)を参照してください。

### パス指定ファイル {#file-by-path}

`builds/game/Setup.exe`などのリポジトリ内のパスで指定し、以前のリビジョンを保持するファイルです。[ファイルとパス](../use/files)を参照してください。

### ファイルキー {#file-key}

サーバーのキーファイル（`ARKVORY_KEYS_FILE`）にSHA-256を登録した秘密情報です。回復キーもファイルキーです。[認証](../api/authentication#recovery-key)を参照してください。

## G {#letter-g}

### 猶予期間 {#grace-period}

削除済みコンテンツが、物理クリーンアップで除去される前にディスクに残る時間です。デフォルトは24時間です。[ストレージ](../operate/storage)を参照してください。

### グループ {#group}

リポジトリへのアクセスを共有するアカウントの集合です。リポジトリごとに`read`または`write`（「読み取りと書き込み」）を付与します。[アカウントとアクセス](../use/accounts)を参照してください。

## H {#letter-h}

### 履歴 {#history}

パス指定ファイルや、添付ファイルの集合の以前のリビジョンです。[ファイルとパス](../use/files)を参照してください。

### ハブ {#hub}

安定版リリースを通知し、フィードバックを受け取る、`https://hub.proanima.net`のProAnimaStudioサービスです。[更新](../install/updates)を参照してください。

## I {#letter-i}

### 冪等キー {#idempotency-key}

`Idempotency-Key`ヘッダーです。1～128文字の値で、リクエストを繰り返しても効果を1回分にします。[HTTP APIの概要](../api/index#idempotency)を参照してください。

### イメージ {#image}

組み込みレジストリに保存したコンテナイメージです。[コンテナイメージ](../protocols/containers)を参照してください。

### インストールルート {#installation-root}

データ、設定、ログを保存するフォルダーです。Windowsでは`C:\ProgramData\ProAnima\Arkvory`、Linuxでは`/opt/proanima-arkvory`です。[インストール方式の選択](../install/index#installation-directory)を参照してください。

## L {#letter-l}

### ラベル {#label}

`nightly`、`tested`など、アーティファクトの短いタグです。1つのアーティファクトに最大32個設定できます。[概念](../guide/concepts#annotations)を参照してください。

### リース {#lease}

1つのプロセスだけがジョブを実行するよう、プロセスが短時間保持して更新する所有権です。バックアップエージェントのリースはデフォルト60秒で、2つのエージェントが同時に動作することはありません。[環境変数](./environment#backups)を参照してください。

### 稼働確認 {#liveness}

プロセスが稼働していることを示す、`GET /health/live`の応答です。公開されています。[システムのリファレンス](../api/reference/system)を参照してください。

### ロック {#lock}

2人が同じバイナリファイルを変更しないようにする、Git LFSのファイルロックです。[Git LFS](../protocols/git-lfs)を参照してください。

## M {#letter-m}

### メンテナンス時間帯 {#maintenance-hour}

自動更新をインストールできる、UTCでの1日の時間帯です。デフォルトは03:00です。[更新](../install/updates)を参照してください。

### メタデータ {#metadata}

アーティファクトのキーと値のテキストフィールドです。最大32個で、値は最大1,024文字です。[概念](../guide/concepts#annotations)を参照してください。

### ミラー {#mirror}

別のインストールがソースを追跡して維持する、リポジトリの読み取り専用コピーです。[ミラー](../operate/mirrors)を参照してください。

### ミラー元 {#mirror-source}

ミラーのコピー元となるインストールです。ミラーは読み取り専用キーでサインインします。[ミラー](../operate/mirrors)を参照してください。

### 移動 {#move}

ソースリポジトリからもビルドを削除するプロモーションです。[プロモーション](../use/promotion)を参照してください。

## O {#letter-o}

### 初期セットアップ {#onboarding}

インストール後の最初の手順です。コンソールの「はじめに」セクションに表示します。[クイックスタート](../guide/quick-start)を参照してください。

### OpenAPI {#openapi}

`/api/v1/openapi.json`で提供する、機械可読のHTTP APIの記述です。[HTTP APIの概要](../api/index#discovery)を参照してください。

### 所有者 {#owner}

インストール時に作成する最初のアカウントです。管理者であり、`releases`に書き込める`arkvory-owners`グループのメンバーです。[概念](../guide/concepts#owner-and-recovery-key)を参照してください。

## P {#letter-p}

### パッケージ {#package}

グループ、名前、SemVerバージョンを持つ、バージョン管理されたUPackパッケージです。[パッケージ](../use/packages)を参照してください。

### パッケージグループ {#package-group}

パッケージ名の先頭部分です。異なるグループの同じ名前のパッケージは、別のパッケージです。[パッケージ](../use/packages)を参照してください。

### パート {#part}

独立したリクエストで送信する、大きなファイルの一部分です。最後のパートを除き最小8 MiB、最大1 GiBです。[転送](../use/transfers)を参照してください。

### 権限 {#permission}

1つの操作を行う権利です。ユーザーはグループから`read`または`write`を得て、サービスキーは正確な操作権限を得ます。[認証](../api/authentication#access-rules)を参照してください。

### 個人用アクセストークン {#personal-access-token}

個人のスクリプトとコマンドライン用の秘密情報です。`pat_`で始まり、有効期間はデフォルト90日（最大365日）で、読み取り専用、または読み取りと書き込みのいずれかです。[認証](../api/authentication#personal-tokens)を参照してください。

### 固定 {#pin}

復元ポイントなどを自動削除から保護することです。[バックアップ](../operate/backups)を参照してください。

### ポリシー {#policy}

サービスアカウント（バインディング）、リポジトリ（ストレージポリシー）、バックアップ計画について保存した規則です。[認証](../api/authentication#service-accounts)を参照してください。

### プロモートする {#promote}

プロモーションを行うこと、つまり、別のリポジトリにビルドを公開するか、ステージを付けることです。[プロモーション](../use/promotion)を参照してください。

### プロモーション {#promotion}

再アップロードせずに、別のリポジトリにビルドを公開することです。[プロモーション](../use/promotion)を参照してください。

## Q {#letter-q}

### クォータ {#quota}

リポジトリが使用できる最大容量です。超過する新規アップロードは、理由`storage_quota`付きの`507`で拒否します。[ストレージ](../operate/storage)を参照してください。

## R {#letter-r}

### 範囲 {#range}

ファイルの一部分を要求するHTTPヘッダー`Range: bytes=start-end`です。ダウンロードは、再開に必要な1リクエスト1範囲に対応します。[HTTP APIの概要](../api/index#range-downloads)を参照してください。

### レート制限 {#rate-limit}

試行できる頻度の制限です。Arkvoryはサインイン、登録、パスワード、フィードバックの試行を制限し、`Retry-After`付きの`429`を返します。[認証](../api/authentication#sign-in-limits)を参照してください。

### 読み取りゲートウェイ {#read-gateway}

同じストレージを使用する、追加のダウンロード専用APIプロセスです。`GET`と`HEAD`に応答し、変更を`405`で拒否します。[読み取りゲートウェイ](../operate/read-gateways)を参照してください。

### 準備状態 {#readiness}

サーバーが処理を実行できるかを示します。公開の`GET /health/status`は`{"status":"ready"}`または`unavailable`を返し、認証情報が必要な`GET /health/ready`は詳細を返します。[システムのリファレンス](../api/reference/system)を参照してください。

### 回復キー {#recovery-key}

ブートストラップキーとも呼びます。`config/bootstrap-token.txt`内の、インストールの秘密情報です。所有者の作成、サービスアカウントの管理、アクセスの復旧に使用します。[認証](../api/authentication#recovery-key)を参照してください。

### レジストリ {#registry}

Dockerやnpmなどのクライアントがプッシュ・プルするサーバーです。Arkvoryにはコンテナレジストリ（`/v2/`）とnpmレジストリ（`/npm/`）があります。[クライアントとプロトコル](../protocols/index)を参照してください。

### リポジトリ {#repository}

独自のアクセス規則とストレージポリシーを持つ、コンテンツ用の名前付き領域です。[リポジトリ](../use/repositories)を参照してください。

### リクエストID {#request-id}

1つのリクエストを識別する値です。`X-Request-Id`ヘッダーと、すべてのエラーに含めて返します。サポートに伝えてください。[HTTP APIの概要](../api/index#request-ids)を参照してください。

### 解決する {#resolve}

ステージとバージョン範囲が指すビルドを特定することです。[プロモーション](../use/promotion)を参照してください。

### 復元する {#restore}

ファイルの以前のリビジョンを再び現在のものにすることで、新しいリビジョンを追加します。また、復元ポイントからインストール全体を復旧することも指します。[ファイルとパス](../use/files)と[バックアップ](../operate/backups)を参照してください。

### 復元ポイント {#restore-point}

復元可能な1回分の完全なバックアップです。[バックアップ](../operate/backups)を参照してください。

### 再開する {#resume}

中断したアップロードやダウンロードを、停止した位置から継続することです。[転送](../use/transfers)を参照してください。

### 保持 {#retention}

コンテンツやバックアップを保持する期間の規則です。[ストレージ](../operate/storage)を参照してください。

### 保持ポリシー {#retention-policy}

保持するビルド数、保護するラベル、削除前に必要なビルドの経過時間について、リポジトリに保存した保持規則です。管理者が有効にするまで無効です。[ストレージ](../operate/storage)を参照してください。

### Retry-After {#retry-after}

`429`または`503`の後、再試行まで何秒待つかを示すヘッダーと、エラーの`retryAfterSeconds`フィールドです。[HTTP APIの概要](../api/index#rate-limits)を参照してください。

### リビジョン {#revision}

パス指定ファイル、アーティファクトの注釈、設定の番号付きバージョンです。リビジョンは1から増加します。[HTTP APIの概要](../api/index#revisions)を参照してください。

### 取り消す {#revoke}

キーやトークンを恒久的に無効にすることです。[認証](../api/authentication#service-keys)を参照してください。

### ロールバック {#rollback}

更新後の起動に失敗したとき、以前のバージョンに戻すことです。[更新](../install/updates)を参照してください。

### ローテーションする {#rotate}

古いキーがまだ使える間に、新しいキーに置き換えることです。新しいキーを有効にすると、古いキーの残りの有効期間を24時間に制限します。[認証](../api/authentication#service-keys)を参照してください。

## S {#letter-s}

### SBOM {#sbom}

ソフトウェア部品表、つまりビルドの構成要素の一覧です。ビルドに添付できます。[概念](../guide/concepts#annotations)を参照してください。

### 自己修復 {#self-healing}

クラッシュやハングの後、サービスが自動で再起動することです。[自己修復](../operate/self-healing)を参照してください。

### SemVer {#semver}

セマンティックバージョニングです。`MAJOR.MINOR.PATCH`に任意のプレリリース部分を付け、`1.4.2`や`2.0.0-rc.1`などと表記します。[パッケージ](../use/packages)を参照してください。

### サービスアカウント {#service-account}

CIや自動化向けのアカウントです。ポリシーを持ち、キーでサインインします。[認証](../api/authentication#service-accounts)を参照してください。

### サービスキー {#service-key}

サービスアカウントがサインインに使用する秘密情報です。`arkvory_`で始まり、1回だけ表示され、有効化が必要です。[認証](../api/authentication#service-keys)を参照してください。

### セッション {#session}

サインイン済みのコンソールセッションです。`dps_`で始まり、有効期間は12時間です。[認証](../api/authentication#sessions)を参照してください。

### SHA-256 {#sha-256}

Arkvoryがアーティファクト、パート、リリースに使用するハッシュ関数です。64桁の小文字16進数で表します。[転送](../use/transfers)を参照してください。

### 安定版リリース {#stable-release}

ProAnimaStudioが安定版チャネルのインストール向けに承認したリリースです。[更新](../install/updates)を参照してください。

### ステージ {#stage}

`qa`、`release`、`prod`など、ビルドに付ける印です。[プロモーション](../use/promotion)を参照してください。

### 領域 {#surface}

API操作の6つのグループのいずれかです。`discovery`、`identity`、`catalog`、`transfers`、`administration`、`operations`があります。[HTTP APIの概要](../api/index#surfaces)を参照してください。

## T {#letter-t}

### タグ {#tag}

`latest`、`1.4`など、コンテナイメージのバージョンに付ける名前です。[コンテナイメージ](../protocols/containers)を参照してください。

## U {#letter-u}

### UPack {#upack}

Arkvoryが登録するパッケージ形式です。グループ、名前、バージョンを記した`upack.json`というマニフェストを含むアーカイブです。[パッケージ](../use/packages)を参照してください。

### 更新 {#update}

Arkvoryの新しい安定版リリースと、それをインストールすることです。[更新](../install/updates)を参照してください。

### アップロード {#upload}

サーバーにファイルを送信する操作です。そのファイルを予約するアップロードセッションを指す場合もあります。[転送](../use/transfers)を参照してください。

### アップロードセッション {#upload-session}

1つのファイルの予約です。有効期間は7日で、すべてのバイトが到着すると完了します。[アップロードのリファレンス](../api/reference/uploads)を参照してください。

## V {#letter-v}

### 保管庫 {#vault}

バックアップの保存先です。別のディスクやネットワーク共有上のフォルダーを使用します。[バックアップ](../operate/backups)を参照してください。

### バージョン {#version}

`1.4.2`など、パッケージのSemVerバージョンです。[パッケージ](../use/packages)を参照してください。

### バージョン範囲 {#version-range}

`^1.4`などのバージョンの集合です。[パッケージ](../use/packages)を参照してください。

## W {#letter-w}

### ワーカー {#worker}

大きなアップロードを完了し、ミラーを同期するサービスです。[インストール方式の選択](../install/index)を参照してください。

### 書き込みAPI {#writer}

読み取りゲートウェイに対し、変更を受け付けるAPIプロセスです。[読み取りゲートウェイ](../operate/read-gateways)を参照してください。
