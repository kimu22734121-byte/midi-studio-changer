// 再生エンジン：曲（Song）を Web Audio で鳴らす。
// 音数の上限に合わせて鳴らす音を選び（planVoices）、少し先の音を予約しながら再生する。
// 重くて音の予約が間に合わなくなったら、自動で音数を1段階減らす。
// 音は「軽い波形シンセ」か「サウンドフォントのセット」のどちらかで鳴らす。
import { planVoices, lowerBound, songDuration, lowerPolyphony, POLY_DEFAULT, defaultTone } from '../core/song.js';
import { toneFromProgram } from '../core/midi-file.js';
import { chooseInstruments } from '../core/instrument-choice.js';
import { playTone, playDrum, isDrumKit, TONES } from './instruments.js';

const LOOKAHEAD = 0.2; // 秒
const TICK_MS = 25;
const FALLBACK_ROLES = { melody: 80, chords: 48, bass: 38, other: 0 };

/** 残響の元になる音（だんだん小さくなるノイズ）を作る */
function makeImpulse(ctx, seconds) {
  const rate = ctx.sampleRate;
  const len = Math.round(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // 高い音ほど早く消える（自然なホールの響き）
      const white = Math.random() * 2 - 1;
      const k = 0.2 + 0.75 * t;
      lp = lp * k + white * (1 - k);
      const env = (1 - t) ** 2.2 * Math.min(1, i / (rate * 0.008));
      d[i] = (white * (1 - t) + lp * t) * env;
    }
  }
  return buf;
}

export class Player {
  constructor({ onEnd = () => {}, onAutoReduce = () => {} } = {}) {
    this.onEnd = onEnd;
    this.onAutoReduce = onAutoReduce;
    this.ctx = null;
    this.song = null;
    this.settings = []; // トラックごと { tone, program, preset, muted, volume }
    this.polyphony = POLY_DEFAULT;
    this.autoReduce = true;
    this.events = [];
    this.played = new Set();
    this.playing = false;
    this.pos = 0;
    this.voices = [];
    this.trackGains = [];
    this.duration = 0;
    this.lag = { late: 0, gaps: 0, since: 0, cooldown: 0 };
    this.set = { id: 'wave', builtin: true };
    this.bank = null;
  }

