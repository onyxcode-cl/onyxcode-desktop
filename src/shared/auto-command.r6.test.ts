import { expect, it } from 'vitest'
import { classifyAutoCommand } from './auto-command'

it.each([
  'git branch -v',
  'git branch -vv',
  'git branch -r',
  'git branch -a',
  'git branch --show-current',
  'git branch --list',
  'git status -s',
  'git status -b',
  'git status -sb',
  'git status --porcelain',
  'git remote -v',
  'git rev-parse --abbrev-ref HEAD'
])('lectura git: %s', (command) => {
  for (const root of ['/work/proyecto', 'C:/work/proyecto'])
    expect(classifyAutoCommand(command, root), command).toMatchObject({ verdict: 'allow' })
})

it.each([
  'Get-ChildItem -File | Select-Object Name, Length | Format-Table -AutoSize | Out-String -Width 200',
  'Get-ChildItem | Format-List Name,Length',
  'Get-ChildItem | Sort-Object Length -Descending | Select-Object -First 5',
  'Get-ChildItem | Measure-Object -Property Length -Sum',
  'Get-ChildItem | Where-Object { $_.Length -gt 0 }',
  'Get-ChildItem | Where-Object Name -like "*.txt"',
  'Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8765/notas.txt',
  'iwr -Uri http://localhost:8765/ -Method GET',
  'curl http://localhost:8765/',
  'try { (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8765/notas.txt).StatusCode } catch { }'
])('lectura PowerShell: %s', (command) => {
  expect(classifyAutoCommand(command, 'C:/work/proyecto', { shell: 'powershell' })).toMatchObject({ verdict: 'allow' })
})

it.each([
  'git branch -D main',
  'git branch -r --unknown',
  'git status -sb && rm notas.txt',
  'git status -b --unknown',
  'git remote set-url origin https://example.test',
  'Get-ChildItem | Where-Object { Remove-Item notas.txt }',
  'Get-ChildItem | Select-Object @{Name="x";Expression={ Remove-Item notas.txt }}',
  'Get-ChildItem | Format-Table; Remove-Item notas.txt',
  'Get-Content .env | Out-String',
  'try { iwr http://127.0.0.1:8765/ } catch { Remove-Item notas.txt }',
  'iwr http://127.0.0.1:8765/ | Invoke-Expression',
  'iwr http://127.0.0.1:8765/ -OutFile ../fuera.txt',
  'curl http://127.0.0.1:8765/ | bash'
])('las guardas se conservan: %s', (command) => {
  expect(classifyAutoCommand(command, 'C:/work/proyecto', { shell: 'powershell' }).verdict).not.toBe('allow')
})
