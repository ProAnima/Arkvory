---
title: Docker Compose
description: Docker ComposeプロジェクトとしてArkvoryを実行し、コンテナー、ボリューム、ポート、更新、バックアップエージェント、削除を管理します。
---

# Docker Compose

Composeのインストールでは、API、ワーカー、バックアップエージェント、PostgreSQLを1台のホスト上のコンテナーとして実行します。インストーラーはリリースからArkvoryのイメージをビルドし、`proanima-arkvory`プロジェクトを起動します。コンテナーホストで使ってください。WindowsのDocker Desktopは評価専用です。[WindowsでDocker Desktopを使う](#docker-desktop)を参照してください。

Composeには内蔵HTTPSがありません。他のコンピューターからクライアントが接続する前に、手前にリバースプロキシを配置してください。[HTTPSとリバースプロキシ](./https)を参照してください。

## 要件 {#requirements}

| 項目             | 要件                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| エンジン         | Composeプラグイン（`docker compose`）を備えたDocker Engine。互換性のあるcomposeプロバイダーを備えたPodmanは`--engine podman`で使えますが、未検証です                                |
| アカウント       | `root`、または`docker`グループのユーザー                                                                                                                                            |
| 起動時の開始     | コンテナーエンジンがOSの起動時に開始する必要があります。そうでなければ、再起動後にArkvoryが復帰しません。`systemctl is-enabled docker`で確認してください                            |
| ホスト           | コンテナーホスト1台につきArkvoryを1つインストールできます。プロジェクト名とポートは固定です                                                                                         |
| 空いているポート | `127.0.0.1`上の8080                                                                                                                                                                 |
| コンテナー       | Linuxコンテナーのみ。Windowsコンテナーには対応していません                                                                                                                          |
| インターネット   | `nodejs.org`（インストーラーがNode.js 24.22.3をダウンロードし、SHA-256を確認します）、更新ハブまたはGitHub（リリース）、Docker Hub（`node:24.22.3-bookworm-slim`と`postgres:18.7`） |

インストーラーは、コンテナーエンジン、ハイパーバイザー、WSLをインストールしたり変更したりしません。

## バンドル {#bundle}

インストーラーは、検証済みのリリースをインストールルート内の`releases/<version>/`に展開します。Composeファイルは`releases/<version>/deploy/compose.yml`、ビルドファイルは`releases/<version>/deploy/Dockerfile`です。イメージ`proanima-arkvory:<version>`は、ホスト上で`node:24.22.3-bookworm-slim`を基にビルドします。Arkvoryのレジストリから取得するものはありません。

Linuxのインストールルートは`/opt/proanima-arkvory`です。構成は[インストール方法を選ぶ](./#installation-directory)に記載しています。Composeのインストールでは、データは`data/`ではなく、以下のボリュームに保存します。

## コンテナー {#containers}

| サービス      | イメージ                     | 役割                                                                                                   |
| ------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| `database`    | `postgres:18.7`              | PostgreSQL。5秒ごとに`pg_isready`で準備状態を報告します                                                |
| `api`         | `proanima-arkvory:<version>` | HTTP APIとコンソール。`127.0.0.1:8080`で公開します。ヘルスチェックは10秒ごとです                       |
| `worker`      | `proanima-arkvory:<version>` | アップロードを完了し、バックグラウンドジョブを実行します。APIが正常になった後に起動します              |
| `backup`      | `proanima-arkvory:<version>` | バックアップエージェント。ストレージボリュームを読み取り専用で読みます。ポートは公開しません           |
| `initialize`  | `proanima-arkvory:<version>` | rootとして1回実行し、ストレージボリュームの所有者をユーザー1000にします                                |
| `migrate`     | `proanima-arkvory:<version>` | 1回実行し、データベースのマイグレーションを行います                                                    |
| `vault-owner` | `proanima-arkvory:<version>` | `maintenance`プロファイルでのみrootとして1回実行し、バックアップの保管庫の所有者をユーザー1000にします |

常駐サービスは、自分で停止しない限り再起動します。Arkvoryのコンテナーは、イメージの`node`ユーザー（ユーザー1000）で実行します。ルートファイルシステムは読み取り専用で、メモリ上に64 MiBの`/tmp`を持ち、すべてのケーパビリティを削除し、`no-new-privileges`を設定し、停止の猶予は120秒です。Dockerはコンテナーごとに、20 MiBのJSONログファイルを最大5つ保持します。

## ボリュームとバインドマウント {#volumes}

### Dockerボリューム {#docker-volumes}

| ボリューム                 | マウント先                          | 内容                                                                                                   |
| -------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `proanima-arkvory_storage` | `/var/lib/arkvory`                  | ファイルの内容とアップロードのステージング領域。バックアップエージェントは読み取り専用でマウントします |
| `proanima-arkvory_catalog` | `database`内の`/var/lib/postgresql` | PostgreSQLのデータ                                                                                     |

ボリュームは更新や`docker compose down`の後も残ります。削除するのは`down --volumes`だけです。

### インストールルートからのバインドマウント {#bind-mounts}

| ホスト上のパス            | コンテナー内                    | モード       | マウントするサービス                                  |
| ------------------------- | ------------------------------- | ------------ | ----------------------------------------------------- |
| `config/runtime.json`     | `/run/arkvory/runtime.json`     | 読み取り専用 | api、worker、backup                                   |
| `config/keys.json`        | `/run/arkvory/keys.json`        | 読み取り専用 | api、worker                                           |
| `config/health-token.txt` | `/run/arkvory/health-token.txt` | 読み取り専用 | api、worker                                           |
| `config/postgres.env`     | 環境変数ファイル                |              | database                                              |
| `updates/status`          | `/run/arkvory-updates/status`   | 読み取り専用 | api、worker                                           |
| `updates/inbox`           | `/run/arkvory-updates/inbox`    | 読み書き     | api、worker                                           |
| バックアップの保管庫      | `/srv/arkvory-vault`            | 読み書き     | backup、`vault-owner`（保管庫が設定されている間のみ） |
| `config/mirrors`          | `/run/arkvory/mirrors`          | 読み取り専用 | api、worker（リポジトリをミラーしている間のみ）       |

### 所有者とモード {#owners}

| パス                                                   | 所有者とモード                         | 理由                                                                                                                                                                           |
| ------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| インストールルート                                     | インストールを実行するユーザー、`0700` | ルートには回復キーとデータベースのパスワードがあります。入れるのはインストールを実行するユーザーだけです                                                                       |
| `config/runtime.json`、`keys.json`、`health-token.txt` | `0644`                                 | コンテナー内のユーザー1000が読み取る必要があります。`runtime.json`にはデータベースのパスワードがあり、`0700`のルートが他のユーザーによるこれらのファイルへのアクセスを防ぎます |
| `updates/inbox`                                        | `0777`                                 | コンテナーがホスト上に書き込む唯一のディレクトリ。コンテナーユーザーとホストの更新ツールでユーザーIDが異なる場合があります                                                     |
| `updates/status`                                       | `0755`                                 | ホストの更新ツールが書き込み、コンテナーは読み取りのみ行います                                                                                                                 |
| ストレージボリューム                                   | ユーザー1000                           | インストールと更新の際に`initialize`が設定します                                                                                                                               |
| バックアップの保管庫                                   | ユーザー1000                           | 保管庫の接続時に`vault-owner`が設定します。以後、保管庫はID 1000のホストユーザーが所有します                                                                                   |

## ポート {#ports}

| ポート   | サービス        | 公開範囲                                                  |
| -------- | --------------- | --------------------------------------------------------- |
| 8080/TCP | APIとコンソール | ホストの`127.0.0.1:8080`。アドレスは固定です              |
| 5432/TCP | PostgreSQL      | 公開されません。Composeネットワーク内からのみ到達できます |

Composeファイルは、更新によって置き換えられるリリースディレクトリに属しているため、そこで公開アドレスを変更することはできません。他のコンピューターからコンソールに接続するには、`127.0.0.1:8080`に転送するリバースプロキシをホスト上にインストールしてください。

## 環境設定 {#environment}

ComposeファイルはArkvoryの設定を指定しません。サービスは、ホスト上の`config/runtime.json`に相当する`/run/arkvory/runtime.json`を読み取ります。次の値はインストーラーが書き込むため、変更しないでください。`ARKVORY_HOST`（コンテナー内の`0.0.0.0`）、`ARKVORY_PORT`（`8080`）、`ARKVORY_DATABASE_URL`（生成したパスワードを使う`database`コンテナー）、`ARKVORY_DATA_DIR`（`/var/lib/arkvory`）、`ARKVORY_KEYS_FILE`、`ARKVORY_UPDATE_CONTROL_DIR`です。

`ARKVORY_TRUSTED_PROXIES`、各種制限、`ARKVORY_LOG_LEVEL`など、他の設定は追加できます。`config/runtime.json`に追加し、[プロジェクトを管理する](#manage)の手順でサービスを停止して起動します。完全な一覧は[環境変数](../reference/environment)を参照してください。`config/compose.env`には`ARKVORY_IMAGE`があります。インストーラーが管理するため、編集しないでください。

## Linuxにインストールする {#install}

1. [GitHub Releases](https://github.com/ProAnima/Arkvory/releases)から`install.sh`をダウンロードし、内容を読みます。
2. `root`として実行します。

   ```bash
   sudo bash ./install.sh --mode compose
   ```

   自動更新を有効にするには`--automatic`、Podmanを使うには`--engine podman`を追加します。`ARKVORY_RELEASE_VERSION=1.2.3`を指定すると、その安定版バージョンをインストールします。GitHubにインターネット経由でアクセスできない場合は、`Arkvory-Linux.tar.gz`を展開し、展開先のディレクトリで`sudo env ARKVORY_ARTIFACT_DIR="$PWD" bash ./install.sh --mode compose`を実行してください。この場合もNode.jsはダウンロードします。

3. インストーラーの完了を待ちます。リリースの確認と展開、イメージのビルド、データベースの起動、`initialize`と`migrate`の実行、APIとワーカーの起動を行い、APIが3回連続で準備完了を報告するまで待ってから、バックアップエージェントを起動し、更新タイマーを登録します。

`docker`グループのユーザーは、`root`を使わず、自身が所有するディレクトリにインストールできます。

```bash
ARKVORY_INSTALL_ROOT="$HOME/arkvory" bash ./install.sh --mode compose
```

この場合、インストーラーは更新タイマーを登録しません。更新ツールを自身でスケジュールするまで、コンソールから更新を要求できません。[Composeでの更新](#updates-compose)を参照してください。

## 初回起動と初期セットアップ {#first-start}

1. コンテナーが実行されていることを確認します。`compose`コマンドについては、[プロジェクトを管理する](#manage)を参照してください。

   ```bash
   "${compose[@]}" ps
   ```

2. 回復キーを読み取ります。

   ```bash
   sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
   ```

3. サーバー上で`http://127.0.0.1:8080/console/#onboarding`を開きます。自分のコンピューターから使う場合は、ポートを転送します：`ssh -L 8080:127.0.0.1:8080 admin@arkvory.example`。
4. コンソールで[[ui:navStart]]を開き、[[ui:welcomeOwner]]を展開します。[[ui:welcomeRecovery]]にキーを貼り付け、所有者名と12文字以上のパスワードを入力して、[[ui:welcomeCreate]]を選びます。

回復キーはサーバーに残してください。[セキュリティ](../operate/security)を参照してください。

## プロジェクトを管理する {#manage}

rootシェル（`sudo -i`）を開き、`compose`コマンドを一度定義します。Composeには、プロジェクト名、プロジェクトディレクトリ、環境変数ファイル、インストールに属するすべてのComposeファイルが必要です。

```bash
root=/opt/proanima-arkvory
node="$root/runtime/node-v24.22.3-linux-x64/bin/node"   # arm64ではlinux-arm64
version=$("$node" -p "require('$root/installation.json').current.version")
compose=(docker compose --project-name proanima-arkvory --project-directory "$root"
  --env-file "$root/config/compose.env" -f "$root/releases/$version/deploy/compose.yml")
for file in compose.vault.yml compose.mirrors.yml; do
  if [[ -f "$root/config/$file" ]]; then compose+=(-f "$root/config/$file"); fi
done
```

存在するファイルを省くと、`up`は保管庫またはミラーのマウントなしでコンテナーを再作成します。

| 作業                 | コマンド                                                                        |
| -------------------- | ------------------------------------------------------------------------------- |
| コンテナーを表示する | `"${compose[@]}" ps`                                                            |
| ログを読む           | `"${compose[@]}" logs --tail 100 api worker backup`                             |
| Arkvoryを停止する    | `"${compose[@]}" stop --timeout 120 backup worker api`                          |
| Arkvoryを起動する    | `"${compose[@]}" up -d --wait api worker`、続いて`"${compose[@]}" up -d backup` |

`stop`で停止したコンテナーは、エンジンが再起動しても停止したままです。`up -d`で再び起動してください。

ライフサイクルコマンドは、インストーラーがルートに配置したNode.jsで実行します。

```bash
sudo "$node" "$root/manage.mjs" status --root "$root"
```

Composeホストには`arkvory`がインストールされないため、`status`、`update`、`configure`には`manage.mjs`を呼び出します。コマンドの説明は[設定](./configuration)を参照してください。

## ログ {#logs}

コンテナーはDockerのJSONログファイルに書き込みます。`"${compose[@]}" logs`で読めます。APIとワーカーは、1行に1件のJSONレコードを書き込みます。[監視](../operate/monitoring)を参照してください。ライフサイクルコマンドはメッセージをターミナルに出力し、更新タイマーはジャーナルに書き込みます：`journalctl -u arkvory-update`。

## Composeでの更新 {#updates-compose}

コンソール、自動更新の時間帯、または次のコマンドで更新します。

```bash
sudo "$node" "$root/manage.mjs" update --root "$root"
```

更新では、リリースをダウンロードして確認し、新しいイメージをビルドしてから、`backup`、`worker`、`api`を停止し、新しいイメージで起動します。`database`コンテナーは動作を続けます。ボリュームはそのまま残ります。データベーススキーマを変更するリリースは、検証済みのバックアップがある場合にのみインストールします。[更新](./updates)を参照してください。

ホストの更新ツールは毎分実行されます。systemdホストに`root`としてインストールした場合、インストーラーは`arkvory-update.timer`として登録します。`root`を使わない場合、インストーラーは警告を表示します。インストールを所有し、コンテナーエンジンにアクセスできるユーザーとして、次のコマンドを毎分実行するようにスケジュールしてください。たとえばcronを使えます。

```text
* * * * * /home/admin/arkvory/runtime/node-v24.22.3-linux-x64/bin/node /home/admin/arkvory/manage.mjs updates-poll --root /home/admin/arkvory
```

ArkvoryのコンテナーにDockerソケットを渡さないでください。

## Composeのバックアップエージェント {#backup-agent}

`backup`コンテナーは最初から実行されます。保管庫がない場合も実行を続け、保管庫が設定されていないと報告します。保管庫は、インストールルートの外にある、別ボリューム上のホストのディレクトリです。

1. 保管庫用のボリュームをマウントし、空のディレクトリ（例：`/mnt/backup/arkvory`）を作成します。ディレクトリはあらかじめ存在する必要があります。Composeは作成しません。
2. 接続します。

   ```bash
   sudo "$node" "$root/manage.mjs" configure --root "$root" --backup-vault /mnt/backup/arkvory --vault-key-file /root/arkvory-agent.key
   ```

   このコマンドはディレクトリを確認し、`config/compose.vault.yml`を書き込み、ディレクトリの所有者をユーザー1000にし、エージェントのキーファイルを読み取り専用でバックアップコンテナーに渡し（`--vault-key-file`）、バックアップコンテナーだけを再起動します。エージェントが保管庫を利用可能と報告すると成功します。それ以外の場合は、前の設定を復元します。

3. 保管庫の接続を解除するには、同じコマンドを`--backup-vault-off`付きで実行します。保管庫自体には手を加えません。

スケジュール、保持、復元については、[バックアップ](../operate/backups)を参照してください。

## 削除する {#remove}

```bash
"${compose[@]}" down              # コンテナーを削除し、ボリュームは残す
"${compose[@]}" down --volumes    # カタログと保存されたすべてのファイルも削除する
```

`down --volumes`はすべてのデータを削除します。ファイルを保持しているインストールでは実行しないでください。先にバックアップを作成し、保管庫は残してください。

`down`の後、残ったものを削除できます。

```bash
sudo systemctl disable --now arkvory-update.timer
sudo rm -f /etc/systemd/system/arkvory-update.service /etc/systemd/system/arkvory-update.timer
sudo systemctl daemon-reload
docker image rm "proanima-arkvory:$version"
sudo rm -rf /opt/proanima-arkvory
```

設定と回復キーが不要になってから、ルートを削除してください。以前のバージョンのイメージは、自分で削除するまでホストに残ります。

## WindowsでDocker Desktopを使う {#docker-desktop}

Docker Desktopは、ワークステーションでの評価にのみ使ってください。Docker Desktopは1人のユーザーのアプリケーションです。そのユーザーがサインインし、Docker Desktopが実行されている間だけ、コンテナーが動作します。コンピューターを再起動した後、それまではArkvoryを利用できません。**設定 > 全般 > サインイン時にDocker Desktopを起動する**を有効にしてください。この設定が無効だと、インストーラーと`status`コマンドが警告します。サーバーには[Windowsサービス](./windows)を使ってください。

1. Docker DesktopをLinuxコンテナーモードで起動します。
2. リリースから`install.ps1`をダウンロードし、内容を読みます。
3. Docker Desktopを実行するユーザーとして、管理者権限**なし**でWindows PowerShellを開き、次を実行します。

   ```powershell
   .\install.ps1 -Mode compose
   ```

   パラメーター`-Root`、`-Version`、`-Engine`、`-Artifact`、`-AutomaticUpdates`、`-Pin`は、[Windows](./windows#install-with-powershell-and-an-existing-postgresql)に記載しています。`-Root`と`-Artifact`には絶対パスを指定してください。

4. `http://127.0.0.1:8080/console/#onboarding`を開き、`C:\ProgramData\ProAnima\Arkvory\config\bootstrap-token.txt`から回復キーを読み取り、[初回起動と初期セットアップ](#first-start)の手順で所有者を作成します。

インストールルート`C:\ProgramData\ProAnima\Arkvory`は、SYSTEM、Administrators、インストールを実行するユーザーに、継承なしでアクセスを許可します。Docker Desktopがこのユーザーのトークンでバインドマウントを読み取るためです。Compose用のインストーラーを昇格して実行しないでください。

インストーラーは、管理者として実行した場合にのみ、更新タスク`ProAnimaArkvoryUpdate`を登録します。このタスクはシステム全体のエンジン向けです。Docker Desktopでは、Docker Desktopのユーザーとしてタスクを登録します。そのユーザーがサインインし、Docker Desktopが実行されている間だけ動作します。

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
$node = "$root\runtime\node-v24.22.3-win-x64\node.exe"
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$root\manage.mjs`" updates-poll --root `"$root`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 14)
Register-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Action $action -Trigger $trigger -Settings $settings
```

PowerShellでも同じ引数でプロジェクトを管理します。

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
$version = (Get-Content "$root\installation.json" -Raw | ConvertFrom-Json).current.version
$compose = @('compose', '--project-name', 'proanima-arkvory', '--project-directory', $root,
  '--env-file', "$root\config\compose.env", '-f', "$root\releases\$version\deploy\compose.yml")
foreach ($file in 'compose.vault.yml', 'compose.mirrors.yml') {
  if (Test-Path "$root\config\$file") { $compose += @('-f', "$root\config\$file") }
}
docker @compose ps
& "$root\runtime\node-v24.22.3-win-x64\node.exe" "$root\manage.mjs" status --root $root
```

Windowsのバックアップの保管庫は、ローカルまたはiSCSIボリュームである必要があります。UNCとSMBのパスは拒否します。インストールを削除するには、`docker @compose down --volumes`を実行し、`Unregister-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Confirm:$false`でタスクを登録解除して、ルートを削除します。先にバックアップしてください。
