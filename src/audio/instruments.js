// 音色（波形シンセ）とドラム。サウンドフォントは第2段階で追加予定。
// 音色を足すときは TONES に1行追加するだけでよい。

export const TONES = {
  // チップチューン（ファミコン・ゲームボーイ風）
  square:   { label: 'ピコピコ（矩形波）', group: 'レトロ', osc: [{ wave: 'square' }], env: [0.003, 0.1, 0.7, 0.04], gain: 0.16, gm: 80 },
  pulse25:  { label: '細いピコピコ（25%）', group: 'レトロ', osc: [{ wave: 'pulse25' }], env: [0.003, 0.1, 0.7, 0.04], gain: 0.2, gm: 80 },
  pulse12:  { label: 'もっと細いピコピコ（12.5%）', group: 'レトロ', osc: [{ wave: 'pulse12' }], env: [0.003, 0.1, 0.7, 0.04], gain: 0.24, gm: 80 },
  triangle: { label: 'やわらかピコ（三角波）', group: 'レトロ', osc: [{ wave: 'triangle' }], env: [0.003, 0.05, 0.9, 0.04], gain: 0.4, gm: 81 },
  // シンセ
  lead:     { label: 'シンセリード', group: 'シンセ', osc: [{ wave: 'sawtooth' }, { wave: 'square', detune: 7, gain: 0.4 }], filter: [3200, 1], env: [0.01, 0.2, 0.75, 0.12], gain: 0.13, gm: 81 },
  saw:      { label: 'ギザギザシンセ（のこぎり波）', group: 'シンセ', osc: [{ wave: 'sawtooth' }], env: [0.005, 0.1, 0.8, 0.08], gain: 0.13, gm: 81 },
  sine:     { label: 'まるい音（サイン波）', group: 'シンセ', osc: [{ wave: 'sine' }], env: [0.01, 0.1, 0.9, 0.1], gain: 0.45, gm: 80 },
  pad:      { label: 'ふんわりパッド', group: 'シンセ', osc: [{ wave: 'sawtooth', detune: -8 }, { wave: 'sawtooth', detune: 8 }], filter: [1400, 0.7], env: [0.25, 0.5, 0.8, 0.5], gain: 0.07, gm: 89 },
  space:    { label: '宇宙っぽいパッド', group: 'シンセ', osc: [{ wave: 'triangle', detune: -12 }, { wave: 'sine', detune: 1200, gain: 0.3 }, { wave: 'triangle', detune: 12 }], filter: [2200, 2], env: [0.6, 1, 0.7, 1.2], gain: 0.16, gm: 91 },
  bass:     { label: 'シンセベース', group: 'シンセ', osc: [{ wave: 'sawtooth' }, { wave: 'square', detune: -1200, gain: 0.5 }], filter: [900, 3], fenv: 1800, env: [0.005, 0.2, 0.6, 0.06], gain: 0.16, gm: 38 },
  // 楽器っぽい音
  piano:    { label: 'ピアノ風', group: '楽器風', osc: [{ wave: 'piano' }], env: [0.002, 0.9, 0.12, 0.25], gain: 0.3, gm: 0 },
  bell:     { label: 'ベル・オルゴール', group: '楽器風', fm: { ratio: 3.5, index: 2.5, decay: 0.6 }, env: [0.002, 1.2, 0.05, 0.5], gain: 0.3, gm: 10 },
  organ:    { label: 'オルガン', group: '楽器風', osc: [{ wave: 'organ' }], env: [0.01, 0.05, 0.95, 0.06], gain: 0.2, gm: 16 },
  pluck:    { label: 'はじく音（ギター風）', group: '楽器風', osc: [{ wave: 'sawtooth' }], filter: [600, 2], fenv: 3500, fdecay: 0.15, env: [0.002, 0.4, 0.15, 0.15], gain: 0.2, gm: 25 },
  strings:  { label: 'ストリングス風', group: '楽器風', osc: [{ wave: 'sawtooth', detune: -6 }, { wave: 'sawtooth', detune: 6 }], filter: [2400, 0.5], env: [0.15, 0.3, 0.85, 0.35], gain: 0.08, gm: 48 },
  brass:    { label: 'ブラス風', group: '楽器風', osc: [{ wave: 'sawtooth' }], filter: [1200, 1.5], fenv: 2000, fdecay: 0.25, env: [0.04, 0.2, 0.8, 0.12], gain: 0.15, gm: 61 },
  flute:    { label: 'フルート風', group: '楽器風', osc: [{ wave: 'sine' }, { wave: 'triangle', detune: 1200, gain: 0.15 }], env: [0.06, 0.1, 0.85, 0.1], gain: 0.35, gm: 73 },
};

