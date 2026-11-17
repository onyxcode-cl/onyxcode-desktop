/** V31 R4: texto guardado y ejecución dinámica. Son datos de prueba; nunca se ejecutan. */
export const variableDeletes: ReadonlyArray<readonly [shell: string, command: string]> = [
  [
    'powershell',
    `$ruta = 'C:\\work\\proyecto\\borrame.txt'; $script = "Remove-Item -LiteralPath '$ruta' -Force"; Write-Output 'Existe antes'; Invoke-Expression $script`
  ],
  ['powershell', `$cmd = 'del /f /q "C:\\work\\proyecto\\borrame.txt"'; Write-Output 'Existe antes'; $cmd | cmd.exe`],
  ['powershell', `$cmd = "Remove-Item -LiteralPath '$PWD\\borrame.txt' -Force"; Invoke-Expression $cmd`],
  ['powershell', `$cmd = "del /f /q C:\\work\\proyecto\\borrame.txt"; $cmd | cmd.exe`],
  ['bash', `c='rm -f notas.txt'; eval "$c"`],
  ['bash', `c="rm -f notas.txt"; bash -c "$c"`],
  ['bash', `c='rm notas.txt'; echo "$c" | sh`],
  ['bash', `export c='rm notas.txt'; sh -c "$c"`],
  ['powershell', `iex "Remove-Item x"`],
  ['powershell', `& ([scriptblock]::Create('Remove-Item x'))`],
  [
    'powershell',
    `$b=[Convert]::FromBase64String('UmVtb3ZlLUl0ZW0geA=='); Write-Output 'Remove-Item'; iex ([Text.Encoding]::UTF8.GetString($b))`
  ],
  ['powershell', `$x = @'\nRemove-Item x\n'@; iex $x`],
  ['powershell', `$x = @"\nRemove-Item $ruta\n"@; Invoke-Expression $x`],
  ['powershell', `Set-Variable -Name x -Value 'Remove-Item x'; iex $x`],
  ['powershell', `Set-Variable x 'Remove-Item x'; $x | Invoke-Expression`],
  ['powershell', `$x='Remove-Item x'; & ([scriptblock]::Create($x))`],
  ['powershell', `$x='Remove-Item x'; . ([scriptblock]::Create($x))`],
  ['powershell', `$x='Remove-Item x'; $x | pwsh -Command -`],
  ['powershell', `$x='Remove-Item x'; $x | powershell`],
  ['powershell', `$x='rm x'; $x | bash`],
  ['powershell', `$x='rm x'; $x | sh`],
  ['powershell', `$x='del x'; cmd /c $x`],
  ['powershell', `$X='Remove-Item x'; iex $x`],
  ['powershell', `$x='Remove-Item x'; $x = Get-Content limpia.ps1; iex $x`]
]

export const dynamicDeleteActions = [
  'Remove-Item x',
  'rm x',
  'del x',
  'erase x',
  'rd x',
  'rmdir x',
  'ri x',
  'unlink x',
  'Clear-Content x',
  '$f.Delete()',
  '[IO.File]::Delete("x")',
  '[IO.Directory]::Delete("x")',
  'Remove-ItemProperty x',
  'shred x',
  'find . -delete',
  'git clean -fd'
]

export const dynamicDeleteRunners = [
  ['powershell', 'Invoke-Expression $unknown'],
  ['powershell', 'iex $unknown'],
  ['powershell', '& ([scriptblock]::Create($unknown))'],
  ['powershell', '. ([scriptblock]::Create($unknown))'],
  ['powershell', 'cmd /c $unknown'],
  ['powershell', 'cmd /c"$unknown"'],
  ['powershell', 'pwsh -e invalid-base64'],
  ['powershell', 'powershell -Command $unknown'],
  ['bash', 'bash -c "$unknown"'],
  ['bash', 'bash -c"$unknown"'],
  ['bash', 'sh --command="$unknown"'],
  ['bash', 'sh -c "$unknown"'],
  ['bash', 'eval "$unknown"'],
  ['powershell', 'Get-Content limpia.ps1 | iex'],
  ['powershell', '$unknown | cmd.exe'],
  ['powershell', '$unknown | pwsh'],
  ['bash', 'cat script | bash'],
  ['bash', 'cat script | sh']
] as const

export const allVariableDeletes: ReadonlyArray<readonly [shell: string, command: string]> = [
  ...variableDeletes,
  ...dynamicDeleteRunners.flatMap(([shell, runner]) => dynamicDeleteActions.map((action) => [shell, `# ${action}\n${runner}`] as const))
]
