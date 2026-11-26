// テスト用：合成した「歌っぽいメロディ＋和音＋ドラム」の音声を作る
export function synthSong({ sr = 22050, bpm = 120, bars = 8 } = {}) {
  const beat = 60 / bpm;
  const len = Math.ceil(bars * 4 * beat * sr) + sr;
  const x = new Float32Array(len);
  const melody = [];
  const scale = [67, 69, 71, 72, 74, 72, 71, 69];
  for (let i = 0; i < bars * 4; i++) melody.push({ t: 0.5 + i * beat, d: beat * 0.9, p: scale[i % scale.length] });
  const tone = (t, d, p, amp, harm) => {
    const f = 440 * 2 ** ((p - 69) / 12);
    const a = Math.floor(t * sr), b = Math.min(len, Math.floor((t + d) * sr));
    for (let i = a; i < b; i++) {
      const tt = (i - a) / sr;
      const env = Math.min(1, tt / 0.02) * Math.min(1, (b - i) / sr / 0.03);
      let s = 0;
      for (let h = 1; h <= harm; h++) s += Math.sin(2 * Math.PI * f * h * tt) / h;
      x[i] += amp * env * s;
    }
  };
  for (const n of melody) tone(n.t, n.d, n.p, 0.3, 6);
  const prog = [[48, 52, 55], [43, 47, 50], [45, 48, 52], [41, 45, 48]];
  for (let bar = 0; bar < bars; bar++) for (const p of prog[bar % 4]) tone(0.5 + bar * 4 * beat, 4 * beat, p, 0.06, 3);
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let k = 0; k < bars * 8; k++) {
    const t0 = 0.5 + k * beat / 2;
    const a = Math.floor(t0 * sr);
    if (k % 2 === 0) for (let i = 0; i < 0.15 * sr; i++) { const tt = i / sr; x[a + i] += 0.5 * Math.exp(-tt * 25) * Math.sin(2 * Math.PI * (50 + 100 * Math.exp(-tt * 30)) * tt); }
    for (let i = 0; i < 0.04 * sr; i++) x[a + i] += 0.08 * Math.exp(-i / sr * 80) * rnd();
  }
  return { x, sr, melody, bpm };
}
