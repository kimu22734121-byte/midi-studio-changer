// SoundFont 2（.sf2）ファイルの読み込み。音を鳴らすのに必要な情報を「リージョン」の形にまとめる。
// DOM・Web Audio には依存しない（Node でもテストできる）。

const G = {
  startAddrsOffset: 0, endAddrsOffset: 1, startloopAddrsOffset: 2, endloopAddrsOffset: 3,
  startAddrsCoarseOffset: 4, initialFilterFc: 8, initialFilterQ: 9, endAddrsCoarseOffset: 12,
  pan: 17, delayVolEnv: 33, attackVolEnv: 34, holdVolEnv: 35, decayVolEnv: 36, sustainVolEnv: 37,
  releaseVolEnv: 38, instrument: 41, keyRange: 43, velRange: 44, startloopAddrsCoarseOffset: 45,
  initialAttenuation: 48, endloopAddrsCoarseOffset: 50, coarseTune: 51, fineTune: 52, sampleID: 53,
  sampleModes: 54, scaleTuning: 56, exclusiveClass: 57, overridingRootKey: 58,
};
const DEFAULTS = {
  [G.initialFilterFc]: 13500, [G.delayVolEnv]: -12000, [G.attackVolEnv]: -12000, [G.holdVolEnv]: -12000,
  [G.decayVolEnv]: -12000, [G.releaseVolEnv]: -12000, [G.scaleTuning]: 100, [G.overridingRootKey]: -1,
};
// プリセット側では足し算しないもの
const NON_ADDITIVE = new Set([G.keyRange, G.velRange, G.instrument, G.sampleID, G.sampleModes, G.exclusiveClass,
  G.overridingRootKey, G.startAddrsOffset, G.endAddrsOffset, G.startloopAddrsOffset, G.endloopAddrsOffset,
  G.startAddrsCoarseOffset, G.endAddrsCoarseOffset, G.startloopAddrsCoarseOffset, G.endloopAddrsCoarseOffset]);

function readChunks(dv, start, end) {
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    const id = String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3));
    const size = dv.getUint32(p + 4, true);
    const body = p + 8;
    let type = null;
    if (id === 'LIST' || id === 'RIFF') type = String.fromCharCode(dv.getUint8(body), dv.getUint8(body + 1), dv.getUint8(body + 2), dv.getUint8(body + 3));
    out.push({ id, type, start: body, size, end: Math.min(end, body + size) });
    p = body + size + (size & 1);
  }
  return out;
}

const cstr = (u8, p, n) => {
  let e = p;
  while (e < p + n && u8[e]) e++;
  return new TextDecoder('latin1').decode(u8.subarray(p, e)).trim();
};

export function parseSf2(arrayBuffer) {
  const buf = ArrayBuffer.isView(arrayBuffer) ? arrayBuffer.buffer.slice(arrayBuffer.byteOffset, arrayBuffer.byteOffset + arrayBuffer.byteLength) : arrayBuffer;
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const [riff] = readChunks(dv, 0, buf.byteLength);
  if (!riff || riff.id !== 'RIFF' || riff.type !== 'sfbk') throw new Error('サウンドフォント（.sf2）ではないようです');
  const lists = readChunks(dv, riff.start + 4, riff.end);
  const find = (type) => lists.find((c) => c.id === 'LIST' && c.type === type);
  const info = find('INFO'), sdta = find('sdta'), pdta = find('pdta');
  if (!sdta || !pdta) throw new Error('サウンドフォントの中身が読めませんでした');

  let name = '';
  if (info) for (const c of readChunks(dv, info.start + 4, info.end)) if (c.id === 'INAM') name = cstr(u8, c.start, c.size);

  const smpl = readChunks(dv, sdta.start + 4, sdta.end).find((c) => c.id === 'smpl');
  if (!smpl) throw new Error('この形式（音が圧縮されたSF3など）にはまだ対応していません');
  const pcm = smpl.start % 2 === 0 ? new Int16Array(buf, smpl.start, smpl.size >> 1) : new Int16Array(buf.slice(smpl.start, smpl.start + (smpl.size & ~1)));

  const P = {};
  for (const c of readChunks(dv, pdta.start + 4, pdta.end)) P[c.id] = c;
  const recs = (id, size, fn) => {
    const c = P[id];
    const n = Math.floor(c.size / size);
    const out = [];
    for (let i = 0; i < n; i++) out.push(fn(c.start + i * size));
    return out;
  };
  const phdr = recs('phdr', 38, (p) => ({ name: cstr(u8, p, 20), program: dv.getUint16(p + 20, true), bank: dv.getUint16(p + 22, true), bag: dv.getUint16(p + 24, true) }));
  const pbag = recs('pbag', 4, (p) => dv.getUint16(p, true));
  const gen = (p) => ({ op: dv.getUint16(p, true), amt: dv.getInt16(p + 2, true), lo: dv.getUint8(p + 2), hi: dv.getUint8(p + 3) });
  const pgen = recs('pgen', 4, gen);
  const inst = recs('inst', 22, (p) => ({ name: cstr(u8, p, 20), bag: dv.getUint16(p + 20, true) }));
  const ibag = recs('ibag', 4, (p) => dv.getUint16(p, true));
  const igen = recs('igen', 4, gen);
  const shdr = recs('shdr', 46, (p) => ({
    name: cstr(u8, p, 20), start: dv.getUint32(p + 20, true), end: dv.getUint32(p + 24, true),
    loopStart: dv.getUint32(p + 28, true), loopEnd: dv.getUint32(p + 32, true), rate: dv.getUint32(p + 36, true),
    root: dv.getUint8(p + 40), corr: dv.getInt8(p + 41), type: dv.getUint16(p + 44, true),
  }));

  // ゾーン（生成値のまとまり）を作る
  const zonesOf = (bags, gens, from, to, terminal) => {
    const zones = [];
    for (let b = from; b < to; b++) {
      const g = {};
      for (let k = bags[b]; k < bags[b + 1]; k++) {
        const x = gens[k];
        if (x.op === G.keyRange || x.op === G.velRange) g[x.op] = [x.lo, x.hi];
        else g[x.op] = x.amt;
      }
      zones.push(g);
    }
    let global = null;
    if (zones.length && zones[0][terminal] === undefined) global = zones.shift();
    return { global, zones: zones.filter((z) => z[terminal] !== undefined) };
  };

  const instCache = new Map();
  const instZones = (i) => {
    if (!instCache.has(i)) instCache.set(i, zonesOf(ibag, igen, inst[i].bag, inst[i + 1].bag, G.sampleID));
    return instCache.get(i);
  };

  const presets = [];
  for (let i = 0; i < phdr.length - 1; i++) {
    const h = phdr[i];
    const pz = zonesOf(pbag, pgen, h.bag, phdr[i + 1].bag, G.instrument);
    const regions = [];
    for (const z of pz.zones) {
      const pg = { ...(pz.global || {}), ...z };
      const iz = instZones(pg[G.instrument]);
      if (!iz) continue;
      for (const z2 of iz.zones) {
        const g = { ...DEFAULTS, ...(iz.global || {}), ...z2 };
        for (const k in pg) {
          const op = Number(k);
          if (NON_ADDITIVE.has(op)) continue;
          g[op] = (g[op] ?? 0) + pg[k];
        }
        const kr = intersect(pg[G.keyRange], g[G.keyRange]);
        const vr = intersect(pg[G.velRange], g[G.velRange]);
        if (!kr || !vr) continue;
        const s = shdr[g[G.sampleID]];
        if (!s || s.type & 0x8000) continue; // ROMサンプルは使わない
        regions.push(makeRegion(g, s, kr, vr));
      }
    }
    if (regions.length) presets.push({ name: h.name, bank: h.bank, program: h.program, regions });
  }
  presets.sort((a, b) => a.bank - b.bank || a.program - b.program);
  return { name, presets, pcm };
}

