// 編成：同時に鳴らせる音の数に合わせて、楽器（パート）を増やす。
// 元のメロディ・伴奏・ベース・ドラムから、重ね・ハモり・アルペジオ・刻み・持続音・打楽器などを作る。
// 音数が少ないときは元の4パートだけ、多いほど楽器が増えて豪華になる（実際の楽団の作り方に近い）。
// 増やしたパートは planVoices で優先度が低くなるので、元のパートの音はいつも残る。
import { createSong } from './song.js';
import { toneFromProgram } from './midi-file.js';

// 追加するパート：min 音以上のときに使う
// make(ctx) は音符の配列を返す。program は GM の楽器番号（セットに合わせて近い楽器が選ばれる）
const LAYERS = [
  // ---- 8音〜 ----
  { min: 8, name: 'フルート（メロディを1オクターブ上で）', role: 'melody', program: 73, layer: 1, make: (c) => shift(c.melody, 12, 0.6, { max: 96 }) },
  { min: 8, name: 'ピアノ（伴奏のリズム）', role: 'chords', program: 0, layer: 1, make: (c) => comp(c, [1, 3], 0.45, 0.62) },
  // ---- 16音〜 ----
  { min: 16, name: 'ホルン（ハモり）', role: 'other', program: 60, layer: 2, make: (c) => harmony(c, 0.55) },
  { min: 16, name: 'ハープ（アルペジオ）', role: 'other', program: 46, layer: 2, make: (c) => arpeggio(c, 0.5, 12, 0.55) },
  { min: 16, name: 'チェロ（ベースを1オクターブ上で）', role: 'bass', program: 42, layer: 2, make: (c) => shift(c.bass, 12, 0.6) },
  { min: 16, name: 'パーカッション（シェイカー・タンバリン）', role: 'drums', drum: true, layer: 2, make: (c) => percussion(c) },
  // ---- 32音〜 ----
  { min: 32, name: 'コーラス「アー」（和音を伸ばす）', role: 'chords', program: 52, layer: 3, make: (c) => pad(c, 0, 0.42) },
  { min: 32, name: 'ブラス（和音を短く）', role: 'chords', program: 61, layer: 3, make: (c) => stabs(c, 0.55) },
  { min: 32, name: 'バイオリン（高い音を伸ばす）', role: 'other', program: 40, layer: 3, make: (c) => topLine(c, 12, 0.45) },
  { min: 32, name: 'ティンパニ（区切りで低く）', role: 'other', program: 47, layer: 3, make: (c) => timpani(c) },
  { min: 32, name: 'グロッケン（小節のはじめにキラッ）', role: 'other', program: 9, layer: 3, make: (c) => bells(c, 0.45) },
  { min: 32, name: 'ギター（裏拍の刻み）', role: 'chords', program: 24, layer: 3, make: (c) => comp(c, [0.5, 1.5, 2.5, 3.5], 0.18, 0.45) },
  // ---- 64音〜 ----
  { min: 64, name: 'オーボエ（メロディを重ねる）', role: 'melody', program: 68, layer: 4, make: (c) => shift(c.melody, 0, 0.42) },
  { min: 64, name: 'クラリネット（ハモりを重ねる）', role: 'other', program: 71, layer: 4, make: (c) => harmony(c, 0.4, -12) },
  { min: 64, name: 'ピチカート（弦をはじく刻み）', role: 'chords', program: 45, layer: 4, make: (c) => comp(c, [0, 1, 2, 3], 0.2, 0.42) },
  { min: 64, name: 'ストリングス（和音を高く伸ばす）', role: 'chords', program: 49, layer: 4, make: (c) => pad(c, 12, 0.35) },
  { min: 64, name: 'ビブラフォン（細かいアルペジオ）', role: 'other', program: 11, layer: 4, make: (c) => arpeggio(c, 0.25, 24, 0.35) },
  { min: 64, name: 'チューバ（ベースを1オクターブ下で）', role: 'bass', program: 58, layer: 4, make: (c) => shift(c.bass, -12, 0.5, { min: 28 }) },
  { min: 64, name: 'トランペット（メロディのはじめを強く）', role: 'melody', program: 56, layer: 4, make: (c) => accents(c, 0.5) },
  { min: 64, name: 'シンセパッド（ふんわり）', role: 'chords', program: 89, layer: 4, make: (c) => pad(c, -12, 0.3) },
  { min: 64, name: 'チューブラーベル（大きな区切り）', role: 'other', program: 14, layer: 4, make: (c) => bells(c, 0.35, 16, 0) },
  // ---- 128音〜 ----
  { min: 128, name: 'チェレスタ（メロディを2オクターブ上で）', role: 'melody', program: 8, layer: 5, make: (c) => shift(c.melody, 24, 0.3, { max: 108 }) },
  { min: 128, name: 'ファゴット（ベースを重ねる）', role: 'bass', program: 70, layer: 5, make: (c) => shift(c.bass, 12, 0.35) },
  { min: 128, name: '声「ウー」（ハモりを伸ばす）', role: 'other', program: 53, layer: 5, make: (c) => harmony(c, 0.3, 0, true) },
  { min: 128, name: 'オルガン（和音を低く）', role: 'chords', program: 19, layer: 5, make: (c) => pad(c, -12, 0.25) },
  { min: 128, name: 'マリンバ（アルペジオを重ねる）', role: 'other', program: 12, layer: 5, make: (c) => arpeggio(c, 0.5, 0, 0.3, 1) },
  { min: 128, name: 'シンセストリングス（高い音を重ねる）', role: 'other', program: 50, layer: 5, make: (c) => topLine(c, 0, 0.3) },
];

