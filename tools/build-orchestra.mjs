// オーケストラのセットを作るスクリプト。
// MuseScore の「MS Basic」（MuseScore_General / FluidR3 系、MIT ライセンス）から、
// オーケストラの楽器だけを取り出して、軽い .sf2 にする。スタジオ録音なので雑音が少ない。
//
// 使い方：
//   node tools/build-orchestra.mjs "<MS Basic.sf3 の場所>"
//   （MS Basic.sf3 は https://github.com/musescore/MuseScore の share/sound/ にある）
// 必要なもの：ffmpeg（圧縮された音を元に戻すため）
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseSf2 } from '../src/audio/sf2.js';
import { writeSf2 } from './sf2-writer.mjs';

const SRC = process.argv[2];
if (!SRC) { console.error('usage: node tools/build-orchestra.mjs "<MS Basic.sf3>"'); process.exit(1); }
// 容量を抑えるための設定
//  - 高い音の少ない楽器は 22kHz、きらきらした楽器は 32kHz
//  - 左右2本で録った音は片方だけ（アプリ側で左右に振り分けて鳴らす）
//  - 長く伸ばす音の「くり返し部分」は最大 1 秒（なめらかにつなぎ直す）
//  - 強さの段階は 2 つまで（ピアノ・弦は 1 つ）
const BRIGHT = new Set([8, 9, 11, 12, 13, 14, 72, 73, 74, 75]);
const ONE_LAYER = new Set([0, 44, 45, 48, 49]);
const MAX_LOOP = 1.0;
// くり返し部分が始まるまでの長さの上限（それより遅いときは早めにつなぎ直す）
const headFor = (prog, isKit) => (isKit ? 2.5 : prog === 0 ? 2.5 : 1.0);
const rateFor = (prog, isKit) => (isKit || BRIGHT.has(prog) ? 32000 : prog === 0 ? 24000 : 22050);

// 取り出す楽器（GMの番号）と、打楽器セット（オーケストラ用）
const PROGRAMS = [0, 8, 9, 11, 12, 13, 14, 19, 32, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 52, 53, 55, 56, 57, 58, 59, 60, 61, 68, 69, 70, 71, 72, 73, 74, 75];
const KITS = [48, 0];

const sf = parseSf2(readFileSync(SRC));
if (!sf.compressed) console.warn('（SF3 ではないようですが、そのまま続けます）');
const bytes = new Uint8Array(sf.pcm.buffer, sf.pcm.byteOffset, sf.pcm.byteLength);

const cache = new Map(); // サンプル番号 → 書き出し用サンプル
function sampleOf(idx, RATE, maxHead) {
  if (cache.has(idx)) return cache.get(idx);
  const s = sf.samples[idx];
  const rate = Math.min(RATE, s.rate);
  let data;
  if (s.type & 0x10) {
    const ogg = bytes.subarray(s.start, s.end);
    const out = execFileSync('ffmpeg', ['-v', 'error', '-f', 'ogg', '-i', 'pipe:0', '-ac', '1', '-ar', String(rate), '-f', 'f32le', 'pipe:1'], { input: ogg, maxBuffer: 1 << 28 });
    data = new Float32Array(out.buffer, out.byteOffset, out.byteLength >> 2).slice();
  } else {
    data = Float32Array.from(sf.pcm.subarray(s.start, s.end), (v) => v / 32768);
  }
  // SF3 のループ位置は「その音の始まりから何番目か」（元の速さで数えたもの）
  const k = rate / s.rate;
  const base = s.type & 0x10 ? 0 : s.start;
  let loop = null;
  const ls = Math.round((s.loopStart - base) * k), le = Math.round((s.loopEnd - base) * k);
  if (le - ls > 8 && ls >= 0 && le <= data.length) {
    let S = ls, E = le;
    const maxLen = Math.round(MAX_LOOP * rate);
    const head = Math.round(maxHead * rate);
    if (S > head) S = head; // くり返しを早めに始める
    if (E - S > maxLen + rate * 0.3 || S !== ls) {
      // くり返し部分を短くする：始まりはそのまま、終わりを早めて、つなぎ目をなめらかに混ぜる
      E = Math.min(E, S + maxLen);
      const X = Math.round(rate * 0.2);
      for (let i = 0; i < X; i++) {
        const w = i / X;
        if (S - X + i >= 0) data[E - X + i] = data[E - X + i] * (1 - w) + data[S - X + i] * w;
      }
    }
    // くり返し部分より後ろは鳴らないので切る（決まりどおり 8 個だけ残す）
    const tail = data.slice(S, S + 8);
    data = Float32Array.from([...data.subarray(0, E), ...tail]);
    loop = [S, E];
  }
  const sample = { name: s.name.slice(0, 19), data, rate, root: s.root, corr: 0, loop };
  cache.set(idx, sample);
  return sample;
}

