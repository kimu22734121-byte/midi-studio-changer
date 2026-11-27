// 電子音が得意なセット（ユーロビート・EDM・ボカロ向け）を作るスクリプト。
// すべてプログラムで合成した音なので、ライセンスは CC0（自由に使ってOK）。
// 「シンセ」セットより1音ずつを長く・左右別々に作って、分厚く広がる音にしている。
// 使い方: node tools/make-edm.mjs   → soundfonts/midichen-edm.sf2 を出力
import { writeFileSync } from 'node:fs';
import { writeSf2 } from './sf2-writer.mjs';

const RATE = 32000;
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
let seed = 777;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
const rnd01 = () => (rnd() + 1) / 2;

function normalize(a, peak = 0.9) {
  let m = 0;
  for (const v of a) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < a.length; i++) a[i] *= peak / m;
  return a;
}

// ---------- 帯域制限した波形の表（高い倍音を切って、耳障りな折り返しを出さない） ----------
const TBL = 4096;
const tables = new Map();
function table(kind, maxK) {
  const key = kind + maxK;
  if (tables.has(key)) return tables.get(key);
  const t = new Float32Array(TBL + 1);
  for (let k = 1; k <= maxK; k++) {
    const a = kind === 'saw' ? 1 / k : kind === 'sq' ? (k % 2 ? 1 / k : 0) : kind === 'tri' ? (k % 2 ? ((k - 1) / 2) % 2 ? -1 / (k * k) : 1 / (k * k) : 0) : k === 1 ? 1 : 0;
    if (!a) continue;
    for (let i = 0; i < TBL; i++) t[i] += a * Math.sin((2 * Math.PI * k * i) / TBL);
  }
  t[TBL] = t[0];
  tables.set(key, t);
  return t;
}
const lookup = (t, ph) => { const x = (ph - Math.floor(ph)) * TBL; const i = x | 0; return t[i] + (t[i + 1] - t[i]) * (x - i); };
const maxKFor = (topMidi) => Math.max(1, Math.min(400, Math.floor((RATE * 0.45) / mtof(topMidi))));

/**
 * 長いループ音（左右別々）。voices = [{ cents, amp, kind }]。
 * ループの長さの中で、どの声もちょうど整数回まわるように高さを少しだけ丸める（つなぎ目でプツッといわない）
 */
function wideLoop(name, root, top, voices, { dur = root < 48 ? 2 : 1.2, side = 'L' } = {}) {
  const L = Math.round(dur * RATE);
  const pad = 16;
  const data = new Float32Array(L + pad * 2);
  const f0 = mtof(root);
  let fc = 0;
  for (const v of voices) {
    // オクターブ上下の声も含めて、ループの中でちょうど整数回まわる高さにする
    const k = Math.max(1, Math.round((f0 * 2 ** (v.cents / 1200) * 2 ** (v.oct || 0) * L) / RATE));
    if (v.cents === 0 && !v.oct && !fc) fc = (k * RATE) / L;
    const t = table(v.kind || 'saw', maxKFor(top + (v.oct || 0) * 12));
    const ph0 = rnd01();
    for (let n = 0; n < data.length; n++) data[n] += v.amp * lookup(t, ph0 + (k * (n - pad)) / L);
  }
  normalize(data, 0.8);
  const real = 69 + 12 * Math.log2((fc || f0) / 440);
  return { name: `${name}${side}${root}`.slice(0, 19), data, rate: RATE, root, corr: Math.round((root - real) * 100), loop: [pad, pad + L] };
}

/** 時間で変わるフィルター（状態変数フィルター）。cut(t) Hz、res 0..1 */
function svfLow(x, cut, res) {
  let lo = 0, bp = 0;
  const q = 1 - res * 0.92;
  const y = new Float32Array(x.length);
  for (let n = 0; n < x.length; n++) {
    const f = Math.min(0.9, 2 * Math.sin((Math.PI * Math.min(cut(n / RATE), RATE * 0.24)) / RATE));
    lo += f * bp;
    const hi = x[n] - lo - q * bp;
    bp += f * hi;
    y[n] = lo;
  }
  return y;
}

