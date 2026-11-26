// SoundFont 2（.sf2）ファイルを書き出す最小限のライター。
// preset = { name, bank, program, zones: [{ keyLo, keyHi, sample, gens }] }
// sample = { name, data: Float32Array(-1..1), rate, root, corr(セント), loop: [start, end] | null }
// gens  = { attack, hold, decay, release(秒), sustain(cB), attenuation(cB), pan(-500..500),
//           fineTune(セント), coarseTune(半音), filterHz, exclusiveClass, rootKey }

const GEN = {
  keyRange: 43, velRange: 44, instrument: 41, sampleID: 53, sampleModes: 54,
  attack: 34, hold: 35, decay: 36, sustain: 37, release: 38, delay: 33,
  attenuation: 48, pan: 17, coarseTune: 51, fineTune: 52, filterFc: 8, filterQ: 9,
  exclusiveClass: 57, rootKey: 58, scaleTuning: 56,
};
const tc = (sec) => Math.round(1200 * Math.log2(Math.max(sec, 0.001)));

class Buf {
  constructor() { this.parts = []; this.len = 0; }
  bytes(u8) { this.parts.push(u8); this.len += u8.length; }
  u8(v) { this.bytes(Uint8Array.of(v & 255)); }
  u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v & 0xffff, true); this.bytes(b); }
  i16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setInt16(0, v, true); this.bytes(b); }
  u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); this.bytes(b); }
  str(s, n) { const b = new Uint8Array(n); const e = new TextEncoder().encode(s); b.set(e.subarray(0, n - 1)); this.bytes(b); }
  out() { const o = new Uint8Array(this.len); let p = 0; for (const x of this.parts) { o.set(x, p); p += x.length; } return o; }
}

function chunk(id, body) {
  const b = new Buf();
  b.str(id, 5); // 4文字 + 1（あとで切る）
  const head = b.out().subarray(0, 4);
  const o = new Buf();
  o.bytes(head);
  o.u32(body.length);
  o.bytes(body);
  if (body.length % 2) o.u8(0);
  return o.out();
}
function list(type, chunks) {
  const b = new Buf();
  b.bytes(new TextEncoder().encode(type));
  for (const c of chunks) b.bytes(c);
  return chunk('LIST', b.out());
}
function zstr(s) {
  const e = new TextEncoder().encode(s);
  const n = e.length + 1 + ((e.length + 1) % 2);
  const b = new Uint8Array(n);
  b.set(e);
  return b;
}

