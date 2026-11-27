// 音声 → 打ち込み用の音符（メロディ・コード・ドラム）への自動採譜。
// 画面やWeb Audioには依存しない純粋な計算だけ（将来サーバーへ移せるように）。
// 入力：モノラルの Float32Array と サンプリングレート（ANALYSIS_SR 推奨）。
import { makeFFT } from './fft.js';
import { createSong } from '../core/song.js';
import { buildAccompaniment, voiceChord } from '../core/chords.js';
import { bassRanges, bassSalienceFrame, trackBass, NBASS, chordsByBeat, compOnsets, classifyDrums } from './instruments.js';

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
  if (x.length < sr * 3) throw new Error('曲が短すぎます（3秒以上にしてください）');
  // 音量をそろえる：一瞬だけ大きい音（タップ音など）ではなく、曲全体の聞こえる大きさを基準にする。
  // 0.05秒ごとの音量の「上から1割」あたりを 0.25 にそろえる（画面収録などの小さい音も大きくなる）
  const win = Math.round(sr * 0.05);
  const levels = [];
  for (let a = 0; a + win <= x.length; a += win) {
    let e = 0;
    for (let i = a; i < a + win; i++) e += x[i] * x[i];
    levels.push(Math.sqrt(e / win));
  }
  levels.sort((a, b) => a - b);
  const loud = levels[Math.floor(levels.length * 0.9)] || 0;
  if (loud < 1e-5) throw new Error('音がほとんど入っていないようです');
  const gain = 0.25 / loud;
  for (let i = 0; i < x.length; i++) x[i] *= gain;
  if (side) for (let i = 0; i < side.length; i++) side[i] *= gain;

  // ---------- 1. リズム用の細かい解析（音の出だしを探す） ----------
  onProgress(0.02, 'リズムを聴き取っています…');
  const nS = 1024, hopS = 256;
  const fS = makeFFT(nS);
  const framesS = Math.ceil(x.length / hopS);
  const binS = (f) => Math.min(nS / 2 - 1, Math.round((f * nS) / sr));
  const bands = { all: [1, nS / 2], low: [binS(30), binS(150)], body: [binS(150), binS(300)], mid: [binS(1000), binS(4000)], high: [binS(6000), binS(10000)] };
  const flux = {};
  for (const k in bands) flux[k] = new Float32Array(framesS);
  const E = { low: new Float32Array(framesS), mid: new Float32Array(framesS), high: new Float32Array(framesS) }; // 帯域ごとの大きさ
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
      if (E[k]) { let e = 0; for (let i = a; i <= b; i++) e += mag[i] * mag[i]; E[k][f] = e; }
    }
    [mag, prev] = [prev, mag];
    [lmag, lprev] = [lprev, lmag];
    if (f % 2000 === 0) onProgress(0.02 + 0.2 * (f / framesS), 'リズムを聴き取っています…');
  }
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
  for (const { i, p, s: str } of classifyDrums(flux, E, spread, hopT)) {
    const k = q(i * hopT);
    if (k < 0 || seen.has(`${k}:${p}`)) continue;
    seen.add(`${k}:${p}`);
    drumNotes.push({ t: k * step, d: p === 49 ? 1 : 0.08, p, v: Math.round(60 + 60 * str) });
  }

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
  for (let b = 1; b < nB / 2; b++) {
    const f = b * binHz;
    const pc = ((Math.round(12 * Math.log2(f / 440)) + 69) % 12 + 12) % 12;
    if (f >= 80 && f <= 1000) chromaBin[b] = pc;
  }
  const sal = new Float32Array(framesB * NP);
  const chroma = new Float32Array(framesB * 12);
  const chromaS = side ? new Float32Array(framesB * 12) : null; // 左右の差（歌が入っていない伴奏）の12音
  const energy = new Float32Array(framesB);
  const magB = new Float64Array(nB / 2);
  const magS = side ? new Float64Array(nB / 2) : null;
  const fS2 = side ? makeFFT(nB) : null;
  // メロディ（歌）用：真ん中の音から左右の差を引く ＝ 真ん中にある歌が浮かび上がる
  // （左右に広がったピアノ・弦などが弱まる。左右の差の 1.5 倍を引くのが、試した中で一番よかった）
  // ※ ドラムを弱める処理（時間方向の中央値）も試したが、歌の出だしまでぼけて成績が下がったので入れていない
  const CENTER = 1.5;
  const melMag = new Float64Array(nB / 2);
  // ベース：低い音を細かく見るため、8192点で調べる
  const nBass = 8192;
  const fBass = makeFFT(nBass);
  const bRanges = bassRanges(sr / nBass);
  const magBass = new Float64Array(nBass / 2);
  const bsal = new Float32Array(framesB * NBASS);
  // 伴奏のリズム：左右に広がった楽器の音（150〜2000Hz）が立ち上がったところ
  const sideFlux = side ? new Float32Array(framesB) : null;
  const sLo = Math.round(150 / binHz), sHi = Math.round(2000 / binHz);
  const sPrev = side ? new Float64Array(sHi + 1) : null;
  for (let f = 0; f < framesB; f++) {
    fB.magnitude(x, f * hopB - nB / 2, magB);
    if (side) fS2.magnitude(side, f * hopB - nB / 2, magS);
    fBass.magnitude(x, f * hopB - nBass / 2, magBass);
    for (let b = 0; b < 700; b++) magBass[b] = Math.sqrt(magBass[b]);
    bassSalienceFrame(magBass, bRanges, bsal, f * NBASS);
    if (side) {
      let fl = 0;
      for (let b = sLo; b <= sHi; b++) { const v = Math.sqrt(magS[b]); const d = v - sPrev[b]; if (d > 0) fl += d; sPrev[b] = v; }
      sideFlux[f] = fl;
    }
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
    for (let b = 1; b < nB / 2 - 1; b++) {
      const isPeak = magB[b] > magB[b - 1] && magB[b] >= magB[b + 1];
      if (!isPeak) continue;
      if (chromaBin[b] >= 0) chroma[f * 12 + chromaBin[b]] += magB[b];
    }
    if (side) {
      for (let b = 1; b < nB / 2 - 1; b++) {
        if (chromaBin[b] < 0) continue;
        const v = Math.sqrt(magS[b]), lo = Math.sqrt(magS[b - 1]), hi = Math.sqrt(magS[b + 1]);
        if (v > lo && v >= hi) chromaS[f * 12 + chromaBin[b]] += v;
      }
    }
    if (f % 300 === 0) onProgress(0.32 + 0.45 * (f / framesB), 'メロディを聴き取っています…');
  }

  // ---------- 5. メロディ（いちばん目立つ音の高さを、なめらかにつなぐ） ----------
  onProgress(0.8, 'メロディを音符にしています…');
  const melody = trackMelody(sal, framesB, hopB / sr, q, step);
  // 和音を調べるとき、歌の音は邪魔になるので弱める
  for (let f = 0; f < framesB; f++) {
    const pi = melody.path[f];
    if (pi < NP) chroma[f * 12 + ((MEL_LO + pi) % 12)] *= 0.4;
  }
  // ベース
  onProgress(0.86, 'ベースを聴き取っています…');
  const bass = trackBass(bsal, framesB, hopB / sr, q, step);
  const useBass = bass.coverage > 0.2 && bass.notes.length >= 4;
  const bassPcAt = (t) => {
    if (!useBass) return -1;
    const rel = t - offset;
    const n = bass.notes.find((x) => x.t <= rel + 1e-6 && x.t + x.d / 0.95 > rel);
    return n ? n.p % 12 : -1;
  };

  // ---------- 6. 和音（1拍ごと・セブンスも） ----------
  onProgress(0.9, 'コードを調べています…');
  const chords = chordsByBeat(chroma, energy, framesB, hopB / sr, offset, beat, bassPcAt, chromaS);

  const tracks = [{ name: 'メロディ', role: 'melody', notes: melody }];
  if (chords.length) {
    const acc = buildAccompaniment(chords, bpm, { drums: false });
    // 伴奏：左右に広がった楽器が鳴ったタイミングで和音を鳴らす（わからなければ伸ばす）
    const onsets = compOnsets(sideFlux, hopB / sr, x.length / sr, beat);
    tracks.push(onsets ? { name: '伴奏（和音）', role: 'chords', notes: compNotes(chords, onsets, offset, beat) } : acc.find((t) => t.role === 'chords'));
    // ベース：聴き取れたら実際の音、だめなら和音の根っこ
    tracks.push(useBass ? { name: 'ベース', role: 'bass', notes: bass.notes } : acc.find((t) => t.role === 'bass'));
  } else if (useBass) tracks.push({ name: 'ベース', role: 'bass', notes: bass.notes });
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
  const res = out.map((n) => ({ t: n.qs * step, d: (n.qe - n.qs) * step * 0.95, p: n.p, v: n.v }));
  res.path = path; // フレームごとの高さ（NP＝鳴っていない）
  return res;
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

/** 伴奏の音符：和音ごとに、伴奏が鳴ったタイミング（onsets：秒）で和音を鳴らし、次のタイミングまで伸ばす */
function compNotes(chords, onsets, offset, beat) {
  const grid = [...new Set(onsets.map((t) => Math.round(((t - offset) / beat) * 4) / 4))].filter((b) => b >= 0).sort((a, b) => a - b);
  const out = [];
  for (const c of chords) {
    const a = c.start, e = c.start + c.beats;
    const hits = grid.filter((b) => b >= a - 1e-6 && b < e - 1e-6);
    if (!hits.length || hits[0] - a > 0.26) hits.unshift(a); // 和音が変わるところでは必ず鳴らす
    const ps = voiceChord(c.chord);
    hits.forEach((h, k) => {
      const nxt = k + 1 < hits.length ? hits[k + 1] : e;
      const d = Math.max(0.2, Math.min(nxt - h, 2)) * beat * 0.92;
      for (const p of ps) out.push({ t: h * beat, d, p, v: 82 });
    });
  }
  return out;
}
