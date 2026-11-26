// サウンドフォントの「セット」一覧と読み込み。
// セットを増やすときは SETS に1件足して、soundfonts/ に .sf2 を置くだけでよい。
import { parseSf2 } from './sf2.js';
import { SoundFontBank } from './sf-bank.js';

export const SETS = [
  // roles：音声や楽譜テキストから作った曲（元の楽器が決まっていない曲）で、パートごとに使う楽器の番号
  {
    id: 'wave', icon: '⚡', label: '軽い波形シンセ', desc: '読み込みなし・いちばん軽い。ピコピコ〜シンセの基本の音',
    builtin: true,
  },
  {
    id: 'gm', icon: '🎹', label: '標準（いろいろな楽器）', desc: 'ピアノ・ストリングス・ギター・ドラムなど本物に近い音。128種類',
    file: 'soundfonts/GeneralUser-GS.sf2', size: 32.3, gain: 1.75,
    roles: { melody: 80, chords: 48, bass: 38, other: 0 },
  },
  {
    id: 'sfc', icon: '🕹️', label: 'スーファミ風', desc: '標準の音をざらっと粗くして、やまびこ（エコー）をかけた懐かしい音。標準と同じファイルなので追加のダウンロードなし',
    file: 'soundfonts/GeneralUser-GS.sf2', size: 32.3, lofi: true, echo: true, gain: 1.1,
    roles: { melody: 73, chords: 48, bass: 33, other: 46 },
  },
  {
    id: 'chip', icon: '👾', label: 'ファミコン風', desc: '矩形波・三角波・ノイズのピコピコ音（アプリ独自）',
    file: 'soundfonts/midichen-chip.sf2', size: 0.7, gain: 0.45,
    roles: { melody: 80, chords: 81, bass: 32, other: 0 },
  },
  {
    id: 'synth', icon: '🌌', label: 'シンセ', desc: 'キラキラした電子音・パッド・アナログベース（アプリ独自）',
    file: 'soundfonts/midichen-synth.sf2', size: 3.0, gain: 0.65,
    roles: { melody: 81, chords: 88, bass: 32, other: 4 },
  },
  {
    id: 'toy', icon: '🧸', label: 'おもちゃ箱', desc: 'オルゴール・トイピアノ・木琴・ウクレレ（アプリ独自）',
    file: 'soundfonts/midichen-toy.sf2', size: 5.0, gain: 0.62,
    roles: { melody: 10, chords: 0, bass: 32, other: 24 },
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
  toy: {
    0: 'トイピアノ', 9: 'グロッケン', 10: 'オルゴール', 12: 'マリンバ', 13: '木琴', 16: '鍵盤ハーモニカ', 21: 'アコーディオン', 22: 'ハーモニカ',
    24: 'ウクレレ', 32: 'おもちゃベース', 46: 'ハープ', 56: 'おもちゃラッパ', 74: 'リコーダー', 78: '口笛', 80: 'おもちゃピコピコ',
  },
};
const KIT_LABELS = { chip: 'ファミコンドラム', synth: '電子ドラム', toy: 'おもちゃドラム' };
const GM_KITS = {
  0: 'スタンダードドラム', 1: 'スタンダードドラム2', 8: 'ルームドラム', 16: 'パワードラム', 24: 'エレクトリックドラム', 25: 'TR-808風ドラム',
  26: 'ダンスドラム', 32: 'ジャズドラム', 40: 'ブラシドラム', 48: 'オーケストラ打楽器', 56: '効果音セット',
};

export function presetLabel(setId, preset) {
  if (preset.bank === 128) return KIT_LABELS[setId] || GM_KITS[preset.program] || `ドラム：${preset.name}`;
  return LABELS[setId]?.[preset.program] || GM_NAMES[preset.program] || preset.name;
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
  if (cache) cache.put(url, new Response(buf.slice(0))).catch(() => {});
  return buf;
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
  return {
    id: `user-${Date.now()}`, icon: '📂', label: sf.name || fileName.replace(/\.sf2$/i, ''),
    desc: `読み込んだファイル：${fileName}`, sf, user: true, gain: 1.2,
  };
}
