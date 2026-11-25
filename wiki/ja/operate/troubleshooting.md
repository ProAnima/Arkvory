---
title: トラブルシューティング
description: Arkvoryサーバーの障害の症状、原因、対処方法、およびログとリクエストIDの探し方を説明します。
---

# トラブルシューティング

該当する症状を探し、原因を読んで対処してください。各節には、確認すべきログイベントまたはエラーを示します。エラーコードの意味は[エラー](../api/errors)を参照してください。

## 最初の確認 {#first-steps}

1. ステータスエンドポイントに問い合わせます：`curl -fsS http://127.0.0.1:8080/health/status`。`{"status":"ready"}`は、APIがデータベースとストレージにアクセスできることを示します。
2. 障害が起きているサービスの最新ログ行を読みます。[ログとフィードバック](#logs-and-feedback)を参照してください。
3. イベント`startup.failed`または`worker.unavailable`を探します。`reason`フィールドが原因を示します。
4. クライアントからエラーの報告があれば、リクエストIDを確認し、ログで検索します。

## サーバーが起動しない {#server-does-not-start}

サービスマネージャーは、失敗したサービスを10秒ごとに再起動します。その場合、ログに`startup.failed`を繰り返し記録します。`reason`、`errno`、`sqlstate`フィールドを確認してください。

### ポートが使用中 {#port-busy}

**原因。** `startup.failed`の`errno`が`EADDRINUSE`です。別のプログラムがポート8080（`ARKVORY_PORT`）で待ち受けているか、古いArkvoryプロセスがまだ動作しています。

**対処。** ポートを使用するプロセスを探して停止するか、ポートを変更します。

```bash
sudo ss -ltnp 'sport = :8080'
```

```powershell
Get-NetTCPConnection -LocalPort 8080 | Select-Object LocalAddress, OwningProcess
```

ポートを変更するには、`config/runtime.json`の`ARKVORY_PORT`を編集し、サービスを再起動します。コンソールのアドレスも変わります。

### データベースに接続できない、またはログインを拒否される {#database-problems}

**原因。** ログに次のいずれかの理由を表示します。

| `reason`                                                           | 意味                                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `dependency unavailable`。`errno`は`ECONNREFUSED`または`ETIMEDOUT` | PostgreSQLが停止中、別の場所で待ち受けている、またはファイアウォールに遮断されている |
| `database authentication failed`                                   | `ARKVORY_DATABASE_URL`のユーザーまたはパスワードが誤っている                         |
| `database does not exist`                                          | URLで指定したデータベースがない                                                      |
| `database role lacks a required privilege`                         | ロールにテーブルの作成・変更権限がない                                               |

**対処。** PostgreSQLを起動するか、`config/runtime.json`の`ARKVORY_DATABASE_URL`を修正し、サービスを再起動します。管理対象データベースは、`127.0.0.1`の`ARKVORY_DATABASE_URL`に指定したポートで待ち受けます（Windowsのサービスは`Arkvorydatabase`、Linuxでは`arkvory-database`）。データベースが応答すれば、サービスは自動で起動します。`database/`フォルダーは削除しないでください。Windowsでログに`could not bind IPv4 address "127.0.0.1": Permission denied`と出る場合、OS起動時にWindowsがそのポートを予約しています（`netsh int ipv4 show excludedportrange protocol=tcp`で予約範囲を表示できます）。セットアップはデータベースのポートをこれらの範囲から除外します。除外は`*`付きで表示され、再起動後も維持され、欠けていれば修復や更新で再追加します。古いインストールを予約済みポートから移すには、Arkvoryサービスを停止し、`database/settings.json`の`port`と`config/runtime.json`の`ARKVORY_DATABASE_URL`に同じ未使用ポート（例：45329）を設定して、セットアップを再実行します。修復処理が新しいポートを除外し、サービスを起動します。

### データベースとプログラムが一致しない {#migrations}

**原因。** 理由が`unavailable:`で始まり、`Database migrations 1 through N are required; run migrate`、`Database schema is newer than this release`、または`database schema is missing; run migrations`と表示します。途中で停止した更新後や、新しいデータベースに対して古いバージョンを起動した場合に発生します。

**対処。** 新しいデータベースに対して古いバージョンを起動しないでください。`arkvory status --root <root>`で状態を確認し、`recover`で更新を完了するか元に戻します。[更新の失敗](#update-failed)を参照してください。データの安全のため、バックアップから復元するのは`recover`で完了できない場合だけにしてください。

### 他のプロセスがストレージを所有している {#storage-identity}

**原因。** 理由は`busy: Another writer or maintenance process owns this database`、または`conflict: Database belongs to a different storage directory`です。同じデータベースに対して2つ目のAPIが動作しているか、以前そのデータベースで使用したものとは異なるデータディレクトリを指定しています。各ストレージディレクトリには`storage-id`ファイルがあり、データベースがその識別情報を記録します。

**対処。** 他のプロセスを停止してください。このデータベースに属するデータディレクトリを使います。`storage-id`を別のディレクトリにコピーしたり、2つのインストールを同じデータベースに接続したりしないでください。

### ルートまたはデータディレクトリのアクセス権 {#root-permissions}

**原因。** `errno`が`EACCES`または`EPERM`、あるいは理由が`Cannot read ARKVORY_KEYS_FILE (EACCES)`です。サービスアカウントが設定を読み取れないか、データディレクトリに書き込めません。ユーザープロファイル内へのインストール、手動コピーしたフォルダー、所有者の変更などが典型的な原因です。

**対処。**

- Linux：ルートと`config/`の所有者は`root:arkvory`、モードは0750です。`config/runtime.json`と`config/keys.json`のモードは0640です。`data/`と`logs/`の所有者は`arkvory:arkvory`です。
- Windows：アカウント`NT AUTHORITY\LocalService`がルートのすべての親フォルダーを読み取れ、`data\`、`logs\`、更新受信箱を変更できる必要があります。グラフィカルインストーラーを再実行してアクセス規則を復元してください。
- ホームディレクトリやユーザープロファイルの外にある専用フォルダーにインストールしてください。

### 設定または証明書が拒否される {#invalid-configuration}

**原因。** 理由には、`Invalid ARKVORY_PORT`などの変数名、または証明書の問題（`TLS certificate has expired`、`TLS certificate and key do not match`、`TLS key is not an unencrypted PEM private key`）を表示します。証明書が不正な場合、サーバーが平文HTTPで起動することはありません。

**対処。** `config/runtime.json`の該当する変数を修正します。範囲外の値は起動を停止させます。証明書ファイルを更新または交換してください。ファイルを修正する間に平文HTTPへ戻すには、`arkvory configure --tls-off`を使います。[環境変数](../reference/environment)を参照してください。

## コンソールからAPIに接続できない {#console-unreachable}

| コンソールのメッセージ      | 原因                                                                                                                                            | 対処                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [[ui:errorNetwork]]         | ブラウザーに応答がない。サービス停止、アドレス・ポートの誤り、ファイアウォールによる遮断、`127.0.0.1`だけでの待ち受け、証明書と名前の不一致など | ブラウザーと同じコンピューターから`/health/status`を試す。サービス、待ち受けアドレス、ファイアウォールを確認 |
| [[ui:errorGateway]]         | リバースプロキシは応答するが、背後のAPIが応答しない                                                                                             | APIが稼働し、プロキシがそのポートを指しているか確認。大容量転送ではプロキシの読み取りタイムアウトを延ばす    |
| [[ui:errorTimeout]]         | サーバーが時間内に応答しなかった                                                                                                                | ログで`upload.deadline`やデータベースの高負荷を調べる                                                        |
| [[ui:errorUnavailable]]     | データベースなどの依存先が一時的に利用できない                                                                                                  | 待って再試行。[ビジーと利用不可](#retry-after)を参照                                                         |
| [[ui:errorOriginForbidden]] | 外部コンソールのアドレスが`ARKVORY_CORS_ORIGINS`にない                                                                                          | 正確なオリジン（スキーム、ホスト、ポート）を追加しAPIを再起動                                                |
| [[ui:sessionEnded]]         | 別の場所でサインアウトした、パスワードが変わった、またはアクセスを取り消された                                                                  | 再度サインイン                                                                                               |

更新中、コンソールは自動で再接続します。インストール要求を再送しないでください。Docker Desktopを使う場合、Docker Desktopが動作するまでサーバーは利用できません。[Docker](#docker)を参照してください。

## サインインの問題 {#sign-in}

### 名前またはパスワードが違う {#wrong-password}

**原因。** メッセージは[[ui:signInFailed]]（401 `invalid_credentials`）です。存在する名前を特定されないよう、サーバーは名前の誤り、パスワードの誤り、無効なアカウントに同じ応答を返します。

**対処。** 管理者は[[ui:administration]]でアカウントを確認し、無効なら[[ui:enableUser]]を使い、または[[ui:resetPassword]]で新しいパスワードを設定できます。

### 試行回数が多すぎる {#too-many-attempts}

**原因。** 応答は`login_attempts`と`Retry-After`を伴う429 `rate_limited`です。アドレスの10回の試行枠を使い切ったか、多数の誤ったパスワードによりアカウントが待機中です（最大2分）。この間は正しいパスワードでも待つ必要があります。

**対処。** `Retry-After`に示された秒数を待ちます。管理者は、パスワードをリセットしてアカウントの待機を解除できます。APIの再起動はアドレスのカウンターを消去しますが、アカウントの待機は解除しません。

### プロキシの背後で全員がブロックされる {#blocked-behind-proxy}

**原因。** サーバーがプロキシのアドレスを各クライアントのアドレスとして認識し、全員が1つの試行枠を共有しています。

**対処。** `ARKVORY_TRUSTED_PROXIES`にプロキシのアドレスを設定し、APIを再起動します。プロキシは`X-Forwarded-For`を送信する必要があります。[セキュリティ](./security#sign-in-limits)を参照してください。

### 所有者としてアクセスできない {#owner-lost}

**原因。** 管理者のパスワードを誰も覚えていません。

**対処。** サーバー上の回復キーを使用します。

1. rootまたはAdministratorとして`config/bootstrap-token.txt`からキーを読み取ります。
2. コンソールで[[ui:keySignIn]]を開き、キーを貼り付けて[[ui:connect]]を選択します。
3. [[ui:administration]]を開きます。アカウントの[[ui:resetPassword]]を使うか、[[ui:createUser]]で新しい管理者を作成します。
4. [[ui:disconnect]]を選択し、アカウントでサインインします。

[[ui:welcomeOwner]]フォームは、サーバーにアカウントが1つもない間だけ利用できます。

### 回復キーを失った {#recovery-key-lost}

**原因。** `config/bootstrap-token.txt`を削除したか、保存していません。サーバーが保持するのはキーのハッシュだけです。

**対処。** サーバー上のrootまたはAdministrator権限で、新しいキーとハッシュを書き込みます。[設定](../install/configuration)を参照してください。インストールツールが読み取るため、ファイルを再び削除しないでください。

## アップロード {#uploads}

### アップロードが完了しない {#upload-stuck}

**原因。** 複数の原因が考えられます。

- クライアントが接続を失いました。マルチパートアップロードは、記録済みのパートを7日間保持します。
- 大きなアップロードがワーカーを待っています。ワーカーが停止中、または失敗しています。2つ目のワーカーはスタンバイとして待機します。
- 同時アップロードが多すぎます。デフォルトでは2つ、アカウントごとに1つが動作し、残りは20秒待ってから503 `busy`を受け取ります。
- リバースプロキシが大きな本文を拒否（413）、または遅いリクエストを停止（502または504）しています。

**対処。**

1. `arkvoryctl uploads status <id>`でアップロードの状態を確認します。同じファイルと状態ファイルで再開してください。[コマンドライン](../protocols/cli#resume-interrupted-transfers)を参照してください。
2. `systemctl status arkvory-worker`、`Get-Service Arkvoryworker`でワーカーを確認します。`uploadId`を使って`completion.failed`と`completion.attempts_exhausted`を探します。メトリクス`arkvory_completion_oldest_queued_seconds`は待機ジョブを示します。
3. プロキシの本文サイズと読み取り時間の制限を引き上げます。アップロードリクエストは、データなしで30秒、または合計30分経過すると停止します。
4. 7日より古いセッションは期限切れです（409 `upload_expired`）。新しいアップロードを開始してください。

### integrity_mismatch {#integrity-mismatch}

**原因。** 応答が422 `integrity_mismatch`、またはクライアントの終了コードが5です。バイト列が申告したサイズまたはSHA-256と一致していません。送信中にファイルが変わった、別のファイルのハッシュを申告した、プロキシやネットワーク機器が本文を変更した、などが原因です。

**対処。** 変更されないコピーからファイルを再送してください。セッションは開いたままなので、修正したファイルをそこに送信できます。ダウンロードの検証が繰り返し失敗する場合は、別の経路で再ダウンロードしてから、リクエストIDを報告してください。[ログとフィードバック](#logs-and-feedback)を参照してください。

## ビジー、レート制限、利用不可 {#retry-after}

`busy`、`unavailable`、`rate_limited`は一時的なコードです。応答には`Retry-After`ヘッダーと`retryAfterSeconds`フィールドがあります。その時間だけ待ってください。`busy`では、先行するキューと枠が空く速さから待ち時間を計算するため、キューが長いほどクライアントに長く待つよう求めます。SDKとコマンドラインクライアントは、`busy`と`rate_limited`に対し、サーバーが求める時間だけ待ち（`--wait-limit`または`waitLimitMs`で上限を設定可能）、他の応答は回数を限定して再試行します。

| 応答                              | 原因                                                                                                                      | 対処                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 503 `busy`、理由`request_limit`   | サーバーが同時に`ARKVORY_MAX_REQUESTS`件のリクエストを処理中（デフォルト128）                                             | 待つ。十分なメモリがある場合だけ上限を引き上げる。`arkvory_http_requests_in_flight`を確認                                                         |
| 503 `busy`、理由`download_queued` | 大きなオブジェクトのダウンロードがキューで待機中。`Arkvory-Queue-Position`と`Arkvory-Starts-At`が位置と開始予測時刻を示す | SDKと`arkvoryctl`は待機して継続するため操作不要。他のクライアントは、同じアドレスから同じキーで`Retry-After`の後に再試行                          |
| 503 `busy`                        | 転送キューが満杯、`ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS`（20 s）を超えて待機、または停止前のドレイン中                       | 待って再試行。頻発するなら`ARKVORY_MAX_UPLOADS`または`ARKVORY_MAX_DOWNLOADS`を引き上げる。`arkvory_transfer_admission_failures_total`が拒否を計上 |
| 503 `unavailable`                 | データベースの再起動、ストレージ所有権の喪失、ハブに接続できない（`hub_unreachable`）                                     | 待つ。サービスは自動で再起動。[自己修復](./self-healing)を参照                                                                                    |
| 429 `rate_limited`                | サインイン、登録、パスワード、フィードバックの試行が多すぎる                                                              | 待つ。[試行回数が多すぎる](#too-many-attempts)を参照                                                                                              |

500 `internal`には`Retry-After`がありません。無条件に再試行しないでください。ログでリクエストIDを検索し、報告してください。

## ディスクの満杯とクォータ {#disk-full}

| 応答、理由          | 原因                                                                                                                               | 対処                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 507 `storage_full`  | ストレージボリュームの空き容量が予備領域`ARKVORY_STORAGE_RESERVE_BYTES`（デフォルト1 GiB）未満、またはデータベースのディスクが満杯 | ボリュームの空き容量を増やす。`df -h`または`Get-PSDrive`とPostgreSQLのボリュームを確認     |
| 507 `storage_quota` | リポジトリのクォータを使い切った                                                                                                   | 古いビルドの削除、保持ポリシーの変更、または[[ui:repositoryStorage]]でクォータを引き上げる |
| 507 `catalog_limit` | 予約済みコンテンツの合計が`ARKVORY_CAPACITY_BYTES`（デフォルト10 TiB）を超える                                                     | コンテンツを削除するか、`config/runtime.json`の値を引き上げる                              |
| 507 `queue_full`    | 1アカウントに100件、またはサーバー全体に10,000件の未終了の完了ジョブがある                                                         | ワーカーが処理を完了するまで待つ                                                           |

ディスクが満杯でも、ダウンロードとコンソールは引き続き利用できます。`/health/ready`は`"writable": false`を示します。Arkvoryでアーティファクトを削除しても、ディスクはすぐには空きません。ファイルは猶予期間後の物理クリーンアップを待ちます。[ストレージ](./storage)を参照してください。データベースとログに必要な容量なので、データを詰め込むために予備領域を減らさないでください。

## バックアップが失敗する {#backups-failing}

まず[[ui:backups]]または`arkvoryctl backup status`の警告と、ログイベント`backup.request.failed`、`backup.agent.failed`の`errorCode`を確認します。[バックアップ](./backups)を参照してください。

| 警告またはメッセージ                                                                     | 原因                                                                                          | 対処                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_offline`                                                                          | バックアップサービスが停止中、または起動に失敗                                                | `arkvory-backup`または`Arkvorybackup`を起動し、ログを読む                                                                                                                                                                                   |
| `vault_unavailable`                                                                      | 保管庫のボリュームが未マウント、`vault.json`がない、またはサービスアカウントが書き込めない    | サービス起動前にボリュームをマウントし、所有者とアクセス権を確認。Windowsで後からマウントした場合はエージェントを再起動                                                                                                                     |
| `The vault directory does not exist; create it or mount its volume first`                | パスが誤っている、またはボリュームがない                                                      | ディレクトリを作成またはマウント                                                                                                                                                                                                            |
| `The vault directory is not writable`                                                    | サービスアカウントに書き込み権限がない                                                        | Linuxではユーザー`arkvory`の`uid`と`gid`で共有をマウント。WindowsではローカルまたはiSCSIボリュームを使用                                                                                                                                    |
| `The directory has no vault.json: mount the vault volume, or create the vault first ...` | ディレクトリに保管庫がない（未マウントの共有も同様）。configureは暗号化保管庫を自動作成しない | 正しいボリュームをマウントするか、`arkvory-backup vault init <dir> --kit-file <file> --agent-key-file <file>`を実行し、キットをサーバー外に保管して`--vault-key-file`を指定。`--init-vault --vault-no-encryption`は暗号化なしの保管庫を作成 |
| `The vault must be outside the installation root and the storage directory`              | 保管庫がデータと重複                                                                          | 別ボリューム上の独立したディレクトリを選ぶ                                                                                                                                                                                                  |
| `Network share paths are not supported ...`                                              | WindowsのUNCパス。`LocalService`はSMB共有にサインインできない                                 | ローカルまたはiSCSIボリュームのドライブ文字を使用                                                                                                                                                                                           |
| `The backup service cannot reach /home, /root, /run/user, /tmp or /var/tmp`              | systemdのサンドボックスがこれらのフォルダーを隠している                                       | 別のディレクトリを選ぶ                                                                                                                                                                                                                      |
| `vault_full`、`vault_low_space`                                                          | 保管庫のボリュームがほぼ満杯                                                                  | 容量を解放するか、保持ポイント数を減らす。以前のポイントは維持                                                                                                                                                                              |
| `vault_key_missing`、`vault_key_invalid`                                                 | 保管庫が暗号化され、エージェントに鍵がない、または鍵が違う                                    | エージェントの鍵を使い`arkvory configure --backup-vault DIR --vault-key-file FILE`を実行。[保管庫の暗号化](./backups#encryption)を参照                                                                                                      |
| `last_run_failed`                                                                        | 最新のバックアップが失敗                                                                      | `arkvoryctl backup jobs`で`errorCode`を読む                                                                                                                                                                                                 |
| `verify_failed`                                                                          | ポイントの検証が失敗                                                                          | 保管庫を変更しない。解析用に保持し、報告する                                                                                                                                                                                                |

`arkvory configure --backup-vault`は、エージェントが150秒以内に新しい保管庫を報告しない場合、以前の設定に戻します。更新はバックアップエージェントを停止するため、その時点で実行中のバックアップは後で再実行します。自動更新を使う場合、バックアップの時刻を更新時間帯（デフォルト03:00 UTC）から外してください。

## ミラーが同期しない {#mirror-not-syncing}

コンソールで[[ui:mirrors]]を開きます。停止したミラーには、理由、次の手順、対処コマンドがある場合はそのコマンドを表示します。同じ状態は`GET /api/v1/repositories/{repository}/mirror`と、ワーカーのイベント`mirror.step_failed`にもあります。コピー済みデータのダウンロードは引き続き利用できます。[ミラー](./mirrors)を参照してください。

| `errorCode`                     | 原因                                                           | 対処                                                                                                                                               |
| ------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mirror_unreachable`            | 接続拒否、タイムアウト、名前解決失敗などでソースが応答しない   | ネットワーク、ファイアウォール、ソースを確認。ワーカーが自動再試行                                                                                 |
| `unauthorized`または`forbidden` | ソースがキーを拒否、またはキーにリポジトリの読み取り権限がない | `arkvory configure --mirror NAME --mirror-token-file FILE`でキーを交換するか、ソース側で読み取り権限を付与。ワーカーは失敗のたびにキーを再読み込み |
| `mirror_failed`                 | より具体的なコードのない失敗                                   | ワーカーログを読む                                                                                                                                 |
| `mirror_mismatch`               | 同じIDの内容がソースで異なる                                   | コピーを保持する。アーティファクトを調査                                                                                                           |
| `mirror_source_changed`         | リポジトリがすでに別のソースのコピーを保持                     | `--mirror-detach`で切り離し、新しいリポジトリに新しいソースのミラーを作成                                                                          |
| `mirror_source_behind`          | ソースが復元または再インストールされた                         | 自動で再シードし、コードが消える                                                                                                                   |
| `mirror_certificate`            | ソースが社内・自己署名証明書を使用、または期限切れ・名前不一致 | `arkvory configure`に`--mirror-ca-file`を渡す。検証を無効にすることはない                                                                          |

他のコードと対処は[ミラーのエラーコード](./mirrors#error-codes)を参照してください。ソースにはミラー用フィードを備えたリリースが必要です。ワーカーは失敗後に2秒待ち、最大5分まで待ち時間を倍増します。追従が完了しない状態が1時間15分続くと、`ArkvoryMirrorStale`が発火します。

## 更新の失敗 {#update-failed}

1. エラーを読みます。コンソールでは[[ui:updates]]にメッセージを表示します。更新サービスのログは、Windowsでは`logs\updater.log`、Linuxでは`journalctl -u arkvory-update`で確認します。
2. `arkvory status --root <root>`でインストール済みバージョンを確認します。
3. 該当する状況を探します。

| 状況                                                               | 発生したこと                                                                     | 対処                                                                                                                               |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 同じデータベーススキーマでの通常の失敗                             | インストーラーが前のバージョンを再起動した                                       | 原因を修正して再更新                                                                                                               |
| コンソールに[[ui:updateMaintenance]]を表示                         | スキーマ変更のあるリリースには検証済みバックアップが必要なため、変更前に拒否した | 保管庫を接続し、最初のバックアップを待って再確認                                                                                   |
| マイグレーションが失敗                                             | トランザクションをロールバックし、前のバージョンが前のスキーマで稼働             | 原因を修正して再更新                                                                                                               |
| マイグレーション成功後、新バージョンが起動しない                   | ジャーナルが`maintenance-required`とバックアップポイントを示す                   | 原因を修正し、`recover`で更新を完了。または前のバージョンでそのポイントを復元                                                      |
| 更新サービスを強制終了、または停電                                 | ロック`operation.lock`とジャーナルが残る。自動継続しない                         | 下記の手順を実施                                                                                                                   |
| コンソールに[[ui:updateStale]]または[[ui:updateUnavailable]]を表示 | ホストのスケジューラーが停止中、または未接続                                     | タスク`ProAnimaArkvoryUpdate`（Windows）または`arkvory-update.timer`（Linux）を確認。`arkvory updates-connect --root <root>`で接続 |

更新サービスが中断した後は：

1. スケジューラーを停止し、更新サービスが動作していないことを確認します。`journal.json`とログを保存します。
2. その後で初めて、インストールルートの`operation.lock`ファイルを削除します。更新中は削除しないでください。
3. `recover`を実行します。

   ```bash
   sudo arkvory recover --root /opt/proanima-arkvory
   ```

   ```powershell
   & 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' recover --root C:\ProgramData\ProAnima\Arkvory
   ```

   マイグレーション開始前なら前のバージョンを復元します。開始後ならマイグレーションを再実行し、新しいバージョンを起動します。

4. `/health/ready`、完了キュー、1つのテストダウンロードを確認します。その後、スケジューラーを再び有効にします。

`arkvory updates-reset --root <root>`は、状態の整合性を確認した後に、受け付け済みの更新要求を消去します。ダウングレードはできません。[更新](../install/updates)を参照してください。

## Docker {#docker}

- **Windowsの再起動後、何も動作しない。** Docker Desktopはユーザーのサインイン時に起動します。**サインイン時にDocker Desktopを起動する（Start Docker Desktop when you sign in）**を有効にするか、ネイティブサービスを使用してください。
- **Linuxホストの再起動後、何も動作しない。** `systemctl is-enabled docker`で、エンジンがOS起動時に開始するか確認してください。
- **コンテナが`config/`のファイルを読めない。** コンテナはユーザー`node`（uid 1000）で実行します。インストーラーは`runtime.json`、`keys.json`、`health-token.txt`をそのユーザーが読めるようにします。手動編集で所有者やモードを0600に変えると、APIは`Cannot read ARKVORY_KEYS_FILE (EACCES)`で停止します。3つのファイルのモードを0644に戻してください。`config/`フォルダー自体は非公開のままにします。
- **保管庫に書き込めない。** エージェントはuid 1000で実行するため、保管庫はそのユーザーが所有する必要があります。`arkvory configure --backup-vault`が`config/compose.vault.yml`で設定します。自分でマウントする共有には`uid=1000`が必要です。手動のComposeコマンドには毎回`-f config/compose.vault.yml`を含めてください。含めないと`up`が保管庫なしのバックアップコンテナを作成します。
- **コンテナが`unhealthy`になる。** ヘルスチェックは10秒ごとに`/health/ready`を呼び出します。Dockerは状態を示すだけで、再起動しません。APIコンテナのログを読んでください。

コンテナのログを表示するには：

```bash
docker logs --tail 100 proanima-arkvory-api-1
```

## Windowsサービスが起動しない {#windows-service}

1. 状態とエラー出力を読みます。

   ```powershell
   Get-Service Arkvoryapi, Arkvoryworker, Arkvorybackup, Arkvorydatabase
   Get-Content C:\ProgramData\ProAnima\Arkvory\logs\arkvory-api.err.log -Tail 50
   ```

2. Windowsのイベントビューアーで、**Windowsログ > システム**を開き、Service Control Managerのイベントを探します。
3. 原因を探します。

| 原因                                                                         | 対処                                                                |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| ルートがユーザープロファイル内、または`LocalService`が親フォルダーを読めない | 専用フォルダーにインストール。[アクセス権](#root-permissions)を参照 |
| ポートが使用中                                                               | [ポートが使用中](#port-busy)を参照                                  |
| データベースサービスが動作していない                                         | `Arkvorydatabase`を起動。APIは10秒ごとに再試行                      |
| OS起動後、サービス開始が「遅い」                                             | スタートアップの種類は自動（遅延開始）。数分待つ                    |
| ウイルス対策ソフトがNode.jsを隔離                                            | `runtime\`内のファイルを許可                                        |
| `Another installation owns this service`                                     | 別のルートのインストールのサービスが存在。先に削除する              |
| サービスが停止したまま                                                       | ユーザーまたは更新が停止した。`Start-Service`で起動                 |

グラフィカルインストーラーを再実行すると、サービスのスタートアップの種類と回復操作を復元します。[Windows](../install/windows)を参照してください。

## ログ、リクエストID、フィードバック {#logs-and-feedback}

**ログを探す。** Linux：`journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup`。Windows：インストールルートの`logs\`。Compose：`docker logs <container>`。形式とイベントは[監視](./monitoring#logs)にあります。

**リクエストIDを探す。** すべての応答に`X-Request-Id`ヘッダーがあり、すべてのエラー本文に`requestId`があります。コンソールはメッセージの下の[[ui:requestIdLabel]]に表示し、コマンドラインクライアントはエラー行に出力します。APIとワーカーのログでこの値を検索すると、リクエストと、それが開始したジョブを確認できます。

**ログ付きでフィードバックを送る。**

1. サインインし、上部バーの[[ui:reportOpen]]を選択します。
2. 問題を説明し、リクエストIDを追加します。スクリーンショットは最大6枚追加できます。
3. 管理者の場合、[[ui:reportServerLog]]を有効にします。APIの最新ログ行（約1.5 MiB）と、アドレスや秘密情報を含まないシステム概要を添付します。
4. [[ui:reportShow]]で送信内容を正確に確認してから、[[ui:reportSend]]を選択します。

サーバーはレポートをProAnimaStudioハブに送信します。ハブに接続できない、またはフィードバックが無効な場合、コンソールは送信先のアドレス`info@proanima.net`を表示します。送信内容は[セキュリティ](./security#hub)を参照してください。

## 関連ページ {#related-pages}

- [監視](./monitoring)
- [自己修復](./self-healing)
- [セキュリティ](./security)
- [エラー](../api/errors)
- [Windows](../install/windows)
