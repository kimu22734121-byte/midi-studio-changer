// 前の聴き取り方（2026年11月27日の版）で使う、歌以外の楽器の聴き取り。ここは直さない。
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
export function trackBass(bsal, frames, hopT, q, step, onsets = new Set()) {
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
    let start = f, runMax = 0, dipped = false, sum = 0, first = true;
    while (f < frames && path[f] === p) {
      const v = S[f * NBASS + p];
      // 弾き直し：低い音が新しく鳴り始めたところ（同じ高さの刻み）
      // ただし、ベースの高さの成分そのものが強くなったときだけ（バスドラが鳴っただけでは分けない）
      const rise = f + 3 < frames && f >= 2 ? S[(f + 3) * NBASS + p] / Math.max(1e-6, S[(f - 1) * NBASS + p]) : 0;
      if (f > start + 1 && (onsets.has(f) || onsets.has(f - 1)) && !onsets.has(f - 2) && rise > 1.0) {
        // 長い時間幅で調べているので、音は実際より少し早く始まって見える。
        // 出だしの直後（0.2秒以内）の目印なら、手前の短い部分は捨てて、目印の位置から始める
        if (!(first && (f - start) * hopT < 0.2)) segs.push({ a: start, b: f, p, sum });
        start = f; runMax = v; dipped = false; sum = 0; first = false;
      }
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
export function chordsByBeat(chroma, energy, frames, hopT, offset, beat, bassPcAt, chromaS = null) {
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
    // 左右の差の音（歌が入っていない伴奏）も半分混ぜる（それぞれの大きさをそろえてから）。
    // 歌が和音の判定の邪魔をしなくなり、セブンスも見分けやすくなる（試験用の曲で 56%→93%）
    if (chromaS) {
      const cs = new Float64Array(12);
      for (let f = fa; f < fb; f++) for (let i = 0; i < 12; i++) cs[i] += chromaS[f * 12 + i];
      const nm = Math.hypot(...c) || 1, ns = Math.hypot(...cs);
      if (ns > 0) for (let i = 0; i < 12; i++) c[i] = (c[i] / nm) * 0.5 + (cs[i] / ns) * 0.5;
    }
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
  const N = NT + 1;
  const decode = (switchCost) => {
    let score = Float64Array.from(emis[0]);
    const back = [];
    for (let k = 1; k < nBeats; k++) {
      let bestPrev = 0;
      for (let j = 1; j < N; j++) if (score[j] > score[bestPrev]) bestPrev = j;
      const sw = switchCost(k);
      const nxt = new Float64Array(N), bk = new Uint16Array(N);
      for (let j = 0; j < N; j++) {
        const stay = score[j], move = score[bestPrev] - sw;
        if (stay >= move) { nxt[j] = stay + emis[k][j]; bk[j] = j; } else { nxt[j] = move + emis[k][j]; bk[j] = bestPrev; }
      }
      back.push(bk);
      score = nxt;
    }
    let st = 0;
    for (let j = 1; j < N; j++) if (score[j] > score[st]) st = j;
    const out = new Array(nBeats);
    for (let k = nBeats - 1; k >= 0; k--) { out[k] = st; if (k > 0) st = back[k - 1][st]; }
    return out;
  };
  const states = decode(() => 0.12);
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
export function classifyDrums(flux, E, spread, hopT, spreadC = null) {
  const out = [];
  const n = flux.low.length;
  const after = (arr, i, sec) => arr[Math.min(n - 1, i + Math.round(sec / hopT))];
  const minAfter = (arr, i, s0, s1) => {
    let m = Infinity;
    for (let k = Math.max(0, i + Math.round(s0 / hopT)); k <= Math.min(n - 1, i + Math.round(s1 / hopT)); k++) m = Math.min(m, arr[k]);
    return m === Infinity ? 0 : m;
  };
  const peakNear = (arr, i) => Math.max(arr[i], arr[Math.min(n - 1, i + 1)], arr[Math.min(n - 1, i + 2)]);
  // バスドラ：低い音が急に出て、すぐ消える（長く続くのはベース）
  const kickF = new Set();
  for (const { i, s } of pickPeaks(flux.low, Math.round(0.08 / hopT), 0.3)) {
    const top = peakNear(E.low, i);
    if (top <= 0) continue;
    // 長く続く低い音はふつうベース。ただし、曲の中でとびきり強い低い音の立ち上がり（上位の強さ）は、
    // 長く響いてもバスドラ（電子音の「ドゥーン」と響くバスドラ）
    const strong = s >= 0.9;
    if (after(E.low, i, 0.13) > top * 0.3 && !strong) continue;
    if (flux.low[i] < flux.mid[i] * 0.8) continue;
    out.push({ i, p: 36, s });
    kickF.add(i);
  }
  // スネア：「胴」の音（150〜300Hz）と、ザッという音（1〜4kHz）が同時に出る（バスドラと同時のものは除く）
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
  // クラップ：胴の音がないザッという音。真ん中の音だけで見る（左右に広がったシンセに邪魔されない）。
  // 毎拍バスドラの曲ではいつもバスドラと重なるので、バスドラと同時でも除かない
  // （あとで「1拍おきに規則正しく」出るものだけ残す）
  // （スネアがほとんどない曲だけで使うかどうかは、拍の位置がわかってから決める）
  if (flux.cmid) {
    const snareF = out.filter((o) => o.p === 38).map((o) => o.i);
    for (const { i, s } of pickPeaks(flux.cmid, Math.round(0.08 / hopT), 0.3)) {
      if (snareF.some((k) => Math.abs(k - i) <= 2)) continue;
      const body = Math.max(flux.body[i], flux.body[Math.min(n - 1, i + 1)], flux.body[Math.max(0, i - 1)]);
      if ((spreadC || spread)[i] < 0.45 || s < 0.4) continue;
      const top = peakNear(E.mid, i);
      if (after(E.mid, i, 0.07) < top * 0.15) continue;
      void body;
      // w：頭打ちにしない強さ（拍ごとの強さを比べるのに使う）
      out.push({ i, p: 39, s, w: flux.cmid[i] / pickRef(flux.cmid) });
    }
  }
  // ハイハット／シンバル：高い音。長く響けばシンバル、少し響けば開いたハイハット
  let lastCrash = -1e9;
  for (const { i, s } of pickPeaks(flux.high, Math.round(0.07 / hopT), 0.25)) {
    const top = peakNear(E.high, i);
    if (top <= 0) continue;
    // 響きの長さは「鳴る直前のいちばん静かなところ」と比べる。
    // 細かいハイハット・残響・歌の「サ行」で高い音が鳴り続けている曲でも、まわりより本当に長く残っているものだけを選ぶ
    const before = Math.max(minAfter(E.high, i, -0.2, -0.02), top * 0.002);
    const long = minAfter(E.high, i, 0.22, 0.6), mid = minAfter(E.high, i, 0.12, 0.18);
    let p = long > top * 0.03 && long > before * 4 ? 49 : mid > top * 0.03 && mid > before * 3 ? 46 : 42;
    // シンバルの響きが残っている間（1秒）は、次のシンバルにしない
    if (p === 49 && (i - lastCrash) * hopT < 1.0) p = 42;
    if (p === 49) lastCrash = i;
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

// ---------------- バンド（ギター・キーボードなどが実際に弾いている音） ----------------
export const BAND_LO = 40; // E2
export const BAND_HI = 88; // E6
export const NBAND = BAND_HI - BAND_LO + 1;
const NH = 8;
const NW = Array.from({ length: NH }, (_, h) => 0.8 ** h);
export const MAX_BAND_NOTES = 6;

/** 伴奏の音を探す準備（4096点・左右の差の音で見る） */
export function bandRanges(binHz) {
  const ranges = [];
  for (let i = 0; i < NBAND; i++) {
    const f0 = 440 * 2 ** ((BAND_LO + i - 69) / 12);
    for (let h = 1; h <= NH; h++) {
      const f = f0 * h;
      if (f > 6000) { ranges.push(null); continue; }
      const w = Math.max(1, (f * 0.02) / binHz);
      ranges.push([Math.max(1, Math.floor(f / binHz - w)), Math.ceil(f / binHz + w)]);
    }
  }
  return ranges;
}

/**
 * 1フレームで、同時に鳴っている音を探す：いちばん目立つ音を見つけたら、その音と倍音を弱めて、次を探す（最大6音）。
 * mag は sqrt した振幅（書き換えるのでコピーを渡す）。out[f*MAX+k] に { pitchIndex, 強さ } を入れる
 */
export function bandFrame(mag, ranges, outP, outS, base) {
  let firstMax = 0;
  for (let k = 0; k < MAX_BAND_NOTES; k++) {
    let best = -1, bs = 0;
    for (let i = 0; i < NBAND; i++) {
      let s = 0;
      for (let h = 0; h < NH; h++) {
        const r = ranges[i * NH + h];
        if (!r) break;
        let m = 0;
        for (let b = r[0]; b <= r[1]; b++) if (mag[b] > m) m = mag[b];
        s += NW[h] * m;
      }
      if (s > bs) { bs = s; best = i; }
    }
    if (best < 0 || (k > 0 && bs < firstMax * 0.2)) break;
    if (k === 0) firstMax = bs;
    outP[base + k] = best + 1; // 0 は「なし」
    outS[base + k] = bs;
    // 見つけた音とその倍音を弱める（ほかの音と重なる倍音もあるので、消しきらない）
    for (let h = 0; h < NH; h++) {
      const r = ranges[best * NH + h];
      if (!r) break;
      for (let b = r[0]; b <= r[1]; b++) mag[b] *= 0.15;
    }
  }
}

/** 見つけた音をつなげて音符にする（伴奏が鳴り始めたところ onsets で区切る） */
export function trackBand(outP, outS, frames, hopT, q, step, onsets) {
  // 強さの基準：各フレームでいちばん目立った音の強さの、上から1割あたり
  const tops = [];
  for (let f = 0; f < frames; f++) if (outP[f * MAX_BAND_NOTES]) tops.push(outS[f * MAX_BAND_NOTES]);
  if (tops.length < 10) return [];
  tops.sort((a, b) => a - b);
  const ref = tops[Math.floor(tops.length * 0.9)];
  const th = ref * 0.22;
  const on = new Float32Array(frames * NBAND);
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < MAX_BAND_NOTES; k++) {
      const pi = outP[f * MAX_BAND_NOTES + k];
      if (!pi) break;
      const sv = outS[f * MAX_BAND_NOTES + k];
      if (sv >= th) on[f * NBAND + pi - 1] = sv;
    }
  }
  const notes = [];
  for (let i = 0; i < NBAND; i++) {
    let f = 0;
    while (f < frames) {
      if (!on[f * NBAND + i]) { f++; continue; }
      let start = f, sum = 0, first = true;
      const push = (a, b) => {
        if ((b - a) * hopT < 0.045) return;
        const qs = q(a * hopT);
        let qe = q(b * hopT);
        if (qs < 0) return;
        if (qe <= qs) qe = qs + 1;
        notes.push({ qs, qe, p: BAND_LO + i, v: Math.round(60 + 45 * Math.min(1, sum / Math.max(1, b - a) / ref)) });
      };
      // 1フレームの切れ目は続きとみなす
      while (f < frames && (on[f * NBAND + i] || (f + 1 < frames && on[(f + 1) * NBAND + i]))) {
        if (f > start + 1 && onsets.has(f) && !onsets.has(f - 1)) {
          if (!(first && (f - start) * hopT < 0.12)) push(start, f);
          start = f; sum = 0; first = false;
        }
        sum += on[f * NBAND + i];
        f++;
      }
      push(start, f);
    }
  }
  // 同じ高さの重なりをまとめる
  notes.sort((a, b) => a.p - b.p || a.qs - b.qs);
  const out = [];
  for (const n of notes) {
    const last = out[out.length - 1];
    if (last && last.p === n.p && n.qs < last.qe) { last.qe = Math.max(last.qe, n.qe); continue; }
    out.push(n);
  }
  return out.sort((a, b) => a.qs - b.qs).map((n) => ({ t: n.qs * step, d: (n.qe - n.qs) * step * 0.95, p: n.p, v: n.v }));
}
