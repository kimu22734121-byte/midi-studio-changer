// テスト用：正解がわかっているバンドの曲（ステレオ）を合成する。
// ベース（ウォーキング風）・セブンスを含む和音・ピアノの刻み（裏拍あり）・弦・ドラム5種類・歌。
const CH = {
  C: [0, [0, 4, 7], 'maj'], Am7: [9, [0, 3, 7, 10], 'min'], Fmaj7: [5, [0, 4, 7, 11], 'maj'], G7: [7, [0, 4, 7, 10], 'maj'],
  Dm7: [2, [0, 3, 7, 10], 'min'], Em7: [4, [0, 3, 7, 10], 'min'], F: [5, [0, 4, 7], 'maj'], G: [7, [0, 4, 7], 'maj'],
  Am: [9, [0, 3, 7], 'min'], E7: [4, [0, 4, 7, 10], 'maj'], Dm: [2, [0, 3, 7], 'min'], Bb: [10, [0, 4, 7], 'maj'], E: [4, [0, 4, 7], 'maj'],
};
// 1小節ごと（[名前, 拍数] の並び）。4小節目・8小節目は途中で変わる
const PROGS = {
  pop: [[['C', 4]], [['Am7', 4]], [['Fmaj7', 4]], [['Dm7', 2], ['G7', 2]], [['C', 4]], [['Em7', 4]], [['F', 4]], [['Dm7', 2], ['G', 2]]],
  // 暗い調（Aマイナー）
  minor: [[['Am', 4]], [['F', 4]], [['C', 4]], [['G', 2], ['E7', 2]], [['Am', 4]], [['Dm', 4]], [['Bb', 2], ['F', 2]], [['E', 4]]],
};

