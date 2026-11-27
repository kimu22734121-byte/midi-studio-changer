// 音声 → 打ち込み用の音符（メロディ・コード・ドラム）への自動採譜。
// 画面やWeb Audioには依存しない純粋な計算だけ（将来サーバーへ移せるように）。
// 入力：モノラルの Float32Array と サンプリングレート（ANALYSIS_SR 推奨）。
import { makeFFT } from './fft.js';
import { createSong } from '../core/song.js';
import { buildAccompaniment } from '../core/chords.js';

export const ANALYSIS_SR = 22050;
const MEL_LO = 45; // A2
const MEL_HI = 84; // C6
const NP = MEL_HI - MEL_LO + 1;

export function transcribeAudio(input, sr, { onProgress = () => {}, title = '録音した曲', source = 'audio', right = null } = {}) {
  const maxLen = Math.floor(sr * 60 * 8);
  const n = Math.min(input.length, maxLen, right ? right.length : Infinity);
  // x＝真ん中（左右を足したもの）、side＝左右の差（左右に広がった伴奏が多く入る）
  const x = new Float32Array(n);
  const side = right ? new Float32Array(n) : null;
  for (let i = 0; i < n; i++) {
    if (right) { x[i] = (input[i] + right[i]) / 2; side[i] = (input[i] - right[i]) / 2; } else x[i] = input[i];
  }
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (x.length < sr * 3) throw new Error('曲が短すぎます（3秒以上にしてください）');
  if (peak < 1e-3) throw new Error('音がほとんど入っていないようです');
  for (let i = 0; i < x.length; i++) x[i] /= peak;
  if (side) for (let i = 0; i < side.length; i++) side[i] /= peak;

  // ---------- 1. リズム用の細かい解析（音の出だしを探す） ----------
  onProgress(0.02, 'リズムを聴き取っています…');
  const nS = 1024, hopS = 256;
  const fS = makeFFT(nS);
  const framesS = Math.ceil(x.length / hopS);
  const binS = (f) => Math.min(nS / 2 - 1, Math.round((f * nS) / sr));
  const bands = { all: [1, nS / 2], low: [binS(30), binS(150)], mid: [binS(1000), binS(4000)], high: [binS(6000), binS(10000)] };
  const flux = {};
  for (const k in bands) flux[k] = new Float32Array(framesS);
  const spread = new Float32Array(framesS); // 中域で同時に強くなった周波数の割合（スネアらしさ）
  let mag = new Float64Array(nS / 2), prev = new Float64Array(nS / 2);
  let lmag = new Float64Array(nS / 2), lprev = new Float64Array(nS / 2);
  for (let f = 0; f < framesS; f++) {
    fS.magnitude(x, f * hopS - nS / 2, mag);
    for (let i = 0; i < nS / 2; i++) lmag[i] = Math.log1p(100 * mag[i]);
    for (const k in bands) {
      const [a, b] = bands[k];
      const cur = k === 'all' ? lmag : mag, old = k === 'all' ? lprev : prev;
      let s = 0, up = 0;
      for (let i = a; i <= b; i++) { const d = cur[i] - old[i]; if (d > 0) { s += d; up++; } }
      flux[k][f] = s / (b - a + 1);
      if (k === 'mid') spread[f] = up / (b - a + 1);
    }
    [mag, prev] = [prev, mag];
    [lmag, lprev] = [lprev, lmag];
    if (f % 2000 === 0) onProgress(0.02 + 0.2 * (f / framesS), 'リズムを聴き取っています…');
  }
  // 帯域どうしを比べて、それらしい音だけ残す
  const kick = new Float32Array(framesS), snare = new Float32Array(framesS);
  for (let f = 0; f < framesS; f++) {
    if (flux.low[f] > 3 * flux.mid[f]) kick[f] = flux.low[f];
    if (flux.mid[f] > 1.5 * flux.high[f] && spread[f] > 0.5) snare[f] = flux.mid[f];
  }
  for (let f = 0; f < framesS; f++) if (kick[f] > 0) for (let g = Math.max(0, f - 2); g <= Math.min(framesS - 1, f + 2); g++) snare[g] = 0;

  // ---------- 2. テンポ（速さ）と拍の位置 ----------
  onProgress(0.24, '曲の速さを調べています…');
  const hopT = hopS / sr;
  const env = highPass(flux.all, Math.round(0.4 / hopT));
  const { bpm, phase } = estimateTempo(env, hopT);
  const beat = 60 / bpm;
  const step = beat / 4; // 16分音符
  const offset = ((phase % beat) + beat) % beat;
  const q = (t) => Math.round((t - offset) / step);

  // ---------- 3. ドラム ----------
  onProgress(0.3, 'ドラムを聴き取っています…');
  const drumNotes = [];
  const seen = new Set();
  const addDrum = (arr, pitch, sens) => {
    for (const { i, s } of pickPeaks(arr, Math.round(0.07 / hopT), sens)) {
      const k = q(i * hopT);
      if (k < 0 || seen.has(`${k}:${pitch}`)) continue;
      seen.add(`${k}:${pitch}`);
      drumNotes.push({ t: k * step, d: 0.08, p: pitch, v: Math.round(60 + 60 * Math.min(1, s)) });
    }
  };
  addDrum(kick, 36, 0.35);
  addDrum(snare, 38, 0.45);
  addDrum(flux.high, 42, 0.4);

  // ---------- 4. メロディとコード用の細かい音の高さの解析 ----------
  const nB = 4096, hopB = 512;
  const fB = makeFFT(nB);
  const framesB = Math.ceil(x.length / hopB);
  const binHz = sr / nB;
  const H = 8;
  const ranges = []; // [pitchIndex*H + h] -> [lo, hi]
  for (let pi = 0; pi < NP; pi++) {
    const f0 = 440 * 2 ** ((MEL_LO + pi - 69) / 12);
    for (let h = 1; h <= H; h++) {
      const f = f0 * h;
      if (f > 5000) { ranges.push(null); continue; }
      const w = Math.max(1, (f * 0.025) / binHz);
      ranges.push([Math.max(1, Math.floor(f / binHz - w)), Math.ceil(f / binHz + w)]);
    }
  }
  const hw = Array.from({ length: H }, (_, h) => 0.8 ** h);
  const chromaBin = new Int8Array(nB / 2).fill(-1);
  const bassBin = new Int8Array(nB / 2).fill(-1);
  for (let b = 1; b < nB / 2; b++) {
    const f = b * binHz;
    const pc = ((Math.round(12 * Math.log2(f / 440)) + 69) % 12 + 12) % 12;
    if (f >= 80 && f <= 1000) chromaBin[b] = pc;
    if (f >= 40 && f <= 260) bassBin[b] = pc;
  }
  const sal = new Float32Array(framesB * NP);
  const chroma = new Float32Array(framesB * 12);
  const bassC = new Float32Array(framesB * 12);
  const energy = new Float32Array(framesB);
  const magB = new Float64Array(nB / 2);
  const magS = side ? new Float64Array(nB / 2) : null;
  const fS2 = side ? makeFFT(nB) : null;
  // メロディ（歌）用：真ん中の音から左右の差を引く ＝ 真ん中にある歌が浮かび上がる
  // （左右に広がったピアノ・弦などが弱まる。左右の差の 1.5 倍を引くのが、試した中で一番よかった）
  // ※ ドラムを弱める処理（時間方向の中央値）も試したが、歌の出だしまでぼけて成績が下がったので入れていない
  const CENTER = 1.5;
  const melMag = new Float64Array(nB / 2);
  for (let f = 0; f < framesB; f++) {
    fB.magnitude(x, f * hopB - nB / 2, magB);
    if (side) fS2.magnitude(side, f * hopB - nB / 2, magS);
    for (let b = 0; b < nB / 2; b++) melMag[b] = Math.sqrt(side ? Math.max(0, magB[b] - CENTER * magS[b]) : magB[b]);
    for (let pi = 0; pi < NP; pi++) {
      let s = 0;
      for (let h = 0; h < H; h++) {
        const r = ranges[pi * H + h];
        if (!r) break;
        let m = 0;
        for (let b = r[0]; b <= r[1]; b++) if (melMag[b] > m) m = melMag[b];
        s += hw[h] * m;
      }
      sal[f * NP + pi] = s;
    }
    let e = 0;
    for (let i = 0; i < nB / 2; i++) { magB[i] = Math.sqrt(magB[i]); e += magB[i]; }
    energy[f] = e;
    // 山になっている周波数だけを数える（倍音のにじみを減らす）
    let bmax = 0;
    for (let b = 1; b < nB / 2 - 1; b++) {
      const isPeak = magB[b] > magB[b - 1] && magB[b] >= magB[b + 1];
      if (!isPeak) continue;
      if (chromaBin[b] >= 0) chroma[f * 12 + chromaBin[b]] += magB[b];
      if (bassBin[b] >= 0 && magB[b] > bmax) bmax = magB[b];
    }
    // ベース：低い方から見て最初に出てくる強い山の音
    for (let b = 1; b < nB / 2 - 1 && bmax > 0; b++) {
      if (bassBin[b] < 0) continue;
      if (magB[b] > magB[b - 1] && magB[b] >= magB[b + 1] && magB[b] > bmax * 0.5) { bassC[f * 12 + bassBin[b]] = 1; break; }
    }
    if (f % 300 === 0) onProgress(0.32 + 0.45 * (f / framesB), 'メロディを聴き取っています…');
  }

  // ---------- 5. メロディ（いちばん目立つ音の高さを、なめらかにつなぐ） ----------
  onProgress(0.8, 'メロディを音符にしています…');
  const melody = trackMelody(sal, framesB, hopB / sr, q, step);

  // ---------- 6. コード（2拍ごと） ----------
  onProgress(0.9, 'コードを調べています…');
  let chords = [], bestScore = -1;
  for (let ph = 0; ph < 4; ph++) {
    const r = detectChords(chroma, bassC, energy, framesB, hopB / sr, offset, beat, ph);
    if (r.score > bestScore) { bestScore = r.score; chords = r.list; }
  }

  const tracks = [{ name: 'メロディ', role: 'melody', notes: melody }];
  if (chords.length) tracks.push(...buildAccompaniment(chords, bpm, { drums: false }));
  tracks.push({ name: 'ドラム', role: 'drums', isDrum: true, notes: drumNotes });
  onProgress(1, 'できました');
  return createSong({ title, bpm: Math.round(bpm * 10) / 10, source, tracks });
}

