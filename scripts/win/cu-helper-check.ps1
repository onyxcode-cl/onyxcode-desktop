# Humo de SOLO LECTURA del helper de Control del PC (cu-helper.exe, Rust) en una sesion GRAFICA del PC de pruebas.
# NUNCA hace clics ni escribe teclas reales: no invoca move/click/drag/scroll/type/key ni release-input.
# Solo consulta (version, screens, cursor, permissions, session, frontmost, running-apps, list-apps, resolve-app, windows-of,
# focused-secure, recent-input) y comprueba que lo prohibido falla CERRADO (comando desconocido, accion fuera de la lista, comandos
# diferidos, captura sin consentimiento). Con -WithCapture hace UNA captura de pantalla (lectura) en el directorio temporal.
# Todo con limite de tiempo (15 s por llamada, como el llamador real) y sin red. PowerShell 5.1.
#
# Uso (en una sesion con escritorio, NO por SSH puro; ver scripts/win/run.ps1 y la tarea /IT del plan):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\win\cu-helper-check.ps1 -Helper C:\onyx\cu\cu-helper.exe
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\win\cu-helper-check.ps1 -Helper C:\onyx\cu\cu-helper.exe -WithCapture
# Codigo de salida: 0 si no hay FALLA; 1 si hay alguna. Los AVISO (p. ej. sesion no interactiva) no cuentan como fallo.
param(
  [string]$Helper = '',
  [switch]$WithCapture,
  [string]$LogFile = ''
)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

if (-not $Helper) {
  $here = Split-Path -Parent $MyInvocation.MyCommand.Path
  $cand = @(
    (Join-Path $here '..\..\resources\computer-use\win\bin\cu-helper.exe'),
    'C:\onyx\cu\cu-helper.exe'
  )
  foreach ($c in $cand) { if (-not $Helper -and (Test-Path -LiteralPath $c)) { $Helper = (Resolve-Path -LiteralPath $c).Path } }
}
if (-not $Helper -or -not (Test-Path -LiteralPath $Helper)) {
  Write-Output 'FALLA no se encuentra cu-helper.exe (usa -Helper <ruta>)'
  exit 2
}

$script:fail = 0
$script:warn = 0
# Directorio temporal propio: el helper solo escribe aqui (su cache de editores y, con -WithCapture, la captura).
$script:tmpDir = Join-Path $env:TEMP 'cu-helper-check'
New-Item -ItemType Directory -Force $script:tmpDir | Out-Null
function Log([string]$m) {
  Write-Output $m
  if ($LogFile) { Add-Content -Path $LogFile -Value $m -Encoding ascii }
}
function Check([string]$name, [bool]$ok, [string]$detail = '') {
  if ($ok) { Log "OK     ${name} ${detail}" } else { Log "FALLA  ${name} ${detail}"; $script:fail++ }
}
function Warn([string]$name, [string]$detail = '') {
  Log "AVISO  ${name} ${detail}"
  $script:warn++
}

# Cita un argumento segun las reglas de CommandLineToArgvW.
function Quote-Arg([string]$a) {
  if ($a -eq '') { return '""' }
  if ($a -notmatch '[\s"|<>&^()]') { return $a }
  $s = $a -replace '(\\*)"', '$1$1\"'
  $s = $s -replace '(\\+)$', '$1$1'
  return '"' + $s + '"'
}

