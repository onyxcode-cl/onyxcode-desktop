# Prueba REAL de resources\updater\swap.ps1 en Windows, sin tocar la app instalada ni el registro. Solo trabaja bajo C:\onyx\tmp\swapcheck.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File C:\onyx\wt\scripts\win\swap-check.ps1 [-Branch rama]
# Usa el modo de prueba del script (LAZUNOX_SWAP_TEST_NO_OPEN=1, que solo vale bajo C:\onyx\). El "ejecutable" de la app es una copia de ping.exe.
# Escenarios: (1) camino feliz: la app nueva "confirma" el arranque (boot-ok) y se queda la version nueva;
#             (2) rollback: no hay boot-ok y vuelve la version antigua dejando la fallida aparte;
#             (3) argumentos hostiles: destino que no se llama Lazunox, ruta con .., ruta con ADS -> exit 64 sin tocar nada.
# -Wt: carpeta del repo (por defecto $Root\wt; en CI es el workspace). En CI $Root debe colgar de %TEMP% (swap.ps1 en modo de prueba solo lo acepta ahi o bajo C:\onyx\).
param([string]$Branch = 'default', [string]$Root = 'C:\onyx', [string]$Wt = '')
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$Branch = $Branch -replace '[\\/:*?"<>|]', '-'
$logs = Join-Path $Root "logs\$Branch"
New-Item -ItemType Directory -Force $logs | Out-Null
$out = Join-Path $logs 'swap-check.txt'
Set-Content -Path $out -Value ("SWAP-CHECK " + (Get-Date -Format s)) -Encoding ascii
function Log([string]$m) { Add-Content -Path $out -Value $m -Encoding ascii; Write-Output $m }
$script:fail = 0
function Check([string]$name, [bool]$ok, [string]$detail = '') {
  if ($ok) { Log "OK    $name $detail" } else { Log "FALLA $name $detail"; $script:fail++ }
}

