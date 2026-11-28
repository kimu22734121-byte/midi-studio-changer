// テスト用：J-POP のボカロ曲風の試験曲（ステレオ）。本物の録音の楽器の音（生音セット＝MuseScore の音）で鳴らす。
//  - 前奏 4 小節（ピアノの分散和音＋キラキラした音だけ。ドラム・歌なし）→ 本編（全部）
//  - 歌：ボカロのような揺れのない声。高めで、細かく動き、跳ねる
//  - ピアノ：8分の分散和音（主役の伴奏、左右に広がる）／ キラキラ（グロッケン）：16分のアルペジオ（右寄り）
//  - ストリングス：和音を伸ばす（左右に広げる）／ ベース：指弾きの8分（ときどきオクターブ上）
//  - ドラム：バスドラ・スネア・8分のハイハット・区切りのシンバル・最後の小節にフィル
//  - 和音：切ない王道進行（F G Em Am）
import { readFileSync } from 'node:fs';
import { parseSf2 } from '../src/audio/sf2.js';
import { pickRegions } from '../src/audio/sf-bank.js';

let SF = null;
const sf = () => (SF ??= parseSf2(readFileSync(new URL('../soundfonts/midichen-real.sf2', import.meta.url))));
const presetOf = (program, drum = false) => sf().presets.find((p) => p.program === program && p.bank === (drum ? 128 : 0));

/** サウンドフォントで1音を鳴らして足し込む（簡単な再生：音の高さ・ループ・音量の変化・左右） */
function renderNote(L, R, sr, preset, { t, d, p, v }, pan = 0, gain = 1) {
  const { regions, pitch } = pickRegions(preset, p, v);
  const pcm = sf().pcm;
  for (const r of regions) {
    const step = (2 ** (((pitch - r.root) * (r.scaleTuning ?? 100) + r.tune) / 1200) * r.rate) / sr;
    const len = r.end - r.start;
    const amp = 10 ** (-r.attenuation / 200) * (v / 127) ** 2 * gain;
    const sus = 10 ** (-r.sustain / 200);
    const rel = Math.min(Math.max(r.release, 0.03), 1.5);
    const total = d + rel;
    const pp = Math.max(-1, Math.min(1, pan + r.pan / 500));
    const gl = Math.cos(((pp + 1) * Math.PI) / 4), gr = Math.sin(((pp + 1) * Math.PI) / 4);
    const a = Math.floor(t * sr), n = Math.floor(total * sr);
    let pos = 0;
    for (let i = 0; i < n; i++) {
      if (!r.loop && pos >= len - 1) break;
      if (r.loop && pos >= r.loopEnd) pos -= r.loopEnd - r.loopStart;
      const k = pos | 0, f = pos - k;
      const s = (pcm[r.start + k] * (1 - f) + pcm[r.start + k + 1] * f) / 32768;
      const tt = i / sr;
      let env;
      if (tt < r.attack) env = tt / Math.max(1e-3, r.attack);
      else env = sus + (1 - sus) * Math.exp(-(tt - r.attack - r.hold) / Math.max(0.01, r.decay / 5));
      if (tt > d) env *= Math.exp(-(tt - d) / (rel / 5));
      const val = s * env * amp;
      const j = a + i;
      if (j >= 0 && j < L.length) { L[j] += val * gl; R[j] += val * gr; }
      pos += step;
    }
  }
}

const CH = { F: [5, [0, 4, 7, 11]], G: [7, [0, 4, 7]], Em: [4, [0, 3, 7, 10]], Am: [9, [0, 3, 7, 10]], C: [0, [0, 4, 7]], Dm: [2, [0, 3, 7]] };
const PROG = ['F', 'G', 'Em', 'Am', 'F', 'G', 'Am', 'Am'];