/** 一回鳴らしきりの音（重ねたのこぎり波などにフィルターをかけて作る） */
function shot(name, root, top, dur, voices, { cut, res = 0.3, amp = () => 1, drive = 0 } = {}) {
  const N = Math.round(dur * RATE);
  const x = new Float32Array(N);
  const f0 = mtof(root);
  for (const v of voices) {
    const t = table(v.kind || 'saw', maxKFor(top + (v.oct || 0) * 12));
    const f = f0 * 2 ** (v.cents / 1200) * 2 ** (v.oct || 0);
    const ph0 = rnd01();
    for (let n = 0; n < N; n++) x[n] += v.amp * lookup(t, ph0 + (f * n) / RATE);
  }
  let y = cut ? svfLow(x, cut, res) : x;
  for (let n = 0; n < N; n++) {
    let v = y[n] * amp(n / RATE);
    if (drive) v = Math.tanh(v * drive);
    y[n] = v;
  }
  const fade = Math.round(0.02 * RATE);
  for (let i = 0; i < fade; i++) y[N - 1 - i] *= i / fade;
  normalize(y, 0.85);
  return { name: `${name}${root}`.slice(0, 19), data: y, rate: RATE, root, corr: 0, loop: null };
}

/** 音域を分けて、それぞれの高さで作った音を割り当てる。stereo なら左右2つの音を左右に振る */
function zones(roots, make, gens = {}, { stereo = false, spread = 450, layers = [{}] } = {}) {
  const out = [];
  roots.forEach((root, i) => {
    const lo = i === 0 ? 0 : Math.floor((roots[i - 1] + root) / 2) + 1;
    const hi = i === roots.length - 1 ? 127 : Math.floor((root + roots[i + 1]) / 2);
    const sides = stereo ? [['L', -spread], ['R', spread]] : [['M', 0]];
    for (const [side, pan] of sides) {
      const s = make(root, hi, side);
      for (const l of layers) out.push({ keyLo: lo, keyHi: hi, sample: s, gens: { ...gens, pan: (gens.pan || 0) + pan, ...l } });
    }
  });
  return out;
}
const preset = (name, program, z, bank = 0) => ({ name, program, bank, zones: z });

// 声の重ね方
const SUPER7 = (amt = 1) => [-42, -25, -11, 0, 11, 25, 42].map((c, i) => ({ cents: c * amt, amp: i === 3 ? 1 : 0.75 }));
const SUPER_OCT = [...SUPER7(1), { cents: 0, amp: 0.35, oct: -1 }];
const DUO = (c) => [{ cents: -c, amp: 1 }, { cents: c, amp: 1 }];
const R8 = [36, 44, 52, 60, 68, 76, 84, 92, 100];
const R6 = [36, 48, 60, 72, 84, 96];
const RB = [24, 31, 38, 45, 52, 60];

const P = [];
// --- 鍵盤・キラキラ ---
P.push(preset('Dance Piano', 0, zones(R6, (r, top) => shot('pno', r, top, 1.6, [{ cents: 0, amp: 1 }, { cents: 0, amp: 0.5, oct: 1, kind: 'sq' }, { cents: 7, amp: 0.4 }],
  { cut: (t) => 800 + 6000 * Math.exp(-t * 6), res: 0.15, amp: (t) => Math.exp(-t * 1.8) })), { attack: 0.001, release: 0.25, attenuation: 20 }));
P.push(preset('FM E.Piano', 4, zones(R6, (r) => {
  const N = Math.round(2 * RATE), f = mtof(r), d = new Float32Array(N);
  for (let n = 0; n < N; n++) { const t = n / RATE; d[n] = Math.sin(2 * Math.PI * f * t + 1.8 * Math.exp(-t * 3) * Math.sin(2 * Math.PI * f * t)) * Math.exp(-t * 1.2) + 0.12 * Math.sin(2 * Math.PI * f * 14 * t) * Math.exp(-t * 40); }
  return { name: `ep${r}`, data: normalize(d), rate: RATE, root: r, corr: 0, loop: null };
}), { attack: 0.002, release: 0.3 }));
P.push(preset('Bell Pluck', 8, zones(R6, (r, top) => shot('bel', r, top, 1.5, [{ cents: 0, amp: 1, kind: 'sq' }, { cents: 0, amp: 0.6, oct: 1, kind: 'tri' }],
  { cut: (t) => 1500 + 7000 * Math.exp(-t * 8), amp: (t) => Math.exp(-t * 3) })), { attack: 0.001, release: 0.4, attenuation: 30 }));
