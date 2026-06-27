// Transit G2 - メインエントリーポイント
// Even G2スマートグラス向け電車経路案内アプリ

import { waitForEvenAppBridge, OsEventTypeList } from '@evenrealities/even_hub_sdk';
import { PcmBuffer, transcribeWav, parseRoute } from './audio';
import { suggestStation, suggestStations, planJourney, planJourneyWithFallback, journeyToSummary, journeyToLines } from './transit';
import {
  createInitialState,
  renderScreen,
  isClickEvent,
  isDoubleClickEvent,
  getListSelectedIndex,
  G2DisplayState,
} from './g2display';

// ─── UI要素 ──────────────────────────────────────────────
const statusEl = document.getElementById('status')!;
const logEl = document.getElementById('log')!;
const micBtn = document.getElementById('mic-btn') as HTMLButtonElement;

// OpenAI APIキー（環境変数から取得 or 設定画面から入力）
// Viteのimport.meta.envを使用
const OPENAI_API_KEY = (import.meta as any).env?.VITE_OPENAI_API_KEY ?? '';

// ─── ログ ─────────────────────────────────────────────────
function log(msg: string): void {
  console.log(msg);
  const time = new Date().toLocaleTimeString('ja-JP');
  logEl.textContent = `[${time}] ${msg}\n` + logEl.textContent;
  // 最大50行
  const lines = logEl.textContent.split('\n');
  if (lines.length > 50) logEl.textContent = lines.slice(0, 50).join('\n');
}

function setStatus(msg: string): void {
  statusEl.textContent = msg;
  log(msg);
}

// ─── アプリ状態 ───────────────────────────────────────────
const state: G2DisplayState = createInitialState();
let bridge: Awaited<ReturnType<typeof waitForEvenAppBridge>> | null = null;
const pcmBuffer = new PcmBuffer();
let isRecording = false;
// 録音タイムアウト: 8秒で自動停止
let recordingTimer: ReturnType<typeof setTimeout> | null = null;

// ─── G2レンダリングラッパー ───────────────────────────────
async function render(): Promise<void> {
  if (!bridge) return;
  await renderScreen(bridge, state, log);
}

// ─── 音声録音の開始 ───────────────────────────────────────
async function startRecording(): Promise<void> {
  if (isRecording || !bridge) return;
  isRecording = true;
  pcmBuffer.clear();
  state.appState = 'listening';
  micBtn.classList.add('active');
  micBtn.textContent = '⏹ 録音停止';
  setStatus('🎤 録音中... 「〇〇から〇〇まで」と話してください');
  await render();

  await bridge.audioControl(true);
  log('[Audio] マイクON');

  // 8秒で自動停止
  recordingTimer = setTimeout(() => {
    void stopRecordingAndProcess();
  }, 8000);
}

// ─── 音声録音の停止 + STT + 経路検索 ─────────────────────
async function stopRecordingAndProcess(): Promise<void> {
  if (!isRecording || !bridge) return;
  isRecording = false;
  micBtn.classList.remove('active');
  micBtn.textContent = '🎤 音声入力開始';

  if (recordingTimer) {
    clearTimeout(recordingTimer);
    recordingTimer = null;
  }

  await bridge.audioControl(false);
  log(`[Audio] マイクOFF (${pcmBuffer.byteLength} bytes)`);

  if (pcmBuffer.byteLength < 3200) {
    // 0.1秒未満は無効
    setStatus('録音が短すぎます。もう一度お試しください。');
    state.appState = 'idle';
    await render();
    return;
  }

  // STT処理
  state.appState = 'processing';
  setStatus('🔍 音声を解析中...');
  await render();

  let transcript = '';
  try {
    const wavBlob = pcmBuffer.toWavBlob();
    log(`[STT] WAV size: ${wavBlob.size} bytes`);

    if (!OPENAI_API_KEY) {
      // APIキーなし: デモ用フォールバック
      transcript = await promptFallback();
    } else {
      transcript = await transcribeWav(wavBlob, OPENAI_API_KEY);
    }
    log(`[STT] 認識結果: "${transcript}"`);
    setStatus(`認識: "${transcript}"`);
  } catch (e) {
    log(`[STT] エラー: ${e}`);
    state.appState = 'error';
    state.errorMessage = 'STTエラー';
    await render();
    return;
  }

  // 「〇〇から〇〇まで」パース
  const { from, to } = parseRoute(transcript);
  if (!from || !to) {
    setStatus(`「〇〇から〇〇まで」の形式で話してください\n認識: "${transcript}"`);
    state.appState = 'error';
    state.errorMessage = '出発地・目的地を認識できません';
    await render();
    return;
  }

  log(`[Route] from="${from}" to="${to}"`);
  // runRouteSearchに委譲
  await runRouteSearch(from, to);
}

// ─── APIキーなし時のフォールバック（デモ用） ──────────────
async function promptFallback(): Promise<string> {
  const input = window.prompt('音声認識の代わりに入力してください（例: 渋谷から新宿まで）');
  return input ?? '';
}

