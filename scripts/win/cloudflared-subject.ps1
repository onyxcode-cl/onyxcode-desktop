# Lee la firma Authenticode de un cloudflared.exe YA presente en el PC (no descarga nada, no ejecuta el .exe, no cambia nada).
# Pensado para correr por SSH con PowerShell 5.1:
#   powershell -NoProfile -ExecutionPolicy Bypass -File cloudflared-subject.ps1 -Path C:\ruta\cloudflared-windows-amd64.exe
# Salida: UNA línea en stdout, campos separados por un espacio y el sujeto SIEMPRE al final (puede contener comas y espacios):
#   CLOUDFLARED-SUBJECT STATUS=<Valid|...> SIZE=<bytes> SHA256=<64 hex> SUBJECT=<sujeto exacto del certificado>
# Pasa el valor de SUBJECT (todo lo que sigue a `SUBJECT=`) a: node scripts/cloudflared/pin.mjs <versión> --network --platform win32-x64
#   --authenticode-subject "<sujeto>". Si STATUS no es Valid, NO fijes ese binario. Código de salida: 0 = leído, 1 = error.
param(
  [Parameter(Mandatory = $true)][string]$Path
)
$ErrorActionPreference = 'Stop'
try {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "no existe el archivo: ${Path}" }
  $item = Get-Item -LiteralPath $Path
  $sig = Get-AuthenticodeSignature -LiteralPath $Path
  $hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower()
  $subject = ''
  if ($sig.SignerCertificate) { $subject = [string]$sig.SignerCertificate.Subject }
  $subject = $subject -replace '[\r\n\t]+', ' '
  Write-Output ('CLOUDFLARED-SUBJECT STATUS=' + [string]$sig.Status + ' SIZE=' + $item.Length + ' SHA256=' + $hash + ' SUBJECT=' + $subject)
  exit 0
}
catch {
  $msg = ([string]$_.Exception.Message) -replace '[\r\n\t]+', ' '
  [Console]::Error.WriteLine('CLOUDFLARED-SUBJECT-ERROR ' + $msg)
  exit 1
}
