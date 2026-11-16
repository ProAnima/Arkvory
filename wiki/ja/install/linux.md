---
title: Linux
description: .debまたは.rpmパッケージからLinuxにArkvoryをインストールし、起動、systemdサービスの操作、更新、削除を行います。
---

# Linux

LinuxでArkvoryを実行する方法は2つあります。

- **パッケージ** `Arkvory-amd64.deb`または`Arkvory-x86_64.rpm`。推奨の方法です。systemdサービスと、Arkvoryが管理する専用のPostgreSQLクラスターをインストールします。PostgreSQLのプログラムはパッケージマネージャーが提供します。
- **スクリプト** `install.sh`。同じサービスをインストールしますが、既存のPostgreSQLサーバーを使います。arm64にも対応しています。[既存のPostgreSQLを使う](#existing-postgresql)を参照してください。

Dockerについては[Docker Compose](./docker)を参照してください。コンソールを初めて使う場合は、[クイックスタート](../guide/quick-start)を参照してください。

## 要件 {#requirements}

| 項目                             | 要件                                                                                                                                                                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| プロセッサ                       | パッケージはx64用です。arm64パッケージはありません。arm64では`install.sh`を使ってください                                                                                                                                                                                                     |
| initシステム                     | systemd。OpenRC、runitなど、他のinitシステムには対応していません                                                                                                                                                                                                                              |
| Cライブラリ                      | glibc 2.28以降。Alpine Linux（musl）には対応していません                                                                                                                                                                                                                                      |
| 検証済みのディストリビューション | `.deb`はUbuntu 24.04、`.rpm`はFedora 44で検証しています。以下の依存関係を満たす他のsystemdディストリビューションは未検証です                                                                                                                                                                  |
| `.deb`の依存関係                 | `postgresql` 16以降、`systemd`、`python3`、`ca-certificates`、`libc6` 2.28以降、`libstdc++6`、`libgcc-s1`、`libatomic1`                                                                                                                                                                       |
| `.rpm`の依存関係                 | `postgresql-server` 16以降、`systemd`、`python3`、`ca-certificates`、`glibc` 2.28以降、`libstdc++`、`libatomic`                                                                                                                                                                               |
| PostgreSQLのプログラム           | バージョン16～19。インストール時に`/usr/lib/postgresql/*/bin`、`/usr/pgsql-*/bin`、`/usr/bin`、`/usr/lib/pgsql/bin`を検索し、見つかった中で最も新しいバージョンを使います。ディストリビューションが古いバージョンしか提供していない場合は、先に新しいPostgreSQLのリポジトリを追加してください |
| アカウント                       | `root`、または`sudo`を実行できるユーザー                                                                                                                                                                                                                                                      |
| 空いているポート                 | `127.0.0.1`上の8080と、54329または45329～45348のいずれか                                                                                                                                                                                                                                      |
| ファイルストレージ               | ハードリンクをサポートするローカルファイルシステム。ネットワーク共有は使わないでください                                                                                                                                                                                                      |

パッケージにはNode.js 24が含まれています。インストール時のインターネットアクセスは、パッケージマネージャーが依存関係の取得に使うものだけです。

パッケージが既存のPostgreSQLクラスターやサービスを変更することはありません。ArkvoryはPostgreSQLのプログラムを使って、自身のクラスターを起動します。

## パッケージをインストールする {#install-package}

1. [GitHub Releases](https://github.com/ProAnima/Arkvory/releases)から、ディストリビューションに合ったパッケージと、同じリリースの`native-linux.json`をダウンロードします。
2. パッケージのSHA-256を`native-linux.json`の値と比較します。パッケージには発行元のキーによる署名がないため、この確認がダウンロードした内容を確かめる唯一の手段です。
3. パッケージをインストールします。ファイル名の前の`./`は残してください。ローカルファイルであることをパッケージマネージャーに伝えます。DebianとUbuntuでは次を実行します。

```bash
sudo apt install ./Arkvory-amd64.deb
```

FedoraとRPM互換システムでは次を実行します。

```bash
sudo dnf install ./Arkvory-x86_64.rpm
```

パッケージマネージャーが依存関係をインストールした後、Arkvoryが自身を設定します。次の処理を行います。

1. Node.jsを`/opt/proanima-arkvory/runtime/node`にコピーします。
2. 2つのサービスアカウント、設定、キー、回復キーを作成します。
3. PostgreSQLクラスターを作成して起動し、データベースのマイグレーションを実行します。
4. サービスと更新タイマーを登録し、起動します。
5. APIの準備状態チェックが3回連続で成功するまで待ちます。

最後に、コンソールのアドレスと回復キーのパスを表示します。いずれかの手順に失敗すると、エラーでインストールを停止します。[トラブルシューティング](#troubleshooting)を参照してください。

インストール直後の自動更新は無効です。有効にするには、[更新](./updates)を参照してください。

## パッケージが作成するもの {#what-package-creates}

### ファイルとディレクトリ {#files}

| パス                                                            | 内容                                                                                                                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/usr/lib/proanima-arkvory/`                                    | パッケージの内容：Node.js、リリースファイル、インストーラー。パッケージが管理します                                                                       |
| `/usr/bin/arkvory`                                              | 管理コマンド。[arkvoryコマンド](#arkvory-command)を参照してください                                                                                       |
| `/usr/share/applications/arkvory.desktop`                       | デスクトップでコンソールを開くメニュー項目。デスクトップのないサーバーでは使いません                                                                      |
| `/opt/proanima-arkvory/`                                        | インストールルート：設定、データ、データベース、各バージョンのプログラムコード。構成は[インストール方法を選ぶ](./#installation-directory)に記載しています |
| `/etc/systemd/system/arkvory-*.service`、`arkvory-update.timer` | サービスユニットと更新タイマー                                                                                                                            |

ルートの所有者とグループは`root:arkvory`、モードは`0711`です。その中の`config/`は`0750 root:arkvory`、`data/`と`logs/`は`arkvory`が所有し、`database/`は`arkvory-db`が所有してモードは`0700`です。回復キーとデータベースのパスワードファイルを読み取れるのは`root`だけです。

### アカウント {#accounts}

| アカウント   | 実行するもの                            | 備考                                                                                          |
| ------------ | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `arkvory`    | API、ワーカー、バックアップエージェント | システムアカウント。ログインシェルなし。ホームは`/opt/proanima-arkvory/data`                  |
| `arkvory-db` | データベース                            | システムアカウント。ログインシェルなし。APIのアカウントはデータベースファイルを読み取れません |

### サービス {#services}

| ユニット               | 実行アカウント                             | 再起動ポリシー                                     |
| ---------------------- | ------------------------------------------ | -------------------------------------------------- |
| `arkvory-database`     | `arkvory-db`                               | `on-failure`、10秒後                               |
| `arkvory-api`          | `arkvory`                                  | `always`、10秒後                                   |
| `arkvory-worker`       | `arkvory`                                  | `always`、10秒後                                   |
| `arkvory-backup`       | `arkvory`                                  | `always`、10秒後                                   |
| `arkvory-update.timer` | `root`として`arkvory-update.service`を起動 | 毎分。ジョブが更新リクエストとリリースを確認します |

すべてのユニットは起動時（`multi-user.target`）に開始します。停止の猶予は120秒です。`NoNewPrivileges`、専用の`/tmp`、自身のディレクトリ以外は読み取り専用のファイルシステムという制限で実行され、`/home`にはアクセスできません。APIとワーカーが書き込めるのは、ルート内の`data/`、`logs/`、`updates/inbox/`だけです。バックアップエージェントはストレージを読み取り、バックアップの保管庫にだけ書き込みます。ユニットから`/home`は見えないため、証明書、保管庫、データディレクトリをホームディレクトリの下に置かないでください。

停止を要求していないサービスが停止すると、10秒後に再起動します。メインスレッドが60秒間応答しないプロセスは、自身を終了して再起動します。準備状態チェックの失敗だけでは、サービスは再起動しません。[自己修復](../operate/self-healing)を参照してください。

### ポート {#ports}

| ポート    | 用途                           | 公開範囲                                                                                                                                       |
| --------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 8080/TCP  | APIとコンソール                | [HTTPS](./https)を設定するまでは`127.0.0.1`のみ                                                                                                |
| 54329/TCP | 管理対象のPostgreSQLクラスター | `127.0.0.1`のみ。インストール時に54329が使用中なら、45329～45348のうち最初に空いているポートを使います。`database/settings.json`に保存されます |

## 初回起動と初期セットアップ {#first-start}

1. サービスが実行されていることを確認します。

   ```bash
   systemctl status arkvory-database arkvory-api arkvory-worker arkvory-backup
   ```

2. 回復キーを読み取ります。読み取れるのは`root`だけです。

   ```bash
   sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
   ```

3. `http://127.0.0.1:8080/console/#onboarding`を開きます。リモートサーバーの場合は、先にポートを転送し、自分のコンピューターでこのアドレスを開きます。

   ```bash
   ssh -L 8080:127.0.0.1:8080 admin@arkvory.example
   ```

4. コンソールで[[ui:navStart]]を開き、[[ui:welcomeOwner]]を展開します。[[ui:welcomeRecovery]]にキーを貼り付け、所有者名と12文字以上のパスワードを入力して、[[ui:welcomeCreate]]を選びます。名前は3～64文字で、ラテン文字、数字、ピリオド、ハイフン、アンダースコアを使えます。
5. 新しい名前とパスワードでサインインします。

所有者は最初の管理者です。回復キーはサーバーに残してください。ファイルを削除したり、クライアントやCIシステムにコピーしたりしないでください。インストール用のツールが読み取ります。日常の作業にはアカウントとサービスキーを作成します。[アカウントとアクセス](../use/accounts)と[セキュリティ](../operate/security)を参照してください。

他のコンピューターからクライアントが接続する前に、[HTTPS](./https)を設定します。その後、バックアップの保管庫を接続し、最初のバックアップを実行します。[バックアップ](../operate/backups)を参照してください。

自分のコンピューターからサーバーにインストールするには、Arkvory Remote Setupも使えます。[インストール方法を選ぶ](./#remote-installation-over-ssh)を参照してください。

## arkvoryコマンド {#arkvory-command}

パッケージは`/usr/bin/arkvory`をインストールします。`arkvory help`はすべてのコマンドを一覧表示し、特別な権限を必要としません。それ以外のコマンドには、`root`とインストールルートの指定が必要です。

```bash
sudo arkvory status --root /opt/proanima-arkvory
```

`status`は、インストールモード、インストール済みのバージョン、自動更新の設定、バージョンの固定を表示します。

| コマンド          | 用途                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `status`          | インストール済みのバージョンと更新ポリシーを表示します                                                         |
| `update`          | 新しい安定版リリースを今すぐインストールします。[更新](./updates)を参照してください                            |
| `configure`       | HTTPS、バックアップの保管庫、ミラー、更新ポリシー、ハブを設定します。[設定](./configuration)を参照してください |
| `recover`         | 中断した更新を完了します。[更新](./updates#recover-update)を参照してください                                   |
| `finish-install`  | 中断したインストールを続行します                                                                               |
| `updates-connect` | 古いリリースから更新したインストールのコンソールと更新タイマーを接続します                                     |

## ログ {#logs}

サービスはシステムジャーナルに書き込みます。APIとワーカーは、1行に1件のJSONレコードを書き込みます。

```bash
sudo journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup -u arkvory-database
sudo journalctl -u arkvory-api -f
sudo journalctl -u arkvory-update --since today
```

`arkvory-update`には更新タイマーの出力が記録されます。ジャーナルのサイズと保持期間は、オペレーティングシステムの設定です。レコードのフィールドとメトリクスについては、[監視](../operate/monitoring)を参照してください。デプロイコマンドは`<ISO-8601 time> INFO|WARN|ERROR <text>`形式の行を出力します。秘密情報は取り除かれます。

## 更新する {#upgrade}

新しいパッケージを古いパッケージに上書きしてインストールするか、コンソールまたは`arkvory update`で更新します。実行中のサービスは、更新が新しいコードに切り替わるまでリクエストへの応答を続けます。ポリシー、データベーススキーマ変更前のバックアップ、復旧手順については、[更新](./updates)を参照してください。

Arkvory用のaptやdnfのリポジトリはありません。新しいパッケージは毎回リリースページからダウンロードしてください。

## 削除する {#remove}

### データを残してパッケージを削除する {#remove-package}

DebianとUbuntuでは次を実行します。

```bash
sudo apt remove proanima-arkvory
```

FedoraとRPM互換システムでは次を実行します。

```bash
sudo dnf remove proanima-arkvory
```

削除すると、サービスと更新タイマーを停止して無効にします。`/usr/lib/proanima-arkvory`、`/usr/bin/arkvory`、メニュー項目を削除します。次のものは意図的に**残します**。

- `/opt/proanima-arkvory`：データベース、すべてのファイル、設定、回復キー。
- `/etc/systemd/system`内のユニットファイルと、`arkvory`、`arkvory-db`アカウント。
- バックアップの保管庫と、そのsystemdドロップイン。保管庫には一切手を加えません。

`apt purge`でも、`apt remove`より多くは削除しません。パッケージを再インストールすると、残されたデータを使って続行し、サービスを起動します。

### すべて削除する {#remove-all}

この操作は、保存されているすべてのファイルとカタログを削除します。先にバックアップを作成し、保管庫は残してください。

```bash
sudo systemctl disable --now arkvory-update.timer arkvory-backup arkvory-worker arkvory-api arkvory-database
sudo rm -rf /opt/proanima-arkvory
sudo rm -f /etc/systemd/system/arkvory-*.service /etc/systemd/system/arkvory-update.timer
sudo rm -rf /etc/systemd/system/arkvory-backup.service.d
sudo systemctl daemon-reload
sudo userdel arkvory
sudo userdel arkvory-db
```

先に、上記の手順でパッケージを削除してください。スクリプトでインストールした場合はパッケージがありません。最初のコマンドでサービスを停止し、`arkvory-database`と`arkvory-db`を指定するコマンドは、それらが存在しないと報告します。

## 既存のPostgreSQLを使う {#existing-postgresql}

パッケージは必ず自身のクラスターを作成します。組織が運用するPostgreSQLサーバーを使うには、`install.sh`でインストールしてください。同じ3つのサービスと更新タイマーを作成しますが、`arkvory-database`ユニットと`/usr/bin/arkvory`コマンドは作成しません。

PostgreSQLのバージョン16～19を使ってください。Arkvoryの1つのインストールに1つのデータベースを使います。2つのインストールを同じデータベースに接続しないでください。

1. データベース管理者に、空のデータベースと、それを所有するロールを用意してもらいます。Arkvoryはそのロールでマイグレーションを実行します。
2. リリースから`install.sh`をダウンロードして内容を読みます。`bash`、`curl`、`python3`、`tar`、`xz`、systemd、`root`が必要です。
3. 実行します。スクリプトが接続URLを尋ねます。入力内容は表示されません。

   ```bash
   sudo bash ./install.sh --automatic
   ```

   代わりにファイルでURLを渡すには、`root`だけが読み取れるファイルを作成します。

   ```json
   { "ARKVORY_DATABASE_URL": "postgresql://arkvory:<password>@db.example:5432/arkvory" }
   ```

   ```bash
   sudo bash ./install.sh --config /root/arkvory.json
   ```

4. インストールが完了したら、一時作業ディレクトリ`/opt/proanima-arkvory/bootstrap.*`を削除します。プロンプトでURLを入力した場合、このディレクトリの`native.json`に保存されています。
5. [初回起動と初期セットアップ](#first-start)の手順で所有者を作成します。

スクリプトは`nodejs.org`からNode.js 24.22.3をダウンロードし、SHA-256を確認して、最新の安定版リリースをインストールします。自動更新を無効のままにするには、`--automatic`を省いてください。環境変数で既定値を変更できます。

| 変数                      | 意味                                                                          | 既定値                  |
| ------------------------- | ----------------------------------------------------------------------------- | ----------------------- |
| `ARKVORY_INSTALL_ROOT`    | インストールルート。`/home`の外にある、専用の空のディレクトリを使ってください | `/opt/proanima-arkvory` |
| `ARKVORY_RELEASE_VERSION` | 最新版の代わりに、指定した安定版バージョンをインストールします                | 最新の安定版            |
| `ARKVORY_ARTIFACT_DIR`    | GitHubの代わりに、展開した`Arkvory-Linux.tar.gz`からインストールします        | 未設定                  |

`sudo env`で渡します。例：`sudo env ARKVORY_INSTALL_ROOT=/srv/arkvory bash ./install.sh`。

`arkvory`コマンドがない場合は、スクリプトがインストールしたNode.jsで管理プログラムを呼び出します。arm64では`linux-arm64`を使ってください。

```bash
root=/opt/proanima-arkvory
sudo "$root/runtime/node-v24.22.3-linux-x64/bin/node" "$root/manage.mjs" status --root "$root"
```

PostgreSQLサーバーのバックアップと保守は自身で行います。Arkvoryのバックアップエージェントは、接続URLを使ってデータベースの内容を保管庫にコピーします。[バックアップ](../operate/backups)を参照してください。

## トラブルシューティング {#troubleshooting}

| 問題                                                               | 対処                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PostgreSQL 16–19 server binaries are required`                    | PostgreSQLのプログラムがないか、古すぎます。バージョン16～19のPostgreSQLサーバーをインストールしてから、パッケージを再インストールしてください                                                                                                                                                                                                                             |
| `Use a dedicated empty installation directory`                     | 初回インストールが`installation.json`を保存する前に停止し、`/opt/proanima-arkvory`にファイルが残っています。インストーラーは設定を上書きしません。ジャーナルとパッケージマネージャーの出力を読み、原因を修正してください。まだデータのないディレクトリは別の場所に移動して、再インストールできます。データのあるインストールの`config/`や`database/`を削除しないでください |
| `Installation is locked`                                           | 操作が実行中か、異常終了しました。更新タイマーを停止し、ルート内の`journal.json`を読み、状態が分かるまで`operation.lock`を削除しないでください。[更新](./updates#recover-update)を参照してください                                                                                                                                                                         |
| `database/bootstrap-started`はあるが、`database/initialized`がない | データベースの作成が中断しました。クラスターを削除したり、手動でSQLを再実行したりしないでください。原因を修正し、`sudo arkvory finish-install --root /opt/proanima-arkvory`を実行してください                                                                                                                                                                              |
| サービスが起動しない                                               | `journalctl -u arkvory-api -n 100`で確認します。起動に失敗すると、設定名を示す`reason`を含んだJSONレコードを1件出力します。設定値は出力しません                                                                                                                                                                                                                            |
| ポート8080が使用中                                                 | 別のプログラムが使っています。ポートを空けるか、`config/runtime.json`で`ARKVORY_PORT`を設定してください。[設定](./configuration#address-and-port)を参照してください。データベースのポートはインストール時に選択したもの（54329または45329～45348）で、自動では変わりません                                                                                                 |

インストールが`installation.json`を書き込んだ後に停止した場合は、パッケージの設定手順も再実行できます。DebianとUbuntuでは`sudo dpkg --configure -a`、RPMシステムでは同じパッケージを再インストールします。

その他のヒントは[トラブルシューティング](../operate/troubleshooting)を参照してください。
