import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribeAudio } from '../src/analysis/audio-transcribe.js';
import { synthJpopSong, jpopScore } from './jpop-helpers.mjs';

// J-POP のボカロ曲風の試験曲（本物の録音の楽器の音で鳴らす）：高い歌・ピアノ・グロッケン・ストリングス・ベース・バンドのドラム
test('J-POP のボカロ曲風：高い歌を2オクターブ下と間違えず、和音・ベース・ハイハットを聴き取れる', () => {
  const x = synthJpopSong({ bars: 12 });
  const song = transcribeAudio(x.L, x.sr, { right: x.R });
  let best = null;
  for (let off = -2; off <= 2; off += 0.0625) {
    const sc = jpopScore(song, x, off);
    const tot = sc.kick.f + sc.snare.f + sc.bassOct.f + sc.melody.f;
    if (!best || tot > best.tot) best = { ...sc, tot };
  }
  assert.ok(Math.abs(song.bpm - x.bpm) < 1, `速さ ${song.bpm}`);
  assert.ok(best.melody.f >= 0.4, `歌 ${JSON.stringify(best.melody)}`);
  assert.ok(best.bassOct.f >= 0.8, `ベース ${JSON.stringify(best.bassOct)}`);
  assert.ok(best.chordBars >= 0.9, `和音 ${best.chordBars}`);
  assert.ok(best.hat.f >= 0.85, `ハイハット ${JSON.stringify(best.hat)}`);
  assert.ok(best.kick.rec >= 0.85, `バスドラ ${JSON.stringify(best.kick)}`);
});
