// 録音された本物の楽器の音（CC0 / CC-BY のサンプル集）から、軽いサウンドフォントを作るスクリプト。
//
//   - オーケストラ：VS Chamber Orchestra 2 Community Edition（CC0） https://github.com/sgossner/VSCO-2-CE
//   - ジャズ・ピアノトリオ：
//       ピアノ Salamander Grand Piano V3（CC-BY 3.0, Alexander Holm） https://github.com/sfzinstruments/SalamanderGrandPiano
//       ウッドベース VSCO-2-CE（CC0）
//       ドラム Virtuosity Drums（CC0） https://github.com/sfzinstruments/virtuosity_drums
//
// 使い方：
//   node tools/build-sample-soundfonts.mjs <取得用フォルダ>
//   （取得用フォルダに上の3つのリポジトリを git clone --filter=blob:none した vsco / sal / vd を置く）
// 必要なもの：git, ffmpeg
//
// 容量を抑えるため：ラウンドロビンは1つだけ・強さの段階は少なめ・モノラル・長い音は切ってループにする。
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { writeSf2 } from './sf2-writer.mjs';

const EXT = process.argv[2];
if (!EXT) { console.error('usage: node tools/build-sample-soundfonts.mjs <ext-dir>'); process.exit(1); }
const OUT = new URL('../soundfonts/', import.meta.url);

// ---------- サンプルの取り出し ----------
function checkout(repo, paths) {
  const missing = paths.filter((p) => !existsSync(join(EXT, repo, p)));
  for (let i = 0; i < missing.length; i += 200) {
    execFileSync('git', ['-C', join(EXT, repo), 'checkout', '-q', 'HEAD', '--', ...missing.slice(i, i + 200)], { stdio: 'inherit' });
  }
}

function decode(file, rate) {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength >> 2).slice();
}

const noteNum = (name) => {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) return null;
  const pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return (Number(m[3]) + 1) * 12 + pc;
};

/**
 * 音を整える。
 * loop: 伸ばす楽器 → 後半を自然につながるループにする（クロスフェード）
 * それ以外 → maxLen 秒で切って最後をフェードアウト
 */
function shape(data, rate, { maxLen, loop, trimStart = true }) {
  let start = 0;
  if (trimStart) {
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v));
    const th = peak * 0.004;
    while (start < data.length - 1 && Math.abs(data[start]) < th) start++;
    start = Math.max(0, start - Math.round(rate * 0.003));
  }
  let d = data.subarray(start, Math.min(data.length, start + Math.round(maxLen * rate)));
  d = Float32Array.from(d);
  if (loop && d.length > rate * 0.6) {
    const S = Math.round(d.length * 0.42);
    const E = d.length - Math.round(rate * 0.02);
    const X = Math.min(Math.round(rate * 0.25), Math.floor((E - S) / 3));
    // ループの終わりを、ループの始まりの手前の音へ少しずつ混ぜて、つなぎ目を消す
    for (let i = 0; i < X; i++) {
      const w = i / X;
      d[E - X + i] = d[E - X + i] * (1 - w) + d[S - X + i] * w;
    }
    return { data: d, loop: [S, E] };
  }
  const fade = Math.min(d.length, Math.round(rate * 0.25));
  for (let i = 0; i < fade; i++) d[d.length - 1 - i] *= i / fade;
  return { data: d, loop: null };
}

// ---------- SFZ（VSCO）の読み取り ----------
function parseSfz(text) {
  const regions = [];
  let control = {}, global = {}, group = {}, cur = null, section = null;
  const flush = () => { if (cur) regions.push({ ...global, ...group, ...cur, _path: control.default_path || '' }); cur = null; };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    const re = /<(\w+)>|(\w+)=(.*?)(?=\s+\w+=|\s*<\w+>|$)/g;
    let m;
    while ((m = re.exec(line))) {
      if (m[1]) {
        flush();
        section = m[1];
        if (section === 'group') group = {};
        if (section === 'global') global = {};
        if (section === 'region') cur = {};
        continue;
      }
      const tgt = section === 'region' ? cur : section === 'group' ? group : section === 'global' ? global : control;
      if (tgt) tgt[m[2]] = m[3].trim();
    }
  }
  flush();
  return regions;
}

