# Signalering voor extra camera's (WebRTC): de telefoon en The Machine wisselen hier
# eenmalig hun verbindingsgegevens uit. Daarna gaat het beeld rechtstreeks tussen de twee.
# Wordt gebruikt door server.ps1 (localhost) en camserver.ps1 (https, voor de telefoon).
$sigDir = Join-Path $PSScriptRoot "signal"
if (-not (Test-Path $sigDir)) { New-Item -ItemType Directory $sigDir | Out-Null }
$codeFile = Join-Path $PSScriptRoot "camcode.txt"
if (-not (Test-Path $codeFile)) { Set-Content $codeFile ("{0:D6}" -f (Get-Random -Maximum 1000000)) -NoNewline }
$camCode = (Get-Content $codeFile -Raw).Trim()
$camPort = 8443

# alleen echte netwerken: met een router (gateway), of Tailscale (100.x); geen virtuele adapters
function Get-LanAddresses {
  [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
    Where-Object { $_.OperationalStatus -eq "Up" } |
    ForEach-Object {
      $p = $_.GetIPProperties()
      $gw = @($p.GatewayAddresses | Where-Object { $_.Address.AddressFamily -eq "InterNetwork" -and $_.Address.ToString() -ne "0.0.0.0" }).Count -gt 0
      $p.UnicastAddresses | Where-Object { $_.Address.AddressFamily -eq "InterNetwork" } | ForEach-Object {
        $ip = $_.Address.ToString()
        if ($gw -or $ip -match '^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.') { $ip }
      }
    } |
    Where-Object { $_ -notlike "127.*" -and $_ -notlike "169.254.*" }
}

# geeft @{ status; type; body } terug, of $null als het pad niet bij de signalering hoort
# $local: verzoek van The Machine zelf (mag code en adressen zien, en aanbiedingen ophalen)
function Invoke-Signal($method, $path, $query, $body, $local) {
  $json = "application/json; charset=utf-8"
  $id = $query["id"]
  if ($id -and $id -notmatch '^[a-z0-9]{6,32}$') { return @{ status = 400; type = $json; body = '{"error":"bad id"}' } }
  switch ("$method $path") {
    "GET signal/info" {
      if (-not $local) { return @{ status = 403; type = $json; body = '{}' } }
      $ips = @(Get-LanAddresses)
      # Cloudflare-tunnel (start.bat): officieel https-adres, werkt thuis en buitenshuis; verandert bij elke start
      $tunnel = $null
      $tlog = Join-Path $PSScriptRoot "tunnel.log"
      if (Test-Path $tlog) {
        # cloudflared schrijft nog in dit bestand: daarom lezen met FileShare.ReadWrite
        $text = ""
        try {
          $fs = New-Object IO.FileStream($tlog, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
          $text = (New-Object IO.StreamReader($fs)).ReadToEnd(); $fs.Close()
        } catch {}
        $m = [regex]::Matches($text, 'https://[a-z0-9-]+\.trycloudflare\.com')
        if ($m.Count) { $tunnel = $m[$m.Count - 1].Value }
      }
      return @{ status = 200; type = $json; body = (@{ code = $camCode; port = $camPort; ips = $ips; tunnel = $tunnel } | ConvertTo-Json -Compress) }
    }
    "POST signal/offer" {
      $o = $body | ConvertFrom-Json
      if ($o.code -ne $camCode) { return @{ status = 403; type = $json; body = '{"error":"code"}' } }
      if ($o.id -notmatch '^[a-z0-9]{6,32}$') { return @{ status = 400; type = $json; body = '{"error":"bad id"}' } }
      [IO.File]::WriteAllText((Join-Path $sigDir "offer_$($o.id).json"), $body)
      return @{ status = 200; type = $json; body = '{"ok":true}' }
    }
    "GET signal/offers" {
      if (-not $local) { return @{ status = 403; type = $json; body = '[]' } }
      $list = @(Get-ChildItem $sigDir -Filter "offer_*.json" | ForEach-Object {
        $t = [IO.File]::ReadAllText($_.FullName); Remove-Item $_.FullName; $t })
      return @{ status = 200; type = $json; body = "[" + ($list -join ",") + "]" }
    }
    "POST signal/answer" {
      if (-not $local) { return @{ status = 403; type = $json; body = '{}' } }
      $o = $body | ConvertFrom-Json
      if ($o.id -notmatch '^[a-z0-9]{6,32}$') { return @{ status = 400; type = $json; body = '{"error":"bad id"}' } }
      [IO.File]::WriteAllText((Join-Path $sigDir "answer_$($o.id).json"), $body)
      return @{ status = 200; type = $json; body = '{"ok":true}' }
    }
    "GET signal/answer" {
      $f = Join-Path $sigDir "answer_$id.json"
      if (-not $id -or -not (Test-Path $f)) { return @{ status = 204; type = $json; body = '' } }
      $t = [IO.File]::ReadAllText($f); Remove-Item $f
      return @{ status = 200; type = $json; body = $t }
    }
  }
  if ($path -like "signal/*") { return @{ status = 404; type = $json; body = '{}' } }
  return $null
}
