---
title: クイックスタート
---

# クイックスタート

このページでは、何もない状態から、1つのファイルをアップロードした稼働中のArkvoryサーバーまでの、最短の手順を説明します。ステップ1でインストール方法を1つ選び、残りのステップを順番に進めてください。

インストーラーは、必ずプロジェクトの[リリースページ](https://github.com/ProAnima/Arkvory/releases)からダウンロードし、SHA-256をリリースのチェックサムファイルと照合してください。

## ステップ1：サーバーをインストールする {#step-1-install-the-server}

### Windows {#windows}

Windows 10 バージョン1809以降、またはWindows Server 2019以降（x64）と、管理者権限が必要です。インターネット接続は不要です。

1. `Arkvory-Setup-x64.exe`を実行し、管理者の確認ダイアログを承認します。
2. 言語を選択し、ライセンスに同意します。
3. 所有者のページで、名前（英字（ラテン文字）、数字、`.`、`-`、`_`を使った3〜64文字）と、12文字以上のパスワードを入力します。これが最初の管理者アカウントです。
4. ウィザードを完了します。コンソールを自動で開くこともできます。

セットアップは、プログラムを`C:\Program Files\ProAnima\Arkvory`に、データを`C:\ProgramData\ProAnima\Arkvory`にインストールします。また、`Arkvorydatabase`、`Arkvoryapi`、`Arkvoryworker`、`Arkvorybackup`の4つのWindowsサービスを作成します。これらは、サインインしているユーザーがいなくても実行されます。詳しくは[Windows](../install/windows)を参照してください。

### Linux {#linux}

ディストリビューションに合ったパッケージを使います。パッケージマネージャーが、PostgreSQLサーバーもインストールします（バージョン16〜19に対応）。

```bash
# Debian、Ubuntu
sudo apt install ./Arkvory-amd64.deb

# Fedora、RHEL互換
sudo dnf install ./Arkvory-x86_64.rpm
```

インストールルートは`/opt/proanima-arkvory`です。パッケージはsystemdサービス`arkvory-database`、`arkvory-api`、`arkvory-worker`、`arkvory-backup`を作成します。次のコマンドで状態を確認します。

```bash
systemctl status arkvory-api arkvory-worker arkvory-backup
```

詳しくは[Linux](../install/linux)を参照してください。

### Docker Compose {#docker-compose}

Composeに対応したDockerが必要です。Windowsでは、LinuxコンテナーモードのDocker Desktopを使います。スクリプトはNode.jsとリリースをダウンロードするため、インターネットに接続できる必要があります。

リリースから`install.sh`または`install.ps1`をダウンロードし、実行する前に内容を確認してください。

```bash
sudo bash ./install.sh --mode compose
```

Windowsでは、Docker Desktopを実行しているのと同じユーザーで、管理者権限なしでPowerShellを実行します。

```powershell
.\install.ps1 -Mode compose
```

インストールルートは、Linuxでは`/opt/proanima-arkvory`、Windowsでは`C:\ProgramData\ProAnima\Arkvory`です。スタックには、API、ワーカー、バックアップエージェント、PostgreSQL 18が含まれます。詳しくは[Docker](../install/docker)を参照してください。

## ステップ2：コンソールを開く {#step-2-open-the-console}

サーバー上のブラウザーで`http://127.0.0.1:8080/console/`を開きます。

最初のうち、サーバーはローカルアドレス`127.0.0.1`でのみ待ち受けます。自分のコンピューターからコンソールを開くには、SSH経由でポートを転送します。

```bash
ssh -L 8080:127.0.0.1:8080 admin@arkvory.example
```

続いて、自分のコンピューターで`http://127.0.0.1:8080/console/`を開きます。他のマシンにアクセスを許可するには、先に[HTTPS](../install/https)を設定してください。

## ステップ3：所有者を作成する {#step-3-create-the-owner}

Windowsでは、このステップは不要です。セットアップが所有者をすでに作成しています。

LinuxとDockerでは、最初のアカウントを**回復キー**で作成します。インストーラーが、インストールルートの`config/bootstrap-token.txt`にキーを書き込みます。このファイルを読めるのは管理者だけです。

```bash
sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
```

```powershell
Get-Content C:\ProgramData\ProAnima\Arkvory\config\bootstrap-token.txt
```

1. コンソールで[[ui:navStart]]を開き、[[ui:welcomeOwner]]を展開します。
2. [[ui:welcomeRecovery]]にキーを貼り付けます。
3. 所有者の名前と12文字以上のパスワードを入力し、[[ui:welcomeCreate]]を選択します。
4. [[ui:connection]]カードで、新しい名前とパスワードを使ってサインインします。

回復キーは秘密にし、ファイルは削除しないでください。インストールと更新のツールがこのファイルを使用します。[セキュリティ](../operate/security)を参照してください。

所有者は管理者であり、リポジトリ`releases`に書き込めます。別のリポジトリを作成するには、[[ui:administration]]を開き、[[ui:manageGrants]]を展開して、グループ`arkvory-owners`に、`builds`などの新しい名前に対する[[ui:write]]のアクセス権を付与し、[[ui:saveGrant]]を選択します。リポジトリ名には、小文字の英字（ラテン文字）、数字、`-`、`_`を使用でき、最大64文字です。

## ステップ4：ツール用のキーを作成する {#step-4-create-a-key-for-your-tools}

スクリプトとコマンドラインクライアントにはキーが必要です。最初のテストでは、個人用アクセストークンを使います。

1. [[ui:connection]]カードで[[ui:personalAccessTokens]]を展開します。
2. [[ui:tokenName]]を入力し、[[ui:tokenScope]]を[[ui:tokenScopeReadWrite]]に設定して、[[ui:generateToken]]を選択します。
3. トークンをコピーします。表示されるのは1回だけです。
4. 自分だけが読めるファイル（例：`~/.arkvory/key`）に保存します。

CI/CDやデプロイエージェントには、代わりに専用のキーを持つサービスアカウントを作成します。[アカウントとアクセス](../use/accounts)を参照してください。

## ステップ5：curlでアップロードとダウンロードを行う {#step-5-upload-and-download-with-curl}

リポジトリ内のファイルパスは、Webサーバー上のファイルのように機能します。`PUT`でパスの新しいバージョンを保存し、`GET`で現在のバージョンを取得します。

```bash
export ARKVORY_KEY="$(cat ~/.arkvory/key)"

# アップロード
curl -T ./Setup.exe -H "Authorization: Bearer $ARKVORY_KEY" \
  http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe

# ダウンロード
curl -fL -H "Authorization: Bearer $ARKVORY_KEY" -o Setup-copy.exe \
  http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe
```

アップロードすると、次のようなJSONが返されます。

```json
{
  "path": "builds/game/1.0/Setup.exe",
  "revision": 1,
  "created": true,
  "artifact": { "id": "…", "size": "1048576", "sha256": "…" }
}
```

同じバイト列をもう一度アップロードすると、応答は`200`と`"created": false`になり、新しいバージョンは作成されません。新しいファイルのステータスは`201`です。

PowerShellの場合は次のとおりです。

```powershell
$headers = @{ Authorization = "Bearer $env:ARKVORY_KEY" }
$url = 'http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe'
Invoke-WebRequest -Method Put -InFile .\Setup.exe -Headers $headers -Uri $url
Invoke-WebRequest -Headers $headers -Uri $url -OutFile .\Setup-copy.exe
```

1回の`PUT`リクエストは、30分以内に完了する必要があります。非常に大きなファイルや低速なネットワークでは、コマンドラインクライアントを使ってください。パートに分けてアップロードし、失敗後も続行できます。[Rawファイル](../protocols/raw-files)を参照してください。

## ステップ6：コマンドラインクライアントを使う {#step-6-use-the-command-line-client}

自分のコンピューターに`arkvoryctl`をインストールします。Windowsでは`Arkvory-CLI-Setup-x64.exe`、Linuxでは`Arkvory-CLI-amd64.deb`または`Arkvory-CLI-x86_64.rpm`です。Node.js 24があるCIマシンでは、`arkvoryctl.mjs`も使えます。

```bash
arkvoryctl profile add local --server http://127.0.0.1:8080 --token-file ~/.arkvory/key
arkvoryctl doctor
arkvoryctl put ./Setup.exe builds/game/1.0/Setup.exe
arkvoryctl get builds/game/1.0/Setup.exe ./Setup-copy.exe
```

プロファイルは、`--repository`を指定しない限り、リポジトリ`releases`を使います。転送が中断した場合は、同じコマンドをもう一度実行してください。中断した位置から続行し、最後にSHA-256を確認します。クライアントが平文のHTTPを受け付けるのは、ローカルコンピューターに対してだけです。リモートサーバーにはHTTPSを使ってください。詳しくは[コマンドラインクライアント](../protocols/cli)を参照してください。

## 次のステップ {#next-steps}

- [基本概念](./concepts)：リポジトリ、アーティファクト、ステージ、キー。
- [HTTPS](../install/https)：サーバーを他のマシンに安全に公開します。
- [バックアップ](../operate/backups)：重要なデータを保存する前に、保管庫を接続します。
- [パッケージ](../use/packages)と[プロモーション](../use/promotion)：デプロイのためのバージョン管理されたビルド。
- [Webコンソール](./console)：すべてのセクションの案内です。
