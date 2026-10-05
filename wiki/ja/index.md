---
layout: home
title: Arkvory
titleTemplate: ドキュメント
hero:
  name: Arkvory
  text: ビルド、パッケージ、大容量ファイルを保管する自前のリポジトリ
  tagline: CIパイプライン、デプロイエージェント、ゲーム開発チームが1台のサーバーを共有できます。サイズを問わず再開できるアップロード、リポジトリごとのアクセス制御、バックアップ、ミラー、11言語対応のコンソールを備えています。
  image:
    src: /arkvory.svg
    alt: ''
  actions:
    - theme: brand
      text: はじめる
      link: /ja/guide/
    - theme: alt
      text: インストール
      link: /ja/install/
    - theme: alt
      text: HTTP API
      link: /ja/api/
features:
  - title: どんなサイズのファイルでも
    details: 数十ギガバイトのアップロードもパートに分けて送信され、接続が切れても続きから再開できます。ダウンロードはRangeリクエストで再開できます。すべてのファイルはSHA-256で検証されます。
    link: /ja/use/transfers
  - title: パッケージとイメージ
    details: バージョン付きのUPackパッケージ、DockerとPodman向けのコンテナーイメージ、ゲームアセット用のGit LFS、npmパッケージとUnityパッケージ、パス指定のファイルを扱えます。
    link: /ja/protocols/
  - title: 説明できるアクセス制御
    details: アカウント、グループ、個人用アクセストークン、そして必要なリポジトリと操作だけに絞ったキーを持つサービスアカウント。サインインとアクセス権の変更は監査されます。
    link: /ja/use/accounts
  - title: ステージとプロモーション
    details: ビルドをテスト済みやリリース済みとしてマークし、別のリポジトリにプロモートできます。デプロイエージェントは、ステージを指定して最新のビルドを取得できます。
    link: /ja/use/promotion
  - title: バックアップとミラー
    details: ローカルディスクやネットワーク共有へ、スケジュール実行され検証もされるバックアップを作成します。ミラーは2つ目のサイトを同期し、1つ目を失ったときに引き継ぎます。
    link: /ja/operate/backups
  - title: 自動で動き続ける
    details: Windowsサービス、Linuxパッケージ、Docker Composeのいずれでも実行できます。クラッシュやハングの後はサービスが自動で再起動し、更新は署名付きで、直前に新しいバックアップを取ってから適用されます。
    link: /ja/operate/self-healing
---
