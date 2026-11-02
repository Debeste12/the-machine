# Https-server voor extra camera's: een telefoon (of andere pc) opent hier de zenderpagina.
# Https is nodig, anders geeft de browser van de telefoon geen toegang tot de camera.
# De certificaten worden hier zelf gemaakt, zonder beheerdersrechten.
$root = $PSScriptRoot
# alles wat dit venster toont ook in camserver.log, handig bij problemen
try { Start-Transcript -Path (Join-Path $root "camserver.log") -Force | Out-Null } catch {}
. (Join-Path $root "signal.ps1")
$port = $camPort

# Eigen certificaatautoriteit (CA): die installeer je een keer op de telefoon, daarna vertrouwt
# de telefoon de cameraserver zonder waarschuwing. Op http://<pc>:8442 staat de CA klaar.
# De servercertificaten zelf zijn 1 jaar geldig (eis van iOS) en bevatten de adressen van de pc;
# een nieuw adres = automatisch een nieuw servercertificaat, de CA blijft hetzelfde.
$ips = @(Get-LanAddresses)
$store = "Cert:\CurrentUser\My"
$ca = Get-ChildItem $store | Where-Object { $_.FriendlyName -eq "The Machine CA" -and $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date).AddDays(30) } | Select-Object -First 1
if (-not $ca) {
  $ca = New-SelfSignedCertificate -Subject "CN=The Machine Root CA" -FriendlyName "The Machine CA" `
    -KeyUsage CertSign, CRLSign, DigitalSignature -TextExtension @("2.5.29.19={critical}{text}ca=1&pathlength=0") `
    -CertStoreLocation $store -NotAfter (Get-Date).AddYears(10) -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy Exportable
  Write-Host "  Nieuwe CA gemaakt. Installeer die (opnieuw) op je telefoon via http://<pc>:8442" -ForegroundColor Yellow
}
$caBytes = $ca.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert)
# ook als bestand in de map, om bijvoorbeeld naar jezelf te mailen (openbaar deel, geen geheimen)
try { [IO.File]::WriteAllBytes((Join-Path $root "themachine-ca.cer"), $caBytes) } catch {}
$cert = Get-ChildItem $store |
  Where-Object { $_.FriendlyName -eq "The Machine" -and $_.HasPrivateKey -and $_.Issuer -eq $ca.Subject -and $_.NotAfter -gt (Get-Date).AddDays(7) } |
  Where-Object {
    $sanText = ($_.Extensions | Where-Object { $_.Oid.Value -eq "2.5.29.17" } | ForEach-Object { $_.Format($false) }) -join " "
    @($ips | Where-Object { $sanText -notmatch ([regex]::Escape($_) + '\b') }).Count -eq 0
  } | Select-Object -First 1
if (-not $cert) {
  Get-ChildItem $store | Where-Object { $_.FriendlyName -eq "The Machine" } | Remove-Item
  $san = (@("DNS=themachine", "DNS=localhost") + ($ips | ForEach-Object { "IPAddress=$_" })) -join "&"
  $cert = New-SelfSignedCertificate -Signer $ca -Subject "CN=The Machine" -FriendlyName "The Machine" `
    -TextExtension @("2.5.29.17={text}$san", "2.5.29.37={text}1.3.6.1.5.5.7.3.1") `
    -CertStoreLocation $store -NotAfter (Get-Date).AddDays(365) `
    -KeyAlgorithm RSA -KeyLength 2048 -KeySpec KeyExchange -KeyExportPolicy Exportable -HashAlgorithm SHA256 `
    -Provider "Microsoft Enhanced RSA and AES Cryptographic Provider"
  Write-Host "  Nieuw servercertificaat voor: $($ips -join ', ')" -ForegroundColor DarkGray
}

$certPort = $port - 1   # gewone http, alleen voor de installatiepagina van het certificaat
$tcp = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Any, $port)
$plain = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Any, $certPort)
try { $tcp.Start(); $plain.Start() } catch {
  Write-Host "Kan poort $port of $certPort niet openen. Draait de cameraserver al?" -ForegroundColor Red
  Read-Host "Druk op Enter om te sluiten"; exit
}

