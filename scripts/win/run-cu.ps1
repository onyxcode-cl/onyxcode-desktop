# Pruebas de Control del PC en Windows en una sesion GRAFICA del PC de pruebas (plan win-C, C7). PowerShell 5.1.
# SOLO a pedido del dueno: algunas fases mueven el raton real y teclean EN UNA VENTANA PROPIA de prueba. Hace falta la sesion de
# escritorio abierta, DESBLOQUEADA y SIN elevar (no SSH puro, no "Ejecutar como administrador"): por SSH se lanza con una tarea
# programada interactiva de un solo uso (/IT), como en el plan:
#   schtasks /Create /TN lazunox-cu /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\onyx\cu\run-cu.ps1 -Step check" /SC ONCE /ST 00:00 /IT /RU <usuario> /F
#   schtasks /Run /TN lazunox-cu     (esperar C:\onyx\cu\logs\check.done con limite de tiempo; despues schtasks /Delete /TN lazunox-cu /F)
# Pasos (-Step):
#   check      Solo lectura: scripts\win\cu-helper-check.ps1 (version, screens, cursor, permissions, session...). No hace clics.
#              Con -WithCapture hace UNA captura de pantalla (lectura) en el temporal.
#   defender   Escaneo a demanda del helper con Windows Defender (MpCmdRun -Scan -ScanType 3 -File) y las ultimas detecciones. Solo lectura.
#   clickjack  Dos ventanas PROPIAS (base y capa casi transparente encima, scripts\win\clickjack.ps1). Consulta app-at sobre la base:
#              debe devolver el proceso de la CAPA. No envia ningun clic ni tecla: solo consultas.
#   e2e        npm run test:e2e -- e2e/specs/computer-win.e2e.ts con LAZUNOX_CU_E2E=1 (helper real sobre la ventana de prueba
#              propia; mueve el raton real y teclea en ella). Necesita el codigo subido con scripts\win\sync.sh en <Root>\wt.
# Todo con limite de tiempo, sin red, sin carga artificial, y solo bajo <Root>. Escribe <Root>\cu\logs\<Step>.log y <Step>.done
# (codigo de salida). Nunca cierra procesos ajenos: solo los que lanzo este script.
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('check', 'defender', 'clickjack', 'e2e')]
  [string]$Step,
  [string]$Root = 'C:\onyx',
  [string]$Helper = '',
  [switch]$WithCapture
)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$cuDir = Join-Path $Root 'cu'
$logs = Join-Path $cuDir 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$log = Join-Path $logs ($Step + '.log')
$done = Join-Path $logs ($Step + '.done')
Remove-Item -Force -LiteralPath $done -ErrorAction SilentlyContinue
Set-Content -Path $log -Value ('RUN-CU ' + (Get-Date -Format s) + ' step=' + $Step) -Encoding ascii
if (-not $Helper) { $Helper = Join-Path $cuDir 'cu-helper.exe' }
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$started = New-Object System.Collections.ArrayList

