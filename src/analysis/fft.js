// 高速フーリエ変換（音を周波数ごとに分ける計算）。サイズは2のべき乗。
export function makeFFT(n) {
  const bits = Math.round(Math.log2(n));
  if (1 << bits !== n) throw new Error('FFT size must be power of 2');
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = Math.sin((2 * Math.PI * i) / n); }
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r = (r << 1) | ((i >>> b) & 1);
    rev[i] = r;
  }
  const re = new Float64Array(n), im = new Float64Array(n);
  const window = new Float64Array(n);
  for (let i = 0; i < n; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);

  /** samples の offset から n 個を窓かけして変換し、振幅を mag (長さ n/2) に入れる */
  function magnitude(samples, offset, mag) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      const s = offset + i;
      re[j] = s >= 0 && s < samples.length ? samples[s] * window[i] : 0;
      im[j] = 0;
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tr = re[l] * cos[k] + im[l] * sin[k];
          const ti = im[l] * cos[k] - re[l] * sin[k];
          re[l] = re[j] - tr; im[l] = im[j] - ti;
          re[j] += tr; im[j] += ti;
        }
      }
    }
    for (let i = 0; i < n / 2; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    return mag;
  }
  return { n, magnitude };
}
