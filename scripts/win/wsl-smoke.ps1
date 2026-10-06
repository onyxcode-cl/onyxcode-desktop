# Prueba de humo REAL de la imagen Debian de «Tareas en Windows» en WSL2: la importa como una distro de PRUEBA (Lazunox-Smoke), la
# inspecciona por dentro y la borra. Solo toca <Root>\wsl\smoke y esa distro. NO toca docker-desktop ni ninguna otra distro,
# NO usa `wsl --shutdown` (solo `wsl --terminate Lazunox-Smoke` y `wsl --unregister Lazunox-Smoke`).
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File C:\onyx\wt\scripts\win\wsl-smoke.ps1 [-Branch rama] [-Root C:\onyx]
# Mide: kernel y version de WSL, Debian 13, usuario root, Python y ABI de Landlock (syscall 444), paquetes (rg, git, openpyxl, docx,
# pypdf, lxml), que no haya sudo/curl, que /opt/lazunox exista vacio, SUID, y la politica de montajes (/mnt/c, /etc/wsl.conf).
param([string]$Branch = 'default', [string]$Root = 'C:\onyx')
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$Branch = $Branch -replace '[\\/:*?"<>|]', '-'
$name = 'Lazunox-Smoke'
$logs = Join-Path $Root "logs\$Branch"
New-Item -ItemType Directory -Force $logs | Out-Null
$out = Join-Path $logs 'wsl-smoke.txt'
Set-Content -Path $out -Value ("WSL-SMOKE " + (Get-Date -Format s)) -Encoding utf8
function Log([string]$m) { Add-Content -Path $out -Value $m -Encoding utf8; Write-Output $m }
$script:fail = 0
function Check([string]$n, [bool]$ok, [string]$d = '') {
  if ($ok) { Log "OK    $n $d" } else { Log "FALLA $n $d"; $script:fail++ }
}
function Clean([object]$o) { return (($o | Out-String) -replace "`0", '').Trim() }
function Distros { return @((Clean (& wsl.exe -l -q 2>&1)) -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }

$tar = Get-ChildItem (Join-Path $Root 'rootfs-out') -Filter 'lazunox-rootfs-*-x64.tar.gz' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $tar) { Log 'No hay imagen en rootfs-out: construye antes con rootfs-build.ps1.'; exit 3 }
$before = Distros
Log ("distros antes: " + ($before -join ', '))
if ($before -contains $name) { Log "Ya existe ${name}: no se toca (borrala a mano si es una prueba vieja)."; exit 4 }
$dir = Join-Path $Root 'wsl\smoke'
if (-not $dir.StartsWith("$Root\wsl\", [StringComparison]::OrdinalIgnoreCase)) { exit 2 }
New-Item -ItemType Directory -Force $dir | Out-Null

$imported = $false
try {
  $t = Get-Date
  $r = Clean (& wsl.exe --import $name $dir $tar.FullName --version 2 2>&1)
  $imported = ((Distros) -contains $name)
  Check 'wsl --import' $imported ("en " + [int]((Get-Date) - $t).TotalSeconds + " s $r")
  if ($imported) {
    $probe = @(
      'echo KERNEL=$(uname -r)',
      'echo OS=$(. /etc/os-release; echo $PRETTY_NAME)',
      'echo WHOAMI=$(id -un)',
      'echo PY=$(python3 --version 2>&1)',
      'echo LANDLOCK_ABI=$(python3 -c ''import ctypes;l=ctypes.CDLL(None,use_errno=True);print(l.syscall(444,None,0,1))'' 2>&1)',
      'echo LSM=$(cat /sys/kernel/security/lsm 2>/dev/null)',
      'echo RG=$(rg --version 2>&1 | head -1)',
      'echo GIT=$(git --version 2>&1)',
      'echo PYMODS=$(python3 -c ''import openpyxl,docx,pypdf,lxml;print("ok")'' 2>&1)',
      'echo SUDO=$(command -v sudo || echo no)',
      'echo CURL=$(command -v curl || echo no)',
      'echo OPT_LAZUNOX=$([ -d /opt/lazunox ] && [ -z "$(ls -A /opt/lazunox)" ] && echo vacio || echo otro)',
      'echo SUID=$(find / -xdev -perm /6000 -type f 2>/dev/null | wc -l)',
      'echo WSLCONF=$(tr "\n" "|" < /etc/wsl.conf 2>/dev/null)',
      'echo MNTC=$([ -d /mnt/c/Windows ] && echo montado || echo no-montado)',
      'echo PROC_NS=$(ls /proc/self/ns 2>/dev/null | tr "\n" " ")',
      'echo DISK=$(df -h / | tail -1)',
      '# fin'
    ) -join '; '
    $raw = Clean ($probe | & wsl.exe -d $name -u root --exec /bin/sh -s 2>&1)
    $kv = @{}
    foreach ($l in ($raw -split "`r?`n")) { Log "  $l"; if ($l -match '^([A-Z_]+)=(.*)$') { $kv[$Matches[1]] = $Matches[2] } }
    Check 'Debian 13' ($kv['OS'] -match 'Debian GNU/Linux 13') $kv['OS']
    Check 'usuario root' ($kv['WHOAMI'] -eq 'root')
    Check 'Python 3' ($kv['PY'] -match '^Python 3\.\d+')
    Check 'Landlock disponible (ABI >= 1)' ($kv['LANDLOCK_ABI'] -match '^[1-9]\d*$') ("ABI=" + $kv['LANDLOCK_ABI'] + " lsm=" + $kv['LSM'])
    Check 'ripgrep' ($kv['RG'] -match 'ripgrep')
    Check 'git' ($kv['GIT'] -match 'git version')
    Check 'modulos de oficina (openpyxl, docx, pypdf, lxml)' ($kv['PYMODS'] -eq 'ok') $kv['PYMODS']
    Check 'sin sudo' ($kv['SUDO'] -eq 'no')
    Check 'sin curl' ($kv['CURL'] -eq 'no')
    Check '/opt/lazunox existe y esta vacio (punto de carga del paquete)' ($kv['OPT_LAZUNOX'] -eq 'vacio')
    Check 'sin binarios SUID/SGID' ($kv['SUID'] -eq '0') ("cuenta=" + $kv['SUID'])
    Log ("INFO wsl.conf: " + $kv['WSLCONF'] + " | /mnt/c: " + $kv['MNTC'])
  }
} finally {
  if ($imported -or ((Distros) -contains $name)) {
    & wsl.exe --terminate $name 2>&1 | Out-Null
    $u = Clean (& wsl.exe --unregister $name 2>&1)
    Log "unregister: $u"
  }
  Start-Sleep -Seconds 1
  Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
}
$after = Distros
Log ("distros despues: " + ($after -join ', '))
Check 'las demas distros intactas' ((($before | Sort-Object) -join ',') -eq (($after | Sort-Object) -join ','))
Check 'limpieza: sin restos' (-not (Test-Path $dir))
Log "FALLOS=$($script:fail)"
exit $script:fail
