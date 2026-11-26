// サウンドフォントの音を Web Audio で鳴らす。
// 使う音だけを、必要になったときに AudioBuffer にする（スマホのメモリ節約）。
import { findPreset } from './sf2.js';

export class SoundFontBank {
  /**
   * @param sf parseSf2 の結果
   * @param opts.lofi スーファミ風：サンプルを粗くして、こもった音にする
   */
  constructor(sf, { lofi = false } = {}) {
    this.sf = sf;
    this.lofi = lofi;
    this.buffers = new Map();
    this.exclusive = new Map();
  }

  presets(isDrum) {
    return this.sf.presets.filter((p) => (isDrum ? p.bank === 128 : p.bank === 0));
  }

  preset(program, isDrum) {
    return findPreset(this.sf, program, isDrum);
  }

  buffer(ctx, r) {
    const key = `${r.start}:${r.end}:${r.rate}`;
    let b = this.buffers.get(key);
    if (b) return b;
    const pcm = this.sf.pcm.subarray(r.start, r.end);
    let rate = r.rate, step = 1;
    if (this.lofi) {
      // サンプリングを粗く（だいたい16kHz）＋ 細かい音の段差を付ける
      step = Math.max(1, Math.round(r.rate / 16000));
      rate = r.rate / step;
    }
    const len = Math.max(1, Math.floor(pcm.length / step));
    b = { audio: ctx.createBuffer(1, len, Math.max(3000, Math.round(rate))), step };
    const ch = b.audio.getChannelData(0);
    if (step === 1 && !this.lofi) {
      for (let i = 0; i < len; i++) ch[i] = pcm[i] / 32768;
    } else {
      for (let i = 0; i < len; i++) {
        let s = 0;
        for (let k = 0; k < step; k++) s += pcm[i * step + k] || 0;
        ch[i] = Math.round((s / step / 32768) * 256) / 256;
      }
    }
    this.buffers.set(key, b);
    return b;
  }

  /** 1音鳴らす。戻り値は途中で止めるためのハンドル */
  noteOn(ctx, dest, preset, { when, dur, pitch, vel, channel = 0 }) {
    const regions = preset.regions.filter((r) => pitch >= r.keyLo && pitch <= r.keyHi && vel >= r.velLo && vel <= r.velHi);
    const voices = [];
    let end = when;
    for (const r of regions) {
      if (r.exclusiveClass) {
        const k = `${channel}:${r.exclusiveClass}`;
        for (const v of this.exclusive.get(k) || []) v.stop(when);
        this.exclusive.set(k, voices);
      }
      const v = this.voice(ctx, dest, r, { when, dur, pitch, vel, drum: preset.bank === 128 });
      voices.push(v);
      end = Math.max(end, v.end);
    }
    return {
      end,
      stop(at) { for (const v of voices) v.stop(at); },
    };
  }

  voice(ctx, dest, r, { when, dur, pitch, vel, drum }) {
    const { audio, step } = this.buffer(ctx, r);
    const src = ctx.createBufferSource();
    src.buffer = audio;
    const cents = (pitch - r.root) * r.scaleTuning + r.tune;
    src.playbackRate.value = 2 ** (cents / 1200);
    if (r.loop) {
      src.loop = true;
      src.loopStart = r.loopStart / step / audio.sampleRate;
      src.loopEnd = r.loopEnd / step / audio.sampleRate;
    }

    // 音量：初期減衰（cB）＋ 強さ（SF2の標準的なカーブに近い形）
    const velGain = (vel / 127) ** 2;
    const peak = 10 ** (-r.attenuation / 200) * velGain * 0.6;
    const sus = peak * 10 ** (-r.sustain / 200);
    const env = ctx.createGain();
    const g = env.gain;
    const t0 = when + r.delay;
    g.setValueAtTime(0, when);
    if (r.delay) g.setValueAtTime(0, t0);
    g.linearRampToValueAtTime(peak, t0 + Math.max(0.001, r.attack));
    const tDecay = t0 + r.attack + r.hold;
    if (r.hold) g.setValueAtTime(peak, tDecay);
    if (r.decay > 0 && r.sustain > 0) g.setTargetAtTime(sus, tDecay, r.decay / 5);

    // ドラムは鳴らしきり（短く切らない）
    const off = drum ? when + Math.max(dur, 0.05) + (r.loop ? 0 : 2) : when + Math.max(dur, r.attack + 0.01);
    const rel = Math.min(Math.max(r.release, 0.02), 4);
    g.setTargetAtTime(0, off, rel / 5);
    let endAt = off + rel + 0.05;
    if (!r.loop) endAt = Math.min(endAt, when + r.delay + (r.end - r.start) / r.rate / src.playbackRate.value + 0.05);

    let node = src;
    if (r.filterFc < 13000) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = Math.min(20000, 8.176 * 2 ** (r.filterFc / 1200));
      f.Q.value = Math.max(0.0001, 10 ** (r.filterQ / 200));
      node.connect(f);
      node = f;
    }
    node.connect(env);
    let out = env;
    if (r.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = r.pan / 500;
      env.connect(p);
      out = p;
    }
    out.connect(dest);
    src.start(when);
    src.stop(endAt);
    src.onended = () => out.disconnect();
    return {
      end: endAt,
      stop(at) {
        g.cancelScheduledValues(at);
        g.setTargetAtTime(0, at, 0.015);
        try { src.stop(at + 0.1); } catch {}
      },
    };
  }
}
