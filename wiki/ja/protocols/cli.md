---
title: コマンドライン（arkvoryctl）
---

# コマンドライン（arkvoryctl）

`arkvoryctl`は、人とCI/CDのための、Arkvoryのリモートクライアントです。パートに分けてアップロードとダウンロードを行い、中断後も続行し、SHA-256を検証します。渡したキーの権限の範囲で動作します。

## インストール {#install}

| システム                                             | パッケージ                  | インストール方法                                                                                                                                   |
| ---------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows 10/11、Windows Server 2019以降（x64）        | `Arkvory-CLI-Setup-x64.exe` | 実行します。管理者権限なしで現在のユーザー向けにインストールされ、`arkvoryctl`がユーザーの`PATH`に追加されます。新しいターミナルを開いてください。 |
| Debian、Ubuntu（x64）                                | `Arkvory-CLI-amd64.deb`     | `sudo apt install ./Arkvory-CLI-amd64.deb`                                                                                                         |
| Fedora、RHEL互換（x64）                              | `Arkvory-CLI-x86_64.rpm`    | `sudo dnf install ./Arkvory-CLI-x86_64.rpm`                                                                                                        |
| Node.js 24がある任意のシステム（たとえばCIランナー） | `arkvoryctl.mjs`            | `node ./arkvoryctl.mjs --help`                                                                                                                     |

ネイティブパッケージには、専用のNode.jsが含まれています。単一ファイルの`arkvoryctl.mjs`には、npmの依存関係がありません。ファイルは`ProAnima/Arkvory`の信頼できるリリースから取得し、SHA-256を`release-checksums.json`と照合してください。ARM64パッケージはまだありません。更新するには、新しい安定版リリースをインストールします。アンインストールしても、プロファイル、キーファイル、チェックポイントは残ります。

## サーバーに接続する {#connect-to-a-server}

1. キーを入手します。コンソールで作成する個人用アクセストークン、または管理者から受け取るサービスキーです。[アカウントとキー](../use/accounts)を参照してください。
2. キーを、どのリポジトリにも含まれない非公開のファイルに保存します。Linuxではモード`0600`にします。Windowsでは、自分のアカウントだけにアクセスを許可します。
3. プロファイルを追加して、接続を確認します。

```bash
arkvoryctl profile add production --server https://arkvory.example --token-file "$HOME/.secrets/arkvory.key" --repository releases
arkvoryctl doctor
arkvoryctl repositories
```

```powershell
arkvoryctl profile add production --server https://arkvory.example --token-file C:\Private\arkvory.key --repository releases
arkvoryctl doctor
```

`doctor`は、サーバー、リポジトリ、機能、キーの権限を表示します。キーをコマンド引数に指定することはありません。

## プロファイルと環境変数 {#profiles-and-environment}

プロファイルは、`~/.config/arkvory`（Windowsでは、ユーザーフォルダー内の`.config\arkvory`）の`profiles.json`に保存されます。プロファイルに保存されるのは、サーバーURL、既定のリポジトリ、キーファイルへの**パス**で、キー自体は保存されません。

| コマンド                                                                | 効果                                                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `profile add NAME --server URL [--token-file PATH] [--repository NAME]` | プロファイルを追加します。最初のプロファイルが既定になります。既定のリポジトリは`releases`です。 |
| `profile list`                                                          | すべてのプロファイルと、有効なプロファイルを表示します                                           |
| `profile use NAME`                                                      | プロファイルを既定にします                                                                       |
| `profile remove NAME`                                                   | プロファイルを削除します                                                                         |

