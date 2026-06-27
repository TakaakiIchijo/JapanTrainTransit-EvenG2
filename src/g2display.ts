// Even G2 表示モジュール
// TextContainer / ListContainer を使ったUI管理

import {
  EvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
  StartUpPageCreateResult,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk';

// グラスの解像度
const GLASS_W = 576;
const GLASS_H = 288;

// アプリの状態
type AppState =
  | 'idle'          // 待機中（音声入力待ち）
  | 'listening'     // 録音中
  | 'processing'    // STT + 経路検索中
  | 'result_list'   // 経路リスト表示中
  | 'result_detail' // 経路詳細表示中
  | 'error';        // エラー表示

export interface G2DisplayState {
  appState: AppState;
  initialized: boolean;
  journeyList: string[];       // ListContainer用サマリー
  journeyDetails: string[][];  // 各journeyの詳細行
  selectedIndex: number;
  errorMessage: string;
}

export function createInitialState(): G2DisplayState {
  return {
    appState: 'idle',
    initialized: false,
    journeyList: [],
    journeyDetails: [],
    selectedIndex: 0,
    errorMessage: '',
  };
}

/**
 * テキストコンテナ（全画面）を作成する
 */
function makeTextContainer(lines: string[]): TextContainerProperty {
  // 最大15行、各行最大15文字に制限（バイト数上限対策）
  const safeLines = lines.slice(0, 15).map(l => l.slice(0, 15));
  const content = safeLines.join('\n');

  return new TextContainerProperty({
    containerID: 1,
    containerName: 'main-text',
    xPosition: 0,
    yPosition: 0,
    width: GLASS_W,
    height: GLASS_H,
    content,
    isEventCapture: 1,
  });
}

/**
 * リストコンテナを作成する
 */
function makeListContainer(items: string[]): ListContainerProperty {
  // 最大12項目に制限
  const safeItems = items.slice(0, 12).map(s => s.slice(0, 20));

  return new ListContainerProperty({
    containerID: 1,
    containerName: 'route-list',
    xPosition: 0,
    yPosition: 0,
    width: GLASS_W,
    height: GLASS_H,
    borderWidth: 1,
    borderColor: 13,
    borderRadius: 4,
    paddingLength: 4,
    isEventCapture: 1,
    itemContainer: new ListItemContainerProperty({
      itemCount: safeItems.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: safeItems,
    }),
  });
}

/**
 * 画面を描画する（初回/更新を自動判定）
 */
export async function renderScreen(
  bridge: EvenAppBridge,
  state: G2DisplayState,
  log: (msg: string) => void
): Promise<void> {
  let containers: {
    containerTotalNum: number;
    textObject?: TextContainerProperty[];
    listObject?: ListContainerProperty[];
  };

  switch (state.appState) {
    case 'idle': {
      const text = makeTextContainer([
        '🚃 Transit G2',
        '',
        'クリックで音声入力',
        '「〇〇から〇〇まで」',
      ]);
      containers = { containerTotalNum: 1, textObject: [text] };
      break;
    }

    case 'listening': {
      const text = makeTextContainer([
        '🎤 録音中...',
        '',
        '「〇〇から〇〇まで」',
        'と話しかけてください',
        '',
        'クリックで録音停止',
      ]);
      containers = { containerTotalNum: 1, textObject: [text] };
      break;
    }

    case 'processing': {
      const text = makeTextContainer([
        '🔍 検索中...',
        '',
        '経路を検索しています',
      ]);
      containers = { containerTotalNum: 1, textObject: [text] };
      break;
    }

    case 'result_list': {
      if (state.journeyList.length === 0) {
        const text = makeTextContainer(['経路が見つかりません', '', 'クリックで戻る']);
        containers = { containerTotalNum: 1, textObject: [text] };
      } else {
        const list = makeListContainer(state.journeyList);
        containers = { containerTotalNum: 1, listObject: [list] };
      }
      break;
    }

    case 'result_detail': {
      const detail = state.journeyDetails[state.selectedIndex] ?? ['詳細なし'];
      const text = makeTextContainer(detail);
      containers = { containerTotalNum: 1, textObject: [text] };
      break;
    }

    case 'error': {
      const text = makeTextContainer([
        '⚠ エラー',
        '',
        state.errorMessage.slice(0, 14),
        '',
        'クリックで戻る',
      ]);
      containers = { containerTotalNum: 1, textObject: [text] };
      break;
    }

    default: {
      return;
    }
  }

  if (!state.initialized) {
    log('[G2] createStartUpPageContainer');
    const result = await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer(containers)
    );
    log(`[G2] create result: ${result}`);
    if (result === StartUpPageCreateResult.success) {
      state.initialized = true;
    }
  } else {
    log('[G2] rebuildPageContainer');
    // 戻り値に依存せず常に実行（ナレッジ: rebuildの戻り値の罠）
    await bridge.rebuildPageContainer(new RebuildPageContainer(containers));
  }
}

/**
 * イベントハンドラ: クリックイベントを検出する
 * シミュレーター: sysEvent, 実機: textEvent/listEvent
 */
export function isClickEvent(event: any): boolean {
  // CLICK_EVENT = 0 は fromJson で undefined になる場合があるため両方チェック
  if (event.sysEvent) {
    const t = event.sysEvent.eventType;
    return t === OsEventTypeList.CLICK_EVENT || t === undefined;
  }
  if (event.textEvent) {
    const t = event.textEvent.eventType;
    return t === OsEventTypeList.CLICK_EVENT || t === undefined;
  }
  if (event.listEvent) {
    const t = event.listEvent.eventType;
    return t === OsEventTypeList.CLICK_EVENT || t === undefined;
  }
  return false;
}

/**
 * イベントハンドラ: ダブルクリックイベントを検出する
 */
export function isDoubleClickEvent(event: any): boolean {
  if (event.sysEvent) {
    return event.sysEvent.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT;
  }
  if (event.textEvent) {
    return event.textEvent.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT;
  }
  if (event.listEvent) {
    return event.listEvent.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT;
  }
  return false;
}

/**
 * リストの選択インデックスを取得する
 */
export function getListSelectedIndex(event: any): number | null {
  if (event.listEvent) {
    const idx = event.listEvent.currentSelectItemIndex;
    // index 0 が省略される場合があるため null チェック
    return idx ?? 0;
  }
  return null;
}
