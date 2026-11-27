// 曲ごとに楽器を選ぶ（生音・オーケストラ・標準のセット用）。
// 曲の速さ・メロディの細かさや高さ・音の長さ・明るい曲か暗い曲かを見て、
// メロディ・伴奏・ベース・その他のパートの楽器と、自動で増やしたパートの楽器を決める。
// 画面や Web Audio には依存しない（純粋な関数）。

// 長調・短調の「音名ごとの出やすさ」（Krumhansl のキー・プロファイル）
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function corr(a, b) {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let s = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; }
  return s / Math.sqrt(sa * sb || 1);
}

/** 曲の性格を調べる */
export function songCharacter(song) {
  const beat = 60 / (song.bpm || 120);
  const base = song.tracks.filter((t) => !t.layer);
  const notesOf = (role) => base.filter((t) => t.role === role && !t.isDrum).flatMap((t) => t.notes);
  const mel = notesOf('melody');
  const chords = notesOf('chords');
  const drums = base.filter((t) => t.isDrum).flatMap((t) => t.notes);
  const span = (ns) => (ns.length ? Math.max(1, Math.max(...ns.map((n) => n.t + n.d)) - Math.min(...ns.map((n) => n.t))) : 1);
  const avg = (ns, f) => (ns.length ? ns.reduce((s, n) => s + f(n), 0) / ns.length : 0);

  // 明るい曲（長調）か暗い曲（短調）か：音名ごとの鳴っている長さで調べる
  const pc = new Array(12).fill(0);
  for (const t of base) if (!t.isDrum) for (const n of t.notes) pc[n.p % 12] += Math.min(n.d, 2 * beat);
  let bestMaj = -2, bestMin = -2;
  for (let k = 0; k < 12; k++) {
    const rot = pc.map((_, i) => pc[(i + k) % 12]);
    bestMaj = Math.max(bestMaj, corr(rot, MAJOR));
    bestMin = Math.max(bestMin, corr(rot, MINOR));
  }
  const bpm = song.bpm || 120;
  const melDensity = mel.length / span(mel); // 1秒あたりの音の数
  const melLen = avg(mel, (n) => n.d) / beat; // 1音の長さ（拍）
  const chordLen = avg(chords, (n) => n.d) / beat;
  const drumDensity = drums.length / span(drums);
  return {
    bpm,
    minor: bestMin > bestMaj + 0.02,
    melDensity,
    melHigh: avg(mel, (n) => n.p),
    melLen,
    chordLen,
    hasDrums: drums.length > 8,
    drumDensity,
    hasMelody: mel.length > 0,
  };
}

/** 曲の雰囲気の分け方：ゆったり（バラード）／ふつう（ポップス）／速い（ロック・ダンス） */
export function songMood(c) {
  if (c.bpm < 92 || (c.melLen >= 1.2 && c.melDensity < 2.2 && c.bpm < 120) || (!c.hasDrums && c.bpm < 110)) return 'slow';
  if (c.bpm >= 138 && c.hasDrums) return 'fast';
  return 'mid';
}

const MOOD_LABEL = { slow: 'ゆったりした', mid: 'ふつうの速さの', fast: '速くてノリのいい' };

// バンド風の曲で、自動で増やしたパートのオーケストラの楽器を、バンドに合う楽器に置きかえる
const BAND_REMAP = {
  46: 25, // ハープ → スチールギター（アルペジオ）
  14: 11, // チューブラーベル → ビブラフォン
  19: 16, // 教会オルガン → ドローバーオルガン
  47: 116, // ティンパニ → 太鼓（区切りで低く）
  45: 27, // ピチカート → クリーンギター（拍ごとに）
  12: 4, // マリンバ → エレピ
  70: 66, // ファゴット → テナーサックス
  58: 61, // チューバ → ブラス
  69: 65, // イングリッシュホルン → アルトサックス
  74: 73, // リコーダー → フルート
  75: 11, // パンフルート → ビブラフォン
  55: 61, // オーケストラヒット → ブラス
};
const ROCK_REMAP = { ...BAND_REMAP, 24: 27, 60: 61, 44: 29, 53: 89, 52: 89, 50: 89, 42: 29 };

/**
 * 曲に合った楽器を選ぶ。
 * @param style 'real'（生音・標準）| 'orchestra'
 * @returns { roles: {melody, chords, bass, other}, remap: {元の番号: 新しい番号}, mood, summary }
 */
export function chooseInstruments(song, style) {
  const c = songCharacter(song);
  const mood = songMood(c);
  const high = c.melHigh >= 74, low = c.melHigh && c.melHigh < 62;
  const busy = c.melDensity >= 4; // メロディが細かい
  const heldChords = c.chordLen >= 1.6; // 伴奏が長く伸ばす音
  let roles, remap = {};
  if (style === 'orchestra') {
    if (mood === 'slow') {
      roles = {
        melody: c.minor ? (low ? 42 : 68) : busy ? 73 : 40,
        chords: heldChords ? 48 : 46,
        bass: 43,
        other: 46,
      };
    } else if (mood === 'mid') {
      roles = {
        melody: busy || high ? 73 : c.minor ? 71 : 40,
        chords: heldChords ? 48 : 45,
        bass: heldChords ? 43 : 32,
        other: 46,
      };
    } else {
      roles = {
        melody: c.minor ? 40 : high ? 73 : 56,
        chords: heldChords ? 48 : 45,
        bass: 32,
        other: 60,
      };
    }
  } else {
    if (mood === 'slow') {
      roles = {
        melody: c.minor ? (low ? 42 : 68) : busy ? 73 : high ? 73 : 40,
        chords: heldChords ? 48 : 0,
        bass: 32,
        other: 24,
      };
    } else if (mood === 'mid') {
      roles = {
        melody: busy ? 73 : high ? 73 : c.minor ? 71 : 65,
        chords: heldChords ? 48 : 0,
        bass: 33,
        other: 25,
      };
      remap = BAND_REMAP;
    } else {
      roles = {
        melody: c.minor ? 29 : 56,
        chords: heldChords ? 48 : 27,
        bass: 34,
        other: c.minor ? 30 : 25,
      };
      remap = ROCK_REMAP;
    }
    if (!c.hasDrums && mood !== 'fast') remap = {}; // ドラムのない曲は、オーケストラの楽器のままの方が合う
  }
  const summary = `${MOOD_LABEL[mood]}${c.minor ? '暗め（さびしげ）' : '明るめ'}の曲`;
  return { roles, remap, mood, minor: c.minor, summary };
}
