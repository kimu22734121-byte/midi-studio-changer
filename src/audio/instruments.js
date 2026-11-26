// 「軽い波形シンセ」の音色とドラム。読み込みなしで、その場で波形から音を作る。
// 音色を足すときは TONES に1行追加するだけでよい。
// osc の pan（-1〜1）で左右に広げ、detune（セント）でずらして重ねると厚みが出る。

const wide = (wave, cents, pans = [-0.5, 0.5], gain = 1) => [
  { wave, detune: -cents, pan: pans[0], gain },
  { wave, detune: cents, pan: pans[1], gain },
];

export const TONES = {
  // チップチューン（ファミコン・ゲームボーイ風）：わざと1つの波形だけで鳴らす
  square:   { label: 'ピコピコ（矩形波）', group: 'レトロ', osc: [{ wave: 'square' }], env: [0.003, 0.1, 0.7, 0.04], gain: 0.16, gm: 80 },
  pulse25:  { label: '細いピコピコ（25%）', group: 'レトロ', osc: [{ wave: 'pulse25' }], env: [0.003, 0.1, 0.7, 0.04], gain: 0.2, gm: 80 },
  pulse12:  { label: 'もっと細いピコピコ（12.5%）', group: 'レトロ', osc: [{ wave: 'pulse12' }], env: [0.003, 0.1, 0.7, 0.04], gain: 0.24, gm: 80 },
  triangle: { label: 'やわらかピコ（三角波）', group: 'レトロ', osc: [{ wave: 'triangle' }], env: [0.003, 0.05, 0.9, 0.04], gain: 0.4, gm: 81 },
  // シンセ（厚みのある音）
  lead:     { label: 'シンセリード（太い）', group: 'シンセ', osc: [...wide('sawtooth', 8, [-0.35, 0.35]), { wave: 'square', detune: -1200, gain: 0.35 }], filter: [2600, 2], fenv: 2400, fdecay: 0.35, env: [0.008, 0.25, 0.8, 0.15], gain: 0.1, gm: 81 },
  supersaw: { label: 'スーパーソー（きらびやか）', group: 'シンセ', osc: [{ wave: 'sawtooth' }, ...wide('sawtooth', 9, [-0.4, 0.4], 0.8), ...wide('sawtooth', 21, [-0.9, 0.9], 0.6)], filter: [5000, 0.7], env: [0.02, 0.4, 0.85, 0.35], gain: 0.055, gm: 81 },
  saw:      { label: 'ギザギザシンセ', group: 'シンセ', osc: wide('sawtooth', 6, [-0.3, 0.3]), filter: [4500, 1], env: [0.005, 0.15, 0.8, 0.1], gain: 0.1, gm: 81 },
  sine:     { label: 'まるい音（やさしい）', group: 'シンセ', osc: [{ wave: 'sine' }, { wave: 'sine', detune: 1202, gain: 0.18, pan: 0.3 }, { wave: 'triangle', detune: -4, gain: 0.25, pan: -0.3 }], env: [0.01, 0.2, 0.85, 0.18], gain: 0.38, gm: 80 },
  pad:      { label: 'ふんわりパッド（広がる）', group: 'シンセ', osc: [...wide('sawtooth', 15, [-0.8, 0.8]), ...wide('sawtooth', 5, [-0.3, 0.3])], filter: [1500, 0.8], fenv: 900, fdecay: 1.2, env: [0.45, 0.8, 0.85, 0.9], gain: 0.045, gm: 89 },
  space:    { label: '宇宙っぽいパッド', group: 'シンセ', osc: [...wide('triangle', 14, [-0.9, 0.9]), { wave: 'sine', detune: 1200, gain: 0.35 }, { wave: 'sine', detune: 1902, gain: 0.12, pan: 0.5 }], filter: [2400, 3], env: [0.9, 1.2, 0.75, 1.8], gain: 0.13, gm: 91 },
  bass:     { label: 'シンセベース（太い）', group: 'シンセ', osc: [{ wave: 'sawtooth' }, { wave: 'square', detune: -1200, gain: 0.6 }, { wave: 'sine', detune: -1200, gain: 0.5 }], filter: [700, 4], fenv: 2600, fdecay: 0.18, env: [0.004, 0.25, 0.65, 0.07], gain: 0.14, gm: 38 },
  subbass:  { label: '重低音ベース', group: 'シンセ', osc: [{ wave: 'sine' }, { wave: 'triangle', gain: 0.4 }], env: [0.006, 0.3, 0.8, 0.08], gain: 0.5, gm: 39 },
  // 楽器っぽい音
  piano:    { label: 'ピアノ風', group: '楽器風', osc: [{ wave: 'piano', pan: -0.15 }, { wave: 'piano', detune: 4, pan: 0.15, gain: 0.8 }, { wave: 'triangle', detune: 1200, gain: 0.12 }], filter: [5000, 0.5], fenv: 3000, fdecay: 0.5, env: [0.002, 1.1, 0.1, 0.3], gain: 0.2, gm: 0 },
  epiano:   { label: 'エレピ（キラッ）', group: '楽器風', fm: { ratio: 1, index: 1.6, decay: 0.9 }, env: [0.002, 1.6, 0.2, 0.35], gain: 0.32, gm: 4 },
  bell:     { label: 'ベル・オルゴール', group: '楽器風', fm: { ratio: 3.5, index: 2.5, decay: 0.6 }, env: [0.002, 1.5, 0.05, 0.7], gain: 0.28, gm: 10 },
  organ:    { label: 'オルガン', group: '楽器風', osc: [{ wave: 'organ', pan: -0.25 }, { wave: 'organ', detune: 5, pan: 0.25 }], env: [0.01, 0.05, 0.95, 0.08], gain: 0.14, gm: 16 },
  pluck:    { label: 'はじく音（ギター風）', group: '楽器風', osc: wide('sawtooth', 5, [-0.3, 0.3]), filter: [500, 2], fenv: 4200, fdecay: 0.14, env: [0.002, 0.5, 0.12, 0.2], gain: 0.16, gm: 25 },
  strings:  { label: 'ストリングス（厚い）', group: '楽器風', osc: [...wide('sawtooth', 10, [-0.7, 0.7]), { wave: 'sawtooth', gain: 0.7 }], filter: [2600, 0.6], env: [0.2, 0.4, 0.85, 0.45], gain: 0.055, gm: 48 },
  brass:    { label: 'ブラス（はなやか）', group: '楽器風', osc: wide('sawtooth', 7, [-0.4, 0.4]), filter: [1100, 1.8], fenv: 2800, fdecay: 0.3, env: [0.035, 0.25, 0.8, 0.15], gain: 0.11, gm: 61 },
  flute:    { label: 'フルート風', group: '楽器風', osc: [{ wave: 'sine' }, { wave: 'triangle', detune: 1200, gain: 0.15 }, { wave: 'sine', detune: 3, gain: 0.4, pan: 0.3 }], env: [0.06, 0.1, 0.85, 0.12], gain: 0.28, gm: 73 },
  choir:    { label: 'コーラス風「アー」', group: '楽器風', osc: [...wide('sawtooth', 12, [-0.7, 0.7]), { wave: 'triangle', gain: 0.8 }], filter: [1100, 5], env: [0.3, 0.5, 0.85, 0.6], gain: 0.06, gm: 52 },
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
      let node = osc;
      if (o.gain && o.gain !== 1) {
        const g = ctx.createGain();
        g.gain.value = o.gain;
        node = node.connect(g);
      }
      if (o.pan && ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = o.pan;
        node = node.connect(p);
      }
      node.connect(out);
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
  let tail = out;
  // シンバル類は少し左右に散らす
  if (!retro && ctx.createStereoPanner && [42, 44, 46, 51, 53, 59].includes(pitch)) {
    const p = ctx.createStereoPanner();
    p.pan.value = [51, 53, 59].includes(pitch) ? 0.35 : -0.3;
    out.connect(p);
    tail = p;
  }
  tail.connect(dest);
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
    if (retro) thump(180, 45, 0.18, 0.7);
    else {
      // 低い「ドン」＋ 重低音 ＋ アタックの「カッ」
      thump(170, 44, 0.45, 0.95);
      thump(60, 40, 0.5, 0.45, 'sine');
      noise('highpass', 3500, 0.012, 0.35);
    }
  } else if (pitch === 38 || pitch === 40 || pitch === 37) {
    if (retro) {
      noise('highpass', 1200, 0.12, 0.35, 0.6);
      thump(220, 140, 0.08, 0.3);
    } else {
      noise('bandpass', 2200, 0.22, 0.6, 0.7);
      noise('highpass', 5500, 0.09, 0.35);
      thump(210, 165, 0.1, 0.45, 'triangle');
    }
  } else if (pitch === 39) {
    // 手拍子：3回ばらけて鳴らす
    for (const dt of [0, 0.012, 0.024]) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, retro);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 1.2;
      const g = ctx.createGain();
      const t = when + dt;
      g.gain.setValueAtTime(0.55 * v, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + (dt === 0.024 ? 0.18 : 0.01));
      src.connect(f).connect(g).connect(out);
      src.start(t, Math.random() * 0.5);
      src.stop(t + 0.2);
      nodes.push(src);
    }
  } else if (pitch === 42 || pitch === 44) {
    noise('highpass', retro ? 6000 : 7500, 0.05, retro ? 0.2 : 0.28);
    if (!retro) out.gain.value = 0.9;
  } else if (pitch === 46) {
    noise('highpass', retro ? 6000 : 7000, 0.35, retro ? 0.18 : 0.25);
  } else if (pitch === 49 || pitch === 57 || pitch === 52 || pitch === 55) {
    noise('highpass', 4000, retro ? 1.2 : 1.8, retro ? 0.18 : 0.26);
    if (!retro) noise('bandpass', 9000, 0.9, 0.12, 0.5);
  } else if (pitch === 51 || pitch === 59 || pitch === 53) {
    noise('highpass', 6500, 0.6, 0.12);
    if (!retro) thump(3200, 3000, 0.4, 0.05, 'triangle');
  } else if (pitch >= 41 && pitch <= 50) {
    const f = 70 + (pitch - 41) * 18;
    thump(f * 1.7, f, 0.35, 0.75);
    if (!retro) noise('lowpass', 2500, 0.03, 0.15);
  } else {
    noise('bandpass', 3000 + (pitch % 12) * 300, 0.08, 0.2, 2);
  }
  nodes[0].onended = () => tail.disconnect();
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
