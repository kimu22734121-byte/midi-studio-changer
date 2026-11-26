// 標準MIDIファイル（.mid）の読み込みと書き出し。
import { createSong } from './song.js';

/** GMの楽器番号 → このアプリの音色ID */
export function toneFromProgram(program) {
  const fam = Math.floor(program / 8);
  return [
    'piano', 'bell', 'organ', 'pluck', 'bass', 'strings', 'strings', 'brass',
    'flute', 'flute', 'lead', 'pad', 'pad', 'bell', 'pluck', 'square',
  ][fam] || 'square';
}

export function parseMidi(arrayBuffer, title = 'MIDI') {
  const data = ArrayBuffer.isView(arrayBuffer) ? new Uint8Array(arrayBuffer.buffer, arrayBuffer.byteOffset, arrayBuffer.byteLength) : new Uint8Array(arrayBuffer);
  let pos = 0;
  const u32 = () => { const v = (data[pos] << 24 | data[pos + 1] << 16 | data[pos + 2] << 8 | data[pos + 3]) >>> 0; pos += 4; return v; };
  const u16 = () => { const v = data[pos] << 8 | data[pos + 1]; pos += 2; return v; };
  const str4 = () => String.fromCharCode(...data.subarray(pos, (pos += 4)));
  const vlq = () => { let v = 0, b; do { b = data[pos++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80 && pos < data.length); return v; };

  if (str4() !== 'MThd') throw new Error('MIDIファイルではないようです');
  const hlen = u32();
  const hstart = pos;
  u16(); // format
  const ntrks = u16();
  const division = u16();
  pos = hstart + hlen;
  if (division & 0x8000) throw new Error('この形式（SMPTE時間）のMIDIにはまだ対応していません');
  const ppq = division;

  const tempos = []; // { tick, us }
  const raw = []; // { tick, track, ch, type, a, b }
  const trackNames = [];

  for (let tr = 0; tr < ntrks && pos < data.length; tr++) {
    const id = str4();
    const len = u32();
    const end = pos + len;
    if (id !== 'MTrk') { pos = end; continue; }
    let tick = 0, status = 0;
    while (pos < end) {
      tick += vlq();
      let b = data[pos];
      if (b & 0x80) { status = b; pos++; } else if (status < 0x80) { pos++; continue; }
      const type = status & 0xf0;
      if (status === 0xff) {
        const mt = data[pos++];
        const l = vlq();
        if (mt === 0x51 && l === 3) tempos.push({ tick, us: data[pos] << 16 | data[pos + 1] << 8 | data[pos + 2] });
        if (mt === 0x03 && !trackNames[tr]) trackNames[tr] = decodeText(data.subarray(pos, pos + l));
        pos += l;
        if (mt === 0x2f) break;
      } else if (status === 0xf0 || status === 0xf7) {
        pos += vlq();
      } else if (type === 0xc0 || type === 0xd0) {
        raw.push({ tick, track: tr, ch: status & 15, type, a: data[pos++], b: 0 });
      } else {
        raw.push({ tick, track: tr, ch: status & 15, type, a: data[pos++], b: data[pos++] });
      }
    }
    pos = end;
  }

  // テンポの変化を考慮して、tick → 秒
  tempos.sort((a, b) => a.tick - b.tick);
  if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, us: tempos.length ? tempos[0].us : 500000 });
  const segs = [];
  let sec = 0;
  for (let i = 0; i < tempos.length; i++) {
    if (i > 0) sec += ((tempos[i].tick - tempos[i - 1].tick) * tempos[i - 1].us) / 1e6 / ppq;
    segs.push({ tick: tempos[i].tick, sec, us: tempos[i].us });
  }
  const toSec = (tick) => {
    let i = segs.length - 1;
    while (i > 0 && segs[i].tick > tick) i--;
    return segs[i].sec + ((tick - segs[i].tick) * segs[i].us) / 1e6 / ppq;
  };

  raw.sort((a, b) => a.tick - b.tick);
  const groups = new Map(); // "track:ch" -> { notes, program, track, ch }
  const open = new Map();
  const programs = new Array(16).fill(0);
  for (const e of raw) {
    if (e.type === 0xc0) { programs[e.ch] = e.a; const g = groups.get(`${e.track}:${e.ch}`); if (g && !g.notes.length) g.program = e.a; continue; }
    if (e.type !== 0x90 && e.type !== 0x80) continue;
    const key = `${e.track}:${e.ch}`;
    if (!groups.has(key)) groups.set(key, { notes: [], program: programs[e.ch], track: e.track, ch: e.ch });
    const nk = `${key}:${e.a}`;
    if (e.type === 0x90 && e.b > 0) {
      if (!open.has(nk)) open.set(nk, []);
      open.get(nk).push({ tick: e.tick, v: e.b });
    } else {
      const st = open.get(nk);
      if (st && st.length) {
        const s = st.shift();
        const t = toSec(s.tick);
        groups.get(key).notes.push({ t, d: Math.max(0.02, toSec(e.tick) - t), p: e.a, v: s.v });
      }
    }
  }

  const tracks = [];
  for (const g of groups.values()) {
    if (!g.notes.length) continue;
    const isDrum = g.ch === 9;
    tracks.push({
      name: trackNames[g.track] || (isDrum ? 'ドラム' : ''),
      isDrum,
      role: isDrum ? 'drums' : 'other',
      tone: isDrum ? 'kit-synth' : toneFromProgram(g.program),
      notes: g.notes,
      avg: g.notes.reduce((s, n) => s + n.p, 0) / g.notes.length,
    });
  }
  guessRoles(tracks);
  const bpm = Math.round(60e6 / segs[0].us);
  return createSong({ title, bpm, source: 'midi', tracks });
}

