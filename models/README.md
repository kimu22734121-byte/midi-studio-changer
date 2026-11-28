# 楽器の聴き分けに使うモデル

- `yamnet.tflite`：Google の音の聞き分けモデル YAMNet（AudioSet の 521 種類の音）。MediaPipe 用の版。
  - 入手元：https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite
  - ライセンス：Apache License 2.0（`LICENSE-yamnet`）
- ブラウザで動かすプログラムは `vendor/mediapipe/`（@mediapipe/tasks-audio 1.2.3、Apache License 2.0）
