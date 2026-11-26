// サウンドフォントの「セット」一覧と読み込み。
// セットを増やすときは SETS に1件足して、soundfonts/ に .sf2 を置くだけでよい。
import { parseSf2 } from './sf2.js';
import { SoundFontBank } from './sf-bank.js';

// roles：音声や楽譜テキストから作った曲（元の楽器が決まっていない曲）で、パートごとに使う楽器の番号
// fx：響き（reverb）・コーラス（chorus）・やまびこ（echo）の量
// gain：セットごとの音量の差をそろえるための倍率
export const SETS = [
  {
    id: 'wave', icon: '⚡', label: '軽い波形シンセ', desc: '読み込みなし・いちばん軽い。左右に広がる厚めのシンセとピコピコ音',
    builtin: true, gain: 0.85, fx: { chorus: 0.3, reverb: { wet: 0.16, time: 1.8 } },
  },
  {
    id: 'orchestra', icon: '🎻', label: 'オーケストラ（豪華）', desc: 'スタジオで録音した弦・金管・木管・ハープ・ティンパニ・合唱。ホールの響き付き',
    file: 'soundfonts/midichen-orchestra.sf2', size: 32.6, gain: 1.0,
    roles: { melody: 40, chords: 48, bass: 32, other: 46 }, fx: { reverb: { wet: 0.42, time: 3.2 } },
  },
  {
    id: 'jazz', icon: '🎷', label: 'ジャズ・ピアノトリオ（豪華）', desc: 'コンサート用グランドピアノ・ウッドベース・ジャズドラムを録音した音',
    file: 'soundfonts/midichen-jazz.sf2', size: 27.3, gain: 1.88,
    roles: { melody: 0, chords: 0, bass: 32, other: 0 }, fx: { reverb: { wet: 0.24, time: 2.0 } },
  },
  {
    id: 'gm', icon: '🎹', label: '標準（いろいろな楽器）', desc: 'ピアノ・ギター・ストリングス・ドラムなど128種類。どんな曲にも合う',
    file: 'soundfonts/GeneralUser-GS.sf2', size: 32.3, gain: 1.85,
    roles: { melody: 80, chords: 48, bass: 38, other: 0 }, fx: { reverb: { wet: 0.2, time: 1.8 } },
  },
  {
    id: 'synth', icon: '🌌', label: 'シンセ', desc: 'スーパーソー・FMエレピ・アナログベースなど、キラキラした電子音',
    file: 'soundfonts/midichen-synth.sf2', size: 3.0, gain: 0.69,
    roles: { melody: 81, chords: 48, bass: 32, other: 4 }, fx: { chorus: 0.35, reverb: { wet: 0.22, time: 2.2 } },
  },
  {
    id: 'space', icon: '🚀', label: '宇宙（アンビエント）', desc: '広がるパッドと長い響き・やまびこで、宇宙をただようような音',
    file: 'soundfonts/midichen-synth.sf2', size: 3.0, gain: 0.4, labels: 'synth', shared: 'シンセと共通',
    roles: { melody: 82, chords: 91, bass: 33, other: 96 },
    fx: { chorus: 0.3, reverb: { wet: 0.55, time: 5.5 }, echo: { time: 0.42, feedback: 0.42, wet: 0.22 } },
  },
  {
    id: 'sfc', icon: '🕹️', label: 'スーファミ風', desc: '標準の音をざらっと粗くして、やまびこ（エコー）をかけた懐かしい音',
    file: 'soundfonts/GeneralUser-GS.sf2', size: 32.3, lofi: true, gain: 1.2, labels: 'gm', shared: '標準と共通',
    roles: { melody: 73, chords: 48, bass: 33, other: 46 }, fx: { echo: { time: 0.24, feedback: 0.38, wet: 0.32 } },
  },
  {
    id: 'chip', icon: '👾', label: 'ファミコン風', desc: '矩形波・三角波・ノイズのピコピコ音（アプリ独自）',
    file: 'soundfonts/midichen-chip.sf2', size: 0.7, gain: 0.47,
    roles: { melody: 80, chords: 81, bass: 32, other: 0 },
  },
];

