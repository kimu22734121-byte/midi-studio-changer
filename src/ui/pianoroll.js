// ピアノロール：音符を横長の棒で表示。音数を絞って鳴らさない音は薄く表示する。
const COLORS = { melody: '#ff5c8a', chords: '#4fb3ff', bass: '#ffc94d', drums: '#7ee07e', other: '#b48cff' };

export class PianoRoll {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.window = 8; // 表示する秒数
    this.list = [];
  }

  setSong(song) {
    this.song = song;
    this.list = [];
    let lo = 127, hi = 0;
    song.tracks.forEach((tr, ti) => {
      for (const n of tr.notes) {
        this.list.push({ n, ti, drum: tr.isDrum, color: COLORS[tr.role] || COLORS.other });
        if (!tr.isDrum) { lo = Math.min(lo, n.p); hi = Math.max(hi, n.p); }
      }
    });
    this.list.sort((a, b) => a.n.t - b.n.t);
    this.maxDur = this.list.reduce((m, x) => Math.max(m, x.n.d), 0);
    this.lo = lo > hi ? 48 : lo - 2;
    this.hi = lo > hi ? 84 : hi + 2;
  }

  draw(time, played, muted = []) {
    const c = this.canvas, g = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = getComputedStyle(c).getPropertyValue('--roll-bg') || '#111';
    g.fillRect(0, 0, w, h);
    if (!this.song) return;
    const t0 = time - this.window * 0.25;
    const t1 = t0 + this.window;
    const px = w / this.window;
    const drumH = h * 0.16;
    const pitchH = h - drumH - 4;
    const span = this.hi - this.lo + 1;
    const rowH = pitchH / span;
    // 開始位置を二分探索
    let lo = 0, hi = this.list.length;
    const from = t0 - this.maxDur;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.list[m].n.t < from) lo = m + 1; else hi = m; }
    for (let i = lo; i < this.list.length; i++) {
      const { n, ti, drum, color } = this.list[i];
      if (n.t > t1) break;
      if (n.t + n.d < t0) continue;
      const on = played.has(n) && !muted[ti];
      g.globalAlpha = on ? (n.t <= time && time < n.t + n.d ? 1 : 0.8) : 0.15;
      g.fillStyle = color;
      const x = (n.t - t0) * px;
      if (drum) {
        const lane = n.p === 36 || n.p === 35 ? 2 : n.p === 38 || n.p === 40 ? 1 : 0;
        g.fillRect(x, pitchH + 4 + (lane * drumH) / 3, Math.max(3, 0.06 * px), drumH / 3 - 1);
      } else {
        const y = pitchH - (n.p - this.lo + 1) * rowH;
        g.fillRect(x, y, Math.max(2, n.d * px - 1), Math.max(2, rowH - 1));
      }
    }
    g.globalAlpha = 1;
    g.fillStyle = '#ffffffaa';
    g.fillRect((time - t0) * px, 0, 2, h);
  }
}