// --- オルガン ---
P.push(preset('House Organ', 16, zones(R6, (r, top, s) => wideLoop('org', r, top, [{ cents: 0, amp: 1, kind: 'sine' }, { cents: 0, amp: 0.7, oct: 1, kind: 'sine' }, { cents: 2, amp: 0.5, oct: 2, kind: 'sine' }, { cents: 0, amp: 0.3, oct: 3, kind: 'sq' }], { dur: 1, side: s })), { attack: 0.003, decay: 0.4, sustain: 120, release: 0.08, attenuation: 40 }));
// --- プラック（細かいアルペジオに向く） ---
P.push(preset('Trance Pluck', 24, zones(R8, (r, top, s) => shot('plk' + s, r, top, 1.0, SUPER7(0.6), { cut: (t) => 400 + 7000 * Math.exp(-t * 14), res: 0.35, amp: (t) => Math.exp(-t * 4) }),
  { attack: 0.001, release: 0.2, attenuation: 40 }, { stereo: true, spread: 350 })));
P.push(preset('Synth Guitar', 29, zones(R6, (r, top) => shot('gtr', r, top, 1.4, DUO(8), { cut: (t) => 1500 + 3000 * Math.exp(-t * 3), res: 0.4, amp: (t) => Math.exp(-t * 1.2), drive: 3 })),
  { attack: 0.002, release: 0.15, attenuation: 40 }));
// --- ベース ---
P.push(preset('Euro Bass', 32, zones(RB, (r, top) => shot('eub', r, top, 0.9, DUO(6), { cut: (t) => 250 + 2600 * Math.exp(-t * 18), res: 0.45, amp: (t) => 0.5 + 0.5 * Math.exp(-t * 5), drive: 1.5 })),
  { attack: 0.001, release: 0.06 }));
P.push(preset('Sub Bass', 33, zones(RB, (r, top, s) => wideLoop('sub', r, top, [{ cents: 0, amp: 1, kind: 'sine' }, { cents: 0, amp: 0.18, oct: 1, kind: 'sine' }], { side: s })), { attack: 0.004, release: 0.08 }));
P.push(preset('Acid Bass', 34, zones(RB, (r, top) => shot('acd', r, top, 0.8, [{ cents: 0, amp: 1 }], { cut: (t) => 180 + 3500 * Math.exp(-t * 9), res: 0.85, amp: (t) => Math.exp(-t * 1.5), drive: 2.5 })),
  { attack: 0.001, release: 0.05, attenuation: 10 }));
P.push(preset('Reese Bass', 38, zones(RB, (r, top, s) => wideLoop('rse', r, Math.min(top, 60), [{ cents: -14, amp: 1 }, { cents: 14, amp: 1 }, { cents: 0, amp: 0.8, oct: -1, kind: 'sine' }], { side: s }),
  { attack: 0.005, release: 0.08, attenuation: 20, filterHz: 1400 }, { stereo: true, spread: 200 })));
P.push(preset('Square Bass', 39, zones(RB, (r, top) => shot('sqb', r, top, 0.9, [{ cents: 0, amp: 1, kind: 'sq' }, { cents: 0, amp: 0.6, oct: -1, kind: 'sine' }], { cut: (t) => 400 + 2500 * Math.exp(-t * 12), res: 0.3, amp: (t) => 0.6 + 0.4 * Math.exp(-t * 6) })),
  { attack: 0.001, release: 0.06 }));
