import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribeAudio } from '../src/analysis/audio-transcribe.js';
import { trackBeats, makeGrid } from '../src/analysis/beat-grid.js';
import { synthBandSong } from './band-helpers.mjs';

// 人が演奏したように、速さを ±amt だけゆっくり揺らす（音を引き伸ばしたり縮めたりする）
function sway(L, R, sr, amt, period) {
  const w = (2 * Math.PI) / period;
  const src = (u) => u + (amt / w) * (1 - Math.cos(w * u));
  const n = Math.floor(L.length * 0.97);
  const L2 = new Float32Array(n), R2 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = src(i / sr) * sr, j = Math.floor(x), f = x - j;
    if (j + 1 >= L.length) break;
    L2[i] = L[j] * (1 - f) + L[j + 1] * f;
    R2[i] = R[j] * (1 - f) + R[j + 1] * f;
  }
  return { L: L2, R: R2 };
}

// 結果のドラムを「何拍目か」に直して、正解（揺らす前の一定の速さ）と比べる
function drumScore(song, truth, bpm, kind, pitches) {
  const sb = 60 / song.bpm, ob = 60 / bpm;
  const det = song.tracks.find((t) => t.isDrum).notes.filter((n) => pitches.includes(n.p)).map((n) => n.t / sb);
  const tru = truth.drums.filter((d) => d.kind === kind).map((d) => d.t / ob);
  let best = { rec: 0, pre: 0 };
  for (let off = -2; off <= 2; off += 0.0125) {
    const used = new Set();
    let hit = 0;
    for (const b of det) {
      const i = tru.findIndex((t, k) => !used.has(k) && Math.abs(t - b - off) < 0.1);
      if (i >= 0) { used.add(i); hit++; }
    }
    if (hit / tru.length > best.rec) best = { rec: hit / tru.length, pre: hit / det.length };
  }
  return best;
}

test('速さが少し揺れる曲でも、拍を追いかけてドラムを正しい位置に置ける', () => {
  const { L, R, sr, truth, bpm } = synthBandSong({ bars: 32 });
  const w = sway(L, R, sr, 0.02, 20);
  const song = transcribeAudio(w.L, sr, { right: w.R });
  const kick = drumScore(song, truth, bpm, 'kick', [35, 36]);
  const snare = drumScore(song, truth, bpm, 'snare', [38, 40]);
  assert.ok(kick.rec >= 0.9 && kick.pre >= 0.9, `バスドラ ${JSON.stringify(kick)}`);
  assert.ok(snare.rec >= 0.9 && snare.pre >= 0.85, `スネア ${JSON.stringify(snare)}`);
});

test('拍の目盛り：秒と拍の行き来', () => {
  const g = makeGrid([1, 1.5, 2, 2.6, 3.2]);
  assert.equal(g.pos(1.75), 1.5);
  assert.ok(Math.abs(g.at(2.5) - 2.3) < 1e-9);
  assert.equal(g.q(2.3), 10);
});

test('一定の速さの曲は、一定の速さの目盛りになる', () => {
  // 0.5秒ごとに強い立ち上がり（120拍/分）
  const hopT = 0.01, N = 3000;
  const env = new Float32Array(N);
  for (let i = 30; i < N; i += 50) env[i] = 1;
  const r = trackBeats(env, hopT, 119, 0.3);
  assert.ok(r.steady);
  assert.ok(Math.abs(r.bpm - 120) < 0.3, `速さ ${r.bpm}`);
});