/** VSCO の楽器（SFZ）からゾーンを作る。keyMin/keyMax で音域を切り出せる */
function vscoZones(sfz, { keyMin = 0, keyMax = 127, layers = 1, maxLen = 3, loop = false, rate = 24000, gens = {}, trimStart = true }) {
  const text = (() => { checkout('vsco', [sfz]); return readFileSync(join(EXT, 'vsco', sfz), 'latin1'); })();
  let regs = parseSfz(text).filter((r) => r.sample && (!r.seq_position || r.seq_position === '1') && (!r.lorand || Number(r.lorand) === 0));
  regs = regs.map((r) => ({
    path: (r._path + r.sample).replace(/\\/g, '/'),
    lo: Number(r.lokey ?? r.key), hi: Number(r.hikey ?? r.key), center: Number(r.pitch_keycenter ?? r.key ?? r.lokey),
    vlo: Number(r.lovel ?? 0), vhi: Number(r.hivel ?? 127), vol: Number(r.volume ?? 0) + Number(r.group_volume ?? 0),
    tune: Number(r.tune ?? 0),
  })).filter((r) => r.hi >= keyMin && r.lo <= keyMax);
  // 強さの段階を減らす：音域ごとに、上から layers 個だけ残す
  const byKey = new Map();
  for (const r of regs) {
    const k = `${r.lo}-${r.hi}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  const keep = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => b.vhi - a.vhi);
    const chosen = list.slice(0, layers).sort((a, b) => a.vlo - b.vlo);
    chosen.forEach((r, i) => {
      r.vlo = i === 0 ? 0 : chosen[i - 1].vhi + 1;
      if (i === chosen.length - 1) r.vhi = 127;
      keep.push(r);
    });
  }
  checkout('vsco', [...new Set(keep.map((r) => r.path))]);
  return keep.map((r) => ({
    keyLo: Math.max(r.lo, keyMin), keyHi: Math.min(r.hi, keyMax), velLo: r.vlo, velHi: r.vhi,
    raw: () => decode(join(EXT, 'vsco', r.path), rate), center: r.center, tune: r.tune, gain: 10 ** (r.vol / 20),
    rate, maxLen, loop, trimStart, gens,
  }));
}

/** ゾーンの音を読み込み・整えて、楽器全体で音量をそろえる */
function realize(name, zones, attenuation = 0) {
  const shaped = zones.map((z, i) => {
    const raw = z.raw();
    for (let k = 0; k < raw.length; k++) raw[k] *= z.gain;
    const s = shape(raw, z.rate, z);
    return { z, s, i };
  });
  let peak = 0;
  for (const { s } of shaped) for (const v of s.data) peak = Math.max(peak, Math.abs(v));
  const k = peak ? 0.9 / peak : 1;
  return shaped.map(({ z, s, i }) => {
    for (let j = 0; j < s.data.length; j++) s.data[j] *= k;
    const sample = { name: `${name}${i}`.slice(0, 19), data: s.data, rate: z.rate, root: z.center, corr: Math.round(-z.tune) || 0, loop: s.loop };
    return { keyLo: z.keyLo, keyHi: z.keyHi, velLo: z.velLo, velHi: z.velHi, sample, gens: { attenuation, ...z.gens } };
  });
}

const preset = (name, program, zones, bank = 0) => ({ name, program, bank, zones });
const SUS = { loop: true, maxLen: 2.6, gens: { attack: 0.04, release: 0.5 } };

// ================= オーケストラ =================
function orchestra() {
  const P = [];
  const add = (name, program, parts, att = 0) => {
    const zones = parts.flatMap(([sfz, opt]) => vscoZones(sfz, opt));
    P.push(preset(name, program, realize(name.replace(/\W/g, '').slice(0, 8), zones, att)));
    console.log('  ', program, name, zones.length, 'zones');
  };
  const strings = (attack, rel) => ({ ...SUS, gens: { attack, release: rel } });
  // 合奏の弦：低い音はチェロ、真ん中はビオラ、高い音はバイオリン
  add('Orchestra Strings', 48, [
    ['CelloEnsSusVib.sfz', { ...strings(0.08, 0.6), keyMax: 54 }],
    ['ViolaEnsSusVib.sfz', { ...strings(0.08, 0.6), keyMin: 55, keyMax: 62 }],
    ['ViolinEnsSusVib.sfz', { ...strings(0.08, 0.6), keyMin: 63 }],
  ]);
  add('Slow Strings', 49, [
    ['CelloEnsSusVib-Quiet.sfz', { ...strings(0.4, 1.0), keyMax: 54 }],
    ['ViolaEnsSusVib-Quiet.sfz', { ...strings(0.4, 1.0), keyMin: 55, keyMax: 62 }],
    ['ViolinEnsSusVib-Quiet.sfz', { ...strings(0.4, 1.0), keyMin: 63 }],
  ]);
  add('Solo Violin', 40, [['SViolinVib.sfz', strings(0.05, 0.4)]]);
  add('Viola', 41, [['ViolaEnsSusVib.sfz', strings(0.06, 0.5)]]);
  add('Cello', 42, [['CelloEnsSusVib.sfz', strings(0.06, 0.5)]]);
  add('Contrabass', 43, [['ContrabassSusVB.sfz', strings(0.06, 0.5)]]);
  add('Tremolo Strings', 44, [
    ['CelloEnsTrem.sfz', { ...SUS, keyMax: 57 }],
    ['ViolinEnsTrem.sfz', { ...SUS, keyMin: 58 }],
  ]);
  add('Pizzicato', 45, [
    ['CelloEnsPizz.sfz', { maxLen: 1.2, keyMax: 57 }],
    ['ViolinEnsPizz.sfz', { maxLen: 1.0, keyMin: 58 }],
  ]);
  add('Harp', 46, [['Harp.sfz', { maxLen: 2.5, gens: { release: 0.8 } }]]);
  add('Timpani', 47, [['Timpani.sfz', { maxLen: 2.5, gens: { release: 1 } }]]);
  add('Trumpet', 56, [['TrumpetSus.sfz', { ...SUS, gens: { attack: 0.02, release: 0.3 } }]]);
  add('Trombone', 57, [['TromboneSus.sfz', { ...SUS, gens: { attack: 0.02, release: 0.3 } }]]);
  add('Tuba', 58, [['TubaSus.sfz', { ...SUS, gens: { attack: 0.02, release: 0.3 } }]]);
  add('Muted Trumpet', 59, [['TrumpetStraightMuteSus.sfz', { ...SUS, gens: { attack: 0.02, release: 0.3 } }]]);
  add('French Horn', 60, [['FHornSus.sfz', { ...SUS, gens: { attack: 0.04, release: 0.4 } }]]);
  add('Brass Section', 61, [
    ['TromboneSus.sfz', { ...SUS, keyMax: 52, gens: { attack: 0.03, release: 0.35 } }],
    ['FHornSus.sfz', { ...SUS, keyMin: 53, keyMax: 64, gens: { attack: 0.03, release: 0.35 } }],
    ['TrumpetSus.sfz', { ...SUS, keyMin: 65, gens: { attack: 0.03, release: 0.35 } }],
  ]);
  add('Oboe', 68, [['OboeSusVib.sfz', { ...SUS, gens: { attack: 0.03, release: 0.25 } }]]);
  add('Bassoon', 70, [['BassoonSus.sfz', { ...SUS, gens: { attack: 0.03, release: 0.25 } }]]);
  add('Clarinet', 71, [['ClarinetSus.sfz', { ...SUS, gens: { attack: 0.03, release: 0.25 } }]]);
  add('Piccolo', 72, [['PiccoloSus.sfz', { ...SUS, gens: { attack: 0.03, release: 0.25 } }]]);
  add('Flute', 73, [['FluteSusVib.sfz', { ...SUS, gens: { attack: 0.04, release: 0.3 } }]]);
  add('Glockenspiel', 9, [['Glockenspiel.sfz', { maxLen: 2.5, rate: 32000, gens: { release: 1 } }]]);
  add('Marimba', 12, [['Marimba.sfz', { maxLen: 1.5, gens: { release: 0.5 } }]]);
  add('Xylophone', 13, [['Xylophone.sfz', { maxLen: 1.0, rate: 32000, gens: { release: 0.3 } }]]);
  add('Tubular Bells', 14, [['TubularBells.sfz', { maxLen: 3, gens: { release: 1.5 } }]]);
  add('Church Organ', 19, [['OrganLoud.sfz', { ...SUS, gens: { attack: 0.05, release: 0.4 } }]]);
  add('Upright Piano', 0, [['UprightPiano.sfz', { maxLen: 3.5, layers: 2, rate: 32000, gens: { release: 0.4 } }]]);
  add('Pizz Bass', 32, [['ContrabassPizz.sfz', { maxLen: 1.6, layers: 2, gens: { release: 0.3 } }]]);
  // 打楽器（GM配置）：大太鼓・スネア・シンバル・ティンパニなど
  const kitZones = vscoZones('GM-StylePerc.sfz', { maxLen: 2.5, rate: 32000, trimStart: false, gens: { release: 1.5 } })
    .map((z) => ({ ...z, center: z.keyLo === z.keyHi ? z.keyLo : z.center }));
  P.push(preset('Orchestra Perc', 0, realize('perc', kitZones), 128));
  console.log('   kit', kitZones.length, 'zones');
  return writeSf2({
    name: 'MIDI Studio Changer Orchestra',
    copyright: 'Samples: VS Chamber Orchestra 2 Community Edition (CC0 1.0, Versilian Studios)',
    comment: 'Built from VSCO-2-CE samples by MIDI Studio Changer. CC0 1.0.',
    presets: P,
  });
}

// ================= ジャズ・ピアノトリオ =================
function jazz() {
  const P = [];
  // Salamander：短3度ごとに録音。強さは 3段階（v4・v9・v14）だけ使う
  const files = execFileSync('git', ['-C', join(EXT, 'sal'), 'ls-tree', '-r', '--name-only', 'HEAD', 'Samples'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const notes = [...new Set(files.map((f) => /Samples\/([A-G]#?\d)v\d+\.flac/.exec(f)?.[1]).filter(Boolean))]
    .map((n) => ({ n, key: noteNum(n) })).sort((a, b) => a.key - b.key);
  const LAYERS = [[4, 0, 52], [9, 53, 96], [14, 97, 127]];
  checkout('sal', notes.flatMap(({ n }) => LAYERS.map(([v]) => `Samples/${n}v${v}.flac`)));
  const pz = [];
  notes.forEach(({ n, key }, i) => {
    const lo = i === 0 ? 0 : Math.floor((notes[i - 1].key + key) / 2) + 1;
    const hi = i === notes.length - 1 ? 127 : Math.floor((key + notes[i + 1].key) / 2);
    const maxLen = key < 48 ? 6 : key < 72 ? 4.5 : 3;
    for (const [v, vlo, vhi] of LAYERS) {
      pz.push({ keyLo: lo, keyHi: hi, velLo: vlo, velHi: vhi, center: key, tune: 0, gain: 1, rate: 32000, maxLen, loop: false, trimStart: true,
        raw: () => decode(join(EXT, 'sal', `Samples/${n}v${v}.flac`), 32000), gens: { release: 0.35 } });
    }
  });
  const piano = realize('grand', pz);
  P.push(preset('Grand Piano', 0, piano));
  P.push(preset('Bright Grand', 1, piano.map((z) => ({ ...z, gens: { ...z.gens, attenuation: 0 } }))));
  console.log('   piano', pz.length, 'zones');
  P.push(preset('Wood Bass', 32, realize('wbass', vscoZones('ContrabassPizz.sfz', { maxLen: 2.2, layers: 2, gens: { release: 0.25 } }))));

  // Virtuosity Drums（mid マイク）
  const D = (art, vl, extra = '_rr1') => `Samples/mid/${art.split('_')[0]}/mid_${art}_vl${vl}${extra}.flac`;
  const kit = [
    // [GMキー, ファイル, 強さの範囲, 長さ]
    [[35, 36], D('kick_snon', 2), [0, 90], 0.9], [[35, 36], D('kick_snon', 4), [91, 127], 0.9],
    [37, D('snare_crossstick', 2), [0, 127], 0.5],
    [[38, 38], D('snare_center', 3), [0, 90], 1.0], [[38, 38], D('snare_center', 6), [91, 127], 1.0],
    [39, D('snare_rimshot', 2), [0, 127], 0.8],
    [40, D('snare_offcenter', 5), [0, 127], 1.0],
    [42, D('hh_closed', 2), [0, 127], 0.5, 1], [44, D('hh_pedal', 2), [0, 127], 0.6, 1], [46, D('hh_open', 2), [0, 127], 1.8, 1],
    [[41, 43], D('ltom_center', 8, ''), [0, 127], 1.4], [[45, 47], D('ltom_center', 8, ''), [0, 127], 1.4],
    [[48, 50], D('htom_center', 8, ''), [0, 127], 1.2],
    [[49, 49], D('crash_crash', 2), [0, 127], 3.0], [57, D('crash_crash', 3), [0, 127], 3.0], [52, D('crash_sizzle', 2), [0, 127], 3.0],
    [[51, 51], D('ride_ride', 2), [0, 127], 2.5], [59, D('ride_ride', 3), [0, 127], 2.5], [53, D('ride_bell', 2), [0, 127], 2.5],
    [55, D('flatride_crash', 1), [0, 127], 2.5],
  ];
  checkout('vd', kit.map((k) => k[1]));
  const kz = kit.map(([keys, file, [vlo, vhi], maxLen, excl]) => {
    const [lo, hi] = Array.isArray(keys) ? keys : [keys, keys];
    const center = lo === 41 ? 43 : lo === 45 ? 47 : lo === 48 ? 50 : lo;
    return { keyLo: lo, keyHi: hi, velLo: vlo, velHi: vhi, center, tune: 0, gain: 1, rate: 32000, maxLen, loop: false, trimStart: false,
      raw: () => decode(join(EXT, 'vd', file), 32000), gens: { release: 0.8, ...(excl ? { exclusiveClass: 1 } : {}) } };
  });
  P.push(preset('Jazz Kit', 0, realize('jkit', kz), 128));
  console.log('   drums', kz.length, 'zones');
  return writeSf2({
    name: 'MIDI Studio Changer Jazz Trio',
    copyright: 'Piano: Salamander Grand Piano V3 by Alexander Holm (CC-BY 3.0). Bass: VSCO-2-CE (CC0). Drums: Virtuosity Drums (CC0).',
    comment: 'Built by MIDI Studio Changer. Attribution required for the piano samples (CC-BY 3.0).',
    presets: P,
  });
}

for (const [file, fn] of [['midichen-orchestra.sf2', orchestra], ['midichen-jazz.sf2', jazz]]) {
  console.log(file);
  const bytes = fn();
  writeFileSync(new URL(file, OUT), bytes);
  console.log(file, (bytes.length / 1048576).toFixed(1), 'MB');
}