export function writeSf2({ name, copyright = '', comment = '', presets }) {
  // サンプルを集める（同じものは1回だけ）
  const samples = [];
  const sIndex = new Map();
  for (const p of presets) for (const z of p.zones) if (!sIndex.has(z.sample)) { sIndex.set(z.sample, samples.length); samples.push(z.sample); }

  // 音のデータは1つの塊にまとめて書く（大きな音源でもメモリを使いすぎないように）
  const total = samples.reduce((n, s) => n + s.data.length + 46, 0);
  const pcm = new Int16Array(total);
  const shdr = new Buf();
  let pos = 0;
  for (const s of samples) {
    const start = pos;
    for (let i = 0; i < s.data.length; i++) pcm[pos + i] = Math.max(-32767, Math.min(32767, Math.round(s.data[i] * 32767)));
    pos += s.data.length;
    const end = pos;
    pos += 46;
    shdr.str(s.name, 20);
    shdr.u32(start); shdr.u32(end);
    const n = s.data.length;
    shdr.u32(start + (s.loop ? s.loop[0] : Math.min(8, n))); shdr.u32(start + (s.loop ? s.loop[1] : Math.max(Math.min(8, n), n - 8)));
    shdr.u32(s.rate); shdr.u8(s.root); shdr.u8(s.corr || 0);
    shdr.u16(0); shdr.u16(1);
  }
  shdr.str('EOS', 20); for (let i = 0; i < 5; i++) shdr.u32(0); shdr.u8(0); shdr.u8(0); shdr.u16(0); shdr.u16(0);

  const phdr = new Buf(), pbag = new Buf(), pgen = new Buf();
  const inst = new Buf(), ibag = new Buf(), igen = new Buf();
  let pbagN = 0, pgenN = 0, ibagN = 0, igenN = 0;
  presets.forEach((p, pi) => {
    phdr.str(p.name, 20); phdr.u16(p.program); phdr.u16(p.bank); phdr.u16(pbagN); phdr.u32(0); phdr.u32(0); phdr.u32(0);
    pbag.u16(pgenN); pbag.u16(0); pbagN++;
    pgen.u16(GEN.instrument); pgen.u16(pi); pgenN++;
    inst.str(p.name, 20); inst.u16(ibagN);
    for (const z of p.zones) {
      ibag.u16(igenN); ibag.u16(0); ibagN++;
      const g = z.gens || {};
      const add = (op, v) => { igen.u16(op); igen.i16(v); igenN++; };
      igen.u16(GEN.keyRange); igen.u8(z.keyLo ?? 0); igen.u8(z.keyHi ?? 127); igenN++;
      if (z.velLo !== undefined) { igen.u16(GEN.velRange); igen.u8(z.velLo); igen.u8(z.velHi ?? 127); igenN++; }
      if (g.attack !== undefined) add(GEN.attack, tc(g.attack));
      if (g.delay) add(GEN.delay, tc(g.delay));
      if (g.hold !== undefined) add(GEN.hold, tc(g.hold));
      if (g.decay !== undefined) add(GEN.decay, tc(g.decay));
      if (g.sustain !== undefined) add(GEN.sustain, Math.round(g.sustain));
      add(GEN.release, tc(g.release ?? 0.08));
      if (g.attenuation) add(GEN.attenuation, Math.round(g.attenuation));
      if (g.pan) add(GEN.pan, Math.round(g.pan));
      if (g.coarseTune) add(GEN.coarseTune, g.coarseTune);
      if (g.fineTune) add(GEN.fineTune, Math.round(g.fineTune));
      if (g.filterHz) add(GEN.filterFc, Math.round(1200 * Math.log2(g.filterHz / 8.176)));
      if (g.filterQ) add(GEN.filterQ, Math.round(g.filterQ));
      if (g.scaleTuning !== undefined && g.scaleTuning !== 100) add(GEN.scaleTuning, g.scaleTuning);
      if (g.exclusiveClass) add(GEN.exclusiveClass, g.exclusiveClass);
      if (g.rootKey !== undefined) add(GEN.rootKey, g.rootKey);
      add(GEN.sampleModes, z.sample.loop ? 1 : 0);
      add(GEN.sampleID, sIndex.get(z.sample));
    }
  });
  phdr.str('EOP', 20); phdr.u16(0); phdr.u16(0); phdr.u16(pbagN); phdr.u32(0); phdr.u32(0); phdr.u32(0);
  pbag.u16(pgenN); pbag.u16(0);
  pgen.u32(0);
  inst.str('EOI', 20); inst.u16(ibagN);
  ibag.u16(igenN); ibag.u16(0);
  igen.u32(0);
  const mod = new Uint8Array(10);

  const ifil = new Buf(); ifil.u16(2); ifil.u16(1);
  const info = [chunk('ifil', ifil.out()), chunk('isng', zstr('EMU8000')), chunk('INAM', zstr(name))];
  if (copyright) info.push(chunk('ICOP', zstr(copyright)));
  if (comment) info.push(chunk('ICMT', zstr(comment)));
  info.push(chunk('ISFT', zstr('MIDI Studio Changer')));

  const body = new Buf();
  body.bytes(new TextEncoder().encode('sfbk'));
  body.bytes(list('INFO', info));
  body.bytes(list('sdta', [chunk('smpl', new Uint8Array(pcm.buffer))]));
  body.bytes(list('pdta', [
    chunk('phdr', phdr.out()), chunk('pbag', pbag.out()), chunk('pmod', mod), chunk('pgen', pgen.out()),
    chunk('inst', inst.out()), chunk('ibag', ibag.out()), chunk('imod', mod), chunk('igen', igen.out()),
    chunk('shdr', shdr.out()),
  ]));
  return chunk('RIFF', body.out());
}
