import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribeAudio } from '../src/analysis/audio-transcribe.js';
import { synthVocalSong, melodyScore } from './vocal-helpers.mjs';

function best(mel, truth) {
  // 解析では拍に合わせて時間がずれるので、いちばん合うずれで比べる
  let b = { f: 0 };
  for (let off = -1; off <= 1; off += 0.005) {
    const sc = melodyScore(mel.map((n) => ({ ...n, t: n.t + off })), truth);
    if (sc.f > b.f) b = sc;
  }
  return b;
}

test('歌声入りの曲（左右あり）でメロディを拾える', () => {
  for (const opt of [{}, { bpm: 128 }]) {
    const { L, R, sr, melody } = synthVocalSong(opt);
    const song = transcribeAudio(L, sr, { right: R });
    const sc = best(song.tracks.find((t) => t.role === 'melody').notes, melody);
    assert.ok(sc.recall >= 0.9, `拾えた率 ${sc.recall}`);
    assert.ok(sc.precision >= 0.75, `正しかった率 ${sc.precision}`);
  }
});

test('歌が小さめでも、左右があれば多くを拾える', () => {
  const { L, R, sr, melody } = synthVocalSong({ vocalLevel: 0.2 });
  const sc = best(transcribeAudio(L, sr, { right: R }).tracks.find((t) => t.role === 'melody').notes, melody);
  assert.ok(sc.recall >= 0.8, `拾えた率 ${sc.recall}`);
});
