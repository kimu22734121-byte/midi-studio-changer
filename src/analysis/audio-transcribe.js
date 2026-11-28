// 音声 → 打ち込み用の音符（メロディ・コード・ドラム）への自動採譜。
// 画面やWeb Audioには依存しない純粋な計算だけ（将来サーバーへ移せるように）。
// 入力：モノラルの Float32Array と サンプリングレート（ANALYSIS_SR 推奨）。
import { makeFFT } from './fft.js';
import { trackBeats, makeGrid } from './beat-grid.js';
import { createSong } from '../core/song.js';
import { buildAccompaniment, voiceChord } from '../core/chords.js';
import { bassRanges, bassSalienceFrame, trackBass, NBASS, chordsByBeat, compOnsets, classifyDrums, pickPeaks, bandRanges, bandFrame, trackBand, MAX_BAND_NOTES } from './instruments.js';

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
  // ベースの弾き直し用：真ん中の音（左右に広がったピアノ・ギターを除く）の 100〜400Hz（バスドラはもっと低い）
  const bassH = new Float32Array(framesS);
  const bA = binS(100), bB = binS(400);
  const magSide = side ? new Float64Array(nS / 2) : null;
  const fSide = side ? makeFFT(nS) : null;
  const cPrev = new Float64Array(bB + 1);
  const mA = binS(1000), mB = binS(4000);
  const cmPrev = new Float64Array(mB + 1);
  flux.cmid = new Float32Array(framesS); // 真ん中の音だけの 1〜4kHz の立ち上がり（クラップ・スネア用。シンセに邪魔されにくい）
  const spreadC = new Float32Array(framesS);
  for (let f = 0; f < framesS; f++) {
    fS.magnitude(x, f * hopS - nS / 2, mag);
    if (side) fSide.magnitude(side, f * hopS - nS / 2, magSide);
    let bh = 0;
    for (let i = bA; i <= bB; i++) {
      const c = Math.sqrt(side ? Math.max(0, mag[i] - 1.5 * magSide[i]) : mag[i]);
      const d = c - cPrev[i];
      if (d > 0) bh += d;
      cPrev[i] = c;
    }
    bassH[f] = bh;
    let cm = 0, cup = 0;
    for (let i = mA; i <= mB; i++) {
      const c = side ? Math.max(0, mag[i] - 1.5 * magSide[i]) : mag[i];
      const d = c - cmPrev[i];
      if (d > 0) { cm += d; cup++; }
      cmPrev[i] = c;
    }
    flux.cmid[f] = cm / (mB - mA + 1);
    spreadC[f] = cup / (mB - mA + 1);
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
  const envLow = highPass(flux.low, Math.round(0.4 / hopT));
  const tempo0 = estimateTempo(env, hopT, envLow);
  // 1拍ずつ拍を追いかけて目盛りにする（人が演奏した曲の速さの揺れや、長い曲でのずれに合わせる）。
  // 出来上がる曲は一定の速さに並べ直す（k 番目の16分音符 → k × step 秒）
  const tb = trackBeats(env, hopT, tempo0.bpm, tempo0.phase, envLow);
  const bpm = tb.bpm;
  const beat = 60 / bpm;
  const step = beat / 4; // 16分音符
  const grid = makeGrid(tb.beats);
  const offset = grid.at(0);
  const q = grid.q;

  // ---------- 3. ドラム ----------
  onProgress(0.3, 'ドラムを聴き取っています…');
  const drumNotes = [];
  const seen = new Set();
  for (const { i, p, s: str, w, lb } of classifyDrums(flux, E, spread, hopT, spreadC)) {
    const k = q(i * hopT);
    if (k < 0 || seen.has(`${k}:${p}`)) continue;
    seen.add(`${k}:${p}`);
    drumNotes.push({ t: k * step, d: p === 49 ? 1 : 0.08, p, v: Math.round(60 + 60 * str), k, w: w ?? str, lb });
  }
  // スネアはふつう表の拍に並ぶ。半分以上が裏拍にあるなら、それは本物のスネアではない
  // （ユーロビートの裏拍で跳ねるベースと開いたハイハットが重なると、スネアに見える）ので、裏拍のものを外す
  {
    const sn = drumNotes.filter((n) => n.p === 38);
    const off = sn.filter((n) => n.k % 4 !== 0).length;
    if (sn.length && off >= sn.length * 0.5) {
      for (let i = drumNotes.length - 1; i >= 0; i--) if (drumNotes[i].p === 38 && drumNotes[i].k % 4 !== 0) drumNotes.splice(i, 1);
    }
  }
  // クラップは、表の拍のスネアがほとんどない曲（電子音の曲はスネアの代わりにクラップが多い）だけで使う
  {
    const bars = x.length / sr / (beat * 4);
    if (drumNotes.filter((n) => n.p === 38).length >= bars) {
      for (let i = drumNotes.length - 1; i >= 0; i--) if (drumNotes[i].p === 39) drumNotes.splice(i, 1);
    }
  }
  // クラップは、2拍目・4拍目のように「1拍おき」に強く出てくるときだけ残す。
  // 毎拍のバスドラにも少し「カッ」が入るので、数ではなく強さで、1拍おきの片方がはっきり強いかを見る
  // （ハイハットやバスドラを取り違えたものは、どの拍も同じくらいなので外れる）
  {
    const onBeat = drumNotes.filter((n) => n.p === 39 && n.k % 4 === 0);
    const avgV = (par) => {
      const a = onBeat.filter((n) => (n.k / 4) % 2 === par);
      return a.length ? a.reduce((x, n) => x + n.w, 0) / a.length : 0;
    };
    const ve = avgV(0), vo = avgV(1);
    const dom = ve >= vo ? 0 : 1;
    const bars = x.length / sr / (beat * 4);
    const domCount = onBeat.filter((n) => (n.k / 4) % 2 === dom).length;
    const ok = domCount >= bars && Math.max(ve, vo) >= 1.06 * Math.min(ve, vo);
    for (let i = drumNotes.length - 1; i >= 0; i--) {
      const n = drumNotes[i];
      if (n.p === 39 && (!ok || n.k % 4 !== 0 || (n.k / 4) % 2 !== dom)) drumNotes.splice(i, 1);
    }
  }
  thinCymbals(drumNotes, beat);
  const kickLb = new Map(drumNotes.filter((n) => n.p === 36).map((n) => [n, n.lb]));
  // 拍の上にないバスドラで、その曲のふつうのバスドラよりはっきり弱いものは、
  // ひずんだギターの刻みやベースの「ドン」を拾ったものなので外す
  {
    const ks = drumNotes.filter((n) => n.p === 36).map((n) => n.w).sort((a, b) => a - b);
    const med = ks.length ? ks[ks.length >> 1] : 0;
    const TH = 0.6;
    for (let i = drumNotes.length - 1; i >= 0; i--) {
      const n = drumNotes[i];
      if (n.p === 36 && n.k % 4 !== 0 && n.w < TH * med) drumNotes.splice(i, 1);
    }
  }
  for (const n of drumNotes) { delete n.k; delete n.w; delete n.lb; }

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
  const melW = new Float64Array(nB / 2), cum = new Float64Array(nB / 2 + 1);
  // 歌の高さは短い時間幅（2048点・約0.09秒）で調べる（ボカロのような速い動きもまとまらないように）
  const nM = 2048;
  const fM = nM !== nB ? makeFFT(nM) : null;
  const fMs = nM !== nB && side ? makeFFT(nM) : null;
  const magM = nM !== nB ? new Float64Array(nM / 2) : null;
  const magMs = nM !== nB && side ? new Float64Array(nM / 2) : null;
  const melBinHz = sr / nM;
  const mRanges = [];
  for (let pi = 0; pi < NP; pi++) {
    const f0 = 440 * 2 ** ((MEL_LO + pi - 69) / 12);
    for (let h = 1; h <= H; h++) {
      const f = f0 * h;
      if (f > 5000) { mRanges.push(null); continue; }
      const w = Math.max(1, (f * 0.025) / melBinHz);
      mRanges.push([Math.max(1, Math.floor(f / melBinHz - w)), Math.ceil(f / melBinHz + w)]);
    }
  }
  // ベース：低い音を細かく見るため、8192点で調べる
  const nBass = 8192;
  const fBass = makeFFT(nBass);
  const bRanges = bassRanges(sr / nBass);
  const magBass = new Float64Array(nBass / 2);
  const bsal = new Float32Array(framesB * NBASS);
  // 毎拍バスドラが鳴る曲（電子音の曲によくある）では、ベースの音を一度ためておき、
  // くり返すバスドラの音を取り除いてからベースの高さを調べ直す（長く響くバスドラをベースと間違えないように）
  const kickTimes = drumNotes.filter((d) => d.p === 36).map((d) => grid.at(d.t / beat));
  const beatsTotal = x.length / sr / beat;
  const fourFloor = kickTimes.length >= beatsTotal * 0.75 &&
    drumNotes.filter((d) => d.p === 36 && Math.abs(d.t / beat - Math.round(d.t / beat)) < 0.05).length >= kickTimes.length * 0.85;
  const NBB = 450; // ベースの倍音が入る高さまで（約1.2kHz）
  const bassSpec = fourFloor ? new Float32Array(framesB * NBB) : null;
  // 伴奏のリズム：左右に広がった楽器の音（150〜2000Hz）が立ち上がったところ
  const sideFlux = side ? new Float32Array(framesB) : null;
  const sLo = Math.round(150 / binHz), sHi = Math.round(2000 / binHz);
  const sPrev = side ? new Float64Array(sHi + 1) : null;
  // バンド（ギター・キーボード）が実際に弾いている音：左右の差の音（歌・ベース・バスドラは真ん中なので入らない）で探す
  const bRangesBand = side ? bandRanges(binHz) : null;
  const bandTop = side ? Math.min(nB / 2 - 1, Math.ceil(6200 / binHz)) : 0;
  const bandMag = side ? new Float64Array(bandTop + 1) : null;
  const bandP = side ? new Uint8Array(framesB * MAX_BAND_NOTES) : null;
  const bandS = side ? new Float32Array(framesB * MAX_BAND_NOTES) : null;
  for (let f = 0; f < framesB; f++) {
    fB.magnitude(x, f * hopB - nB / 2, magB);
    if (side) fS2.magnitude(side, f * hopB - nB / 2, magS);
    fBass.magnitude(x, f * hopB - nBass / 2, magBass);
    for (let b = 0; b < 700; b++) magBass[b] = Math.sqrt(magBass[b]);
    bassSalienceFrame(magBass, bRanges, bsal, f * NBASS);
    if (bassSpec) for (let b = 0; b < NBB; b++) bassSpec[f * NBB + b] = magBass[b];
    if (side) {
      let fl = 0;
      for (let b = sLo; b <= sHi; b++) { const v = Math.sqrt(magS[b]); const d = v - sPrev[b]; if (d > 0) fl += d; sPrev[b] = v; }
      sideFlux[f] = fl;
      for (let b = 0; b <= bandTop; b++) bandMag[b] = Math.sqrt(magS[b]);
      bandFrame(bandMag, bRangesBand, bandP, bandS, f * MAX_BAND_NOTES);
    }
    if (fM) {
      fM.magnitude(x, f * hopB - nM / 2, magM);
      if (side) fMs.magnitude(side, f * hopB - nM / 2, magMs);
      for (let b = 0; b < nM / 2; b++) melMag[b] = Math.sqrt(side ? Math.max(0, magM[b] - CENTER * magMs[b]) : magM[b]);
    } else {
      for (let b = 0; b < nB / 2; b++) melMag[b] = Math.sqrt(side ? Math.max(0, magB[b] - CENTER * magS[b]) : magB[b]);
    }
    // 音の「山」だけを残す：まわり（高さに比例した幅）のならした大きさを引く。
    // 伴奏がぎっしり鳴っていると、低い音の候補がどれも倍音を集めて強く見えてしまうのを防ぐ
    const WK = 1.0;
    {
      const nb = melMag.length;
      cum[0] = 0;
      for (let b = 0; b < nb; b++) cum[b + 1] = cum[b] + melMag[b];
      for (let b = 0; b < nb; b++) {
        const w = Math.max(3, Math.round(b * 0.06));
        const lo = Math.max(0, b - w), hi = Math.min(nb, b + w + 1);
        melW[b] = Math.max(0, melMag[b] - WK * (cum[hi] - cum[lo]) / (hi - lo));
      }
    }
    const MM = melW;
    for (let pi = 0; pi < NP; pi++) {
      let s = 0;
      for (let h = 0; h < H; h++) {
        const r = mRanges[pi * H + h];
        if (!r) break;
        let m = 0;
        for (let b = r[0]; b <= r[1]; b++) if (MM[b] > m) m = MM[b];
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
  const bassOnsets = new Set(pickPeaks(bassH, Math.round(0.08 / hopT), 0.25).map(({ i }) => Math.round((i * hopS) / hopB)));
  if (bassSpec) removeRepeatingKick(bassSpec, NBB, framesB, hopB / sr, kickTimes, beat, bRanges, bsal);
  const bass = trackBass(bsal, framesB, hopB / sr, q, step, bassOnsets);
  const useBass = bass.coverage > 0.2 && bass.notes.length >= 4;
  // ベースの音の出だしと重なる、拍の上にないバスドラで、その曲の拍の上のバスドラより「低い音の割合」がはっきり小さいものは、
  // ベースの「ボン」を拾ったものなので外す
  if (useBass) {
    const bassStarts = new Set(bass.notes.map((n) => Math.round(n.t / step)));
    const on = [...kickLb].filter(([n]) => Math.round(n.t / step) % 4 === 0).map(([, v]) => v).sort((a, b) => a - b);
    const ref = on.length >= 4 ? on[on.length >> 1] : 0;
    for (let i = drumNotes.length - 1; ref && i >= 0; i--) {
      const n = drumNotes[i];
      const k = Math.round(n.t / step);
      if (n.p === 36 && k % 4 !== 0 && bassStarts.has(k) && kickLb.get(n) < 0.6 * ref) drumNotes.splice(i, 1);
    }
  }
  const bassPcAt = (t) => {
    if (!useBass) return -1;
    const rel = grid.pos(t) * beat;
    const n = bass.notes.find((x) => x.t <= rel + 1e-6 && x.t + x.d / 0.95 > rel);
    return n ? n.p % 12 : -1;
  };

  // ---------- 6. 和音（1拍ごと・セブンスも） ----------
  onProgress(0.9, 'コードを調べています…');
  const chords = chordsByBeat(chroma, energy, framesB, hopB / sr, grid.at, beat, bassPcAt, chromaS);

  const tracks = [{ name: 'メロディ', role: 'melody', notes: melody }];
  if (chords.length) {
    const acc = buildAccompaniment(chords, bpm, { drums: false });
    // 伴奏：左右に広がった楽器が鳴ったタイミングで和音を鳴らす（わからなければ伸ばす）
    const onsets = compOnsets(sideFlux, hopB / sr, x.length / sr, beat);
    // 伴奏：①ギター・キーボードが実際に弾いている音 → ②和音を伴奏のリズムで → ③和音を伸ばす（わかるものを使う）
    let band = [];
    if (side) {
      const onF = new Set((onsets || []).map((t) => Math.round(t / (hopB / sr))));
      band = trackBand(bandP, bandS, framesB, hopB / sr, q, step, onF);
    }
    const bars = x.length / sr / (beat * 4);
    // 和音に含まれる音だけ残す（ひずんだギターの倍音などから生まれた余計な音を除く）
    band = keepChordTones(band, chords, beat);
    if (band.length >= bars * 2) tracks.push({ name: '伴奏（ギター・キーボードの音）', role: 'chords', notes: band });
    else tracks.push(onsets ? { name: '伴奏（和音）', role: 'chords', notes: compNotes(chords, onsets, grid, beat) } : acc.find((t) => t.role === 'chords'));
    // ベース：聴き取れたら実際の音、だめなら和音の根っこ
    tracks.push(useBass ? { name: 'ベース', role: 'bass', notes: bass.notes } : acc.find((t) => t.role === 'bass'));
  } else if (useBass) tracks.push({ name: 'ベース', role: 'bass', notes: bass.notes });
  tracks.push({ name: 'ドラム', role: 'drums', isDrum: true, notes: drumNotes });
  onProgress(1, 'できました');
  const song = createSong({ title, bpm: Math.round(bpm * 10) / 10, source, tracks });
  // 確かめる用（画面では使わない）：出来上がった曲の時刻 → 元の録音の時刻
  Object.defineProperty(song, 'toAudio', { value: (t) => grid.at(t / beat), enumerable: false });
  return song;
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

function estimateTempo(env, hopT, envLow = null) {
  const N = env.length;
  let best = -1, bestLag = Math.round(0.5 / hopT);
  const minLag = Math.floor(60 / 180 / hopT), maxLag = Math.ceil(60 / 70 / hopT);
  const ac = (lag) => {
    let s = 0;
    for (let i = 0; i + lag < N; i++) s += env[i] * env[i + lag];
    return s / (N - lag);
  };
  for (let lag = minLag; lag <= maxLag; lag++) {
    const s = ac(lag);
    const b = 60 / (lag * hopT);
    const w = Math.exp(-0.5 * (Math.log2(b / 120) / 0.8) ** 2);
    if (s * w > best) { best = s * w; bestLag = lag; }
  }
  // 選んだ速さの 2倍・1.5倍・2/3倍・半分 とも比べる（電子音の曲で 155 を 103 と取り違えていた）。
  // 拍の位置・裏拍の位置・さらに半分の位置に、音の鳴り始めがどれだけそろうかで決める
  // 候補の速さで、拍の位置・裏拍・さらに半分の位置に音の鳴り始めがどれだけそろうか
  const meanOf = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length) || 1;
  const mAll = meanOf(env), mLow = envLow ? meanOf(envLow) : 1;
  const fit = (arr, b, wts) => {
    const P = 60 / b / hopT;
    let best = 0;
    for (let ph = 0; ph < P; ph += 1) {
      let g = 0;
      for (const [frac, w] of wts) {
        let sum = 0, c = 0;
        for (let k = ph + frac * P; k < N; k += P) { sum += arr[Math.round(k)] || 0; c++; }
        g += w * (sum / Math.max(1, c));
      }
      if (g > best) best = g;
    }
    return best;
  };
  // 全体の音と、バスドラ（低い音：拍の頭に来やすい）の両方で見る。速さの好み（120前後）は弱めに
  const grid = (b) => {
    let sc = fit(env, b, [[0, 1], [0.5, 0.8], [0.25, 0.4], [0.75, 0.4]]) / mAll;
    if (envLow) sc += fit(envLow, b, [[0, 1]]) / mLow;
    return { raw: sc, score: sc * Math.exp(-0.5 * (Math.log2(b / 125) / 1.0) ** 2) };
  };
  const base = 60 / (bestLag * hopT);
  let bestB = base, bestG = grid(base);
  for (const r of [2, 1.5, 2 / 3, 0.5, 4 / 3, 0.75]) {
    const b = base * r;
    if (b < 70 || b > 190) continue;
    const g = grid(b);
    if (g.score > bestG.score * 1.1) { bestG = g; bestB = b; }
  }
  // 半分の速さに間違えると細かい音符がまとめられて大きく崩れるが、倍に間違えても害は小さい。
  // 92 未満になったときは倍にする（毎拍バスドラの速い曲は、1拍おきに見てもそろって見えて区別できないため）
  if (bestB < 92 && bestB * 2 <= 190) bestB *= 2;
  const b0 = bestB;
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
  // 歌の高さの好み：G4 あたりがいちばん。低い方は今まで通りに下げ、高い方（ボカロ・J-POP の高い歌）はあまり下げない
  const PC = 67, PWL = 12, PWH = 32;
  const prior = Array.from({ length: NP }, (_, i) => 0.6 + 0.4 * Math.exp(-0.5 * ((MEL_LO + i - PC) / (MEL_LO + i < PC ? PWL : PWH)) ** 2));
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
  // 1つだけ1オクターブ跳ねた短い音は、倍音を拾った取り違え：前後の音に合うように1オクターブ戻す
  fixOctaveSpikes(out, step);
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
      // まとめるのは「行って戻る（前と後ろが同じ高さ）＝ビブラート」と「出だしのしゃくり」だけ。
      // 順に上がる・下がる速い動き（ボカロなど）はまとめない
      const vib = prev && next && near(prev) && near(next) && prev.p === next.p;
      const scoop = next && near(next) && (!prev || !near(prev)) && s.p !== next.p;
      const cands = vib ? [prev, next] : scoop ? [next] : [];
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
function compNotes(chords, onsets, g, beat) {
  const grid = [...new Set(onsets.map((t) => Math.round(g.pos(t) * 4) / 4))].filter((b) => b >= 0).sort((a, b) => a - b);
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

/** 見つけた伴奏の音のうち、その時の和音に含まれる音だけを残す */
function keepChordTones(notes, chords, beat) {
  return notes.filter((n) => {
    const b = n.t / beat + 0.01;
    const c = chords.find((x) => x.start <= b && b < x.start + x.beats);
    if (!c) return false;
    const pcs = c.chord.intervals.map((iv) => (c.chord.root + iv) % 12);
    return pcs.includes(n.p % 12);
  });
}

/**
 * くり返すバスドラの音を取り除いて、ベースらしさを計算し直す。
 * バスドラの直前〜直後の音を、バスドラごとに位置をそろえて集め、位置ごとの中央値を「バスドラだけの音」とする
 * （ベースは小節ごとに高さが変わるので、中央値には残らない）。それを差し引いてから計算し直す。
 */
function removeRepeatingKick(spec, NBB, frames, hopT, kickTimes, beat, ranges, bsal) {
  const kf = kickTimes.map((t) => Math.round(t / hopT)).filter((f) => f >= 0 && f < frames).sort((a, b) => a - b);
  if (kf.length < 8) return;
  const H = Math.round(0.19 / hopT); // 調べる時間幅の半分（8192点）だけ前から、バスドラの音が入り始める
  const P = Math.max(4, Math.round(beat / hopT));
  const D0 = -H, D1 = P - H; // 一番近いバスドラから見た位置の範囲
  // 使うバスドラは最大 96 個（全体から均等に）
  const pick = kf.length > 96 ? Array.from({ length: 96 }, (_, i) => kf[Math.floor((i * kf.length) / 96)]) : kf;
  const K = new Map();
  const col = new Float32Array(pick.length);
  for (let d = D0; d < D1; d++) {
    const row = new Float32Array(NBB);
    for (let b = 0; b < NBB; b++) {
      let c = 0;
      for (const k of pick) { const f = k + d; if (f >= 0 && f < frames) col[c++] = spec[f * NBB + b]; }
      if (!c) continue;
      const a = col.subarray(0, c).sort();
      row[b] = a[c >> 1];
    }
    K.set(d, row);
  }
  const clean = new Float64Array(NBB);
  const out = new Float32Array(NBASS);
  let ki = 0;
  for (let f = 0; f < frames; f++) {
    while (ki + 1 < kf.length && Math.abs(kf[ki + 1] - f) <= Math.abs(kf[ki] - f)) ki++;
    const d = f - kf[ki];
    const row = d >= D0 && d < D1 ? K.get(d) : null;
    for (let b = 0; b < NBB; b++) clean[b] = row ? Math.max(0, spec[f * NBB + b] - row[b]) : spec[f * NBB + b];
    bassSalienceFrame(clean, ranges, out, 0);
    for (let i = 0; i < NBASS; i++) bsal[f * NBASS + i] = out[i];
  }
}

/**
 * ハイハット・シンバルの出すぎを間引く（同じ音が機関銃のように続かないように）。
 * n.k は 16分音符の位置。1小節＝16個。
 *  - ハイハット：1小節に 9 個以上（16分でびっしり）で、速い曲（1秒に9回より細かい）か、間の音（16分の裏）が
 *    表の音よりずっと弱いときは、雑音（ギターのジャーン・歌のサ行・残響）を拾っていることが多いので、8分の位置だけ残す
 *  - 同じ位置の閉じたハイハットと開いたハイハットは、強い方だけ
 *  - シンバル：1小節に1回まで。半分より多くの小節で鳴っているなら、いちばん多い位置のものを 2小節に1回まで
 */
export function thinCymbals(notes, beat = 0.5) {
  const del = new Set();
  const bars = new Map();
  for (const n of notes) {
    if (n.p !== 42 && n.p !== 46 && n.p !== 49) continue;
    const b = Math.floor(n.k / 16);
    if (!bars.has(b)) bars.set(b, []);
    bars.get(b).push(n);
  }
  for (const list of bars.values()) {
    const hats = list.filter((n) => n.p === 42 || n.p === 46);
    // 同じ位置の閉じた／開いたハイハット
    const at = new Map();
    for (const h of hats) {
      const o = at.get(h.k);
      if (!o) at.set(h.k, h);
      else if (h.w > o.w) { del.add(o); at.set(h.k, h); } else del.add(h);
    }
    const left = hats.filter((h) => !del.has(h));
    if (left.length > 8) {
      const avgW = (a) => (a.length ? a.reduce((x, h) => x + h.w, 0) / a.length : 0);
      const odd = left.filter((h) => h.k % 2), even = left.filter((h) => !(h.k % 2));
      if (4 / beat > 9 || avgW(odd) < 0.5 * avgW(even)) for (const h of odd) del.add(h);
    }
    const cym = list.filter((n) => n.p === 49);
    if (cym.length > 1) {
      const keep = cym.reduce((a, b) => (b.w > a.w ? b : a));
      for (const c of cym) if (c !== keep) del.add(c);
    }
  }
  // バスドラと同じ位置のハイハット：バスドラのアタックの「カチッ」を拾ったもの。
  // バスドラと重ならないハイハットよりはっきり弱いなら外す（本当に一緒に叩いているなら、同じくらいの強さになる）
  {
    const kicks = new Set(notes.filter((n) => n.p === 36).map((n) => n.k));
    const hats = notes.filter((n) => (n.p === 42 || n.p === 46) && !del.has(n));
    const onK = hats.filter((h) => kicks.has(h.k)), offK = hats.filter((h) => !kicks.has(h.k));
    const avgW = (a) => a.reduce((x, h) => x + h.w, 0) / (a.length || 1);
    // 電子音の曲のように、ハイハットが「拍の間（裏拍）」だけで鳴っている曲のときだけ
    // （ロックのように8分でずっと叩く曲では、バスドラと一緒のハイハットも本物）
    const offbeat = offK.filter((h) => h.k % 4 === 2).length >= offK.length * 0.8;
    if (onK.length >= 4 && offK.length >= 4 && offbeat) {
      const ref = avgW(offK);
      for (const h of onK) if (h.w < 0.85 * ref) del.add(h);
    }
  }
  const cyms = notes.filter((n) => n.p === 49 && !del.has(n));
  if (bars.size && cyms.length > Math.max(2, bars.size * 0.5)) {
    const pos = new Map();
    for (const c of cyms) pos.set(c.k % 16, (pos.get(c.k % 16) || 0) + 1);
    const best = [...pos].sort((a, b) => b[1] - a[1])[0][0];
    let last = -Infinity;
    for (const c of cyms.sort((a, b) => a.k - b.k)) {
      if (c.k % 16 !== best || c.k - last < 32) del.add(c);
      else last = c.k;
    }
  }
  for (let i = notes.length - 1; i >= 0; i--) if (del.has(notes[i])) notes.splice(i, 1);
}

/**
 * 前後の音から 1オクターブ近く離れて、1オクターブ動かすと前後にぴったり合う「短い音」を直す。
 * （歌の倍音を拾うと、1音だけ 1オクターブ上や下に跳ねたように見える。本物の歌ではめったにない）
 */
export function fixOctaveSpikes(notes, step) {
  const near = (a, b, gap) => b && Math.abs(a.qs - (b.qs < a.qs ? b.qe : b.qs)) <= gap;
  for (let i = 1; i < notes.length - 1; i++) {
    const n = notes[i], a = notes[i - 1], b = notes[i + 1];
    if ((n.qe - n.qs) * step > 0.35) continue;
    // 前後の音がすぐとなり（半拍以内）にあること
    const gap = Math.round(0.5 / step) || 2;
    if (!near(n, a, gap) || !near(n, b, gap)) continue;
    for (const sh of [-12, 12]) {
      const p = n.p + sh;
      if (Math.abs(n.p - a.p) >= 8 && Math.abs(n.p - b.p) >= 8 && Math.abs(p - a.p) <= 5 && Math.abs(p - b.p) <= 5) { n.p = p; break; }
    }
  }
}
