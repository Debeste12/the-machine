# Kleine lokale webserver voor The Machine.
# Nodig omdat de browser de camera, de modellen en Ollama alleen goed toestaat via http://localhost.
# -NoBrowser: geen nieuw browsertabblad (bij /reboot laadt de open pagina zichzelf opnieuw).
param([switch]$NoBrowser)
$port = 8080
$root = $PSScriptRoot
. (Join-Path $root "signal.ps1")
$mime = @{
  ".html" = "text/html; charset=utf-8"; ".js" = "application/javascript"; ".css" = "text/css"
  ".json" = "application/json"; ".bin" = "application/octet-stream"; ".png" = "image/png"
  ".ico" = "image/x-icon"; ".svg" = "image/svg+xml"
  ".mjs" = "application/javascript"; ".wasm" = "application/wasm"; ".onnx" = "application/octet-stream"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
try { $listener.Start() } catch {
  Write-Host "Kan poort $port niet openen. Draait The Machine al in een ander venster?" -ForegroundColor Red
  Read-Host "Druk op Enter om te sluiten"; exit
}

Write-Host ""
Write-Host "  THE MACHINE // ONLINE op http://localhost:$port/" -ForegroundColor Green
Write-Host "  Sluit dit venster om te stoppen." -ForegroundColor DarkGray
if (-not $NoBrowser) {
  # Fullscreen openen (zoals F11): Chrome of Edge met --start-fullscreen, standaardbrowser heeft voorrang als dat er een van is
  $chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  $edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  $progId = (Get-ItemProperty "HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice" -ErrorAction SilentlyContinue).ProgId
  # Firefox als standaard: daar staan profielen/geheugen in localStorage. Eigen venster (ook als Firefox al open is);
  # F11 volgt via system/fullscreen zodra de camera's zijn goedgekeurd (een toestemmingsvraag zou fullscreen anders weer opheffen)
  $firefox = @("$env:ProgramFiles\Mozilla Firefox\firefox.exe", "${env:ProgramFiles(x86)}\Mozilla Firefox\firefox.exe",
    (Get-ItemProperty "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe" -ErrorAction SilentlyContinue).'(default)',
    (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe" -ErrorAction SilentlyContinue).'(default)') |
    Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  $browser = if ($progId -like "MSEdge*" -and $edge) { $edge } elseif ($chrome) { $chrome } else { $edge }
  if ($progId -like "Firefox*" -and $firefox) { Start-Process $firefox -ArgumentList "--new-window `"http://localhost:$port/`"" }
  elseif ($browser) { Start-Process $browser -ArgumentList "--new-window --start-fullscreen `"http://localhost:$port/`"" }
  else { Start-Process "http://localhost:$port/" }
}

# /exit en /reboot: alle onderdelen van The Machine stoppen die start.bat heeft gestart (alleen uit deze map)
function Stop-MachineParts($withOllama) {
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.ProcessId -ne $PID -and ($_.CommandLine -like "*$root\camserver.ps1*" -or $_.CommandLine -like "*$root\ollama.ps1*") } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-Process whisper-server, cloudflared -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$root\*" } |
    Stop-Process -Force -ErrorAction SilentlyContinue
  # Ollama alleen bij /exit (maakt het geheugen van de GPU vrij); bij /reboot blijft hij draaien, dan is hij meteen weer klaar
  if ($withOllama) { Get-Process ollama -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue }
  Start-Sleep 2   # poorten en tunnel.log vrijgeven
}

# Toetsen naar het browservenster van The Machine (titel "The Machine — Mozilla Firefox"), alleen als dat venster echt
# vooraan staat, zodat F11 of Ctrl+W nooit in een ander programma of ander browservenster terechtkomt
Add-Type -TypeDefinition @"
using System; using System.Text; using System.Diagnostics; using System.Runtime.InteropServices; using System.Text.RegularExpressions;
public static class MachineWin {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static IntPtr Find() {
    IntPtr found = IntPtr.Zero;
    var re = new Regex(@"^The Machine( \S (Mozilla Firefox|Google Chrome|Microsoft.*Edge))?$");
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
      if (!re.IsMatch(sb.ToString())) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      string name = ""; try { name = Process.GetProcessById((int)pid).ProcessName.ToLower(); } catch {}
      if (name == "firefox" || name == "chrome" || name == "msedge") { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static void Keys(byte[] vks) {
    foreach (var k in vks) keybd_event(k, 0, 0, UIntPtr.Zero);
    for (int i = vks.Length - 1; i >= 0; i--) keybd_event(vks[i], 0, 2, UIntPtr.Zero);
  }
}
"@
function Send-MachineKeys([byte[]]$keys) {
  $h = [MachineWin]::Find()
  if ($h -eq [IntPtr]::Zero) { return $false }
  if ([MachineWin]::GetForegroundWindow() -ne $h) { [void][MachineWin]::SetForegroundWindow($h); Start-Sleep -Milliseconds 300 }
  if ([MachineWin]::GetForegroundWindow() -ne $h) { return $false }
  [MachineWin]::Keys($keys); return $true
}
$stopAction = $null

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart("/"))
  if ($path -eq "") { $path = "index.html" }
  $res = $ctx.Response
  # /exit en /reboot (wie het mag = ADMIN, dat controleert index.html). Een andere website kan de X-Machine-header niet meesturen.
  if ($req.HttpMethod -eq "POST" -and ($path -eq "system/exit" -or $path -eq "system/reboot")) {
    $origin = $req.Headers["Origin"]
    $ok = $req.Headers["X-Machine"] -eq "1" -and (-not $origin -or $origin -eq "http://localhost:$port")
    $res.StatusCode = if ($ok) { 200 } else { 403 }
    $res.Close()
    if ($ok) { $stopAction = $path.Substring(7); break }
    continue
  }
  # fullscreen (F11) zodra de camera's zijn goedgekeurd; 409 = venster niet vooraan, dan doet de pagina het zelf bij een klik
  if ($req.HttpMethod -eq "POST" -and $path -eq "system/fullscreen") {
    $origin = $req.Headers["Origin"]
    $ok = $req.Headers["X-Machine"] -eq "1" -and (-not $origin -or $origin -eq "http://localhost:$port")
    $res.StatusCode = if (-not $ok) { 403 } elseif (Send-MachineKeys @(0x7A)) { 200 } else { 409 }
    $res.Close(); continue
  }
  try {
    $body = ""
    if ($req.HasEntityBody) { $body = (New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)).ReadToEnd() }
    $sig = Invoke-Signal $req.HttpMethod $path $req.QueryString $body $true
    if ($sig) {
      $bytes = [Text.Encoding]::UTF8.GetBytes($sig.body)
      $res.StatusCode = $sig.status; $res.ContentType = $sig.type
      $res.ContentLength64 = $bytes.Length
      if ($bytes.Length) { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
      $res.Close(); continue
    }
  } catch { $res.StatusCode = 500; $res.Close(); continue }
  $file = [IO.Path]::GetFullPath((Join-Path $root $path))
  if ($file.StartsWith($root) -and (Test-Path $file -PathType Leaf)) {
    $bytes = [IO.File]::ReadAllBytes($file)
    $ext = [IO.Path]::GetExtension($file).ToLower()
    $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" }
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } else {
    $res.StatusCode = 404
  }
  $res.Close()
}

if ($stopAction) {
  $listener.Stop()
  Write-Host "  THE MACHINE // $($stopAction.ToUpper())..." -ForegroundColor Yellow
  Stop-MachineParts ($stopAction -eq "exit")
  # /exit: de pagina sluit zichzelf (window.close); staat het venster er na een paar seconden nog, dan dat ene venster
  # sluiten (WM_CLOSE). Het is een eigen venster met één tabblad, dus F11 is dan ook weg; andere vensters blijven open.
  if ($stopAction -eq "exit") {
    for ($i = 0; $i -lt 6 -and [MachineWin]::Find() -ne [IntPtr]::Zero; $i++) { Start-Sleep -Milliseconds 500 }
    $h = [MachineWin]::Find()
    if ($h -ne [IntPtr]::Zero) { [void][MachineWin]::PostMessage($h, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) }
  }
  # nieuw THE MACHINE-venster; dit venster sluit zichzelf omdat start.bat hierna klaar is
  if ($stopAction -eq "reboot") { Start-Process cmd.exe -ArgumentList "/c `"`"$root\start.bat`" reboot`"" -WorkingDirectory $root }
}
