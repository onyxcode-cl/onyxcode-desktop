# Lista procesos que cuelgan de C:\onyx\ (y la carga de CPU) en el PC Windows de pruebas. Solo lectura.
$procs = @(Get-CimInstance Win32_Process | Where-Object { ($_.ExecutablePath -and $_.ExecutablePath -like 'C:\onyx\*') -or ($_.CommandLine -and $_.CommandLine -like '*C:\onyx\*' -and $_.ProcessId -ne $PID) })
$procs | Select-Object ProcessId, Name | Format-Table | Out-String | Write-Output
Write-Output ("procesos bajo C:\onyx: " + $procs.Count)
Write-Output ("electron/opencode en todo el sistema: " + @(Get-Process electron, opencode -ErrorAction SilentlyContinue).Count)
Write-Output ("CPU %: " + (Get-CimInstance Win32_Processor | Select-Object -First 1).LoadPercentage)