/** この音数で使う楽器（パート）の数の目安 */
export function ensembleSize(polyphony, baseTracks = 4) {
  return baseTracks + LAYERS.filter((l) => polyphony >= l.min).length;
}

/**
 * 元の曲から、音数に合わせて楽器を増やした曲を作る。
 * 元のトラックはそのまま先頭に残る（順番も同じ）。
 */
export function expandEnsemble(song, polyphony) {
  const ctx = context(song);
  if (!ctx) return song;
  const extra = [];
  for (const l of LAYERS) {
    if (polyphony < l.min) continue;
    const notes = l.make(ctx).filter((n) => n.d > 0.02 && n.p >= 0 && n.p <= 127);
    if (notes.length < 2) continue;
    extra.push({
      name: l.name, role: l.role, isDrum: !!l.drum, program: l.drum ? 0 : l.program, layer: l.layer,
      tone: l.drum ? 'kit-synth' : toneFromProgram(l.program), notes,
    });
  }
  if (!extra.length) return song;
  return createSong({ title: song.title, bpm: song.bpm, source: song.source, tracks: [...song.tracks, ...extra] });
}

// ---------------- 元の曲から読み取る情報 ----------------
function context(song) {
  const beat = 60 / (song.bpm || 120);
  const pick = (role) => song.tracks.filter((t) => t.role === role && !t.isDrum).flatMap((t) => t.notes);
  let melody = pick('melody');
  const bass = pick('bass');
  const chordNotes = pick('chords');
  if (!melody.length) {
    // メロディがない曲は、一番高い音を鳴らしているトラックをメロディとみなす
    const others = song.tracks.filter((t) => !t.isDrum && t.notes.length);
    if (!others.length) return null;
    const top = others.reduce((a, b) => (avg(b.notes) > avg(a.notes) ? b : a));
    melody = top.notes;
  }
  melody = [...melody].sort((a, b) => a.t - b.t);
  const segs = harmony_segments(song, chordNotes, beat);
  const end = Math.max(...song.tracks.flatMap((t) => t.notes.map((n) => n.t + n.d)));
  return { song, beat, melody, bass: [...bass].sort((a, b) => a.t - b.t), segs, end };
}

const avg = (notes) => notes.reduce((s, n) => s + n.p, 0) / notes.length;

