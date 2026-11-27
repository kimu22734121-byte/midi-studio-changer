// 歌以外の楽器の聴き取り：ベース・和音・伴奏のリズム・ドラム。
// audio-transcribe.js から呼ばれる。画面や Web Audio には依存しない。

// ---------------- ベース ----------------
export const BASS_LO = 28; // E1
export const BASS_HI = 55; // G3
export const NBASS = BASS_HI - BASS_LO + 1;
const BH = 6;
const BW = [1, 0.85, 0.7, 0.55, 0.45, 0.35];

/** ベース用の「音の高さらしさ」を計算するための準備（8192点の細かい周波数で見る） */
export function bassRanges(binHz) {
  const ranges = [];
  for (let i = 0; i < NBASS; i++) {
    const f0 = 440 * 2 ** ((BASS_LO + i - 69) / 12);
    for (let h = 1; h <= BH; h++) {
      const f = f0 * h;
      const w = Math.max(1, (f * 0.03) / binHz);
      ranges.push([Math.max(1, Math.floor(f / binHz - w)), Math.ceil(f / binHz + w)]);
    }
  }
  return ranges;
}

/** 1フレーム分のベースらしさ（mag は sqrt した振幅） */
export function bassSalienceFrame(mag, ranges, out, offset) {
  for (let i = 0; i < NBASS; i++) {
    let s = 0;
    for (let h = 0; h < BH; h++) {
      const [a, b] = ranges[i * BH + h];
      let m = 0;
      for (let k = a; k <= b; k++) if (mag[k] > m) m = mag[k];
      s += BW[h] * m;
    }
    out[offset + i] = s;
  }
}

/** ベースの音符を取り出す（なめらかにつなぐ → 同じ高さの続きは1音、弾き直しで分ける） */
export function trackBass(bsal, frames, hopT, q, step) {
  const maxes = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let m = 0;
    for (let i = 0; i < NBASS; i++) m = Math.max(m, bsal[f * NBASS + i]);
    maxes[f] = m;
  }
  const ref = pct(maxes, 0.9) || 1;
  const S = new Float32Array(frames * NBASS);
  for (let k = 0; k < S.length; k++) S[k] = Math.min(1.5, bsal[k] / ref);
  const U = NBASS, NS = NBASS + 1, TH = 0.4;
  let score = new Float64Array(NS), next = new Float64Array(NS);
  const back = new Uint8Array(frames * NS);
  for (let i = 0; i < NBASS; i++) score[i] = S[i];
  score[U] = TH;
  for (let f = 1; f < frames; f++) {
    for (let s = 0; s < NS; s++) {
      let best = -1e9, arg = 0;
      for (let r = 0; r < NS; r++) {
        let c;
        if (r === s) c = 0;
        else if (r === U || s === U) c = 0.2;
        else c = Math.min(0.5, 0.08 + 0.02 * Math.abs(r - s));
        const v = score[r] - c;
        if (v > best) { best = v; arg = r; }
      }
      next[s] = best + (s === U ? TH : S[f * NBASS + s]);
      back[f * NS + s] = arg;
    }
    [score, next] = [next, score];
  }
  const path = new Uint8Array(frames);
  let st = 0;
  for (let k = 1; k < NS; k++) if (score[k] > score[st]) st = k;
  for (let f = frames - 1; f >= 0; f--) { path[f] = st; st = back[f * NS + st]; }

  // 同じ高さが続くところを1音に。途中で弱まって強くなれば「弾き直し」として分ける
  const segs = [];
  let f = 0;
  while (f < frames) {
    if (path[f] === U) { f++; continue; }
    const p = path[f];
    let start = f, runMax = 0, dipped = false, sum = 0;
    while (f < frames && path[f] === p) {
      const v = S[f * NBASS + p];
      if (v > runMax) runMax = v;
      if (v < runMax * 0.5) dipped = true;
      else if (dipped && v > runMax * 0.75) {
        segs.push({ a: start, b: f, p, sum });
        start = f; runMax = v; dipped = false; sum = 0;
      }
      sum += v;
      f++;
    }
    segs.push({ a: start, b: f, p, sum });
  }
  const notes = [];
  for (const sg of segs) {
    const t0 = sg.a * hopT, t1 = sg.b * hopT;
    if (t1 - t0 < 0.06) continue;
    const qs = q(t0);
    let qe = q(t1);
    if (qs < 0) continue;
    if (qe <= qs) qe = qs + 1;
    notes.push({ qs, qe, p: BASS_LO + sg.p, v: Math.round(75 + 40 * Math.min(1, sg.sum / (sg.b - sg.a))) });
  }
  notes.sort((a, b) => a.qs - b.qs);
  const out = [];
  for (const n of notes) {
    const last = out[out.length - 1];
    if (last && last.qe > n.qs) {
      if (last.qs === n.qs) { if (n.qe - n.qs > last.qe - last.qs) out[out.length - 1] = n; continue; }
      last.qe = n.qs;
    }
    out.push(n);
  }
  const voicedFrames = path.reduce((a, s) => a + (s !== U ? 1 : 0), 0);
  return { notes: out.map((n) => ({ t: n.qs * step, d: (n.qe - n.qs) * step * 0.95, p: n.p, v: n.v })), coverage: voicedFrames / frames };
}