// dense：ハイハットを16分で細かく刻み、残響のような高い音を薄く鳴らし続ける（本物の曲に近い）
// gain：全体の音量／ tap：最初に一瞬だけ大きな音（画面収録のタップ音など）
export function synthBandSong({ sr = 22050, bpm = 100, bars = 8, seed = 11, vocal = true, dense = false, gain = 1, tap = false, prog = 'pop' } = {}) {
  const PROG = PROGS[prog];
  const beat = 60 / bpm;
  const t0 = 0.5;
  const len = Math.ceil((t0 + bars * 4 * beat + 1.5) * sr);
  const L = new Float32Array(len), R = new Float32Array(len);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const truth = { chords: [], bass: [], piano: [], drums: [], melody: [] };

  const add = (i, v, pan) => { if (i >= 0 && i < len) { L[i] += v * pan; R[i] += v * (1 - pan); } };
  const tone = (t, d, p, amp, pan, harm, decay, tilt = 1) => {
    const f = 440 * 2 ** ((p - 69) / 12);
    const a = Math.floor(t * sr), e = Math.min(len, Math.floor((t + d) * sr));
    for (let i = a; i < e; i++) {
      const tt = (i - a) / sr;
      let v = 0;
      for (let h = 1; h <= harm; h++) if (f * h < sr / 2 - 200) v += Math.sin(2 * Math.PI * f * h * tt) / h ** tilt;
      v *= amp * Math.min(1, tt / 0.005) * Math.exp(-tt * decay) * Math.min(1, (e - i) / sr / 0.02);
      add(i, v, pan);
    }
  };

  const chordList = [];
  for (let bar = 0; bar < bars; bar++) {
    let b = 0;
    for (const [name, nb] of PROG[bar % PROG.length]) {
      chordList.push({ name, t: t0 + (bar * 4 + b) * beat, beats: nb, bar, beat: b });
      b += nb;
    }
  }
  for (const c of chordList) {
    const [root, iv, quality] = CH[c.name];
    truth.chords.push({ t: c.t, d: c.beats * beat, root, quality, seventh: iv.length > 3, name: c.name });
    // ピアノの刻み（左寄り）：1拍目・2拍目の裏・3拍目・4拍目の裏
    const voicing = iv.map((x) => 60 + ((root + x) % 12)).map((p) => (p > 71 ? p - 12 : p)).sort((a, b) => a - b);
    for (const hb of [0, 1.5, 2, 3.5]) {
      if (hb < c.beat || hb >= c.beat + c.beats) continue;
      const t = t0 + (c.bar * 4 + hb) * beat;
      for (const p of voicing) tone(t, beat * 0.4, p, 0.06, 0.85, 8, 4);
      truth.piano.push({ t, pitches: voicing });
    }
    // 弦（右寄り）：和音を伸ばす
    for (const p of voicing) tone(c.t, c.beats * beat, p + 12, 0.025, 0.15, 5, 0.2);
  }
  // ベース（真ん中）：根っこ・5度・オクターブ・次の根っこへつなぐ音
  for (let k = 0; k < chordList.length; k++) {
    const c = chordList[k];
    const root = CH[c.name][0];
    const next = CH[chordList[(k + 1) % chordList.length].name][0];
    const r = 36 + root;
    const nextR = 36 + next;
    const pattern = c.beats === 4 ? [r, r + 7, r + 12, nextR + (nextR > r ? -1 : 1)] : [r, r + 7];
    pattern.forEach((p, i) => {
      const t = c.t + i * beat;
      tone(t, beat * 0.85, p, 0.28, 0.5, 6, 2.2, 1.5);
      truth.bass.push({ t, d: beat * 0.85, p });
    });
  }
  // ドラム（真ん中、ハイハットは少し左）
  const kick = (t) => {
    const a = Math.floor(t * sr);
    for (let i = 0; i < 0.3 * sr; i++) { const tt = i / sr; add(a + i, 0.6 * Math.exp(-tt * 14) * Math.sin(2 * Math.PI * (48 * tt + (110 / 30) * (1 - Math.exp(-tt * 30)))) + (tt < 0.004 ? rnd() * 0.3 : 0), 0.5); }
  };
  const snare = (t) => {
    const a = Math.floor(t * sr);
    let lp = 0;
    for (let i = 0; i < 0.22 * sr; i++) { const tt = i / sr; const n = rnd(); lp += 0.5 * (n - lp); add(a + i, (0.32 * (n - lp) * Math.exp(-tt * 18) + 0.25 * Math.sin(2 * Math.PI * 190 * tt) * Math.exp(-tt * 35)), 0.5); }
  };
  const hat = (t, open) => {
    const a = Math.floor(t * sr);
    let prev = 0;
    for (let i = 0; i < (open ? 0.35 : 0.05) * sr; i++) { const tt = i / sr; const n = rnd(); add(a + i, 0.12 * (n - prev) * Math.exp(-tt * (open ? 8 : 70)), 0.6); prev = n; }
  };
  const crash = (t) => {
    const a = Math.floor(t * sr);
    let prev = 0;
    for (let i = 0; i < 1.5 * sr; i++) { const tt = i / sr; const n = rnd(); add(a + i, 0.16 * (n - prev * 0.6) * Math.exp(-tt * 2.5), 0.45); prev = n; }
  };
  for (let bar = 0; bar < bars; bar++) {
    const tb = t0 + bar * 4 * beat;
    for (const kb of [0, 1.5, 2]) { kick(tb + kb * beat); truth.drums.push({ t: tb + kb * beat, kind: 'kick' }); }
    for (const sb of [1, 3]) { snare(tb + sb * beat); truth.drums.push({ t: tb + sb * beat, kind: 'snare' }); }
    const div = dense ? 16 : 8;
    for (let h = 0; h < div; h++) {
      const open = h === div - 1;
      hat(tb + (h * 4 * beat) / div, open);
      truth.drums.push({ t: tb + (h * 4 * beat) / div, kind: 'hat' });
    }
    if (bar % 4 === 0) { crash(tb); truth.drums.push({ t: tb, kind: 'crash' }); }
  }
  // 歌（真ん中）：ビブラート付き
  if (vocal) {
    const mel = prog === 'minor' ? [69, 72, 72, 71, 67, 72, 71, 68, 69, 72, 74, 72, 70, 69, 68, 71] : [64, 67, 69, 67, 64, 62, 60, 62, 64, 67, 72, 71, 69, 67, 65, 64];
    for (let k = 0; k < bars * 2; k++) {
      const n = { t: t0 + k * 2 * beat, d: beat * 1.8, p: mel[k % mel.length] };
      truth.melody.push(n);
      const f0 = 440 * 2 ** ((n.p - 69) / 12);
      const a = Math.floor(n.t * sr), e = Math.floor((n.t + n.d) * sr);
      let ph = 0;
      for (let i = a; i < e; i++) {
        const tt = (i - a) / sr;
        const f = f0 * 2 ** ((tt > 0.15 ? 0.35 * Math.sin(2 * Math.PI * 5.5 * tt) : 0) / 12);
        ph += (2 * Math.PI * f) / sr;
        let v = 0;
        for (let h = 1; h <= 12; h++) v += Math.sin(h * ph) / h ** 0.8 * (1 / (1 + ((f * h - 900) / 400) ** 2) + 0.15);
        add(i, 0.22 * v * Math.min(1, tt / 0.03) * Math.min(1, (e - i) / sr / 0.05), 0.5);
      }
    }
  }
  if (dense) {
    // 残響・歌の「サ行」のような、ずっと続く薄い高い音
    let prev = 0;
    for (let i = 0; i < len; i++) { const n = rnd(); const v = 0.025 * (n - prev) * (0.7 + 0.3 * Math.sin(i / sr * 3)); L[i] += v; R[i] += v * 0.9; prev = n; }
  }
  if (gain !== 1) for (let i = 0; i < len; i++) { L[i] *= gain; R[i] *= gain; }
  if (tap) for (let i = 0; i < 0.01 * sr; i++) { const v = 0.95 * Math.exp(-i / sr * 400) * (i % 2 ? 1 : -1); L[Math.floor(0.1 * sr) + i] = v; R[Math.floor(0.1 * sr) + i] = v; }
  return { L, R, sr, bpm, truth, t0 };
}

