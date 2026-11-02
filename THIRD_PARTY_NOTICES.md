# Third-party components

The Machine includes or downloads the following third-party software and models. Each remains under its own license.

## Included in this repository

| Component | Files | Source | License |
|---|---|---|---|
| face-api (vladmandic) | `lib/face-api.js` | https://github.com/vladmandic/face-api | MIT |
| face-api models (SSD MobileNet v1, face landmarks, face recognition, expression, age/gender) | `models/*_model.bin`, `models/*-weights_manifest.json` | https://github.com/vladmandic/face-api | MIT |
| ONNX Runtime Web | `lib/ort/` | https://github.com/microsoft/onnxruntime | MIT |
| YOLOX-nano | `models/yolox_nano.onnx` | https://github.com/Megvii-BaseDetection/YOLOX | Apache-2.0 |
| WeSpeaker ResNet34 (speaker recognition) | `models/voice_resnet34.onnx` | https://github.com/wenet-e2e/wespeaker | Apache-2.0 (code); pretrained VoxCeleb model under CC BY 4.0 |
| Weapon detection model (YOLOv8s, WeaponShield-AI) | `models/weapon_part_00`, `models/weapon_part_01` | WeaponShield-AI, based on Ultralytics YOLOv8 | Published as MIT; YOLOv8 itself is AGPL-3.0 (https://github.com/ultralytics/ultralytics) |

## Downloaded at first start (not in this repository)

| Component | Source | License |
|---|---|---|
| Ollama | https://ollama.com | MIT |
| Gemma 3 (`gemma3:12b`) | https://ai.google.dev/gemma | Gemma Terms of Use |
| whisper.cpp | https://github.com/ggml-org/whisper.cpp | MIT |
| Whisper model `ggml-small.bin` | https://huggingface.co/ggerganov/whisper.cpp | MIT (OpenAI Whisper) |
| cloudflared | https://github.com/cloudflare/cloudflared | Apache-2.0 |

## Fonts

VT323 and Share Tech Mono are loaded from Google Fonts (SIL Open Font License 1.1).

## Trademarks

*Person of Interest* and "The Machine" are the property of their respective owners. This is a non-commercial fan project and is not affiliated with or endorsed by them.