| 変数                 | 意味                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_TOKEN`      | キーそのもの。どのファイルよりも優先されます。                                                                                           |
| `ARKVORY_TOKEN_FILE` | キーファイルのパス。プロファイルのファイルより優先されます。                                                                             |
| `ARKVORY_BASE_URL`   | サーバーURL。設定すると、プロファイルのキーファイルは使われ**ません**。キーは`ARKVORY_TOKEN`または`ARKVORY_TOKEN_FILE`で渡してください。 |
| `ARKVORY_CLI_HOME`   | `profiles.json`用の別のフォルダー                                                                                                        |

サーバーURLには、HTTPSを使う必要があります。平文のHTTPが許可されるのは、`localhost`、`127.0.0.1`、`[::1]`だけです。TLSの検証を無効にすることはできません。

## グローバルオプション {#global-options}

| オプション                   | 既定値             | 意味                                                                                                                                            |
| ---------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `--profile NAME`             | 有効なプロファイル | このコマンドだけで使うプロファイル                                                                                                              |
| `--repository NAME`          | プロファイルの値   | このコマンドだけで使うリポジトリ                                                                                                                |
| `--json`                     | オフ               | 標準出力にコンパクトなJSONの結果を1つ出力します。エラーは標準エラー出力にJSONで出力します                                                       |
| `--lang en`または`--lang ru` | `LANG`から決定     | ヘルプとメッセージの言語                                                                                                                        |
| `--timeout MS`               | 60000              | 管理系リクエストの上限（1〜3600000）                                                                                                            |
| `--attempt-timeout MS`       | 120000             | 転送1回の試行の上限（1〜1800000）                                                                                                               |
| `--retries N`                | 20                 | 1つの操作でのネットワークの再試行回数（0〜100）。`0`で無効になります                                                                            |
| `--verbose`                  | オフ               | HTTPリクエストごとに、標準エラー出力へ1行出力します。メソッド、パス、ステータス、所要時間、リクエストIDが含まれ、ヘッダーとキーは含まれません。 |
| `--help`、`--version`        |                    | ヘルプ。クライアントのバージョンをJSONで出力します                                                                                              |
| `--`                         |                    | オプションの終わり。`-`で始まるファイル名のためのものです                                                                                       |

各オプションは1回だけ指定できます。未知のオプションは拒否されます。

## コマンド {#commands}

### 検出とカタログ {#discovery-and-catalog}

| コマンド                                                                   | 結果                                   |
| -------------------------------------------------------------------------- | -------------------------------------- |
| `doctor`                                                                   | 接続、機能、権限                       |
| `repositories [--after CURSOR]`                                            | キーから見えるリポジトリ               |
| `operations [--after CURSOR]`                                              | リポジトリで利用できるAPI操作          |
| `list [--after CURSOR]`                                                    | リポジトリのアーティファクト           |
| `search [--query TEXT] [--label TAG] [--collection NAME] [--after CURSOR]` | 名前とメタデータのテキストで検索       |
| `search --metadata-key KEY --metadata-value VALUE`                         | メタデータの完全一致（両方を指定）     |
| `inspect ID`                                                               | 1つのアーティファクトのメタデータ      |
| `storage usage` / `storage policy`                                         | リポジトリの使用量とストレージポリシー |

ページは`next`を返します。次のページを読むには、`--after`にその値を渡します。

### 転送 {#transfers}

| コマンド                                                                       | 結果                                                                                                                       |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `upload FILE [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]`   | 任意のファイルを、再開可能な方法でアップロードします                                                                       |
| `download ID OUTPUT`                                                           | 再開可能で、SHA-256で検証されるダウンロード                                                                                |
| `put FILE PATH [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]` | ファイルをアップロードし、パスの次のリビジョンにします。パスにすでに同じバイト列がある場合は、何もアップロードされません。 |
| `get PATH OUTPUT`                                                              | パスの現在のリビジョンをダウンロードします（検証あり、再開可能）                                                           |
| `link ID [--ttl SECONDS]`                                                      | キー不要のダウンロードURL。有効期間は60秒〜24時間です（既定は1時間）                                                       |
| `uploads status ID` / `uploads cancel ID`                                      | アップロードセッションの状態を表示します。また、セッションを取り消します（取り消しは一時停止ではありません）               |

`METADATA.json`には、`labels`と`metadata`（文字列のマップ）を記述します。`--label`より優先されます。

```bash
arkvoryctl put "./Build/Game Setup.exe" builds/game/1.4/GameSetup.exe
arkvoryctl get builds/game/1.4/GameSetup.exe ./GameSetup.exe
arkvoryctl link 00000000-0000-4000-8000-000000000001 --ttl 900
```

ダウンロードリンクはシークレットです。有効期限が切れる前に取り消すことはできません。

### パッケージとプロモーション {#packages-and-promotion}

| コマンド                                                                                                              | 結果                                                                 |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `packages list [--group G] [--name N] [--after CURSOR]`                                                               | UPackパッケージ                                                      |
| `packages publish FILE [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]`                                | UPackアーカイブをアップロードして登録します                          |
| `packages register ID`                                                                                                | アップロード済みのUPackを登録します                                  |
| `packages resolve NAME [--group G] [--exact V] [--range R] [--stage S] [--prerelease] [--order promoted]`             | バージョンを選択します（`--exact`と`--range`は同時に指定できません） |
| `packages download NAME OUTPUT [同じフィルター]`                                                                      | バージョンを選択し、検証付きでダウンロードします                     |
| `promote ID --to REPOSITORY [--move] [--stage S1,S2] [--comment TEXT]`                                                | バイト列を再送せずに、アーティファクトを別のリポジトリに公開します   |
| `stages list ID` / `stages add ID STAGE [--comment TEXT]` / `stages remove ID STAGE` / `stages artifacts [--stage S]` | アーティファクトのステージ                                           |
| `promotions history ID` / `promotions journal [--after CURSOR]`                                                       | プロモーションの履歴                                                 |

```bash
arkvoryctl packages publish ./build.upack --label test --state ./job-state/build.json --json
arkvoryctl promote 00000000-0000-4000-8000-000000000001 --to prod --stage release
arkvoryctl packages download app ./app.upack --range ^1.4 --stage release
```

正確なバージョンを指定するには`--exact`を使います。`--version`は、クライアントのバージョンを出力します。[パッケージ](../use/packages)と[プロモーション](../use/promotion)を参照してください。

### アノテーションと添付ファイル {#annotations-and-attachments}

`annotations get ID`と`annotations set ID --revision N --file ANNOTATIONS.json`は、ラベル、メタデータ、コレクションの読み取りと置き換えを行います。`attachments get ID`、`attachments history ID`、`attachments set ID --revision N --file ATTACHMENTS.json`は、ビルドに関連付けられたファイルに対して、同じことを行います。先に読み取り、読み取ったリビジョンとともに、完全な新しい状態を送信します。同時に変更があった場合は、競合が返されます（終了コード6）。

### バックアップ {#backups}

| コマンド                                                          | 結果                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `backup status`                                                   | 保管庫、エージェント、プラン、最後のポイント、警告。重大な警告がある場合は終了コード9 |
| `backup run`                                                      | バックアップジョブをキューに追加します                                                |
| `backup jobs [--after CURSOR]` / `backup points [--after CURSOR]` | ジョブと復元ポイント。新しい順                                                        |
| `backup verify POINT_ID`                                          | ポイントの完全な検証をキューに追加します                                              |
| `backup pin POINT_ID [--off]`                                     | ポイントを保持ルールの対象外にして残します。または、固定を解除します                  |

これらのコマンドには、インストールの所有者（ブートストラップ）のファイルキー、またはアカウント管理者のセッションが必要です。個人用トークンとサービスキーでは、403（終了コード3）になります。実際の処理は、サーバーのバックアップエージェントが行います。監視の例：`arkvoryctl backup status --json || alert`。[バックアップ](../operate/backups)を参照してください。

## 中断した転送を再開する {#resume-interrupted-transfers}

Ctrl+Cやネットワーク障害の後は、**同じオプションで同じコマンド**をもう一度実行します。

- `upload`、`put`、`packages publish`は、ソースファイルの隣にチェックポイントを保持します。`<source>.arkvory-upload.json`、または`--state`で指定したファイルです。最初のリクエストの前に冪等キーが保存されるため、応答が失われても、2つ目のコピーが作られることはありません。
- 同じバイト列を**新しい**アーティファクトとして公開するには、新しい`--state`ファイルを使います。
- `download`と`get`は、出力ファイルの隣に`<output>.arkvory-part`と`<output>.arkvory-download.json`を保持します。最終ファイルが現れるのは、SHA-256の検証後だけです。既存の出力ファイルが上書きされることはありません。
- CIでは、ジョブの前に状態用のフォルダーを作成し、再試行の間もソースファイルとともに保持してください。

チェックポイントは、ハードリンクをサポートするローカルディスク（NTFS、ext4、XFS）に置き、FAT、exFAT、ネットワーク共有には置かないでください。強制終了の後には`.lock`ファイルが残ります。その中のPIDのプロセスが停止していることを確認してから、`.lock`ファイルだけを削除してください。

## CIの例 {#ci-example}

```bash
# キーはCIのシークレットストアから渡します。出力しないでください。
export ARKVORY_BASE_URL=https://arkvory.example
export ARKVORY_TOKEN_FILE=/run/secrets/arkvory-key
mkdir -p job-state
node ./arkvoryctl.mjs packages publish ./build.upack --label test --state ./job-state/upload.json --json
```

アップロードの後で登録に失敗した場合、JSONエラーには`stage: "register"`と`artifactId`が含まれます。同じコマンドをもう一度実行してください。同じアーティファクトを再度登録しても安全です。

### CI システム {#ci-systems}

以下のシステムはどれも同じことを行います。バージョンを固定した `arkvoryctl.mjs` をインストールし、システムのシークレットストアからキーを取得して、1 つのコマンドを実行します。ダウンロードが変更された場合にジョブが失敗するよう、バージョンと SHA-256 を固定してください。リポジトリとジョブに必要な操作だけに制限したサービスキーを使用してください（[アカウントとキー](../use/accounts)）。エージェントには Node.js 24 が必要です。

```yaml
# GitHub Actions: .github/workflows/publish.yml
name: publish
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    env:
      ARKVORY_BASE_URL: https://arkvory.example
      ARKVORY_TOKEN: ${{ secrets.ARKVORY_KEY }}
      ARKVORY_CLI_VERSION: '0.3.0'
      ARKVORY_CLI_SHA256: 555af7e66e25447ba17ea0d3dc676f6d04b4b8adc47818d8c8bb548085752504
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: Install arkvoryctl
        run: |
          curl -fsSL -o arkvoryctl.mjs "https://github.com/ProAnima/Arkvory/releases/download/v${ARKVORY_CLI_VERSION}/arkvoryctl.mjs"
          echo "${ARKVORY_CLI_SHA256}  arkvoryctl.mjs" | sha256sum -c -
      - name: Publish the build
        run: node ./arkvoryctl.mjs put ./Build/Game.zip "builds/game/${GITHUB_REF_NAME}/Game.zip" --json
