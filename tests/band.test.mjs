import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribeAudio } from '../src/analysis/audio-transcribe.js';
import { synthBandSong, bandScore } from './band-helpers.mjs';

function analyze(opt, stereo = true) {
  const { L, R, sr, truth } = synthBandSong(opt);
  let song;
  if (stereo) song = transcribeAudio(L, sr, { right: R });
  else {
    const m = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) m[i] = (L[i] + R[i]) / 2;
    song = transcribeAudio(m, sr);
  }
  // 解析では拍に合わせて時間がずれるので、いちばん合うずれで比べる
  let best = null;
  for (let off = -0.6; off <= 0.6; off += 0.005) {
    const sc = bandScore(song, truth, off);
    const tot = sc.bass.f + sc.drums.kick.f;
    if (!best || tot > best.tot) best = { ...sc, tot };
  }
  return best;
}

test('バンドの曲：ベース・和音・伴奏のリズム・ドラムを聴き取れる', () => {
  for (const opt of [{}, { bpm: 130 }]) {
    const r = analyze(opt);
    assert.ok(r.bass.rec >= 0.9 && r.bass.pre >= 0.85, `ベース ${JSON.stringify(r.bass)}`);
    assert.ok(r.chordRoot >= 0.75, `和音の根っこ ${r.chordRoot}`);
    assert.ok(r.rhythm.rec >= 0.9, `伴奏のリズム ${JSON.stringify(r.rhythm)}`);
    assert.ok(r.drums.kick.rec >= 0.9 && r.drums.kick.pre >= 0.7, `バスドラ ${JSON.stringify(r.drums.kick)}`);
    assert.ok(r.drums.snare.rec >= 0.9 && r.drums.snare.pre >= 0.7, `スネア ${JSON.stringify(r.drums.snare)}`);
    assert.ok(r.drums.hat.rec >= 0.85, `ハイハット ${JSON.stringify(r.drums.hat)}`);
    assert.ok(r.drums.crash.rec >= 0.5, `シンバル ${JSON.stringify(r.drums.crash)}`);
  }
});

test('左右が混ざった音でも、ベースとドラムは聴き取れる', () => {
  const r = analyze({}, false);
  assert.ok(r.bass.rec >= 0.85, `ベース ${JSON.stringify(r.bass)}`);
  assert.ok(r.drums.snare.rec >= 0.9, `スネア ${JSON.stringify(r.drums.snare)}`);
});

test('高い音が鳴り続ける曲でも、シンバルを出しすぎない', () => {
  for (const opt of [{ dense: true }, { dense: true, bpm: 130 }, { dense: true, gain: 0.08, tap: true }]) {
    const { L, R, sr, truth } = synthBandSong(opt);
    const song = transcribeAudio(L, sr, { right: R });
    const crashes = song.tracks.find((t) => t.role === 'drums').notes.filter((n) => n.p === 49).length;
    const real = truth.drums.filter((d) => d.kind === 'crash').length;
    assert.ok(crashes <= real * 2, `シンバル ${crashes} 回（本当は ${real} 回）`);
    const r = analyze(opt);
    assert.ok(r.drums.hat.rec >= 0.85, `ハイハット ${JSON.stringify(r.drums.hat)}`);
  }
});

test('音が小さく、一瞬だけ大きな音がある動画でも聴き取れる', () => {
  const r = analyze({ gain: 0.05, tap: true });
  assert.ok(r.bass.rec >= 0.9, `ベース ${JSON.stringify(r.bass)}`);
  assert.ok(r.drums.snare.rec >= 0.9, `スネア ${JSON.stringify(r.drums.snare)}`);
});

test('暗い調の曲・セブンス入りでも和音を聴き取れる（左右あり）', () => {
  for (const opt of [{}, { prog: 'minor' }]) {
    const r = analyze(opt);
    assert.ok(r.chordRoot >= 0.9, `根っこ ${r.chordRoot}`);
    assert.ok(r.chordExact >= 0.85, `組み合わせ ${r.chordExact}`);
  }
});
