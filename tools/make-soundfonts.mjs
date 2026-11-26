// アプリ独自のサウンドフォント（ファミコン風・シンセ）を作るスクリプト。
// すべてプログラムで合成した音なので、ライセンスは CC0（自由に使ってOK）。
// 使い方: node tools/make-soundfonts.mjs   → soundfonts/midichen-*.sf2 を出力
import { writeFileSync, mkdirSync } from 'node:fs';
import { writeSf2 } from './sf2-writer.mjs';

const OUT = new URL('../soundfonts/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const ftom = (f) => 69 + 12 * Math.log2(f / 440);
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;

function normalize(a, peak = 0.85) {
  let m = 0;
  for (const v of a) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < a.length; i++) a[i] *= peak / m;
  return a;
}

/** 1周期をくり返すループ音。fn(phase0..1, f0) で1周期の波形を返す */
function loopSample(name, midi, fn, { rate = 44100, cycles = 8 } = {}) {
  const N = Math.max(8, Math.round(rate / mtof(midi)));
  const f0 = rate / N;
  // 前後に1周期ずつ余白を付ける（ループの外に8サンプル以上置くのがSF2の決まり）
  const data = new Float32Array(N * (cycles + 2));
  const cyc = new Float32Array(N);
  for (let i = 0; i < N; i++) cyc[i] = fn(i / N, f0);
  let mean = 0;
  for (const v of cyc) mean += v / N;
  for (let i = 0; i < data.length; i++) data[i] = cyc[i % N] - mean;
  normalize(data);
  const real = ftom(f0);
  const root = Math.round(real);
  return { name, data, rate, root, corr: Math.round((root - real) * 100), loop: [N, N * (cycles + 1)] };
}

/** 一回鳴らしきりの音。fn(t秒, f) → 値 */
function oneShot(name, midi, dur, fn, { rate = 32000 } = {}) {
  const f = mtof(midi);
  const data = new Float32Array(Math.round(dur * rate));
  for (let i = 0; i < data.length; i++) data[i] = fn(i / rate, f, i);
  // 終わりを少しフェード
  const fade = Math.min(data.length, Math.round(0.01 * rate));
  for (let i = 0; i < fade; i++) data[data.length - 1 - i] *= i / fade;
  normalize(data);
  return { name, data, rate, root: midi, corr: 0, loop: null };
}

/** 帯域制限した加算合成。amp(k) が k 倍音の大きさ */
const additive = (amp, maxK) => (ph) => {
  let s = 0;
  for (let k = 1; k <= maxK; k++) { const a = amp(k); if (a) s += a * Math.sin(2 * Math.PI * k * ph); }
  return s;
};
const harmLimit = (topMidi, rate = 44100) => Math.max(1, Math.floor((rate * 0.42) / mtof(topMidi)));

/** 音域をいくつかに分けて、それぞれに合った音を作る */
function multiZone(name, roots, makeSample, gens = {}, layers = [{}]) {
  const zones = [];
  roots.forEach((root, i) => {
    const lo = i === 0 ? 0 : Math.floor((roots[i - 1] + root) / 2) + 1;
    const hi = i === roots.length - 1 ? 127 : Math.floor((root + roots[i + 1]) / 2);
    const s = makeSample(`${name}${root}`.slice(0, 19), root, hi);
    for (const l of layers) zones.push({ keyLo: lo, keyHi: hi, sample: s, gens: { ...gens, ...l } });
  });
  return zones;
}
const preset = (name, program, zones, bank = 0) => ({ name, program, bank, zones });

// ---------------- 共通の波形 ----------------
const pulse = (d) => (ph) => (ph < d ? 1 : -1);
const nesTri = (ph) => { const step = Math.floor(ph * 32); const v = step < 16 ? step : 31 - step; return (v / 15) * 2 - 1; };
const sawAmp = (k) => 1 / k;
const sqAmp = (k) => (k % 2 ? 1 / k : 0);
const triAmp = (k) => (k % 2 ? ((k - 1) / 2) % 2 ? -1 / (k * k) : 1 / (k * k) : 0);
const roll = (amp, fc) => (k) => amp(k) / Math.sqrt(1 + (k / fc) ** 4);