// ---------------- 和音 ----------------
const QUALITIES = [
  { name: '', iv: [0, 4, 7], w: [1, 1, 1] },
  { name: 'm', iv: [0, 3, 7], w: [1, 1, 1] },
  { name: '7', iv: [0, 4, 7, 10], w: [1, 1, 0.9, 0.8] },
  { name: 'M7', iv: [0, 4, 7, 11], w: [1, 1, 0.9, 0.8] },
  { name: 'm7', iv: [0, 3, 7, 10], w: [1, 1, 0.9, 0.8] },
];
const NOTE = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const TEMPLATES = [];
for (let r = 0; r < 12; r++) {
  for (const qd of QUALITIES) {
    const v = new Float64Array(12);
    qd.iv.forEach((x, i) => (v[(r + x) % 12] = qd.w[i]));
    let n = 0;
    for (const a of v) n += a * a;
    n = Math.sqrt(n);
    for (let i = 0; i < 12; i++) v[i] /= n;
    TEMPLATES.push({ root: r, iv: qd.iv, name: NOTE[r] + qd.name, v, seventh: qd.iv.length > 3 });
  }
}

/**
 * 1拍ごとに和音を選ぶ。
 * chroma：フレームごとの12音の強さ（歌の音は弱めておく）／ bassPc(t)：その時刻のベースの音（なければ -1）
 * 戻り値：[{ chord, start（拍）, beats }]（start は offset を 0 とした拍）
 */
