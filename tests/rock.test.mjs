import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribeAudio } from '../src/analysis/audio-transcribe.js';
import { synthRockSong, rockScore } from './rock-helpers.mjs';

function analyze(opt) {
  const { L, R, sr, truth } = synthRockSong(opt);
  const song = transcribeAudio(L, sr, { right: R });
  let best = null;
  for (let off = -0.6; off <= 0.6; off += 0.005) {
    const sc = rockScore(song, truth, off);
    const tot = sc.kick.f * 2 + sc.bassOct.f;
    if (!best || tot > best.tot) best = { ...sc, tot };
  }
  return { ...best, bpm: song.bpm };
}

test('ロック：同じ音を8分で刻むベースを1音ずつ拾える', () => {
  for (const opt of [{}, { bpm: 100, master: false }]) {
    const r = analyze(opt);
    assert.ok(r.bassExact.rec >= 0.9 && r.bassExact.pre >= 0.9, `ベース ${JSON.stringify(r.bassExact)}`);
  }
});

test('ロック：テンポ150を半分（75）と取り違えない', () => {
  const r = analyze({ bpm: 150 });
  assert.ok(Math.abs(r.bpm - 150) < 3, `速さ ${r.bpm}`);
  assert.ok(r.bassExact.rec >= 0.8, `ベース ${JSON.stringify(r.bassExact)}`);
});

test('ロック：ギター・キーボードが実際に弾いている音を拾う', () => {
  const r = analyze({});
  assert.ok(r.bandExact.rec >= 0.45 && r.bandExact.pre >= 0.5, `伴奏 ${JSON.stringify(r.bandExact)}`);
  assert.ok(r.keys.rec >= 0.25, `キーボード ${JSON.stringify(r.keys)}`);
});