function intersect(a = [0, 127], b = [0, 127]) {
  const lo = Math.max(a[0], b[0]), hi = Math.min(a[1], b[1]);
  return lo <= hi ? [lo, hi] : null;
}

const secs = (tc) => (tc <= -12000 ? 0 : 2 ** (tc / 1200));

function makeRegion(g, s, kr, vr) {
  const v = (op) => g[op] ?? 0;
  const start = s.start + v(G.startAddrsOffset) + 32768 * v(G.startAddrsCoarseOffset);
  const end = s.end + v(G.endAddrsOffset) + 32768 * v(G.endAddrsCoarseOffset);
  const loopStart = s.loopStart + v(G.startloopAddrsOffset) + 32768 * v(G.startloopAddrsCoarseOffset);
  const loopEnd = s.loopEnd + v(G.endloopAddrsOffset) + 32768 * v(G.endloopAddrsCoarseOffset);
  const mode = v(G.sampleModes) & 3;
  return {
    keyLo: kr[0], keyHi: kr[1], velLo: vr[0], velHi: vr[1],
    start, end, loopStart: loopStart - start, loopEnd: loopEnd - start,
    loop: (mode === 1 || mode === 3) && loopEnd > loopStart + 4,
    rate: s.rate || 44100,
    root: g[G.overridingRootKey] >= 0 ? g[G.overridingRootKey] : s.root,
    tune: v(G.coarseTune) * 100 + v(G.fineTune) + s.corr,
    scaleTuning: g[G.scaleTuning],
    attenuation: Math.max(0, v(G.initialAttenuation)),
    pan: Math.max(-500, Math.min(500, v(G.pan))),
    delay: secs(g[G.delayVolEnv]), attack: secs(g[G.attackVolEnv]), hold: secs(g[G.holdVolEnv]),
    decay: secs(g[G.decayVolEnv]), sustain: Math.max(0, Math.min(1440, v(G.sustainVolEnv))), release: secs(g[G.releaseVolEnv]),
    filterFc: g[G.initialFilterFc], filterQ: v(G.initialFilterQ),
    exclusiveClass: v(G.exclusiveClass),
  };
}

/** GMの番号で探す（なければ同じ仲間の楽器 → いちばん近い番号） */
export function findPreset(sf, program, isDrum) {
  const bank = isDrum ? 128 : 0;
  const list = sf.presets.filter((p) => p.bank === bank);
  const pool = list.length ? list : sf.presets.filter((p) => p.bank !== 128);
  if (isDrum && !list.length) return null; // ドラムが入っていないセットでは鳴らさない
  if (!pool.length) return sf.presets[0] || null;
  const exact = pool.find((p) => p.program === program);
  if (exact) return exact;
  if (isDrum) return pool[0];
  const fam = pool.filter((p) => (p.program >> 3) === (program >> 3));
  const cand = fam.length ? fam : pool;
  return cand.reduce((a, b) => (Math.abs(b.program - program) < Math.abs(a.program - program) ? b : a));
}
