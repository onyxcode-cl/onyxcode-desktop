# Construye la imagen Debian 13 de «Tareas en Windows» en el PC de pruebas (Docker Desktop, linux/amd64 NATIVO: sin emulacion).
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File C:\onyx\wt\scripts\win\rootfs-build.ps1 [-Branch rama] [-Check] [-Root C:\onyx]
# Una sola construccion a la vez, con tope de 45 min, 6 CPU para el contenedor y solo lo suyo: el contenedor se llama
# lazunox-rootfs-build y es lo unico que se borra. NO toca la distro docker-desktop ni usa wsl --shutdown.
# Salida: <Root>\rootfs-out\ (lazunox-rootfs-<ver>-x64.tar.gz, rootfs-packages-<ver>.txt, rootfs-build.json) y el log en <Root>\logs\<rama>\.
param([string]$Branch = 'default', [switch]$Check, [string]$Root = 'C:\onyx')
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$Branch = $Branch -replace '[\\/:*?"<>|]', '-'
$wt = Join-Path $Root 'wt'
$outDir = Join-Path $Root 'rootfs-out'
$logs = Join-Path $Root "logs\$Branch"
$log = Join-Path $logs 'rootfs-build.log'
$name = 'lazunox-rootfs-build'
$limitSeconds = 2700
New-Item -ItemType Directory -Force $logs, $outDir | Out-Null
$docker = (Get-Command docker -ErrorAction SilentlyContinue).Source
if (-not $docker) { Write-Output 'Falta docker.'; exit 3 }
if (-not (Test-Path (Join-Path $wt 'scripts\build-wsl-rootfs.sh'))) { Write-Output "Falta el script en $wt"; exit 3 }
function Log([string]$m) { Add-Content -Path $log -Value $m -Encoding utf8; Write-Output $m }
Set-Content -Path $log -Value ("ROOTFS-BUILD " + (Get-Date -Format s)) -Encoding utf8

# Desde una sesion SSH el almacen de credenciales de Docker Desktop no existe ("Una sesion de inicio especificada no existe").
# La imagen base es publica: se usa una configuracion de Docker vacia (sin credsStore) y se apunta al motor de Docker Desktop.
$dockerCfg = Join-Path $Root 'tmp\docker-config'
New-Item -ItemType Directory -Force $dockerCfg | Out-Null
Set-Content -Path (Join-Path $dockerCfg 'config.json') -Value '{}' -Encoding ascii
$env:DOCKER_CONFIG = $dockerCfg
$env:DOCKER_HOST = 'npipe:////./pipe/dockerDesktopLinuxEngine'

# Un contenedor anterior con NUESTRO nombre (de una corrida cortada) se borra; ningun otro.
& $docker rm -f $name 2>&1 | Out-Null

# Digest de debian:trixie (como el workflow: se fija la imagen base por digest).
& $docker pull debian:trixie 2>&1 | Select-Object -Last 3 | ForEach-Object { Log ([string]$_) }
$repoDigest = (& $docker image inspect debian:trixie --format '{{index .RepoDigests 0}}' 2>&1 | Select-Object -First 1)
if ("$repoDigest" -notmatch '@sha256:([0-9a-f]{64})$') { Log "No pude leer el digest: $repoDigest"; exit 4 }
$digest = $Matches[1]
Log "digest debian:trixie = sha256:$digest"

$inner = '/w/scripts/build-wsl-rootfs.sh --inside --out /o'
if ($Check) { $inner = '/w/scripts/build-wsl-rootfs.sh --inside --check --out /o' }
$dargs = @('run', '--rm', '--privileged', '--platform', 'linux/amd64', '--name', $name, '--cpus', '6',
  '-v', "${wt}:/w:ro", '-v', "${outDir}:/o", "debian:trixie@sha256:$digest", '/bin/bash') + ($inner -split ' ')
$t0 = Get-Date
$p = Start-Process -FilePath $docker -ArgumentList $dargs -NoNewWindow -PassThru -RedirectStandardOutput "$log.out" -RedirectStandardError "$log.err"
if (-not $p.WaitForExit($limitSeconds * 1000)) {
  Log "Tope de $limitSeconds s superado: se detiene el contenedor $name."
  & $docker rm -f $name 2>&1 | Out-Null
  & taskkill.exe /PID $p.Id /T /F 2>&1 | Out-Null
  $code = 2
} else {
  $code = $p.ExitCode
}
$secs = [int]((Get-Date) - $t0).TotalSeconds
Get-Content "$log.out", "$log.err" -ErrorAction SilentlyContinue | Select-Object -Last 25 | ForEach-Object { Log $_ }
Log "docker exit=$code en $secs s"

$tar = Get-ChildItem $outDir -Filter 'lazunox-rootfs-*-x64.tar.gz' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
if ($tar) {
  $sha = (Get-FileHash -Algorithm SHA256 $tar.FullName).Hash.ToLower()
  Log ("imagen: " + $tar.Name + " " + [math]::Round($tar.Length / 1MB, 1) + " MB sha256=$sha")
  $ver = ($tar.Name -replace '^lazunox-rootfs-', '' -replace '-x64\.tar\.gz$', '')
  $node = Join-Path $Root 'node22\node.exe'
  if (-not (Test-Path $node)) { $node = 'node' }
  Push-Location $wt
  & $node 'scripts\wsl-rootfs\inspect.mjs' $tar.FullName --version $ver 2>&1 | ForEach-Object { Log $_ }
  Log "inspect exit=$LASTEXITCODE"
  Pop-Location
} else {
  Log 'No hay imagen en rootfs-out.'
  if ($code -eq 0) { $code = 5 }
}
exit $code
