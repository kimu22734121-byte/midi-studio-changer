// コード進行の文字列（例： "C G Am F | Dm7 G7 C"）の読み込み。
import { createSong } from '../core/song.js';
import { parseChordName, buildAccompaniment } from '../core/chords.js';

const TEMPO_RE = /^(?:bpm|tempo|テンポ)\s*[:=：]?\s*(\d{2,3})$/i;

/** 文字列の中身がコード進行だけでできていれば true */
export function looksLikeChordText(text) {
  const { tokens } = tokenize(text);
  return tokens.length > 0 && tokens.every((t) => t === '|' || parseChordName(t));
}

function tokenize(text) {
  let bpm = null;
  const cleaned = text
    .replace(/(?:bpm|tempo|テンポ)\s*[:=：]?\s*(\d{2,3})/gi, (_, n) => { bpm = Number(n); return ' '; })
    .replace(/[,、\n\r\t]/g, ' ')
    .replace(/\|/g, ' | ')
    .replace(/→|->|=>/g, ' ');
  const tokens = cleaned.split(/\s+/).filter(Boolean).filter((t) => !TEMPO_RE.test(t));
  return { tokens, bpm };
}

/**
 * "|" があれば小節の区切りとみなし、1小節（4拍）に入るコードを均等に分ける。
 * "|" がなければ、コード1つ = 1小節。
 */
export function parseChordText(text) {
  const { tokens, bpm: tempo } = tokenize(text);
  const bpm = tempo || 100;
  const hasBars = tokens.includes('|');
  const bars = [];
  if (hasBars) {
    let cur = [];
    for (const t of tokens) {
      if (t === '|') { if (cur.length) bars.push(cur); cur = []; } else cur.push(t);
    }
    if (cur.length) bars.push(cur);
  } else {
    for (const t of tokens) bars.push([t]);
  }
  const list = [];
  let beat = 0;
  for (const bar of bars) {
    const each = 4 / bar.length;
    for (const name of bar) {
      const chord = parseChordName(name);
      if (!chord) throw new Error(`「${name}」はコード名として読めませんでした`);
      list.push({ chord, start: beat, beats: each });
      beat += each;
    }
  }
  if (!list.length) throw new Error('コードが見つかりませんでした');
  const tracks = buildAccompaniment(list, bpm, { drums: true, arpeggio: true });
  return createSong({ title: 'コード進行', bpm, source: 'chords', tracks });
}
