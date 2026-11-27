import test from 'node:test';
import assert from 'node:assert/strict';
import { thinCymbals } from '../src/analysis/audio-transcribe.js';
import { expandEnsemble } from '../src/core/arrange.js';

test('速い曲で16分にびっしり並んだハイハットは、8分に間引く', () => {
  const notes = [];
  for (let k = 0; k < 64; k++) notes.push({ k, p: 42, w: 1 });
  thinCymbals(notes, 60 / 160);
  assert.equal(notes.length, 32);
  assert.ok(notes.every((n) => n.k % 2 === 0));
});

test('ふつうの速さで、強さのそろった16分のハイハットはそのまま', () => {
  const notes = [];
  for (let k = 0; k < 64; k++) notes.push({ k, p: 42, w: 1 });
  thinCymbals(notes, 60 / 100);
  assert.equal(notes.length, 64);
});

test('シンバルは鳴りっぱなしにしない（1小節に1回まで、続くときは2小節に1回まで）', () => {
  const notes = [];
  for (let k = 0; k < 16 * 8; k += 4) notes.push({ k, p: 49, w: 1 + (k % 16 === 0 ? 1 : 0) });
  thinCymbals(notes, 0.5);
  assert.ok(notes.length <= 4, `シンバル ${notes.length}`);
});

test('自動で足す打楽器は、元のドラムが鳴っている小節だけで鳴らす', () => {
  const beat = 0.5;
  const drums = [];
  for (let t = 8; t < 16; t += beat) drums.push({ t, d: 0.1, p: t % 1 ? 38 : 36, v: 100 }); // 8〜16秒だけドラム
  const mel = Array.from({ length: 48 }, (_, i) => ({ t: i * 0.5, d: 0.45, p: 72, v: 90 }));
  const chords = Array.from({ length: 12 }, (_, i) => [60, 64, 67].map((p) => ({ t: i * 2, d: 2, p, v: 70 }))).flat();
  const song = {
    title: 't', bpm: 120, source: 'audio',
    tracks: [
      { name: 'm', role: 'melody', isDrum: false, program: null, layer: 0, notes: mel },
      { name: 'c', role: 'chords', isDrum: false, program: null, layer: 0, notes: chords },
      { name: 'd', role: 'drums', isDrum: true, program: null, layer: 0, notes: drums },
    ],
  };
  const out = expandEnsemble(song, 64, 'full');
  const perc = out.tracks.filter((t) => t.layer && t.isDrum).flatMap((t) => t.notes);
  assert.ok(perc.length > 0);
  assert.ok(perc.every((n) => n.t >= 8 - 1e-6 && n.t < 16), `範囲外 ${perc.filter((n) => n.t < 8 || n.t >= 16).map((n) => n.t)}`);
});