  async ensureContext() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      const ctx = this.ctx;
      this.master = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(ctx.destination);
      this.out = comp;
      // やまびこ（エコー）：スーファミ風・宇宙で使う
      this.echoDelay = ctx.createDelay(1.5);
      this.echoFb = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2800;
      this.echoWet = ctx.createGain();
      this.master.connect(this.echoDelay).connect(lp).connect(this.echoFb).connect(this.echoDelay);
      lp.connect(this.echoWet).connect(comp);
      // 響き（リバーブ）：ホールで鳴らしたような広がり
      this.reverb = ctx.createConvolver();
      this.reverbWet = ctx.createGain();
      this.master.connect(this.reverb).connect(this.reverbWet).connect(comp);
      // コーラス：左右に少しずつずらした音を重ねて、厚みと広がりを出す
      this.chorusWet = ctx.createGain();
      const merger = ctx.createChannelMerger(2);
      [0.013, 0.019].forEach((base, ch) => {
        const d = ctx.createDelay(0.05);
        d.delayTime.value = base;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = ch ? 0.31 : 0.23;
        const depth = ctx.createGain();
        depth.gain.value = 0.003;
        lfo.connect(depth).connect(d.delayTime);
        lfo.start();
        this.master.connect(d).connect(merger, 0, ch);
      });
      merger.connect(this.chorusWet).connect(comp);
      this.applySetMix();
      this.buildTrackGains();
    }
    if (this.ctx.state !== 'running') {
      // iPhone では resume が終わらないことがあるので、待ちすぎない
      await Promise.race([this.ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
    }
  }

  applySetMix() {
    if (!this.ctx) return;
    const fx = this.set.fx || {};
    this.master.gain.value = 0.9 * (this.set.gain || 1);
    const echo = fx.echo || (this.set.echo ? { time: 0.24, feedback: 0.38, wet: 0.32 } : null);
    this.echoWet.gain.value = echo ? echo.wet : 0;
    this.echoFb.gain.value = echo ? echo.feedback : 0;
    this.echoDelay.delayTime.value = echo ? echo.time : 0.24;
    this.chorusWet.gain.value = fx.chorus || 0;
    const rv = fx.reverb;
    this.reverbWet.gain.value = rv ? rv.wet : 0;
    if (rv && this.reverbTime !== rv.time) {
      this.reverb.buffer = makeImpulse(this.ctx, rv.time);
      this.reverbTime = rv.time;
    }
  }

  buildTrackGains() {
    if (!this.ctx || !this.song) return;
    for (const g of this.trackGains) g.disconnect();
    this.trackGains = this.song.tracks.map((_, i) => {
      const g = this.ctx.createGain();
      g.gain.value = this.trackVolume(i);
      g.connect(this.master);
      return g;
    });
  }

  trackVolume(i) {
    const s = this.settings[i];
    return s.muted ? 0 : s.volume;
  }

  setSong(song) {
    this.stop();
    this.song = song;
    this.settings = song.tracks.map(() => ({ tone: null, program: 0, preset: null, muted: false, volume: 1 }));
    this.assignInstruments();
    this.duration = songDuration(song);
    this.buildTrackGains();
    this.replan();
  }

  /**
   * 再生を止めずに曲を入れ替える（編成で楽器を増やしたとき）。
   * 先頭の keep 個のトラック（元のパート）は、選んだ楽器・音量・消音をそのまま引き継ぐ。
   */
  replaceSong(song, keep = 0) {
    const was = this.playing;
    const pos = this.currentTime;
    if (was) this.pause();
    const old = this.settings;
    this.song = song;
    this.settings = song.tracks.map((_, i) => (i < keep && old[i] ? old[i] : { tone: null, program: 0, preset: null, muted: false, volume: 1 }));
    this.assignInstruments(keep);
    this.duration = songDuration(song);
    this.buildTrackGains();
    this.replan();
    this.pos = Math.min(pos, this.duration);
    if (was) this.play();
  }

  /** セットを変えたとき・曲を読み込んだときに、パートごとの楽器を決め直す（from より前のトラックはそのまま） */
  assignInstruments(from = 0) {
    if (!this.song) return;
    let roles = this.set.roles || FALLBACK_ROLES;
    let remap = {};
    // 生音・オーケストラ・標準のセットは、曲に合わせて楽器を選ぶ
    // （MIDI・MusicXML で元の楽器が全部決まっている曲はそのまま）
    const needs = this.song.tracks.some((t) => !t.isDrum && (t.layer || t.program == null));
    this.choice = this.bank && this.set.choose && needs ? chooseInstruments(this.song, this.set.choose) : null;
    if (this.choice) ({ roles, remap } = this.choice);
    this.song.tracks.forEach((tr, i) => {
      if (i < from) return;
      const st = this.settings[i];
      st.tone = tr.tone || defaultTone(tr.role, tr.isDrum);
      const prog = tr.layer && tr.program != null ? remap[tr.program] ?? tr.program : tr.program;
      st.program = tr.isDrum ? (tr.program ?? 0) : (prog ?? roles[tr.role] ?? 0);
      st.preset = this.bank ? this.bank.preset(st.program, tr.isDrum) : null;
    });
  }

  /** サウンドフォントのセットを切り替える（bank が null なら波形シンセ） */
  setSoundSet(set, bank) {
    const was = this.playing;
    if (was) this.pause();
    this.set = set;
    this.bank = bank;
    this.applySetMix();
    this.assignInstruments();
    if (was) this.play();
  }

  /** 今のセットで選べる楽器の一覧 */
  instrumentChoices(i) {
    const tr = this.song.tracks[i];
    if (!this.bank) return null;
    return this.bank.presets(tr.isDrum);
  }

  /** パートの楽器を変える（波形シンセなら音色ID、サウンドフォントなら番号） */
  setInstrument(i, value) {
    const st = this.settings[i];
    const tr = this.song.tracks[i];
    if (this.bank) {
      st.program = Number(value);
      st.preset = this.bank.preset(st.program, tr.isDrum);
    } else st.tone = value;
  }

  /** MIDI保存用：トラックのGM楽器番号 */
  programOf(i) {
    const st = this.settings[i];
    if (this.bank) return st.preset?.bank === 0 ? st.preset.program : st.program;
    if (this.song.tracks[i].program !== null && st.tone === toneFromProgram(this.song.tracks[i].program)) return this.song.tracks[i].program;
    return TONES[st.tone]?.gm ?? 0;
  }

  replan() {
    if (!this.song) return;
    this.events = planVoices(this.song, this.polyphony, { muted: this.settings.map((s) => s.muted) });
    this.played = new Set(this.events.map((e) => e.note));
    if (this.playing) this.ptr = lowerBound(this.events, this.currentTime + LOOKAHEAD);
  }

  setPolyphony(n) {
    this.polyphony = n;
    this.replan();
  }

  setMuted(i, muted) {
    this.settings[i].muted = muted;
    if (this.trackGains[i]) this.trackGains[i].gain.setTargetAtTime(this.trackVolume(i), this.ctx.currentTime, 0.02);
    this.replan();
  }

  setVolume(i, v) {
    this.settings[i].volume = v;
    if (this.trackGains[i]) this.trackGains[i].gain.setTargetAtTime(this.trackVolume(i), this.ctx.currentTime, 0.02);
  }

  get currentTime() {
    if (!this.playing) return this.pos;
    return Math.max(0, this.startPos + (this.ctx.currentTime - this.startCtx));
  }

  async play() {
    if (!this.song || this.playing) return;
    await this.ensureContext();
    if (this.pos >= this.duration) this.pos = 0;
    // 使う音を先に用意しておく（鳴らしながら用意すると、間に合わずに音が抜けることがある）
    if (this.bank && this.bank.prepare) {
      this.song.tracks.forEach((tr, i) => { if (this.settings[i].preset) this.bank.prepare(this.ctx, this.settings[i].preset, tr.notes); });
    }
    this.startCtx = this.ctx.currentTime + 0.06;
    this.startPos = this.pos;
    this.ptr = lowerBound(this.events, this.pos);
    this.playing = true;
    this.lastTick = performance.now();
    this.lag = { late: 0, gaps: 0, since: performance.now(), cooldown: 0 };
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  pause() {
    if (!this.playing) return;
    this.pos = this.currentTime;
    this.playing = false;
    clearInterval(this.timer);
    this.silence();
  }

  stop() {
    this.pause();
    this.pos = 0;
  }

  seek(t) {
    const was = this.playing;
    this.pause();
    this.pos = Math.max(0, Math.min(t, this.duration));
    if (was) this.play();
  }

  silence() {
    if (!this.ctx) return;
    const at = this.ctx.currentTime;
    for (const v of this.voices) v.stop(at);
    this.voices = [];
  }

  /** 1音鳴らす（テスト・試し聴き用にも使う） */
  noteOn(track, { when, dur, pitch, vel }) {
    const st = this.settings[track];
    const dest = this.trackGains[track];
    if (this.bank && st.preset) return this.bank.noteOn(this.ctx, dest, st.preset, { when, dur, pitch, vel, channel: track });
    if (this.bank) return null;
    return isDrumKit(st.tone)
      ? playDrum(this.ctx, dest, st.tone, { when, pitch, vel })
      : playTone(this.ctx, dest, st.tone, { when, dur, pitch, vel });
  }

  tick() {
    if (!this.playing) return;
    const ctx = this.ctx;
    const nowPerf = performance.now();
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (!hidden && nowPerf - this.lastTick > 120) this.lag.gaps++;
    this.lastTick = nowPerf;

    const now = ctx.currentTime;
    // 画面が裏に回るとタイマーが遅くなるので、先読みを長くする
    const horizon = now + (hidden ? 1.5 : LOOKAHEAD);
    while (this.ptr < this.events.length) {
      const ev = this.events[this.ptr];
      const at = this.startCtx + ev.t - this.startPos;
      if (at > horizon) break;
      this.ptr++;
      let dur = ev.d;
      if (at < now - 0.05) {
        if (!hidden) this.lag.late++;
        // 少し遅れただけで、まだ伸ばしている途中の音は、残りの長さだけ鳴らす（音が抜けないように）
        const left = at + ev.d - now;
        if (at < now - 0.4 || left < 0.12 || this.song.tracks[ev.track]?.isDrum) continue;
        dur = left;
      }
      const v = this.noteOn(ev.track, { when: Math.max(at, now), dur, pitch: ev.p, vel: ev.v });
      if (v) this.voices.push(v);
    }
    if (this.voices.length > 256) this.voices = this.voices.filter((v) => v.end > now);

    this.checkLag(nowPerf);
    if (this.currentTime > this.duration + 0.8) {
      this.stop();
      this.onEnd();
    }
  }

  checkLag(nowPerf) {
    if (nowPerf - this.lag.since < 2000) return;
    const heavy = this.lag.late >= 6 || this.lag.gaps >= 3;
    if (heavy && this.autoReduce && nowPerf > this.lag.cooldown) {
      const next = lowerPolyphony(this.polyphony);
      if (next < this.polyphony) {
        this.setPolyphony(next);
        this.onAutoReduce(next);
        this.lag.cooldown = nowPerf + 4000;
      }
    }
    this.lag.late = 0;
    this.lag.gaps = 0;
    this.lag.since = nowPerf;
  }
}