# Ejecuta el helper SIN consentimiento ni variables CU_* y devuelve stdout, stderr y el codigo de salida.
function Run-Helper([string[]]$HelperArgs, [hashtable]$ExtraEnv = @{}) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Helper
  $psi.Arguments = ($HelperArgs | ForEach-Object { Quote-Arg $_ }) -join ' '
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
  foreach ($k in @('COMPUTER_WIN_CONSENT', 'COMPUTER_STOP_FILE', 'COMPUTER_INPUT_FILE', 'CU_TEMP_DIR', 'CU_INSTANT', 'CU_CHAR_DELAY_MS', 'CU_STOP_SHORTCUT')) {
    if ($psi.EnvironmentVariables.ContainsKey($k)) { $psi.EnvironmentVariables.Remove($k) }
  }
  $psi.EnvironmentVariables['CU_TEMP_DIR'] = $script:tmpDir
  foreach ($k in $ExtraEnv.Keys) { $psi.EnvironmentVariables[$k] = [string]$ExtraEnv[$k] }
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  [void]$p.Start()
  # stdin queda ABIERTO mientras el helper trabaja (como el llamador real): un EOF le haria salir con 3 (contrato).
  $so = $p.StandardOutput.ReadToEndAsync()
  $se = $p.StandardError.ReadToEndAsync()
  $timedOut = $false
  if (-not $p.WaitForExit(15000)) {
    $timedOut = $true
    try { $p.Kill() } catch { }
    [void]$p.WaitForExit(2000)
  }
  $code = -1
  if (-not $timedOut) { $code = $p.ExitCode }
  try { $p.StandardInput.Close() } catch { }
  return [pscustomobject]@{ Out = $so.Result.TrimEnd("`r", "`n"); Err = $se.Result.TrimEnd("`r", "`n"); Code = $code; TimedOut = $timedOut }
}

function Parse-Json([string]$text) {
  $t = $text.Trim()
  if ($t -eq '') { return $null }
  if ($t -eq '[]') { return @() }
  try { return ($t | ConvertFrom-Json) } catch { return $null }
}

function Has-Props($obj, [string[]]$names) {
  if ($null -eq $obj) { return $false }
  foreach ($n in $names) { if (-not ($obj.PSObject.Properties.Name -contains $n)) { return $false } }
  return $true
}

Log ("CU-HELPER-CHECK " + (Get-Date -Format s) + " helper=" + $Helper)
$info = Get-Item -LiteralPath $Helper
Log ("tamano=" + $info.Length + " bytes")

# --- consultas de solo lectura ---------------------------------------------------------------------------
$r = Run-Helper @('version')
$ver = Parse-Json $r.Out
Check 'version: salida 0 y {protocol:1, helper, platform:win32}' ($r.Code -eq 0 -and (Has-Props $ver @('protocol', 'helper', 'platform')) -and $ver.protocol -eq 1 -and $ver.platform -eq 'win32' -and $ver.helper -ne '') $r.Out

$r = Run-Helper @('screens')
$screens = Parse-Json $r.Out
Check 'screens: salida 0 y una sola linea JSON' ($r.Code -eq 0 -and $r.Out -notmatch "`n" -and $null -ne $screens) "code=$($r.Code)"
if ($r.Code -eq 0 -and $null -ne $screens) {
  $list = @($screens)
  Check 'screens: al menos un monitor con las claves del contrato' ($list.Count -ge 1 -and (Has-Props $list[0] @('width', 'height', 'scale', 'x', 'y', 'main'))) "monitores=$($list.Count)"
  $mains = @($list | Where-Object { $_.main -eq $true })
  Check 'screens: exactamente un monitor principal' ($mains.Count -eq 1)
  if ($mains.Count -ge 1) {
    Check 'screens: pixeles fisicos y escala validos' ($mains[0].width -gt 0 -and $mains[0].height -gt 0 -and $mains[0].scale -ge 1) "principal=$($mains[0].width)x$($mains[0].height) escala=$($mains[0].scale)"
  }
}

$r = Run-Helper @('cursor')
$cur = Parse-Json $r.Out
Check 'cursor: salida 0 con x e y numericos' ($r.Code -eq 0 -and (Has-Props $cur @('x', 'y'))) $r.Out

$r = Run-Helper @('permissions')
$perm = Parse-Json $r.Out
Check 'permissions: claves {consent,interactive,elevated,helper,dpi,monitors}' ($r.Code -eq 0 -and (Has-Props $perm @('consent', 'interactive', 'elevated', 'helper', 'dpi', 'monitors'))) $r.Out
if ($null -ne $perm) {
  Check 'permissions: sin consentimiento (no se le paso) -> consent=false' ($perm.consent -eq $false)
  if ($perm.elevated -eq $true) { Warn 'permissions: elevated=true' 'este PowerShell corre como administrador: Control del PC no estara disponible (es lo esperado por diseno)' }
  if ($perm.interactive -ne $true) { Warn 'permissions: interactive=false' 'sin escritorio interactivo (SSH, bloqueo, UAC o RDP desconectado): ejecuta esto en una sesion grafica' }
}

