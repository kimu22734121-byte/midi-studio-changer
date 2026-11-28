// 解析の窓口。画面側はここだけを呼ぶ。
// 将来、解析を自宅PCやクラウドのサーバーに移すときは、このファイルの中身を
// 「サーバーへ音声を送って Song(JSON) を受け取る」処理に差し替えればよい。
import { parseMidi } from '../core/midi-file.js';
import { parseAbc, looksLikeAbc } from './abc.js';
import { parseChordText, looksLikeChordText } from './chord-text.js';
import { readMusicXmlFile } from './musicxml.js';
export { ANALYSIS_SR } from './audio-transcribe.js';
import { identifyInstruments } from './instrument-id.js';

/**
 * 元の曲で鳴っている楽器を聴き分けて、曲（Song）のパートに「近い楽器」を書き込む。
 * うまくいかなければ何もしない（今まで通りの楽器選びになる）。戻り値：聴き取った結果 or null
 */
export async function hearInstruments(song, left, right, sampleRate, { onProgress } = {}) {
  let heard = null;
  try {
    heard = await identifyInstruments(left, right, sampleRate, { base: document.baseURI, onProgress });
  } catch (e) {
    console.warn('楽器の聴き分けに失敗しました', e);
  }
  if (!heard) return null;
  song.heard = heard;
  for (const tr of song.tracks) {
    if (tr.layer || tr.program != null) continue;
    const p = tr.isDrum ? heard.drums : tr.role === 'melody' ? heard.melody : tr.role === 'chords' ? heard.chords : tr.role === 'bass' ? heard.bass : tr.role === 'other' ? heard.other : null;
    if (Number.isInteger(p)) tr.suggest = p;
  }
  return heard;
}

let worker = null;
let seq = 0;

/** モノラル音声（Float32Array）→ Song */
/** 音声（Float32Array）→ Song。right があれば samples は左、right は右（左右分けで歌を聴き取りやすくなる） */
export function analyzeAudio(samples, sampleRate, { onProgress = () => {}, title, source, right = null, legacy = false } = {}) {
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
    worker.postMessage({ id, samples, right, sampleRate, options: { title, source, legacy } }, right ? [samples.buffer, right.buffer] : [samples.buffer]);
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
