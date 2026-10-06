# E2E del actualizador de Windows (e2e\specs\update-install-win.e2e.ts) en el PC de pruebas. Solo trabaja bajo C:\onyx\ y deja todo limpio.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File C:\onyx\wt\scripts\win\update-e2e.ps1 [-Branch rama] [-Root C:\onyx] [-LimitSec 900]
# Que prueba: descarga con 302 + verificacion + extraccion con tar.exe REAL contra un servidor local falso (127.0.0.1), con un paquete
# armado por publish-update.mjs --platform win32-x64 y claves Ed25519 EFIMERAS; rechazos (firma, hash, downgrade, ZIP con ..); y
# resources\updater\swap.ps1 en su modo de prueba (feliz y rollback) sobre copias del staging, solo bajo %TEMP% (aqui, C:\onyx\tmp\upd-e2e).
# No instala ni reemplaza la app instalada, no toca el registro ni la clave real. Requiere antes: npm ci y npm run build (sync.sh con STEPS=ci,build).
param([string]$Branch = 'default', [string]$Root = 'C:\onyx', [int]$LimitSec = 900)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$Branch = $Branch -replace '[\\/:*?"<>|]', '-'
$wt = Join-Path $Root 'wt'
$logs = Join-Path $Root "logs\$Branch"
$tmp = Join-Path $Root 'tmp\upd-e2e'
if (-not $tmp.StartsWith("$Root\tmp\", [StringComparison]::OrdinalIgnoreCase)) { Write-Output 'tmp fuera de la raiz'; exit 2 }
New-Item -ItemType Directory -Force $logs | Out-Null
$out = Join-Path $logs 'update-e2e.txt'
Set-Content -Path $out -Value ("UPDATE-E2E " + (Get-Date -Format s)) -Encoding ascii
function Log([string]$m) { Add-Content -Path $out -Value $m -Encoding ascii; Write-Output $m }
function Stop-Ours {
  Get-CimInstance Win32_Process | Where-Object {
    ($_.ExecutablePath -and $_.ExecutablePath.StartsWith("$Root\", [StringComparison]::OrdinalIgnoreCase) -and $_.Name -match '^(Lazunox|opencode|fake)\.exe$') -or
    ($_.CommandLine -and $_.CommandLine -match 'lazunox-e2e-')
  } | ForEach-Object { & taskkill.exe /PID $_.ProcessId /T /F *> $null }
}
if (-not (Test-Path (Join-Path $wt 'e2e\specs\update-install-win.e2e.ts'))) { Log "Falta la spec en $wt (sincroniza con scripts/win/sync.sh)"; exit 3 }

$env:Path = "$Root\node22;$env:Path"
$env:npm_config_cache = Join-Path $Root 'npm-cache'
$env:CI = '1'
# Los directorios temporales de la spec (instalacion de juguete, userData, fixtures) caen bajo C:\onyx\tmp: swap.ps1 en modo de prueba lo exige.
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $tmp | Out-Null
$env:TEMP = $tmp
$env:TMP = $tmp

Stop-Ours
Set-Location $wt
$log = Join-Path $logs 'update-e2e-vitest.log'
$t0 = Get-Date
$p = Start-Process -FilePath cmd.exe -ArgumentList "/d /c npm run test:e2e -- update-install-win > `"$log`" 2>&1" -WorkingDirectory $wt -PassThru -WindowStyle Hidden
$done = $p.WaitForExit($LimitSec * 1000)
if (-not $done) { & taskkill.exe /PID $p.Id /T /F *> $null; Log "FALLA: limite de $LimitSec s superado"; $rc = 124 } else { $rc = $p.ExitCode }
$secs = [int]((Get-Date) - $t0).TotalSeconds
Stop-Ours
Start-Sleep -Seconds 1
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
if ($rc -eq 0) { Log "OK    update-install-win (${secs}s) log=$log" } else { Log "FALLA update-install-win codigo=$rc (${secs}s) log=$log" }
Log "FALLOS=$(if ($rc -eq 0) { 0 } else { 1 })"
exit $(if ($rc -eq 0) { 0 } else { 1 })