/** 正解と比べる（ずれ off を足して比べる） */
export function bandScore(song, truth, off) {
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
  // ベース：同じ高さ（オクターブ違いも可）で、出だしが 0.1 秒以内
  const bass = f1(tr('bass'), truth.bass, (x, w) => (x.p - w.p) % 12 === 0 && Math.abs(x.t - w.t) < 0.1);
  const bassExact = f1(tr('bass'), truth.bass, (x, w) => x.p === w.p && Math.abs(x.t - w.t) < 0.1);
  // 和音：拍ごとに、伴奏トラックで鳴っている音の組み合わせから根っこを推定して比べる
  const chordNotes = tr('chords');
  let rootOk = 0, beats = 0, setOk = 0;
  for (const c of truth.chords) {
    for (let t = c.t + 0.1; t < c.t + c.d; t += c.d / Math.round(c.d / 0.6)) {
      beats++;
      const on = chordNotes.filter((n) => n.t <= t && n.t + n.d > t);
      if (!on.length) continue;
      const pcs = new Set(on.map((n) => n.p % 12));
      const want = CH[c.name][1].map((x) => (c.root + x) % 12);
      const low = on.reduce((a, b) => (b.p < a.p ? b : a)).p % 12;
      if (pcs.has(c.root) && want.filter((x) => pcs.has(x)).length >= Math.min(3, want.length)) rootOk++;
      if (want.every((x) => pcs.has(x)) && [...pcs].every((x) => want.includes(x))) setOk++;
      void low;
    }
  }
  // 伴奏のリズム：ピアノが弾いたタイミングに、伴奏の音が出ているか
  const onsets = [...new Set(chordNotes.map((n) => Math.round(n.t * 100)))].map((x) => ({ t: x / 100 }));
  const rhythm = f1(onsets, truth.piano, (x, w) => Math.abs(x.t - w.t) < 0.07);
  // ドラム：種類ごと
  const dn = tr('drums');
  const kindOf = (p) => (p === 35 || p === 36 ? 'kick' : p === 38 || p === 40 || p === 37 || p === 39 ? 'snare' : p === 42 || p === 44 || p === 46 ? 'hat' : p === 49 || p === 57 || p === 52 || p === 55 ? 'crash' : 'other');
  const drums = {};
  for (const k of ['kick', 'snare', 'hat', 'crash']) {
    drums[k] = f1(dn.filter((n) => kindOf(n.p) === k), truth.drums.filter((d) => d.kind === k), (x, w) => Math.abs(x.t - w.t) < 0.06);
  }
  return { bass, bassExact, chordRoot: rootOk / beats, chordExact: setOk / beats, rhythm, drums };
}

/**
 * 濁り率：鳴っている音（ドラム以外・増やしたパートも含む）のうち、
 * その瞬間の正しい和音・メロディ・ベースのどれにも含まれない音の割合（小さいほど濁りがない）
 */
export function muddiness(song, truth, off) {
  const notes = song.tracks.filter((t) => !t.isDrum).flatMap((t) => t.notes.map((n) => ({ ...n, t: n.t + off })));
  const end = Math.max(...truth.chords.map((c) => c.t + c.d));
  let bad = 0, all = 0;
  for (let t = truth.chords[0].t + 0.05; t < end; t += 0.1) {
    const c = truth.chords.find((x) => x.t <= t && x.t + x.d > t);
    if (!c) continue;
    const ok = new Set(CH[c.name][1].map((x) => (c.root + x) % 12));
    for (const arr of [truth.melody, truth.bass]) for (const n of arr) if (n.t <= t && n.t + n.d > t) ok.add(n.p % 12);
    for (const n of notes) {
      if (n.t <= t && n.t + n.d > t) { all++; if (!ok.has(n.p % 12)) bad++; }
    }
  }
  return all ? bad / all : 0;
}