export function chordsByBeat(chroma, energy, frames, hopT, offset, beat, bassPcAt) {
  const nBeats = Math.floor((frames * hopT - offset) / beat);
  if (nBeats < 1) return [];
  const medE = pct(energy, 0.5);
  const NT = TEMPLATES.length, NONE = NT;
  const emis = [];
  for (let k = 0; k < nBeats; k++) {
    const fa = Math.max(0, Math.round((offset + k * beat) / hopT));
    const fb = Math.min(frames, Math.round((offset + (k + 1) * beat) / hopT));
    const c = new Float64Array(12);
    let e = 0;
    for (let f = fa; f < fb; f++) { e += energy[f]; for (let i = 0; i < 12; i++) c[i] += chroma[f * 12 + i]; }
    e /= Math.max(1, fb - fa);
    const row = new Float64Array(NT + 1);
    if (e < medE * 0.15) { row.fill(-1); row[NONE] = 0.5; emis.push(row); continue; }
    const mean = c.reduce((a, b) => a + b, 0) / 12;
    let norm = 0;
    for (let i = 0; i < 12; i++) { c[i] = Math.max(0, c[i] - mean); norm += c[i] * c[i]; }
    norm = Math.sqrt(norm) || 1;
    const bp = bassPcAt(offset + (k + 0.25) * beat);
    for (let j = 0; j < NT; j++) {
      const tp = TEMPLATES[j];
      let s = 0;
      for (let i = 0; i < 12; i++) s += tp.v[i] * c[i];
      s /= norm;
      // ベースの音は手がかりだが、次の和音へつなぐ音（4拍目など）につられないよう、弱めに使う
      if (bp === tp.root) s += 0.05;
      else if (bp >= 0 && tp.iv.some((x) => (tp.root + x) % 12 === bp)) s += 0.02;
      if (tp.seventh) s -= 0.015; // 7th の音がはっきりしないときは三和音を選ぶ
      row[j] = s;
    }
    row[NONE] = 0.05;
    emis.push(row);
  }
  // なめらかにつなぐ（すぐ変わりすぎないように）
  const N = NT + 1, SW = 0.12;
  let score = Float64Array.from(emis[0]);
  const back = [];
  for (let k = 1; k < nBeats; k++) {
    let bestPrev = 0;
    for (let j = 1; j < N; j++) if (score[j] > score[bestPrev]) bestPrev = j;
    const nxt = new Float64Array(N), bk = new Uint16Array(N);
    for (let j = 0; j < N; j++) {
      const stay = score[j], move = score[bestPrev] - SW;
      if (stay >= move) { nxt[j] = stay + emis[k][j]; bk[j] = j; } else { nxt[j] = move + emis[k][j]; bk[j] = bestPrev; }
    }
    back.push(bk);
    score = nxt;
  }
  let st = 0;
  for (let j = 1; j < N; j++) if (score[j] > score[st]) st = j;
  const states = new Array(nBeats);
  for (let k = nBeats - 1; k >= 0; k--) { states[k] = st; if (k > 0) st = back[k - 1][st]; }
  const list = [];
  for (let k = 0; k < nBeats; k++) {
    const s = states[k];
    if (s === NONE) continue;
    const last = list[list.length - 1];
    if (last && last.state === s && last.start + last.beats === k) { last.beats++; continue; }
    const tp = TEMPLATES[s];
    list.push({ state: s, start: k, beats: 1, chord: { root: tp.root, bass: tp.root, intervals: tp.iv, name: tp.name } });
  }
  return list;
}

// ---------------- 伴奏のリズム ----------------
/** 左右に広がった楽器（ピアノ・ギターなど）が鳴り始めたタイミング（秒）。手がかりが少なければ null */
export function compOnsets(sideFlux, hopT, duration, beat) {
  if (!sideFlux) return null;
  const peaks = pickPeaksSimple(sideFlux, Math.round(0.09 / hopT), 0.3);
  const bars = duration / (beat * 4);
  // 1小節に1回も鳴っていないようなら、伴奏のリズムは使わない（伸ばすだけ）
  if (peaks.length < bars * 1) return null;
  return peaks.map((i) => i * hopT);
}

// ---------------- ドラム ----------------
/**
 * ドラムの種類を見分ける。
 * flux：帯域ごとの立ち上がり／ E：帯域ごとの大きさ（フレームごと）／ hopT：フレームの長さ（秒）
 * 戻り値：[{ i（フレーム）, p（GMの番号）, s（強さ0〜1） }]
 */
