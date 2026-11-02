# Start Ollama (de taalmodel-server voor LANGUAGE INTERFACE) als hij nog niet draait.
$url = "http://127.0.0.1:11434/api/tags"   # 127.0.0.1: "localhost" probeert eerst IPv6 en loopt dan in de time-out
function Test-Ollama { try { Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 5 | Out-Null; $true } catch { $false } }

if (Test-Ollama) { Write-Host "  Ollama draait al." -ForegroundColor DarkGray; exit }

# Start 'ollama serve' onzichtbaar op de achtergrond (geen app-venster); wacht tot hij antwoordt
$exe = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
if (-not (Test-Path $exe)) { $cli = Get-Command ollama -ErrorAction SilentlyContinue; if ($cli) { $exe = $cli.Source } else { $exe = $null } }
if (-not $exe) { Write-Host "  Ollama niet gevonden. Installeer het via https://ollama.com" -ForegroundColor Red; exit }
Start-Process $exe "serve" -WindowStyle Hidden -RedirectStandardError (Join-Path $PSScriptRoot "ollama.log")

Write-Host "  Ollama wordt gestart..." -ForegroundColor DarkGray
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep 1
  if (Test-Ollama) { Write-Host "  Ollama online." -ForegroundColor Green; exit }
}
Write-Host "  Ollama reageert nog niet; LANGUAGE INTERFACE komt online zodra hij klaar is (zie ollama.log)." -ForegroundColor Yellow
