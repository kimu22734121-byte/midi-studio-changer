// 画面の動き。解析は analysis/client.js、音は audio/engine.js に任せる。
import { analyzeAudio, loadMidi, loadScoreText, loadMusicXml, ANALYSIS_SR } from './analysis/client.js';
import { decodeToMono } from './audio/decode.js';
import { MicRecorder } from './audio/recorder.js';
import { Player } from './audio/engine.js';
import { TONES, DRUM_KITS } from './audio/instruments.js';
import { PianoRoll } from './ui/pianoroll.js';
import { writeMidi } from './core/midi-file.js';
import { POLY_STEPS, POLY_DEFAULT, ROLE_LABELS, nearestStepIndex, clampPolyphony, noteCount } from './core/song.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const EXAMPLE_ABC = `X:1
T:きらきら星（お試し）
M:4/4
L:1/4
Q:1/4=100
K:C
"C"C C G G|"F"A A "C"G2|"F"F F "C"E E|"G"D D "C"C2|
"C"G G "F"F F|"C"E E "G"D2|"C"G G "F"F F|"C"E E "G"D2|
"C"C C G G|"F"A A "C"G2|"F"F F "C"E E|"G"D D "C"C2|`;
const EXAMPLE_CHORDS = `テンポ 110
C G | Am Em | F C | F G
C G | Am Em | F G | C C`;

const PRESETS = {
  famicom: { poly: 4, tones: { melody: 'pulse25', chords: 'square', bass: 'triangle', other: 'pulse12', drums: 'kit-retro' } },
  sfc: { poly: 16, tones: { melody: 'lead', chords: 'strings', bass: 'bass', other: 'pluck', drums: 'kit-synth' } },
  rich: { poly: 64, tones: { melody: 'lead', chords: 'pad', bass: 'bass', other: 'piano', drums: 'kit-synth' } },
  original: { poly: 64, tones: null },
};

let song = null;
const roll = new PianoRoll($('#roll'));
const player = new Player({
  onEnd: () => updatePlayButton(),
  onAutoReduce: (n) => {
    setPolyUI(n);
    toast(`重くなってきたので、音の数を ${n} に減らしました`);
  },
});

// ---------- タブ ----------
for (const tab of $$('.tabs [role=tab]')) {
  tab.addEventListener('click', () => {
    for (const t of $$('.tabs [role=tab]')) t.setAttribute('aria-selected', String(t === tab));
    for (const p of $$('.panel')) p.hidden = p.dataset.panel !== tab.dataset.tab;
  });
}

// ---------- 状態表示 ----------
function showStatus(msg, p = null, error = false) {
  const st = $('#status');
  st.hidden = false;
  st.classList.toggle('error', error);
  $('#status-text').textContent = msg;
  $('#progress-bar').parentElement.hidden = p === null;
  if (p !== null) $('#progress-bar').style.width = `${Math.round(p * 100)}%`;
}
function hideStatus() { $('#status').hidden = true; }
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

async function run(task) {
  try {
    player.stop();
    updatePlayButton();
    await task();
  } catch (err) {
    console.error(err);
    showStatus(`うまくいきませんでした：${err.message || err}`, null, true);
  }
}

const baseName = (name) => name.replace(/\.[^.]+$/, '');

// ---------- 取り込み ----------
async function importAudioBuffer(buf, title, source, isVideo = false) {
  showStatus(isVideo ? '動画から音を取り出しています…' : '曲を読み込んでいます…', 0.02);
  const { samples, sampleRate, duration, silent } = await decodeToMono(buf, ANALYSIS_SR);
  if (silent) {
    throw new Error(isVideo
      ? '動画に音が入っていませんでした。配信サービス（Apple Music など）の曲は、画面収録すると音が消えるため取り込めません。'
      : '音がほとんど入っていないようです');
  }
  if (duration > 8 * 60) toast('長い曲なので、最初の8分だけ変換します');
  const s = await analyzeAudio(samples, sampleRate, {
    title, source,
    onProgress: (p, msg) => showStatus(msg, 0.05 + p * 0.95),
  });
  setSong(s);
  showStatus('変換できました！ 下の「聴く」で再生してみてください。', 1);
}

$('#audio-file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const isVideo = f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(f.name);
  // 長い画面収録は数百MBになり、スマホだと読み込めないことがある
  if (f.size > 400 * 1024 * 1024) {
    showStatus('ファイルが大きすぎます（400MBまで）。「写真」アプリで前後をカットして短くしてから選んでください。', null, true);
    return;
  }
  run(async () => importAudioBuffer(await f.arrayBuffer(), baseName(f.name), 'audio', isVideo));
});

$('#midi-file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) run(async () => { setSong(loadMidi(await f.arrayBuffer(), baseName(f.name))); showStatus('MIDIを読み込みました。', 1); });
});

$('#xml-file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) run(async () => { setSong(await loadMusicXml(await f.arrayBuffer(), f.name)); showStatus('楽譜を読み込みました。', 1); });
});

$('#load-text').addEventListener('click', () => run(async () => {
  const text = $('#score-text').value.trim();
  if (!text) throw new Error('楽譜が空っぽです');
  setSong(loadScoreText(text));
  showStatus('楽譜を読み込みました。', 1);
}));
$('#example-abc').addEventListener('click', () => { $('#score-text').value = EXAMPLE_ABC; });
$('#example-chords').addEventListener('click', () => { $('#score-text').value = EXAMPLE_CHORDS; });
$('#demo-btn').addEventListener('click', () => run(async () => {
  setSong(loadScoreText(EXAMPLE_ABC));
  showStatus('お試し曲を読み込みました。', 1);
  await player.play();
  updatePlayButton();
}));

// マイク録音
let recorder = null;
let recTimer = null;
$('#rec-btn').addEventListener('click', async () => {
  const btn = $('#rec-btn');
  if (!recorder) {
    try {
      player.stop();
      updatePlayButton();
      recorder = new MicRecorder();
      await recorder.start((lv) => { $('#rec-level').style.width = `${lv * 100}%`; });
      btn.textContent = '■ 録音を止めて変換する';
      btn.classList.add('recording');
      recTimer = setInterval(() => {
        $('#rec-time').textContent = fmt(recorder.elapsed);
        if (recorder.elapsed > 180) btn.click();
      }, 250);
    } catch (err) {
      recorder = null;
      showStatus(err.name === 'NotAllowedError' ? 'マイクの使用が許可されませんでした。ブラウザの設定でマイクを許可してください。' : `録音できませんでした：${err.message}`, null, true);
    }
  } else {
    clearInterval(recTimer);
    const r = recorder;
    recorder = null;
    btn.textContent = '● 録音をはじめる';
    btn.classList.remove('recording');
    $('#rec-level').style.width = '0';
    const buf = await r.stop();
    if (r.elapsed < 3) { showStatus('録音が短すぎます。3秒以上録ってください。', null, true); return; }
    run(() => importAudioBuffer(buf, `マイク録音 ${new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`, 'mic'));
  }
});

// ---------- 曲をセット ----------
function setSong(s) {
  song = s;
  player.setSong(s);
  roll.setSong(s);
  for (const el of $$('.needs-song')) el.hidden = false;
  $('#song-title').textContent = s.title;
  const parts = s.tracks.map((t) => ROLE_LABELS[t.role] || t.role);
  $('#song-info').textContent = `速さ：1分あたり${Math.round(s.bpm)}拍 ／ パート：${[...new Set(parts)].join('・')} ／ 音符 ${noteCount(s)}個`;
  renderTracks();
  setPolyUI(player.polyphony);
  updateTime();
  $('#player-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- 再生 ----------
function fmt(sec) {
  sec = Math.max(0, Math.floor(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
function updatePlayButton() {
  $('#play-btn').textContent = player.playing ? '⏸' : '▶';
  $('#play-btn').setAttribute('aria-label', player.playing ? '一時停止' : '再生');
}
let seeking = false;
function updateTime() {
  const t = player.currentTime, d = player.duration;
  $('#time').textContent = `${fmt(t)} / ${fmt(d)}`;
  if (!seeking) $('#seek').value = d ? Math.round((t / d) * 1000) : 0;
}
$('#play-btn').addEventListener('click', async () => {
  if (player.playing) player.pause(); else await player.play();
  updatePlayButton();
});
$('#stop-btn').addEventListener('click', () => { player.stop(); updatePlayButton(); updateTime(); });
$('#seek').addEventListener('input', () => { seeking = true; $('#time').textContent = `${fmt(($('#seek').value / 1000) * player.duration)} / ${fmt(player.duration)}`; });
$('#seek').addEventListener('change', () => { seeking = false; player.seek(($('#seek').value / 1000) * player.duration); });

function frame() {
  if (song) {
    updateTime();
    roll.draw(player.currentTime, player.played, player.settings.map((s) => s.muted));
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && song && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName)) {
    e.preventDefault();
    $('#play-btn').click();
  }
});

// ---------- 音の数 ----------
function setPolyUI(n) {
  $('#poly-slider').value = nearestStepIndex(n);
  $('#poly-number').value = n;
  for (const b of $$('.preset')) b.classList.remove('active');
}
function applyPoly(n) {
  n = clampPolyphony(n);
  player.setPolyphony(n);
  setPolyUI(n);
}
$('#poly-slider').addEventListener('input', (e) => applyPoly(POLY_STEPS[e.target.value]));
$('#poly-number').addEventListener('change', (e) => applyPoly(e.target.value));
$('#auto-reduce').addEventListener('change', (e) => { player.autoReduce = e.target.checked; });
setPolyUI(POLY_DEFAULT);

for (const b of $$('.preset')) {
  b.addEventListener('click', () => {
    if (!song) return;
    const pr = PRESETS[b.dataset.preset];
    song.tracks.forEach((tr, i) => {
      const tone = pr.tones ? pr.tones[tr.isDrum ? 'drums' : tr.role] : tr.tone;
      player.setTone(i, tone);
    });
    applyPoly(pr.poly);
    renderTracks();
    b.classList.add('active');
    toast(`${b.firstChild.textContent.trim()} にしました`);
  });
}

// ---------- 音色 ----------
function toneOptions(isDrum, selected) {
  if (isDrum) {
    return Object.entries(DRUM_KITS).map(([id, k]) => `<option value="${id}" ${id === selected ? 'selected' : ''}>${k.label}</option>`).join('');
  }
  const groups = {};
  for (const [id, t] of Object.entries(TONES)) (groups[t.group] ||= []).push([id, t]);
  return Object.entries(groups).map(([g, list]) =>
    `<optgroup label="${g}">${list.map(([id, t]) => `<option value="${id}" ${id === selected ? 'selected' : ''}>${t.label}</option>`).join('')}</optgroup>`).join('');
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderTracks() {
  const list = $('#track-list');
  list.innerHTML = '';
  song.tracks.forEach((tr, i) => {
    const st = player.settings[i];
    const el = document.createElement('div');
    el.className = `track${st.muted ? ' muted' : ''}`;
    const role = ROLE_LABELS[tr.role] || tr.role;
    const name = tr.name && tr.name !== role ? `${role} <small>${esc(tr.name)}</small>` : role;
    el.innerHTML = `
      <div class="bar" style="background: var(--c-${tr.isDrum ? 'drums' : tr.role})"></div>
      <div class="name">${name}</div>
      <select aria-label="${role}の音色">${toneOptions(tr.isDrum, st.tone)}</select>
      <div class="ctrls">
        <button class="btn small mute-btn" aria-label="${role}を消す">${st.muted ? '🔇' : '🔊'}</button>
        <input type="range" min="0" max="1.5" step="0.05" value="${st.volume}" aria-label="${role}の音量">
      </div>`;
    el.querySelector('select').addEventListener('change', (e) => {
      player.setTone(i, e.target.value);
      for (const b of $$('.preset')) b.classList.remove('active');
    });
    el.querySelector('.mute-btn').addEventListener('click', (e) => {
      player.setMuted(i, !st.muted);
      el.classList.toggle('muted', st.muted);
      e.currentTarget.textContent = st.muted ? '🔇' : '🔊';
    });
    el.querySelector('input[type=range]').addEventListener('input', (e) => player.setVolume(i, Number(e.target.value)));
    list.appendChild(el);
  });
}

// ---------- 保存 ----------
$('#save-midi').addEventListener('click', () => {
  if (!song) return;
  // 今の音数で選ばれた音だけ・今の音色で保存
  const tracks = song.tracks.map((tr, i) => ({ ...tr, tone: player.settings[i].tone, notes: [] }));
  for (const ev of player.events) tracks[ev.track].notes.push({ t: ev.t, d: ev.d, p: ev.p, v: ev.v });
  const out = { ...song, tracks: tracks.filter((t, i) => t.notes.length && !player.settings[i].muted) };
  const bytes = writeMidi(out, (tr) => (TONES[tr.tone]?.gm ?? 0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/midi' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${song.title.replace(/[\\/:*?"<>|]/g, '_') || 'midichen'}_ミディチェン.mid`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('MIDIファイルを保存しました');
});