export const DRUM_KITS = {
  'kit-retro': { label: 'レトロドラム（ノイズ）', retro: true },
  'kit-synth': { label: 'シンセドラム', retro: false },
};

const waveCache = new WeakMap();
function periodicWave(ctx, name) {
  let cache = waveCache.get(ctx);
  if (!cache) waveCache.set(ctx, (cache = {}));
  if (cache[name]) return cache[name];
  const N = 64;
  const real = new Float32Array(N), imag = new Float32Array(N);
  if (name.startsWith('pulse')) {
    const duty = name === 'pulse25' ? 0.25 : 0.125;
    for (let k = 1; k < N; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  } else if (name === 'organ') {
    [[1, 1], [2, 0.6], [3, 0.35], [4, 0.25], [6, 0.12], [8, 0.1]].forEach(([k, a]) => (imag[k] = a));
  } else if (name === 'piano') {
    [[1, 1], [2, 0.55], [3, 0.3], [4, 0.18], [5, 0.1], [6, 0.06], [7, 0.04]].forEach(([k, a]) => (imag[k] = a));
  }
  return (cache[name] = ctx.createPeriodicWave(real, imag));
}

function setOscWave(ctx, osc, wave) {
  if (['square', 'sawtooth', 'triangle', 'sine'].includes(wave)) osc.type = wave;
  else osc.setPeriodicWave(periodicWave(ctx, wave));
}

/** 1音鳴らす。戻り値は途中で止めるためのハンドル */
export function playTone(ctx, dest, toneId, { when, dur, pitch, vel }) {
  const tone = TONES[toneId] || TONES.square;
  const freq = 440 * 2 ** ((pitch - 69) / 12);
  const [a, d, s, r] = tone.env;
  const peak = tone.gain * (vel / 127) ** 1.3;
  const off = when + Math.max(dur, a + 0.005);
  const end = off + r * 3 + 0.02;

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, when);
  amp.gain.linearRampToValueAtTime(peak, when + a);
  amp.gain.setTargetAtTime(peak * s, when + a, d / 3);
  amp.gain.setTargetAtTime(0, off, r / 3 + 0.001);

  let out = amp;
  let filter = null;
  if (tone.filter) {
    filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = tone.filter[1];
    const base = Math.min(tone.filter[0] * (0.6 + 0.6 * (vel / 127)), 18000);
    if (tone.fenv) {
      filter.frequency.setValueAtTime(Math.min(base + tone.fenv, 18000), when);
      filter.frequency.setTargetAtTime(base, when, (tone.fdecay || 0.2) / 3);
    } else filter.frequency.value = base;
    filter.connect(amp);
    out = filter;
  }
  amp.connect(dest);

  const nodes = [];
  if (tone.fm) {
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const mg = ctx.createGain();
    car.frequency.value = freq;
    mod.frequency.value = freq * tone.fm.ratio;
    mg.gain.setValueAtTime(freq * tone.fm.index, when);
    mg.gain.setTargetAtTime(0, when, tone.fm.decay / 3);
    mod.connect(mg).connect(car.frequency);
    car.connect(out);
    nodes.push(car, mod);
  } else {
    for (const o of tone.osc) {
      const osc = ctx.createOscillator();
      setOscWave(ctx, osc, o.wave);
      osc.frequency.value = freq;
      if (o.detune) osc.detune.value = o.detune;
      if (o.gain && o.gain !== 1) {
        const g = ctx.createGain();
        g.gain.value = o.gain;
        osc.connect(g).connect(out);
      } else osc.connect(out);
      nodes.push(osc);
    }
  }
  for (const n of nodes) { n.start(when); n.stop(end); }
  nodes[0].onended = () => { amp.disconnect(); };
  return {
    end,
    stop(at) {
      amp.gain.cancelScheduledValues(at);
      amp.gain.setTargetAtTime(0, at, 0.01);
      for (const n of nodes) { try { n.stop(at + 0.06); } catch {} }
    },
  };
}

