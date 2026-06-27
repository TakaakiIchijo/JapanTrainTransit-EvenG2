// Transit API クライアント
// https://api.transit.ls8h.com/

const BASE_URL = 'https://api.transit.ls8h.com';

export interface Station {
  id: string;
  name: string;
  nameKana?: string;
  feedId: string;
  feedName: string;
  lat?: number;
  lon?: number;
}

export interface TransitLeg {
  kind: 'transit' | 'walk';
  routeName?: string;
  headsign?: string;
  mode?: string;
  from: { id: string; name: string };
  to: { id: string; name: string };
  departureSecs: number;
  arrivalSecs: number;
}

export interface Journey {
  departureSecs: number;
  arrivalSecs: number;
  durationSecs: number;
  transferCount: number;
  fare?: { currency: string; ticket: number; ic?: number };
  legs: TransitLeg[];
}

export interface PlanResponse {
  date: string;
  timezone: string;
  from: { id: string; name: string };
  to: { id: string; name: string };
  journeys: Journey[];
}

/**
 * 駅名オートコンプリート（上位1件を返す）
 */
export async function suggestStation(query: string): Promise<Station | null> {
  const stations = await suggestStations(query, 5);
  if (stations.length === 0) return null;
  return stations[0];
}

/**
 * 駅名オートコンプリート（複数候補を返す）
 */
export async function suggestStations(query: string, limit = 5): Promise<Station[]> {
  const url = `${BASE_URL}/api/v1/locations/suggest?q=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  const stations: Station[] = data.stations ?? [];
  // weight順にソート
  return stations.sort((a, b) => (b as any).weight - (a as any).weight);
}

/**
 * 経路検索（単一ペア）
 */
export async function planJourney(
  fromId: string,
  toId: string,
  numItineraries = 3
): Promise<PlanResponse | null> {
  const url = `${BASE_URL}/api/v1/plan?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}&numItineraries=${numItineraries}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data: PlanResponse = await res.json();
  // walkのみの結果は無効とみなす
  const hasTransit = data.journeys.some(j => j.legs.some(l => l.kind === 'transit'));
  if (!hasTransit) return null;
  return data;
}

/**
 * 経路検索（複数候補を試して最初に成功した結果を返す）
 * 同一フィード内の組み合わせを優先する
 */
export async function planJourneyWithFallback(
  fromStations: Station[],
  toStations: Station[],
  numItineraries = 3
): Promise<{ plan: PlanResponse; fromStation: Station; toStation: Station } | null> {
  // 同一フィードの組み合わせを優先して試行
  const pairs: Array<[Station, Station]> = [];

  // 同一フィードのペアを優先
  for (const from of fromStations) {
    for (const to of toStations) {
      const fromFeed = from.id.split(':')[0];
      const toFeed = to.id.split(':')[0];
      if (fromFeed === toFeed) {
        pairs.unshift([from, to]);
      } else {
        pairs.push([from, to]);
      }
    }
  }

  for (const [from, to] of pairs) {
    const plan = await planJourney(from.id, to.id, numItineraries);
    if (plan) {
      return { plan, fromStation: from, toStation: to };
    }
  }
  return null;
}

/**
 * サービス日の0:00からの秒数をHH:MM形式に変換
 */
export function secsToHHMM(secs: number): string {
  const normalized = ((secs % 86400) + 86400) % 86400;
  const h = Math.floor(normalized / 3600);
  const m = Math.floor((normalized % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 秒数を「X分」形式に変換
 */
export function secsToDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}時間${m}分`;
  return `${m}分`;
}

/**
 * Journeyからグラス表示用の行リストを生成する
 * バイト数制限: 900バイト以下（日本語15文字/行 × 最大15行）
 */
export function journeyToLines(journey: Journey): string[] {
  const lines: string[] = [];

  // 1行目: 所要時間と到着時刻
  const arrival = secsToHHMM(journey.arrivalSecs);
  const duration = secsToDuration(journey.durationSecs);
  lines.push(`着${arrival} (${duration})`);

  // 2行目: 乗り換え回数
  const transfers = journey.transferCount;
  lines.push(transfers === 0 ? '乗換なし' : `乗換${transfers}回`);

  // 区切り
  lines.push('──────');

  // 各transitレグ
  const transitLegs = journey.legs.filter(l => l.kind === 'transit');
  for (const leg of transitLegs) {
    // 路線名（最初の括弧以降を除去）
    const rawRoute = leg.routeName ?? '不明';
    const routeName = truncate(
      rawRoute.replace(/（.*$/u, '').replace(/\(.*$/u, '').trim() || rawRoute.trim(),
      12
    );
    lines.push(routeName);

    // 乗車駅と発車時刻
    const dep = secsToHHMM(leg.departureSecs);
    lines.push(`${dep} ${truncate(leg.from.name, 8)}発`);

    // 降車駅と到着時刻
    const arr = secsToHHMM(leg.arrivalSecs);
    lines.push(`${arr} ${truncate(leg.to.name, 8)}着`);

    if (transitLegs.indexOf(leg) < transitLegs.length - 1) {
      lines.push('↓乗換');
    }
  }

  return lines;
}

/**
 * 文字列を指定文字数で切り詰める（日本語考慮）
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

/**
 * 路線名から最初の括弧以降を除去して短縮する
 * 例: "埼京線（大宮・川越方面）" → "埼京線"
 * 例: "東海道線（下り（熱海方面））" → "東海道線"
 */
function shortenRouteName(name: string): string {
  // 最初の全角括弧または半角括弧以降をすべて除去
  const withoutParen = name
    .replace(/（.*$/u, '')   // 全角左括弧以降を除去
    .replace(/\(.*$/u, '')    // 半角左括弧以降を除去
    .trim();
  return truncate(withoutParen || name.trim(), 8);
}

/**
 * 複数Journeyの概要リスト（ListContainer用）
 * 例: "09:14着 埼京線 5分"
 */
export function journeyToSummary(journey: Journey): string {
  const arrival = secsToHHMM(journey.arrivalSecs);
  const duration = secsToDuration(journey.durationSecs);
  const transitLegs = journey.legs.filter(l => l.kind === 'transit');
  const firstRoute = transitLegs.length > 0
    ? shortenRouteName(transitLegs[0].routeName ?? '不明')
    : '徒歩';
  const transfers = journey.transferCount > 0 ? ` 乗${journey.transferCount}` : '';
  return `${arrival}着 ${firstRoute} ${duration}${transfers}`;
}
