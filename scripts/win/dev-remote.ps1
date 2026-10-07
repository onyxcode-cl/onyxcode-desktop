# Abre Lazunox en el PC de pruebas SIN empaquetar y con el control remoto desde el celular HABILITADO en Windows (LAZUNOX_REMOTE_WIN=1; una app
# empaquetada ignora la variable). Usa datos propios (<Root>\tmp\ud-remoto): no toca la app instalada ni sus datos.
# Con la ventana abierta: Ajustes -> control remoto -> activar. Para que el celular llegue, Windows pedira permitir Electron en la red PRIVADA: «Permitir».
# Uso (sesion grafica): powershell -NoProfile -ExecutionPolicy Bypass -File C:\onyx\wt\scripts\win\dev-remote.ps1 [-Root C:\onyx]
param([string]$Root = 'C:\onyx')
$wt = Join-Path $Root 'wt'
$electron = Join-Path $wt 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electron)) { Write-Output "Falta $electron"; exit 3 }
if (-not (Test-Path (Join-Path $wt 'out\main\index.js'))) { Write-Output 'Falta out\main\index.js: compila antes (run.ps1 -Steps build).'; exit 3 }
$env:LAZUNOX_REMOTE_WIN = '1'
Start-Process -FilePath $electron -ArgumentList @('.', ('--user-data-dir=' + (Join-Path $Root 'tmp\ud-remoto'))) -WorkingDirectory $wt
Write-Output 'Lazunox abierto con el control remoto de Windows habilitado (desarrollo).'
