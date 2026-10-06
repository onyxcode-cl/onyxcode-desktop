# Captura la ventana REAL de Lazunox (marco de Windows, barra de titulo) en la sesion interactiva del PC de pruebas.
# Se ejecuta con una tarea programada /IT (ver scripts/win/window-shot.sh): una sesion SSH no tiene escritorio.
# Abre win-unpacked con un userData temporal bajo C:\onyx\tmp, espera, captura toda la pantalla y cierra SOLO lo suyo.
param(
  [string]$Root = 'C:\onyx',
  [int]$WaitSeconds = 20,
  [string]$Out = 'C:\onyx\shots\ventana.png'
)
$ErrorActionPreference = 'Continue'
$exe = Join-Path $Root 'wt\dist\win-unpacked\Lazunox.exe'
$ud = Join-Path $Root 'tmp\ud-window'
$log = Join-Path $Root 'shots\ventana.log'
New-Item -ItemType Directory -Force (Split-Path -Parent $Out), $ud | Out-Null
if (-not (Test-Path $exe)) { Set-Content $log "Falta $exe"; exit 3 }
Set-Content -Path (Join-Path $ud 'settings.json') -Value '{"onboarded":true,"theme":"system","language":"es"}' -Encoding ascii
$p = Start-Process -FilePath $exe -ArgumentList "--user-data-dir=$ud" -PassThru
Start-Sleep -Seconds $WaitSeconds
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'wt\scripts\win\capture-console.ps1') -Out $Out *>> $log
# Cierre: solo procesos cuya ruta cuelga de C:\onyx y cuyo userData es el nuestro.
Get-CimInstance Win32_Process | Where-Object {
  $_.ExecutablePath -and $_.ExecutablePath.StartsWith("$Root\", [StringComparison]::OrdinalIgnoreCase) -and
  $_.Name -match '^(Lazunox|opencode|OpenConsole|conpty)\.exe$' -and $_.CommandLine -match [regex]::Escape($ud)
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
if ($p -and -not $p.HasExited) { & taskkill.exe /PID $p.Id /T /F | Out-Null }
Add-Content $log "listo $(Get-Date -Format s)"