/** 一番高いところを主に鳴るパートをメロディ、一番低いのをベースと推定 */
function guessRoles(tracks) {
  const pitched = tracks.filter((t) => !t.isDrum);
  if (!pitched.length) return;
  const top = pitched.reduce((a, b) => (b.avg > a.avg ? b : a));
  top.role = 'melody';
  const bottom = pitched.reduce((a, b) => (b.avg < a.avg ? b : a));
  if (bottom !== top && bottom.avg < 55) bottom.role = 'bass';
  for (const t of pitched) if (t.role === 'other' && polyRatio(t.notes) > 0.3) t.role = 'chords';
}

function polyRatio(notes) {
  let poly = 0;
  for (let i = 1; i < notes.length; i++) if (Math.abs(notes[i].t - notes[i - 1].t) < 0.02) poly++;
  return poly / notes.length;
}

function decodeText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {}
  try { return new TextDecoder('shift_jis').decode(bytes); } catch {}
  return String.fromCharCode(...bytes);
}

/** Song → 標準MIDIファイル（format 1）のバイト列 */
export function writeMidi(song, programOf = () => 0) {
  const ppq = 480;
  const bpm = song.bpm || 120;
  const toTick = (s) => Math.round((s * bpm * ppq) / 60);
  const chunks = [];

  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, ...be16(song.tracks.length + 1), ...be16(ppq)];
  chunks.push(new Uint8Array(header));

  const us = Math.round(60e6 / bpm);
  const t0 = [...metaText(0x03, song.title || 'MIDI Studio Changer'), 0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255, 0, 0xff, 0x58, 4, 4, 2, 24, 8];
  chunks.push(trackChunk([...t0, 0, 0xff, 0x2f, 0]));

  let nextCh = 0;
  for (const tr of song.tracks) {
    let ch;
    if (tr.isDrum) ch = 9;
    else { ch = nextCh++ % 15; if (ch >= 9) ch++; }
    const evs = [];
    for (const n of tr.notes) {
      const on = toTick(n.t);
      const off = Math.max(on + 1, toTick(n.t + n.d));
      evs.push({ tick: on, ord: 1, bytes: [0x90 | ch, n.p, n.v] });
      evs.push({ tick: off, ord: 0, bytes: [0x80 | ch, n.p, 0] });
    }
    evs.sort((a, b) => a.tick - b.tick || a.ord - b.ord);
    const out = [...metaText(0x03, tr.name)];
    if (!tr.isDrum) out.push(0, 0xc0 | ch, programOf(tr) & 127);
    let last = 0;
    for (const e of evs) {
      out.push(...vlqBytes(e.tick - last), ...e.bytes);
      last = e.tick;
    }
    out.push(0, 0xff, 0x2f, 0);
    chunks.push(trackChunk(out));
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const bytes = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { bytes.set(c, o); o += c.length; }
  return bytes;
}

function metaText(type, text) {
  const b = Array.from(new TextEncoder().encode(text || ''));
  return [0, 0xff, type, ...vlqBytes(b.length), ...b];
}
function trackChunk(body) {
  return new Uint8Array([0x4d, 0x54, 0x72, 0x6b, ...be32(body.length), ...body]);
}
function be16(v) { return [(v >> 8) & 255, v & 255]; }
function be32(v) { return [(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255]; }
function vlqBytes(v) {
  const out = [v & 0x7f];
  while ((v >>= 7)) out.unshift((v & 0x7f) | 0x80);
  return out;
}
