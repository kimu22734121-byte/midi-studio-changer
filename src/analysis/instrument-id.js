// 楽器の種類の聴き分け。
// Google の音の聞き分けモデル「YAMNet」（Apache 2.0。521種類の音を聞き分ける）を、
// MediaPipe（Apache 2.0）でブラウザの中だけで動かす。曲を外に送ることはない。
//  - 曲全体・左右の差（ギターやキーボードは左右に広げてあることが多い）・低い音だけ（ベース）を別々に聴かせる
//  - 聴き取った楽器から、パートごとに近い楽器（GM の番号）を選ぶ（decideInstruments。画面・ブラウザに依存しない）
// 読み込めないとき（通信できないなど）は null を返し、アプリは今まで通りに動く。

// YAMNet の楽器の名前 → 日本語・パート・GM の番号
//  chords：伴奏に使うときの番号 ／ melody：メロディに使うときの番号
export const CATS = {
  'Piano': { ja: 'ピアノ', chords: 0, melody: 0 },
  'Electric piano': { ja: 'エレピ', chords: 4, melody: 4 },
  'Keyboard (musical)': { ja: 'キーボード', chords: 0, melody: 0, weak: true },
  'Harpsichord': { ja: 'チェンバロ', chords: 6, melody: 6 },
  'Organ': { ja: 'オルガン', chords: 19, melody: 19 },
  'Electronic organ': { ja: '電子オルガン', chords: 16, melody: 16 },
  'Hammond organ': { ja: 'ハモンドオルガン', chords: 16, melody: 17 },
  'Synthesizer': { ja: 'シンセサイザー', chords: 90, melody: 81 },
  'Sampler': { ja: 'シンセサイザー', chords: 90, melody: 81, weak: true },
  'Guitar': { ja: 'ギター', chords: 27, melody: 27, guitar: true, general: true },
  'Electric guitar': { ja: 'エレキギター', chords: 27, melody: 27, guitar: true },
  'Acoustic guitar': { ja: 'アコースティックギター', chords: 25, melody: 25 },
  'Steel guitar, slide guitar': { ja: 'スチールギター', chords: 25, melody: 26 },
  'Strum': { ja: 'ギターのストローク', chords: 25, melody: 25, weak: true },
  'Plucked string instrument': { ja: '弦をはじく楽器', chords: 25, melody: 24, weak: true },
  'Banjo': { ja: 'バンジョー', chords: 105, melody: 105 },
  'Mandolin': { ja: 'マンドリン', chords: 105, melody: 105 },
  'Ukulele': { ja: 'ウクレレ', chords: 24, melody: 24 },
  'Sitar': { ja: 'シタール', chords: 104, melody: 104 },
  'Violin, fiddle': { ja: 'バイオリン', chords: 48, melody: 40 },
  'Cello': { ja: 'チェロ', chords: 48, melody: 42 },
  'Bowed string instrument': { ja: 'ストリングス', chords: 48, melody: 40, general: true },
  'String section': { ja: 'ストリングス', chords: 48, melody: 48 },
  'Orchestra': { ja: 'オーケストラ', chords: 48, melody: 40, weak: true },
  'Pizzicato': { ja: 'ピチカート', chords: 45, melody: 45 },
  'Harp': { ja: 'ハープ', chords: 46, melody: 46 },
  'Brass instrument': { ja: '金管楽器', chords: 61, melody: 61, general: true },
  'Trumpet': { ja: 'トランペット', chords: 61, melody: 56 },
  'Trombone': { ja: 'トロンボーン', chords: 61, melody: 57 },
  'French horn': { ja: 'ホルン', chords: 60, melody: 60 },
  'Saxophone': { ja: 'サックス', chords: 66, melody: 65 },
  'Clarinet': { ja: 'クラリネット', chords: 71, melody: 71 },
  'Flute': { ja: 'フルート', chords: 73, melody: 73 },
  'Wind instrument, woodwind instrument': { ja: '木管楽器', chords: 73, melody: 73, weak: true },
  'Harmonica': { ja: 'ハーモニカ', chords: 22, melody: 22 },
  'Accordion': { ja: 'アコーディオン', chords: 21, melody: 21 },
  'Bagpipes': { ja: 'バグパイプ', chords: 109, melody: 109 },
  'Glockenspiel': { ja: 'グロッケン', chords: 9, melody: 9 },
  'Mallet percussion': { ja: '鍵盤打楽器', chords: 11, melody: 11, weak: true },
  'Marimba, xylophone': { ja: 'マリンバ', chords: 12, melody: 13 },
  'Vibraphone': { ja: 'ビブラフォン', chords: 11, melody: 11 },
  'Steelpan': { ja: 'スチールドラム', chords: 114, melody: 114 },
  'Choir': { ja: '合唱', chords: 52, melody: 52 },
};
// 歌（メロディが歌のとき）
const VOICE = ['Singing', 'Male singing', 'Female singing', 'Child singing', 'Synthetic singing', 'Choir', 'Vocal music', 'Rapping', 'A capella', 'Humming'];
// ベース
const BASS = {
  'Bass guitar': { ja: 'エレキベース', program: 33 },
  'Double bass': { ja: 'ウッドベース', program: 32 },
};
// 曲の種類（ドラムセットや、電子音の曲かを決める）
const ELECTRONIC = ['Electronic music', 'Techno', 'House music', 'Trance music', 'Dubstep', 'Drum and bass', 'Electronica', 'Electronic dance music', 'Drum machine', 'Ambient music'];
// （シンセサイザーの音だけでは電子音の曲とは決めない。ふつうのポップスにもシンセはよく入っている）
const ROCK = ['Rock music', 'Heavy metal', 'Punk rock', 'Grunge', 'Progressive rock', 'Rock and roll', 'Psychedelic rock'];
const JAZZ = ['Jazz', 'Swing music', 'Blues'];
const CLASSICAL = ['Classical music', 'Orchestra', 'Opera'];

