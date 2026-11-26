// 再生エンジン：曲（Song）を Web Audio で鳴らす。
// 音数の上限に合わせて鳴らす音を選び（planVoices）、少し先の音を予約しながら再生する。
// 重くて音の予約が間に合わなくなったら、自動で音数を1段階減らす。
import { planVoices, lowerBound, songDuration, lowerPolyphony, POLY_DEFAULT } from '../core/song.js';
import { playTone, playDrum, isDrumKit } from './instruments.js';

const LOOKAHEAD = 0.2; // 秒
const TICK_MS = 25;

export class Player {
  constructor({ onEnd = () => {}, onAutoReduce = () => {} } = {}) {
    this.onEnd = onEnd;
    this.onAutoReduce = onAutoReduce;
    this.ctx = null;
    this.song = null;
    this.settings = []; // トラックごと { tone, muted, volume }
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
  }

  async ensureContext() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      this.buildTrackGains();
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
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
    this.settings = song.tracks.map((t) => ({ tone: t.tone, muted: false, volume: 1 }));
    this.duration = songDuration(song);
    this.buildTrackGains();
    this.replan();
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

  setTone(i, tone) { this.settings[i].tone = tone; }

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
      if (at < now - 0.05) { if (!hidden) this.lag.late++; continue; }
      const st = this.settings[ev.track];
      const dest = this.trackGains[ev.track];
      const when = Math.max(at, now);
      const v = isDrumKit(st.tone)
        ? playDrum(ctx, dest, st.tone, { when, pitch: ev.p, vel: ev.v })
        : playTone(ctx, dest, st.tone, { when, dur: ev.d, pitch: ev.p, vel: ev.v });
      this.voices.push(v);
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