```

```yaml
# GitLab CI: .gitlab-ci.yml (ARKVORY_TOKEN is a masked CI/CD variable)
publish:
  image: node:24
  variables:
    ARKVORY_BASE_URL: https://arkvory.example
    ARKVORY_CLI_VERSION: '0.3.0'
    ARKVORY_CLI_SHA256: 555af7e66e25447ba17ea0d3dc676f6d04b4b8adc47818d8c8bb548085752504
  script:
    - curl -fsSL -o arkvoryctl.mjs "https://github.com/ProAnima/Arkvory/releases/download/v${ARKVORY_CLI_VERSION}/arkvoryctl.mjs"
    - echo "${ARKVORY_CLI_SHA256}  arkvoryctl.mjs" | sha256sum -c -
    - node ./arkvoryctl.mjs put ./Build/Game.zip "builds/game/${CI_COMMIT_TAG}/Game.zip" --json
```

```groovy
// Jenkins: Jenkinsfile. The agent has Node.js 24 and a checked arkvoryctl.mjs, installed as above.
pipeline {
  agent any
  environment {
    ARKVORY_BASE_URL = 'https://arkvory.example'
    ARKVORY_TOKEN = credentials('arkvory-key')
  }
  stages {
    stage('Publish') {
      steps {
        sh 'node ./arkvoryctl.mjs put ./Build/Game.zip "builds/game/${BUILD_NUMBER}/Game.zip" --json'
      }
    }
  }
}
```

TeamCity や Buildkite など、ほかのシステムでも同じです。そのシークレットストアから `ARKVORY_BASE_URL` と `ARKVORY_TOKEN` を設定し、コマンドを実行してください。結果は[終了コード](#exit-codes)で判断してください。

## 出力 {#output}

- 結果は、標準出力にJSONで出力されます。`--json`を付けない場合、JSONはインデントされます。バックアップのコマンドは、`--json`を付けない限り、読みやすい行を出力します。
- 進行状況が表示されるのは、標準エラー出力が対話型の場合だけです。
- `--json`なしのエラーは、サーバーのコード、理由、メッセージ、次の手順、リクエストIDを含む、標準エラー出力の1行です。`--json`を付けると、標準エラー出力に`{"error": {...}}`が出力され、`code`、`exitCode`、`status`、`serverCode`、`reason`、`requestId`、`retryAfterSeconds`が含まれます。コードが未知の場合は、`exitCode`で判断してください。

## 終了コード {#exit-codes}

| コード | 意味                                                                              |
| ------ | --------------------------------------------------------------------------------- |
| 0      | 成功                                                                              |
| 2      | 引数または設定が正しくない                                                        |
| 3      | キーがない、またはアクセスが拒否された（401、403）                                |
| 4      | HTTPまたはネットワークのエラー、タイムアウト、サーバーの混雑、見つからない        |
| 5      | 整合性エラー（SHA-256の不一致、422 `integrity_mismatch`）                         |
| 6      | 競合：リビジョン、状態、ロック、既存のファイル、変更されたチェックポイント（409） |
| 7      | ローカルファイルのエラー、またはサーバーからの無効な応答                          |
| 8      | サーバーの容量の上限：クォータ、ディスク、キュー（507 `capacity_exceeded`）       |
| 9      | `backup status`：重大なバックアップ警告が有効になっている                         |
| 130    | 中断された                                                                        |

クライアントが再試行するのは、ネットワーク障害とHTTP 408、429、502、503、504だけで、`--retries`の範囲内で行います。

## トラブルシューティング {#troubleshooting}

| メッセージ                                  | 原因と対処                                                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `credential_required`（終了コード3）        | キーが見つかりません。`--token-file`と`ARKVORY_TOKEN_FILE`を確認してください。`ARKVORY_BASE_URL`を使う場合は、キーも設定してください。          |
| `forbidden`（終了コード3）                  | キーに権限がありません。`doctor`を実行して、権限を確認してください。                                                                            |
| `checkpoint_mismatch`（終了コード6）        | ファイル、サーバー、リポジトリ、オプションが、保存済みのチェックポイントと異なります。元のオプションを使うか、新しい`--state`を使ってください。 |
| `state_locked`（終了コード6）               | 別のプロセスがチェックポイントを使用しているか、クラッシュの後に古い`.lock`が残っています。                                                     |
| `destination_exists`（終了コード6）         | 出力ファイルが存在します。別の名前を選んでください。                                                                                            |
| `put`での`revision_mismatch`（終了コード6） | その間に、誰かがパスを変更しました。パスの履歴を確認してから、どうするかを決めてください。                                                      |
| 終了コード8                                 | クォータまたはディスクが満杯です。管理者に連絡してください。                                                                                    |

## 関連ページ {#related-pages}

- [クライアントとプロトコル](./index)
- [転送](../use/transfers)と[パス指定ファイル](../use/files)
- [TypeScript SDK](./sdk)
- [エラー](../api/errors)
