// コード名（C, Am, G7 など）の読み取りと、コードから伴奏を作る処理。

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUALITIES = [
  [['', 'M', 'maj'], [0, 4, 7]],
  [['m', 'min', '-'], [0, 3, 7]],
  [['7', 'dom7'], [0, 4, 7, 10]],
  [['M7', 'maj7', 'Maj7', '△7', '△'], [0, 4, 7, 11]],
  [['m7', 'min7', '-7'], [0, 3, 7, 10]],
  [['mM7', 'm(maj7)', 'mmaj7'], [0, 3, 7, 11]],
  [['dim', 'o'], [0, 3, 6]],
  [['dim7', 'o7'], [0, 3, 6, 9]],
  [['m7b5', 'm7-5', 'ø', 'm7(b5)'], [0, 3, 6, 10]],
  [['aug', '+', '+5'], [0, 4, 8]],
  [['sus4', 'sus'], [0, 5, 7]],
  [['sus2'], [0, 2, 7]],
  [['7sus4'], [0, 5, 7, 10]],
  [['6'], [0, 4, 7, 9]],
  [['m6'], [0, 3, 7, 9]],
  [['9', '7(9)'], [0, 4, 7, 10, 14]],
  [['add9', '(9)', 'add2'], [0, 4, 7, 14]],
  [['m9', 'm7(9)'], [0, 3, 7, 10, 14]],
  [['M9', 'maj9'], [0, 4, 7, 11, 14]],
  [['madd9', 'm(9)'], [0, 3, 7, 14]],
  [['5'], [0, 7]],
];
const QMAP = new Map();
for (const [names, iv] of QUALITIES) for (const n of names) QMAP.set(n, iv);

function notePc(s) {
  const m = /^([A-Ga-g])([#♯b♭]?)$/.exec(s);
  if (!m) return null;
  let pc = PC[m[1].toUpperCase()];
  if (m[2] === '#' || m[2] === '♯') pc++;
  if (m[2] === 'b' || m[2] === '♭') pc--;
  return (pc + 12) % 12;
}

/** "Am7" → { name, root: 9, bass: 9, intervals: [0,3,7,10] } / 読めなければ null */
export function parseChordName(name) {
  const s = String(name).trim().replace(/（/g, '(').replace(/）/g, ')');
  const m = /^([A-G])([#♯b♭]?)(.*?)(?:\/([A-G][#♯b♭]?))?$/.exec(s);
  if (!m) return null;
  const root = notePc(m[1] + m[2]);
  const q = m[3];
  const iv = QMAP.get(q) ?? QMAP.get(q.replace(/[()]/g, ''));
  if (!iv) return null;
  const bass = m[4] ? notePc(m[4]) : root;
  return { name: s, root, bass, intervals: iv };
}

/** コードの音を、聴きやすい高さ（だいたいC3〜C5）に並べる */
export function voiceChord(chord, low = 52) {
  let r = 48 + chord.root;
  while (r < low - 4) r += 12;
  while (r >= low + 8) r -= 12;
  return chord.intervals.map((i) => r + i);
}

export function bassNote(chord) {
  return 36 + chord.bass;
}

/**
 * コードの並び [{ chord, start, beats }]（start/beatsは拍）から伴奏トラックを作る。
 * 打ち込みらしく：和音は伸ばす、ベースは8分、ドラムは基本の8ビート。
 */
export function buildAccompaniment(chords, bpm, { drums = true, arpeggio = false } = {}) {
  const sec = 60 / bpm;
  const pad = [], bass = [], arp = [], kit = [];
  let endBeat = 0;
  for (const c of chords) {
    endBeat = Math.max(endBeat, c.start + c.beats);
    const tones = voiceChord(c.chord);
    for (const p of tones) pad.push({ t: c.start * sec, d: c.beats * sec * 0.98, p, v: 70 });
    for (let b = 0; b < c.beats; b += 0.5) {
      const p = bassNote(c.chord);
      bass.push({ t: (c.start + b) * sec, d: sec * 0.45, p, v: b % 1 === 0 ? 100 : 80 });
    }
    if (arpeggio) {
      const seq = [...tones, tones[0] + 12, ...tones.slice(1).reverse()];
      let k = 0;
      for (let b = 0; b < c.beats; b += 0.5) arp.push({ t: (c.start + b) * sec, d: sec * 0.45, p: seq[k++ % seq.length] + 12, v: 85 });
    }
  }
  if (drums) {
    for (let b = 0; b < endBeat; b += 0.5) {
      const t = b * sec;
      const inBar = b % 4;
      if (inBar === 0 || inBar === 2.5) kit.push({ t, d: 0.1, p: 36, v: 110 });
      if (inBar === 1 || inBar === 3) kit.push({ t, d: 0.1, p: 38, v: 100 });
      kit.push({ t, d: 0.05, p: 42, v: b % 1 === 0 ? 80 : 55 });
    }
  }
  const tracks = [
    { name: '伴奏（和音）', role: 'chords', notes: pad },
    { name: 'ベース', role: 'bass', notes: bass },
  ];
  if (arpeggio) tracks.unshift({ name: 'アルペジオ', role: 'melody', notes: arp, tone: 'pluck' });
  if (drums) tracks.push({ name: 'ドラム', role: 'drums', isDrum: true, notes: kit });
  return tracks;
}
