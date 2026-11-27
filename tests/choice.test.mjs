import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseInstruments, songCharacter } from '../src/core/instrument-choice.js';
import { pickRegions } from '../src/audio/sf-bank.js';

// 簡単な曲を作る：bpm・メロディの音の長さ（拍）・長調か短調か・ドラムの有無
function makeSong({ bpm = 120, len = 1, minor = false, drums = true, high = 72 } = {}) {
  const beat = 60 / bpm;
  const scale = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const mel = [], chords = [], dr = [];
  for (let i = 0; i < 64 / len; i++) mel.push({ t: i * len * beat, d: len * beat * 0.9, p: high - 12 + 12 + scale[(i * 2) % 7] - 0, v: 90 });
  const triad = minor ? [57, 60, 64] : [60, 64, 67];
  for (let b = 0; b < 16; b++) for (const p of triad) chords.push({ t: b * 4 * beat, d: 3.8 * beat, p, v: 70 });
  if (drums) for (let k = 0; k < 64; k++) dr.push({ t: k * beat, d: 0.1, p: k % 2 ? 38 : 36, v: 100 });
  const tr = (role, notes, isDrum = false) => ({ name: role, role, isDrum, program: null, layer: 0, notes });
  return { bpm, tracks: [tr('melody', mel), tr('chords', chords), tr('bass', triad.map((p, i) => ({ t: i, d: 1, p: p - 24, v: 90 }))), tr('drums', dr, true)] };
}

test('曲の性格（明るい／暗い・速さ）を見分けられる', () => {
  assert.equal(songCharacter(makeSong()).minor, false);
  assert.equal(songCharacter(makeSong({ minor: true })).minor, true);
});

test('曲に合わせて楽器が変わる', () => {
  const ballad = chooseInstruments(makeSong({ bpm: 76, len: 2 }), 'real');
  const rock = chooseInstruments(makeSong({ bpm: 160, len: 0.5, minor: true }), 'real');
  assert.equal(ballad.mood, 'slow');
  assert.equal(rock.mood, 'fast');
  assert.notEqual(ballad.roles.melody, rock.roles.melody);
  assert.notEqual(ballad.roles.bass, rock.roles.bass);
  // 速いバンドの曲では、増やしたパートのハープなどをバンドの楽器に置きかえる
  assert.equal(rock.remap[46], 25);
  assert.deepEqual(chooseInstruments(makeSong({ bpm: 76, len: 2 }), 'orchestra').remap, {});
});

test('楽器の音域の外の音も、オクターブを移して鳴らす（音が抜けない）', () => {
  const preset = { bank: 0, regions: [{ keyLo: 28, keyHi: 60, velLo: 0, velHi: 80 }, { keyLo: 28, keyHi: 60, velLo: 100, velHi: 127 }] };
  assert.equal(pickRegions(preset, 76, 90).pitch, 52); // 高すぎる → 2オクターブ下
  assert.equal(pickRegions(preset, 76, 85).regions.length, 1); // 強さのすき間 → 近い強さ
  assert.equal(pickRegions(preset, 20, 60).pitch, 32);
  const kit = { bank: 128, regions: [{ keyLo: 36, keyHi: 36, velLo: 0, velHi: 127 }, { keyLo: 49, keyHi: 49, velLo: 0, velHi: 127 }] };
  assert.equal(pickRegions(kit, 35, 90).pitch, 36); // バスドラの代わり
  assert.equal(pickRegions(kit, 57, 90).pitch, 49); // シンバルの代わり
  assert.equal(pickRegions(kit, 56, 90).regions.length, 0); // 代わりがなければ鳴らさない（別の楽器を鳴らさない）
});
