// 音声解析を画面とは別のスレッドで動かす（画面が固まらないように）。
import { transcribeAudio } from './audio-transcribe.js';

self.onmessage = (e) => {
  const { id, samples, sampleRate, options } = e.data;
  try {
    const song = transcribeAudio(samples, sampleRate, {
      ...options,
      onProgress: (p, msg) => self.postMessage({ id, type: 'progress', p, msg }),
    });
    self.postMessage({ id, type: 'done', song });
  } catch (err) {
    self.postMessage({ id, type: 'error', message: err.message || String(err) });
  }
};