$r = Run-Helper @('session')
$sess = Parse-Json $r.Out
Check 'session: JSON con {interactive,secureDesktop,elevatedTarget}' (Has-Props $sess @('interactive', 'secureDesktop', 'elevatedTarget')) $r.Out
if ($r.Code -eq 0) { Log 'OK     session: salida 0 (sesion interactiva, sin escritorio seguro)' }
elseif ($r.Code -eq 12) { Warn 'session: salida 12' ("sin escritorio interactivo o escritorio seguro: " + $r.Err) }
else { Check 'session: salida 0 o 12' $false "code=$($r.Code)" }

$r = Run-Helper @('frontmost')
$front = Parse-Json $r.Out
Check 'frontmost: salida 0 y JSON con name' ($r.Code -eq 0 -and (Has-Props $front @('name'))) $r.Out
if ($null -ne $front -and $front.name -ne '') {
  Check 'frontmost: la clave empieza por exe: o aumid:' (($front.bundleId -like 'exe:*|pub:*') -or ($front.bundleId -like 'aumid:*')) $front.bundleId
}

$r = Run-Helper @('running-apps')
$run = Parse-Json $r.Out
Check 'running-apps: salida 0 y lista' ($r.Code -eq 0 -and $null -ne $run) "code=$($r.Code)"

$r = Run-Helper @('list-apps')
$apps = Parse-Json $r.Out
Check 'list-apps: salida 0 y lista' ($r.Code -eq 0 -and $null -ne $apps) "code=$($r.Code)"
$appList = @()
if ($r.Code -eq 0 -and $null -ne $apps) { $appList = @($apps) }
if ($appList.Count -gt 0) {
  Check 'list-apps: cada app trae {name,appKey,pid} con clave canonica' ((@($appList | Where-Object { -not (Has-Props $_ @('name', 'appKey', 'pid')) -or -not (($_.appKey -like 'exe:*|pub:*') -or ($_.appKey -like 'aumid:*')) })).Count -eq 0) "apps=$($appList.Count)"
  $keys = @($appList | Select-Object -First 3 | ForEach-Object { $_.appKey }) -join ','
  $r = Run-Helper @('windows-of', $keys)
  $wins = Parse-Json $r.Out
  Check 'windows-of: salida 0 y lista de rectangulos' ($r.Code -eq 0 -and $null -ne $wins) "code=$($r.Code)"
  if ($r.Code -eq 0 -and $null -ne $wins -and @($wins).Count -gt 0) {
    $w0 = @($wins)[0]
    Check 'windows-of: claves {x,y,width,height}' (Has-Props $w0 @('x', 'y', 'width', 'height'))
  }
} else {
  Warn 'list-apps vacia' 'no hay ventanas de aplicacion visibles: se omite windows-of'
}

$r = Run-Helper @('resolve-app', 'zz-app-que-no-existe-zz')
$res = Parse-Json $r.Out
Check 'resolve-app (solo consulta, no abre nada): app inexistente -> found=false y bundleId vacio' ($r.Code -eq 0 -and (Has-Props $res @('name', 'bundleId', 'found')) -and $res.found -eq $false -and $res.bundleId -eq '') $r.Out

$r = Run-Helper @('focused-secure')
$fs = Parse-Json $r.Out
Check 'focused-secure: salida 0 y {secure: bool}' ($r.Code -eq 0 -and (Has-Props $fs @('secure'))) $r.Out

$r = Run-Helper @('recent-input')
$ri = Parse-Json $r.Out
Check 'recent-input: salida 0 y keyDownSeconds' ($r.Code -eq 0 -and (Has-Props $ri @('keyDownSeconds'))) $r.Out

$r = Run-Helper @('--instant', 'cursor')
Check 'banderas globales antes del comando (--instant cursor)' ($r.Code -eq 0)

# --- lo prohibido falla cerrado (nada de esto actua sobre el escritorio) ---------------------------------
$r = Run-Helper @('comando-que-no-existe')
Check 'comando desconocido -> salida 1 y mensaje por stderr' ($r.Code -eq 1 -and $r.Err -ne '' -and $r.Out -eq '')

