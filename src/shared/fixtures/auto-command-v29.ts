/**
 * V29: lo que antes se aprobaba debe ser `allow` (o `doubt`, que el revisor aprobará); lo que antes preguntaba debe ser
 * `hard` (o `doubt`, que el revisor puede bloquear). Excepciones explícitas: lecturas, que la regla nueva deja pasar
 * («leer fuera del proyecto, salvo credenciales», «lo inofensivo»).
 */
export const NOW_ALLOWED_READS = new Set([
  // Ronda 5: lecturas fuera del proyecto o de .git, y patrones con variables en una lectura.
  String.raw`Select-String -Path ..\..\x -Pattern '[a-z]'`,
  String.raw`Select-String -LiteralPath C:\Windows\win.ini -Pattern '\d+'`,
  String.raw`Select-String -Path .git\config -Pattern '\w+'`,
  String.raw`dir /b C:\Windows`,
  String.raw`dir /s ..\..\x`,
  String.raw`findstr /s /i "TODO" C:\Windows\win.ini`,
  String.raw`where /r C:\Windows *.exe`,
  String.raw`tree /a C:\Windows`,
  String.raw`dir /b .git\config`,
  'Select-String -Path *.html -Pattern "$pattern"',
  'Select-String -Path *.html -Pattern "$(Get-Content index.html)"',
  'Select-String -Path *.html -Pattern "`w+"',
  '(Get-Content index.html) -match "$pattern"',
  '(Get-Content index.html) -replace "`w+", "x"',
  '(Get-Content index.html) -split "$pattern"',
  '(Get-Content index.html) -like "$pattern"',
  String.raw`Get-Content '\d+'`,
  String.raw`Select-String -Path '\d+' -Pattern '[a-z]'`,
  String.raw`Get-Content /b`,
  String.raw`cmd /c dir /b .`
])

/** Ronda 7: `kill %1` solo alcanza el servidor que lanzó el mismo comando; ahora es inofensivo. */
export const ROUND7_NOW_ALLOWED = new Set(['caf2-8'])