function highPass(arr, win) {
  const out = new Float32Array(arr.length);
  let acc = 0;
  const pre = new Float64Array(arr.length + 1);
  for (let i = 0; i < arr.length; i++) pre[i + 1] = pre[i] + arr[i];
  for (let i = 0; i < arr.length; i++) {
    const a = Math.max(0, i - win), b = Math.min(arr.length, i + win + 1);
    acc = (pre[b] - pre[a]) / (b - a);
    out[i] = Math.max(0, arr[i] - acc);
  }
  return out;
}

function estimateTempo(env, hopT) {
  const N = env.length;
  let best = -1, bestLag = Math.round(0.5 / hopT);
  const minLag = Math.floor(60 / 180 / hopT), maxLag = Math.ceil(60 / 70 / hopT);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < N; i++) s += env[i] * env[i + lag];
    s /= N - lag;
    const b = 60 / (lag * hopT);
    const w = Math.exp(-0.5 * (Math.log2(b / 120) / 0.8) ** 2);
    if (s * w > best) { best = s * w; bestLag = lag; }
  }
  const b0 = 60 / (bestLag * hopT);
  let bestScore = -1, bpm = b0, phase = 0;
  for (let b = b0 * 0.96; b <= b0 * 1.04; b += 0.05) {
    const period = 60 / b / hopT;
    for (let ph = 0; ph < period; ph++) {
      let s = 0, c = 0;
      for (let k = ph; k < N; k += period) { s += env[Math.round(k)] || 0; c++; }
      s /= c;
      if (s > bestScore) { bestScore = s; bpm = b; phase = ph * hopT; }
    }
  }
  return { bpm, phase };
}

