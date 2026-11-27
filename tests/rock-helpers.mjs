// テスト用：本物に近いロック風の曲（ステレオ）。
// エレキベース（同じ音を8分で刻む・倍音が強い）、ひずんだギター2本（左右・パワーコードの刻み）、
// キーボードのフレーズ（和音の音を順番に）、ドラム、歌。最後に全体の音量を詰め込む。
const ROOTS = { E: 4, C: 0, G: 7, D: 2, A: 9 };
const PROG = ['E', 'C', 'G', 'D', 'E', 'C', 'A', 'D'];
const MINOR = { E: true, A: true }; // キーボードのフレーズ用（Em・Am）

export function synthRockSong({ sr = 22050, bpm = 120, bars = 8, seed = 21, master = true } = {}) {
  const beat = 60 / bpm, e8 = beat / 2;
  const t0 = 0.5;
  const len = Math.ceil((t0 + bars * 4 * beat + 1.5) * sr);
  const L = new Float32Array(len), R = new Float32Array(len);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const truth = { bass: [], guitar: [], keys: [], chords: [], drums: [], melody: [] };
  const add = (i, v, pan) => { if (i >= 0 && i < len) { L[i] += v * pan; R[i] += v * (1 - pan); } };
  const hz = (p) => 440 * 2 ** ((p - 69) / 12);

  for (let bar = 0; bar < bars; bar++) {
    const name = PROG[bar % PROG.length];
    const r = ROOTS[name];
    const tb = t0 + bar * 4 * beat;
    truth.chords.push({ t: tb, d: 4 * beat, root: r, name });
    // ---- ベース：E1〜D2 あたりで8分の刻み、最後の2つはオクターブ上と5度 ----
    const br = 28 + ((r - 4 + 12) % 12); // E1=28 から上へ
    for (let k = 0; k < 8; k++) {
      const p = k === 6 ? br + 12 : k === 7 ? br + 7 : br;
      const t = tb + k * e8, d = e8 * 0.85;
      const f = hz(p);
      const amps = [0.7, 1, 0.6, 0.45, 0.35, 0.25, 0.2, 0.15];
      const a = Math.floor(t * sr), e = Math.floor((t + d) * sr);
      for (let i = a; i < e; i++) {
        const tt = (i - a) / sr;
        let v = 0;
        amps.forEach((am, h) => { v += am * Math.sin(2 * Math.PI * f * (h + 1) * tt); });
        add(i, 0.16 * v * Math.min(1, tt / 0.004) * Math.exp(-tt * 3) * Math.min(1, (e - i) / sr / 0.01), 0.5);
      }
      truth.bass.push({ t, d, p });
    }
    // ---- ギター2本（左・右）：パワーコード（根っこ・5度・オクターブ）の8分刻み、ひずみ ----
    const gr = 40 + ((r - 4 + 12) % 12); // E2=40 から上
    const power = [gr, gr + 7, gr + 12];
    for (let k = 0; k < 8; k++) {
      const accent = k % 4 === 0;
      for (const [pan, dt, det] of [[0.9, 0, 0], [0.1, 0.006, 0.004]]) {
        const t = tb + k * e8 + dt;
        const d = accent ? e8 * 0.9 : e8 * 0.5;
        const a = Math.floor(t * sr), e = Math.floor((t + d) * sr);
        for (let i = a; i < e; i++) {
          const tt = (i - a) / sr;
          let v = 0;
          for (const p of power) {
            const f = hz(p) * (1 + det);
            for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f * h * tt) / h;
          }
          v = Math.tanh(v * 1.4); // ひずみ
          add(i, 0.07 * v * Math.min(1, tt / 0.003) * Math.exp(-tt * (accent ? 2 : 9)), pan);
        }
      }
      for (const p of power) truth.guitar.push({ t: tb + k * e8, d: accent ? e8 * 0.9 : e8 * 0.5, p });
    }
    // ---- キーボード（右寄り）：和音の音を8分で順番に（1オクターブ上） ----
    const kr = 60 + r;
    const tones = [kr, kr + (MINOR[name] ? 3 : 4), kr + 7, kr + 12];
    const seq = [0, 1, 2, 3, 2, 1, 2, 3];
    for (let k = 0; k < 8; k++) {
      let p = tones[seq[k]];
      if (p > 79) p -= 12;
      const t = tb + k * e8, d = e8 * 0.8;
      const f = hz(p);
      const a = Math.floor(t * sr), e = Math.floor((t + d) * sr);
      for (let i = a; i < e; i++) {
        const tt = (i - a) / sr;
        let v = 0;
        for (let h = 1; h <= 5; h++) v += Math.sin(2 * Math.PI * f * h * tt) / (h * h);
        add(i, 0.09 * v * Math.min(1, tt / 0.003) * Math.exp(-tt * 4) * Math.min(1, (e - i) / sr / 0.01), 0.3);
      }
      truth.keys.push({ t, d, p });
    }
    // ---- ドラム ----
    const kick = (t) => { const a = Math.floor(t * sr); for (let i = 0; i < 0.3 * sr; i++) { const tt = i / sr; add(a + i, 0.55 * Math.exp(-tt * 12) * Math.sin(2 * Math.PI * (50 * tt + (100 / 30) * (1 - Math.exp(-tt * 30)))) + (tt < 0.003 ? rnd() * 0.25 : 0), 0.5); } };
    const snare = (t) => { const a = Math.floor(t * sr); let lp = 0; for (let i = 0; i < 0.35 * sr; i++) { const tt = i / sr; const n = rnd(); lp += 0.5 * (n - lp); add(a + i, 0.3 * (n - lp) * Math.exp(-tt * 10) + 0.22 * Math.sin(2 * Math.PI * 185 * tt) * Math.exp(-tt * 30), 0.5); } };
    const hat = (t) => { const a = Math.floor(t * sr); let pr = 0; for (let i = 0; i < 0.06 * sr; i++) { const n = rnd(); add(a + i, 0.1 * (n - pr) * Math.exp(-i / sr * 60), 0.6); pr = n; } };
    for (const kb of [0, 1.5, 2]) { kick(tb + kb * beat); truth.drums.push({ t: tb + kb * beat, kind: 'kick' }); }
    for (const sb of [1, 3]) { snare(tb + sb * beat); truth.drums.push({ t: tb + sb * beat, kind: 'snare' }); }
    for (let h = 0; h < 8; h++) { hat(tb + h * e8); truth.drums.push({ t: tb + h * e8, kind: 'hat' }); }
  }
  // ---- 歌（真ん中） ----
  const mel = [71, 71, 69, 67, 69, 71, 74, 71, 72, 71, 69, 67, 66, 67, 69, 66];
  for (let k = 0; k < bars * 2; k++) {
    const n = { t: t0 + k * 2 * beat, d: beat * 1.8, p: mel[k % mel.length] };
    truth.melody.push(n);
    const f0 = hz(n.p);
    const a = Math.floor(n.t * sr), e = Math.floor((n.t + n.d) * sr);
    let ph = 0;
    for (let i = a; i < e; i++) {
      const tt = (i - a) / sr;
      ph += (2 * Math.PI * f0 * 2 ** ((tt > 0.15 ? 0.35 * Math.sin(2 * Math.PI * 5.5 * tt) : 0) / 12)) / sr;
      let v = 0;
      for (let h = 1; h <= 12; h++) v += (Math.sin(h * ph) / h ** 0.8) * (1 / (1 + ((f0 * h - 900) / 400) ** 2) + 0.15);
      add(i, 0.2 * v * Math.min(1, tt / 0.03) * Math.min(1, (e - i) / sr / 0.05), 0.5);
    }
  }
  // ---- 全体の音量を詰め込む（大きい音と小さい音の差を小さく） ----
  if (master) {
    let pk = 0;
    for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
    const g = 2.5 / pk;
    for (let i = 0; i < len; i++) { L[i] = Math.tanh(L[i] * g) * 0.9; R[i] = Math.tanh(R[i] * g) * 0.9; }
  }
  return { L, R, sr, bpm, truth, t0 };
}

