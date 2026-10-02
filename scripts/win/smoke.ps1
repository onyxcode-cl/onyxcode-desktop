# Humo de arranque en el PC Windows de pruebas: app en modo "sin pantalla" (ONYXCODE_E2E_HEADLESS) con el
# OpenCode embebido como OPENCODE_BIN. Comprueba: servidor listo < 30 s, sin ventana de consola, al cerrar no
# queda opencode.exe, y tras matar electron.exe a la fuerza el siguiente arranque limpia el huerfano.
# Solo toca C:\onyx\. Todo con limite de tiempo y limpieza al final.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File C:\onyx\smoke.ps1 -Branch feat-win-t1-arranque
param([string]$Branch = 'default', [string]$Root = 'C:\onyx')
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$wt = Join-Path $Root 'wt'
$logs = Join-Path $Root "logs\$Branch"
New-Item -ItemType Directory -Force $logs | Out-Null
$out = Join-Path $logs 'smoke.txt'
Set-Content -Path $out -Value ("SMOKE " + (Get-Date -Format s)) -Encoding ascii
function Log([string]$m) { Add-Content -Path $out -Value $m -Encoding ascii; Write-Output $m }
$electron = Join-Path $wt 'node_modules\electron\dist\electron.exe'
$opencode = Join-Path $wt 'resources\opencode-bin\bin\opencode.exe'
$ud = Join-Path $Root 'tmp\ud-smoke'
$appLog = Join-Path $logs 'smoke-app.log'
$script:fail = 0
function Check([string]$name, [bool]$ok, [string]$detail = '') {
  if ($ok) { Log "OK    $name $detail" } else { Log "FALLA $name $detail"; $script:fail++ }
}
function OnyxProcs {
  Get-CimInstance Win32_Process | Where-Object {
    ($_.ExecutablePath -and $_.ExecutablePath.StartsWith("$Root\", [StringComparison]::OrdinalIgnoreCase) -and $_.Name -match '^(electron|opencode)\.exe$') -or
    ($_.CommandLine -and $_.CommandLine -match [regex]::Escape($ud))
  }
}
function Cleanup {
  foreach ($p in (OnyxProcs)) { & taskkill.exe /PID $p.ProcessId /T /F *> $null }
}
function Start-App {
  Remove-Item -Force $appLog -ErrorAction SilentlyContinue
  $env:ONYXCODE_E2E_HEADLESS = '1'
  $env:OPENCODE_BIN = $opencode
  $env:ELECTRON_ENABLE_LOGGING = '1'
  $env:ONYXCODE_ACCOUNT_DISABLED = '1'   # solo sin empaquetar: la app no pide iniciar sesion (como en los E2E)
  Remove-Item Env:ELECTRON_RENDERER_URL -ErrorAction SilentlyContinue
  $a = "/d /c `"`"$electron`" `"$wt`" --user-data-dir=`"$ud`" > `"$appLog`" 2>&1`""
  return Start-Process -FilePath cmd.exe -ArgumentList $a -WorkingDirectory $wt -PassThru -WindowStyle Hidden
}
function Wait-Ready([int]$sec) {
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt $sec) {
    if ((Test-Path $appLog) -and (Select-String -Path $appLog -Pattern '\[opencode\] listo' -Quiet)) { return [int]((Get-Date) - $t0).TotalMilliseconds }
    Start-Sleep -Milliseconds 250
  }
  return -1
}
function Opencodes { @(Get-CimInstance Win32_Process -Filter "Name='opencode.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith("$Root\", [StringComparison]::OrdinalIgnoreCase) }) }
function Electrons { @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith("$Root\", [StringComparison]::OrdinalIgnoreCase) }) }
function Wait-None([scriptblock]$what, [int]$sec) {
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt $sec) { if (@(& $what).Count -eq 0) { return $true }; Start-Sleep -Milliseconds 500 }
  return $false
}
# Cierre normal: WM_CLOSE a las ventanas del proceso principal (en una sesion SSH sin escritorio Process.CloseMainWindow
# no ve la ventana, pero EnumWindows si). La app debe salir sola (before-quit) y matar su opencode.exe.
$env:TEMP = Join-Path $Root 'tmp'; $env:TMP = $env:TEMP
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class WinClose {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static int CloseAll(uint pid) { int n = 0;
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid) { n++; PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero); } return true; }, IntPtr.Zero); return n; }
}
"@
function Close-App {
  foreach ($e in @(Electrons | Where-Object { $_.CommandLine -notmatch '--type=' })) { [void][WinClose]::CloseAll([uint32]$e.ProcessId) }
}

if (-not (Test-Path $electron)) { Log "FALLA falta electron.exe (npm ci)"; exit 2 }
if (-not (Test-Path $opencode)) { Log "FALLA falta opencode.exe (node scripts\fetch-opencode.mjs)"; exit 2 }
if (-not (Test-Path (Join-Path $wt 'out\main\index.js'))) { Log "FALLA falta out\main\index.js (npm run build)"; exit 2 }
Cleanup
Remove-Item -Recurse -Force $ud -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $ud | Out-Null
# settings.json ANTES de arrancar (como e2e/lib/launch.ts): sin el, migrateLegacyUserData miraria los datos de nombres antiguos de la app;
# onboarded=true para que el renderer llegue a la app y haga sus lecturas de arranque.
$settings = '{"defaultModel":{"providerID":"fake","modelID":"fake-model"},"theme":"system","recentFolders":[],"tasksGlobalInstructions":"","onboarded":true,"routinesTermsAcknowledged":true,"language":"es"}'
Set-Content -Path (Join-Path $ud 'settings.json') -Value $settings -Encoding ascii

