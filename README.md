# JapanTrainTransit for Even G2

Even G2スマートグラス向けの電車経路案内アプリケーションです。経路検索には [Transit](https://transit.ls8h.com)（`https://api.transit.ls8h.com`）を使用しています。Transit は日本の公共交通情報を提供する非公式・無償の公開APIです。

音声入力で「〇〇から〇〇まで」と話すことで、スマートグラス上に電車の路線名、乗車時間、経由駅、到着予定時刻などの経路検索結果を表示します。

> **注意:** Transit は非公式サービスです。実際の乗車や重要な判断には、各交通事業者の公式情報を必ず確認してください。

## 機能・動作フロー

1. **アイドル画面**: アプリケーション起動後、グラス側面のタッチセンサーをシングルクリックすると音声入力が開始されます。
2. **録音中**: もう一度クリックすると録音が停止し、OpenAI Whisper APIを利用して音声をテキスト化します。
3. **検索中**: 認識された「〇〇から〇〇まで」というテキストを解析し、Transit APIを利用して経路を検索します。
4. **経路リスト表示**: 検索結果として最大3件の経路候補（到着時刻、路線名、所要時間）をグラスにリスト表示します。
5. **詳細表示**: リストから経路を選択（スクロールしてクリック）すると、乗換情報や各区間の発着時刻などの詳細が表示されます。
6. **終了**: ダブルクリックでアプリケーションを終了します。

## セットアップと開発

### 前提条件
- Node.js (v20以上推奨)
- npm
- OpenAI APIキー (音声認識に使用)

### インストール

```bash
git clone https://github.com/TakaakiIchijo/JapanTrainTransit-EvenG2.git
cd JapanTrainTransit-EvenG2
npm install
```

### 開発用サーバーの起動

```bash
# 音声認識を使用するため、環境変数にOpenAI APIキーを設定してください
export VITE_OPENAI_API_KEY=sk-...

npm run dev
```

### シミュレーターでのテスト

Even Hub Simulatorを利用してPC上で動作確認が可能です。音声入力の代わりに、URLパラメータを使用して直接経路検索をテストできます。

```bash
# URLパラメータでデバッグ経路検索（音声入力なし）
evenhub-simulator "http://localhost:5173?from=渋谷&to=新宿" --automation-port 9898
```

## 実機へのデプロイ手順

Even G2実機でアプリケーションを動作させるための手順です。

### 1. アプリケーションのビルドとパッケージング

```bash
# TypeScriptのコンパイルとViteによるビルドを実行
npm run build

# Even Hub CLIを使用してアプリケーションをパッケージ化 (.ehpkファイルが生成されます)
npm run pack
```

ビルドが成功すると、プロジェクトディレクトリに `transit-g2.ehpk` ファイルが生成されます。

### 2. Even Hub経由でのインストール

1. Even G2とペアリングされたスマートフォンで、Even Appを開きます。
2. Even App内で「Even Hub」を有効にし、開発者モードをオンにします。
3. スマートフォンとPCを同じWi-Fiネットワークに接続します。
4. Even Hub CLIを使用して、生成された `.ehpk` ファイルをグラスにインストールします。

```bash
# Even Hub CLIでインストール (IPアドレスはEven Appに表示されるものを指定)
evenhub install transit-g2.ehpk --ip <スマートフォンのIPアドレス>
```

インストール完了後、Even G2のメニューからアプリケーションを起動できます。

## 技術仕様と制約

### 利用技術

| 項目 | 内容 |
|------|------|
| SDK | `@evenrealities/even_hub_sdk` |
| 音声入力 | `bridge.audioControl(true)` によるPCM 16kHzデータ取得 + OpenAI Whisper APIによるSTT変換 |
| 経路検索 | [Transit API](https://transit.ls8h.com) (`https://api.transit.ls8h.com`) |
| UI表示 | Even G2 SDKの `TextContainer`（アイドル/検索中/詳細画面）および `ListContainer`（経路リスト画面） |
| ビルド | Vite + TypeScript |

### Transit APIの制約について

Transit APIは、同一フィード（同一路線系統など）内の経路検索のみに対応しています。フィードをまたぐ乗り換え（例：JR東日本から東京メトロへの乗り換えなど）は直接検索できない場合があります。本アプリケーションでは、出発地と目的地それぞれについて最大5件の候補駅を取得し、同一フィードの組み合わせを優先して試行するフォールバック処理を実装することで、この制約を緩和しています。

### バイト数制限への対応

Even G2のSDK仕様において、グラスへ送信する画面データ量が約900バイトを超えると画面がフリーズする問題が知られています。本アプリケーションでは、路線名から括弧内の詳細情報（例：「東海道線（下り（熱海方面））」→「東海道線」）を除去し、各行の文字数を制限することで、安全なデータサイズ内に収まるよう最適化しています。

## ライセンス

本プロジェクトは [MIT License](LICENSE) のもとで公開されています。

### 依存ライブラリ・APIのライセンス

| ライブラリ / API | バージョン | ライセンス |
|---|---|---|
| `@evenrealities/even_hub_sdk` | 0.0.10 | MIT |
| `@evenrealities/evenhub-simulator` | 0.7.3 | MIT |
| `@evenrealities/evenhub-cli` | 0.1.13 | 記載なし |
| `vite` | 5.4.21 | MIT |
| `typescript` | 5.9.3 | Apache 2.0 |

### Transit API について

本アプリケーションは、[Transit](https://transit.ls8h.com)（`https://api.transit.ls8h.com`）の公開APIを利用して経路検索を行っています。Transit は日本の公共交通情報をもとにした非公式・無償のサービスです。

利用規約・免責事項: https://transit.ls8h.com/terms
