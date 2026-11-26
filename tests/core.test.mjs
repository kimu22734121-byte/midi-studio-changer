import test from 'node:test';
import assert from 'node:assert/strict';
import { createSong, planVoices, POLY_STEPS, nearestStepIndex, lowerPolyphony } from '../src/core/song.js';
import { writeMidi, parseMidi } from '../src/core/midi-file.js';
import { parseChordName } from '../src/core/chords.js';
import { parseAbc, looksLikeAbc } from '../src/analysis/abc.js';
import { parseChordText, looksLikeChordText } from '../src/analysis/chord-text.js';

test('音数スライダーの刻み', () => {
  assert.deepEqual(POLY_STEPS, [1, 2, 3, 4, 5, 6, 7, 8, 16, 32, 64, 128]);
  assert.equal(POLY_STEPS[nearestStepIndex(64)], 64);
  assert.equal(POLY_STEPS[nearestStepIndex(20)], 16);
  assert.equal(lowerPolyphony(64), 32);
  assert.equal(lowerPolyphony(4), 4);
});

test('音数を絞るとメロディとベースが優先して残る', () => {
  const chord = [60, 64, 67, 71].map((p) => ({ t: 0, d: 1, p, v: 80 }));
  const song = createSong({ tracks: [
    { role: 'chords', notes: chord },
    { role: 'melody', notes: [{ t: 0, d: 1, p: 79, v: 100 }] },
    { role: 'bass', notes: [{ t: 0, d: 1, p: 36, v: 100 }] },
  ] });
  const ev = planVoices(song, 3);
  assert.equal(ev.length, 3);
  const roles = ev.map((e) => song.tracks[e.track].role).sort();
  assert.deepEqual(roles, ['bass', 'chords', 'melody']);
  assert.equal(planVoices(song, 128).length, 6);
  // 後から来た大事な音が、鳴っている伴奏を止める
  const s2 = createSong({ tracks: [
    { role: 'chords', notes: [{ t: 0, d: 2, p: 60, v: 80 }] },
    { role: 'melody', notes: [{ t: 1, d: 1, p: 72, v: 100 }] },
  ] });
  const e2 = planVoices(s2, 1);
  assert.equal(e2.length, 2);
  assert.ok(Math.abs(e2[0].d - 1) < 1e-9);
});

test('MIDIの書き出し→読み込みで同じ音符に戻る', () => {
  const song = createSong({ title: 'テスト', bpm: 100, tracks: [
    { name: 'メロ', role: 'melody', notes: [{ t: 0, d: 0.3, p: 72, v: 100 }, { t: 0.6, d: 0.6, p: 74, v: 90 }] },
    { name: 'ベース', role: 'bass', notes: [{ t: 0, d: 1.2, p: 36, v: 100 }] },
    { name: 'ドラム', role: 'drums', isDrum: true, notes: [{ t: 0, d: 0.1, p: 36, v: 110 }, { t: 0.6, d: 0.1, p: 38, v: 100 }] },
  ] });
  const bytes = writeMidi(song, () => 81);
  const back = parseMidi(bytes.buffer, 'x');
  assert.equal(back.bpm, 100);
  assert.equal(back.tracks.length, 3);
  const mel = back.tracks.find((t) => t.role === 'melody');
  assert.deepEqual(mel.notes.map((n) => n.p), [72, 74]);
  assert.ok(Math.abs(mel.notes[1].t - 0.6) < 0.01);
  assert.ok(back.tracks.find((t) => t.isDrum));
  assert.equal(back.tracks.find((t) => t.role === 'bass').notes[0].p, 36);
});

test('コード名を読める', () => {
  assert.deepEqual(parseChordName('Am7').intervals, [0, 3, 7, 10]);
  assert.equal(parseChordName('F#m').root, 6);
  assert.equal(parseChordName('Bb').root, 10);
  assert.equal(parseChordName('C/G').bass, 7);
  assert.equal(parseChordName('Hello'), null);
});

test('ABC楽譜を読める', () => {
  const abc = `X:1\nT:test\nM:4/4\nL:1/8\nQ:1/4=120\nK:G\n"G"GABc d2 F2|"D7"^c2 =c2 z4|]`;
  assert.ok(looksLikeAbc(abc));
  const s = parseAbc(abc);
  assert.equal(s.title, 'test');
  assert.equal(s.bpm, 120);
  const mel = s.tracks.find((t) => t.role === 'melody').notes;
  // G A B c d F#(調号) ^c =c
  assert.deepEqual(mel.map((n) => n.p), [67, 69, 71, 72, 74, 66, 73, 72]);
  assert.ok(Math.abs(mel[4].t - 1.0) < 1e-6); // 8分×4 = 2拍 = 1秒
  assert.ok(s.tracks.some((t) => t.role === 'bass'));
});

test('コード進行の文字列を読める', () => {
  const txt = 'テンポ 120\nC G | Am F';
  assert.ok(looksLikeChordText(txt));
  assert.ok(!looksLikeChordText('こんにちは'));
  const s = parseChordText(txt);
  assert.equal(s.bpm, 120);
  const bass = s.tracks.find((t) => t.role === 'bass').notes;
  assert.equal(bass[0].p % 12, 0);
  assert.equal(bass.find((n) => n.t >= 1 - 1e-9).p % 12, 7); // 2拍目以降はG
});