try {
  # --- 1) arranque normal ---
  $p1 = Start-App
  $ms = Wait-Ready 40
  Check 'ready < 30 s' ($ms -ge 0 -and $ms -lt 30000) "($ms ms)"
  $oc = @(Opencodes)
  Check 'hay un opencode.exe del embebido' ($oc.Count -ge 1) ("(" + $oc.Count + ")")
  foreach ($o in $oc) {
    $gp = Get-Process -Id $o.ProcessId -ErrorAction SilentlyContinue
    Check "opencode.exe pid $($o.ProcessId) sin ventana" ($gp -and $gp.MainWindowHandle -eq 0) "(MainWindowHandle=$($gp.MainWindowHandle))"
    $con = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($o.ProcessId)" | Where-Object { $_.Name -eq 'conhost.exe' })
    Log "info  conhost hijos de opencode: $($con.Count)"
  }
  $anyConsoleWin = @(Get-Process -Name cmd, powershell, conhost -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match 'opencode' })
  Check 'ninguna ventana de consola de opencode' ($anyConsoleWin.Count -eq 0)
  Start-Sleep -Seconds 8   # da tiempo al renderer a hacer sus lecturas de arranque
  $errs = @(Select-String -Path $appLog -Pattern '\[ipc\] rechazado|Uncaught|UnhandledPromiseRejection|\[ipc\] [a-z]+:' | ForEach-Object { $_.Line })
  Check 'sin errores IPC/no capturados en el log de main' ($errs.Count -eq 0) ($errs -join ' | ')
  Copy-Item $appLog (Join-Path $logs 'smoke-app-1.log') -Force -ErrorAction SilentlyContinue
  Close-App
  $gone = Wait-None { Opencodes } 25
  $gone2 = Wait-None { Electrons } 25
  Check 'al cerrar no queda opencode.exe' $gone
  Check 'al cerrar no queda electron.exe' $gone2
  Cleanup

  # --- 2) matar electron.exe a la fuerza y comprobar la limpieza del huerfano ---
  $p2 = Start-App
  $ms2 = Wait-Ready 40
  Check 'segundo arranque ready' ($ms2 -ge 0) "($ms2 ms)"
  $oldOc = @(Opencodes)
  $mainE = @(Electrons | Where-Object { $_.CommandLine -notmatch '--type=' })
  Check 'hay proceso principal de electron' ($mainE.Count -ge 1)
  foreach ($e in $mainE) { & taskkill.exe /PID $e.ProcessId /F *> $null }   # sin /T: el opencode.exe queda huerfano
  Start-Sleep -Seconds 3
  $oldIds = @($oldOc | ForEach-Object { $_.ProcessId })
  $orph = @(Opencodes | Where-Object { $oldIds -contains $_.ProcessId })
  Log "info  opencode.exe que sobreviven a matar electron.exe: $($orph.Count) (si es 0, termina solo al romperse su tuberia)"
  # Huerfano simulado y determinista: un "opencode.exe serve" falso (node.exe enlazado) apuntado por pids.json con un dueno muerto.
  $fakeDir = Join-Path $Root 'tmp\fake-oc'
  New-Item -ItemType Directory -Force $fakeDir | Out-Null
  $fakeExe = Join-Path $fakeDir 'opencode.exe'
  Remove-Item -Force $fakeExe -ErrorAction SilentlyContinue
  try { New-Item -ItemType HardLink -Path $fakeExe -Target (Join-Path $Root 'node22\node.exe') | Out-Null } catch { Copy-Item (Join-Path $Root 'node22\node.exe') $fakeExe }
  $fake = Start-Process -FilePath $fakeExe -ArgumentList @('-e', 'setTimeout(()=>{},120000)', 'serve') -PassThru -WindowStyle Hidden
  Start-Sleep -Milliseconds 800
  $pj = '[{"pid":' + $fake.Id + ',"kind":"main","startedAt":1,"owner":999999}]'
  Set-Content -Path (Join-Path $ud 'pids.json') -Value $pj -Encoding ascii
  $oldIds += $fake.Id
  Check 'huerfano simulado vivo antes del arranque' (-not $fake.HasExited)
  # restos de electron (renderer/gpu) por si no salieron solos
  foreach ($e in (Electrons)) { & taskkill.exe /PID $e.ProcessId /F *> $null }

  # --- 3) el siguiente arranque limpia el huerfano (killStaleServers) ---
  $p3 = Start-App
  $ms3 = Wait-Ready 40
  Check 'tercer arranque ready' ($ms3 -ge 0) "($ms3 ms)"
  Start-Sleep -Seconds 2
  $fakeAlive = $null -ne (Get-Process -Id $fake.Id -ErrorAction SilentlyContinue)
  Check 'el huerfano simulado fue eliminado al arrancar (killStaleServers)' (-not $fakeAlive)
  Close-App
  $g3 = Wait-None { Opencodes } 25
  $g4 = Wait-None { Electrons } 25
  Check 'al cerrar el tercero no queda opencode.exe' $g3
  Check 'al cerrar el tercero no queda electron.exe' $g4
}
catch { Log "FALLA excepcion: $_"; $script:fail++ }
finally {
  Cleanup
  $left = @(OnyxProcs).Count
  Log "info  procesos propios sobrantes al terminar: $left"
}
Log ("RESULTADO fallos=" + $script:fail)
exit ([int]($script:fail -gt 0))