function percentile(arr, p) {
  const a = Float32Array.from(arr).sort();
  return a[Math.min(a.length - 1, Math.floor(a.length * p))] || 0;
}

function pickPeaks(arr, minGap, sens) {
  const norm = percentile(arr, 0.98) || 1;
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
    out.push({ i, s: v });
    lastI = i;
  }
  return out;
}

function trackMelody(sal, frames, hopT, q, step) {
  // 正規化（大きい音のフレームを基準に）
  const maxes = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let m = 0;
    for (let p = 0; p < NP; p++) m = Math.max(m, sal[f * NP + p]);
    maxes[f] = m;
  }
  const ref = percentile(maxes, 0.9) || 1;
  const prior = Array.from({ length: NP }, (_, i) => 0.6 + 0.4 * Math.exp(-0.5 * ((MEL_LO + i - 67) / 12) ** 2));
  const S = new Float32Array(frames * NP);
  for (let f = 0; f < frames; f++) {
    for (let p = 0; p < NP; p++) S[f * NP + p] = Math.min(1.5, (sal[f * NP + p] / ref) * prior[p]);
  }

  // ビタビ法：音の高さの道筋を、跳びすぎないように選ぶ
  const U = NP; // 無音の状態
  const NS = NP + 1;
  const VOICE_TH = 0.42;
  let score = new Float64Array(NS), next = new Float64Array(NS);
  const back = new Uint8Array(frames * NS);
  for (let s = 0; s < NP; s++) score[s] = S[s];
  score[U] = VOICE_TH;
  for (let f = 1; f < frames; f++) {
    for (let s = 0; s < NS; s++) {
      let best = -1e9, arg = 0;
      for (let r = 0; r < NS; r++) {
        let c;
        if (r === U && s === U) c = 0;
        else if (r === U || s === U) c = 0.2;
        else c = Math.min(0.7, 0.1 + 0.04 * Math.abs(r - s));
        const v = score[r] - c;
        if (v > best) { best = v; arg = r; }
      }
      next[s] = best + (s === U ? VOICE_TH : S[f * NP + s]);
      back[f * NS + s] = arg;
    }
    [score, next] = [next, score];
  }
  const path = new Uint8Array(frames);
  let s = 0;
  for (let k = 1; k < NS; k++) if (score[k] > score[s]) s = k;
  for (let f = frames - 1; f >= 0; f--) { path[f] = s; s = back[f * NS + s]; }

  // 同じ高さが続くところを1つの音符に（途中で強さが落ちて戻れば、別の音符に分ける）
  const segs = [];
  let f = 0;
  while (f < frames) {
    if (path[f] === U) { f++; continue; }
    const p = path[f];
    let g = f;
    let start = f, runMax = 0, dipped = false, sum = 0;
    while (g < frames && path[g] === p) {
      const v = S[g * NP + p];
      if (v > runMax) runMax = v;
      if (v < runMax * 0.45) dipped = true;
      else if (dipped && v > runMax * 0.7) {
        segs.push({ a: start, b: g, p, sum });
        start = g; runMax = v; dipped = false; sum = 0;
      }
      sum += v;
      g++;
    }
    segs.push({ a: start, b: g, p, sum });
    f = g;
  }

  mergeWobble(segs, hopT);
  const notes = [];
  for (const sg of segs) {
    const t0 = sg.a * hopT, t1 = sg.b * hopT;
    if (t1 - t0 < 0.07) continue;
    let qs = q(t0), qe = q(t1);
    if (qe <= qs) { if (t1 - t0 > step * 0.5) qe = qs + 1; else continue; }
    if (qs < 0) continue;
    const mean = sg.sum / (sg.b - sg.a);
    notes.push({ qs, qe, p: MEL_LO + sg.p, v: Math.round(70 + 45 * Math.min(1, mean)) });
  }
  // 重なりを取り除く（メロディは1音ずつ）
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
  return out.map((n) => ({ t: n.qs * step, d: (n.qe - n.qs) * step * 0.95, p: n.p, v: n.v }));
}

