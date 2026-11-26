// 曲データ（Song）の形と、音数（同時発音数）の選び方。
//
// Song = {
//   title: string,
//   bpm: number,                 // 1分あたりの拍の数（表示・MIDI保存用）
//   source: string,              // 'audio' | 'midi' | 'mic' | 'abc' | 'chords' | 'musicxml'
//   tracks: [{
//     name: string,
//     role: 'melody' | 'chords' | 'bass' | 'drums' | 'other',
//     isDrum: boolean,
//     tone: string,              // 波形シンセの音色ID（src/audio/instruments.js）
//     program: number | null,    // 元の楽器番号（GM 0-127）。MIDI・MusicXMLのときだけ。null ならセットのおすすめ楽器を使う
//     layer: number,             // 0=元のパート、1以上=編成（src/core/arrange.js）で増やしたパート
//     notes: [{ t, d, p, v }]    // t=開始(秒) d=長さ(秒) p=音の高さ(MIDI番号) v=強さ(1-127)
//   }]
// }

export const ROLE_LABELS = {
  melody: 'メロディ',
  chords: '伴奏（和音）',
  bass: 'ベース',
  drums: 'ドラム',
  other: 'その他の楽器',
};

// 音数スライダーの刻み：1〜8は1音刻み、そこから倍々
export const POLY_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 16, 32, 64, 128];
export const POLY_DEFAULT = 64;
export const POLY_MAX = 128;

export function nearestStepIndex(n) {
  let best = 0;
  for (let i = 0; i < POLY_STEPS.length; i++) {
    if (Math.abs(POLY_STEPS[i] - n) < Math.abs(POLY_STEPS[best] - n)) best = i;
  }
  return best;
}

export function clampPolyphony(n) {
  n = Math.round(Number(n));
  if (!Number.isFinite(n)) return POLY_DEFAULT;
  return Math.max(1, Math.min(POLY_MAX, n));
}

/** 重いときに1段階減らした音数（下限4） */
export function lowerPolyphony(n) {
  const lower = POLY_STEPS.filter((s) => s < n && s >= 4);
  return lower.length ? lower[lower.length - 1] : n;
}

export function createSong({ title = '無題', bpm = 120, source = '', tracks = [] }) {
  const song = { title, bpm, source, tracks: [] };
  for (const tr of tracks) {
    if (!tr.notes || tr.notes.length === 0) continue;
    const notes = tr.notes
      .filter((n) => n.d > 0 && n.t >= 0 && n.p >= 0 && n.p <= 127)
      .map((n) => ({ t: n.t, d: n.d, p: n.p | 0, v: Math.max(1, Math.min(127, Math.round(n.v ?? 100))) }))
      .sort((a, b) => a.t - b.t || a.p - b.p);
    if (!notes.length) continue;
    song.tracks.push({
      name: tr.name || ROLE_LABELS[tr.role] || 'トラック',
      role: tr.role || 'other',
      isDrum: !!tr.isDrum,
      tone: tr.tone || defaultTone(tr.role, tr.isDrum),
      program: Number.isInteger(tr.program) ? tr.program : null,
      layer: tr.layer || 0, // 0=元のパート、1以上=編成で増やしたパート
      notes,
    });
  }
  return song;
}

export function defaultTone(role, isDrum) {
  if (isDrum || role === 'drums') return 'kit-synth';
  return { melody: 'lead', chords: 'pad', bass: 'bass', other: 'square' }[role] || 'square';
}

export function songDuration(song) {
  let end = 0;
  for (const tr of song.tracks) for (const n of tr.notes) end = Math.max(end, n.t + n.d);
  return end;
}

export function noteCount(song) {
  return song.tracks.reduce((s, t) => s + t.notes.length, 0);
}

const ROLE_PRIORITY = { melody: 4, bass: 3, drums: 2.5, chords: 1, other: 1.5 };

/**
 * 同時に鳴らせる音の数 limit に合わせて、鳴らす音を選ぶ。
 * 大事な役割（メロディ > ベース > ドラム > 伴奏）を優先して残し、
 * 足りないときは優先度の低い音を途中で止めるか、新しい音を鳴らさない。
 * 戻り値：時間順のイベント [{ t, d, p, v, track, note }]
 */
export function planVoices(song, limit, { muted = [] } = {}) {
  const all = [];
  song.tracks.forEach((tr, ti) => {
    if (muted[ti]) return;
    // 編成で増やしたパートは、元のパートより必ず後回し（層が浅いものから残す）
    const base = tr.layer ? 0.9 - tr.layer * 0.12 : ROLE_PRIORITY[tr.role] ?? 1;
    // 和音の一番上と一番下の音は、内側の音より少し大事にする
    const edges = tr.role === 'chords' || tr.role === 'other' ? chordEdges(tr.notes) : null;
    for (const n of tr.notes) {
      let pr = base + (n.v / 127) * (tr.layer ? 0.05 : 0.4);
      if (edges && !tr.layer && edges.has(n)) pr += 0.3;
      all.push({ t: n.t, d: n.d, p: n.p, v: n.v, track: ti, note: n, pr, drum: tr.isDrum });
    }
  });
  all.sort((a, b) => a.t - b.t || b.pr - a.pr);
  if (limit >= all.length) return all.map(strip);

  const out = [];
  const active = []; // { ev, end }
  for (const ev of all) {
    const end = ev.t + (ev.drum ? Math.min(ev.d, 0.15) : ev.d);
    for (let i = active.length - 1; i >= 0; i--) if (active[i].end <= ev.t + 1e-6) active.splice(i, 1);
    if (active.length < limit) {
      active.push({ ev, end });
      out.push(ev);
      continue;
    }
    let low = 0;
    for (let i = 1; i < active.length; i++) {
      const a = active[i].ev, b = active[low].ev;
      if (a.pr < b.pr || (a.pr === b.pr && a.t < b.t)) low = i;
    }
    if (ev.pr > active[low].ev.pr) {
      const cut = active[low].ev;
      cut.d = Math.max(0.01, ev.t - cut.t); // 途中で止める
      active.splice(low, 1);
      active.push({ ev, end });
      out.push(ev);
    }
  }
  return out.map(strip);
}

function strip(e) {
  return { t: e.t, d: e.d, p: e.p, v: e.v, track: e.track, note: e.note };
}

function chordEdges(notes) {
  const set = new Set();
  let i = 0;
  while (i < notes.length) {
    let j = i;
    while (j + 1 < notes.length && Math.abs(notes[j + 1].t - notes[i].t) < 0.02) j++;
    let lo = notes[i], hi = notes[i];
    for (let k = i; k <= j; k++) {
      if (notes[k].p < lo.p) lo = notes[k];
      if (notes[k].p > hi.p) hi = notes[k];
    }
    set.add(lo); set.add(hi);
    i = j + 1;
  }
  return set;
}

export function lowerBound(events, t) {
  let lo = 0, hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].t < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}