/** 和音の区切り：[{ t, d, pcs:[音名0-11], root }] */
function harmony_segments(song, chordNotes, beat) {
  const segs = [];
  if (chordNotes.length) {
    const sorted = [...chordNotes].sort((a, b) => a.t - b.t);
    let i = 0;
    while (i < sorted.length) {
      const t = sorted[i].t;
      const group = [];
      while (i < sorted.length && sorted[i].t - t < 0.03) group.push(sorted[i++]);
      const d = Math.max(...group.map((n) => n.d));
      const ps = group.map((n) => n.p).sort((a, b) => a - b);
      segs.push({ t, d, pcs: [...new Set(ps.map((p) => p % 12))], root: ps[0] % 12, top: ps[ps.length - 1] });
    }
  } else {
    // 伴奏トラックがない曲：拍ごとに、メロディ以外で鳴っている音を集める
    const pool = song.tracks.filter((t) => !t.isDrum && t.role !== 'melody').flatMap((t) => t.notes);
    if (!pool.length) return segs;
    const end = Math.max(...pool.map((n) => n.t + n.d));
    for (let t = 0; t < end; t += beat * 2) {
      const on = pool.filter((n) => n.t < t + beat * 2 && n.t + n.d > t);
      if (!on.length) continue;
      const ps = on.map((n) => n.p).sort((a, b) => a - b);
      segs.push({ t, d: beat * 2, pcs: [...new Set(ps.map((p) => p % 12))], root: ps[0] % 12, top: ps[ps.length - 1] });
    }
  }
  // 次の和音までの長さにそろえる（重なり・すき間をなくす。間が長すぎるときは元の長さのまま）
  for (let k = 0; k < segs.length - 1; k++) {
    const gap = segs[k + 1].t - segs[k].t;
    segs[k].d = Math.max(0.05, gap <= beat * 8 ? gap : Math.min(segs[k].d, gap));
  }
  return segs;
}

/** 和音の音を、だいたい center のあたりに並べる */
function voice(pcs, center) {
  return pcs.map((pc) => {
    let p = pc + 12 * Math.floor(center / 12);
    while (p < center - 6) p += 12;
    while (p > center + 6) p -= 12;
    return p;
  }).sort((a, b) => a - b);
}

const vel = (v, k) => Math.max(20, Math.min(127, Math.round(v * k)));

// ---------------- パートの作り方 ----------------
/** 高さをずらして重ねる（min〜max の外に出る音は、オクターブを戻す） */
function shift(notes, semis, k, { min = 24, max = 100 } = {}) {
  return notes.map((n) => {
    let p = n.p + semis;
    while (p > max) p -= 12;
    while (p < min) p += 12;
    return { t: n.t, d: n.d, p, v: vel(n.v, k) };
  });
}

/** 和音をリズムで刻む（beats は小節の中の拍の位置、len は1回の長さ（拍）） */
function comp({ segs, beat }, beats, len, k) {
  const out = [];
  const bar = beat * 4;
  for (const s of segs) {
    const ps = voice(s.pcs, 62);
    const barStart = Math.floor(s.t / bar + 1e-6) * bar;
    for (let b0 = barStart; b0 < s.t + s.d; b0 += bar) {
      for (const b of beats) {
        const t = b0 + b * beat;
        if (t < s.t - 1e-6 || t >= s.t + s.d - 1e-6) continue;
        for (const p of ps) out.push({ t, d: Math.min(len * beat, s.t + s.d - t), p, v: vel(90, k) });
      }
    }
  }
  return out;
}

/** 和音を伸ばす */
function pad({ segs }, semis, k) {
  return segs.flatMap((s) => voice(s.pcs, 60 + semis).map((p) => ({ t: s.t, d: s.d, p, v: vel(80, k) })));
}

/** 和音を区切りのはじめに短く鳴らす */
function stabs({ segs, beat }, k) {
  return segs.flatMap((s) => voice(s.pcs, 64).map((p) => ({ t: s.t, d: Math.min(beat * 0.45, s.d), p, v: vel(100, k) })));
}

