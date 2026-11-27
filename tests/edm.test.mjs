import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribeAudio } from '../src/analysis/audio-transcribe.js';
import { synthEdmSong, edmScore } from './edm-helpers.mjs';

// 電子音の曲（ユーロビート・ボカロ風）を作って、聴き取れるか確かめる
function analyze(opt) {
  const { L, R, sr, bpm, truth } = synthEdmSong(opt);
  const song = transcribeAudio(L, sr, { right: R });
  let best = null;
  for (let off = -0.6; off <= 0.6; off += 0.005) {
    const sc = edmScore(song, truth, off);
    const tot = sc.kick.f * 2 + sc.bassOct.f;
    if (!best || tot > best.tot) best = { ...sc, tot };
  }
  return { ...best, bpm, got: song.bpm };
}

test('ユーロビート：速さ・バスドラ・クラップ・歌・ベースを聴き取れる', () => {
  for (const opt of [{}, { bpm: 165 }]) {
    const r = analyze(opt);
    assert.ok(Math.abs(r.got - r.bpm) < 1, `速さ ${r.got}（正解 ${r.bpm}）`);
    assert.ok(r.kick.rec >= 0.95 && r.kick.pre >= 0.9, `バスドラ ${JSON.stringify(r.kick)}`);
    assert.ok(r.clap.rec >= 0.9, `クラップ ${JSON.stringify(r.clap)}`);
    assert.ok(r.melody.f >= 0.7, `歌 ${JSON.stringify(r.melody)}`);
    assert.ok(r.bassOct.f >= 0.5, `ベース ${JSON.stringify(r.bassOct)}`);
    assert.ok(r.chordBars >= 0.8, `和音 ${r.chordBars}`);
  }
});

test('ボカロ風の電子音の曲：速さ・バスドラ・歌を聴き取れる', () => {
  for (const opt of [{ style: 'vocalo' }, { style: 'vocalo', bpm: 150 }]) {
    const r = analyze(opt);
    assert.ok(Math.abs(r.got - r.bpm) < 1, `速さ ${r.got}（正解 ${r.bpm}）`);
    assert.ok(r.kick.rec >= 0.9, `バスドラ ${JSON.stringify(r.kick)}`);
    assert.ok(r.melody.f >= 0.4, `歌 ${JSON.stringify(r.melody)}`);
  }
});