// --- 弦・合奏（スーパーソー） ---
P.push(preset('Synth Strings', 40, zones(R6, (r, top, s) => wideLoop('str', r, Math.min(top, 84), SUPER7(0.4), { side: s }), { attack: 0.2, release: 0.5, attenuation: 60, filterHz: 5000 }, { stereo: true })));
P.push(preset('Super Saw', 48, zones(R8, (r, top, s) => wideLoop('ss', r, top, SUPER_OCT, { side: s }), { attack: 0.01, release: 0.35, attenuation: 60 }, { stereo: true, spread: 500 })));
P.push(preset('Super Saw Pad', 49, zones(R8, (r, top, s) => wideLoop('ss', r, top, SUPER_OCT, { side: s }), { attack: 0.5, release: 1.2, attenuation: 80, filterHz: 3500 }, { stereo: true, spread: 500 })));
P.push(preset('Hoover', 50, zones(R6, (r, top, s) => wideLoop('hov', r, top, [...SUPER7(1.6), { cents: 0, amp: 0.6, oct: -1, kind: 'sq' }], { side: s }), { attack: 0.03, release: 0.3, attenuation: 70, filterHz: 4000 }, { stereo: true })));
P.push(preset('Vocal Pad', 52, zones(R6, (r, top, s) => {
  // 「アー」に近い声：700Hz・1200Hz あたりを持ち上げたのこぎり波
  const z = wideLoop('vox', r, top, SUPER7(0.3), { side: s });
  const d = z.data, out = new Float32Array(d.length);
  const [a, b] = z.loop;
  for (const [fq, g] of [[700, 1], [1200, 0.6], [2600, 0.25]]) {
    const w = (2 * Math.PI * fq) / RATE, R = 0.985;
    let y1 = 0, y2 = 0;
    // ループ部分を2周して、2周目だけを使う（つなぎ目でずれないように）
    for (let pass = 0; pass < 2; pass++) for (let n = a; n < b; n++) { const y = d[n] * (1 - R) + 2 * R * Math.cos(w) * y1 - R * R * y2; y2 = y1; y1 = y; if (pass) out[n] += g * y; }
  }
  // ループの外側は、ループの中身をつなげて埋める
  for (let n = 0; n < a; n++) out[n] = out[b - a + n];
  for (let n = b; n < out.length; n++) out[n] = out[a + n - b];
  z.data = normalize(out, 0.8);
  return z;
}, { attack: 0.3, release: 0.8, attenuation: 50 }, { stereo: true })));
P.push(preset('Orchestra Hit', 55, zones([36, 48, 60, 72, 84], (r, top) => {
  const s = shot('hit', r, top, 0.9, [{ cents: 0, amp: 1 }, { cents: 700, amp: 0.8 }, { cents: 1200, amp: 0.8 }, { cents: 1600, amp: 0.5 }, { cents: -1200, amp: 0.7 }],
    { cut: (t) => 900 + 8000 * Math.exp(-t * 7), res: 0.2, amp: (t) => Math.exp(-t * 6), drive: 2 });
  for (let n = 0; n < s.data.length; n++) s.data[n] += 0.25 * rnd() * Math.exp(-(n / RATE) * 25);
  normalize(s.data, 0.85);
  return s;
}), { attack: 0.001, release: 0.3 }));
// --- ブラス ---
P.push(preset('Synth Brass', 61, zones(R6, (r, top, s) => wideLoop('brs', r, Math.min(top, 84), SUPER7(0.3), { side: s }), { attack: 0.04, decay: 0.3, sustain: 60, release: 0.15, attenuation: 50, filterHz: 3000 }, { stereo: true, spread: 300 })));
P.push(preset('Brass Stab', 62, zones(R6, (r, top, s) => shot('stb' + s, r, top, 0.7, SUPER7(0.5), { cut: (t) => 800 + 5000 * Math.exp(-t * 6), res: 0.25, amp: (t) => Math.exp(-t * 4) }),
  { attack: 0.003, release: 0.15, attenuation: 50 }, { stereo: true, spread: 300 })));
// --- 笛っぽい音（木管・笛の代わり） ---
P.push(preset('Synth Flute', 73, zones(R6, (r, top) => wideLoop('flt', r, top, [{ cents: 0, amp: 1, kind: 'sine' }, { cents: 0, amp: 0.25, kind: 'tri' }, { cents: 0, amp: 0.1, oct: 1, kind: 'sine' }], { dur: 1 })),
  { attack: 0.04, release: 0.15, attenuation: 20 }));
P.push(preset('Synth Reed', 65, zones(R6, (r, top) => wideLoop('red', r, Math.min(top, 84), [{ cents: 0, amp: 1, kind: 'sq' }, { cents: 5, amp: 0.4, kind: 'saw' }], { dur: 1 })),
  { attack: 0.02, release: 0.12, attenuation: 50, filterHz: 3000 }));
