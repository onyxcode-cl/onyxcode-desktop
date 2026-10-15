param([Parameter(Mandatory=$true)][string]$SwapScript)
# Puerta de Windows: el script de reemplazo debe poder renombrar la carpeta de la app aunque el proceso que lo lanza tenga como
# carpeta de trabajo la de instalación (así abre Windows la app desde el acceso directo). Espera result.json con «boot-timeout»
# (el programa de prueba no confirma arranque); «backup-failed» = el reemplazo no pudo apartar la carpeta (la 0.5.18–0.5.25 fallaban así).
$root = 'C:\onyx\swtest'
if (Test-Path $root) { Remove-Item -Recurse -Force $root }
New-Item -ItemType Directory -Path "$root\Lazunox","$root\.Lazunox.staging-9.9.9","$root\md" | Out-Null
Copy-Item "$env:SystemRoot\System32\timeout.exe" "$root\Lazunox\Lazunox.exe"
Copy-Item "$env:SystemRoot\System32\timeout.exe" "$root\.Lazunox.staging-9.9.9\Lazunox.exe"
$env:LAZUNOX_SWAP_TEST_NO_OPEN = '1'; $env:LAZUNOX_SWAP_WAIT_PID = '3'; $env:LAZUNOX_SWAP_WAIT_BOOT = '4'
# El proceso que lanza el script tiene como carpeta de trabajo la de la app (el caso del acceso directo).
$ps = Start-Process powershell.exe -WorkingDirectory "$root\Lazunox" -PassThru -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$SwapScript,'-AppPid','999999','-Target',"$root\Lazunox",'-Staged',"$root\.Lazunox.staging-9.9.9",'-Bak',"$root\.Lazunox.bak-1.0.0",'-MarkerDir',"$root\md",'-Version','9.9.9')
$ps.WaitForExit(60000) | Out-Null
"exit=" + $ps.ExitCode
Get-Content "$root\md\result.json" -ErrorAction SilentlyContinue
Get-Content "$root\md\swap-error.txt" -ErrorAction SilentlyContinue
Get-Process timeout -ErrorAction SilentlyContinue | Stop-Process -Force

$r = Get-Content "$root\md\result.json" -Raw -ErrorAction SilentlyContinue
if ($r -match 'boot-timeout') { 'OK: el reemplazo pudo apartar la carpeta con ella como carpeta de trabajo'; exit 0 } else { 'FALLA: ' + $r; exit 1 }
