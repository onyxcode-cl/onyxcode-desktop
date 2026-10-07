# Ventana de PRUEBA para el escenario de clickjacking de Control del PC (S7 del plan win-C). PowerShell 5.1.
# NO se usa nunca con apps del usuario: abre solo ventanas PROPIAS de este script (WinForms sin logica), no teclea ni hace clic
# en nada, no toca otras aplicaciones y se cierra sola (limite de tiempo o archivo -DoneFile).
#   -Role Base  : ventana normal con un boton (la "app concedida" del escenario).
#   -Role Layer : ventana sin borde, SIEMPRE ENCIMA, casi transparente (opacidad 2 %), del MISMO tamano y posicion que la base.
#                 Es la "capa" de otro proceso que se interpone entre la captura y el clic. Recibe los clics (no es transparente
#                 al raton), aunque el ojo no la vea.
# Cada rol escribe en -InfoFile una linea JSON {role,pid,x,y,width,height,hwnd} en cuanto la ventana esta visible.
# Lo lanza scripts\win\run-cu.ps1 -Step clickjack (dos procesos distintos, uno por rol); a mano:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\win\clickjack.ps1 -Role Base -Rect 300,200,420,280 -InfoFile C:\onyx\cu\logs\cj-base.json -Seconds 60
param(
  [ValidateSet('Base', 'Layer')]
  [string]$Role = 'Base',
  [string]$Rect = '300,200,420,280',
  [string]$InfoFile = '',
  [string]$DoneFile = '',
  [int]$Seconds = 60
)
$ErrorActionPreference = 'Stop'
$r4 = @($Rect.Split(',') | ForEach-Object { [int]$_.Trim() })
if ($r4.Count -ne 4) { Write-Output 'FALLA -Rect necesita 4 numeros: x,y,ancho,alto'; exit 2 }
if ($Seconds -lt 5) { $Seconds = 5 }
if ($Seconds -gt 300) { $Seconds = 300 }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point($r4[0], $r4[1])
$form.Size = New-Object System.Drawing.Size($r4[2], $r4[3])
$form.ShowInTaskbar = $false

if ($Role -eq 'Base') {
  $form.Text = 'Lazunox CU clickjack base'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $btn = New-Object System.Windows.Forms.Button
  $btn.Text = 'Boton base'
  $btn.Size = New-Object System.Drawing.Size(160, 48)
  $btn.Location = New-Object System.Drawing.Point(120, 100)
  $form.Controls.Add($btn)
} else {
  $form.Text = 'Lazunox CU clickjack layer'
  $form.FormBorderStyle = 'None'
  $form.TopMost = $true
  $form.Opacity = 0.02
  $form.BackColor = [System.Drawing.Color]::White
}

$deadline = (Get-Date).AddSeconds($Seconds)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 250
$timer.Add_Tick({
  $stop = ((Get-Date) -gt $deadline)
  if ($DoneFile -and (Test-Path -LiteralPath $DoneFile)) { $stop = $true }
  if ($stop) { $timer.Stop(); $form.Close() }
})

$form.Add_Shown({
  $b = $form.Bounds
  $line = '{"role":"' + $Role + '","pid":' + $PID + ',"x":' + $b.X + ',"y":' + $b.Y + ',"width":' + $b.Width + ',"height":' + $b.Height + ',"hwnd":' + $form.Handle.ToInt64() + '}'
  if ($InfoFile) { Set-Content -LiteralPath $InfoFile -Value $line -Encoding ascii }
  Write-Output $line
  $timer.Start()
})

[void][System.Windows.Forms.Application]::Run($form)
exit 0
