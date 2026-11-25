---
title: 監視
description: Arkvoryサーバーのヘルスエンドポイント、メトリクス、ログ、コンソールの診断情報、および推奨アラートを説明します。
---

# 監視

Arkvoryは、稼働を確認するヘルスエンドポイント、Prometheusメトリクス、JSON形式のログ行、コンソールの診断情報という4つの情報源を提供します。このページでは各情報源の内容を示し、最後に導入時に使えるアラートを紹介します。

メトリクス、ヘルスエンドポイント、ログイベントは、1つのAPIプロセスの状態を表します。ワーカーとバックアップエージェントにはHTTPポートがありません。これらはログ行、完了キューのメトリクス、バックアップの状態を通じて確認します。

## サーバーを今すぐ確認する {#quick-check}

1. 公開ステータスエンドポイントに問い合わせます。キーは不要です。

   ```bash
   curl -fsS http://127.0.0.1:8080/health/status
   ```

   HTTP 200と`{"status":"ready"}`が返れば、APIがデータベースとストレージディレクトリにアクセスできています。

2. インストーラーが作成したヘルスキーを使い、準備状態の完全な応答を取得します。

   ```bash
   sudo sh -c 'curl -fsS -H "Authorization: Bearer $(cat /opt/proanima-arkvory/config/health-token.txt)" http://127.0.0.1:8080/health/ready'
   ```

   ```powershell
   $root = 'C:\ProgramData\ProAnima\Arkvory'
   $key = (Get-Content "$root\config\health-token.txt" -Raw).Trim()
   Invoke-RestMethod -Headers @{ Authorization = "Bearer $key" } http://127.0.0.1:8080/health/ready
   ```

3. バックアップを確認します。

   ```bash
   arkvoryctl backup status
   ```

   このコマンドには回復キーまたは管理者のセッションが必要です。重大な警告が有効な場合は終了コード9で終了します。無人での確認には、後述のPrometheusアラートを使用してください。[コマンドライン](../protocols/cli)を参照してください。