const sumOf = (m, names) => names.reduce((s, n) => s + (m[n] || 0), 0);
// 自信の目安：これより低い点数の楽器は、楽器選びには使わない（はっきり聞こえる楽器は 0.04〜0.5 くらいになる）
const USE = 0.03, SHOW = 0.02;

/**
 * 聴き取った点数から、パートごとの楽器を決める（ブラウザに依存しない）。
 * scores = { mix: {名前: 点数}, side: {…}|null, low: {…} }（点数は区間の平均 0〜1）
 * 戻り値：{ names: [日本語の楽器名…], melody, chords, other, bass, drums（GMの番号か null）, voice, electronic, style }
 */
export function decideInstruments(scores) {
  const mix = scores.mix || {}, side = scores.side, low = scores.low || {};
  const rock = sumOf(mix, ROCK), jazz = sumOf(mix, JAZZ), classical = sumOf(mix, CLASSICAL);
  const electronic = sumOf(mix, ELECTRONIC);
  const style = electronic > 0.06 && electronic > rock ? 'electronic' : rock > 0.04 ? 'rock' : jazz > 0.04 ? 'jazz' : classical > 0.05 ? 'classical' : 'pop';
  // ベースギターの音は「ギター」「弦をはじく楽器」とも聞こえるので、ベースが強いときはその分を引く
  const bassG = Math.max(mix['Bass guitar'] || 0, low['Bass guitar'] || 0);
  const GENERIC_GUITAR = new Set(['Guitar', 'Plucked string instrument']);
  // 楽器の候補（はっきりしない総称は少し割り引く）
  const rank = (m) => Object.keys(CATS)
    .map((n) => ({ n, s: Math.max(0, (m[n] || 0) - (GENERIC_GUITAR.has(n) && m !== side ? bassG : 0)) * (CATS[n].weak ? 0.6 : CATS[n].general ? 0.85 : 1) }))
    .filter((x) => x.s >= 0.012)
    .sort((a, b) => b.s - a.s);
  const fromMix = rank(mix);
  const fromSide = side ? rank(side) : [];
  // 伴奏：左右の差の音で一番の楽器（なければ曲全体で）
  const acc = (fromSide[0] && fromSide[0].s >= USE ? fromSide : fromMix).filter((x) => x.n !== 'Choir' && x.s >= USE);
  const prog = (x, role) => {
    const c = CATS[x.n];
    // ロックのギターはひずんだ音
    if (c.guitar && style === 'rock') return role === 'melody' ? 29 : 30;
    return c[role];
  };
  const chords = acc[0] ? prog(acc[0], 'chords') : null;
  // 2番目の楽器（伴奏と違う種類）は「その他の楽器」に
  const second = [...acc.slice(1), ...fromMix].find((x) => CATS[x.n].chords !== chords && x.s >= USE * 0.8);
  const other = second ? prog(second, 'chords') : null;
  // メロディ：歌が聞こえるなら歌（楽器はふだん通りの選び方）。そうでなければ一番目立つ楽器
  const voiceS = sumOf(mix, VOICE);
  const voice = voiceS >= 0.05 && voiceS >= (fromMix[0]?.s || 0) * 0.8;
  const synthVoice = (mix['Synthetic singing'] || 0) >= 0.02;
  const lead = [...fromMix.filter((x) => !CATS[x.n].weak), ...fromMix].find((x) => x.s >= USE);
  const melody = voice ? null : lead ? prog(lead, 'melody') : null;
  // ベース：低い音だけを聴いて
  let bass = null, bassName = null;
  const bk = Object.keys(BASS).map((n) => ({ n, s: Math.max(low[n] || 0, mix[n] || 0) })).sort((a, b) => b.s - a.s)[0];
  if (style === 'electronic' && !(bk && bk.s >= 0.05)) { bass = 38; bassName = 'シンセベース'; }
  else if (bk && bk.s >= USE) { bass = BASS[bk.n].program; bassName = BASS[bk.n].ja; if (bass === 33 && style === 'rock') bass = 34; }
  else if (style === 'classical') bass = 43; // クラシックの曲の低い音はコントラバス
  // ドラムセット（バンク128の番号）
  const drums = style === 'electronic' ? 25 : style === 'rock' ? 16 : style === 'jazz' ? 32 : style === 'classical' && (mix['Drum kit'] || 0) < 0.02 ? 48 : null;
  // 画面に出す楽器の名前（重なりを除いて、点数の高い順に5つまで）
  const names = [];
  if (voice) names.push(synthVoice ? '歌（ボーカロイドのような声）' : '歌');
  for (const x of [...fromSide.slice(0, 3), ...fromMix]) {
    if (x.s < SHOW) continue;
    const ja = CATS[x.n].ja;
    if (!names.includes(ja) && !(CATS[x.n].weak && names.length)) names.push(ja);
    if (names.length >= 5) break;
  }
  if (bassName && !names.includes(bassName)) names.push(bassName);
  if (style === 'electronic' && !names.includes('電子音のドラム')) names.push('電子音のドラム');
  return { names, melody, chords, other, bass, drums, voice, synthVoice, electronic: style === 'electronic', style };
}

