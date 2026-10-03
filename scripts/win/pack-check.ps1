# Verificacion SIN firma del paquete de Windows (tanda 4). Solo trabaja bajo C:\onyx\ y deja todo limpio.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File C:\onyx\wt\scripts\win\pack-check.ps1 [-Branch rama] [-Install]
# Comprueba: artefacto y tamano, asar sin codigo de macOS, node-pty desempaquetado, fuses, opencode.exe --version, metadatos PE,
# humo de la app EMPAQUETADA (proceso vivo, opencode.exe hijo < 30 s, terminal PowerShell por CDP, sin huerfanos al cerrar) y,
# con -Install, instalacion silenciosa en C:\onyx\inst, arranque, desinstalacion silenciosa y limpieza.
param([string]$Branch = 'default', [string]$Root = 'C:\onyx', [switch]$Install)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$wt = Join-Path $Root 'wt'
$dist = Join-Path $wt 'dist'
$unp = Join-Path $dist 'win-unpacked'
$exe = Join-Path $unp 'OnyxCode.exe'
$logs = Join-Path $Root "logs\$Branch"
New-Item -ItemType Directory -Force $logs | Out-Null
$out = Join-Path $logs 'pack-check.txt'
Set-Content -Path $out -Value ("PACK-CHECK " + (Get-Date -Format s)) -Encoding ascii
function Log([string]$m) { Add-Content -Path $out -Value $m -Encoding ascii; Write-Output $m }
$script:fail = 0
function Check([string]$name, [bool]$ok, [string]$detail = '') {
  if ($ok) { Log "OK    $name $detail" } else { Log "FALLA $name $detail"; $script:fail++ }
}
$env:Path = "$Root\node22;$env:Path"
$ud = Join-Path $Root 'tmp\ud'
$inst = Join-Path $Root 'inst'
function OnyxProcs {
  Get-CimInstance Win32_Process | Where-Object {
    ($_.ExecutablePath -and ($_.ExecutablePath.StartsWith("$Root\", [StringComparison]::OrdinalIgnoreCase)) -and $_.Name -match '^(OnyxCode|opencode|OpenConsole|conpty)\.exe$') -or
    ($_.CommandLine -and $_.CommandLine -match [regex]::Escape($ud))
  }
}
function Cleanup { foreach ($p in (OnyxProcs)) { & taskkill.exe /PID $p.ProcessId /T /F *> $null } }
function Wait-Gone([int]$sec) { $t0 = Get-Date; while (((Get-Date) - $t0).TotalSeconds -lt $sec) { if (-not (OnyxProcs)) { return $true }; Start-Sleep -Milliseconds 500 }; return -not (OnyxProcs) }

Cleanup
Set-Location $wt

# 1. Artefacto
$setup = Get-ChildItem $dist -Filter 'OnyxCode-Setup-*-x64.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
Check 'instalador existe' ([bool]$setup) ($(if ($setup) { "$($setup.Name) $([math]::Round($setup.Length/1MB,1)) MB" } else { '' }))
if ($setup) { Check 'tamano razonable (50-400 MB)' ($setup.Length -gt 50MB -and $setup.Length -lt 400MB) }
Check 'win-unpacked existe' (Test-Path $exe)

# 2. asar
$asar = Join-Path $unp 'resources\app.asar'
$list = & npx --no-install @electron/asar list $asar 2>&1 | Out-String
$bad = @('helper.swift', 'launcher', 'updater', 'cu-helper', 'swap.sh') | Where-Object { $list -match [regex]::Escape($_) }
Check 'asar sin helper.swift/launcher/updater' (-not $bad) ("hallazgos: " + ($bad -join ','))
Check 'asar tiene out/main/index.js' ($list -match 'out[\\/]main[\\/]index\.js')
$pty = Join-Path $unp 'resources\app.asar.unpacked\node_modules\node-pty'
$ptyFiles = @()
if (Test-Path $pty) { $ptyFiles = Get-ChildItem $pty -Recurse -File | Where-Object { $_.Name -match '^(conpty\.node|conpty\.dll|OpenConsole\.exe|pty\.node)$' } | ForEach-Object { $_.FullName.Substring($pty.Length) } }
Check 'node-pty desempaquetado (conpty.node, conpty.dll, OpenConsole.exe)' (($ptyFiles | Where-Object { $_ -match 'conpty\.node' }) -and ($ptyFiles | Where-Object { $_ -match 'conpty\.dll' }) -and ($ptyFiles | Where-Object { $_ -match 'OpenConsole\.exe' })) ($ptyFiles -join ' ')

# 3. fuses
$fuses = & npx --no-install @electron/fuses read --app $exe 2>&1 | Out-String
Log ($fuses.Trim())
Check 'fuses: RunAsNode off' ($fuses -match 'RunAsNode\s+is\s+Disabled|RunAsNode\s+is\s+Off|RunAsNode[^\r\n]*Disabled')
Check 'fuses: EmbeddedAsarIntegrityValidation on' ($fuses -match 'EmbeddedAsarIntegrityValidation[^\r\n]*Enabled')
Check 'fuses: OnlyLoadAppFromAsar on' ($fuses -match 'OnlyLoadAppFromAsar[^\r\n]*Enabled')
Check 'fuses: NodeOptions/inspect off' (($fuses -match 'EnableNodeOptionsEnvironmentVariable[^\r\n]*Disabled') -and ($fuses -match 'EnableNodeCliInspectArguments[^\r\n]*Disabled'))

# 4. opencode embebido y metadatos PE
$oc = Join-Path $unp 'resources\opencode\opencode.exe'
$ver = if (Test-Path $oc) { (& $oc --version 2>&1 | Out-String).Trim() } else { '(falta)' }
Check 'opencode.exe --version = 1.18.33' ($ver -eq '1.18.33') $ver
$vi = (Get-Item $exe).VersionInfo
Log ("PE: ProductName=$($vi.ProductName) FileDescription=$($vi.FileDescription) FileVersion=$($vi.FileVersion) ProductVersion=$($vi.ProductVersion) Company=$($vi.CompanyName) Copyright=$($vi.LegalCopyright)")
Check 'PE: ProductName OnyxCode' ($vi.ProductName -eq 'OnyxCode')
$sig = Get-AuthenticodeSignature $exe
Log ("Firma Authenticode: " + $sig.Status + " (esperado NotSigned: no hay certificado)")

# 5. Humo de la app empaquetada
function Start-Packaged([string]$path, [int]$port) {
  Remove-Item -Recurse -Force $ud -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $ud | Out-Null
  return Start-Process -FilePath $path -ArgumentList "--user-data-dir=$ud", "--remote-debugging-port=$port" -PassThru -WindowStyle Hidden
}
function Smoke([string]$path, [string]$tag, [int]$port) {
  $t0 = Get-Date
  $p = Start-Packaged $path $port
  $seen = $false
  while (((Get-Date) - $t0).TotalSeconds -lt 30) {
    if ($p.HasExited) { break }
    if (OnyxProcs | Where-Object { $_.Name -eq 'opencode.exe' }) { $seen = $true; break }
    Start-Sleep -Milliseconds 500
  }
  $secs = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
  Check "$tag proceso vivo" (-not $p.HasExited)
  Check "$tag opencode.exe hijo en < 30 s" $seen "(${secs}s)"
  $probe = & node (Join-Path $wt 'scripts\win\pty-probe.mjs') $port $Root close 2>&1 | Out-String
  Log ($probe.Trim())
  Check "$tag terminal PowerShell funcional (conpty, fuse runAsNode off)" ($probe -match '"ok":true')
  # Cierre ordenado (como el usuario) y, si no, por la fuerza; despues no debe quedar nada
  $gone = Wait-Gone 20
  Check "$tag la app sale al cerrar la ventana (decision v1)" $gone
  if (-not $gone) { Log ("quedaban: " + ((OnyxProcs | ForEach-Object { "$($_.Name)#$($_.ProcessId)" }) -join ' ')); Cleanup }
  Check "$tag sin huerfanos al cerrar" $gone
}
Smoke $exe 'win-unpacked' 9333

# 6. Instalacion silenciosa
if ($Install -and $setup) {
  Remove-Item -Recurse -Force $inst -ErrorAction SilentlyContinue
  $p = Start-Process -FilePath $setup.FullName -ArgumentList '/S', "/D=$inst" -PassThru -WindowStyle Hidden
  Check 'instalacion silenciosa termina (< 120 s)' ($p.WaitForExit(120000)) "codigo=$($p.ExitCode)"
  $ie = Join-Path $inst 'OnyxCode.exe'
  Check 'instalado: OnyxCode.exe' (Test-Path $ie)
  Check 'instalado: opencode.exe 1.18.33' ((Test-Path (Join-Path $inst 'resources\opencode\opencode.exe')) -and ((& (Join-Path $inst 'resources\opencode\opencode.exe') --version 2>&1 | Out-String).Trim() -eq '1.18.33'))
  $un = Join-Path $inst 'Uninstall OnyxCode.exe'
  Check 'instalado: desinstalador' (Test-Path $un)
  $reg = Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue | Where-Object { (Get-ItemProperty $_.PSPath).DisplayName -like 'OnyxCode*' }
  Check 'registro de desinstalacion (HKCU, por usuario)' ([bool]$reg) (($reg | ForEach-Object { $_.PSChildName }) -join ',')
  if (Test-Path $ie) { Smoke $ie 'instalado' 9334 }
  if (Test-Path $un) {
    $u = Start-Process -FilePath $un -ArgumentList '/S' -PassThru -WindowStyle Hidden
    Check 'desinstalacion silenciosa termina (< 120 s)' ($u.WaitForExit(120000)) "codigo=$($u.ExitCode)"
    # el desinstalador se copia a %TEMP% y se relanza: esperar a que desaparezca la carpeta
    $t0 = Get-Date; while ((Test-Path $inst) -and (((Get-Date) - $t0).TotalSeconds -lt 60)) { Start-Sleep -Seconds 1 }
  }
  $left = if (Test-Path $inst) { (Get-ChildItem $inst -Recurse -Force | Measure-Object).Count } else { 0 }
  Check 'desinstalado: carpeta de instalacion limpia' ($left -eq 0) "restos=$left"
  $reg2 = Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue | Where-Object { (Get-ItemProperty $_.PSPath).DisplayName -like 'OnyxCode*' }
  Check 'desinstalado: sin clave de registro' (-not $reg2)
  $lnk = @("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\OnyxCode.lnk", "$env:USERPROFILE\Desktop\OnyxCode.lnk") | Where-Object { Test-Path $_ }
  Check 'desinstalado: sin accesos directos' (-not $lnk) ($lnk -join ',')
  Remove-Item -Recurse -Force $inst -ErrorAction SilentlyContinue
}
Cleanup
Remove-Item -Recurse -Force $ud -ErrorAction SilentlyContinue
Check 'sin procesos sobrantes al terminar' (-not (OnyxProcs))
Log "FALLOS=$script:fail"
exit $script:fail