const TEMPLATES = [];
for (let r = 0; r < 12; r++) {
  TEMPLATES.push({ root: r, iv: [0, 4, 7], name: 'maj' });
  TEMPLATES.push({ root: r, iv: [0, 3, 7], name: 'min' });
}

function detectChords(chroma, bassC, energy, frames, hopT, offset, beat, phaseBeats) {
  const segLen = beat * 2;
  const start0 = offset + phaseBeats * beat;
  const nSeg = Math.ceil((frames * hopT - start0) / segLen);
  const medE = percentile(energy, 0.5);
  const list = [];
  let prev = null, total = 0, counted = 0;
  for (let k = 0; k < nSeg; k++) {
    const fa = Math.max(0, Math.round((start0 + k * segLen) / hopT));
    const fb = Math.min(frames, Math.round((start0 + (k + 1) * segLen) / hopT));
    if (fb <= fa) continue;
    const c = new Float64Array(12), bc = new Float64Array(12);
    let e = 0;
    for (let f = fa; f < fb; f++) {
      e += energy[f];
      for (let i = 0; i < 12; i++) c[i] += chroma[f * 12 + i];
    }
    // ベース音の多数決（ドラムに一瞬じゃまされても大丈夫なように）
    for (let f = fa; f < fb; f++) for (let i = 0; i < 12; i++) bc[i] += bassC[f * 12 + i];
    e /= fb - fa;
    if (e < medE * 0.15) { prev = null; continue; }
    // 平均を引いて目立つ音だけ残す
    const mean = c.reduce((a, b) => a + b, 0) / 12;
    let norm = 0;
    for (let i = 0; i < 12; i++) { c[i] = Math.max(0, c[i] - mean); norm += c[i] * c[i]; }
    norm = Math.sqrt(norm) || 1;
    let bassTop = 0;
    for (let i = 1; i < 12; i++) if (bc[i] > bc[bassTop]) bassTop = i;
    let best = null, bestS = -1;
    for (const tp of TEMPLATES) {
      let s = 0;
      for (const iv of tp.iv) s += c[(tp.root + iv) % 12];
      s = s / norm / Math.sqrt(3);
      if (bassTop === tp.root) s += 0.15;
      if (prev && prev === tp) s += 0.04;
      if (s > bestS) { bestS = s; best = tp; }
    }
    total += bestS; counted++;
    const chord = { root: best.root, bass: best.root, intervals: best.iv, name: best.name };
    const startBeat = phaseBeats + k * 2;
    const last = list[list.length - 1];
    if (last && prev === best && last.start + last.beats === startBeat) last.beats += 2;
    else list.push({ chord, start: startBeat, beats: 2 });
    prev = best;
  }
  return { list, score: counted ? total / counted : 0 };
}

/**
 * 歌の揺れ（ビブラート）やしゃくりで、となりの高さに一瞬ずれた短い切れ端を、
 * つながっている長い方の音にまとめる（音符が細切れにならないように）
 */
function mergeWobble(segs, hopT) {
  const short = 0.13 / hopT; // 130ms より短い切れ端
  segs.sort((a, b) => a.a - b.a);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const len = s.b - s.a;
      if (len >= short) continue;
      const prev = segs[i - 1], next = segs[i + 1];
      const near = (o) => o && Math.abs(o.p - s.p) <= 2 && Math.abs((o.a < s.a ? o.b : o.a) - (o.a < s.a ? s.a : s.b)) <= 1;
      const cands = [prev, next].filter(near);
      if (!cands.length) continue;
      const host = cands.reduce((x, y) => (y.b - y.a > x.b - x.a ? y : x));
      host.a = Math.min(host.a, s.a);
      host.b = Math.max(host.b, s.b);
      host.sum += s.sum;
      segs.splice(i, 1);
      changed = true;
      break;
    }
  }
}