// ─── イベントハンドラ ─────────────────────────────────────
function setupEventHandlers(): void {
  if (!bridge) return;

  bridge.onEvenHubEvent(async (event) => {
    log(`[Event] ${JSON.stringify(event).slice(0, 100)}`);

    // ダブルクリック: アプリ終了（Even Hub審査要件）
    if (isDoubleClickEvent(event)) {
      log('[Event] ダブルクリック → アプリ終了');
      await bridge!.shutDownPageContainer(1);
      return;
    }

    // シングルクリック
    if (isClickEvent(event)) {
      await handleClick(event);
      return;
    }

    // リスト選択（スクロール後のクリック）
    const listIdx = getListSelectedIndex(event);
    if (listIdx !== null && state.appState === 'result_list') {
      state.selectedIndex = listIdx;
      state.appState = 'result_detail';
      log(`[Event] リスト選択: index=${listIdx}`);
      await render();
    }
  });
}

async function handleClick(event: any): Promise<void> {
  switch (state.appState) {
    case 'idle': {
      // 音声入力開始
      await startRecording();
      break;
    }

    case 'listening': {
      // 録音停止
      await stopRecordingAndProcess();
      break;
    }

    case 'result_list': {
      // リスト選択 → 詳細表示
      const listIdx = getListSelectedIndex(event);
      if (listIdx !== null) {
        state.selectedIndex = listIdx;
      }
      state.appState = 'result_detail';
      log(`[Click] 詳細表示: index=${state.selectedIndex}`);
      await render();
      break;
    }

    case 'result_detail': {
      // 詳細 → リストに戻る
      state.appState = 'result_list';
      await render();
      break;
    }

    case 'error':
    case 'processing': {
      // エラー/検索中 → 待機に戻る
      state.appState = 'idle';
      await render();
      break;
    }
  }
}

// ─── WebUIのマイクボタン ──────────────────────────────────
micBtn.addEventListener('click', async () => {
  if (!bridge) {
    setStatus('G2に接続されていません');
    return;
  }
  if (isRecording) {
    await stopRecordingAndProcess();
  } else {
    await startRecording();
  }
});

// ─── PCMデータ受信 ────────────────────────────────────────
function setupAudioHandler(): void {
  if (!bridge) return;
  bridge.onEvenHubEvent((event) => {
    if (event.audioEvent && isRecording) {
      pcmBuffer.append(event.audioEvent.audioPcm);
      if (pcmBuffer.isFull) {
        log('[Audio] バッファ満杯 → 自動停止');
        void stopRecordingAndProcess();
      }
    }
  });
}

// ─── デバッグ: URLパラメータで経路検索をトリガー ────────────
// ?from=渋谷&to=新宿 のようにURLパラメータを指定すると自動検索
async function checkDebugParams(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const fromParam = params.get('from');
  const toParam = params.get('to');
  if (fromParam && toParam) {
    log(`[Debug] URLパラメータ: from=${fromParam} to=${toParam}`);
    await runRouteSearch(fromParam, toParam);
  }
}

/**
 * 経路検索を直接実行する（STTをスキップ）
 */
async function runRouteSearch(from: string, to: string): Promise<void> {
  state.appState = 'processing';
  setStatus(`🔍 ${from} → ${to} を検索中...`);
  await render();

  // 複数候補を取得して同一フィードの組み合わせを優先検索
  const [fromStations, toStations] = await Promise.all([
    suggestStations(from, 5),
    suggestStations(to, 5),
  ]);

  if (fromStations.length === 0) {
    state.appState = 'error';
    state.errorMessage = `「${from}」が見つかりません`;
    setStatus(state.errorMessage);
    await render();
    return;
  }
  if (toStations.length === 0) {
    state.appState = 'error';
    state.errorMessage = `「${to}」が見つかりません`;
    setStatus(state.errorMessage);
    await render();
    return;
  }

  log(`[Route] from candidates: ${fromStations.map(s => s.name + '(' + s.id.split(':')[0] + ')').join(', ')}`);
  log(`[Route] to candidates: ${toStations.map(s => s.name + '(' + s.id.split(':')[0] + ')').join(', ')}`);

  const result = await planJourneyWithFallback(fromStations, toStations, 3);
  if (!result) {
    state.appState = 'error';
    state.errorMessage = '経路が見つかりません';
    setStatus(state.errorMessage);
    await render();
    return;
  }

  const { plan, fromStation, toStation } = result;
  log(`[Plan] ${plan.journeys.length}件の経路 (${fromStation.name}→${toStation.name})`);
  state.journeyList = plan.journeys.map((j, i) =>
    `${i + 1}. ${journeyToSummary(j)}`
  );
  state.journeyDetails = plan.journeys.map(j => journeyToLines(j));
  state.selectedIndex = 0;
  state.appState = 'result_list';
  setStatus(`${fromStation.name}→${toStation.name}: ${plan.journeys.length}件`);
  await render();
}

// ─── 起動 ─────────────────────────────────────────────────
async function main(): Promise<void> {
  setStatus('G2への接続を待機中...');
  log('[App] 起動');

  try {
    bridge = await waitForEvenAppBridge();
    log('[App] EvenAppBridge 接続完了');
    setStatus('G2に接続しました');

    setupAudioHandler();
    setupEventHandlers();

    // 起動ソース判定
    bridge.onLaunchSource((source) => {
      log(`[App] 起動ソース: ${source}`);
    });

    // 初期画面を表示
    state.appState = 'idle';
    await render();
    setStatus('準備完了 - クリックで音声入力');

    // デバッグ: URLパラメータがあれば自動検索
    await checkDebugParams();
  } catch (e) {
    log(`[App] 初期化エラー: ${e}`);
    setStatus(`初期化エラー: ${e}`);
  }
}

void main();