$r = Run-Helper @('ax-action', 'aumid:a.b!c', 'w0', 'AXDelete')
Check 'ax-action con accion fuera de la lista cerrada -> salida 11' ($r.Code -eq 11) "code=$($r.Code)"

$r = Run-Helper @('open-app', 'Notepad')
Check 'open-app (diferido en esta tanda) -> salida 12 y no abre nada' ($r.Code -eq 12) "code=$($r.Code)"

$r = Run-Helper @('record', 'x')
Check 'record (fuera de la v1 de Windows) -> salida 12' ($r.Code -eq 12) "code=$($r.Code)"

$tmpDir = $script:tmpDir
$shot = Join-Path $tmpDir 'sin-consentimiento.jpg'
Remove-Item -Force -LiteralPath $shot -ErrorAction SilentlyContinue
$r = Run-Helper @('screenshot', $shot) @{ CU_TEMP_DIR = $tmpDir }
Check 'screenshot SIN consentimiento -> salida 12 y no escribe el archivo' ($r.Code -eq 12 -and -not (Test-Path -LiteralPath $shot)) "code=$($r.Code)"

$shotW = Join-Path $tmpDir 'ventana-sin-consentimiento.jpg'
Remove-Item -Force -LiteralPath $shotW -ErrorAction SilentlyContinue
$r = Run-Helper @('window-shot', 'aumid:a.b!c', $shotW, '0', '--max-long', '800', '--quality', '60')
Check 'window-shot SIN consentimiento -> salida 12 y no escribe el archivo' ($r.Code -eq 12 -and -not (Test-Path -LiteralPath $shotW)) "code=$($r.Code)"

$r = Run-Helper @('screenshot', $shot, '--mask-keys', 'aumid:a%41')
Check 'screenshot con --mask-keys mal codificado -> salida 1 (falla cerrado) y no escribe el archivo' ($r.Code -eq 1 -and -not (Test-Path -LiteralPath $shot)) "code=$($r.Code)"

# --- captura opcional (lectura de pantalla; requiere sesion grafica) -------------------------------------
if ($WithCapture) {
  $shot2 = Join-Path $tmpDir 'captura.jpg'
  Remove-Item -Force -LiteralPath $shot2 -ErrorAction SilentlyContinue
  $r = Run-Helper @('screenshot', $shot2, '--max-long', '800', '--quality', '60') @{ COMPUTER_WIN_CONSENT = '1'; CU_TEMP_DIR = $tmpDir }
  $cap = Parse-Json $r.Out
  if ($r.Code -eq 12) { Warn 'screenshot con consentimiento -> 12' $r.Err }
  else {
    Check 'screenshot: salida 0 y {width,height,ratio,masked}' ($r.Code -eq 0 -and (Has-Props $cap @('width', 'height', 'ratio', 'masked'))) "code=$($r.Code) $($r.Out) $($r.Err)"
    if ($r.Code -eq 0 -and (Test-Path -LiteralPath $shot2)) {
      $bytes = [System.IO.File]::ReadAllBytes($shot2)
      Check 'screenshot: JPEG valido (FFD8 ... FFD9) y lado largo <= 800' ($bytes.Length -gt 1000 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xD8 -and $bytes[$bytes.Length - 2] -eq 0xFF -and $bytes[$bytes.Length - 1] -eq 0xD9 -and [Math]::Max($cap.width, $cap.height) -le 800) "bytes=$($bytes.Length) $($cap.width)x$($cap.height) enmascaradas=$($cap.masked)"
    }
  }
  Remove-Item -Force -LiteralPath $shot2 -ErrorAction SilentlyContinue
}
Remove-Item -Force -Recurse -LiteralPath $tmpDir -ErrorAction SilentlyContinue

# --- el helper no deja procesos vivos ----------------------------------------------------------------------
$left = @(Get-Process -Name 'cu-helper' -ErrorAction SilentlyContinue)
Check 'no queda ningun cu-helper vivo' ($left.Count -eq 0) "vivos=$($left.Count)"

Log ("RESUMEN fallas=" + $script:fail + " avisos=" + $script:warn)
if ($script:fail -eq 0) { exit 0 } else { exit 1 }
