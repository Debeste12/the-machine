@echo off
title THE MACHINE
rem spraakherkenning (whisper.cpp op de GPU), in een eigen geminimaliseerd venster
if exist "%~dp0whisper\bin\Release\whisper-server.exe" start "THE MACHINE // VOICE" /min "%~dp0whisper\bin\Release\whisper-server.exe" -m "%~dp0whisper\ggml-small.bin" --host 127.0.0.1 --port 8178 -l en -bs 5
rem extra camera's (telefoon via https), in een eigen geminimaliseerd venster
start "THE MACHINE // CAMERAS" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0camserver.ps1"
rem Cloudflare-tunnel: officieel https-adres voor de telefooncamera (thuis en buitenshuis); /cams toont het adres
rem cloudflared.exe wordt de eerste keer gedownload (los programma, geen installatie). Sluit het TUNNEL-venster om hem uit te zetten.
if not exist "%~dp0cloudflared.exe" powershell -NoProfile -Command "Invoke-WebRequest -UseBasicParsing https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe -OutFile '%~dp0cloudflared.exe'"
del "%~dp0tunnel.log" 2>nul
if exist "%~dp0cloudflared.exe" start "THE MACHINE // TUNNEL" /min "%~dp0cloudflared.exe" tunnel --no-autoupdate --url https://127.0.0.1:8443 --no-tls-verify --logfile "%~dp0tunnel.log"
rem taalmodel (Ollama): op de achtergrond starten als hij nog niet draait; de pagina opent meteen en verbindt zodra Ollama klaar is
start "THE MACHINE // OLLAMA" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ollama.ps1"
rem /reboot start dit bestand opnieuw met "reboot": dan geen extra browsertabblad, de open pagina laadt zichzelf opnieuw
set "NOBROWSER="
if /i "%~1"=="reboot" set "NOBROWSER=-NoBrowser"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" %NOBROWSER%
