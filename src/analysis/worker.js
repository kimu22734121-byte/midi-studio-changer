// 音声解析を画面とは別のスレッドで動かす（画面が固まらないように）。
import { transcribeAudio } from './audio-transcribe.js';
import { transcribeAudio as transcribeLegacy } from './legacy-1127/audio-transcribe.js';

self.onmessage = (e) => {
  const { id, samples, right, sampleRate, options } = e.data;
  try {
    // legacy：前の聴き取り方（11月27日の版）で変換する（聴きくらべ用）
    const run = options?.legacy ? transcribeLegacy : transcribeAudio;
    const song = run(samples, sampleRate, {
      ...options,
      right,
      onProgress: (p, msg) => self.postMessage({ id, type: 'progress', p, msg }),
    });
    self.postMessage({ id, type: 'done', song });
  } catch (err) {
    self.postMessage({ id, type: 'error', message: err.message || String(err) });
  }
};
