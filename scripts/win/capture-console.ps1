# Captura la pantalla INTERACTIVA (la sesion de consola) con CopyFromScreen. Pensado para una tarea programada /IT:
#   schtasks /Create /TN onyx-shot /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\onyx\capture-console.ps1 -Out C:\onyx\shots\consola.png" /SC ONCE /ST 00:00 /IT /F
#   schtasks /Run /TN onyx-shot   (luego borrar la tarea con /Delete)
# Una sesion SSH no tiene escritorio: CopyFromScreen falla alli. Solo lectura de pantalla; no toca ninguna app.
param(
  [string]$Out = 'C:\onyx\shots\consola.png',
  [int]$DelaySeconds = 0
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
if ($DelaySeconds -gt 0) { Start-Sleep -Seconds $DelaySeconds }
$dir = Split-Path -Parent $Out
if ($dir) { New-Item -ItemType Directory -Force $dir | Out-Null }
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
if ($b.Width -le 0 -or $b.Height -le 0) { Write-Output 'Sin pantalla interactiva.'; exit 4 }
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
try {
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
  $g.Dispose()
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output "OK $($b.Width)x$($b.Height) -> $Out"
} finally {
  $bmp.Dispose()
}