export function classifyDrums(flux, E, spread, hopT) {
  const out = [];
  const n = flux.low.length;
  const after = (arr, i, sec) => arr[Math.min(n - 1, i + Math.round(sec / hopT))];
  const minAfter = (arr, i, s0, s1) => {
    let m = Infinity;
    for (let k = i + Math.round(s0 / hopT); k <= Math.min(n - 1, i + Math.round(s1 / hopT)); k++) m = Math.min(m, arr[k]);
    return m === Infinity ? 0 : m;
  };
  const peakNear = (arr, i) => Math.max(arr[i], arr[Math.min(n - 1, i + 1)], arr[Math.min(n - 1, i + 2)]);
  // バスドラ：低い音が急に出て、すぐ消える（長く続くのはベース）
  const kickF = new Set();
  for (const { i, s } of pickPeaks(flux.low, Math.round(0.08 / hopT), 0.3)) {
    const top = peakNear(E.low, i);
    if (top <= 0) continue;
    if (after(E.low, i, 0.13) > top * 0.45) continue; // 長く続く → ベース
    if (flux.low[i] < flux.mid[i] * 0.8) continue;
    out.push({ i, p: 36, s });
    kickF.add(i);
  }
  // スネア：「胴」の音（150〜300Hz）と、ザッという音（1〜4kHz）が同時に出る
  for (const { i, s } of pickPeaks(flux.mid, Math.round(0.08 / hopT), 0.3)) {
    if ([...kickF].some((k) => Math.abs(k - i) <= 2)) continue;
    const body = Math.max(flux.body[i], flux.body[Math.min(n - 1, i + 1)], flux.body[Math.max(0, i - 1)]);
    // 胴の音がはっきり強いこと（ピアノの低い音とハイハットが重なっただけのものを外す）
    if (body <= 0.6 * pickRef(flux.body) || spread[i] < 0.35) continue;
    // ザッという音がハイハットより長く続く
    const top = peakNear(E.mid, i);
    if (after(E.mid, i, 0.07) < top * 0.15) continue;
    out.push({ i, p: 38, s });
  }
  // ハイハット／シンバル：高い音。長く響けばシンバル、少し響けば開いたハイハット
  for (const { i, s } of pickPeaks(flux.high, Math.round(0.07 / hopT), 0.25)) {
    const top = peakNear(E.high, i);
    if (top <= 0) continue;
    // 大きさ（2乗）で比べる：シンバルは 0.22〜0.6 秒後もずっと響いている、開いたハイハットは 0.12〜0.18 秒後まで
    const r4 = minAfter(E.high, i, 0.22, 0.6) / top, r15 = minAfter(E.high, i, 0.12, 0.18) / top;
    const p = r4 > 0.03 ? 49 : r15 > 0.03 ? 46 : 42;
    out.push({ i, p, s });
  }
  return out;
}

// ---------------- 共通 ----------------
function pct(arr, p) {
  const a = Float32Array.from(arr).sort();
  return a[Math.min(a.length - 1, Math.floor(a.length * p))] || 0;
}

export function pickPeaks(arr, minGap, sens) {
  const norm = pct(arr, 0.98) || 1;
  const out = [];
  const W = 20;
  let lastI = -1e9;
  for (let i = 1; i < arr.length - 1; i++) {
    const v = arr[i] / norm;
    if (v < sens) continue;
    let isMax = true;
    for (let j = Math.max(0, i - 3); j <= Math.min(arr.length - 1, i + 3); j++) if (arr[j] > arr[i]) { isMax = false; break; }
    if (!isMax) continue;
    let m = 0;
    for (let j = Math.max(0, i - W); j < Math.min(arr.length, i + W); j++) m += arr[j];
    m /= 2 * W;
    if (arr[i] < m * 1.6) continue;
    if (i - lastI < minGap) continue;
    out.push({ i, s: Math.min(1, v) });
    lastI = i;
  }
  return out;
}

function pickPeaksSimple(arr, minGap, sens) {
  return pickPeaks(arr, minGap, sens).map((x) => x.i);
}

const refCache = new WeakMap();
function pickRef(arr) {
  if (!refCache.has(arr)) refCache.set(arr, pct(arr, 0.95) || 1);
  return refCache.get(arr);
}
