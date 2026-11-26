import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribeAudio } from '../src/analysis/audio-transcribe.js';
import { synthSong } from './helpers.mjs';

test('合成音声からテンポ・メロディ・ドラムを取り出せる', () => {
  const { x, sr, melody } = synthSong();
  const t0 = Date.now();
  const song = transcribeAudio(x, sr);
  console.log('time', Date.now() - t0, 'ms bpm', song.bpm, song.tracks.map((t) => `${t.name}:${t.notes.length}`).join(' '));
  assert.ok(Math.abs(song.bpm - 120) < 2 || Math.abs(song.bpm - 60) < 1, `bpm ${song.bpm}`);
  const mel = song.tracks.find((t) => t.role === 'melody').notes;
  const pitches = mel.map((n) => n.p);
  console.log('melody', pitches.join(','));
  const want = new Set(melody.map((n) => n.p));
  const ok = pitches.filter((p) => want.has(p)).length / pitches.length;
  assert.ok(ok > 0.8, `melody pitch accuracy ${ok}`);
  assert.ok(mel.length >= melody.length * 0.7 && mel.length <= melody.length * 1.5, `notes ${mel.length}`);
  const drums = song.tracks.find((t) => t.role === 'drums').notes;
  assert.ok(drums.some((n) => n.p === 36), 'kick found');
  const chords = song.tracks.find((t) => t.role === 'bass');
  console.log('bass roots', [...new Set(chords.notes.map((n) => n.p % 12))].join(','));
});
