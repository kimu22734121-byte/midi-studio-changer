// ABC記譜法（テキストの楽譜）の読み込み。よく使う書き方に対応した簡易版。
import { createSong } from '../core/song.js';
import { parseChordName, buildAccompaniment } from '../core/chords.js';

const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const MAJOR_FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
const MODE_SHIFT = { '': 0, maj: 0, ion: 0, m: -3, min: -3, aeo: -3, mix: -1, dor: -2, phr: -4, loc: -5, lyd: 1 };

export function looksLikeAbc(text) {
  return /^\s*K:/m.test(text) || (/^\s*X:/m.test(text) && /^\s*[TLMQ]:/m.test(text));
}

function keyAccidentals(k) {
  const m = /^\s*([A-G])([#b]?)\s*([A-Za-z]*)/.exec(k || 'C');
  const acc = {};
  if (!m) return acc;
  const mode = (m[3] || '').toLowerCase().slice(0, 3);
  const shift = MODE_SHIFT[mode] ?? 0;
  // 主音の長調としての♯♭数 + モードの補正
  let fifths = MAJOR_FIFTHS[m[1] + m[2]];
  if (fifths === undefined) fifths = 0;
  fifths += shift;
  if (fifths > 0) for (let i = 0; i < Math.min(7, fifths); i++) acc[SHARP_ORDER[i]] = 1;
  if (fifths < 0) for (let i = 0; i < Math.min(7, -fifths); i++) acc[SHARP_ORDER[6 - i]] = -1;
  return acc;
}

function parseFraction(s, def) {
  const m = /(\d+)\s*\/\s*(\d+)/.exec(s || '');
  return m ? Number(m[1]) / Number(m[2]) : def;
}

export function parseAbc(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  let title = '', meter = '4/4', unit = null, bpm = 120, key = 'C';
  const body = [];
  for (const raw of lines) {
    const line = raw.replace(/%.*$/, '');
    const f = /^\s*([A-Za-z]):\s*(.*)$/.exec(line);
    if (f) {
      const [, k, v] = f;
      if (k === 'T' && !title) title = v.trim();
      else if (k === 'M') { meter = v.trim(); if (body.length) body.push(`[M:${v}]`); }
      else if (k === 'L') { unit = parseFraction(v, 1 / 8); if (body.length) body.push(`[L:${v}]`); }
      else if (k === 'Q') { bpm = parseTempo(v); }
      else if (k === 'K') { if (body.length) body.push(`[K:${v}]`); else key = v.trim(); }
      continue; // w: 歌詞などは無視
    }
    if (line.trim()) body.push(line);
  }
  if (unit === null) {
    const mv = meter === 'C' || meter === 'C|' ? 1 : parseFraction(meter, 1);
    unit = mv < 0.75 ? 1 / 16 : 1 / 8;
  }

  const src = body.join(' ');
  let keyAcc = keyAccidentals(key);
  let barAcc = {};
  let t = 0; // 拍（4分音符=1）
  const notes = [];
  const chords = [];
  let tieFrom = null;
  let brokenNext = 1;
  let tuplet = 0, tupletFactor = 1;
  let last = null; // 直前の音（broken rhythm用）

  const lenRe = /^(\d*)(\/*)(\d*)/;
  const readLen = (i) => {
    const m = lenRe.exec(src.slice(i));
    let num = m[1] ? Number(m[1]) : 1;
    let den = 1;
    if (m[2]) den = m[3] ? Number(m[3]) * 2 ** (m[2].length - 1) : 2 ** m[2].length;
    return { mul: num / den, len: m[0].length };
  };
  const readNote = (i) => {
    const m = /^(\^\^|\^|__|_|=)?([A-Ga-g])([,']*)/.exec(src.slice(i));
    if (!m) return null;
    const [all, acc, letter, oct] = m;
    const up = letter.toUpperCase();
    let p = 60 + STEP_PC[up] + (letter === up ? 0 : 12);
    for (const c of oct) p += c === ',' ? -12 : 12;
    const bk = `${up}${p}`;
    if (acc) {
      const a = { '^': 1, '^^': 2, _: -1, __: -2, '=': 0 }[acc];
      barAcc[bk] = a;
      p += a;
    } else if (bk in barAcc) p += barAcc[bk];
    else p += keyAcc[up] || 0;
    return { p, len: all.length };
  };
  const durOf = (mul) => {
    let d = mul * unit * 4;
    if (tuplet > 0) { d *= tupletFactor; tuplet--; }
    d *= brokenNext;
    brokenNext = 1;
    return d;
  };
  const addNotes = (pitches, d) => {
    if (tieFrom && pitches.length === 1 && tieFrom.p === pitches[0]) {
      tieFrom.d += d;
      last = { notes: [tieFrom], d };
    } else {
      const made = pitches.map((p) => ({ t, d, p, v: 100 }));
      notes.push(...made);
      last = { notes: made, d };
    }
    tieFrom = null;
    t += d;
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"') {
      const j = src.indexOf('"', i + 1);
      const s = src.slice(i + 1, j < 0 ? src.length : j);
      const ch = /^[\^_<>@]/.test(s) ? null : parseChordName(s);
      if (ch) chords.push({ chord: ch, start: t });
      i = j < 0 ? src.length : j + 1;
    } else if (c === '!' || c === '+') {
      const j = src.indexOf(c, i + 1);
      i = j < 0 ? i + 1 : j + 1;
    } else if (c === '{') {
      const j = src.indexOf('}', i + 1);
      i = j < 0 ? src.length : j + 1;
    } else if (c === '[' && /^\[[A-Za-z]:/.test(src.slice(i))) {
      const j = src.indexOf(']', i);
      const inner = src.slice(i + 1, j);
      const v = inner.slice(2);
      if (inner[0] === 'K') { keyAcc = keyAccidentals(v); barAcc = {}; }
      if (inner[0] === 'L') unit = parseFraction(v, unit);
      if (inner[0] === 'Q') bpm = parseTempo(v);
      i = j < 0 ? src.length : j + 1;
    } else if (c === '[' && /^\[[\^_=]*[A-Ga-g]/.test(src.slice(i))) {
      let j = i + 1;
      const ps = [];
      let innerMul = 1;
      while (j < src.length && src[j] !== ']') {
        const n = readNote(j);
        if (!n) { j++; continue; }
        ps.push(n.p);
        j += n.len;
        const l = readLen(j);
        innerMul = l.mul;
        j += l.len;
      }
      j++;
      const l = readLen(j);
      addNotes(ps, durOf(l.mul * (l.len ? 1 : innerMul)));
      i = j + l.len;
    } else if (c === '|' || c === ':' || c === ']' || (c === '[' && /^\[\d/.test(src.slice(i)))) {
      barAcc = {};
      i += c === '[' ? 2 : 1;
    } else if (c === 'z' || c === 'x' || c === 'Z') {
      const l = readLen(i + 1);
      const d = c === 'Z' ? l.mul * 4 * parseFraction(meter, 1) : durOf(l.mul);
      t += d;
      last = null;
      tieFrom = null;
      i += 1 + l.len;
    } else if (c === '-') {
      if (last && last.notes.length === 1) tieFrom = last.notes[0];
      i++;
    } else if (c === '>' || c === '<') {
      let n = 1;
      while (src[i + n] === c) n++;
      const f = 1 - 0.5 ** n;
      if (last) {
        const delta = last.d * (c === '>' ? f : -f);
        for (const nn of last.notes) nn.d += delta;
        t += delta;
        brokenNext = c === '>' ? 1 - f : 1 + f;
      }
      i += n;
    } else if (c === '(' && /^\(\d/.test(src.slice(i))) {
      const k = Number(src[i + 1]);
      tuplet = k;
      tupletFactor = k === 3 ? 2 / 3 : k === 2 ? 3 / 2 : k === 4 ? 3 / 4 : 2 / k;
      i += 2;
    } else {
      const n = readNote(i);
      if (n) {
        i += n.len;
        const l = readLen(i);
        i += l.len;
        addNotes([n.p], durOf(l.mul));
      } else i++;
    }
  }

  const sec = 60 / bpm;
  const melody = notes.map((n) => ({ ...n, t: n.t * sec, d: n.d * sec * 0.95 }));
  const tracks = [{ name: 'メロディ', role: 'melody', notes: melody }];
  if (chords.length) {
    for (let k = 0; k < chords.length; k++) chords[k].beats = (k + 1 < chords.length ? chords[k + 1].start : t) - chords[k].start;
    tracks.push(...buildAccompaniment(chords.filter((c) => c.beats > 0), bpm, { drums: true }));
  }
  if (!melody.length && !chords.length) throw new Error('音符が見つかりませんでした。書き方を確認してください。');
  return createSong({ title: title || 'ABC楽譜', bpm, source: 'abc', tracks });
}

function parseTempo(v) {
  const m = /(?:(\d+)\s*\/\s*(\d+)\s*=)?\s*(\d+)/.exec(v);
  if (!m) return 120;
  const bpm = Number(m[3]);
  if (m[1]) return (bpm * (Number(m[1]) / Number(m[2]))) / 0.25;
  return bpm;
}
