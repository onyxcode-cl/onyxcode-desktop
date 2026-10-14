# Reemplazo de la carpeta de la app por la versión ya verificada (Windows). Va SELLADO en
# resources\updater\swap.ps1 y la app lo COPIA a userData\update\run\ antes de lanzarlo, para no ejecutarse desde la
# carpeta que está sustituyendo. Lo arranca src/main/update/swap-win.ts con
#   powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File <copia> -AppPid ... (sin shell).
# Equivale a swap.sh del Mac: nunca toca nada con la app vieja viva, aparta la carpeta actual, pone la nueva, espera
# boot-ok-<ver> y, si no llega, vuelve atrás.
#
#   -AppPid     proceso de la app antigua (debe terminar antes de tocar nada)
#   -Target     carpeta instalada (...\Programs\Lazunox)
#   -Staged     carpeta nueva ya verificada, HERMANA del destino: <padre>\.Lazunox.staging-<ver>
#   -Bak        copia de seguridad, hermana del destino: <padre>\.Lazunox.bak-<verAntigua>
#   -MarkerDir  userData\update (booting-<ver>, boot-ok-<ver>, result.json)
#   -Version    versión nueva
# Escribe MarkerDir\result.json con {"version","ok","rolledBack","error"}.
#
# Modo de prueba (solo el build LAZUNOX_TEST_BUILD pasa estas variables): LAZUNOX_SWAP_TEST_NO_OPEN=1 solo se acepta si
# Target está bajo C:\onyx\ o $env:TEMP. Entonces los tiempos se acortan con LAZUNOX_SWAP_WAIT_PID / LAZUNOX_SWAP_WAIT_BOOT
# (segundos) y además:
#   LAZUNOX_SWAP_TEST_EXEC      nombre del ejecutable que se lanza dentro de Target (por defecto Lazunox.exe)
#   LAZUNOX_SWAP_TEST_USERDATA  la app se lanza con --user-data-dir=<ruta> (nunca toca el userData real)
#   LAZUNOX_SWAP_TEST_FAIL_NEW=1  la app NUEVA se lanza con LAZUNOX_TEST_FAIL_BOOT=1 (rollback forzado)
# No toca el registro en modo de prueba.
param(
  [Parameter(Mandatory = $true)][int]$AppPid,
  [Parameter(Mandatory = $true)][string]$Target,
  [Parameter(Mandatory = $true)][string]$Staged,
  [Parameter(Mandatory = $true)][string]$Bak,
  [Parameter(Mandatory = $true)][string]$MarkerDir,
  [Parameter(Mandatory = $true)][string]$Version
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"

function Fail-Args([string]$why) {
  [Console]::Error.WriteLine("argumentos no validos: $why")
  exit 64
}

# ---- validación de argumentos (defensa en profundidad; la app ya los validó) ----
if ($AppPid -le 1) { Fail-Args 'pid' }
if ($Version -notmatch '^[0-9A-Za-z.+-]{1,64}$') { Fail-Args 'version' }
foreach ($p in @($Target, $Staged, $Bak, $MarkerDir)) {
  if ($p -notmatch '^[A-Za-z]:\\[^\\]') { Fail-Args 'ruta no absoluta' }
  if ($p -match '[\x00-\x1f"/<>|?*]') { Fail-Args 'ruta con caracteres no validos' }
  if ($p.Substring(2) -match ':') { Fail-Args 'ruta con flujo ADS' }
  if ($p -match '\\\\' -or $p.EndsWith('\')) { Fail-Args 'ruta no normalizada' }
  foreach ($seg in $p.Split('\')) { if ($seg -eq '.' -or $seg -eq '..') { Fail-Args 'ruta con . o ..' } }
}
$Parent = [IO.Path]::GetDirectoryName($Target)
if ([IO.Path]::GetFileName($Target) -ine 'Lazunox') { Fail-Args 'destino no es Lazunox' }
if ([IO.Path]::GetDirectoryName($Bak) -ine $Parent -or -not ([IO.Path]::GetFileName($Bak)).StartsWith('.Lazunox.bak-', [StringComparison]::OrdinalIgnoreCase)) { Fail-Args 'copia fuera de la carpeta del destino' }
if ([IO.Path]::GetDirectoryName($Staged) -ine $Parent -or -not ([IO.Path]::GetFileName($Staged)).StartsWith('.Lazunox.staging-', [StringComparison]::OrdinalIgnoreCase)) { Fail-Args 'staged fuera de la carpeta del destino' }
if (-not [IO.Directory]::Exists($Staged)) { Fail-Args 'no existe Staged' }
if (-not [IO.Directory]::Exists($MarkerDir)) { Fail-Args 'no existe el directorio de marcadores' }

$Test = $false
$WaitPid = 60
$WaitBoot = 90
$TestExec = 'Lazunox.exe'
$TestUd = ''
$TestFailNew = $false
if ($env:LAZUNOX_SWAP_TEST_NO_OPEN -eq '1') {
  $t = [IO.Path]::GetFullPath($Target)
  $okRoot = $t.StartsWith('C:\onyx\', [StringComparison]::OrdinalIgnoreCase)
  if ($env:TEMP) { $tmp = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'; if ($t.StartsWith($tmp, [StringComparison]::OrdinalIgnoreCase)) { $okRoot = $true } }
  if (-not $okRoot) { Fail-Args 'modo de prueba solo bajo C:\onyx o %TEMP%' }
  $Test = $true
  if ($env:LAZUNOX_SWAP_WAIT_PID -match '^\d{1,4}$') { $WaitPid = [int]$env:LAZUNOX_SWAP_WAIT_PID }
  if ($env:LAZUNOX_SWAP_WAIT_BOOT -match '^\d{1,4}$') { $WaitBoot = [int]$env:LAZUNOX_SWAP_WAIT_BOOT }
  if ($env:LAZUNOX_SWAP_TEST_EXEC) {
    if ($env:LAZUNOX_SWAP_TEST_EXEC -notmatch '^[A-Za-z0-9._-]+$') { Fail-Args 'ejecutable de prueba no valido' }
    $TestExec = $env:LAZUNOX_SWAP_TEST_EXEC
  }
  if ($env:LAZUNOX_SWAP_TEST_USERDATA) {
    $TestUd = $env:LAZUNOX_SWAP_TEST_USERDATA
    if ($TestUd -notmatch '^[A-Za-z]:\\' -or $TestUd -match '[\x00-\x1f"/]' -or $TestUd -match '(^|\\)\.\.(\\|$)') { Fail-Args 'userdata de prueba no valido' }
  }
  if ($env:LAZUNOX_SWAP_TEST_FAIL_NEW -eq '1') { $TestFailNew = $true }
}

$Failed = Join-Path $Parent (".Lazunox.failed-$Version")
$Result = Join-Path $MarkerDir 'result.json'
$ExeName = 'Lazunox.exe'
if ($Test) { $ExeName = $TestExec }

function Write-Result([bool]$ok, [bool]$rolledBack, [string]$err) {
  $json = '{"version":"' + $Version + '","ok":' + $ok.ToString().ToLowerInvariant() + ',"rolledBack":' + $rolledBack.ToString().ToLowerInvariant() + ',"error":"' + $err + '"}'
  try {
    [IO.File]::WriteAllText("$Result.tmp", $json, (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath "$Result.tmp" -Destination $Result -Force
  } catch { }
}

# Procesos cuyo ejecutable vive bajo la carpeta dada (opencode.exe, OpenConsole.exe, la propia app).
function Get-ProcsUnder([string]$dir) {
  $prefix = $dir.TrimEnd('\') + '\'
  $found = @()
  try {
    foreach ($p in Get-CimInstance -ClassName Win32_Process) {
      $exe = $p.ExecutablePath
      if ($exe -and $exe.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { $found += [int]$p.ProcessId }
    }
  } catch { }
  return $found
}

function Stop-ProcsUnder([string]$dir) {
  foreach ($id in (Get-ProcsUnder $dir)) {
    try { & "$env:SystemRoot\System32\taskkill.exe" /T /F /PID $id *> $null } catch { }
  }
}

function Remove-Tree([string]$path) {
  if (-not [IO.Directory]::Exists($path)) { return }
  for ($i = 0; $i -lt 10; $i++) {
    try { [IO.Directory]::Delete($path, $true); return } catch { Start-Sleep -Milliseconds 500 }
  }
}

function Move-Dir([string]$from, [string]$to) {
  for ($i = 0; $i -lt 40; $i++) {
    try { [IO.Directory]::Move($from, $to); return $true } catch { Start-Sleep -Milliseconds 500 }
  }
  return $false
}

# Clave de desinstalación HKCU de Lazunox que corresponde a Target (solo fuera del modo de prueba). El instalador NSIS (electron-builder)
# escribe «Lazunox <versión>» como nombre y deja InstallLocation vacío: la carpeta se saca entonces de UninstallString
# («"C:\...\Lazunox\Uninstall Lazunox.exe" /currentuser»). Misma regla que `win-location.ts` de la app.
function Get-UninstallKey {
  if ($Test) { return $null }
  try {
    foreach ($k in Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall') {
      $p = Get-ItemProperty -LiteralPath $k.PSPath
      if (-not $p.PSObject.Properties['DisplayName']) { continue }
      if ([string]$p.DisplayName -notmatch '^Lazunox( \d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)*)?$') { continue }
      $loc = ''
      if ($p.PSObject.Properties['InstallLocation'] -and ([string]$p.InstallLocation).Trim() -ne '') {
        $loc = ([string]$p.InstallLocation).Trim().Trim('"').TrimEnd('\')
      } elseif ($p.PSObject.Properties['UninstallString'] -and ([string]$p.UninstallString) -match '^\s*"?(.+?)\\Uninstall Lazunox\.exe') {
        $loc = $Matches[1].TrimEnd('\')
      }
      if ($loc -and $loc -ieq $Target) { return $k.PSPath }
    }
  } catch { }
  return $null
}

# DisplayVersion (lo leen winget y el Panel de control) y, si el nombre lleva la versión («Lazunox 0.5.16»), también el nombre.
function Set-DisplayVersion([string]$keyPath, [string]$v) {
  if (-not $keyPath -or -not $v) { return }
  try { Set-ItemProperty -LiteralPath $keyPath -Name 'DisplayVersion' -Value $v } catch { }
  try {
    $n = [string](Get-ItemProperty -LiteralPath $keyPath).DisplayName
    if ($n -match '^Lazunox \d') { Set-ItemProperty -LiteralPath $keyPath -Name 'DisplayName' -Value ('Lazunox ' + $v) }
  } catch { }
}

function Launch([string]$dir, [bool]$isNew) {
  $exe = Join-Path $dir $ExeName
  try {
    $argList = @()
    if ($Test) {
      $env:LAZUNOX_SWAP_TEST_DIR = $MarkerDir
      if ($isNew -and $TestFailNew) { $env:LAZUNOX_TEST_FAIL_BOOT = '1' } else { Remove-Item Env:\LAZUNOX_TEST_FAIL_BOOT -ErrorAction SilentlyContinue }
      if ($TestUd) { $argList += "--user-data-dir=$TestUd" }
    } else {
      Remove-Item Env:\LAZUNOX_TEST_FAIL_BOOT -ErrorAction SilentlyContinue
    }
    if ($argList.Count -gt 0) { Start-Process -FilePath $exe -ArgumentList $argList -WorkingDirectory $dir | Out-Null }
    else { Start-Process -FilePath $exe -WorkingDirectory $dir | Out-Null }
    return $true
  } catch { return $false }
}

try {
  # 1. Esperar a que la app antigua termine (nunca tocar nada con ella viva).
  $i = 0
  while (Get-Process -Id $AppPid -ErrorAction SilentlyContinue) {
    $i++
    if ($i -gt ($WaitPid * 4)) { Write-Result $false $false 'pid-timeout'; exit 1 }
    Start-Sleep -Milliseconds 250
  }
  # Esperar a los procesos hijos que sigan usando archivos de Target; pasado el plazo, parar SOLO esos.
  $waited = 0
  $limit = 30; if ($Test) { $limit = [Math]::Min(30, $WaitPid) }
  while (@(Get-ProcsUnder $Target).Count -gt 0 -and $waited -lt ($limit * 4)) { Start-Sleep -Milliseconds 250; $waited++ }
  if (@(Get-ProcsUnder $Target).Count -gt 0) { Stop-ProcsUnder $Target; Start-Sleep -Seconds 1 }

  # 2. Apartar la carpeta actual (renombrado atómico en el mismo volumen; reintentos por Defender o el Explorador).
  Remove-Tree $Bak
  if (-not (Move-Dir $Target $Bak)) { Write-Result $false $false 'backup-failed'; Launch $Target $false | Out-Null; exit 1 }

  function Restore-Old {
    if ([IO.Directory]::Exists($Target)) { Remove-Tree $Target }
    [void](Move-Dir $Bak $Target)
  }

  # 3. Poner la nueva (si falla, se restaura la antigua).
  if (-not (Move-Dir $Staged $Target)) {
    Restore-Old
    Launch $Target $false | Out-Null
    Write-Result $false $true 'replace-failed'
    exit 1
  }

  # 4. Desinstalador (win-unpacked no lo trae) y DisplayVersion (lo leen winget y el Panel de control).
  $unins = Join-Path $Bak 'Uninstall Lazunox.exe'
  $uninsNew = Join-Path $Target 'Uninstall Lazunox.exe'
  if ((Test-Path -LiteralPath $unins) -and -not (Test-Path -LiteralPath $uninsNew)) { try { Copy-Item -LiteralPath $unins -Destination $uninsNew } catch { } }
  $key = Get-UninstallKey
  $oldDisplay = $null
  if ($key) { try { $oldDisplay = [string](Get-ItemProperty -LiteralPath $key).DisplayVersion } catch { } }
  Set-DisplayVersion $key $Version

  # 5. Abrir la nueva y esperar su confirmación de arranque.
  Remove-Item -LiteralPath (Join-Path $MarkerDir "booting-$Version") -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $MarkerDir "boot-ok-$Version") -Force -ErrorAction SilentlyContinue
  if (-not (Launch $Target $true)) { $WaitBoot = 0 }
  $ok = $false
  $i = 0
  $bootOk = Join-Path $MarkerDir "boot-ok-$Version"
  $booting = Join-Path $MarkerDir "booting-$Version"
  while ($i -lt ($WaitBoot * 4)) {
    if (Test-Path -LiteralPath $bootOk) { $ok = $true; break }
    if (Test-Path -LiteralPath $booting) {
      $np = ''
      try { $np = ([IO.File]::ReadAllText($booting)).Trim() } catch { }
      if ($np -match '^\d+$' -and -not (Get-Process -Id ([int]$np) -ErrorAction SilentlyContinue)) {
        Start-Sleep -Seconds 1
        if (Test-Path -LiteralPath $bootOk) { $ok = $true }
        break
      }
    }
    $i++
    Start-Sleep -Milliseconds 250
  }
  if ($ok) { Write-Result $true $false ''; exit 0 }

  # 6. Rollback: parar la nueva (solo procesos bajo Target), apartarla y restaurar la antigua.
  Stop-ProcsUnder $Target
  Start-Sleep -Seconds 1
  Remove-Tree $Failed
  if (-not (Move-Dir $Target $Failed)) { Remove-Tree $Target }
  Restore-Old
  if ($oldDisplay) { Set-DisplayVersion $key $oldDisplay }
  Launch $Target $false | Out-Null
  Write-Result $false $true 'boot-timeout'
  exit 1
} catch {
  # Fallo inesperado: si la carpeta de destino no existe pero la copia sí, restaurarla antes de salir.
  $restored = $false
  try {
    if (-not [IO.Directory]::Exists($Target) -and [IO.Directory]::Exists($Bak)) { $restored = Move-Dir $Bak $Target }
    if ([IO.Directory]::Exists($Target)) { Launch $Target $false | Out-Null }
  } catch { }
  # Detalle para diagnostico (solo texto plano, fuera del JSON que lee la app).
  try { [IO.File]::WriteAllText((Join-Path $MarkerDir 'swap-error.txt'), ($_ | Out-String), (New-Object Text.UTF8Encoding($false))) } catch { }
  Write-Result $false $restored 'swap-error'
  exit 1
}
