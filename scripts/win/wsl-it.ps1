# Integracion REAL de «Tareas en Windows»: ejecuta setup()/remove() con wsl.exe sobre la distro dedicada Lazunox-Tareas
# (src/main/tasks/backends/wsl-setup.win.test.ts, con LAZUNOX_WSL_IT=1): instala la imagen Debian, carga el paquete LZPK1 en /opt/lazunox,
# la actualiza y la quita. Y luego una SESION real (wsl-session.win.test.ts): instala, arranca el sandbox con wsl.exe y el puente,
# espera /global/health (version fijada), comprueba uid 1000/sin capacidades, montaje noexec,nosuid,nodev, un archivo creado desde dentro
# visible en Windows (carpeta de prueba bajo C:\onyx\tmp), parada sin huerfanos y remove. En ambos se comprueba que las demas distros no cambian.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File C:\onyx\wt\scripts\win\wsl-it.ps1 [-Branch rama] [-Root C:\onyx]
# Prepara <Root>\wsl\cache (copia la imagen de rootfs-out y baja opencode-linux-x64.tar.gz del release FIJADO v1.18.33; sin red si ya esta),
# se niega a correr si ya existe una distro Lazunox-Tareas, NO usa `wsl --shutdown` y NO toca docker-desktop. Tope de 40 min (dos instalaciones).
param([string]$Branch = 'default', [string]$Root = 'C:\onyx')
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$Branch = $Branch -replace '[\\/:*?"<>|]', '-'
$wt = Join-Path $Root 'wt'
$cache = Join-Path $Root 'wsl\cache'
$logs = Join-Path $Root "logs\$Branch"
$log = Join-Path $logs 'wsl-it.txt'
New-Item -ItemType Directory -Force $logs, $cache | Out-Null
function Log([string]$m) { Add-Content -Path $log -Value $m -Encoding utf8; Write-Output $m }
function Clean([object]$o) { return (($o | Out-String) -replace "`0", '').Trim() }
function Distros { return @((Clean (& wsl.exe -l -q 2>&1)) -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
Set-Content -Path $log -Value ("WSL-IT " + (Get-Date -Format s)) -Encoding utf8

$before = Distros
Log ("distros antes: " + ($before -join ', '))
if ($before -contains 'Lazunox-Tareas') { Log 'Ya existe Lazunox-Tareas: no se toca (la prueba se niega a correr).'; exit 4 }

$rootfs = Get-ChildItem (Join-Path $Root 'rootfs-out') -Filter 'lazunox-rootfs-*-x64.tar.gz' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $rootfs) { Log 'No hay imagen en rootfs-out: construye antes con rootfs-build.ps1.'; exit 3 }
Copy-Item -Force $rootfs.FullName (Join-Path $cache $rootfs.Name)
$oc = Join-Path $cache 'opencode-linux-x64.tar.gz'
if (-not (Test-Path $oc)) {
  Log 'Bajando opencode-linux-x64.tar.gz v1.18.33 (release fijado)...'
  Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/anomalyco/opencode/releases/download/v1.18.33/opencode-linux-x64.tar.gz' -OutFile $oc
}
Log ("cache: " + $rootfs.Name + " + opencode " + [math]::Round((Get-Item $oc).Length / 1MB, 1) + " MB sha256=" + (Get-FileHash -Algorithm SHA256 $oc).Hash.ToLower())

$node = Join-Path $Root 'node22\node.exe'
if (-not (Test-Path $node)) { $node = 'node' }
$env:LAZUNOX_WSL_IT = '1'
$env:npm_config_update_notifier = 'false'
$t0 = Get-Date
$p = Start-Process -FilePath $node -ArgumentList @('node_modules\vitest\vitest.mjs', 'run', 'src/main/tasks/backends/wsl-setup.win.test.ts', 'src/main/tasks/backends/wsl-session.win.test.ts', '--maxWorkers=1', '--no-file-parallelism', '--reporter=verbose') `
  -WorkingDirectory $wt -NoNewWindow -PassThru -RedirectStandardOutput "$log.out" -RedirectStandardError "$log.err"
if (-not $p.WaitForExit(2400000)) {
  Log 'Tope de 40 min superado: se mata el arbol de procesos.'
  & taskkill.exe /PID $p.Id /T /F 2>&1 | Out-Null
  $code = 2
} else { $code = $p.ExitCode }
Get-Content "$log.out", "$log.err" -ErrorAction SilentlyContinue | Select-Object -Last 90 | ForEach-Object { Log ([string]$_) }
Log ("vitest exit=$code en " + [int]((Get-Date) - $t0).TotalSeconds + " s")

# Limpieza: si la prueba dejo la distro dedicada (no existia antes), se quita; nada mas.
$after = Distros
if (($after -contains 'Lazunox-Tareas') -and ($before -notcontains 'Lazunox-Tareas')) {
  Log 'Quedo Lazunox-Tareas: se elimina (era de esta prueba).'
  & wsl.exe --terminate Lazunox-Tareas 2>&1 | Out-Null
  Log (Clean (& wsl.exe --unregister Lazunox-Tareas 2>&1))
  $after = Distros
}
$tmpRuns = Get-ChildItem (Join-Path $Root 'tmp') -Directory -Filter 'lzx-ses-*' -ErrorAction SilentlyContinue
foreach ($d in $tmpRuns) { Log ("Quedo " + $d.FullName + ": se elimina (era de esta prueba)."); Remove-Item -Recurse -Force -LiteralPath $d.FullName -ErrorAction SilentlyContinue }
Log ("distros despues: " + ($after -join ', '))
Log ("demas distros intactas: " + ((($before | Sort-Object) -join ',') -eq (($after | Sort-Object) -join ',')))
exit $code
