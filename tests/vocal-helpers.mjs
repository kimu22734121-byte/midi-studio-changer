// テスト用：歌声入りの曲（ステレオ）を合成する。
// 歌声らしさ：ビブラート・しゃくり上げ・母音の響き（フォルマント）・息の音・子音。
// 歌は真ん中、ピアノと弦は左右に広げ、ベース・ドラムは真ん中。
export function synthVocalSong({ sr = 22050, bpm = 96, bars = 8, seed = 7, vocalLevel = 0.32 } = {}) {
  const beat = 60 / bpm;
  const len = Math.ceil((bars * 4 * beat + 1.5) * sr);
  const L = new Float32Array(len), R = new Float32Array(len);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const t0 = 0.5;

  // メロディ（長さは拍）：歌らしく、長い音・短い音・休みが混ざる
  const phrase = [[64, 1], [64, 0.5], [67, 0.5], [69, 1], [67, 1], [64, 1.5], [62, 0.5], [60, 1], [null, 1],
    [62, 0.5], [64, 0.5], [67, 1], [69, 0.5], [71, 0.5], [72, 2], [null, 1],
    [72, 1], [71, 0.5], [69, 0.5], [67, 1], [64, 1], [65, 1], [64, 0.5], [62, 0.5], [60, 2], [null, 2]];
  const melody = [];
  let b = 0;
  while (b < bars * 4) {
    for (const [p, d] of phrase) {
      if (b >= bars * 4) break;
      if (p !== null) melody.push({ t: t0 + b * beat, d: d * beat, p });
      b += d;
    }
  }

  // 母音の響き：だいたい「あ」（800Hz・1200Hz・2500Hz の山）
  const formants = [[800, 1, 90], [1200, 0.6, 110], [2500, 0.25, 160]];
  const formantGain = (f) => formants.reduce((g, [fc, a, bw]) => g + a / (1 + ((f - fc) / bw) ** 2), 0.04);
  for (const n of melody) {
    const f0 = 440 * 2 ** ((n.p - 69) / 12);
    const a = Math.floor(n.t * sr), e = Math.min(len, Math.floor((n.t + n.d * 0.92) * sr));
    let phase = 0;
    for (let i = a; i < e; i++) {
      const tt = (i - a) / sr;
      // しゃくり：出だしで半音下から 60ms かけて上がる／ビブラート：150ms 後から ±40 セント 5.5Hz
      const scoop = tt < 0.06 ? -1 + tt / 0.06 : 0;
      const vib = tt > 0.15 ? 0.4 * Math.sin(2 * Math.PI * 5.5 * tt) * Math.min(1, (tt - 0.15) / 0.2) : 0;
      const f = f0 * 2 ** ((scoop + vib) / 12);
      phase += (2 * Math.PI * f) / sr;
      let v = 0;
      for (let h = 1; h <= 20; h++) {
        const fh = f * h;
        if (fh > sr / 2 - 500) break;
        v += (formantGain(fh) / h ** 0.6) * Math.sin(h * phase);
      }
      const env = Math.min(1, tt / 0.03) * Math.min(1, (e - i) / sr / 0.05);
      v = v * env * 0.5 + rnd() * 0.04 * env; // 息の音
      // 子音（出だしの 40ms に「シュ」のような雑音）
      if (tt < 0.04) v += rnd() * 0.5 * (1 - tt / 0.04);
      L[i] += v * vocalLevel;
      R[i] += v * vocalLevel;
    }
  }

  // 伴奏：コード C - Am - F - G（1小節ずつ）
  const prog = [[48, 52, 55, 60], [45, 52, 57, 60], [41, 53, 57, 60], [43, 50, 55, 59]];
  const tone = (t, d, p, amp, panL, harm, decay) => {
    const f = 440 * 2 ** ((p - 69) / 12);
    const a = Math.floor(t * sr), e = Math.min(len, Math.floor((t + d) * sr));
    for (let i = a; i < e; i++) {
      const tt = (i - a) / sr;
      let v = 0;
      for (let h = 1; h <= harm; h++) v += Math.sin(2 * Math.PI * f * h * tt) / h;
      v *= amp * Math.min(1, tt / 0.01) * Math.exp(-tt * decay) * Math.min(1, (e - i) / sr / 0.03);
      L[i] += v * panL;
      R[i] += v * (1 - panL);
    }
  };
  for (let bar = 0; bar < bars; bar++) {
    const ch = prog[bar % 4];
    const tb = t0 + bar * 4 * beat;
    // ピアノ（左寄り）：8分で刻む
    for (let k = 0; k < 8; k++) for (const p of ch.slice(1)) tone(tb + k * beat / 2, beat / 2, p, 0.07, 0.85, 6, 3);
    // 弦（右寄り）：伸ばす
    for (const p of ch.slice(1)) tone(tb, 4 * beat, p + 12, 0.035, 0.15, 5, 0.1);
    // ベース（真ん中）
    for (let k = 0; k < 4; k++) tone(tb + k * beat, beat * 0.9, ch[0] - 12, 0.18, 0.5, 3, 1);
    // ドラム（真ん中）：バスドラ・スネア・ハイハット
    for (let k = 0; k < 8; k++) {
      const t = tb + k * beat / 2;
      const a = Math.floor(t * sr);
      if (k % 4 === 0) for (let i = 0; i < 0.2 * sr && a + i < len; i++) { const tt = i / sr; const v = 0.45 * Math.exp(-tt * 20) * Math.sin(2 * Math.PI * (50 * tt + 2.5 * (1 - Math.exp(-tt * 40)))); L[a + i] += v; R[a + i] += v; }
      if (k % 4 === 2) for (let i = 0; i < 0.15 * sr && a + i < len; i++) { const v = 0.25 * Math.exp(-i / sr * 25) * rnd(); L[a + i] += v; R[a + i] += v; }
      for (let i = 0; i < 0.04 * sr && a + i < len; i++) { const v = 0.06 * Math.exp(-i / sr * 90) * rnd(); L[a + i] += v * 0.6; R[a + i] += v * 0.4; }
    }
  }
  return { L, R, sr, melody, bpm };
}

/** メロディの正しさ：正解の音符のうち、同じ高さで半分以上重なる音符が見つかった割合（拾えた率）と、その逆（正しかった率） */
export function melodyScore(found, truth) {
  const hit = (a, list) => list.some((b) => b.p === a.p && Math.min(a.t + a.d, b.t + b.d) - Math.max(a.t, b.t) >= 0.5 * Math.min(a.d, b.d));
  const recall = truth.filter((n) => hit(n, found)).length / truth.length;
  const precision = found.length ? found.filter((n) => hit(n, truth)).length / found.length : 0;
  return { recall, precision, f: recall + precision ? (2 * recall * precision) / (recall + precision) : 0 };
}