function lfsrNoise(dur, rate, period, short = false) {
  const data = new Float32Array(Math.round(dur * rate));
  let reg = 1, v = 1;
  for (let i = 0; i < data.length; i++) {
    if (i % period === 0) {
      const bit = (reg ^ (reg >> (short ? 6 : 1))) & 1;
      reg = (reg >> 1) | (bit << 14);
      v = reg & 1 ? 1 : -1;
    }
    data[i] = v;
  }
  return data;
}
function envShot(name, root, dur, rate, gen) {
  const data = new Float32Array(Math.round(dur * rate));
  for (let i = 0; i < data.length; i++) data[i] = gen(i / rate, i);
  normalize(data);
  return { name, data, rate, root, corr: 0, loop: null };
}

/** ドラムキット：key → sample（同じ sample を何キーかで共有も可） */
function drumKit(name, map) {
  const zones = [];
  for (const [keys, sample, gens] of map) {
    const [lo, hi] = Array.isArray(keys) ? keys : [keys, keys];
    const g = { release: 0.3, ...gens };
    // 1キーだけのゾーンは、そのキーで元の高さが鳴るようにする（rootKey 指定があればそれを使う）
    if (g.rootKey === undefined && lo === hi) g.rootKey = lo;
    zones.push({ keyLo: lo, keyHi: hi, sample, gens: g });
  }
  return preset(name, 0, zones, 128);
}

const OCT = [36, 48, 60, 72, 84, 96];