// 画面に出す楽器名（GMの番号 → 日本語）
export const GM_NAMES = [
  'グランドピアノ', 'ブライトピアノ', 'エレクトリックグランド', 'ホンキートンクピアノ', 'エレピ1', 'エレピ2', 'チェンバロ', 'クラビ',
  'チェレスタ', 'グロッケン', 'オルゴール', 'ビブラフォン', 'マリンバ', '木琴', 'チューブラーベル', 'ダルシマー',
  'ドローバーオルガン', 'パーカッシブオルガン', 'ロックオルガン', 'パイプオルガン', 'リードオルガン', 'アコーディオン', 'ハーモニカ', 'バンドネオン',
  'ナイロンギター', 'スチールギター', 'ジャズギター', 'クリーンギター', 'ミュートギター', 'オーバードライブギター', 'ディストーションギター', 'ギターハーモニクス',
  'アコースティックベース', '指弾きベース', 'ピック弾きベース', 'フレットレスベース', 'スラップベース1', 'スラップベース2', 'シンセベース1', 'シンセベース2',
  'バイオリン', 'ビオラ', 'チェロ', 'コントラバス', 'トレモロストリングス', 'ピチカート', 'ハープ', 'ティンパニ',
  'ストリングス', 'スローストリングス', 'シンセストリングス1', 'シンセストリングス2', '合唱「アー」', '声「ウー」', 'シンセボイス', 'オーケストラヒット',
  'トランペット', 'トロンボーン', 'チューバ', 'ミュートトランペット', 'ホルン', 'ブラス', 'シンセブラス1', 'シンセブラス2',
  'ソプラノサックス', 'アルトサックス', 'テナーサックス', 'バリトンサックス', 'オーボエ', 'イングリッシュホルン', 'ファゴット', 'クラリネット',
  'ピッコロ', 'フルート', 'リコーダー', 'パンフルート', 'ビン笛', '尺八', '口笛', 'オカリナ',
  '矩形波リード', 'のこぎり波リード', 'カリオペ', 'チフ', 'チャランゴ', 'ボイスリード', '5度リード', 'ベース＋リード',
  'ニューエイジパッド', 'ウォームパッド', 'ポリシンセ', 'クワイアパッド', 'ボウパッド', 'メタリックパッド', 'ヘイローパッド', 'スイープパッド',
  '雨', 'サウンドトラック', 'クリスタル', 'アトモスフィア', 'ブライトネス', 'ゴブリン', 'エコー', 'SF',
  'シタール', 'バンジョー', '三味線', '琴', 'カリンバ', 'バグパイプ', 'フィドル', 'シャナイ',
  'ティンクルベル', 'アゴゴ', 'スチールドラム', 'ウッドブロック', '太鼓', 'メロディックタム', 'シンセドラム', '逆再生シンバル',
  'ギターのノイズ', '息の音', '波の音', '鳥の声', '電話', 'ヘリコプター', '拍手', '銃声',
];