Write-Host ""
Write-Host "  THE MACHINE // CAMERA'S" -ForegroundColor Green
Write-Host "  Open op je telefoon (zelfde wifi; buitenshuis: https://<je publieke ip>:$port/ via port forwarding):" -ForegroundColor DarkGray
foreach ($ip in $ips) { Write-Host "    https://${ip}:$port/" -ForegroundColor White }
Write-Host "  Eerste keer: installeer eerst het certificaat via http://$($ips[0]):$certPort/" -ForegroundColor DarkGray
Write-Host "  Koppelcode: $camCode" -ForegroundColor Yellow
Write-Host "  Sluit dit venster om extra camera's uit te zetten." -ForegroundColor DarkGray

$zender = [IO.File]::ReadAllBytes((Join-Path $root "zender.html"))
$installPage = @"
<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Machine // Certificaat</title><style>body{background:#000;color:#f2f2f2;font:16px/1.5 Menlo,Consolas,monospace;padding:16px;max-width:640px}
h1{font-size:13px;letter-spacing:.4em;color:#8a8a8a;font-weight:normal}a.b{display:block;border:1px solid #33ff66;color:#33ff66;text-align:center;padding:14px;margin:18px 0;text-decoration:none;letter-spacing:.2em}
li{margin:8px 0}b{color:#33ff66}</style></head><body><h1>THE MACHINE // CERTIFICAAT</h1>
<p>Eenmalig nodig, zodat je telefoon de cameraserver vertrouwt.</p>
<a class="b" href="/themachine-ca.cer">1. DOWNLOAD CERTIFICAAT</a>
<ol><li>Tik op <b>Sta toe</b> als Safari vraagt een configuratieprofiel te downloaden.</li>
<li>Ga naar <b>Instellingen</b> &gt; <b>Profiel gedownload</b> (bovenaan) &gt; <b>Installeer</b>.</li>
<li>Ga naar <b>Instellingen &gt; Algemeen &gt; Info &gt; Certificaatvertrouwen</b> en zet <b>The Machine Root CA</b> aan.</li>
<li>Open daarna de camera: <b>https://ADRES:$port/</b></li></ol></body></html>
"@
# Elke verbinding krijgt een eigen thread: Safari opent meerdere verbindingen tegelijk
# (en probeert soms eerst https op de http-poort); een stille verbinding mag de rest niet ophouden.
$shared = [hashtable]::Synchronized(@{
  root = $root; cert = $cert; caBytes = $caBytes; zender = $zender; installPage = $installPage
  fails = [hashtable]::Synchronized(@{})   # tegen raden van de koppelcode: 5 fouten per adres = 10 minuten geblokkeerd
})
$handler = {
  param($client, $tls, $S)
  . (Join-Path $S.root "signal.ps1")
  $enc = [Text.Encoding]::UTF8

  function Read-Line($s, $b = -2) {
    $buf = New-Object IO.MemoryStream
    while ($true) {
      if ($b -eq -2) { $b = $s.ReadByte() }
      if ($b -lt 0) { return $null }
      if ($b -eq 10) { break }
      if ($b -ne 13) { $buf.WriteByte($b) }
      if ($buf.Length -gt 8192) { return $null }
      $b = -2
    }
    return $enc.GetString($buf.ToArray())
  }

  function Send($s, $status, $type, [byte[]]$bytes) {
    $text = @{ 200 = "OK"; 204 = "No Content"; 400 = "Bad Request"; 403 = "Forbidden"; 429 = "Too Many Requests"; 404 = "Not Found"; 500 = "Error" }[$status]
    $head = "HTTP/1.1 $status $text`r`nContent-Type: $type`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
    $h = $enc.GetBytes($head)
    $s.Write($h, 0, $h.Length)
    if ($bytes.Length) { $s.Write($bytes, 0, $bytes.Length) }
    $s.Flush()
  }

  # elke verbinding kort in verbindingen.log (voor het opsporen van problemen)
  function Log($t) { try { [IO.File]::AppendAllText((Join-Path $S.root "verbindingen.log"), "$(Get-Date -Format HH:mm:ss.fff) $($client.Client.RemoteEndPoint) $(if ($tls) { 'https' } else { 'http' }) $t`r`n") } catch {} }

  $stream = $null
  try {
    Log "verbinding"
    $client.ReceiveTimeout = 5000; $client.SendTimeout = 5000
    $stream = $client.GetStream()
    if (-not $tls) {
      # http-poort: alleen de installatiepagina en het CA-certificaat (openbaar deel, geen geheimen)
      $b = $stream.ReadByte()
      Log "eerste byte $b"
      if ($b -eq 0x16) { return }          # https-poging op de http-poort: sluiten, Safari valt dan terug op http
      $first = Read-Line $stream $b
      while ($true) { $l = Read-Line $stream; if ($l -eq $null -or $l -eq "") { break } }
      $target = if ($first) { $first.Split(" ")[1] } else { "/" }
      Log "vraagt $first"
      if ($target -like "/themachine-ca.cer*") { Send $stream 200 "application/x-x509-ca-cert" $S.caBytes }
      else { Send $stream 200 "text/html; charset=utf-8" $enc.GetBytes($S.installPage.Replace("ADRES", $client.Client.LocalEndPoint.Address.ToString())) }
      return
    }
    $ssl = New-Object Net.Security.SslStream($stream, $false)
    $stream = $ssl
    $ssl.ReadTimeout = 5000; $ssl.WriteTimeout = 5000
    $ssl.AuthenticateAsServer($S.cert, $false, [Security.Authentication.SslProtocols]::Tls12, $false)
    $first = Read-Line $ssl
    Log "vraagt $first"
    if (-not $first) { return }
    $method, $target = $first.Split(" ")[0, 1]
    $len = 0; $ip = $client.Client.RemoteEndPoint.Address.ToString()
    while ($true) {
      $l = Read-Line $ssl
      if ($l -eq $null -or $l -eq "") { break }
      if ($l -match '^content-length:\s*(\d+)') { $len = [int]$matches[1] }
      # via de Cloudflare-tunnel komt alles van de pc zelf; het echte adres staat dan in deze header
      if ($l -match '^cf-connecting-ip:\s*(\S+)' -and $ip -eq "127.0.0.1") { $ip = $matches[1] }
    }
    if ($len -gt 200000) { return }
    $body = ""
    if ($len -gt 0) {
      $data = New-Object byte[] $len; $got = 0
      while ($got -lt $len) { $n = $ssl.Read($data, $got, $len - $got); if ($n -le 0) { break }; $got += $n }
      $body = $enc.GetString($data, 0, $got)
    }
    $pathPart, $qs = $target.Split("?", 2)
    $path = [Uri]::UnescapeDataString($pathPart.TrimStart("/"))
    $query = @{}
    if ($qs) { foreach ($kv in $qs.Split("&")) { $k, $v = $kv.Split("=", 2); $query[$k] = [Uri]::UnescapeDataString("$v") } }
    if ($path -eq "" -or $path -eq "zender.html") { Send $ssl 200 "text/html; charset=utf-8" $S.zender; return }
    $f = $S.fails[$ip]
    if ($f -and $f.count -ge 5 -and (Get-Date) -lt $f.until) { Send $ssl 429 "application/json" $enc.GetBytes('{"error":"blocked"}'); return }
    $sig = Invoke-Signal $method $path $query $body $false
    if ($sig -and $sig.status -eq 403 -and $path -eq "signal/offer") {
      if (-not $f -or (Get-Date) -ge $f.until) { $f = @{ count = 0 }; $S.fails[$ip] = $f }
      $f.count++; $f.until = (Get-Date).AddMinutes(10)
      [Console]::WriteLine("  Verkeerde koppelcode vanaf $ip ($($f.count)x)")
    }
    if ($sig) { Send $ssl $sig.status $sig.type $enc.GetBytes($sig.body) }
    else { Send $ssl 404 "text/plain" $enc.GetBytes("niet gevonden") }
  } catch {
    Log "fout: $($_.Exception.InnerException.Message) $($_.Exception.Message)"
    # meestal: verbinding viel weg of de telefoon vertrouwt het certificaat (nog) niet
  } finally {
    if ($stream) { $stream.Dispose() }
    $client.Close()
  }
}

$pool = [RunspaceFactory]::CreateRunspacePool(1, 16)
$pool.Open()
$jobs = New-Object Collections.ArrayList
function Start-Handler($client, $tls) {
  $ps = [PowerShell]::Create()
  $ps.RunspacePool = $pool
  [void]$ps.AddScript($handler).AddArgument($client).AddArgument($tls).AddArgument($shared)
  [void]$jobs.Add(@{ ps = $ps; h = $ps.BeginInvoke() })
}

while ($true) {
  if ($plain.Pending()) { Start-Handler $plain.AcceptTcpClient() $false }
  elseif ($tcp.Pending()) { Start-Handler $tcp.AcceptTcpClient() $true }
  else { Start-Sleep -Milliseconds 20 }
  foreach ($j in @($jobs | Where-Object { $_.h.IsCompleted })) {
    try { [void]$j.ps.EndInvoke($j.h) } catch {}
    $j.ps.Dispose(); $jobs.Remove($j)
  }
}
