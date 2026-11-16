---
title: 設定
description: Arkvoryの設定の保存場所、変更に使うライフサイクルコマンド、用途別の主な設定、変更の適用方法を説明します。
---

# 設定

Arkvoryには2種類の設定があります。

- **サーバー設定**は、`config/runtime.json`ファイル内の`ARKVORY_*`変数です。アドレス、制限、ストレージなどを設定します。API、ワーカー、バックアップエージェントは、起動時にこれらを読み取ります。
- **インストールポリシー**は、更新ポリシー、HTTPSのファイル、バックアップの保管庫、ミラーです。`arkvory configure`コマンドで変更します。コマンドは変更を確認し、必要なものを再起動して、サービスが起動しない場合は以前の状態を復元します。

このページでは、ファイルの場所、使用できるコマンド、主な設定の動作を説明します。既定値と範囲を含む変数の完全な一覧は、[環境変数](../reference/environment)を参照してください。

## 設定の保存場所 {#where-it-lives}

すべてインストールルートに保存します。Windowsでは`C:\ProgramData\ProAnima\Arkvory`、Linuxでは`/opt/proanima-arkvory`です。Composeのインストールでも、ホスト上の同じルートを使います。以下のパスはルートからの相対パスです。

| ファイル                                                                       | 内容                                                                                                | 変更方法                                              |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `config/runtime.json`                                                          | サーバー設定。キーは`ARKVORY_`で始まり、値はすべて文字列です。データベースのパスワードを含みます    | 手動、または`configure`                               |
| `config/keys.json`                                                             | 回復キーと準備状態確認用キーのSHA-256ハッシュ。キー自体は含みません                                 | [回復キーを置き換える](#replace-recovery-key)場合のみ |
| `config/bootstrap-token.txt`                                                   | 回復キー                                                                                            | 置き換える場合のみ                                    |
| `config/health-token.txt`                                                      | インストール用のツールが準備状態チェックに使うキー                                                  | 変更しないでください                                  |
| `config/hub.json`                                                              | ハブのアドレス、更新チャネル、統計情報の設定                                                        | `configure`                                           |
| `config/install-id`                                                            | ランダムなインストールID。統計情報が有効な場合にのみハブに送信します                                | 変更しないでください                                  |
| `config/mirrors/`                                                              | ミラーの一覧と、ワーカーがミラー元にアクセスするためのキー                                          | `configure --mirror`                                  |
| `config/webhooks/`                                                             | ワーカーが使うサブスクリプション一覧、署名用シークレット、受信側の認証局（CA）証明書                | `configure --webhook`                                 |
| `installation.json`                                                            | モード、エンジン、自動更新の設定、バージョンの固定、インストール済みのリリース                      | コマンドのみ                                          |
| `github-token.txt`                                                             | リリースのダウンロード用の任意のGitHubトークン。[更新](./updates#hub-unreachable)を参照してください | 手動                                                  |
| `config/compose.env`、`config/compose.vault.yml`、`config/compose.mirrors.yml` | Composeのみ：イメージ、保管庫のマウント、ミラーのマウント                                           | コマンドのみ                                          |

ネイティブのLinuxインストールでは、`runtime.json`と`keys.json`は`root:arkvory`でモードは`0640`、`config/`内の認証情報ファイルを読み取れるのは`root`だけです。Composeのインストールでは、コンテナーが読み取るファイルにモード`0644`を使います。[Docker Compose](./docker#owners)を参照してください。インストーラーが設定した所有者とモードを維持してください。

## ライフサイクルコマンド {#lifecycle-commands}

既存のインストールを管理するコマンドには、インストールルートを `--root` で指定します。ネイティブサービスの変更には管理者権限が必要です。Compose では、インストールルートとコンテナエンジンにアクセスできるアカウントを使います。`help` と `volume-init` の例外は以下で説明します。

| インストール                        | コマンドの実行方法                                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linuxパッケージ                     | `sudo arkvory <command> --root /opt/proanima-arkvory`                                                                                                           |
| Windows、グラフィカルインストーラー | 昇格したPowerShellで実行：`& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' <command> --root C:\ProgramData\ProAnima\Arkvory`                                  |
| スクリプトインストール、Compose     | `sudo <root>/runtime/node-v24.22.3-linux-x64/bin/node <root>/manage.mjs <command> --root <root>`。Windowsでは`runtime\node-v24.22.3-win-x64\node.exe`を使います |

`arkvory help`は特別な権限なしでコマンドを一覧表示します。このサイトの例では、短い形式`arkvory <command>`を使います。

| コマンド                                         | 用途                                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `status`                                         | インストールモード、エンジン、自動更新の設定、バージョンの固定、インストール済みのリリースを表示します                                                 |
| `configure`                                      | ポリシーを変更します。[configureコマンド](#configure-command)を参照してください                                                                        |
| `update`                                         | 新しい安定版リリースを今すぐインストールします。[更新](./updates)を参照してください                                                                    |
| `upgrade`                                        | 自分で用意したバックアップ記録を使って、データベーススキーマを変更するリリースをインストールします。[更新](./updates#manual-upgrade)を参照してください |
| `recover`                                        | 中断した更新を完了します。[更新](./updates#recover-update)を参照してください                                                                           |
| `finish-install`                                 | 中断した初回インストールを続行します                                                                                                                   |
| `updates-connect`                                | コンソールと更新タイマーを接続し、古いインストールにないサービスを登録します                                                                           |
| `updates-poll`、`updates-reset`、`changes-reset` | 更新タイマーおよび復旧時に実行します。[更新](./updates#recover-update)を参照してください                                                               |
| `volume-init`                                    | 空のディレクトリを新しいストレージボリュームとしてマークします。`--root`は不要です。[複数のボリューム](../operate/storage#volumes)を参照してください   |

同時に実行できるコマンドは1つだけです。2つ目のコマンドは`Installation is locked`で停止します。キーやパスワードをコマンドのオプションに入れず、ファイルを使ってください。

### configureコマンド {#configure-command}

1回の呼び出しで変更できる設定は1種類です。6種類を1回の呼び出しで混在させることはできません。

| 種類                 | オプション                                                                                                                                                                                                                                                                              | 効果                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTPS                | `--tls-cert FILE --tls-key FILE [--listen-host ADDRESS]`、または`--tls-off [--listen-host ADDRESS]`                                                                                                                                                                                     | 内蔵HTTPSを有効または無効にします。サービスを再起動し、準備状態を確認します。[HTTPS](./https)を参照してください                                   |
| バックアップの保管庫 | `--backup-vault DIRECTORY [--vault-key-file FILE \| --init-vault --vault-no-encryption]`、または`--backup-vault-off`                                                                                                                                                                    | 保管庫を接続または切断します。バックアップエージェントだけを再起動します。[バックアップ](../operate/backups)を参照してください                    |
| ミラー               | `--mirror REPOSITORY --mirror-upstream URL --mirror-token-file FILE [--mirror-source REPOSITORY] [--mirror-stages LIST] [--mirror-ca-file FILE]`、新しいキーには`--mirror REPOSITORY --mirror-token-file FILE`、または`--mirror-detach REPOSITORY[,REPOSITORY…]`か`--mirror-detach all` | リポジトリをミラーまたはインポート先にするか、通常のリポジトリに戻します。[ミラー](../operate/mirrors)を参照してください                          |
| Webhook              | `--webhook ID --webhook-repository REPOSITORY --webhook-url URL --webhook-secret-file FILE [--webhook-next-secret-file FILE] [--webhook-actions LIST] [--webhook-allow-private LIST] [--webhook-ca-file FILE]`、または`--webhook-detach ID`                                             | Webhookのサブスクリプションを追加、置換、削除します。サービスを再起動し、準備状態を確認します。[Webhook](../protocols/webhooks)を参照してください |
| クラスター           | `--cluster ha-2`または`ha-3` `[--cluster-resource NAME]`                                                                                                                                                                                                                                | レプリケートされたボリュームのプライマリで、クラスターモードを有効にします。[高可用性クラスター](../operate/cluster#build)を参照してください      |
| 更新                 | `--enable-updates`、`--disable-updates`、`--pin [--version X.Y.Z]`、`--unpin`、`--update-channel stable`または`beta`、`--statistics on`または`off`、`--hub-url URL`、`--hub-off`                                                                                                        | 更新ポリシーを変更します。[更新](./updates)を参照してください                                                                                     |

HTTPS、保管庫、ミラーの変更はサービスを再起動し、変更が機能しない場合は以前の設定を復元します。更新オプションは`installation.json`と`hub.json`を書き換えるだけで、再起動は行いません。ファイルパスは絶対パスです。

## 用途別の設定 {#settings-by-task}

### アドレスとポート {#address-and-port}

| 変数           | 既定値      | 意味                    |
| -------------- | ----------- | ----------------------- |
| `ARKVORY_HOST` | `127.0.0.1` | APIが待ち受けるアドレス |
| `ARKVORY_PORT` | `8080`      | TCPポート               |

既定では、サーバー上のプログラムだけが接続できます。他のコンピューターから受け付けるには、次の2つの方法から選びます。

- **内蔵HTTPS。** `arkvory configure --tls-cert … --tls-key … --listen-host 0.0.0.0`。[HTTPS](./https#built-in-tls)を参照してください。
- **別のコンピューター上のリバースプロキシ。** `ARKVORY_HOST`をプロキシ用のネットワークインターフェイスのアドレスに設定し、`ARKVORY_TRUSTED_PROXIES`にプロキシを列挙します。`runtime.json`を編集するか、`arkvory configure --tls-off --listen-host <address>`を実行してください。ファイアウォールで、このポートへの接続をプロキシに制限します。

`--listen-host`だけの指定は拒否されます。TLSファイルまたは`--tls-off`と一緒に使ってください。`--tls-off`の後は、`--listen-host 127.0.0.1`を追加してループバックに戻してください。追加しなければ、APIは設定済みのアドレスで待ち受けを続けます。

APIがTLSも信頼済みプロキシもなく、ループバック以外のアドレスで待ち受ける場合、起動時に警告`http.plaintext_exposed`を記録します。コンピューター間で平文HTTPを使ってキーを送信しないでください。

Linuxでは、サービスは非特権アカウントで実行するため、通常は1024未満のポートで待ち受けられません。コンソールへのショートカット（スタートメニュー、メニュー項目）は、引き続きポート8080を指します。ライフサイクルコマンドは`runtime.json`のアドレスとポートに従います。Composeのインストールでは、アドレスとポートは固定です。[Docker Compose](./docker#ports)を参照してください。

### 公開アドレスと転送ヘッダー {#public-address}

公開URLを指定する設定はありません。サーバーは、Git LFSやnpmの応答内のリンクなど、絶対リンクをリクエストから組み立てます。接続がTLSの場合、またはプロキシが`X-Forwarded-Proto: https`を送信する場合、スキームは`https`で、ホストは`Host`ヘッダーです。`ARKVORY_TRUSTED_PROXIES`に列挙されたプロキシは、`X-Forwarded-Host`でホストを設定することもできます。このため、プロキシは公開名を転送する必要があります。[HTTPS](./https#reverse-proxy)を参照してください。

`ARKVORY_TRUSTED_PROXIES`には、最大32個のアドレスまたはCIDR範囲をカンマで区切って指定できます。`X-Forwarded-For`でクライアントのアドレスを、`X-Request-Id`でリクエストIDを設定できるのは、これらの接続元だけです。この一覧がない場合、すべてのクライアントがプロキシのアドレスから接続しているように見え、サインインの制限では1つとして数えます。

### 別のアドレスで動作するブラウザー {#browsers}

`ARKVORY_CORS_ORIGINS`には、別のアドレスで動作するコンソールや他のWebアプリケーションのオリジンを、カンマで区切って最大16個列挙できます。各オリジンにはスキーム、ホスト、任意のポートがあり、パスは含めません。HTTPSが必要です。平文HTTPを受け付けるのは`localhost`、`127.0.0.1`、`[::1]`だけです。[HTTPS](./https#console-api-address)を参照してください。`ARKVORY_ALLOW_REGISTRATION=true`にすると、サインインページで各自がアカウントを作成できます。既定では無効です。

### データベース {#database}

| 変数                         | 既定値               | 意味                                                                                                     |
| ---------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------- |
| `ARKVORY_DATABASE_URL`       | インストーラーが設定 | PostgreSQLの接続URL。管理対象のデータベースは、インストール時に選択したポートの`127.0.0.1`で待ち受けます |
| `ARKVORY_DATABASE_POOL_SIZE` | `20`                 | APIのクエリ用接続プールのサイズ。4～200                                                                  |

インストールの接続先を別のデータベースに変更しないでください。保存されたファイルとカタログは一体です。新しいデータベースへの移行は、バックアップからの復元として行います。[バックアップ](../operate/backups)を参照してください。

外部のPostgreSQLでは、すべてのプロセスの接続プールの上限を合計して、`max_connections`を設定してください。各読み取りゲートウェイを含む各APIプロセスには、3つの独立したプールがあります。クエリ用は最大`ARKVORY_DATABASE_POOL_SIZE`接続（既定値20）、長時間のセッション用は8接続、アップロードの書き込みロック用は最大`ARKVORY_MAX_UPLOADS`接続（既定値8）です。ワーカーの独立したプールは、クエリ用が5接続、セッション用が8接続、書き込みロック用が`2 + min(N, 16)`接続です。Nは設定済みミラーの数です。バックアップエージェントは独自の6接続のプールを持ち、バックアップの取得中は別の6接続のプールも開きます。これらは上限であり、常時使用する接続数ではありません。ライセンスツール、保守、データベース管理のための余裕も確保してください。

### ストレージディレクトリと空き容量 {#storage}

| 変数                            | 既定値        | 意味                                                                                               |
| ------------------------------- | ------------- | -------------------------------------------------------------------------------------------------- |
| `ARKVORY_DATA_DIR`              | `<root>/data` | ファイルの内容を保存する場所。インストーラーが設定します。ローカルディスクを使ってください         |
| `ARKVORY_CAPACITY_BYTES`        | 10 TiB        | 予約されたすべてのコンテンツが使用できる最大容量。予約の制限であり、ディスクの実測値ではありません |
| `ARKVORY_STORAGE_RESERVE_BYTES` | 1 GiB         | アップロードが使わずに残す空き容量。`0`でこの確保を無効にします                                    |
| `ARKVORY_MAX_OBJECT_BYTES`      | 約10 TiB      | 単一オブジェクトの最大サイズ。ファイルサイズを制限するには、より小さい値を設定します               |

`ARKVORY_DATA_DIR`はインストーラーが配置した場所のままにしてください。Linuxのユニットが書き込めるのは、ルート内の`data/`、`logs/`、`updates/inbox/`だけなので、他のパスは読み取り専用になります。より大きなディスクを使うには、サービスを停止し、内容を新しいディスクにコピーし、所有者を`arkvory`にして`data/`にディスクをマウントし、サービスを起動します。WindowsでもLinuxでも、スクリプトでインストールする際にルート自体を選択できます（`-Root`、`ARKVORY_INSTALL_ROOT`）。[ストレージ](../operate/storage)を参照してください。

### 転送の制限 {#limits}

制限はAPIプロセス1つに適用します。転送速度の`0`は無制限を意味します。

| 変数                                  | 既定値                          | 意味                                                                                                    |
| ------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `ARKVORY_MAX_UPLOADS`                 | `8`                             | 同時アップロード数。1～32                                                                               |
| `ARKVORY_MAX_DOWNLOADS`               | `16`                            | 同時ダウンロード数。1～256                                                                              |
| `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`   | `min(4, ARKVORY_MAX_UPLOADS)`   | 1つのアカウントまたはキーの同時アップロード数                                                           |
| `ARKVORY_MAX_DOWNLOADS_PER_PRINCIPAL` | `min(4, ARKVORY_MAX_DOWNLOADS)` | 1つのアカウントまたはキーの同時ダウンロード数                                                           |
| `ARKVORY_DOWNLOAD_STRATEGY`           | `ordered`                       | ダウンロードキューの順序：`ordered`（クラスと順番）、`smallest-first`、`shared`（従来どおりキューなし） |
| `ARKVORY_UPLOAD_BYTES_PER_SECOND`     | `0`                             | 合計アップロード速度。単位はバイト/秒                                                                   |
| `ARKVORY_DOWNLOAD_BYTES_PER_SECOND`   | `0`                             | 合計ダウンロード速度。単位はバイト/秒                                                                   |
| `ARKVORY_UPLOAD_DEADLINE_MS`          | `1800000`                       | アップロードリクエスト1件の最長時間。30分                                                               |
| `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`      | `30000`                         | この時間、データを送信しないアップロードリクエストを停止します                                          |

APIの手前のプロキシは、少なくとも`ARKVORY_UPLOAD_DEADLINE_MS`と同じ長さのリクエストを許可する必要があります。[HTTPS](./https#reverse-proxy)を参照してください。待機キューやアカウントごとの速度など、その他の制限は[環境変数](../reference/environment#transfers-and-bandwidth)に記載しています。

ダウンロードキューの値（方式、同時ダウンロード数、予約枠、重みなど）は、再起動せずに変更することもできます：[[ui:fleet]] → [[ui:fleetThisSettings]]、または`PUT /api/v1/system/downloads/settings`。書き込み側では、保存済みの値がこれらの変数より優先します。[サイト](../operate/sites#site-settings)を参照してください。

### バックアップとミラー {#backups-mirrors}

どちらにも`configure`を使います。`--backup-vault`は`ARKVORY_BACKUP_VAULT`を書き込み、サービスアカウントにディレクトリへのアクセスを許可し、バックアップエージェントだけを再起動します。エージェントが保管庫を利用可能と報告した場合にのみ変更を保持します。保管庫はインストールルートとストレージの外に置く必要があります。`--mirror`は`ARKVORY_MIRRORS_FILE`とキーファイルを書き込み、APIとワーカーを再起動します。変更前に、指定したキーでミラー元を確認します。

### 更新とハブ {#updates-and-hub}

更新ポリシーは`installation.json`と`config/hub.json`に保存します。オプションは[configureコマンド](#configure-command)、その意味は[更新](./updates)を参照してください。`runtime.json`の`ARKVORY_HUB_URL`は別の設定で、コンソールがフィードバックを送信する先を指定します。`configure --hub-url`または`--hub-off`は両方を変更し、フィードバックのアドレスは次回のサービス再起動後に反映されます。

### ログと終了処理 {#logs-and-shutdown}

| 変数                       | 既定値  | 意味                                                                                              |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `ARKVORY_LOG_LEVEL`        | `info`  | `debug`、`info`、`warning`、`error`。`warning`と`error`のレベルではアクセスログも非表示になります |
| `ARKVORY_ACCESS_LOG`       | `true`  | HTTPリクエストごとに1件のJSONレコード。クエリ文字列は書き込みません                               |
| `ARKVORY_DRAIN_TIMEOUT_MS` | `30000` | 停止要求の後、実行中のリクエストが完了するまで待つ時間                                            |

監視プログラムは、サービスの停止に120秒の猶予を与えます。ドレイン時間を約90秒より長く設定する場合は、サービスマネージャーの停止タイムアウトも延ばしてください。systemdユニットの`TimeoutStopSec`、Windowsサービスの停止タイムアウト、Composeの`stop_grace_period`です。[監視](../operate/monitoring)を参照してください。

## 変更を適用する {#apply-change}

`configure`は自身の変更を適用します。`config/runtime.json`を編集する場合は、次の手順を行います。

1. ファイルのコピーを作成します。例：`sudo cp -p /opt/proanima-arkvory/config/runtime.json /root/runtime.json.bak`。データベースのパスワードを含むため、コピーは非公開にしてください。
2. ファイルをその場で編集します。有効なJSONを維持し、すべての値を文字列にします。
3. 所有者とモードを確認します。Linuxでは`root:arkvory`と`0640`を維持する必要があります。`sudo chown root:arkvory runtime.json`と`sudo chmod 0640 runtime.json`で修正できます。
4. サービスを再起動します。設定は起動時にのみ読み取ります。

   ```bash
   sudo systemctl restart arkvory-api arkvory-worker arkvory-backup
   ```

   ```powershell
   Restart-Service Arkvoryapi, Arkvoryworker, Arkvorybackup
   ```

   Composeのインストールでは、[Docker Compose](./docker#manage)の`compose`コマンドでコンテナーを停止して起動します。

   ```bash
   "${compose[@]}" stop --timeout 120 backup worker api
   "${compose[@]}" up -d --wait api worker
   "${compose[@]}" up -d backup
   ```

5. 結果を確認します。範囲外の値があると、プロセスは起動時に停止し、変数名を示すメッセージを出します。値は表示しません。Linuxでは`journalctl -u arkvory-api -n 50`で読めます。この場合、Arkvoryは既定値に戻しません。

再起動は実行中の転送を中断します。クライアントが転送を再開します。

## 回復キーを置き換える {#replace-recovery-key}

誰かが`config/bootstrap-token.txt`を読み取った疑いがある場合は、回復キーを置き換えてください。キーは2か所に保存されており、両方を一緒に変更する必要があります。`bootstrap-token.txt`ファイルにキー自体があり、`keys.json`の`bootstrap-owner`エントリにそのSHA-256があります。`deployment-health`エントリはそのままにしてください。

1. `config/keys.json`のコピーを作成します。
2. 次のスクリプトを`replace-recovery-key.mjs`として保存します。

   ```js
   import { createHash, randomBytes } from 'node:crypto';
   import { readFileSync, writeFileSync } from 'node:fs';

   const directory = process.argv[2];
   const token = randomBytes(32).toString('hex');
   const keys = JSON.parse(readFileSync(`${directory}/keys.json`, 'utf8'));
   const owner = keys.find((key) => key.id === 'bootstrap-owner');
   if (!owner) throw new Error('No bootstrap-owner entry');
   owner.sha256 = createHash('sha256').update(token).digest('hex');
   writeFileSync(`${directory}/keys.json`, JSON.stringify(keys, null, 2));
   writeFileSync(`${directory}/bootstrap-token.txt`, token);
   ```

3. インストールのNode.jsを使い、`root`またはAdministratorとして実行します。スクリプトは既存のファイルに書き込むため、所有者とアクセス規則はそのままです。

   ```bash
   sudo /opt/proanima-arkvory/runtime/node ./replace-recovery-key.mjs /opt/proanima-arkvory/config
   ```

   ```powershell
   & 'C:\ProgramData\ProAnima\Arkvory\runtime\node.exe' .\replace-recovery-key.mjs 'C:\ProgramData\ProAnima\Arkvory\config'
   ```

   スクリプトでインストールした場合は、代わりに`runtime\node-v24.22.3-…`の下にあるNode.jsを使います。

4. [変更を適用する](#apply-change)の手順でサービスを再起動します。
5. `config/bootstrap-token.txt`から新しいキーを読み取り、スクリプトと`keys.json`のコピーを削除します。

アカウント、個人用トークン、サービスキーには影響しません。これらはデータベースに保存されています。
