// 音楽ファイル・録音データ → 解析用の音声（ブラウザの機能で読み込み、22050Hzに変換）
// 左右2チャンネルの曲は、左右を分けたまま返す（歌は真ん中にあることが多く、左右の差が聴き取りの手がかりになる）
export async function decodeToMono(arrayBuffer, targetRate) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const tmp = new AC();
  let buf;
  try {
    buf = await tmp.decodeAudioData(arrayBuffer.slice(0));
  } catch {
    throw new Error('このファイルから音を読み込めませんでした（MP3・WAV・M4A、またはiPhoneの画面収録の動画を試してください）');
  } finally {
    tmp.close?.();
  }
  const stereo = buf.numberOfChannels >= 2;
  const frames = Math.ceil(buf.duration * targetRate);
  const off = new OfflineAudioContext(stereo ? 2 : 1, frames, targetRate);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  const out = await off.startRendering();
  const samples = out.getChannelData(0).slice(); // 左（モノラルならその音）
  const right = stereo ? out.getChannelData(1).slice() : null;
  // 左右がほとんど同じ（実質モノラル）なら、左右分けは使わない
  let peak = 0, diff = 0;
  for (let i = 0; i < samples.length; i += 16) {
    peak = Math.max(peak, Math.abs(samples[i]));
    if (right) diff = Math.max(diff, Math.abs(samples[i] - right[i]));
  }
  const useRight = right && diff > peak * 0.02 ? right : null;
  return { samples, right: useRight, sampleRate: targetRate, duration: buf.duration, silent: peak < 1e-3 };
}