$wtDir = if ($Wt) { $Wt } else { Join-Path $Root 'wt' }
$swapSrc = Join-Path $wtDir 'resources\updater\swap.ps1'
$base = Join-Path $Root 'tmp\swapcheck'
if (-not $base.StartsWith("$Root\tmp\", [StringComparison]::OrdinalIgnoreCase)) { Write-Output 'base fuera de C:\onyx\tmp'; exit 2 }
if (-not (Test-Path $swapSrc)) { Write-Output "Falta $swapSrc"; exit 3 }
$ping = Join-Path $env:SystemRoot 'System32\ping.exe'

function New-Layout([string]$name, [string]$ver) {
  $parent = Join-Path $base $name
  if (Test-Path $parent) { Remove-Item -Recurse -Force $parent }
  $target = Join-Path $parent 'Lazunox'
  $staged = Join-Path $parent ".Lazunox.staging-$ver"
  $md = Join-Path $parent 'ud\update'
  foreach ($d in @($target, $staged, $md)) { New-Item -ItemType Directory -Force $d | Out-Null }
  foreach ($d in @($target, $staged)) { Copy-Item $ping (Join-Path $d 'fake.exe') }
  Set-Content (Join-Path $target 'VERSION.txt') 'antigua' -Encoding ascii
  Set-Content (Join-Path $staged 'VERSION.txt') 'nueva' -Encoding ascii
  # Copia del script fuera de Target (la app lo hace igual).
  $run = Join-Path $parent 'run'
  New-Item -ItemType Directory -Force $run | Out-Null
  Copy-Item $swapSrc (Join-Path $run 'swap.ps1')
  return @{ Parent = $parent; Target = $target; Staged = $staged; Bak = (Join-Path $parent '.Lazunox.bak-0.0.1'); Md = $md; Script = (Join-Path $run 'swap.ps1') }
}

function Run-Swap($L, [string]$ver, [int]$pidOld, [int]$waitBoot) {
  $env:LAZUNOX_SWAP_TEST_NO_OPEN = '1'
  $env:LAZUNOX_SWAP_WAIT_PID = '20'
  $env:LAZUNOX_SWAP_WAIT_BOOT = "$waitBoot"
  $env:LAZUNOX_SWAP_TEST_EXEC = 'fake.exe'
  $args2 = @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $L.Script,
    '-AppPid', "$pidOld", '-Target', $L.Target, '-Staged', $L.Staged, '-Bak', $L.Bak, '-MarkerDir', $L.Md, '-Version', $ver)
  $p = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList $args2 -PassThru -WindowStyle Hidden
  if (-not $p.WaitForExit(120000)) { & taskkill.exe /PID $p.Id /T /F | Out-Null; return -999 }
  return $p.ExitCode
}
function Read-Result($L) {
  $ef = Join-Path $L.Md 'swap-error.txt'
  if (Test-Path $ef) { Log ('DETALLE swap-error: ' + ((Get-Content $ef -Raw) -replace '\s+', ' ')) }
  $f = Join-Path $L.Md 'result.json'
  if (Test-Path $f) { try { return (Get-Content $f -Raw | ConvertFrom-Json) } catch { return $null } }
  return $null
}
function Old-App { Start-Process -FilePath $ping -ArgumentList @('-n', '4', '127.0.0.1') -PassThru -WindowStyle Hidden }

# ---- 1. camino feliz ----
$L = New-Layout 'feliz' '9.9.9'
$old = Old-App
$marker = Join-Path $L.Md 'boot-ok-9.9.9'
$job = Start-Job -ScriptBlock { param($m) Start-Sleep -Seconds 6; Set-Content -Path $m -Value 'ok' -Encoding ascii } -ArgumentList $marker
$code = Run-Swap $L '9.9.9' $old.Id 30
Remove-Job $job -Force -ErrorAction SilentlyContinue
$r = Read-Result $L
Check 'feliz: exit 0' ($code -eq 0) "codigo=$code"
Check 'feliz: result.json ok:true, rolledBack:false' ($r -and $r.ok -eq $true -and $r.rolledBack -eq $false) ($r | ConvertTo-Json -Compress)
Check 'feliz: queda la version nueva' ((Get-Content (Join-Path $L.Target 'VERSION.txt') -ErrorAction SilentlyContinue) -eq 'nueva')
Check 'feliz: la antigua queda en la copia' ((Get-Content (Join-Path $L.Bak 'VERSION.txt') -ErrorAction SilentlyContinue) -eq 'antigua')
Check 'feliz: sin staging sobrante' (-not (Test-Path $L.Staged))

# ---- 2. rollback ----
$L = New-Layout 'rollback' '9.9.8'
$old = Old-App
$code = Run-Swap $L '9.9.8' $old.Id 6
$r = Read-Result $L
Check 'rollback: exit distinto de 0' ($code -ne 0 -and $code -ne -999) "codigo=$code"
Check 'rollback: result.json rolledBack:true' ($r -and $r.ok -eq $false -and $r.rolledBack -eq $true -and $r.error -eq 'boot-timeout') ($r | ConvertTo-Json -Compress)
Check 'rollback: vuelve la version antigua' ((Get-Content (Join-Path $L.Target 'VERSION.txt') -ErrorAction SilentlyContinue) -eq 'antigua')
Check 'rollback: la fallida queda aparte' ((Get-Content (Join-Path $L.Parent '.Lazunox.failed-9.9.8\VERSION.txt') -ErrorAction SilentlyContinue) -eq 'nueva')

# ---- 3. argumentos hostiles (no deben tocar nada) ----
$L = New-Layout 'hostil' '9.9.7'
$old = Old-App
$bad = @{}
$bad['destino no es Lazunox'] = $L.Target + 'X'
$bad['ruta con ..'] = (Join-Path $L.Parent 'x\..\Lazunox')
$bad['ruta con ADS'] = $L.Target + ':evil'
foreach ($k in $bad.Keys) {
  $L2 = $L.Clone(); $L2.Target = $bad[$k]
  $c = Run-Swap $L2 '9.9.7' $old.Id 3
  Check "hostil ($k): exit 64" ($c -eq 64) "codigo=$c"
}
Check 'hostil: nada cambio' ((Get-Content (Join-Path $L.Target 'VERSION.txt') -ErrorAction SilentlyContinue) -eq 'antigua' -and (Test-Path $L.Staged))

# ---- limpieza: solo lo nuestro ----
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith("$base\", [StringComparison]::OrdinalIgnoreCase) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
Remove-Item -Recurse -Force $base -ErrorAction SilentlyContinue
Check 'limpieza: sin restos' (-not (Test-Path $base))
Remove-Item Env:\LAZUNOX_SWAP_TEST_NO_OPEN, Env:\LAZUNOX_SWAP_WAIT_PID, Env:\LAZUNOX_SWAP_WAIT_BOOT, Env:\LAZUNOX_SWAP_TEST_EXEC -ErrorAction SilentlyContinue
Log "FALLOS=$($script:fail)"
exit $script:fail
