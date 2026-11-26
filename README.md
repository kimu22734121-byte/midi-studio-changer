# MIDI Studio Changer（ミディチェン）

好きな曲を取り込んで、打ち込み音楽（MIDI・シンセ風）に変換して鳴らすWebアプリです。
ブラウザだけで動きます（サーバー不要・曲はどこにも送信されません）。

## できること（第1段階）

- **曲の取り込み**
  1. 音楽・動画ファイル（MP3・WAV・M4A・MP4・MOV など）→ メロディ・コード・ドラムを自動で聴き取って打ち込みに変換
     - iPhoneで鳴っている音は、iPhoneの「画面収録」で録った動画を選べば取り込めます（手順は画面に表示）
  2. MIDIファイル（.mid）→ そのまま読み込み（いちばんきれい）
  3. マイク録音 → 録音後そのまま変換（静かな場所で録るコツを画面に表示）
  4. テキストの楽譜（ABC記譜法 / コード進行 `C G Am F` など）を貼り付け
  5. MusicXML（.musicxml / .xml / .mxl）
- **再生**：音符の流れる表示つき。鳴らしていない音は薄く表示
- **同時に鳴らす音の数**：スライダー（1〜8, 16, 32, 64, 128）と数字入力。初期値64
  - 「ファミコン風（4音）」「スーファミ風（16音）」「リッチ（64音）」ですぐ聴き比べ
  - 重くて音がとぎれたら自動で音数を減らす
- **音のセット（サウンドフォント）**：曲全体の雰囲気をまとめて切り替え。パートごとに楽器も選べます
  | セット | 中身 | 大きさ |
  |---|---|---|
  | ⚡ 軽い波形シンセ | 左右に広がる厚めのシンセ・ピコピコ音（21種類＋ドラム2種類） | 読み込みなし |
  | 🎻 オーケストラ（豪華） | 本物の弦・金管・木管・ハープ・ティンパニ・打楽器を録音した音（VSCO-2-CE）＋ホールの響き | 約33MB |
  | 🎷 ジャズ・ピアノトリオ（豪華） | コンサートグランドピアノ（Salamander）・ウッドベース・ジャズドラムを録音した音 | 約27MB |
  | 🎹 標準 | ピアノ・ストリングス・ギター・ドラムなど128種類＋ドラム13種類（GeneralUser GS） | 約32MB |
  | 🌌 シンセ | FMエレピ・スーパーソー・アナログベースなど（アプリ独自） | 約3MB |
  | 🚀 宇宙（アンビエント） | 広がるパッドと長い響き・やまびこ | シンセと共通 |
  | 🕹️ スーファミ風 | 標準の音を粗くして、やまびこ（エコー）をかけた音 | 標準と共通 |
  | 👾 ファミコン風 | 矩形波・三角波・ノイズ（アプリ独自） | 約0.7MB |
  | 📂 自分の .sf2 | 端末にあるサウンドフォントを読み込んで使えます | — |

  大きいセットは選んだときに初めてダウンロードし、端末に保存するので2回目からは通信しません。
- **MIDIで保存**：今の音数・音色のまま保存

※ 音声からの変換は「打ち込み風にアレンジし直した別バージョン」です。完全な再現ではありません。

## 使い方（ローカル）

```bash
python3 -m http.server 8000
```

ブラウザで http://localhost:8000 を開きます。テストは `npm test`（Node.js 20以上）。

## GitHub Pages で公開する

公開URL：https://kimu22734121-byte.github.io/midi-studio-changer/

`main` ブランチに変更が入ると、GitHub Actions（`.github/workflows/pages.yml`）がテストしてから自動で公開します。
はじめて公開するときだけ、Settings → Pages → 「Build and deployment」の Source を **GitHub Actions** にしてください。

## ライセンス

- このアプリのソースコード：MIT License（[LICENSE](LICENSE)）
- **GeneralUser GS**（`soundfonts/GeneralUser-GS.sf2`、「標準」「スーファミ風」セット）
  - 作者：S. Christian Collins — https://www.schristiancollins.com/generaluser
  - 音楽制作（個人・商用とも）に制限なく使え、ソフトウェアへの組み込み・改変も認められています。
    配布するときは作者のダウンロードURLに直接リンクせず、自分で持っているコピーを置くこと、とされています（このリポジトリはそうしています）。
  - ライセンス全文：[soundfonts/GeneralUser-GS-LICENSE.txt](soundfonts/GeneralUser-GS-LICENSE.txt)
- **オーケストラ**（`soundfonts/midichen-orchestra.sf2`）
  - 元の録音：VS Chamber Orchestra 2: Community Edition（Versilian Studios）— https://github.com/sgossner/VSCO-2-CE
  - CC0 1.0（パブリックドメイン）。このアプリ用に音を選んで軽くしたものも CC0 です。
- **ジャズ・ピアノトリオ**（`soundfonts/midichen-jazz.sf2`）
  - ピアノ：**Salamander Grand Piano V3 — Alexander Holm**（CC-BY 3.0）https://archive.org/details/SalamanderGrandPianoV3
    （SFZ版：https://github.com/sfzinstruments/SalamanderGrandPiano）。使うときは作者名の表示が必要です。
    このアプリでは音を選んでモノラル・短くするなど加工しています。
  - ウッドベース：VSCO-2-CE（CC0）
  - ドラム：Virtuosity Drums（CC0）— https://github.com/sfzinstruments/virtuosity_drums
  - このセットの音で作った曲をゲームなどで使うときは、「Piano: Salamander Grand Piano by Alexander Holm (CC-BY 3.0)」とクレジットを書いてください。
- オーケストラ・ジャズのセットは `tools/build-sample-soundfonts.mjs` で元の録音から作り直せます（git・ffmpeg が必要）。
- **アプリ独自セット**（`soundfonts/midichen-chip.sf2` / `midichen-synth.sf2`）
  - すべてプログラムで合成した音です（`tools/make-soundfonts.mjs` で作り直せます）。
  - CC0 1.0（パブリックドメイン）：商用・再配布・改変を含め、自由に使えます。ゲームのBGM用の音源としてもそのまま使えます。
- 波形シンセの音：プログラムで作った音（外部の音源ファイルは使っていません）

## サウンドフォントのセットを増やすには

1. `.sf2` ファイルを `soundfonts/` に置く（商用・再配布OKのものだけ。ライセンスをこの README に追記）
2. `src/audio/soundfonts.js` の `SETS` に1件足す（名前・説明・ファイル名・大きさ）

画面の「自分のサウンドフォント（.sf2）を読み込む」から、端末にあるファイルをその場で試すこともできます。

詳しい仕様と今後の予定は [CLAUDE.md](CLAUDE.md) を参照してください。
