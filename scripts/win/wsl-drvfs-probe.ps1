# Diagnostico: ¿puede WSL montar una carpeta de Windows (drvfs) hoy? Importa la imagen como distro de prueba (Lazunox-Smoke, como wsl-smoke.ps1),
# prueba `mount -t drvfs` FUERA y DENTRO de un espacio de PID/montaje nuevo (como hace el lanzador) y la borra. Solo toca <Root>\wsl\smoke y esa distro;
# NO usa `wsl --shutdown` ni toca docker-desktop.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File C:\onyx\wt\scripts\win\wsl-drvfs-probe.ps1 [-Root C:\onyx]
param([string]$Root = 'C:\onyx')
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$name = 'Lazunox-Smoke'
function Clean([object]$o) { return (($o | Out-String) -replace "`0", '').Trim() }
function Distros { return @((Clean (& wsl.exe -l -q 2>&1)) -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
$tar = Get-ChildItem (Join-Path $Root 'rootfs-out') -Filter 'lazunox-rootfs-*-x64.tar.gz' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $tar) { Write-Output 'No hay imagen en rootfs-out.'; exit 3 }
if ((Distros) -contains $name) { Write-Output "Ya existe ${name}: no se toca."; exit 4 }
$dir = Join-Path $Root 'wsl\smoke'
New-Item -ItemType Directory -Force $dir | Out-Null
$probeDir = Join-Path $Root 'tmp\drvfs-probe'
New-Item -ItemType Directory -Force $probeDir | Out-Null
Set-Content -Path (Join-Path $probeDir 'hola.txt') -Value 'hola' -Encoding ascii
$imported = $false
try {
  Write-Output ("import: " + (Clean (& wsl.exe --import $name $dir $tar.FullName --version 2 2>&1)))
  $imported = ((Distros) -contains $name)
  if ($imported) {
    $win = 'C:\onyx\tmp\drvfs-probe'
    $probe = @(
      'echo VER=$(uname -r)',
      ("W='" + $win + "'; export W"),
      'mkdir -p /mnt/p1; mount -t drvfs "$W" /mnt/p1 2>&1; echo RC_FUERA=$?; ls /mnt/p1 2>&1 | head -3',
      'umount /mnt/p1 2>/dev/null',
      'unshare -m -p -f --mount-proc /bin/sh -c ''mkdir -p /mnt/p2; mount -t drvfs "$W" /mnt/p2 2>&1; echo RC_DENTRO=$?; ls /mnt/p2 2>&1 | head -3'' 2>&1',
      'unshare -m -p -f --mount-proc /bin/sh -c ''mount -t tmpfs tmpfs /run/WSL 2>&1; mkdir -p /mnt/p3; mount -t drvfs "$W" /mnt/p3 2>&1; echo RC_DENTRO_SIN_RUNWSL=$?'' 2>&1',
      'echo RUN_WSL=$(ls /run/WSL 2>&1 | tr "\n" " ")',
      '# fin'
    ) -join '; '
    foreach ($l in ((Clean ($probe | & wsl.exe -d $name -u root --exec /bin/sh -s 2>&1)) -split "`r?`n")) { Write-Output "  $l" }
  }
} finally {
  if ($imported -or ((Distros) -contains $name)) {
    & wsl.exe --terminate $name 2>&1 | Out-Null
    Write-Output ("unregister: " + (Clean (& wsl.exe --unregister $name 2>&1)))
  }
  Start-Sleep -Seconds 1
  Remove-Item -Recurse -Force $dir, $probeDir -ErrorAction SilentlyContinue
}
Write-Output ("distros despues: " + ((Distros) -join ', '))