// ---------------- ブラウザで YAMNet を動かす ----------------
let clfPromise = null;
/** 聴き分けの準備（1回だけ）。base はアプリの置き場所（URL） */
function loadClassifier(base) {
  if (!clfPromise) {
    clfPromise = (async () => {
      const mp = await import(new URL('vendor/mediapipe/audio_bundle.mjs', base).href);
      const fs = await mp.FilesetResolver.forAudioTasks(new URL('vendor/mediapipe/wasm', base).href);
      return mp.AudioClassifier.createFromOptions(fs, {
        baseOptions: { modelAssetPath: new URL('models/yamnet.tflite', base).href },
        maxResults: -1, scoreThreshold: 0,
      });
    })().catch((e) => { clfPromise = null; throw e; });
  }
  return clfPromise;
}

/** sr の音を 16000Hz に直す（簡単な窓付き sinc 補間） */
export function resampleTo16k(x, sr) {
  if (sr === 16000) return x;
  const ratio = sr / 16000, n = Math.floor(x.length / ratio);
  const out = new Float32Array(n);
  const fc = Math.min(1, 16000 / sr) * 0.95, H = 8;
  for (let i = 0; i < n; i++) {
    const c = i * ratio, j0 = Math.floor(c);
    let s = 0, w = 0;
    for (let j = j0 - H + 1; j <= j0 + H; j++) {
      if (j < 0 || j >= x.length) continue;
      const d = j - c;
      const sinc = d === 0 ? 1 : Math.sin(Math.PI * fc * d) / (Math.PI * fc * d);
      const win = 0.5 + 0.5 * Math.cos((Math.PI * d) / H);
      s += x[j] * sinc * win; w += sinc * win;
    }
    out[i] = w ? s / w : 0;
  }
  return out;
}

