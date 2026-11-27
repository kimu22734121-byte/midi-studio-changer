// テスト用：電子音系の曲（ステレオ）。
// style 'euro'：ユーロビート風（オクターブで跳ねる8分のベース、毎拍の長いバスドラ、クラップ、裏拍の開いたハイハット、
//                スーパーソーの和音（バスドラに合わせて音量が上下）、16分のアルペジオ、ボカロのような揺れのない速い歌）
// style 'vocalo'：ボカロ・エレクトロ風（ベースは跳ねずに刻む、歌はもっと細かく速い）
const CH = {
  Dm: [2, [0, 3, 7]], Bb: [10, [0, 4, 7]], C: [0, [0, 4, 7]], Am: [9, [0, 3, 7]],
  F: [5, [0, 4, 7]], G: [7, [0, 4, 7]], Em: [4, [0, 3, 7]],
};
const PROGS = { euro: ['Dm', 'Bb', 'C', 'Am', 'Dm', 'Bb', 'C', 'C'], vocalo: ['F', 'G', 'Em', 'Am', 'F', 'G', 'C', 'C'] };

export function synthEdmSong({ sr = 22050, style = 'euro', bpm = style === 'euro' ? 155 : 130, bars = 8, seed = 31 } = {}) {
  const beat = 60 / bpm, e8 = beat / 2, e16 = beat / 4;
  const t0 = 0.5;
  const len = Math.ceil((t0 + bars * 4 * beat + 1.5) * sr);
  const L = new Float32Array(len), R = new Float32Array(len);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const hz = (p) => 440 * 2 ** ((p - 69) / 12);
  const add = (i, v, pan) => { if (i >= 0 && i < len) { L[i] += v * pan; R[i] += v * (1 - pan); } };
  const truth = { bass: [], chords: [], arp: [], drums: [], melody: [] };
  // バスドラに合わせて音量が下がる（サイドチェイン）
  const duck = (t) => { const ph = ((t - t0) % beat + beat) % beat; return 0.35 + 0.65 * Math.min(1, ph / (beat * 0.6)); };

  for (let bar = 0; bar < bars; bar++) {
    const name = PROGS[style][bar % 8];
    const [root, iv] = CH[name];
    const tb = t0 + bar * 4 * beat;
    truth.chords.push({ t: tb, d: 4 * beat, root, name, pcs: iv.map((x) => (root + x) % 12) });
    // ---- ベース（のこぎり波） ----
    const br = 36 + ((root - 0 + 12) % 12); // C2〜B2
    for (let k = 0; k < 8; k++) {
      const p = style === 'euro' ? (k % 2 ? br + 12 : br) : br;
      const t = tb + k * e8, d = e8 * 0.8, f = hz(p);
      const a = Math.floor(t * sr), e = Math.floor((t + d) * sr);
      let ph = 0;
      for (let i = a; i < e; i++) {
        const tt = (i - a) / sr;
        ph = (ph + f / sr) % 1;
        // のこぎり波を少しこもらせる（倍音を弱める）
        let v = 0;
        for (let h = 1; h <= 10; h++) v += Math.sin(2 * Math.PI * h * ph) / h / (1 + h * 0.15);
        add(i, 0.2 * v * Math.min(1, tt / 0.003) * Math.exp(-tt * 4) * Math.min(1, (e - i) / sr / 0.01), 0.5);
      }
      truth.bass.push({ t, d, p });
    }
    // ---- スーパーソーの和音（7本ずつ・左右に広げる・バスドラに合わせて上下） ----
    const voices = iv.map((x) => 60 + ((root + x) % 12)).map((p) => (p > 71 ? p - 12 : p));
    for (const p of voices) {
      for (let v = 0; v < 7; v++) {
        const det = (v - 3) * 0.006, pan = v / 6, f = hz(p) * (1 + det);
        const a = Math.floor(tb * sr), e = Math.floor((tb + 4 * beat) * sr);
        let ph = (v * 0.37) % 1;
        for (let i = a; i < e; i++) {
          ph = (ph + f / sr) % 1;
          add(i, 0.012 * (2 * ph - 1) * duck(i / sr) * Math.min(1, (i - a) / sr / 0.02), 0.1 + pan * 0.8);
        }
      }
    }
    // ---- アルペジオ（16分・右寄り・四角い波） ----
    const arpTones = [...voices.map((p) => p + 12), voices[0] + 24];
    for (let k = 0; k < 16; k++) {
      const p = arpTones[[0, 1, 2, 3, 2, 1, 0, 1][k % 8]];
      const t = tb + k * e16, d = e16 * 0.7, f = hz(p);
      const a = Math.floor(t * sr), e = Math.floor((t + d) * sr);
      for (let i = a; i < e; i++) {
        const tt = (i - a) / sr;
        let v = 0;
        for (let h = 1; h <= 9; h += 2) v += Math.sin(2 * Math.PI * f * h * tt) / h;
        add(i, 0.05 * v * Math.exp(-tt * 12) * Math.min(1, (e - i) / sr / 0.005), 0.75);
      }
      truth.arp.push({ t, d, p });
    }
    // ---- ドラム：毎拍の長いバスドラ、2・4拍のクラップ、裏拍の開いたハイハット ----
    for (let b = 0; b < 4; b++) {
      const t = tb + b * beat, a = Math.floor(t * sr);
      for (let i = 0; i < 0.5 * sr; i++) {
        const tt = i / sr;
        add(a + i, 0.6 * Math.exp(-tt * 5) * Math.sin(2 * Math.PI * (52 * tt + (90 / 25) * (1 - Math.exp(-tt * 25)))) + (tt < 0.003 ? rnd() * 0.3 : 0), 0.5);
      }
      truth.drums.push({ t, kind: 'kick' });
      if (b === 1 || b === 3) {
        // クラップ：3回ばらけて鳴る雑音（胴の音はない）
        let lp = 0, hp = 0;
        for (let i = 0; i < 0.25 * sr; i++) {
          const tt = i / sr;
          const env = [0, 0.011, 0.022].some((x) => tt >= x && tt < x + 0.006) ? 1 : tt > 0.022 ? Math.exp(-(tt - 0.022) * 22) : 0;
          const n = rnd(); lp += 0.35 * (n - lp); hp = lp - hp * 0.2;
          add(a + i, 0.4 * hp * env, 0.5);
        }
        truth.drums.push({ t, kind: 'clap' });
      }
      // 裏拍の開いたハイハット
      const th = t + e8, ah = Math.floor(th * sr);
      let pr = 0;
      for (let i = 0; i < 0.15 * sr; i++) { const n = rnd(); add(ah + i, 0.09 * (n - pr) * Math.exp(-i / sr * 15), 0.4); pr = n; }
      truth.drums.push({ t: th, kind: 'hat' });
    }
  }
  // ---- 歌（ボカロ風：揺れがない、すばやく次の音へ、高めの音で速く動く） ----
  const fast = style === 'vocalo';
  const phrase = fast
    ? [[74, 1], [76, 1], [77, 1], [79, 1], [77, 2], [76, 2], [74, 1], [72, 1], [74, 2], [null, 4], [79, 2], [81, 2], [79, 1], [77, 1], [76, 2], [74, 4], [null, 4]]
    : [[74, 2], [74, 1], [76, 1], [77, 2], [76, 2], [74, 2], [72, 2], [74, 4], [77, 2], [79, 2], [81, 4], [79, 2], [77, 2], [76, 4]];
  // 長さは16分音符いくつ分
  let pos = 0, prevF = null;
  const total = bars * 16;
  while (pos < total) {
    for (const [p, n] of phrase) {
      if (pos >= total) break;
      if (p !== null) {
        const t = t0 + pos * e16, d = n * e16 * 0.92;
        const f0 = hz(p), fStart = prevF ?? f0;
        const a = Math.floor(t * sr), e = Math.floor((t + d) * sr);
        let ph = 0;
        for (let i = a; i < e; i++) {
          const tt = (i - a) / sr;
          const f = tt < 0.02 ? fStart + (f0 - fStart) * (tt / 0.02) : f0; // すばやく次の音へ
          ph += (2 * Math.PI * f) / sr;
          let v = 0;
          for (let h = 1; h <= 14; h++) v += (Math.sin(h * ph) / h ** 0.7) * (1 / (1 + ((f * h - 1000) / 450) ** 2) + 1 / (1 + ((f * h - 2600) / 500) ** 2) * 0.4 + 0.08);
          add(i, 0.2 * v * Math.min(1, tt / 0.01) * Math.min(1, (e - i) / sr / 0.02), 0.5);
        }
        truth.melody.push({ t, d, p });
        prevF = f0;
      } else prevF = null;
      pos += n;
    }
  }
  // ---- 全体の音量を詰め込む ----
  let pk = 0;
  for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const g = 2.2 / pk;
  for (let i = 0; i < len; i++) { L[i] = Math.tanh(L[i] * g) * 0.9; R[i] = Math.tanh(R[i] * g) * 0.9; }
  return { L, R, sr, bpm, truth, t0 };
}

