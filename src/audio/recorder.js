// マイク録音。録音中は音の大きさを返し、止めると録音データ（ArrayBuffer）を返す。
export class MicRecorder {
  async start(onLevel = () => {}) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('このブラウザはマイク録音に対応していません');
    this.stream = await navigator.mediaDevices.getUserMedia({
      // 音楽を録るので、通話向けの加工は切る
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const src = this.ctx.createMediaStreamSource(this.stream);
    const an = this.ctx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const data = new Float32Array(an.fftSize);
    const loop = () => {
      an.getFloatTimeDomainData(data);
      let s = 0;
      for (const v of data) s += v * v;
      onLevel(Math.min(1, Math.sqrt(s / data.length) * 4));
      this.raf = requestAnimationFrame(loop);
    };
    loop();
    this.chunks = [];
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => window.MediaRecorder?.isTypeSupported?.(m));
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(250);
    this.startedAt = performance.now();
  }

  get elapsed() {
    return this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  stop() {
    return new Promise((resolve) => {
      cancelAnimationFrame(this.raf);
      this.rec.onstop = async () => {
        this.stream.getTracks().forEach((t) => t.stop());
        this.ctx.close?.();
        const blob = new Blob(this.chunks, { type: this.rec.mimeType || 'audio/webm' });
        resolve(await blob.arrayBuffer());
      };
      this.rec.stop();
    });
  }
}