/**
 * 曲の楽器を聴き分ける（ブラウザ専用）。L・R は左右の音（モノラルなら R=null）、sr はその速さ。
 * 戻り値：decideInstruments の結果に、点数（scores）を足したもの。うまくいかなければ null
 */
export async function identifyInstruments(L, R, sr, { base = location.href, onProgress = () => {} } = {}) {
  let clf;
  try { clf = await loadClassifier(base); } catch (e) { console.warn('楽器の聴き分けを読み込めませんでした', e); return null; }
  const SR = 16000;
  const l = resampleTo16k(L, sr), r = R ? resampleTo16k(R, sr) : null;
  const n = l.length;
  const mid = new Float32Array(n), side = r ? new Float32Array(n) : null, low = new Float32Array(n);
  let y = 0;
  const a = Math.exp((-2 * Math.PI * 300) / SR);
  for (let i = 0; i < n; i++) {
    mid[i] = r ? (l[i] + r[i]) / 2 : l[i];
    if (side) side[i] = (l[i] - r[i]) / 2;
    y = a * y + (1 - a) * mid[i];
    low[i] = y * 2;
  }
  // 左右の差がほとんどない（モノラルに近い）なら、左右の差は使わない
  let em = 0, es = 0;
  for (let i = 0; i < n; i += 8) { em += mid[i] * mid[i]; if (side) es += side[i] * side[i]; }
  const useSide = side && es > em * 0.02;
  // 10秒ずつ聴かせて、点数を平均する（画面が固まらないように、合間に一息つく）
  const CH = SR * 10;
  const signals = { mix: mid, low, ...(useSide ? { side } : {}) };
  // 長い曲は、曲全体から均等に 18 区間（3分ぶん）だけ聴く（時間がかかりすぎないように）
  const all = [];
  for (let s = 0; s < n; s += CH) all.push(s);
  const starts = all.length > 18 ? Array.from({ length: 18 }, (_, i) => all[Math.floor((i * all.length) / 18)]) : all;
  const total = Object.keys(signals).length * starts.length;
  let done = 0;
  const scores = {};
  for (const [key, sig] of Object.entries(signals)) {
    const sum = {};
    let segs = 0;
    for (const s of starts) {
      const part = sig.subarray(s, Math.min(n, s + CH));
      if (part.length < SR) continue;
      // とても静かな部分（曲の頭や終わり）は飛ばす
      let e = 0;
      for (let i = 0; i < part.length; i += 16) e += part[i] * part[i];
      if (e / (part.length / 16) < 1e-6) continue;
      for (const res of clf.classify(part, SR)) {
        for (const c of res.classifications[0].categories) sum[c.categoryName] = (sum[c.categoryName] || 0) + c.score;
        segs++;
      }
      onProgress(++done / total);
      await new Promise((ok) => setTimeout(ok, 0));
    }
    if (segs) for (const k in sum) sum[k] /= segs;
    scores[key] = sum;
  }
  return { ...decideInstruments(scores), scores: compactScores(scores) };
}

// 保存用に、楽器・曲の種類に関係する点数だけ残す
function compactScores(scores) {
  const keep = new Set([...Object.keys(CATS), ...VOICE, ...Object.keys(BASS), ...ELECTRONIC, ...ROCK, ...JAZZ, ...CLASSICAL, 'Drum kit']);
  const out = {};
  for (const k in scores) {
    out[k] = {};
    for (const n in scores[k]) if (keep.has(n) && scores[k][n] >= 0.005) out[k][n] = Math.round(scores[k][n] * 1000) / 1000;
  }
  return out;
}
