// 拍の位置を、曲の最初から最後まで1拍ずつ追いかける（ビートトラッキング）。
// 人が演奏した曲は、速さが少しずつ揺れる。最初に決めた速さで目盛りを並べるだけだと、
// 曲の後ろの方で目盛りが実際の拍からずれて、ドラムやメロディが違う位置に置かれてしまう。
// ここでは、音の立ち上がりの強さから実際の拍を1つずつ見つけ、なめらかにしてから目盛りにする。
// 画面や Web Audio には依存しない（純粋な関数）。

/**
 * @param env   音の立ち上がりの強さ（フレームごと）
 * @param hopT  1フレームの長さ（秒）
 * @param bpm   曲全体の速さの目安
 * @param phase 最初の拍の位置の目安（秒）
 * @param envLow 低い音（バスドラ・ベース）の立ち上がり（どの拍が「表」かを決めるのに使う）
 * @returns { bpm, beats: [秒…], steady }  beats は 0 秒より後の拍の位置
 */
export function trackBeats(env, hopT, bpm, phase, envLow = null) {
  const N = env.length;
  const P = 60 / bpm / hopT; // 1拍のフレーム数
  const dur = N * hopT;
  const straight = () => {
    const beat = 60 / bpm;
    const off = ((phase % beat) + beat) % beat;
    const beats = [];
    for (let t = off; t < dur + beat; t += beat) beats.push(t);
    return { bpm, beats, steady: true };
  };
  if (N < P * 16) return straight();

  // 立ち上がりの強さをそろえる（平均0・ばらつき1）
  const o = new Float64Array(N);
  let m = 0, v = 0;
  for (let i = 0; i < N; i++) m += env[i] / N;
  for (let i = 0; i < N; i++) v += (env[i] - m) ** 2 / N;
  const sd = Math.sqrt(v) || 1;
  for (let i = 0; i < N; i++) o[i] = (env[i] - m) / sd;

  // 動的計画法（Ellis の方法）：拍らしい所を通りつつ、拍の間隔がなるべく一定になる並びを探す
  const TIGHT = 100;
  const score = new Float64Array(N), back = new Int32Array(N).fill(-1);
  const lo = Math.round(P * 0.75), hi = Math.round(P * 1.33);
  for (let i = 0; i < N; i++) {
    let best = 0, bj = -1;
    for (let d = lo; d <= hi; d++) {
      const j = i - d;
      if (j < 0) break;
      const s = score[j] - TIGHT * Math.log(d / P) ** 2;
      if (bj < 0 || s > best) { best = s; bj = j; }
    }
    score[i] = o[i] + (bj >= 0 ? Math.max(0, best) : 0);
    back[i] = bj >= 0 && best > 0 ? bj : -1;
  }
  // 最後の1拍の中で一番よい所から、さかのぼる
  let end = N - 1;
  for (let i = Math.max(0, N - Math.round(P)); i < N; i++) if (score[i] > score[end]) end = i;
  const fr = [];
  for (let i = end; i >= 0; i = back[i]) fr.push(i);
  fr.reverse();
  if (fr.length < 16) return straight();

  // 「表」の拍か、半拍ずれた所かを確かめる（拍の上の方が、半拍の所より強いはず）
  const at = (arr, f) => (arr ? arr[Math.max(0, Math.min(N - 1, Math.round(f)))] : 0);
  let onS = 0, midS = 0;
  for (let k = 0; k + 1 < fr.length; k++) {
    const mid = (fr[k] + fr[k + 1]) / 2;
    onS += at(env, fr[k]) + 0.8 * at(envLow, fr[k]);
    midS += at(env, mid) + 0.8 * at(envLow, mid);
  }
  let t = fr.map((f) => f * hopT);
  if (midS > onS * 1.1) t = t.slice(0, -1).map((x, k) => (x + t[k + 1]) / 2);

  // なめらかにする：前後 8 拍ずつで直線を当てはめた位置にする（1フレームのがたつきを消す）
  const W = 8;
  const sm = t.map((_, j) => {
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let k = Math.max(0, j - W); k <= Math.min(t.length - 1, j + W); k++) {
      const w = 1 - Math.abs(k - j) / (W + 1);
      n += w; sx += w * k; sy += w * t[k]; sxx += w * k * k; sxy += w * k * t[k];
    }
    const b = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
    const a = (sy - b * sx) / n;
    return a + b * j;
  });

  // 曲全体で1本の直線（一定の速さ）に当てはめて、ずれがとても小さければ「一定の速さの曲」とみなす
  // （打ち込みの曲など。直線の方が正確）
  const n = sm.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let k = 0; k < n; k++) { sx += k; sy += sm[k]; sxx += k * k; sxy += k * sm[k]; }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const icpt = (sy - slope * sx) / n;
  let res = 0;
  for (let k = 0; k < n; k++) res = Math.max(res, Math.abs(sm[k] - (icpt + slope * k)));
  const steady = res < 0.25 * (60 / bpm) * 0.25; // 16分音符の 1/4 より小さいずれ
  let beats = steady ? sm.map((_, k) => icpt + slope * k) : sm;
  const outBpm = 60 / slope;
  // 最初と最後の外側にも、同じ間隔で拍を足す（曲の頭とお尻）
  const p0 = beats[1] - beats[0], p1 = beats[n - 1] - beats[n - 2];
  const head = [];
  for (let x = beats[0] - p0; x > -p0 * 0.5; x -= p0) head.unshift(x);
  const tail = [];
  for (let x = beats[n - 1] + p1; x < dur + p1 * 2; x += p1) tail.push(x);
  beats = [...head, ...beats, ...tail].filter((x) => x >= -1e-9);
  return { bpm: outBpm, beats, steady };
}

/**
 * 拍の位置の一覧から、目盛りを作る。
 *  pos(t)：秒 → 何拍目か（小数）／ at(b)：何拍目か → 秒 ／ q(t)：秒 → 16分音符の番号
 */
export function makeGrid(beats) {
  const B = beats;
  const n = B.length;
  const pos = (t) => {
    if (t <= B[0]) return (t - B[0]) / (B[1] - B[0]);
    if (t >= B[n - 1]) return n - 1 + (t - B[n - 1]) / (B[n - 1] - B[n - 2]);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (B[mid] <= t) lo = mid; else hi = mid; }
    return lo + (t - B[lo]) / (B[lo + 1] - B[lo]);
  };
  const at = (b) => {
    if (b <= 0) return B[0] + b * (B[1] - B[0]);
    if (b >= n - 1) return B[n - 1] + (b - n + 1) * (B[n - 1] - B[n - 2]);
    const i = Math.floor(b);
    return B[i] + (b - i) * (B[i + 1] - B[i]);
  };
  return { pos, at, q: (t) => Math.round(pos(t) * 4), count: n };
}
