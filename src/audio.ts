// Even G2 音声入力 + Whisper STT モジュール
// PCM形式: 16kHz, S16LE, mono, 40bytes/frame (10ms)

export interface AudioRecordResult {
  transcript: string;
  from: string | null;
  to: string | null;
}

const WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions';

// PCMバッファを蓄積するクラス
export class PcmBuffer {
  private chunks: Uint8Array[] = [];
  private totalBytes = 0;
  // 最大録音時間: 8秒 (16kHz * 2bytes * 8sec = 256000 bytes)
  private readonly MAX_BYTES = 256000;

  append(pcm: Uint8Array): void {
    if (this.totalBytes >= this.MAX_BYTES) return;
    this.chunks.push(pcm);
    this.totalBytes += pcm.byteLength;
  }

  get isFull(): boolean {
    return this.totalBytes >= this.MAX_BYTES;
  }

  get byteLength(): number {
    return this.totalBytes;
  }

  clear(): void {
    this.chunks = [];
    this.totalBytes = 0;
  }

  /**
   * PCMデータをWAVファイルのBlobに変換する
   * 16kHz, mono, S16LE
   */
  toWavBlob(): Blob {
    const sampleRate = 16000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = this.totalBytes;
    const headerSize = 44;
    const buffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(buffer);

    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);       // chunk size
    view.setUint16(20, 1, true);        // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // PCMデータをコピー
    const pcmArray = new Uint8Array(buffer, headerSize);
    let offset = 0;
    for (const chunk of this.chunks) {
      pcmArray.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * WAV BlobをWhisper APIに送信してテキストを取得する
 */
export async function transcribeWav(
  wavBlob: Blob,
  apiKey: string
): Promise<string> {
  const formData = new FormData();
  formData.append('file', wavBlob, 'audio.wav');
  formData.append('model', 'whisper-1');
  formData.append('language', 'ja');
  formData.append('prompt', '電車の乗り換え案内。「渋谷から新宿まで」のような発話。');

  const res = await fetch(WHISPER_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Whisper API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.text ?? '';
}

/**
 * 「〇〇から〇〇まで」パターンを解析する
 * 例: "渋谷から新宿まで" → { from: "渋谷", to: "新宿" }
 */
export function parseRoute(transcript: string): { from: string | null; to: string | null } {
  // パターン1: 「〇〇から〇〇まで」
  const m1 = transcript.match(/(.+?)から(.+?)まで/);
  if (m1) return { from: m1[1].trim(), to: m1[2].trim() };

  // パターン2: 「〇〇から〇〇」
  const m2 = transcript.match(/(.+?)から(.+)/);
  if (m2) return { from: m2[1].trim(), to: m2[2].trim() };

  return { from: null, to: null };
}
