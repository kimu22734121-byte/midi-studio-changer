import test from 'node:test';
import assert from 'node:assert/strict';
import { decideInstruments, resampleTo16k } from '../src/analysis/instrument-id.js';

test('聴き取った点数から、パートの楽器を選ぶ', () => {
  // ピアノの伴奏（左右に広がる）＋歌＋エレキベース
  const pop = decideInstruments({ mix: { Singing: 0.3, Piano: 0.08, 'Bass guitar': 0.03 }, side: { Piano: 0.1 }, low: { 'Bass guitar': 0.06 } });
  assert.equal(pop.chords, 0);
  assert.equal(pop.melody, null); // 歌はふだん通りの選び方
  assert.equal(pop.bass, 33);
  assert.ok(pop.voice && pop.names.includes('ピアノ'));
  // ロック：ひずんだギター
  const rock = decideInstruments({ mix: { 'Rock music': 0.2, 'Electric guitar': 0.1, Singing: 0.2 }, side: { 'Electric guitar': 0.12 }, low: { 'Bass guitar': 0.05 } });
  assert.equal(rock.chords, 30);
  assert.equal(rock.bass, 34);
  assert.equal(rock.drums, 16);
  // 電子音の曲
  const edm = decideInstruments({ mix: { 'Electronic music': 0.2, Techno: 0.1, Synthesizer: 0.1, 'Synthetic singing': 0.05, Singing: 0.1 }, side: null, low: {} });
  assert.ok(edm.electronic);
  assert.equal(edm.bass, 38);
  assert.equal(edm.drums, 25);
  assert.ok(edm.synthVoice);
  // 歌のない曲：一番目立つ楽器がメロディ
  const inst = decideInstruments({ mix: { Trumpet: 0.5, 'Brass instrument': 0.5 }, side: null, low: {} });
  assert.equal(inst.melody, 56);
  // ベースギターだけの音を「ギター」と取り違えない
  const b = decideInstruments({ mix: { 'Bass guitar': 0.08, Guitar: 0.06, 'Plucked string instrument': 0.05 }, side: null, low: { 'Bass guitar': 0.1 } });
  assert.equal(b.chords, null);
  assert.equal(b.bass, 33);
});

test('16000Hz に直す（長さと音の高さが保たれる）', () => {
  const sr = 22050, x = new Float32Array(sr);
  for (let i = 0; i < sr; i++) x[i] = Math.sin((2 * Math.PI * 440 * i) / sr);
  const y = resampleTo16k(x, sr);
  assert.equal(y.length, 16000);
  let zc = 0;
  for (let i = 1; i < y.length; i++) if (y[i - 1] < 0 && y[i] >= 0) zc++;
  assert.ok(Math.abs(zc - 440) <= 2, `ゼロ交差 ${zc}`);
});