function Log([string]$m) { Add-Content -Path $log -Value $m -Encoding ascii; Write-Output $m }
function Finish([int]$code) {
  # Solo se cierra lo que lanzo este script (por PID), con su arbol.
  foreach ($p in $started) {
    try { if ($p -and -not $p.HasExited) { & taskkill.exe /PID $p.Id /T /F *> $null; Log ('cerrado proceso propio pid=' + $p.Id) } } catch { }
  }
  $left = @(Get-Process -Name 'cu-helper' -ErrorAction SilentlyContinue)
  Log ('cu-helper vivos al terminar: ' + $left.Count)
  Log ('EXIT=' + $code)
  Set-Content -Path $done -Value $code -Encoding ascii
  exit $code
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Log ('administrador=' + $isAdmin + ' usuario=' + $env:USERNAME + ' sesion=' + [System.Diagnostics.Process]::GetCurrentProcess().SessionId)
if ($isAdmin -and ($Step -eq 'clickjack' -or $Step -eq 'e2e')) {
  Log 'FALLA este paso necesita una sesion SIN elevar (Control del PC no funciona con permisos de administrador). No se ejecuta.'
  Finish 4
}

# Ejecuta un exe con limite de tiempo y devuelve @{ Code; Out; Err; TimedOut }. stdin abierto (como el llamador real).
function Run-Limited([string]$File, [string]$ArgLine, [int]$Seconds, [hashtable]$EnvVars = @{}, [string]$WorkDir = '') {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $File
  $psi.Arguments = $ArgLine
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  if ($WorkDir) { $psi.WorkingDirectory = $WorkDir }
  foreach ($k in $EnvVars.Keys) { $psi.EnvironmentVariables[$k] = [string]$EnvVars[$k] }
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  [void]$p.Start()
  [void]$started.Add($p)
  $so = $p.StandardOutput.ReadToEndAsync()
  $se = $p.StandardError.ReadToEndAsync()
  $timedOut = $false
  if (-not $p.WaitForExit($Seconds * 1000)) {
    $timedOut = $true
    & taskkill.exe /PID $p.Id /T /F *> $null
    [void]$p.WaitForExit(3000)
  }
  $code = -1
  if (-not $timedOut) { $code = $p.ExitCode }
  return @{ Code = $code; Out = $so.Result.Trim(); Err = $se.Result.Trim(); TimedOut = $timedOut }
}

function Helper-Json([string]$ArgLine) {
  $env2 = @{ CU_TEMP_DIR = (Join-Path $cuDir 'tmp') }
  $r = Run-Limited $Helper $ArgLine 15 $env2
  $obj = $null
  if ($r.Out) { try { $obj = $r.Out | ConvertFrom-Json } catch { } }
  return @{ Code = $r.Code; Obj = $obj; Raw = $r.Out; Err = $r.Err }
}

New-Item -ItemType Directory -Force (Join-Path $cuDir 'tmp') | Out-Null

if ($Step -ne 'e2e' -and -not (Test-Path -LiteralPath $Helper)) {
  Log ('FALLA no existe el helper: ' + $Helper)
  Finish 2
}

if ($Step -eq 'check') {
  $script = Join-Path $here 'cu-helper-check.ps1'
  if (-not (Test-Path -LiteralPath $script)) { $script = Join-Path $Root 'wt\scripts\win\cu-helper-check.ps1' }
  $a = '-NoProfile -ExecutionPolicy Bypass -File "' + $script + '" -Helper "' + $Helper + '" -LogFile "' + $log + '"'
  if ($WithCapture) { $a = $a + ' -WithCapture' }
  $r = Run-Limited 'powershell.exe' $a 180
  if ($r.TimedOut) { Log 'FALLA tiempo agotado (180 s)'; Finish 5 }
  Log ('cu-helper-check salio con ' + $r.Code)
  Finish $r.Code
}

if ($Step -eq 'defender') {
  $mp = Join-Path $env:ProgramFiles 'Windows Defender\MpCmdRun.exe'
  if (-not (Test-Path -LiteralPath $mp)) { Log 'AVISO no hay MpCmdRun.exe (Defender no instalado o gestionado por otro antivirus)'; Finish 0 }
  $r = Run-Limited $mp ('-Scan -ScanType 3 -File "' + $Helper + '"') 300
  Log $r.Out
  if ($r.TimedOut) { Log 'FALLA tiempo agotado (300 s)'; Finish 5 }
  Log ('MpCmdRun salio con ' + $r.Code + ' (0 = sin amenazas)')
  try {
    $det = @(Get-MpThreatDetection -ErrorAction Stop | Sort-Object InitialDetectionTime -Descending | Select-Object -First 5)
    Log ('detecciones recientes: ' + $det.Count)
    foreach ($d in $det) { Log ('  ' + $d.InitialDetectionTime + ' ' + $d.Resources) }
  } catch { Log 'AVISO no se pudo leer el historial de proteccion (Get-MpThreatDetection)' }
  Finish $r.Code
}

if ($Step -eq 'clickjack') {
  $baseInfo = Join-Path $logs 'cj-base.json'
  $layerInfo = Join-Path $logs 'cj-layer.json'
  $stopFile = Join-Path $logs 'cj.stop'
  Remove-Item -Force -LiteralPath $baseInfo, $layerInfo, $stopFile -ErrorAction SilentlyContinue
  $cj = Join-Path $here 'clickjack.ps1'
  if (-not (Test-Path -LiteralPath $cj)) { $cj = Join-Path $Root 'wt\scripts\win\clickjack.ps1' }
  $rect = '300,200,420,280'
  $common = '-NoProfile -ExecutionPolicy Bypass -File "' + $cj + '" -Rect ' + $rect + ' -DoneFile "' + $stopFile + '" -Seconds 60'
  $pb = Start-Process -FilePath 'powershell.exe' -ArgumentList ($common + ' -Role Base -InfoFile "' + $baseInfo + '"') -PassThru -WindowStyle Hidden
  [void]$started.Add($pb)
  $deadline = (Get-Date).AddSeconds(20)
  while (-not (Test-Path -LiteralPath $baseInfo) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
  $pl = Start-Process -FilePath 'powershell.exe' -ArgumentList ($common + ' -Role Layer -InfoFile "' + $layerInfo + '"') -PassThru -WindowStyle Hidden
  [void]$started.Add($pl)
  $deadline = (Get-Date).AddSeconds(20)
  while (-not (Test-Path -LiteralPath $layerInfo) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
  if (-not (Test-Path -LiteralPath $baseInfo) -or -not (Test-Path -LiteralPath $layerInfo)) {
    Log 'FALLA no aparecieron las dos ventanas de prueba (sesion bloqueada o sin escritorio?)'
    Set-Content -LiteralPath $stopFile -Value 'x' -Encoding ascii
    Finish 6
  }
  $b = (Get-Content -LiteralPath $baseInfo -Raw) | ConvertFrom-Json
  $l = (Get-Content -LiteralPath $layerInfo -Raw) | ConvertFrom-Json
  Log ('base pid=' + $b.pid + ' capa pid=' + $l.pid)
  # Punto sobre el centro de la base: SOLO se consulta quien esta encima. No se envia ningun clic.
  $px = [int]($b.x + $b.width / 2)
  $py = [int]($b.y + $b.height / 2)
  Start-Sleep -Milliseconds 500
  $at = Helper-Json ('app-at ' + $px + ' ' + $py)
  $fail = 0
  if ($at.Code -ne 0 -or $null -eq $at.Obj) {
    Log ('FALLA app-at salio con ' + $at.Code + ': ' + $at.Raw + ' ' + $at.Err)
    $fail++
  } else {
    Log ('app-at(' + $px + ',' + $py + ') -> pid=' + $at.Obj.pid + ' nombre=' + $at.Obj.name)
    if ([int]$at.Obj.pid -eq [int]$l.pid) { Log 'OK     app-at devuelve el proceso de la CAPA (el MCP rechazaria el clic: la app bajo el punto no es la concedida)' }
    elseif ([int]$at.Obj.pid -eq [int]$b.pid) { Log 'FALLA app-at devuelve la BASE aunque hay una capa encima: la defensa contra clickjacking no veria la capa'; $fail++ }
    else { Log ('AVISO app-at devuelve un tercer proceso (pid ' + $at.Obj.pid + '): revisa que no haya otra ventana encima') }
  }
  Set-Content -LiteralPath $stopFile -Value 'x' -Encoding ascii
  Start-Sleep -Milliseconds 800
  if ($fail -eq 0) { Finish 0 } else { Finish 1 }
}

if ($Step -eq 'e2e') {
  $wt = Join-Path $Root 'wt'
  if (-not (Test-Path -LiteralPath (Join-Path $wt 'package.json'))) { Log ('FALLA no hay codigo en ' + $wt + ' (usa scripts\win\sync.sh)'); Finish 2 }
  if (-not (Test-Path -LiteralPath $Helper)) { Log ('FALLA no existe el helper: ' + $Helper); Finish 2 }
  $env:Path = (Join-Path $Root 'node22') + ';' + $env:Path
  $npmCmd = Join-Path $Root 'node22\npm.cmd'
  $envs = @{ LAZUNOX_CU_E2E = '1'; LAZUNOX_CU_HELPER = $Helper; CI = '1' }
  Log 'e2e: ventana propia de prueba; el raton real se mueve. No toques el PC durante 2 minutos.'
  $r = Run-Limited 'cmd.exe' ('/c ""' + $npmCmd + '" run test:e2e -- e2e/specs/computer-win.e2e.ts"') 600 $envs $wt
  Log $r.Out
  if ($r.Err) { Log $r.Err }
  if ($r.TimedOut) { Log 'FALLA tiempo agotado (600 s)'; Finish 5 }
  Finish $r.Code
}

Finish 0
