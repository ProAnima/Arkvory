---
title: Windows
---

# Windows

WindowsでArkvoryを実行する方法は3つあります。

- **グラフィカルインストーラー**`Arkvory-Setup-x64.exe`。推奨される方法です。Windowsサービスと専用のPostgreSQLデータベースをインストールします。インターネット接続は不要です。
- **PowerShellスクリプト**`install.ps1`。同じWindowsサービスをインストールしますが、既存のPostgreSQLサーバーを使います。
- **Docker Desktop**と`install.ps1 -Mode compose`。評価専用です。[Docker Compose](./docker)を参照してください。

## 要件 {#requirements}

- Windows x64、ビルド10.0.17763以降（Windows 10 バージョン1809、Windows Server 2019以降）。
- Administratorsグループに属するアカウント。
- データ用のローカルNTFSボリューム。ファイルストレージにネットワーク共有は使用できません。
- ユーザープロファイルと`AppData`の外にあるインストールディレクトリ。サービスアカウントが、すべての親ディレクトリを読み取れる必要があります。

## グラフィカルインストーラーでインストールする {#install-with-the-graphical-installer}

1. [GitHub Releases](https://github.com/ProAnima/Arkvory/releases)から`Arkvory-Setup-x64.exe`をダウンロードします。
2. ファイルを実行し、ユーザー アカウント制御のメッセージを承認します。
3. 英語またはロシア語を選択し、ライセンスに同意します。
4. 所有者アカウントを入力します。名前は3〜64文字で、英字（ラテン文字）、数字、ドット、ハイフン、アンダースコアを使えます。パスワードは12〜128文字です。
5. セットアップがデータベース、サービス、所有者アカウントを準備するまで待ちます。
6. 最後のページで、**Open Arkvory and finish onboarding**を選択したまま**Finish**をクリックします。コンソールが`http://127.0.0.1:8080/console/#onboarding`で開きます。

セットアップは、スタートメニューにもショートカットを2つ作成します。**Arkvory**（コンソール）と**API and CLI**（コンソールのヘルプページ）です。

Microsoftランタイムのために再起動が必要だと表示された場合は、Windowsを再起動して、セットアップをもう一度実行してください。既存のArkvoryのデータは保持されます。

インストール直後は、自動更新がオフです。オンにするには、[更新](./updates)を参照してください。

### サイレントインストール {#silent-installation}

自動デプロイでは、所有者アカウントをJSONファイルに記述します。SYSTEMとAdministratorsだけが読み取れるように、ファイルを保護してください。

```json
{ "name": "admin", "password": "<12文字以上のパスワード>" }
```

```powershell
.\Arkvory-Setup-x64.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /OWNERFILE="C:\secure\owner.json"
```

インストーラーは、アカウントを作成した後、所有者ファイルを削除します。パスワードをコマンド引数として渡さないでください。`/OWNERFILE`を指定しない場合は、後からコンソールで回復キーを使って所有者を作成します。構成が完了しなかった場合、セットアップは0以外の終了コードで終了します。更新の実行中は、セットアップを実行しないでください。

## グラフィカルインストーラーが作成するもの {#what-the-graphical-installer-creates}

| 項目               | 場所または値                                                               |
| ------------------ | -------------------------------------------------------------------------- |
| プログラムファイル | `C:\Program Files\ProAnima\Arkvory`                                        |
| データ、設定、ログ | `C:\ProgramData\ProAnima\Arkvory`（インストールルート）                    |
| データベース       | ルートの`database\`にあるPostgreSQL 18.4（`127.0.0.1:54329`）              |
| コンソール         | `http://127.0.0.1:8080/console/`                                           |
| 回復キー           | ルートの`config\bootstrap-token.txt`                                       |
| 更新タスク         | タスク スケジューラの`ProAnimaArkvoryUpdate`。SYSTEMとして毎分実行されます |

### サービス {#services}

| サービス名        | 表示名                    | アカウント                    | スタートアップの種類 |
| ----------------- | ------------------------- | ----------------------------- | -------------------- |
| `Arkvoryapi`      | ProAnima Arkvory api      | `NT AUTHORITY\LocalService`   | 自動（遅延開始）     |
| `Arkvoryworker`   | ProAnima Arkvory worker   | `NT AUTHORITY\LocalService`   | 自動（遅延開始）     |
| `Arkvorybackup`   | ProAnima Arkvory backup   | `NT AUTHORITY\LocalService`   | 自動（遅延開始）     |
| `Arkvorydatabase` | ProAnima Arkvory database | `NT AUTHORITY\NetworkService` | 自動                 |

サービスは、サインインしているユーザーがいなくても実行されます。API、ワーカー、バックアップエージェントは、LocalServiceアカウントを共有します。データベースはNetworkServiceで実行されるため、APIのアカウントはデータベースファイルを読み取れません。

ルートに対するフルコントロールを持つのは、SYSTEMとAdministratorsだけです。LocalServiceはルートを読み取れ、変更できるのは`data\`、`logs\`、更新リクエストの受信フォルダーだけです。回復キーと、インストーラーのその他の資格情報ファイルを読み取れるのは、SYSTEMとAdministratorsだけです。

## PowerShellと既存のPostgreSQLでインストールする {#install-with-powershell-and-an-existing-postgresql}

組織ですでにPostgreSQLを運用している場合は、この方法を使います。管理対象のデータベースサービスは作成されず、**アプリ**にも項目は追加されません。

1. データベース管理者に、空のデータベースと、それを所有するロールを用意してもらいます。Arkvoryはこのロールでマイグレーションを実行します。
2. リリースから`install.ps1`をダウンロードして、内容を確認します。
3. Windows PowerShellを**管理者として実行**で開き、次を実行します。

```powershell
.\install.ps1 -AutomaticUpdates
```

スクリプトは、PostgreSQLの接続URLを尋ねます。入力した内容は表示されません。その後、`nodejs.org`からNode.js 24.21.0をダウンロードし、SHA-256を確認して、最新の安定版リリースをインストールします。

プロンプトの代わりに、保護されたJSONファイルを渡すこともできます。

```json
{ "ARKVORY_DATABASE_URL": "postgresql://arkvory:<password>@db.example:5432/arkvory" }
```

```powershell
.\install.ps1 -Config C:\secure\arkvory.json
```

PowerShellがスクリプトの実行をブロックする場合は、`powershell -ExecutionPolicy Bypass -File .\install.ps1`を実行します。この変更が有効なのは、このプロセスだけです。

| パラメーター                   | 意味                                                                    |
| ------------------------------ | ----------------------------------------------------------------------- |
| `-Root <path>`                 | インストールルート。既定値：`C:\ProgramData\ProAnima\Arkvory`           |
| `-Version <x.y.z>`             | 最新版の代わりに、この安定版バージョンをインストールします              |
| `-Mode windows`または`compose` | Windowsサービス（既定）または[Docker Compose](./docker)                 |
| `-Engine docker`または`podman` | Compose用のコンテナーエンジン                                           |
| `-Config <file>`               | データベースURLを含む、`ARKVORY_*`設定のJSONファイル                    |
| `-Artifact <directory>`        | GitHubの代わりに、展開済みの`Arkvory-Windows.zip`からインストールします |
| `-AutomaticUpdates`            | 自動更新をオンにします                                                  |
| `-Pin`                         | インストールしたバージョンを固定します                                  |

`-Root`、`-Config`、`-Artifact`は、`-Artifact $PWD.Path`のように、絶対パスで指定してください。

スクリプトは、所有者アカウントを作成しません。サーバー上で`http://127.0.0.1:8080/console/`を開き、[[ui:welcomeOwner]]を選択して、`config\bootstrap-token.txt`にある回復キーを入力します。

## サービスを管理する {#manage-the-services}

```powershell
Get-Service Arkvoryapi, Arkvoryworker, Arkvorybackup, Arkvorydatabase
Restart-Service Arkvoryapi, Arkvoryworker
sc.exe qfailure Arkvoryapi
```

管理コマンドは、管理者権限で起動したPowerShellで実行し、常に`--root`オプションを付ける必要があります。

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
# グラフィカルインストーラー
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' status --root $root
# スクリプトによるインストール
& "$root\runtime\node-v24.21.0-win-x64\node.exe" "$root\manage.mjs" status --root $root
```

`arkvory.ps1 help`を実行すると、すべてのコマンドを確認できます。コマンドについては、[設定](./configuration)と[更新](./updates)で説明しています。

## 障害からの復旧 {#recovery-after-a-failure}

- サービスのプロセスが要求なしに停止すると、Windowsは10秒後にそのプロセスを再起動します。失敗の回数は、1時間後にリセットされます。
- メインスレッドが60秒間ハングしたプロセスは自分で終了し、Windowsが再起動します。[自己修復](../operate/self-healing)を参照してください。
- 準備状態チェックの失敗だけでは、サービスは再起動されません（たとえば、サーバーが処理中のリクエストを完了させている間）。ただし、データベースが応答しなくなると、APIとワーカーはストレージの所有権を確認できなくなります。約8秒後に自分で終了し、Windowsはデータベースが復旧するまで、10秒ごとに再起動を繰り返します。
- 自分で停止したサービスは、自分で開始するか、Windowsが再起動するまで、停止したままです。

グラフィカルインストーラーをもう一度実行すると、サービスのスタートアップの種類と回復アクションが復元されます。

## ログ {#logs}

| ルート内の場所     | 内容                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `logs\`            | API、ワーカー、バックアップエージェントの出力。ファイルは20 MiBでローテーションされ、古いファイルは5個保持されます |
| `logs\updater.log` | 更新タスクの出力。ローテーションの方法は同じです                                                                   |
| `database\`        | データベースサービスのログ（`arkvory-database*.log`）                                                              |
| `bootstrap.log`    | グラフィカルインストーラーの構成ステップの出力                                                                     |

セットアップは、実行したユーザーの一時フォルダーにも、独自のログを書き込みます。APIとワーカーは、1行につき1つのJSONレコードを書き込みます。[監視](../operate/monitoring)を参照してください。

## アンインストール {#uninstall}

**設定 > アプリ**を開き、**ProAnima Arkvory**を選択して、**アンインストール**をクリックします。アンインストーラーは次の処理を行います。

1. `ProAnimaArkvoryUpdate`タスクを削除します。
2. `Arkvorybackup`、`Arkvoryworker`、`Arkvoryapi`、`Arkvorydatabase`を停止して削除します。
3. プログラムファイルを削除します。

`C:\ProgramData\ProAnima\Arkvory`は、意図的に**残します**。データベース、すべてのファイル、設定、回復キーが含まれているためです。バックアップの保管庫には一切手を触れません。同じバージョンまたはそれより新しいバージョンのセットアップを後から実行すると、残されたデータを引き続き使用します。データを削除するには、先にバックアップを取ってから、フォルダーを自分で削除してください。

スクリプトによるインストールには、アンインストーラーがありません。サービスを削除するには、管理者権限のPowerShellで次を実行します。

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
Unregister-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Confirm:$false
foreach ($role in 'backup', 'worker', 'api') {
  $exe = "$root\service\arkvory-$role.exe"
  if ((Get-Service "Arkvory$role").Status -ne 'Stopped') { & $exe stopwait }
  & $exe uninstall
}
```

## Docker Desktop {#docker-desktop}

Docker Desktopは、1人のユーザーのアプリケーションです。コンテナーが実行されるのは、このユーザーがサインインしてDocker Desktopが起動した後だけです。コンピューターを再起動すると、それまでArkvoryは利用できません。Docker Desktopでインストールする場合は、**Settings > General > Start Docker Desktop when you sign in**を有効にしてください。この設定がオフのとき、インストーラーと`status`コマンドは警告を表示します。サインインなしで起動する必要があるサーバーには、このページで説明しているネイティブサービスを使用してください。

## トラブルシューティング {#troubleshooting}

| 問題                                                               | 対処                                                                                                                                                            |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| セットアップが、構成が完了しなかったと報告する                     | `bootstrap.log`、セットアップのログ、データベースのログを確認します。データベースのフォルダーは削除しないでください                                             |
| `database\bootstrap-started`はあるが、`database\initialized`がない | データベースの作成が中断されました。クラスターを削除したり、SQLを手作業でやり直したりしないでください。原因を解消してから、`finish-install`コマンドを実行します |
| `Run installer as Administrator`                                   | **管理者として実行**でPowerShellを起動します                                                                                                                    |
| `Use a dedicated directory`                                        | ルートにすでにファイルがあります。空のディレクトリを使用してください。既存のインストールは、そのコマンドで管理します                                            |
| `Node.js runtime is incomplete after extraction`                   | ウイルス対策ソフトウェアの隔離（検疫）の内容を確認します                                                                                                        |
| `Another installation owns this service`                           | 別のルートにあるインストールのサービスが存在します。先にそれらを削除してください                                                                                |

データを削除せずに、中断したインストールを完了するには、次を実行します。

```powershell
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' finish-install --root C:\ProgramData\ProAnima\Arkvory
```

その他のヒントは、[トラブルシューティング](../operate/troubleshooting)にあります。
