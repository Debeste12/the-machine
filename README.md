# The Machine

A local recreation of "The Machine" from the TV series *Person of Interest*. It runs as `index.html` in the browser, with Ollama (`gemma3:12b`) as the offline language model.

## Features
- Surveillance terminal UI in the style of the show
- Face recognition, voice recognition and weapon detection, all running locally
- Multiple cameras, including phone cameras over HTTPS
- Offline AI via Ollama

## Getting started
Double-click `start.bat`. It starts the web server, the camera server, the Cloudflare tunnel, Ollama and (if present) whisper for speech recognition.

## Not included in this repository (set up after cloning)
- **Ollama** with `gemma3:12b`: install from https://ollama.com and run `ollama pull gemma3:12b`.
- **cloudflared.exe**: downloaded automatically by `start.bat`.
- **whisper/** (speech recognition, over 1 GB): `whisper/bin/Release/` with whisper.cpp (CUDA build, `whisper-server.exe` and DLLs) and `whisper/ggml-small.bin`.

## Privacy
Face and voice profiles, dossiers and settings are stored in the browser (localStorage), not in this folder.
The pairing code, certificates, signalling files and logs are listed in `.gitignore` and are never committed.