function zonesOf(preset, isKit = false) {
  const RATE = rateFor(preset.program, isKit);
  const HEAD = headFor(preset.program, isKit);
  const maxLayers = ONE_LAYER.has(preset.program) && !isKit ? 1 : 2;
  // 強さの段階を減らす：同じ音域の中で、強い方から MAX_LAYERS 個
  const byKey = new Map();
  for (const r of preset.regions) {
    // 左右2本で録った音の「右」は使わない（左だけを真ん中で鳴らす）
    if (sf.samples[r.sampleIndex].type & 2) continue;
    const k = `${r.keyLo}-${r.keyHi}`;
    if (!byKey.has(k)) byKey.set(k, new Map());
    const vel = byKey.get(k);
    const vk = `${r.velLo}-${r.velHi}`;
    if (!vel.has(vk)) vel.set(vk, []);
    vel.get(vk).push(r);
  }
  const zones = [];
  for (const vel of byKey.values()) {
    const layers = [...vel.entries()].sort((a, b) => b[1][0].velHi - a[1][0].velHi).slice(0, maxLayers).reverse();
    layers.forEach(([, regs], i) => {
      const velLo = i === 0 ? 0 : layers[i - 1][1][0].velHi + 1;
      const velHi = i === layers.length - 1 ? 127 : regs[0].velHi;
      for (const r of regs) {
        const coarse = Math.trunc(r.tune / 100);
        zones.push({
          keyLo: r.keyLo, keyHi: r.keyHi, velLo, velHi,
          sample: sampleOf(r.sampleIndex, RATE, HEAD),
          gens: {
            rootKey: r.root, coarseTune: coarse, fineTune: r.tune - coarse * 100, scaleTuning: r.scaleTuning,
            attenuation: r.attenuation, pan: sf.samples[r.sampleIndex].type & 4 ? 0 : r.pan,
            delay: r.delay, attack: r.attack, hold: r.hold, decay: r.decay, sustain: r.sustain, release: r.release,
            filterHz: r.filterFc < 13500 ? 8.176 * 2 ** (r.filterFc / 1200) : undefined, filterQ: r.filterQ,
            exclusiveClass: r.exclusiveClass,
          },
        });
      }
    });
  }
  return zones;
}

const presets = [];
for (const prog of PROGRAMS) {
  const p = sf.presets.find((x) => x.bank === 0 && x.program === prog);
  if (!p) { console.warn('なし', prog); continue; }
  presets.push({ name: p.name, bank: 0, program: prog, zones: zonesOf(p) });
}
const kit = KITS.map((k) => sf.presets.find((x) => x.bank === 128 && x.program === k)).find(Boolean);
if (kit) presets.push({ name: kit.name, bank: 128, program: 0, zones: zonesOf(kit, true) });

const out = writeSf2({
  name: 'MIDI Studio Changer Orchestra',
  copyright: 'MuseScore_General (MIT): FluidR3 by Frank Wen (c) 2000-02, FluidR3Mono by Michael Cowgill (c) 2014-17, MuseScore_General by S. Christian Collins (c) 2018-19',
  comment: 'Orchestral subset of MuseScore MS Basic, converted by MIDI Studio Changer. MIT license.',
  presets,
});
writeFileSync(new URL('../soundfonts/midichen-orchestra.sf2', import.meta.url), out);
console.log('presets', presets.length, 'samples', cache.size, 'size', (out.length / 1048576).toFixed(1), 'MB');