// ================= ファミコン風 =================
function chipSet() {
  const P = [];
  const chip = (nm, fn) => (n, root) => loopSample(nm + root, root, fn);
  const p50 = chip('p50_', pulse(0.5)), p25 = chip('p25_', pulse(0.25)), p12 = chip('p12_', pulse(0.125)), tri = chip('tri_', nesTri);
  const z = (nm, mk, gens, layers) => multiZone(nm, OCT, mk, gens, layers);
  P.push(preset('Chip Piano', 0, z('pp', p50, { attack: 0.002, decay: 1.5, sustain: 700, release: 0.1, attenuation: 40 })));
  P.push(preset('Chip Bell', 8, z('pb', p12, { attack: 0.002, decay: 0.8, sustain: 900, release: 0.2, attenuation: 30 })));
  P.push(preset('Chip Organ', 16, z('po', p25, { attack: 0.005, release: 0.05, attenuation: 50 })));
  P.push(preset('Chip Guitar', 24, z('pg', p25, { attack: 0.002, decay: 0.5, sustain: 400, release: 0.1, attenuation: 40 })));
  P.push(preset('Chip Bass', 32, z('tb', tri, { attack: 0.002, release: 0.05 })));
  P.push(preset('Chip Strings', 40, z('ps', p50, { attack: 0.08, release: 0.25, attenuation: 60 })));
  P.push(preset('Chip Ensemble', 48, z('pe', p25, { attack: 0.05, release: 0.3, attenuation: 80 }, [{ fineTune: -8, pan: -300 }, { fineTune: 8, pan: 300 }])));
  P.push(preset('Chip Brass', 56, z('pr', p50, { attack: 0.03, release: 0.1, attenuation: 50 })));
  P.push(preset('Chip Reed', 64, z('pn', p12, { attack: 0.01, release: 0.08, attenuation: 40 })));
  P.push(preset('Chip Flute', 72, z('pf', tri, { attack: 0.02, release: 0.1 })));
  P.push(preset('Chip Lead 25', 80, z('l25', p25, { attack: 0.003, release: 0.06, attenuation: 50 })));
  P.push(preset('Chip Lead 50', 81, z('l50', p50, { attack: 0.003, release: 0.06, attenuation: 60 })));
  P.push(preset('Chip Lead 12', 82, z('l12', p12, { attack: 0.003, release: 0.06, attenuation: 40 })));
  P.push(preset('Chip Pad', 88, z('pd', p25, { attack: 0.35, release: 0.6, attenuation: 80 }, [{ fineTune: -10 }, { fineTune: 10 }])));
  P.push(preset('Chip Sparkle', 96, z('px', p12, { attack: 0.002, decay: 0.4, sustain: 1000, release: 0.4, attenuation: 40 }, [{}, { coarseTune: 12, attenuation: 100 }])));
  P.push(preset('Chip Perc', 112, z('pk', tri, { attack: 0.001, decay: 0.15, sustain: 1440, release: 0.05 })));
  const nz = { name: 'noiseLoop', data: normalize(lfsrNoise(0.6, 44100, 4)), rate: 44100, root: 60, corr: 0, loop: [2205, 24255] };
  P.push(preset('Chip Noise', 120, [{ keyLo: 0, keyHi: 127, sample: nz, gens: { attack: 0.01, release: 0.2, attenuation: 60 } }]));

  const R = 32000;
  // 周波数が下がっていく音（位相を積分してなめらかに）
  const sweep = (t, f1, f2, k) => f1 * t + ((f2 - f1) / k) * (1 - Math.exp(-t * k));
  const kick = envShot('cKick', 36, 0.2, R, (t) => nesTri(sweep(t, 45, 205, 30) % 1) * Math.exp(-t * 12));
  const snN = lfsrNoise(0.2, R, 2);
  const snare = envShot('cSnare', 38, 0.2, R, (t, i) => snN[i] * Math.exp(-t * 18) + 0.5 * nesTri((t * 190) % 1) * Math.exp(-t * 40));
  const hhN = lfsrNoise(0.4, R, 1, true);
  const hat = envShot('cHat', 42, 0.06, R, (t, i) => hhN[i] * Math.exp(-t * 70));
  const ohat = envShot('cOHat', 46, 0.35, R, (t, i) => hhN[i] * Math.exp(-t * 9));
  const crN = lfsrNoise(1.2, R, 1);
  const crash = envShot('cCrash', 49, 1.2, R, (t, i) => crN[i] * Math.exp(-t * 3));
  const ride = envShot('cRide', 51, 0.6, R, (t, i) => hhN[i % hhN.length] * Math.exp(-t * 5) * 0.7);
  const tom = envShot('cTom', 45, 0.3, R, (t) => nesTri(sweep(t, 110, 176, 20) % 1) * Math.exp(-t * 9));
  const clap = envShot('cClap', 39, 0.2, R, (t, i) => snN[i] * (t < 0.01 || (t > 0.02 && t < 0.03) ? 1 : Math.exp(-(t - 0.03) * 25) * (t > 0.03)));
  const blip = envShot('cBlip', 60, 0.08, R, (t) => pulse(0.25)((t * 880) % 1) * Math.exp(-t * 40));
  P.push(drumKit('Chip Drums', [
    [[27, 34], blip], [[35, 36], kick], [37, blip], [[38, 38], snare], [39, clap], [40, snare],
    [[41, 41], tom, { rootKey: 38 }], [42, hat, { exclusiveClass: 1 }], [43, tom, { rootKey: 41 }], [44, hat, { exclusiveClass: 1 }],
    [45, tom], [46, ohat, { exclusiveClass: 1 }], [47, tom, { rootKey: 48 }], [48, tom, { rootKey: 50 }], [49, crash],
    [50, tom, { rootKey: 53 }], [51, ride], [52, crash], [53, ride], [[54, 56], blip], [57, crash], [[58, 87], blip],
  ]));
  return writeSf2({ name: 'MIDI Studio Changer Chip', copyright: 'CC0 1.0 (MIDI Studio Changer)', comment: 'Famicom-style chiptune instruments generated by code.', presets: P });
}

