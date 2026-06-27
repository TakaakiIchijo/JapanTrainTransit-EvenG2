# transit-g2

Even G2スマートグラス向け電車経路案内アプリ。音声入力で「〇〇から〇〇まで」と話すと、グラスに電車の路線名・乗車時間・経由駅・到着予定時刻を表示する。

## 動作フロー

1. **アイドル画面** — クリックで音声入力開始
2. **録音中** — 再クリックで録音停止 → OpenAI Whisper APIでSTT
3. **検索中** — Transit APIで経路検索（複数候補のフィード優先マッチング）
4. **経路リスト** — 最大3件の候補を表示（路線名・到着時刻・所要時間）
5. **詳細表示** — 選択した経路の乗換情報・各区間の発着時刻を表示

## セットアップ

```bash
npm install

# 環境変数（音声認識に使用）
export VITE_OPENAI_API_KEY=sk-...

npm run dev
```

## シミュレーターでのテスト

```bash
# URLパラメータでデバッグ経路検索（音声入力なし）
evenhub-simulator "http://localhost:5173?from=渋谷&to=新宿" --automation-port 9898
```

## 技術構成

| 項目 | 内容 |
|------|------|
| SDK | `@evenrealities/even_hub_sdk` |
| 音声入力 | `bridge.audioControl(true)` + PCM 16kHz → OpenAI Whisper API |
| 経路検索 | `https://api.transit.ls8h.com/` (Transit API) |
| 表示 | TextContainer（アイドル/検索中/詳細）/ ListContainer（経路リスト） |
| ビルド | Vite + TypeScript |

## Transit APIの制約

同一フィード（同一路線系統）内の経路検索のみ対応。フィードをまたぐ乗り換えは、複数の駅候補を取得して同一フィードの組み合わせを優先する方式で対応している。

## ファイル構成

```
src/
  main.ts      — アプリ本体・イベントハンドラ・状態管理
  transit.ts   — Transit APIクライアント・表示フォーマット
  audio.ts     — 音声入力・PCMバッファ・STT処理
  g2display.ts — Even G2表示ヘルパー（TextContainer/ListContainer）
```