4. サービスと最新のログ行を確認します。[ログ](#logs)を参照してください。

`arkvory status --root <root>`は、インストール済みバージョン、インストールモード、更新ポリシーを表示します。サーバーの稼働確認は行いません。`arkvoryctl doctor`は、1つのキーに対するサーバー、リポジトリ、機能、権限を表示します。これはクライアントの確認であり、ヘルスチェックではありません。

## 稼働と準備状態 {#health}

APIポートで3つのエンドポイントが応答します。いずれもリクエスト枠`ARKVORY_MAX_REQUESTS`に計上しないため、転送負荷でサーバーが停止しているように見えることはありません。停止前にリクエストをドレインしている間も、3つとも応答を続けます。

| パス             | キー             | 応答                                                                                                                | 用途                                    |
| ---------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `/health/live`   | 不要             | プロセスが応答する間は200 `{"status":"ok"}`                                                                         | プロセスの確認                          |
| `/health/status` | 不要             | 200 `{"status":"ready"}`、または`Retry-After: 2`を伴う503 `{"status":"unavailable"}`もしくは`{"status":"draining"}` | ロードバランサーと稼働監視              |
| `/health/ready`  | 任意の有効なキー | 以下の詳細情報を伴う200、またはエラーエンベロープと`Retry-After`を伴う503                                           | デプロイの確認とComposeのヘルスチェック |

`/health/status`と`/health/ready`は3つの条件を確認します。データベースが応答し、このリリースのマイグレーションと正確に一致していること、ストレージディレクトリに`blobs`フォルダーが存在すること、プロセスがストレージロックを引き続き所有していることです。公開監視でデータベースへの問い合わせが増幅しないよう、`/health/status`の結果は1秒間キャッシュします。ドレイン中のサーバーは直ちに`draining`を返します。プロセスに必須のモジュールが失敗した場合（理由`module_failed`）、および読み取りゲートウェイのモジュール計画が書き込みAPIの記録した計画と異なる場合（理由`module_plan_mismatch`）も503を返します。[ARKVORY_MODULES_FILE](../reference/environment#core)を参照してください。比較対象はモジュール、その取得元と設定であり、リリースバージョンではありません。データベーススキーマが同じなら、更新済みの書き込みAPIと併存する前リリースのゲートウェイも準備完了を維持します。

キーがなければ`/health/ready`は401を返します。インストーラーが作成する`deployment-health`キーには、リポジトリ権限も管理者権限もありません。秘密情報は`config/health-token.txt`にあります。

`/health/ready`の200応答には、次のフィールドがあります。

| フィールド        | 意味                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`          | 200応答では常に`ready`                                                                                                                                                                                                                                                                                                                       |
| `writable`        | ストレージボリュームの空き容量が`ARKVORY_STORAGE_RESERVE_BYTES`未満の場合、および読み取りゲートウェイでは`false`。読み取りは引き続き利用可能                                                                                                                                                                                                 |
| `replication`     | [HAクラスター](./cluster)のみ。`copies`、`required`、`singleCopyUntil`を含み、コピーを読み取れない場合は`null`。コピー不足の間は`writable`が`false`                                                                                                                                                                                          |
| `role`            | `api`、または読み取りゲートウェイの場合は`reader`                                                                                                                                                                                                                                                                                            |
| `sharedDownloads` | 読み取りゲートウェイのリース（`slot`、`slots`、`active`、`leaseSeconds`）、または`null`                                                                                                                                                                                                                                                      |
| `transfers`       | `uploads`と`downloads`について、`admission`（`active`、`waiting`、`capacity`、`perPrincipalCapacity`、`waitingCapacity`、`perPrincipalWaitingCapacity`、`timeoutMs`、`rejected`、`timedOut`、`cancelled`）と`bandwidth`（`bytesPerSecond`、`perPrincipalBytesPerSecond`、`burstBytes`、`perPrincipalBurstBytes`、`waiting`、`grantedBytes`） |

準備状態の確認に失敗しただけで、サービスを再起動することはありません。[自己修復](./self-healing)を参照してください。

## メトリクス {#metrics}

`GET /health/metrics`は、APIプロセスのメトリクスをPrometheusテキスト形式（バージョン0.0.4）で返します。任意の有効なキーで読み取ることができ、サーバーのドレイン中も機能します。収集用に必要最小限の権限を持つサービスキーを作成し、Prometheusだけが読めるファイルに保管してください。

```yaml
scrape_configs:
  - job_name: arkvory
    metrics_path: /health/metrics
    scheme: https
    authorization:
      credentials_file: /etc/prometheus/arkvory.key
    static_configs:
      - targets: ['arkvory.example:443']
```

同梱のアラートルールは名前で対象を選ぶため、ジョブ名は`arkvory`にする必要があります。

値はプロセス単位で、再起動後はゼロから始まります。その際に`arkvory_process_start_time_seconds`が変わります。ラベルの種類は制限されています。`route`はURLではなくルートテンプレートで、`status_class`は`2xx`、`5xx`などです。

| メトリクス                                                                                         | ラベル                                                                  | 意味                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `arkvory_http_requests_total`                                                                      | `method`、`route`、`status_class`                                       | 終了した応答                                                                                                                                                             |
| `arkvory_http_request_duration_seconds`                                                            | 同上                                                                    | 5 ms～1800 sの所要時間ヒストグラム。中断した転送も含む                                                                                                                   |
| `arkvory_http_request_bytes_total`、`arkvory_http_response_bytes_total`                            | `method`、`route`                                                       | ヘッダーを含むソケットのバイト数                                                                                                                                         |
| `arkvory_http_requests_in_flight`                                                                  |                                                                         | 受け付け済みで、応答がまだ開いているリクエスト                                                                                                                           |
| `arkvory_transfer_active`、`arkvory_transfer_queue_depth`                                          | `direction`                                                             | 受け付け済みの転送と、実行枠を待つ転送                                                                                                                                   |
| `arkvory_transfer_admission_failures_total`                                                        | `direction`、`reason`                                                   | 受付で拒否した転送：`rejected`（キュー満杯）、`timed_out`、`cancelled`                                                                                                   |
| `arkvory_download_sessions_active`、`arkvory_download_sessions_waiting`                            | `class`                                                                 | 実行枠を保持するダウンロードセッション数と、クラス別の待機セッション数                                                                                                   |
| `arkvory_download_queue_oldest_wait_seconds`                                                       |                                                                         | 最も長く待っているダウンロードの待ち時間                                                                                                                                 |
| `arkvory_download_session_events_total`                                                            | `event`                                                                 | ダウンロードセッションのイベント：`admitted`、`queued`、`completed`、一時停止後の`released`、範囲境界での`yielded`、未利用で破棄された`no_show`、上限超過による`refused` |
| `arkvory_completion_jobs`                                                                          | `state`（`queued`、`running`）                                          | データベース内のアップロード完了ジョブ                                                                                                                                   |
| `arkvory_completion_oldest_queued_seconds`                                                         |                                                                         | 実行可能な待機ジョブのうち最も古いものの待ち時間                                                                                                                         |
| `arkvory_diagnostic_records_total`                                                                 | `outcome`（`written`、`dropped`、`truncated`、`oversized`）             | 結果別のログ行数                                                                                                                                                         |
| `arkvory_metrics_collection_failures_total`                                                        | `collector`（`jobs`、`backup`、`mirror`、`webhook`、`fleet`、`events`） | データベースを参照するメトリクスの読み取り失敗数                                                                                                                         |
| `arkvory_backup_last_success_timestamp_seconds`                                                    |                                                                         | 最新の完了済み復元ポイントのスナップショット時刻                                                                                                                         |
| `arkvory_backup_agent_last_seen_timestamp_seconds`                                                 |                                                                         | バックアップエージェントの直近のハートビート                                                                                                                             |
| `arkvory_backup_warnings`                                                                          | `code`                                                                  | 警告が有効な間は1、それ以外は0                                                                                                                                           |
| `arkvory_mirror_last_sync_timestamp_seconds`、`arkvory_mirror_last_check_timestamp_seconds`        | `repository`、`mode`                                                    | 最後にソースへの追従を完了した時刻と、最後に変更フィードを読み取った時刻                                                                                                 |
| `arkvory_mirror_failing`                                                                           | `repository`、`mode`                                                    | 最後の同期試行が失敗した状態では1                                                                                                                                        |
| `arkvory_mirror_conflicts`                                                                         | `repository`、`mode`                                                    | 他のエントリの同期を続ける一方、競合により保留したソースのエントリ数                                                                                                     |
| `arkvory_webhook_failing`、`arkvory_webhook_last_success_timestamp_seconds`                        | `subscription`、`repository`                                            | Webhook配信：最後の試行が失敗した状態では1、および最後の`2xx`応答の時刻                                                                                                  |
| `arkvory_events_head_position`、`arkvory_events_oldest_position`                                   |                                                                         | イベントフィードの最新位置と、まだ受け付ける最小カーソル                                                                                                                 |
| `arkvory_events_unsequenced_age_seconds`                                                           |                                                                         | ワーカーによる採番を待つ最古のイベントの経過時間。待機中のイベントがなければ0                                                                                            |
| `arkvory_events_pruned_total`                                                                      |                                                                         | 最後の復元以降に保持処理で削除したイベント数                                                                                                                             |
| `arkvory_tls_certificate_expiry_timestamp_seconds`                                                 |                                                                         | 組み込みHTTPSの証明書の有効期限。組み込みHTTPS使用時のみ存在                                                                                                             |
| `arkvory_build_info`                                                                               | `service`、`version`                                                    | 常に1                                                                                                                                                                    |
| `arkvory_module_info`                                                                              | `module`、`kind`、`source`                                              | このプロセスの各モジュールについて常に1。実行中のものと、失敗または拒否された署名付きモジュールが対象。無効なモジュールには時系列データがない                            |
| `arkvory_module_up`                                                                                | `module`                                                                | モジュールの報告が`ok`の間は1、縮退または失敗している間、および署名付きモジュールが読み込まれなかった場合は0                                                             |
| `arkvory_storage_backend_up`                                                                       | `backend`                                                               | このプロセスのストレージボリュームが開かれて応答している間は1、利用不可または無効の間は0。[複数のボリューム](./storage#volumes)を参照                                    |
| `arkvory_storage_backend_accepting`                                                                | `backend`                                                               | ストレージが新規アップロードを受け付ける間は1、代わりに`default`に配置する間は0                                                                                          |
| `arkvory_storage_placement_fallback_total`                                                         | `backend`、`reason`                                                     | 配置先ストレージがデータを受け付けなかったため、`default`に作成した新規アップロード。`reason`は`not_accepting`、`read_only`、`disabled`、`unavailable`、`not_loaded`     |
| `arkvory_storage_backend_unconfigured`                                                             | `backend`                                                               | このインストールのデータを保持したものの、現在は設定されていないボリュームは1。そのファイルは読み取り、物理クリーンアップ、バックアップができない                        |
| `arkvory_process_start_time_seconds`、`arkvory_process_resident_memory_bytes`                      |                                                                         | 開始時刻と常駐メモリ                                                                                                                                                     |
| `arkvory_database_pool_connections`、`arkvory_database_pool_idle`、`arkvory_database_pool_waiting` | `pool`（`queries`、`sessions`、`locks`、`module-readers`）              | データベースプールの接続数：開いている接続、アイドル接続、待機している呼び出し元。待機数が長時間ゼロを超える場合はプールが小さすぎる                                     |
| `arkvory_fleet_site_up`                                                                            | `site`、`name`                                                          | コントローラー上：管理対象サイトへの最後の読み取りに応答があれば1、それ以外は0                                                                                           |
| `arkvory_fleet_site_last_seen_timestamp_seconds`                                                   | `site`、`name`                                                          | コントローラー上：管理対象サイトが最後に応答した時刻                                                                                                                     |
| `arkvory_fleet_mirror_lag_changes`                                                                 | `site`、`repository`                                                    | コントローラー上：管理対象サイトのミラーがソースから遅れている変更件数。サイトが応答しない間は、サイトの最終報告値を使用                                                 |
| `arkvory_fleet_mirror_lag_alert_changes`                                                           |                                                                         | コントローラー上：ミラーの警告を発生させる遅延`ARKVORY_FLEET_LAG_ALERT`（デフォルト1000）。`ArkvoryFleetMirrorBehind`がこの値と比較                                      |
| `arkvory_fleet_alerts`                                                                             | `severity`、`kind`                                                      | コントローラー上：[サイト](./sites#alerts)ページのアラート。このインストール自身も含む                                                                                   |

データベースを参照するメトリクス（完了、バックアップ、ミラー）は、最短5秒間隔で読み取ります。読み取りに失敗すると、古い値を表示する代わりにこれらのメトリクスを省き、`arkvory_metrics_collection_failures_total`が増えます。管理対象サイトのメトリクス（`arkvory_fleet_*`）は例外で、コントローラーの最後の読み取り結果を維持します。そのため、読み取りの失敗でサイト用アラートルールの`for`期間がリセットされることはありません。

ファイル転送を除いた制御リクエストの99パーセンタイル：

```text
histogram_quantile(0.99, sum by (le) (rate(arkvory_http_request_duration_seconds_bucket{route!~".*(content|parts).*"}[10m])))
```

Arkvoryは、ストレージボリュームやデータベースの空き容量を公開しません。ボリュームには`node_exporter`、PostgreSQLには`postgres_exporter`を使用してください。

## ログ {#logs}

API、ワーカー、バックアップエージェント、メンテナンスツールは、標準出力に1行1つのJSONオブジェクトを書き出します。サーバー自体はログファイルを書き込みません。各プラットフォームのサービスマネージャーがログ行を収集します。

| インストール方式                  | 読み取り先                                                                                                                                                                                                              | ローテーション                           |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Linux（パッケージ、`install.sh`） | `journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup`。管理対象データベースは`arkvory-database`、更新サービスは`arkvory-update`                                                                               | journaldで設定                           |
| Windows                           | インストールルート内の`logs\arkvory-api.out.log`、`arkvory-worker.out.log`、`arkvory-backup.out.log`。エラー出力は隣の`.err.log`ファイル。更新サービスは`logs\updater.log`、データベースサービスは`database\`に書き込む | 1ファイル20 MiB、旧ファイルを5個保持     |
| Docker Compose                    | `docker logs --tail 100 proanima-arkvory-api-1`。`-worker-1`と`-backup-1`も同様                                                                                                                                         | 1ファイル20 MiB、コンテナごとに5ファイル |

ハングしたプロセスは、標準エラーに`process.stalled`を記録して終了します。そのため、`.err.log`ファイルやジャーナルも確認してください。`logs\`内の他のファイルについては[Windows](../install/windows#logs)を参照してください。

各行は共通のフィールドで始まります。

| フィールド                   | 値                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `timestamp`                  | ISO 8601形式のUTC時刻                                                                                      |
| `level`                      | `debug`、`info`、`warning`、`error`                                                                        |
| `service`                    | `api`、`worker`、`backup`、`migrate`、`gc`、`scrub`                                                        |
| `version`、`pid`、`hostname` | リリース、プロセス、ホスト                                                                                 |
| `component`                  | `api`、`http`、`storage`、`worker`、`maintenance`、`backup`、`mirror`、`migrate`、`process`、`diagnostics` |
| `code`                       | イベント名                                                                                                 |

その他のフィールドも固定リストから選びます。識別子（`requestId`、`traceId`、`jobId`、`uploadId`、`artifactId`、`repository`、`principal`、`clientIp`、`client`）、数値（`status`、`durationMs`、`bytesSent`、`bytesReceived`、`attempts`）、理由フィールド（`errorCode`、`errorName`、`errno`、`sqlstate`、`reason`）です。`ARKVORY_LOG_LEVEL`で、記録する最低レベルを設定します。

### 主なイベント {#log-events}

| イベント（`code`）                                                                                    | レベル                            | 意味と最初の対処                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api.listening`                                                                                       | info                              | APIがリクエストを処理中。フィールドは`address`、`port`、`tls`                                                                                                                                                                                            |
| `startup.failed`                                                                                      | error                             | APIが起動しなかった。`reason`が原因を示す。[トラブルシューティング](./troubleshooting#server-does-not-start)を参照                                                                                                                                       |
| `worker.unavailable`                                                                                  | error                             | ワーカーが起動しなかった、またはエラーで停止した                                                                                                                                                                                                         |
| `worker.module_plan_mismatch`、`worker.module_plan_changed`                                           | warningまたはerror                | ワーカーのモジュール計画が書き込みAPIの記録と異なり、一致するまで処理を受け付けない。または書き込みAPIの計画が変わり、再起動のためワーカーが停止した。すべてのプロセスに同じ`ARKVORY_MODULES_FILE`を設定する                                             |
| `module.refused`、`module.failed`                                                                     | warning（無効なモジュールはinfo） | インストール済みの署名付きモジュールをコード実行前に拒否した、または読み込み・起動に失敗した。`module`が対象、`errorCode`が理由を示す。[モジュール](./modules#load)を参照                                                                                |
| `http.plaintext_exposed`                                                                              | warning                           | APIがループバック以外のアドレスで、TLSも信頼済みプロキシもなしに待ち受けている                                                                                                                                                                           |
| `http.access`                                                                                         | info                              | 完了または中断したリクエストごとに1行                                                                                                                                                                                                                    |
| リクエストのエラーコード（`unavailable`、`internal`など）                                             | 4xxはwarning、5xxはerror          | 失敗したリクエスト。`requestId`、`route`、`status`を含み、システムエラーでは`errorName`、`errno`、`sqlstate`も含む                                                                                                                                       |
| `upload.input_timeout`、`upload.deadline`                                                             | warning                           | アップロードがデータ送信を停止した、または`ARKVORY_UPLOAD_DEADLINE_MS`を超過した                                                                                                                                                                         |
| `api.ownership_lost`、`worker.ownership_lost`                                                         | error                             | ストレージの所有権を保証するデータベースセッションが切れた。プロセスは終了して再起動する                                                                                                                                                                 |
| `process.handles_left`                                                                                | warning                           | 停止済み、または起動に失敗したプロセスが、モジュールコードの残した処理により動き続けていたため、それでも終了した                                                                                                                                         |
| `process.stalled`                                                                                     | error                             | ウォッチドッグがハングしたプロセスを終了した。フィールドは`stalledSeconds`                                                                                                                                                                               |
| `process.unhandled`                                                                                   | error                             | 予期しないエラーでプロセスが終了した                                                                                                                                                                                                                     |
| `process.watchdog_failed`                                                                             | warning                           | ウォッチドッグを起動できなかった。サービスはウォッチドッグなしで稼働する                                                                                                                                                                                 |
| `drain.started`、`drain.settled`、`drain.timeout`、`api.stopped`                                      | infoまたはwarning                 | 正常な停止処理。`drain.timeout`はリクエストを打ち切ったことを示す                                                                                                                                                                                        |
| `tls.reloaded`、`tls.reload_failed`、`tls.expiring`                                                   | infoまたはwarning                 | 証明書ファイルを再読み込みした、読み取れなかった、または有効期限まで14日未満になった。`tls.expiring`は1日1回繰り返す                                                                                                                                     |
| `completion.completed`、`completion.failed`、`completion.lease_lost`、`completion.attempts_exhausted` | infoまたはerror                   | アップロード完了ジョブの結果。`jobId`、`uploadId`、`errorCode`を含む                                                                                                                                                                                     |
| `backup.agent.started`、`backup.agent.standby`、`backup.agent.lease_lost`                             | infoまたはwarning                 | バックアップエージェントの状態                                                                                                                                                                                                                           |
| `backup.request.failed`、`backup.request.requeued`、`backup.failed`                                   | errorまたはwarning                | バックアップジョブが失敗した、または再実行する。フィールドは`errorCode`                                                                                                                                                                                  |
| `mirror.step_failed`、`mirror.recovered`                                                              | warningまたはinfo                 | ミラー同期の処理が失敗した（`errorCode`、`attempts`）、または復旧した                                                                                                                                                                                    |
| `mirror.conflict_set_aside`、`mirror.conflict_resolved`                                               | warningまたはinfo                 | ミラーがソースのエントリを競合で保留した、再試行して再び失敗した（`artifactId`、`action`、`errorCode`、`attempts`）、またはエントリの競合が解消した                                                                                                      |
| `webhook.step_failed`、`webhook.recovered`                                                            | warningまたはinfo                 | Webhook配信が失敗した（`subscription`、`errorCode`、`attempts`）、または復旧した                                                                                                                                                                         |
| `events.step_failed`、`events.recovered`、`events.pruned`                                             | warningまたはinfo                 | ワーカーがイベントを採番・削除できなかった（`errorCode`、`attempts`）、復旧した、または古いイベントを削除した（`rows`）                                                                                                                                  |
| `tree.index_built`、`tree.index_unavailable`、`tree.index_failed`、`tree.pass_failed`                 | infoまたはwarning                 | ワーカーがアーカイブの目次を読み取った（`entries`）、索引を作成できない（`reason`）、失敗して後で再試行する（`errorCode`、`attempts`、`retryInSeconds`）、または一巡の処理を実行できなかった。[ディレクトリツリー](../use/trees#table-of-contents)を参照 |
| `migrate.started`、`migrate.completed`、`migrate.failed`                                              | infoまたはerror                   | 更新時のデータベースマイグレーション                                                                                                                                                                                                                     |
| `diagnostics.dropped`、`diagnostics.oversized`                                                        | warning                           | ログの読み取り側が遅すぎるため行を破棄した、または行が長すぎた                                                                                                                                                                                           |

ログの読み取りが遅くても、転送が遅くなることはありません。出力が詰まると、サーバーは行を破棄して数を記録し、出力が再開した後にその件数を`diagnostics.dropped`で記録します。4096文字を超える行は`diagnostics.oversized`に置き換えます。テキストフィールドは256文字で切り詰めます。

### リクエストID {#request-ids}

すべての応答に`X-Request-Id`ヘッダーが付き、すべてのエラー本文に`requestId`フィールドがあります。同じ値を、`http.access`行、エラー行、そのリクエストが開始した完了ジョブのログ行、監査記録に含めます。問題を報告するクライアントは、この値だけを伝えれば追跡できます。

```bash
journalctl -u arkvory-api -u arkvory-worker --since "1 hour ago" -o cat | grep 'REQUEST_ID'
```

```powershell
Select-String -Path "$root\logs\*.log" -Pattern 'REQUEST_ID'
```

リバースプロキシの背後では、`ARKVORY_TRUSTED_PROXIES`内のアドレスから来た`X-Request-Id`だけを受け入れます。また、8～128文字の単一の値で、英字、数字、`.`、`_`、`:`、`-`だけを含む必要があります。nginxの`proxy_set_header X-Request-Id $request_id;`などを使い、プロキシにヘッダーを上書きさせてください。任意のクライアントからの有効なW3C `traceparent`ヘッダーは、`traceId`フィールドになります。検索用であり、権限を付与するものではありません。

### ログに記録しないもの {#never-logged}

ログには、パスワード、キー、トークン、`Authorization`ヘッダー、リクエスト本文、クエリ文字列、URL、例外メッセージを記録しません。ダウンロードリンクはクエリ文字列に秘密情報を含むため、ルートテンプレートだけを記録します。自由記述は`reason`フィールドだけで、機密情報をマスクし、240文字で切り詰めます。ログ行には`principal`（アカウントまたはキーのID）と`clientIp`を表示します。ログは個人データとして扱ってください。

`ARKVORY_ACCESS_LOG=false`で`http.access`を無効にします。`/health/live`と`/health/status`への成功したリクエストは記録しません。ログレベルを`warning`または`error`にした場合も、アクセスログ行は出力しません。

## コンソールの診断情報 {#console}

管理者はシェルを使わず、コンソールでサーバーの状態を確認できます。[Webコンソール](../guide/console)を参照してください。

| 場所                                    | 表示内容                                                                                                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [[ui:backups]]                          | 見出しの状態は[[ui:backupStateOk]]、[[ui:backupStateWarning]]、[[ui:backupStateCritical]]。その下に[[ui:backupNewest]]のバックアップ、[[ui:backupNextRun]]、[[ui:backupAgent]]、[[ui:backupVault]]、各警告とその対処を一覧表示 |
| [[ui:updates]]                          | インストール済みバージョンと最新バージョン、最後の確認時刻、ホスト更新サービスの状態                                                                                                                                           |
| リポジトリの[[ui:repositoryStorage]]    | クォータ使用量と[[ui:storageWarning]]、[[ui:storageCritical]]の状態、および[[ui:storageEvents]]の一覧                                                                                                                          |
| サービスアカウントの[[ui:serviceAudit]] | 誰が何を作成、変更、発行、取り消ししたか                                                                                                                                                                                       |
| リポジトリのカード                      | [[ui:mirrorBadge]]バッジ。最後の同期が失敗すると[[ui:mirrorFailing]]の状態を表示                                                                                                                                               |

[[ui:storageEvents]]の一覧には、診断情報を読む権限が必要です。他のイベントに加え、そのリポジトリで失敗したサービスキーのリクエストを、リクエストID、ルート、ステータスとともに表示します。

管理者が変更しない限り、クォータのしきい値は警告が80 %、重大状態が95 %です。クォータのないリポジトリにはしきい値もありません。

## ストレージとディスクの警告 {#storage}

サーバーは、データベース、ログ、システムのために、ストレージボリュームに`ARKVORY_STORAGE_RESERVE_BYTES`（デフォルト1 GiB）の空き容量を残します。この予備領域を下回ると：

- `/health/ready`は`"writable": false`を報告しますが、引き続き200を返します。
- アップロードは507と理由`storage_full`で失敗します。ダウンロードとコンソールは引き続き利用できます。

サーバーは、監視用の空き容量測定を提供しません。ストレージ、データベース、バックアップの各ボリュームを独自のツールで監視し、予備領域に達する前に通知するようにしてください。予備領域はクォータではありません。`ARKVORY_CAPACITY_BYTES`は予約済みコンテンツの合計を制限するもので、ディスクの確認ではありません。[ストレージ](./storage)を参照してください。

## バックアップの健全性 {#backup-health}

バックアップエージェントは、リースを更新するたびにハートビートを送信します。APIは、そのハートビートとバックアップジョブの履歴から、固定コードを持つ警告を生成します。各コードへの対処は[バックアップ](./backups)を参照してください。

| コード                                                                          | 重大度 | 条件                                                                             |
| ------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------- |
| `agent_offline`                                                                 | 重大   | 2分間ハートビートがない                                                          |
| `backup_stale`                                                                  | 重大   | 計画が有効で、最新ポイントの経過時間が26時間を超える                             |
| `vault_unavailable`                                                             | 重大   | 保管庫のボリュームが未マウント、`vault.json`がない、または書き込めない           |
| `verify_failed`                                                                 | 重大   | 復元ポイントの検証に失敗した                                                     |
| `vault_not_configured`、`schedule_disabled`、`no_backup_yet`、`last_run_failed` | 警告   | 保管庫がない、計画が無効、最初のバックアップがない、直近のバックアップが失敗した |
| `vault_low_space`                                                               | 警告   | 保管庫の空き容量が10 %未満、または直近ポイントで追加した新規バイト数の2倍未満    |
| `never_deep_verified`                                                           | 警告   | 完全検証を8日超実行していない                                                    |

メトリクス`arkvory_backup_warnings`にも同じコードを使用します。バックアップの経過時間は、完了時刻ではなくスナップショット時刻から数えます。

## 推奨アラート {#alerts}

リリースには、すぐに使えるPrometheusルールが`releases/<version>/deploy/monitoring/arkvory-alerts.yml`に含まれます。このファイルを`prometheus.yml`の`rule_files`に追加してください。しきい値は初期値です。実測したトラフィックに合わせて調整してください。

| アラート                                                        | 条件                                                                                            | 重大度     |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------- |
| `ArkvoryDown`                                                   | メトリクス収集が2分間失敗                                                                       | 重大       |
| `ArkvoryHighServerErrorRate`                                    | 応答の5 %超が5xxの状態が10分間続く                                                              | 警告       |
| `ArkvorySlowMetadataRequests`                                   | 制御リクエストの99パーセンタイルが2 sを超える状態が15分間続く                                   | 警告       |
| `ArkvoryCompletionBacklog`                                      | 最古の待機中完了ジョブの待ち時間が10分を超える                                                  | 警告       |
| `ArkvoryTransferAdmissionRejections`                            | 拒否またはタイムアウトした転送が毎秒0.1件を超える状態が15分間続く                               | 警告       |
| `ArkvoryDiagnosticsDropped`                                     | 過去15分間にログ行を破棄した                                                                    | 警告       |
| `ArkvoryMetricsCollectionFailing`                               | データベースを参照するメトリクスを読み取れなかった                                              | 警告       |
| `ArkvoryTlsCertificateExpiring`、`ArkvoryTlsCertificateExpired` | 組み込み証明書の有効期限まで14日未満、または期限切れ                                            | 警告、重大 |
| `ArkvoryBackupStale`                                            | 最新ポイントの経過時間が26時間を超える                                                          | 重大       |
| `ArkvoryBackupAgentOffline`                                     | ハートビートが2分超ない状態が5分間続く                                                          | 重大       |
| `ArkvoryBackupWarning`                                          | `vault_unavailable`または`verify_failed`が10分間続く                                            | 重大       |
| `ArkvoryMirrorStale`                                            | ミラーが1時間ソースに追従完了していない                                                         | 警告       |
| `ArkvoryMirrorFailing`                                          | ミラーの最後の同期が失敗した状態が15分間続く                                                    | 警告       |
| `ArkvoryMirrorConflicts`                                        | ミラーに保留されたソースのエントリがある状態が30分間続く                                        | 警告       |
| `ArkvoryRestartLoop`                                            | APIプロセスが30分間に3回以上再起動                                                              | 警告       |
| `ArkvoryWebhookFailing`                                         | Webhook配信の失敗が15分間続く                                                                   | 警告       |
| `ArkvoryEventSequencerStalled`                                  | イベントのワーカーによる採番待ちが2分を超える                                                   | 警告       |
| `ArkvoryFleetSiteDown`                                          | 管理対象サイトがコントローラーに5分間応答しない                                                 | 重大       |
| `ArkvoryFleetMirrorBehind`                                      | 管理対象サイトのミラーの遅延が`ARKVORY_FLEET_LAG_ALERT`（デフォルト1000）以上の状態が30分間続く | 警告       |
| `ArkvoryFleetCritical`                                          | コントローラーのサイトページに重大アラートが5分間表示され続ける                                 | 重大       |
| `ArkvoryStorageVolumeUnconfigured`                              | データを保持するボリュームが設定から10分間欠落                                                  | 重大       |

Arkvoryは次のデータを公開しないため、これらのアラートは自分で追加してください。

| アラート                                                       | 情報源                       | 理由                                                                       |
| -------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------- |
| ストレージ、データベース、バックアップの各ボリュームの空き容量 | `node_exporter`              | ディスクが満杯になると、アップロード、データベース、バックアップが停止する |
| PostgreSQLが停止している、または接続数が多すぎる               | `postgres_exporter`          | データベースが利用できない間、APIは終了と再起動を繰り返す                  |
| 公開ステータスが`ready`ではない                                | `/health/status`への外部監視 | クライアントから見たネットワーク経路、プロキシ、証明書を確認               |

ボリュームとPostgreSQL向けに、リリースには`node_exporter`と`postgres_exporter`用のルールが`deploy/monitoring/arkvory-host-alerts.yml`に含まれます。ファイルを読み込む前に、`mountpoint`の式を自分のボリュームに合わせて置き換えてください。

アラートは一度テストしてください。例えば`arkvory-backup`を停止すると、約7～8分後に`ArkvoryBackupAgentOffline`が発火します（ハートビートなしの2分、ルールの5分、さらに収集間隔）。

## 関連ページ {#related-pages}

- [自己修復](./self-healing)
- [トラブルシューティング](./troubleshooting)
- [バックアップ](./backups)
- [環境変数](../reference/environment)
- [エラー](../api/errors)
