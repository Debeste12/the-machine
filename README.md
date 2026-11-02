# The Machine

Lokale recreatie van "The Machine" uit Person of Interest: `index.html` in de browser, met Ollama (`gemma3:12b`) als taalmodel.

## Starten
Dubbelklik `start.bat`. Die start de webserver, de cameraserver, de Cloudflare-tunnel, Ollama en (als aanwezig) whisper voor spraak.

## Niet in Git (los neerzetten na een verse clone)
- **Ollama** met `gemma3:12b`: installeer via https://ollama.com en `ollama pull gemma3:12b`.
- **cloudflared.exe**: wordt door `start.bat` zelf gedownload.
- **whisper/** (spraakherkenning, ruim 1 GB): `whisper/bin/Release/` met whisper.cpp (CUDA-build, `whisper-server.exe` + dll's) en `whisper/ggml-small.bin`.

## Privacy
Gezichts- en stemprofielen, dossiers en instellingen staan in de browser (localStorage), niet in deze map.
Koppelcode, certificaten, signaalbestanden en logs staan in `.gitignore` en gaan nooit mee.