// --- リード（歌メロに向く） ---
P.push(preset('Square Lead', 80, zones(R8, (r, top, s) => wideLoop('sql', r, top, [{ cents: -6, amp: 1, kind: 'sq' }, { cents: 6, amp: 1, kind: 'sq' }], { dur: 1, side: s }), { attack: 0.004, release: 0.1, attenuation: 50 }, { stereo: true, spread: 250 })));
P.push(preset('Saw Lead', 81, zones(R8, (r, top, s) => wideLoop('swl', r, top, [{ cents: -9, amp: 1 }, { cents: 0, amp: 1 }, { cents: 9, amp: 1 }, { cents: 0, amp: 0.4, oct: -1, kind: 'sq' }], { dur: 1, side: s }), { attack: 0.004, release: 0.12, attenuation: 60 }, { stereo: true, spread: 250 })));
P.push(preset('Soft Lead', 82, zones(R8, (r, top) => wideLoop('sfl', r, top, [{ cents: 0, amp: 1, kind: 'tri' }, { cents: 4, amp: 0.5, kind: 'saw' }], { dur: 1 }), { attack: 0.02, release: 0.15, attenuation: 40, filterHz: 3500 })));
P.push(preset('Chip Lead', 84, zones(R8, (r, top) => wideLoop('chl', r, top, [{ cents: 0, amp: 1, kind: 'sq' }], { dur: 1 }), { attack: 0.002, release: 0.06, attenuation: 70 })));
P.push(preset('Voice Lead', 85, zones(R8, (r, top, s) => wideLoop('vld', r, top, [{ cents: 0, amp: 1, kind: 'saw' }, { cents: 0, amp: 0.8, kind: 'sine' }, { cents: 7, amp: 0.5, kind: 'tri' }], { dur: 1, side: s }), { attack: 0.01, release: 0.12, attenuation: 50, filterHz: 2600 }, { stereo: true, spread: 200 })));
P.push(preset('Fifth Lead', 86, zones(R8, (r, top) => wideLoop('5th', r, top, [{ cents: 0, amp: 1 }, { cents: 702, amp: 0.7 }], { dur: 1 }), { attack: 0.004, release: 0.1, attenuation: 60 })));
P.push(preset('Bass+Lead', 87, zones(R8, (r, top) => wideLoop('bld', r, top, [{ cents: 0, amp: 1 }, { cents: 0, amp: 0.8, oct: -1, kind: 'sq' }], { dur: 1 }), { attack: 0.003, release: 0.1, attenuation: 60, filterHz: 4000 })));
// --- パッド ---
P.push(preset('Warm Pad', 89, zones(R6, (r, top, s) => wideLoop('wpd', r, Math.min(top, 72), SUPER7(0.35).map((v) => ({ ...v, kind: 'tri' })), { side: s }), { attack: 0.5, release: 1.4, attenuation: 50 }, { stereo: true })));
P.push(preset('Poly Synth', 90, zones(R6, (r, top, s) => shot('ply' + s, r, top, 1.8, SUPER7(0.4), { cut: (t) => 900 + 4000 * Math.exp(-t * 3), res: 0.3, amp: (t) => 0.4 + 0.6 * Math.exp(-t * 2) }),
  { attack: 0.005, release: 0.4, attenuation: 50 }, { stereo: true })));
P.push(preset('Space Pad', 91, zones(R6, (r, top, s) => wideLoop('spd', r, Math.min(top, 84), [{ cents: -8, amp: 1, kind: 'sine' }, { cents: 8, amp: 1, kind: 'tri' }, { cents: 3, amp: 0.5, oct: 1, kind: 'sine' }, { cents: -4, amp: 0.3, oct: 2, kind: 'sine' }], { dur: 2, side: s }), { attack: 1.0, release: 2.0, attenuation: 40 }, { stereo: true })));
P.push(preset('Sweep Pad', 95, zones(R6, (r, top, s) => shot('swp' + s, r, top, 4, SUPER7(0.5), { cut: (t) => 300 + 3000 * (0.5 - 0.5 * Math.cos(t * 1.6)), res: 0.5, amp: (t) => Math.min(1, t * 2) }),
  { attack: 0.3, release: 1.0, attenuation: 50 }, { stereo: true })));
// --- 効果音 ---
P.push(preset('Riser', 98, zones([60], (r) => {
  const N = Math.round(4 * RATE), d = new Float32Array(N);
  for (let n = 0; n < N; n++) { const t = n / RATE; d[n] = rnd() * (t / 4) ** 2; }
  const y = svfLow(d, (t) => 300 + 9000 * (t / 4) ** 2, 0.6);
  return { name: 'riser', data: normalize(y), rate: RATE, root: r, corr: 0, loop: null };
}), { attack: 0.01, release: 0.5 }));

