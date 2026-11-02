# Eerste-keer-installatie voor The Machine (wordt door start.bat aangeroepen).
# Installeert alleen wat ontbreekt en is daarna bij elke start in een paar seconden klaar:
#   1. whisper.cpp (spraakherkenning) in whisper\bin\Release\ + het model whisper\ggml-small.bin
#   2. Ollama (taalmodel-server), via winget of anders het officiele installatieprogramma
#   3. het taalmodel gemma3:12b (ongeveer 8 GB)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # anders is Invoke-WebRequest bij grote bestanden heel traag
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root  = $PSScriptRoot
$MODEL = "gemma3:12b"

function Say($t, $c = "DarkGray") { Write-Host "  $t" -ForegroundColor $c }
function Get-File($url, $out) {
  # curl.exe zit standaard in Windows 10/11 en toont voortgang; anders Invoke-WebRequest
  $tmp = "$out.part"
  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    & curl.exe -L --fail --progress-bar -o $tmp $url
    if ($LASTEXITCODE -ne 0) { throw "download mislukt: $url" }
  } else {
    Invoke-WebRequest -UseBasicParsing $url -OutFile $tmp
  }
  Move-Item $tmp $out -Force
}

# ---------- 1. whisper.cpp ----------
$wdir   = Join-Path $root "whisper"
$relDir = Join-Path $wdir "bin\Release"
$server = Join-Path $relDir "whisper-server.exe"
$wmodel = Join-Path $wdir "ggml-small.bin"
try {
  if (-not (Test-Path $server)) {
    Say "Spraakherkenning (whisper.cpp) wordt eenmalig gedownload..." Cyan
    # NVIDIA-kaart aanwezig? Dan de CUDA-versie (GPU), anders de gewone versie (CPU)
    $gpu = [bool](Get-Command nvidia-smi -ErrorAction SilentlyContinue) -or (Test-Path "$env:WINDIR\System32\nvidia-smi.exe")
    $pattern = if ($gpu) { '^whisper-cublas-12\.[0-9.]+-bin-x64\.zip$' } else { '^whisper-bin-x64\.zip$' }
    # niet elke release heeft Windows-bestanden: zoek de nieuwste die er wel een heeft
    $rels = Invoke-RestMethod -UseBasicParsing "https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=30" -Headers @{ "User-Agent" = "the-machine" }
    $asset = $null
    foreach ($r in $rels) {
      if ($r.prerelease -or $r.draft) { continue }
      $asset = $r.assets | Where-Object { $_.name -match $pattern } | Select-Object -First 1
      if ($asset) { Say "versie $($r.tag_name): $($asset.name)"; break }
    }
    if (-not $asset) { throw "geen Windows-download van whisper.cpp gevonden" }
    $zip = Join-Path $env:TEMP $asset.name
    Get-File $asset.browser_download_url $zip
    $tmpDir = Join-Path $env:TEMP "the-machine-whisper"
    if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
    Expand-Archive $zip $tmpDir -Force
    # de map met whisper-server.exe (en de dll's ernaast) wordt whisper\bin\Release
    $exe = Get-ChildItem $tmpDir -Recurse -Filter whisper-server.exe | Select-Object -First 1
    if (-not $exe) { throw "whisper-server.exe zat niet in $($asset.name)" }
    New-Item -ItemType Directory -Force $relDir | Out-Null
    Copy-Item (Join-Path $exe.DirectoryName "*") $relDir -Recurse -Force
    Remove-Item $tmpDir -Recurse -Force; Remove-Item $zip -Force
    Say "whisper.cpp geinstalleerd." Green
  }
  if (-not (Test-Path $wmodel)) {
    Say "Spraakmodel ggml-small.bin (ongeveer 470 MB) wordt eenmalig gedownload..." Cyan
    New-Item -ItemType Directory -Force $wdir | Out-Null
    Get-File "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin" $wmodel
    Say "Spraakmodel klaar." Green
  }
} catch {
  Say "Spraakherkenning kon niet worden geinstalleerd: $($_.Exception.Message)" Yellow
  Say "The Machine werkt verder zonder spraak; bij de volgende start wordt het opnieuw geprobeerd." Yellow
}

# ---------- 2. Ollama ----------
function Find-Ollama {
  $p = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
  if (Test-Path $p) { return $p }
  $cli = Get-Command ollama -ErrorAction SilentlyContinue
  if ($cli) { return $cli.Source }
  return $null
}
try {
  if (-not (Find-Ollama)) {
    Say "Ollama (taalmodel-server) wordt eenmalig geinstalleerd..." Cyan
    if (Get-Command winget -ErrorAction SilentlyContinue) {
      & winget install --id Ollama.Ollama -e --silent --accept-source-agreements --accept-package-agreements
    }
    if (-not (Find-Ollama)) {
      # geen winget (of het lukte niet): officieel installatieprogramma, stil
      $setup = Join-Path $env:TEMP "OllamaSetup.exe"
      Get-File "https://ollama.com/download/OllamaSetup.exe" $setup
      Start-Process $setup "/VERYSILENT /NORESTART /SUPPRESSMSGBOXES" -Wait
      Remove-Item $setup -Force -ErrorAction SilentlyContinue
    }
    if (-not (Find-Ollama)) { throw "Ollama is na de installatie niet gevonden" }
    Say "Ollama geinstalleerd." Green
  }

  # ---------- 3. taalmodel ----------
  & (Join-Path $root "ollama.ps1")   # start 'ollama serve' als hij nog niet draait
  $tags = $null
  for ($i = 0; $i -lt 30 -and -not $tags; $i++) {
    try { $tags = Invoke-RestMethod -UseBasicParsing "http://127.0.0.1:11434/api/tags" -TimeoutSec 5 } catch { Start-Sleep 1 }
  }
  if (-not $tags) { throw "Ollama reageert niet" }
  if (-not ($tags.models | Where-Object { $_.name -eq $MODEL })) {
    Say "Taalmodel $MODEL (ongeveer 8 GB) wordt eenmalig gedownload, dit kan even duren..." Cyan
    & (Find-Ollama) pull $MODEL
    if ($LASTEXITCODE -ne 0) { throw "ollama pull $MODEL mislukt" }
    Say "Taalmodel klaar." Green
  }
} catch {
  Say "Taalmodel kon niet worden geinstalleerd: $($_.Exception.Message)" Yellow
  Say "Installeer het zelf via https://ollama.com en 'ollama pull $MODEL', of start opnieuw om het nog eens te proberen." Yellow
}