export function synthJpopSong({ sr = 22050, bpm = 150, bars = 16, intro = 4, seed = 5, vocalLevel = 0.22 } = {}) {
  const beat = 60 / bpm, e8 = beat / 2, e16 = beat / 4;
  const t0 = 0.4;
  const len = Math.ceil((t0 + bars * 4 * beat + 2) * sr);
  const L = new Float32Array(len), R = new Float32Array(len);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const truth = { melody: [], bass: [], chords: [], piano: [], bell: [], drums: [] };
  const piano = presetOf(0), bell = presetOf(9), strings = presetOf(48), bass = presetOf(33), kit = presetOf(0, true);

  for (let bar = 0; bar < bars; bar++) {
    const name = PROG[bar % 8];
    const [root, iv] = CH[name];
    const tb = t0 + bar * 4 * beat;
    const full = bar >= intro;
    truth.chords.push({ t: tb, d: 4 * beat, root, name, pcs: iv.slice(0, 3).map((x) => (root + x) % 12) });
    // ピアノ：左手で根っこ、右手で8分の分散和音（左右に広がる：低い音は左、高い音は右）
    const lh = 48 + root - (root > 7 ? 12 : 0);
    const n1 = { t: tb, d: 4 * beat * 0.95, p: lh, v: 80 };
    renderNote(L, R, sr, piano, n1, -0.5, 0.8); truth.piano.push(n1);
    const up = iv.map((x) => 60 + ((root + x) % 12)).sort((a, b) => a - b);
    const pat = [0, 1, 2, 3 % up.length, 2, 1, 2, 3 % up.length];
    for (let k = 0; k < 8; k++) {
      const p = up[pat[k] % up.length] + (k >= 4 && up.length < 4 ? 12 : 0);
      const n = { t: tb + k * e8, d: e8 * 1.6, p, v: 70 + Math.round(rnd() * 15) };
      renderNote(L, R, sr, piano, n, 0.3 + (p - 60) / 40, 0.8);
      truth.piano.push(n);
    }
    // キラキラ（グロッケン）：16分のアルペジオ、右寄り（前奏と、本編の後半）
    if (!full || bar >= intro + 4) {
      const arp = iv.slice(0, 3).map((x) => 84 + ((root + x) % 12)).sort((a, b) => a - b);
      for (let k = 0; k < 16; k += 2) {
        const p = arp[(k / 2) % 3] + (k >= 8 ? 12 : 0);
        const n = { t: tb + k * e16, d: e16 * 1.5, p, v: 60 };
        renderNote(L, R, sr, bell, n, 0.7, 0.35);
        truth.bell.push(n);
      }
    }
    if (!full) continue;
    // ストリングス：和音を伸ばす（左右に広げる）
    for (const [i, x] of iv.slice(0, 3).entries()) renderNote(L, R, sr, strings, { t: tb, d: 4 * beat, p: 64 + ((root + x) % 12) - (i === 0 ? 12 : 0), v: 60 }, i === 1 ? 0.8 : -0.8, 0.5);
    // ベース：8分（4つ目と8つ目は1オクターブ上）
    const br = 33 + ((root - 9 + 12) % 12); // A1〜G#2
    for (let k = 0; k < 8; k++) {
      const p = br + (k % 4 === 3 ? 12 : 0);
      const n = { t: tb + k * e8, d: e8 * 0.85, p, v: 100 };
      renderNote(L, R, sr, bass, n, 0, 1.2);
      truth.bass.push(n);
    }
    // ドラム
    const hit = (p, t, kind, v = 100, g = 1) => { renderNote(L, R, sr, kit, { t, d: 0.2, p, v }, p === 42 ? 0.3 : p === 49 ? -0.3 : 0, g); truth.drums.push({ t, kind }); };
    const fill = bar === bars - 1;
    for (let k = 0; k < 8; k++) {
      const t = tb + k * e8;
      if (k === 0 || k === 3 || k === 4) hit(36, t, 'kick');
      if ((k === 2 || k === 6) && !(fill && k === 6)) hit(38, t, 'snare');
      if (!fill || k < 4) hit(42, t, 'hat', k % 2 ? 70 : 95, 0.6);
    }
    if (fill) for (let k = 12; k < 16; k++) hit(38, tb + k * e16, 'snare', 90);
    if ((bar - intro) % 8 === 0) hit(49, tb, 'crash', 100, 0.8);
  }
  // 歌（ボカロ風）：揺れがなく、すばやく次の音へ。高めで、跳ねる
  const phrase = [[76, 2], [77, 1], [79, 1], [81, 2], [79, 2], [77, 1], [76, 1], [74, 2], [76, 4], [null, 2], [72, 1], [74, 1], [76, 2], [84, 2], [83, 2], [81, 2], [79, 4], [null, 4],
    [77, 1], [79, 1], [81, 2], [81, 1], [83, 1], [84, 4], [83, 2], [81, 2], [79, 2], [76, 2], [77, 3], [76, 1], [74, 4], [null, 4]];
  const hz = (p) => 440 * 2 ** ((p - 69) / 12);
  let pos = intro * 16, prevF = null;
  const total = bars * 16;
  while (pos < total) {
    for (const [p, n] of phrase) {
      if (pos >= total) break;
      if (p !== null) {
        const t = t0 + pos * e16, d = n * e16 * 0.92;
        const f0 = hz(p), fStart = prevF ?? f0;
        const a = Math.floor(t * sr), e = Math.floor((t + d) * sr);
        let ph = 0;
        for (let i = a; i < e && i < len; i++) {
          const tt = (i - a) / sr;
          const f = tt < 0.025 ? fStart + (f0 - fStart) * (tt / 0.025) : f0;
          ph += (2 * Math.PI * f) / sr;
          let v = 0;
          for (let h = 1; h <= 16; h++) {
            const fh = f * h;
            if (fh > sr * 0.45) break;
            v += (Math.sin(h * ph) / h ** 0.6) * (1 / (1 + ((fh - 800) / 350) ** 2) + 0.6 / (1 + ((fh - 1300) / 400) ** 2) + 0.35 / (1 + ((fh - 3000) / 600) ** 2) + 0.05);
          }
          const val = vocalLevel * v * Math.min(1, tt / 0.012) * Math.min(1, (e - i) / sr / 0.025);
          L[i] += val * 0.7; R[i] += val * 0.7;
          // 歌のやまびこ（少し遅れて左右に）
          const j = i + Math.floor(0.18 * sr);
          if (j < len) { L[j] += val * 0.12; R[j] -= val * 0.06; }
        }
        truth.melody.push({ t, d, p });
        prevF = f0;
      } else prevF = null;
      pos += n;
    }
  }
  // 仕上げ（音量をそろえて、少しだけ詰め込む）
  let pk = 0;
  for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const g = 1.4 / pk;
  for (let i = 0; i < len; i++) { L[i] = Math.tanh(L[i] * g) * 0.9; R[i] = Math.tanh(R[i] * g) * 0.9; }
  return { L, R, sr, bpm, truth, t0 };
}

