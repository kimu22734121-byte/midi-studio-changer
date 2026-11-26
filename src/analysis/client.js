// 解析の窓口。画面側はここだけを呼ぶ。
// 将来、解析を自宅PCやクラウドのサーバーに移すときは、このファイルの中身を
// 「サーバーへ音声を送って Song(JSON) を受け取る」処理に差し替えればよい。
import { parseMidi } from '../core/midi-file.js';
import { parseAbc, looksLikeAbc } from './abc.js';
import { parseChordText, looksLikeChordText } from './chord-text.js';
import { readMusicXmlFile } from './musicxml.js';
export { ANALYSIS_SR } from './audio-transcribe.js';

let worker = null;
let seq = 0;

/** モノラル音声（Float32Array）→ Song */
export function analyzeAudio(samples, sampleRate, { onProgress = () => {}, title, source } = {}) {
  if (!worker) worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onMsg = (e) => {
      if (e.data.id !== id) return;
      if (e.data.type === 'progress') onProgress(e.data.p, e.data.msg);
      else {
        worker.removeEventListener('message', onMsg);
        if (e.data.type === 'done') resolve(e.data.song);
        else reject(new Error(e.data.message));
      }
    };
    worker.addEventListener('message', onMsg);
    worker.addEventListener('error', (e) => reject(new Error(e.message || '解析中にエラーが起きました')), { once: true });
    worker.postMessage({ id, samples, sampleRate, options: { title, source } }, [samples.buffer]);
  });
}

export function loadMidi(arrayBuffer, title) {
  return parseMidi(arrayBuffer, title);
}

/** 貼り付けたテキスト（ABC楽譜 or コード進行）→ Song */
export function loadScoreText(text) {
  if (looksLikeAbc(text)) return parseAbc(text);
  if (looksLikeChordText(text)) return parseChordText(text);
  throw new Error('ABC楽譜（K: の行がある）か、コード進行（例：C G Am F）として読めませんでした');
}

export function loadMusicXml(arrayBuffer, name) {
  return readMusicXmlFile(arrayBuffer, name);
}
