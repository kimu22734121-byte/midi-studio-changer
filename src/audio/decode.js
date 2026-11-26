// 音楽ファイル・録音データ → 解析用のモノラル音声（ブラウザの機能で読み込み、22050Hzに変換）
export async function decodeToMono(arrayBuffer, targetRate) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const tmp = new AC();
  let buf;
  try {
    buf = await tmp.decodeAudioData(arrayBuffer.slice(0));
  } catch {
    throw new Error('この音楽ファイルは読み込めませんでした（MP3・WAV・M4A などを試してください）');
  } finally {
    tmp.close?.();
  }
  const frames = Math.ceil((buf.duration * targetRate));
  const off = new OfflineAudioContext(1, frames, targetRate);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination); // 複数チャンネルは自動で1つにまとめられる
  src.start();
  const out = await off.startRendering();
  return { samples: out.getChannelData(0).slice(), sampleRate: targetRate, duration: buf.duration };
}