/** 正解と比べる（off：時間のずれ） */
export function edmScore(song, truth, off) {
  const base = song.tracks.filter((t) => !t.layer);
  const tr = (pred) => base.filter(pred).flatMap((t) => t.notes).map((n) => ({ ...n, t: n.t + off }));
  const f1 = (found, want, match) => {
    const used = new Set();
    let hit = 0;
    for (const w of want) {
      const k = found.findIndex((x, i) => !used.has(i) && match(x, w));
      if (k >= 0) { used.add(k); hit++; }
    }
    const rec = want.length ? hit / want.length : 0, pre = found.length ? hit / found.length : 0;
    return { rec, pre, f: rec + pre ? (2 * rec * pre) / (rec + pre) : 0 };
  };
  const near = (x, w, tol = 0.06) => Math.abs(x.t - w.t) < tol;
  const drums = tr((t) => t.isDrum);
  const kind = (p) => (p === 35 || p === 36 ? 'kick' : [37, 38, 39, 40].includes(p) ? 'clap' : [42, 44, 46].includes(p) ? 'hat' : 'other');
  const dk = (k) => f1(drums.filter((n) => kind(n.p) === k), truth.drums.filter((d) => d.kind === k), (x, w) => near(x, w));
  const band = tr((t) => !t.isDrum && (t.role === 'chords' || t.role === 'other'));
  // 和音：小節ごとに、伴奏で鳴っている音名が正解の和音の音を含むか
  let chordOk = 0;
  for (const c of truth.chords) {
    const on = band.filter((n) => n.t < c.t + c.d && n.t + n.d > c.t + 0.1);
    const pcs = new Set(on.map((n) => n.p % 12));
    if (pcs.has(c.root) && c.pcs.filter((x) => pcs.has(x)).length >= 2) chordOk++;
  }
  return {
    melody: f1(tr((t) => t.role === 'melody'), truth.melody, (x, w) => x.p === w.p && near(x, w, 0.08)),
    bassExact: f1(tr((t) => t.role === 'bass'), truth.bass, (x, w) => x.p === w.p && near(x, w)),
    bassOct: f1(tr((t) => t.role === 'bass'), truth.bass, (x, w) => (x.p - w.p) % 12 === 0 && near(x, w)),
    arp: f1(band, truth.arp, (x, w) => x.p === w.p && near(x, w, 0.05)),
    chordBars: chordOk / truth.chords.length,
    kick: dk('kick'), clap: dk('clap'), hat: dk('hat'),
  };
}
