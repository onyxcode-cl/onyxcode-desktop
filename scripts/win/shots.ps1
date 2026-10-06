# Capturas de escritorio en Windows (scripts/shot-desktop.mjs) con tope de 330 s. NO tocar la app instalada.
# Vive en el PC de pruebas junto a run.ps1; trabaja sobre el arbol ya sincronizado y compilado (out\ existe).
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File C:\onyx\shots.ps1 -Branch rama [-Scenario chat-vacio,paleta] [-Theme dark] [-Size 1280x800] [-ForcedColors] [-Dsf 1.5]
# Salida: C:\onyx\shots\<rama>\*.png (sufijo -win) y shots.log. Para una sesion SSH sin escritorio usar capture-console.ps1 aparte.
param(
  [string]$Branch = 'default',
  [string]$Scenario = '',
  [string]$Theme = '',
  [string]$Size = '',
  [switch]$ForcedColors,
  [string]$Dsf = '',
  [string]$Root = 'C:\onyx',
  [string]$Repo = ''
)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$Branch = $Branch -replace '[\\/:*?"<>|]', '-'
if (-not $Repo) { $Repo = Join-Path $Root 'wt' }
$outDir = Join-Path $Root "shots\$Branch"
$log = Join-Path $outDir 'shots.log'
$limitSeconds = 330
New-Item -ItemType Directory -Force $outDir | Out-Null

if (-not (Test-Path (Join-Path $Repo 'out\main\index.js'))) {
  Write-Output "Falta out\ en $Repo: compila antes (run.ps1 -Steps build)."
  exit 3
}

$nodeArgs = @('scripts\shot-desktop.mjs', '--out', $outDir)
if ($Scenario) { $nodeArgs += @('--scenario', $Scenario) }
if ($Theme) { $nodeArgs += @('--theme', $Theme) }
if ($Size) { $nodeArgs += @('--size', $Size) }
if ($ForcedColors) { $nodeArgs += '--forced-colors' }
if ($Dsf) { $nodeArgs += @('--dsf', $Dsf) }

# El propio script ya tiene un tope de 330 s y limpia sus hijos; este es el cinturon por si node se cuelga.
$p = Start-Process -FilePath 'node' -ArgumentList $nodeArgs -WorkingDirectory $Repo -NoNewWindow -PassThru `
  -RedirectStandardOutput $log -RedirectStandardError "$log.err"
if (-not $p.WaitForExit(($limitSeconds + 15) * 1000)) {
  Write-Output "Tope de $limitSeconds s superado: se mata el arbol de procesos."
  & taskkill.exe /PID $p.Id /T /F | Out-Null
  $code = 2
} else {
  $code = $p.ExitCode
}
Get-Content $log, "$log.err" -ErrorAction SilentlyContinue | Select-Object -Last 40
Write-Output ("PNG: " + (Get-ChildItem $outDir -Filter *.png -ErrorAction SilentlyContinue | Measure-Object).Count + " en $outDir (exit $code)")
exit $code
