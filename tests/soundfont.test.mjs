import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { writeSf2 } from '../tools/sf2-writer.mjs';
import { parseSf2, findPreset } from '../src/audio/sf2.js';

test('SF2を書き出して読み戻せる', () => {
  const data = new Float32Array(1000).map((_, i) => Math.sin(i / 10));
  const sample = { name: 'sine', data, rate: 22050, root: 60, corr: -12, loop: [100, 900] };
  const bytes = writeSf2({
    name: 'Test',
    presets: [
      { name: 'Lead', bank: 0, program: 80, zones: [{ keyLo: 0, keyHi: 127, sample, gens: { attack: 0.1, decay: 1, sustain: 300, release: 0.5, attenuation: 60, fineTune: 5 } }] },
      { name: 'Kit', bank: 128, program: 0, zones: [{ keyLo: 36, keyHi: 36, sample, gens: { rootKey: 36 } }] },
    ],
  });
  const sf = parseSf2(bytes);
  assert.equal(sf.name, 'Test');
  assert.equal(sf.presets.length, 2);
  const r = sf.presets[0].regions[0];
  assert.equal(r.root, 60);
  assert.equal(r.tune, 5 - 12);
  assert.equal(r.loop, true);
  assert.equal(r.loopStart, 100);
  assert.equal(r.loopEnd, 900);
  assert.equal(r.end - r.start, 1000);
  assert.equal(r.attenuation, 60);
  assert.equal(r.sustain, 300);
  assert.ok(Math.abs(r.attack - 0.1) < 0.002);
  assert.ok(Math.abs(r.release - 0.5) < 0.01);
  assert.equal(sf.presets[1].regions[0].root, 36);
  assert.ok(Math.abs(sf.pcm[sf.presets[0].regions[0].start + 15] / 32767 - Math.sin(1.5)) < 1e-3);
});

test('同梱のアプリ独自セットが読める・楽器を番号で探せる', () => {
  for (const name of ['chip', 'synth', 'toy']) {
    const sf = parseSf2(readFileSync(new URL(`../soundfonts/midichen-${name}.sf2`, import.meta.url)));
    assert.ok(sf.presets.filter((p) => p.bank === 0).length >= 15, name);
    assert.ok(findPreset(sf, 0, true).bank === 128, `${name} drums`);
    for (const prog of [0, 33, 48, 81, 127]) {
      const p = findPreset(sf, prog, false);
      assert.ok(p && p.bank === 0 && p.regions.length, `${name} ${prog}`);
      // どの高さでも鳴る（音域のすき間がない）
      for (let key = 24; key <= 108; key += 6) assert.ok(p.regions.some((r) => key >= r.keyLo && key <= r.keyHi), `${name} ${prog} key ${key}`);
    }
    // ドラムの基本（バスドラ・スネア・ハイハット）がある
    const kit = findPreset(sf, 0, true);
    for (const key of [36, 38, 42, 46, 49]) assert.ok(kit.regions.some((r) => key >= r.keyLo && key <= r.keyHi), `${name} kit ${key}`);
  }
});

test('標準セット（GeneralUser GS）が読める', { skip: !existsSync(new URL('../soundfonts/GeneralUser-GS.sf2', import.meta.url)) }, () => {
  const sf = parseSf2(readFileSync(new URL('../soundfonts/GeneralUser-GS.sf2', import.meta.url)));
  assert.equal(sf.presets.filter((p) => p.bank === 0).length, 128);
  assert.equal(findPreset(sf, 0, false).program, 0);
  assert.ok(findPreset(sf, 0, true).regions.some((r) => r.keyLo <= 36 && r.keyHi >= 36));
});