// ================= シンセ =================
function synthSet() {
  const P = [];
  const add = (nm, amp) => (n, root, top) => loopSample(nm + root, root, additive(amp, harmLimit(top)));
  const z = (nm, mk, gens, layers, roots = OCT) => multiZone(nm, roots, mk, gens, layers);
  const fmShot = (nm, ratio, index, idxDecay, ampDecay, dur, extra = 0) => (n, root) => oneShot(nm + root, root, dur, (t, f) => {
    const I = index * Math.exp(-t * idxDecay);
    return Math.sin(2 * Math.PI * f * t + I * Math.sin(2 * Math.PI * f * ratio * t)) * Math.exp(-t * ampDecay)
      + extra * Math.sin(2 * Math.PI * f * 14 * t) * Math.exp(-t * 40);
  });
  const ROOTS4 = [36, 52, 68, 84, 100];
  P.push(preset('FM E.Piano', 4, z('ep', fmShot('ep', 1, 1.8, 3, 1.2, 2.2, 0.15), { attack: 0.002, release: 0.3 }, undefined, ROOTS4)));
  P.push(preset('FM Bell', 8, z('fb', fmShot('fb', 3.5, 3, 1.5, 1, 2.5), { attack: 0.002, release: 0.6 }, undefined, ROOTS4)));
  P.push(preset('Synth Organ', 16, z('so', add('so', (k) => ({ 1: 1, 2: 0.7, 3: 0.5, 4: 0.35, 6: 0.25, 8: 0.2 })[k] || 0), { attack: 0.005, release: 0.06, attenuation: 30 })));
  P.push(preset('Synth Pluck', 24, z('sp', add('sp', roll(sawAmp, 6)), { attack: 0.002, decay: 0.5, sustain: 500, release: 0.15, attenuation: 20 }, [{ fineTune: -6 }, { fineTune: 6 }])));
  P.push(preset('Analog Bass', 32, z('ab', add('ab', roll(sawAmp, 5)), { attack: 0.003, decay: 0.4, sustain: 150, release: 0.06 }, undefined, [24, 36, 48, 60, 72])));
  P.push(preset('Sub Bass', 33, z('sb', add('sb', (k) => (k === 1 ? 1 : k === 2 ? 0.25 : 0)), { attack: 0.005, release: 0.08 }, undefined, [24, 36, 48, 60])));
  P.push(preset('Square Bass', 38, z('qb', add('qb', roll(sqAmp, 7)), { attack: 0.003, decay: 0.3, sustain: 200, release: 0.06 }, undefined, [24, 36, 48, 60, 72])));
  P.push(preset('Synth Strings', 40, z('ss', add('ss', roll(sawAmp, 10)), { attack: 0.25, release: 0.5, attenuation: 70 }, [{ fineTune: -7, pan: -250 }, { fineTune: 7, pan: 250 }])));
  P.push(preset('Super Saw', 48, z('sw', add('sw', sawAmp), { attack: 0.02, release: 0.3, attenuation: 110 }, [{ fineTune: -15, pan: -400 }, {}, { fineTune: 15, pan: 400 }])));
  P.push(preset('Synth Brass', 56, z('sbr', add('sbr', roll(sawAmp, 12)), { attack: 0.05, release: 0.15, attenuation: 60 }, [{ fineTune: -5 }, { fineTune: 5 }])));
  P.push(preset('Square Lead', 80, z('ql', add('ql', sqAmp), { attack: 0.004, release: 0.08, attenuation: 40 })));
  P.push(preset('Saw Lead', 81, z('wl', add('wl', sawAmp), { attack: 0.004, release: 0.08, attenuation: 50 }, [{ fineTune: -4 }, { fineTune: 4 }])));
  P.push(preset('Soft Lead', 82, z('fl', add('fl', (k) => 1 / (k * k)), { attack: 0.02, release: 0.12, attenuation: 20 })));
  P.push(preset('Dream Pad', 88, z('dp', add('dp', roll(sawAmp, 4)), { attack: 0.6, release: 1.5, attenuation: 90 }, [{ fineTune: -12, pan: -350 }, { fineTune: 12, pan: 350 }])));
  P.push(preset('Warm Pad', 89, z('wp', add('wp', triAmp), { attack: 0.4, release: 1.2, attenuation: 40 }, [{ fineTune: -8 }, { fineTune: 8 }])));
  P.push(preset('Space Pad', 91, z('xp', add('xp', (k) => ({ 1: 1, 2: 0.2, 3: 0.35, 5: 0.25 })[k] || 0), { attack: 1.0, release: 2.0, attenuation: 70 }, [{ fineTune: -10, pan: -400 }, { coarseTune: 12, attenuation: 160, pan: 400 }])));
  P.push(preset('Space Sparkle', 96, z('xs', fmShot('xs', 7.01, 2, 2, 1.5, 2.2), { attack: 0.002, release: 0.8, attenuation: 30 }, undefined, ROOTS4)));

  const R = 32000;
  const kick = envShot('sKick', 36, 0.8, R, (t) => Math.sin(2 * Math.PI * (48 * t + (120 / 25) * (1 - Math.exp(-t * 25)))) * Math.exp(-t * 4.5));
  const snare = envShot('sSnare', 38, 0.3, R, (t) => rnd() * Math.exp(-t * 14) * 0.8 + Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 25) * 0.6);
  const clap = envShot('sClap', 39, 0.3, R, (t) => { const b = [0, 0.011, 0.022].some((s) => t >= s && t < s + 0.006) ? 1 : t > 0.022 ? Math.exp(-(t - 0.022) * 18) : 0; return rnd() * b; });
  const metal = (t) => [205.3, 304.4, 369.6, 522.7, 540, 800].reduce((s, f) => s + (Math.sin(2 * Math.PI * f * t * 2.2) > 0 ? 1 : -1), 0) / 6;
  const hp = (gen) => { let prev = 0, prevIn = 0; return (t) => { const x = gen(t); const y = 0.85 * (prev + x - prevIn); prev = y; prevIn = x; return y; }; };
  const hhSrc = hp(metal);
  const hat = envShot('sHat', 42, 0.08, R, (t) => hhSrc(t) * Math.exp(-t * 60));
  const ohSrc = hp(metal);
  const ohat = envShot('sOHat', 46, 0.5, R, (t) => ohSrc(t) * Math.exp(-t * 7));
  const crash = envShot('sCrash', 49, 1.5, R, (t) => (rnd() * 0.6 + 0.4 * metal(t)) * Math.exp(-t * 2.5));
  const tom = envShot('sTom', 45, 0.5, R, (t) => Math.sin(2 * Math.PI * (110 * t + (60 / 15) * (1 - Math.exp(-t * 15)))) * Math.exp(-t * 7));
  const cow = envShot('sCow', 56, 0.3, R, (t) => (Math.sign(Math.sin(2 * Math.PI * 540 * t)) + Math.sign(Math.sin(2 * Math.PI * 800 * t))) * Math.exp(-t * 15));
  const rim = envShot('sRim', 37, 0.05, R, (t) => Math.sin(2 * Math.PI * 1700 * t) * Math.exp(-t * 90));
  P.push(drumKit('Synth Drums', [
    [[27, 34], rim], [[35, 36], kick], [37, rim], [38, snare], [39, clap], [40, snare],
    [41, tom, { rootKey: 38 }], [42, hat, { exclusiveClass: 1 }], [43, tom, { rootKey: 41 }], [44, hat, { exclusiveClass: 1 }],
    [45, tom], [46, ohat, { exclusiveClass: 1 }], [47, tom, { rootKey: 48 }], [48, tom, { rootKey: 50 }], [49, crash],
    [50, tom, { rootKey: 53 }], [51, ohat], [52, crash], [53, cow], [[54, 55], hat], [56, cow], [57, crash], [[58, 87], rim],
  ]));
  return writeSf2({ name: 'MIDI Studio Changer Synth', copyright: 'CC0 1.0 (MIDI Studio Changer)', comment: 'Synthesizer instruments generated by code.', presets: P });
}

for (const [file, fn] of [['midichen-chip.sf2', chipSet], ['midichen-synth.sf2', synthSet]]) {
  const bytes = fn();
  writeFileSync(new URL(file, OUT), bytes);
  console.log(file, (bytes.length / 1024).toFixed(0), 'KB');
}
