// MusicXML（.musicxml / .xml / .mxl）の読み込み。
// ※ XMLを読むためにブラウザの DOMParser を使う（サーバー化するときは xmldom 等に置き換える）
import { createSong, defaultTone } from '../core/song.js';
import { toneFromProgram } from '../core/midi-file.js';
import { unzip } from './zip.js';

const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export async function readMusicXmlFile(arrayBuffer, name = '') {
  const u8 = new Uint8Array(arrayBuffer);
  let text;
  if (u8[0] === 0x50 && u8[1] === 0x4b) {
    const zip = await unzip(arrayBuffer);
    let root = null;
    const container = await zip.read('META-INF/container.xml');
    if (container) {
      const m = /full-path="([^"]+)"/.exec(new TextDecoder().decode(container));
      if (m) root = m[1];
    }
    root = root || zip.names.find((n) => !n.startsWith('META-INF') && /\.(xml|musicxml)$/i.test(n));
    if (!root) throw new Error('MXLの中に楽譜が見つかりませんでした');
    text = new TextDecoder().decode(await zip.read(root));
  } else {
    text = new TextDecoder().decode(u8);
  }
  return parseMusicXml(text, name.replace(/\.[^.]+$/, ''));
}

const kids = (el, tag) => Array.from(el.children).filter((c) => c.tagName === tag);
const kid = (el, tag) => Array.from(el.children).find((c) => c.tagName === tag) || null;
const num = (el, tag, def = 0) => { const k = el && kid(el, tag); return k ? Number(k.textContent) : def; };

export function parseMusicXml(text, fallbackTitle = 'MusicXML') {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('MusicXMLとして読めませんでした');
  const score = doc.documentElement;
  if (score.tagName === 'score-timewise') throw new Error('この形式（timewise）のMusicXMLにはまだ対応していません');
  if (score.tagName !== 'score-partwise') throw new Error('MusicXMLの楽譜ではないようです');

  const title = doc.querySelector('work > work-title')?.textContent?.trim()
    || doc.querySelector('movement-title')?.textContent?.trim() || fallbackTitle;

  const partInfo = {};
  for (const sp of doc.querySelectorAll('part-list > score-part')) {
    const id = sp.getAttribute('id');
    const mi = sp.querySelector('midi-instrument');
    partInfo[id] = {
      name: sp.querySelector('part-name')?.textContent?.trim() || '',
      channel: mi ? num(mi, 'midi-channel', 1) : 1,
      program: mi ? num(mi, 'midi-program', 1) - 1 : 0,
      unpitched: {},
    };
    for (const m of sp.querySelectorAll('midi-instrument')) {
      const u = kid(m, 'midi-unpitched');
      if (u) partInfo[id].unpitched[m.getAttribute('id')] = Number(u.textContent) - 1;
    }
  }

  // 拍（4分音符=1）単位で集め、最後に秒にする
  let bpm = null;
  const tracks = [];
  for (const part of kids(score, 'part')) {
    const info = partInfo[part.getAttribute('id')] || { name: '', channel: 1, program: 0, unpitched: {} };
    let divisions = 1;
    let cursor = 0;
    let lastStart = 0;
    const notes = [];
    const ties = new Map();
    let drum = info.channel === 10;
    for (const measure of kids(part, 'measure')) {
      for (const el of Array.from(measure.children)) {
        const tag = el.tagName;
        if (tag === 'attributes') {
          const d = kid(el, 'divisions');
          if (d) divisions = Number(d.textContent) || 1;
        } else if (tag === 'backup') cursor -= num(el, 'duration') / divisions;
        else if (tag === 'forward') cursor += num(el, 'duration') / divisions;
        else if (tag === 'sound' || tag === 'direction') {
          const s = tag === 'sound' ? el : el.querySelector('sound');
          if (s && s.getAttribute('tempo') && bpm === null) bpm = Number(s.getAttribute('tempo'));
        } else if (tag === 'note') {
          if (kid(el, 'grace')) continue;
          const dur = num(el, 'duration') / divisions;
          const isChord = !!kid(el, 'chord');
          const start = isChord ? lastStart : cursor;
          if (!isChord) { lastStart = cursor; cursor += dur; }
          if (kid(el, 'rest')) continue;
          let p = null;
          const pitch = kid(el, 'pitch');
          const unp = kid(el, 'unpitched');
          if (pitch) {
            p = (num(pitch, 'octave', 4) + 1) * 12 + STEP[kid(pitch, 'step')?.textContent?.trim()] + Math.round(num(pitch, 'alter', 0));
          } else if (unp) {
            drum = true;
            const inst = kid(el, 'instrument')?.getAttribute('id');
            p = info.unpitched[inst] ?? 38;
          }
          if (p === null || Number.isNaN(p)) continue;
          const tieTypes = kids(el, 'tie').map((x) => x.getAttribute('type'));
          const vel = Number(el.getAttribute('dynamics')) ? Math.min(127, Number(el.getAttribute('dynamics')) * 0.9) : 95;
          if (tieTypes.includes('stop') && ties.has(p)) {
            const prev = ties.get(p);
            prev.d = start + dur - prev.t;
            if (!tieTypes.includes('start')) ties.delete(p);
            continue;
          }
          const n = { t: start, d: dur, p, v: vel };
          notes.push(n);
          if (tieTypes.includes('start')) ties.set(p, n);
        }
      }
    }
    if (!notes.length) continue;
    tracks.push({
      name: info.name,
      isDrum: drum,
      role: drum ? 'drums' : 'other',
      tone: drum ? defaultTone('drums', true) : toneFromProgram(info.program),
      notes,
      avg: notes.reduce((s, n) => s + n.p, 0) / notes.length,
    });
  }
  if (!tracks.length) throw new Error('音符が見つかりませんでした');
  bpm = bpm || 100;
  const pitched = tracks.filter((t) => !t.isDrum);
  if (pitched.length) {
    pitched[0].role = 'melody';
    if (pitched.length > 1) {
      const low = pitched.slice(1).reduce((a, b) => (b.avg < a.avg ? b : a));
      if (low.avg < 55) low.role = 'bass';
      for (const t of pitched.slice(1)) if (t.role === 'other') t.role = 'chords';
    }
  }
  const sec = 60 / bpm;
  for (const t of tracks) t.notes = t.notes.map((n) => ({ ...n, t: n.t * sec, d: n.d * sec * 0.95 }));
  return createSong({ title, bpm, source: 'musicxml', tracks });
}
