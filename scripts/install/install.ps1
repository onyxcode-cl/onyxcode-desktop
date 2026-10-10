# Instalador de Lazunox para Windows (64 bits). Gratis y sin certificado de firma.
#
# Uso:  irm <url-de-este-script> | iex
#       .\install.ps1 [-Version X.Y.Z] [-DryRun] [-NoOpen] [-Uninstall]
#
# QUÉ HACE (en este orden):
#   1. Comprueba que es Windows de 64 bits y que PowerShell NO corre como administrador.
#   2. Descarga de la release de GitHub el SHA256SUMS y el instalador `Lazunox-Setup-X.Y.Z-x64.exe` a una carpeta temporal.
#   3. Comprueba el SHA-256 del instalador contra SHA256SUMS. Si no coincide, aborta sin instalar nada.
#   4. Ejecuta el instalador en silencio, solo para tu usuario (no pide permisos de administrador).
#   5. Borra los temporales y ofrece abrir la app.
#
# POR QUÉ NO SALE EL AVISO «Windows protegió su PC»: SmartScreen solo mira los archivos que llevan la marca de «descargado de
# Internet» (Zone.Identifier). Lo que baja PowerShell con Invoke-WebRequest no la lleva. El hash SHA-256 del archivo es lo que
# garantiza que es exactamente el publicado.
#
# QUÉ NO HACE: no necesita administrador, no toca tus datos (%APPDATA%\Lazunox), no cambia ajustes de seguridad ni instala otra cosa.
#
# Variables de entorno: LAZUNOX_RELEASES_REPO («dueño/repositorio»; anula la constante de abajo) y LAZUNOX_RELEASES_ORIGIN (solo pruebas).
[CmdletBinding()]
param(
  [string]$Version = '',
  [switch]$DryRun,
  [switch]$NoOpen,
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Mientras valga PENDIENTE no hay release publicada y el script se niega a ejecutarse.
$ReleasesRepoDefault = 'lazunox/lazunox'
$ReleasesOriginDefault = 'https://lazunox.onyxcode.cl'
$Repo = if ($env:LAZUNOX_RELEASES_REPO) { $env:LAZUNOX_RELEASES_REPO } else { $ReleasesRepoDefault }
$Origin = if ($env:LAZUNOX_RELEASES_ORIGIN) { $env:LAZUNOX_RELEASES_ORIGIN.TrimEnd('/') } else { $ReleasesOriginDefault }
$InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\Lazunox'

function Say([string]$m) { Write-Host $m }
function Fail([string]$m) { Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }

if ($Uninstall) {
  $un = Join-Path $InstallDir 'Uninstall Lazunox.exe'
  if (-not (Test-Path -LiteralPath $un)) { Fail "No encuentro Lazunox en $InstallDir." }
  if ($DryRun) { Say "[dry-run] & `"$un`" /S"; exit 0 }
  Start-Process -FilePath $un -ArgumentList '/S' -Wait
  Say 'Lazunox desinstalado. Tus datos en %APPDATA%\Lazunox NO se han borrado.'
  exit 0
}

if (-not [Environment]::Is64BitOperatingSystem) { Fail 'Lazunox necesita Windows de 64 bits.' }
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) { Fail 'Abre PowerShell normal, SIN «Ejecutar como administrador»: Lazunox no funciona con permisos de administrador.' }
if ($Repo -eq 'PENDIENTE') { Fail 'Todavía no hay una versión publicada para descargar.' }
if ($Repo -notmatch '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$') { Fail 'LAZUNOX_RELEASES_REPO debe tener la forma «dueño/repositorio».' }
if ($Version -and $Version -notmatch '^\d+\.\d+\.\d+$') { Fail '-Version debe ser X.Y.Z.' }

$base = if ($Version) { "$Origin/$Repo/releases/download/v$Version" } else { "$Origin/$Repo/releases/latest/download" }
if ($DryRun) {
  Say "[dry-run] Invoke-WebRequest $base/SHA256SUMS"
  Say "[dry-run] Invoke-WebRequest $base/<instalador>-x64.exe (el nombre sale de SHA256SUMS)"
  Say '[dry-run] comprobar el SHA-256 del instalador contra SHA256SUMS (abortar si no coincide)'
  Say '[dry-run] ejecutar el instalador con /S (solo tu usuario)'
  exit 0
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('lazunox-install-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $sums = Join-Path $tmp 'SHA256SUMS'
  Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile $sums
  $line = Get-Content -LiteralPath $sums | Where-Object { $_ -match 'Lazunox-Setup-\d+\.\d+\.\d+-x64\.exe\s*$' } | Select-Object -First 1
  if (-not $line) { Fail 'SHA256SUMS no trae el instalador de Windows.' }
  $parts = $line -split '\s+', 2
  $expected = $parts[0].ToLower()
  $name = $parts[1].Trim().TrimStart('*')
  if ($expected -notmatch '^[0-9a-f]{64}$' -or $name -notmatch '^Lazunox-Setup-\d+\.\d+\.\d+-x64\.exe$') { Fail 'SHA256SUMS tiene un formato inesperado.' }
  Say "Descargando $name…"
  $exe = Join-Path $tmp $name
  Invoke-WebRequest -UseBasicParsing -Uri "$base/$name" -OutFile $exe
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $exe).Hash.ToLower()
  if ($actual -ne $expected) { Fail 'El SHA-256 no coincide con el publicado: no se instala nada.' }
  Say 'Hash verificado. Instalando…'
  Start-Process -FilePath $exe -ArgumentList '/S' -Wait
  $app = Join-Path $InstallDir 'Lazunox.exe'
  if (-not (Test-Path -LiteralPath $app)) { Fail 'El instalador terminó pero no encuentro Lazunox.exe.' }
  Say "Listo: $app"
  if (-not $NoOpen) { Start-Process -FilePath $app }
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