// アプリ独自セットの楽器名
const LABELS = {
  chip: {
    0: 'ピコピコピアノ', 8: 'ピコピコベル', 16: 'ピコオルガン', 24: 'ピコギター', 32: 'ファミコンベース（三角波）', 40: 'ピコストリングス',
    48: 'ピコアンサンブル', 56: 'ピコブラス', 64: '細いピコ笛', 72: 'ピコ笛（三角波）', 80: 'ピコリード（25%）', 81: 'ピコリード（50%）',
    82: 'ピコリード（細い）', 88: 'ピコパッド', 96: 'ピコきらきら', 112: 'ピコ打楽器', 120: 'ノイズ効果音',
  },
  synth: {
    4: 'FMエレピ', 8: 'FMベル', 16: 'シンセオルガン', 24: 'シンセプラック', 32: 'アナログベース', 33: 'サブベース', 38: 'シンセベース（矩形）',
    40: 'シンセストリングス', 48: 'スーパーソー', 56: 'シンセブラス', 80: '矩形波リード', 81: 'のこぎり波リード', 82: 'やわらかリード',
    88: 'ドリームパッド', 89: 'ウォームパッド', 91: '宇宙パッド', 96: '宇宙きらきら',
  },
  orchestra: {
    0: 'グランドピアノ', 32: 'ウッドベース', 40: 'バイオリン', 43: 'コントラバス', 44: 'トレモロの弦', 45: 'ピチカートの弦',
    48: 'オーケストラの弦（合奏）', 49: 'ゆったりした弦', 50: 'シンセの弦', 52: '合唱「アー」', 53: '声「ウー」', 55: 'オーケストラヒット',
    59: 'ミュートトランペット', 60: 'ホルン', 61: '金管合奏', 19: '教会オルガン',
  },
  jazz: { 0: 'グランドピアノ', 1: 'グランドピアノ（明るめ）', 32: 'ウッドベース' },
};
const KIT_LABELS = { chip: 'ファミコンドラム', synth: '電子ドラム', orchestra: 'オーケストラ打楽器', jazz: 'ジャズドラム' };
const GM_KITS = {
  0: 'スタンダードドラム', 1: 'スタンダードドラム2', 8: 'ルームドラム', 16: 'パワードラム', 24: 'エレクトリックドラム', 25: 'TR-808風ドラム',
  26: 'ダンスドラム', 32: 'ジャズドラム', 40: 'ブラシドラム', 48: 'オーケストラ打楽器', 56: '効果音セット',
};

export function presetLabel(setId, preset) {
  const key = SETS.find((x) => x.id === setId)?.labels || setId;
  if (preset.bank === 128) return KIT_LABELS[key] || GM_KITS[preset.program] || `ドラム：${preset.name}`;
  return LABELS[key]?.[preset.program] || GM_NAMES[preset.program] || preset.name;
}

const parsed = new Map(); // file → parseSf2 の結果（スーファミ風と標準で共有）
const CACHE = 'midichen-soundfonts-v1';

async function fetchWithProgress(url, onProgress) {
  // 一度ダウンロードしたら端末に保存して、次からは通信しない
  let cache = null;
  try { cache = await caches.open(CACHE); } catch {}
  if (cache) {
    const hit = await cache.match(url).catch(() => null);
    if (hit) return hit.arrayBuffer();
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`サウンドフォントをダウンロードできませんでした（${res.status}）`);
  // 端末への保存はブラウザに任せる（メモリ上でコピーを作らない）
  if (cache) cache.put(url, res.clone()).catch(() => {});
  const total = Number(res.headers.get('content-length')) || 0;
  let buf;
  if (res.body && total) {
    const reader = res.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      onProgress(Math.min(1, got / total));
    }
    const out = new Uint8Array(got);
    let p = 0;
    for (const v of parts) { out.set(v, p); p += v.length; }
    buf = out.buffer;
  } else {
    buf = await res.arrayBuffer();
  }
  return buf;
}

/** このセットがもう端末に保存されているか（ダウンロードなしで使えるか） */
export async function isCached(set) {
  if (set.builtin) return true;
  if (!set.file) return false;
  if (parsed.has(set.file)) return true;
  try {
    const cache = await caches.open(CACHE);
    return !!(await cache.match(set.file));
  } catch {
    return false;
  }
}

/** セットを読み込んで SoundFontBank を返す（波形シンセのときは null） */
export async function loadSet(set, onProgress = () => {}) {
  if (set.builtin) return null;
  let sf = set.sf || parsed.get(set.file);
  if (!sf) {
    const buf = await fetchWithProgress(set.file, onProgress);
    sf = parseSf2(buf);
    parsed.set(set.file, sf);
  }
  return new SoundFontBank(sf, { lofi: !!set.lofi });
}

/** 端末にある .sf2 ファイルをセットとして追加 */
export function setFromFile(arrayBuffer, fileName) {
  const sf = parseSf2(arrayBuffer);
  if (sf.compressed) throw new Error('音が圧縮された形式（SF3）のサウンドフォントには、まだ対応していません。.sf2 形式のものを選んでください');
  return {
    id: `user-${Date.now()}`, icon: '📂', label: sf.name || fileName.replace(/\.sf2$/i, ''),
    desc: `読み込んだファイル：${fileName}`, sf, user: true, gain: 1.2,
  };
}