/** 正解と比べる。時間は「何拍目か」で比べる（off：拍のずれ） */
export function jpopScore(song, x, off) {
  const sb = 60 / song.bpm, ob = 60 / x.bpm;
  const base = song.tracks.filter((t) => !t.layer);
  const tr = (pred) => base.filter(pred).flatMap((t) => t.notes).map((n) => ({ ...n, b: n.t / sb + off }));
  const T = (arr) => arr.map((n) => ({ ...n, b: (n.t - x.t0) / ob }));
  const f1 = (found, want, match) => {
    const used = new Set();
    let hit = 0;
    for (const w of want) {
      const k = found.findIndex((y, i) => !used.has(i) && match(y, w));
      if (k >= 0) { used.add(k); hit++; }
    }
    const rec = want.length ? hit / want.length : 0, pre = found.length ? hit / found.length : 0;
    return { rec, pre, f: rec + pre ? (2 * rec * pre) / (rec + pre) : 0 };
  };
  const near = (a, w, tol = 0.13) => Math.abs(a.b - w.b) < tol;
  const drums = tr((t) => t.isDrum);
  const kind = (p) => (p === 35 || p === 36 ? 'kick' : [37, 38, 39, 40].includes(p) ? 'snare' : [42, 44, 46].includes(p) ? 'hat' : [49, 57, 52, 55, 51].includes(p) ? 'crash' : 'other');
  const td = T(x.truth.drums);
  const dk = (k) => f1(drums.filter((n) => kind(n.p) === k), td.filter((d) => d.kind === k), near);
  const band = tr((t) => !t.isDrum && (t.role === 'chords' || t.role === 'other'));
  let chordOk = 0;
  const tc = T(x.truth.chords);
  for (const c of tc) {
    const on = band.filter((n) => n.b < c.b + 4 && n.b + n.d / sb > c.b + 0.2);
    const pcs = new Set(on.map((n) => n.p % 12));
    if (pcs.has(c.root) && c.pcs.filter((y) => pcs.has(y)).length >= 2) chordOk++;
  }
  return {
    melody: f1(tr((t) => t.role === 'melody'), T(x.truth.melody), (a, w) => a.p === w.p && near(a, w)),
    bassExact: f1(tr((t) => t.role === 'bass'), T(x.truth.bass), (a, w) => a.p === w.p && near(a, w)),
    bassOct: f1(tr((t) => t.role === 'bass'), T(x.truth.bass), (a, w) => (a.p - w.p) % 12 === 0 && near(a, w)),
    piano: f1(band, T(x.truth.piano), (a, w) => (a.p - w.p) % 12 === 0 && near(a, w)),
    chordBars: chordOk / tc.length,
    kick: dk('kick'), snare: dk('snare'), hat: dk('hat'), crash: dk('crash'),
  };
}