// ================= ドラム（808風・909風・EDM） =================
const shotD = (name, dur, gen) => {
  const N = Math.round(dur * RATE), d = new Float32Array(N);
  for (let n = 0; n < N; n++) d[n] = gen(n / RATE, n);
  const fade = Math.round(0.005 * RATE);
  for (let i = 0; i < fade; i++) d[N - 1 - i] *= i / fade;
  return { name, data: normalize(d), rate: RATE, root: 60, corr: 0, loop: null };
};
const sweepPh = (t, f1, f2, k) => f1 * t + ((f2 - f1) / k) * (1 - Math.exp(-t * k));
const noiseBuf = (dur) => Float32Array.from({ length: Math.round(dur * RATE) }, () => rnd());
const hpf = (x, fc) => { const a = Math.exp((-2 * Math.PI * fc) / RATE); let px = 0, py = 0; return x.map((v) => { py = a * (py + v - px); px = v; return py; }); };
const bpf = (x, fc, Q = 1.5) => { const w = (2 * Math.PI * fc) / RATE, al = Math.sin(w) / (2 * Q), b0 = al, a0 = 1 + al, a1 = -2 * Math.cos(w), a2 = 1 - al; let x1 = 0, x2 = 0, y1 = 0, y2 = 0; return x.map((v) => { const y = (b0 * v - b0 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = v; y2 = y1; y1 = y; return y; }); };
const metal = (t) => [205.3, 304.4, 369.6, 522.7, 540, 800].reduce((s, f) => s + (Math.sin(2 * Math.PI * f * t * 2.2) > 0 ? 1 : -1), 0) / 6;
const metalBuf = (dur) => hpf(Float32Array.from({ length: Math.round(dur * RATE) }, (_, n) => metal(n / RATE)), 6000);

// 808：長く伸びる「ドゥーン」というバスドラ
const kick808 = shotD('k808', 1.4, (t) => Math.tanh(1.6 * Math.sin(2 * Math.PI * sweepPh(t, 47, 140, 22))) * Math.exp(-t * 2.4));
// 909：アタックの「カッ」と太い胴（ユーロビート・EDMの4つ打ち）
const nk = noiseBuf(0.02);
const kick909 = shotD('k909', 0.55, (t, n) => Math.tanh(2.2 * Math.sin(2 * Math.PI * sweepPh(t, 52, 240, 35))) * Math.exp(-t * 6) + (n < nk.length ? 0.5 * nk[n] * (1 - n / nk.length) : 0));
// EDM：低く長く、少し歪ませたバスドラ
const kickEdm = shotD('kEdm', 0.8, (t) => Math.tanh(3 * Math.sin(2 * Math.PI * sweepPh(t, 45, 320, 45))) * Math.exp(-t * 4.5));
const sn1 = noiseBuf(0.4);
const snare909 = shotD('s909', 0.35, (t, n) => 0.8 * sn1[n] * Math.exp(-t * 13) + 0.7 * Math.sin(2 * Math.PI * sweepPh(t, 180, 260, 40)) * Math.exp(-t * 22));
const sn2 = hpf(noiseBuf(0.3), 1500);
const snare808 = shotD('s808', 0.25, (t, n) => 0.6 * sn2[n] * Math.exp(-t * 18) + 0.8 * (Math.sin(2 * Math.PI * 238 * t) + 0.6 * Math.sin(2 * Math.PI * 476 * t)) * Math.exp(-t * 20));
// クラップ：何人かの手拍子がずれて重なる感じ＋短い響き
const cl = bpf(noiseBuf(0.6), 1200, 1.2);
const clap = shotD('clap', 0.6, (t, n) => {
  const bursts = [0, 0.009, 0.018, 0.027].reduce((s, o) => s + (t >= o ? Math.exp(-(t - o) * 140) : 0), 0);
  return cl[n] * (bursts + 0.5 * (t > 0.027 ? Math.exp(-(t - 0.027) * 9) : 0));
});
const hh = metalBuf(0.6);
const hatC = shotD('hatC', 0.09, (t, n) => hh[n] * Math.exp(-t * 55));
const hatP = shotD('hatP', 0.15, (t, n) => hh[n] * Math.exp(-t * 30));
const hatO = shotD('hatO', 0.6, (t, n) => hh[n] * Math.exp(-t * 6.5));
const cr = hpf(noiseBuf(2.5), 3000);
const crash = shotD('crash', 2.5, (t, n) => (0.6 * cr[n] + 0.4 * metal(t * 1.3)) * Math.exp(-t * 1.6));
const ride = shotD('ride', 1.5, (t, n) => (0.5 * cr[n] * 0.5 + 0.6 * metal(t * 0.9)) * Math.exp(-t * 2.5));
const tom = shotD('tom', 0.6, (t) => Math.sin(2 * Math.PI * sweepPh(t, 100, 180, 18)) * Math.exp(-t * 6));
const cow = shotD('cow', 0.35, (t) => (Math.sign(Math.sin(2 * Math.PI * 540 * t)) + Math.sign(Math.sin(2 * Math.PI * 800 * t))) * Math.exp(-t * 13));
const rim = shotD('rim', 0.06, (t) => Math.sin(2 * Math.PI * 1700 * t) * Math.exp(-t * 80) + 0.4 * Math.sin(2 * Math.PI * 450 * t) * Math.exp(-t * 60));
const shaker = shotD('shk', 0.12, (t, n) => sn2[n] * Math.sin(Math.PI * Math.min(1, t / 0.12)) ** 2);
const revCym = { ...shotD('rev', 1.5, (t, n) => cr[n] * Math.exp(-(1.5 - t) * 2.5) * Math.min(1, (1.5 - t) * 40)), name: 'revcym' };
const noiseHit = shotD('zap', 0.3, (t) => Math.sin(2 * Math.PI * sweepPh(t, 200, 2000, 30)) * Math.exp(-t * 12));

function kit(name, program, kick, snare) {
  const map = [
    [[27, 34], rim], [35, kick, { rootKey: 35 }], [36, kick], [37, rim], [38, snare], [39, clap], [40, snare, { rootKey: 41 }],
    [41, tom, { rootKey: 41 + 5 }], [42, hatC, { exclusiveClass: 1 }], [43, tom, { rootKey: 43 + 2 }], [44, hatP, { exclusiveClass: 1 }],
    [45, tom], [46, hatO, { exclusiveClass: 1 }], [47, tom, { rootKey: 44 }], [48, tom, { rootKey: 42 }], [49, crash],
    [50, tom, { rootKey: 40 }], [51, ride], [52, crash, { rootKey: 50 }], [53, ride, { rootKey: 50 }], [54, shaker], [55, crash, { rootKey: 43 }],
    [56, cow], [57, crash, { rootKey: 54 }], [58, noiseHit], [59, ride, { rootKey: 57 }], [[60, 68], rim, { rootKey: 72 }], [69, shaker], [70, shaker, { rootKey: 66 }],
    [[71, 80], rim, { rootKey: 70 }], [81, hatC, { rootKey: 70 }], [82, shaker, { rootKey: 76 }], [[83, 86], noiseHit], [87, revCym],
  ];
  const zonesK = map.map(([keys, sample, g = {}]) => {
    const [lo, hi] = Array.isArray(keys) ? keys : [keys, keys];
    return { keyLo: lo, keyHi: hi, sample, gens: { release: 0.4, rootKey: g.rootKey ?? (lo === hi ? lo : 60), ...g } };
  });
  return preset(name, program, zonesK, 128);
}
P.push(kit('EDM Kit', 0, kickEdm, snare909));
P.push(kit('909 Kit', 24, kick909, snare909));
P.push(kit('808 Kit', 25, kick808, snare808));
P.push(kit('Dance Kit', 26, kick909, snare808));

// 同じ音を2回作らないように、名前が同じ音はまとめる
const uniq = new Map();
for (const p of P) for (const z of p.zones) {
  const k = z.sample.name + z.sample.data.length;
  if (uniq.has(k)) z.sample = uniq.get(k); else uniq.set(k, z.sample);
}
const bytes = writeSf2({ name: 'MIDI Studio Changer EDM', copyright: 'CC0 1.0 (MIDI Studio Changer)', comment: 'Electronic dance instruments (supersaw, pluck, acid, 808/909) generated by code.', presets: P });
writeFileSync(new URL('../soundfonts/midichen-edm.sf2', import.meta.url), bytes);
console.log('midichen-edm.sf2', P.length, 'presets', uniq.size, 'samples', (bytes.length / 1048576).toFixed(1), 'MB');