const noiseCache = new WeakMap();
function noiseBuffer(ctx, retro) {
  let c = noiseCache.get(ctx);
  if (!c) noiseCache.set(ctx, (c = {}));
  const key = retro ? 'retro' : 'white';
  if (c[key]) return c[key];
  const len = ctx.sampleRate;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  if (retro) {
    // ファミコンのノイズのような、ざらざらした1ビットのノイズ
    let reg = 1, v = 1;
    const hold = Math.max(1, Math.round(ctx.sampleRate / 22000));
    for (let i = 0; i < len; i++) {
      if (i % hold === 0) { const bit = (reg ^ (reg >> 1)) & 1; reg = (reg >> 1) | (bit << 14); v = reg & 1 ? 1 : -1; }
      data[i] = v;
    }
  } else for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return (c[key] = buf);
}

/** ドラム1打。pitch は GM のドラム番号（36=バスドラ, 38=スネア, 42=ハイハット…） */
export function playDrum(ctx, dest, kitId, { when, pitch, vel }) {
  const retro = (DRUM_KITS[kitId] || DRUM_KITS['kit-synth']).retro;
  const v = (vel / 127) ** 1.2;
  const nodes = [];
  const out = ctx.createGain();
  out.connect(dest);
  let end = when + 0.3;

  const noise = (filterType, freq, decay, level, q = 0.8) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, retro);
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level * v, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + decay);
    src.connect(f).connect(g).connect(out);
    src.start(when, Math.random() * 0.5);
    src.stop(when + decay + 0.02);
    nodes.push(src);
    end = Math.max(end, when + decay + 0.02);
  };
  const thump = (f0, f1, decay, level, type = retro ? 'triangle' : 'sine') => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, when);
    o.frequency.exponentialRampToValueAtTime(f1, when + decay * 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level * v, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + decay);
    o.connect(g).connect(out);
    o.start(when);
    o.stop(when + decay + 0.02);
    nodes.push(o);
    end = Math.max(end, when + decay + 0.02);
  };

  if (pitch === 35 || pitch === 36) {
    thump(retro ? 180 : 150, 45, retro ? 0.18 : 0.35, retro ? 0.7 : 0.9);
    if (!retro) noise('lowpass', 3000, 0.02, 0.15);
  } else if (pitch === 38 || pitch === 40 || pitch === 37) {
    noise(retro ? 'highpass' : 'bandpass', retro ? 1200 : 2500, retro ? 0.12 : 0.18, retro ? 0.35 : 0.6, 0.6);
    thump(retro ? 220 : 190, 140, 0.08, retro ? 0.3 : 0.35);
  } else if (pitch === 39) {
    noise('bandpass', 1300, 0.15, 0.6, 1.2);
  } else if (pitch === 42 || pitch === 44) {
    noise('highpass', retro ? 6000 : 7500, 0.045, retro ? 0.2 : 0.3);
  } else if (pitch === 46) {
    noise('highpass', retro ? 6000 : 7000, 0.3, retro ? 0.18 : 0.25);
  } else if (pitch === 49 || pitch === 57 || pitch === 52 || pitch === 55) {
    noise('highpass', 4000, 1.2, retro ? 0.18 : 0.25);
  } else if (pitch === 51 || pitch === 59 || pitch === 53) {
    noise('highpass', 6500, 0.5, 0.12);
  } else if (pitch >= 41 && pitch <= 50) {
    const f = 70 + (pitch - 41) * 18;
    thump(f * 1.6, f, 0.3, 0.7);
  } else {
    noise('bandpass', 3000 + (pitch % 12) * 300, 0.08, 0.2, 2);
  }
  nodes[0].onended = () => out.disconnect();
  return {
    end,
    stop(at) {
      out.gain.setTargetAtTime(0, at, 0.01);
      for (const n of nodes) { try { n.stop(at + 0.06); } catch {} }
    },
  };
}

export function isDrumKit(id) {
  return id in DRUM_KITS;
}