/** 正解と比べる（off：時間のずれ） */
export function rockScore(song, truth, off) {
  const tr = (role) => song.tracks.filter((t) => t.role === role && !t.layer).flatMap((t) => t.notes).map((n) => ({ ...n, t: n.t + off }));
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
  const near = (x, w) => Math.abs(x.t - w.t) < 0.07;
  const bass = tr('bass');
  const band = song.tracks.filter((t) => (t.role === 'chords' || t.role === 'other') && !t.layer).flatMap((t) => t.notes).map((n) => ({ ...n, t: n.t + off }));
  return {
    bassExact: f1(bass, truth.bass, (x, w) => x.p === w.p && near(x, w)),
    bassOct: f1(bass, truth.bass, (x, w) => (x.p - w.p) % 12 === 0 && near(x, w)),
    // バンド（ギター＋キーボード）：高さがぴったり／音名（オクターブ違いも可）
    bandExact: f1(band, [...truth.guitar, ...truth.keys], (x, w) => x.p === w.p && near(x, w)),
    bandName: f1(band, [...truth.guitar, ...truth.keys], (x, w) => (x.p - w.p) % 12 === 0 && near(x, w)),
    keys: f1(band, truth.keys, (x, w) => x.p === w.p && near(x, w)),
    kick: f1(song.tracks.filter((t) => t.isDrum && !t.layer).flatMap((t) => t.notes).filter((n) => n.p === 36).map((n) => ({ ...n, t: n.t + off })), truth.drums.filter((d) => d.kind === 'kick'), near),
  };
}