/** 和音の一番高い音を伸ばす */
function topLine({ segs }, semis, k) {
  return segs.map((s) => {
    const ps = voice(s.pcs, 72);
    return { t: s.t, d: s.d, p: ps[ps.length - 1] + semis, v: vel(80, k) };
  });
}

/** アルペジオ：和音の音を順番に（step は拍） */
function arpeggio({ segs, beat }, step, semis, k, phase = 0) {
  const out = [];
  for (const s of segs) {
    const ps = voice(s.pcs, 60 + semis);
    const seq = [...ps, ps[0] + 12, ...ps.slice(1).reverse()];
    let i = phase;
    for (let t = s.t; t < s.t + s.d - 1e-6; t += step * beat) {
      out.push({ t, d: Math.min(step * beat * 0.95, s.t + s.d - t), p: seq[i++ % seq.length], v: vel(85, k) });
    }
  }
  return out;
}

/** ハモり：メロディの下で、その時の和音の音を鳴らす（長めの音だけ） */
function harmony({ melody, segs, beat }, k, octave = 0, longOnly = false) {
  const out = [];
  let si = 0;
  for (const n of melody) {
    if (n.d < beat * (longOnly ? 0.9 : 0.45)) continue;
    while (si + 1 < segs.length && segs[si + 1].t <= n.t + 1e-6) si++;
    const s = segs[si];
    if (!s) continue;
    // メロディより 3〜9 半音下の和音の音（3度・6度あたり）
    let best = null;
    for (const pc of s.pcs) {
      for (let p = n.p - 9; p <= n.p - 3; p++) if (((p % 12) + 12) % 12 === pc) best = best === null || Math.abs(n.p - p - 4) < Math.abs(n.p - best - 4) ? p : best;
    }
    if (best === null) continue;
    out.push({ t: n.t, d: n.d, p: best + octave, v: vel(n.v, k) });
  }
  return out;
}

/** メロディのフレーズのはじめ（前に休みがある音）だけ強く重ねる */
function accents({ melody, beat }, k) {
  const out = [];
  for (let i = 0; i < melody.length; i++) {
    const n = melody[i], prev = melody[i - 1];
    if (!prev || n.t - (prev.t + prev.d) > beat * 0.9) out.push({ t: n.t, d: Math.min(n.d, beat), p: n.p, v: vel(n.v, k) });
  }
  return out;
}

/** ティンパニ：和音が変わるところで、根音を低く */
function timpani({ segs, beat }) {
  const out = [];
  let last = -1;
  for (const s of segs) {
    if (s.root === last) continue;
    last = s.root;
    let p = 36 + s.root;
    if (p < 41) p += 12;
    out.push({ t: s.t, d: Math.min(beat, s.d), p, v: 75 });
  }
  return out;
}

/** 小節（every 拍）のはじめに、和音の高い音をキラッと */
function bells({ segs, beat }, k, every = 4, semis = 12) {
  const out = [];
  const step = beat * every;
  let next = 0;
  for (const s of segs) {
    if (s.t + 1e-6 < next) continue;
    const ps = voice(s.pcs, 72 + semis);
    out.push({ t: s.t, d: beat * 2, p: ps[ps.length - 1], v: vel(85, k) });
    next = Math.floor(s.t / step + 1e-6) * step + step;
  }
  return out;
}

/** 打楽器を足す：シェイカー（8分）・タンバリン（2・4拍）・シンバル（8小節ごと） */
function percussion({ beat, end }) {
  const out = [];
  for (let t = 0, i = 0; t < end; t += beat / 2, i++) {
    out.push({ t, d: 0.05, p: 70, v: i % 2 ? 45 : 60 }); // マラカス
    if (i % 4 === 2) out.push({ t, d: 0.1, p: 54, v: 60 }); // タンバリン
    if (i % 64 === 0 && i > 0) out.push({ t, d: 1, p: 57, v: 70 }); // シンバル
  }
  return out;
}
