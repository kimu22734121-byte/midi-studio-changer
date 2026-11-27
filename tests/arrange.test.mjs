import test from 'node:test';
import assert from 'node:assert/strict';
import { expandEnsemble, ensembleSize } from '../src/core/arrange.js';
import { planVoices } from '../src/core/song.js';
import { parseChordText } from '../src/analysis/chord-text.js';
import { parseAbc } from '../src/analysis/abc.js';
import { writeMidi, parseMidi } from '../src/core/midi-file.js';

const ABC = `X:1\nT:t\nM:4/4\nL:1/4\nQ:1/4=100\nK:C\n"C"C C G G|"F"A A "C"G2|"F"F F "C"E E|"G"D D "C"C2|`;

test('たくさん：音の数が多いほど楽器（パート）が増える', () => {
  const song = parseAbc(ABC);
  const counts = [4, 8, 16, 32, 64, 128].map((n) => expandEnsemble(song, n, 'full').tracks.length);
  assert.equal(counts[0], song.tracks.length); // 4音では増やさない
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i] > counts[i - 1], `${counts}`);
  assert.ok(counts[4] >= 40, `64音で ${counts[4]} パート`); // たくさん：64音なら40パート以上
  assert.ok(counts[4] <= ensembleSize(64, song.tracks.length, 'full')); // 目安（短い曲では音の少ないパートを省く）
});

test('増やしても元のパートの音は全部残る・音符は正しい範囲', () => {
  const song = parseAbc(ABC);
  for (const [poly, mode] of [8, 16, 32, 64, 128].flatMap((n) => [[n, 'clean'], [n, 'full']])) {
    const s = expandEnsemble(song, poly, mode);
    // 元のトラックは先頭にそのまま
    song.tracks.forEach((t, i) => assert.equal(s.tracks[i].notes.length, t.notes.length));
    const ev = planVoices(s, poly);
    const baseTotal = s.tracks.filter((t) => !t.layer).reduce((a, t) => a + t.notes.length, 0);
    const baseKept = new Set(ev.filter((e) => !s.tracks[e.track].layer).map((e) => e.note)).size;
    assert.equal(baseKept, baseTotal, `poly ${poly}`);
    for (const t of s.tracks) for (const n of t.notes) assert.ok(n.p >= 0 && n.p <= 127 && n.d > 0 && n.v >= 1 && n.v <= 127);
  }
});

test('コード進行だけの曲でも楽器が増える', () => {
  const s = expandEnsemble(parseChordText('C G | Am F'), 64, 'full');
  assert.ok(s.tracks.length >= 20);
});

test('パートが多くても MIDI に保存できる（同じ楽器は同じチャンネルへ）', () => {
  const s = expandEnsemble(parseAbc(ABC), 128, 'full');
  const bytes = writeMidi(s, (t) => t.program ?? 0);
  const back = parseMidi(bytes, 'x');
  const total = (x) => x.tracks.reduce((a, t) => a + t.notes.length, 0);
  assert.equal(total(back), total(s));
});

test('すっきり（おすすめ）：パートは控えめで、細かく動くパートやハモりは入れない', () => {
  const song = parseAbc(ABC);
  const s = expandEnsemble(song, 64, 'clean');
  assert.ok(s.tracks.length >= 10 && s.tracks.length <= 14, `64音で ${s.tracks.length} パート`);
  assert.ok(!s.tracks.some((t) => /アルペジオ|ハモり|刻み/.test(t.name)), s.tracks.map((t) => t.name).join(','));
  assert.equal(expandEnsemble(song, 4, 'clean').tracks.length, song.tracks.length);
});
