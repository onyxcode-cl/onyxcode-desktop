import { expect, it } from 'vitest'
import { classifyAutoCommand } from './auto-command'

const mac = '/Users/ana/proyecto'
const win = 'C:/Users/ana/proyecto'
it.each([
  'rm notas.txt',
  'rmdir vacia',
  'unlink notas.txt',
  'git clean -fd',
  'git rm notas.txt',
  'find . -name "*.tmp" -delete',
  'find . -name "*.tmp" -exec rm {} \\;',
  'rm "$dest/notas.txt"',
  'cd "$dest" && rm notas.txt',
  'python3 -c "import os; os.remove(\'notas.txt\')"',
  'printf x | xargs rm',
  'zip -m archivo.zip notas.txt',
  'tar --remove-files -cf archivo.tar notas.txt'
])('borrado siempre hard: %s', (command) => {
  expect(classifyAutoCommand(command, mac).verdict).toBe('hard')
})
it.each([
  'Remove-Item -LiteralPath notas.txt',
  'del notas.txt',
  'erase notas.txt',
  'rd carpeta',
  'Remove-Item $dest',
  'Get-Content lista.txt | Remove-Item'
])('borrado Windows hard: %s', (command) => {
  expect(classifyAutoCommand(command, win, { shell: 'powershell' }).verdict).toBe('hard')
})
it.each([
  'find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +',
  'find . -mindepth 1 -exec rm -r {} \\;',
  'rm -rf ./*',
  'rm -rf * .[!.]*',
  'Get-ChildItem | Remove-Item -Recurse',
  'Get-ChildItem -Force | Remove-Item -Recurse',
  'Remove-Item * -Recurse',
  'Remove-Item ./* -Recurse'
])('borrado amplio con motivo explícito: %s', (command) => {
  expect(classifyAutoCommand(command, /Item/i.test(command) ? win : mac, /Item/i.test(command) ? { shell: 'powershell' } : {})).toEqual({
    verdict: 'hard',
    reason: 'borra la raíz, la carpeta personal o el proyecto entero'
  })
})
it.each([
  'cp index.html ../index.html',
  'cp .env.example ../.env',
  'mv index.html ~/Desktop/index.html',
  'echo x > "$dest/a.txt"',
  'cd "$dest" && touch a.txt',
  'mktemp',
  "python3 -c \"from pathlib import Path; Path('/tmp/a.txt').write_text('x')\""
])('escritura exterior o desconocida hard: %s', (command) => {
  expect(classifyAutoCommand(command, mac).verdict).toBe('hard')
})
it.each([
  "Copy-Item -LiteralPath index.html -Destination ([Environment]::GetFolderPath('Desktop')) -PassThru | Select-Object FullName, Length",
  "$d = [Environment]::GetFolderPath('Desktop'); Copy-Item index.html -Destination (Join-Path $d 'index-copia.html')",
  'Copy-Item index.html -Destination $d',
  'Move-Item index.html -Destination ../fuera.html'
])('destino PowerShell desconocido hard aunque el motor omita externalDirectories: %s', (command) => {
  expect(classifyAutoCommand(command, win, { shell: 'powershell', externalDirectories: [] }).verdict).toBe('hard')
})
it.each([
  'Get-ChildItem -File | Select-Object Name, Length | Format-Table -AutoSize | Out-String -Width 200',
  'try { (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8765/notas.txt).StatusCode } catch { $_.Exception.Message }',
  'try { (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8765/notas.txt).StatusCode } catch { Write-Output $_.Exception.Message }',
  "try { iwr http://127.0.0.1:8765/notas.txt } catch { Write-Host 'no disponible' }",
  "Get-ChildItem -LiteralPath 'canción' | Select-Object Name, Length; Get-Content -LiteralPath 'canción/año.txt' -Encoding UTF8"
])('lecturas PowerShell reales incluso unparsed: %s', (command) => {
  for (const unparsed of [false, true])
    expect(classifyAutoCommand(command, win, { shell: 'powershell', unparsed })).toEqual({ verdict: 'allow', reason: 'inofensivo' })
})
it.each([
  'try { iwr http://127.0.0.1:8765/ } catch { Remove-Item notas.txt }',
  'try { iwr http://127.0.0.1:8765/ } catch { & $ejecutable }',
  'Get-ChildItem | Out-String -Unknown',
  'Get-Content .env',
  'try { iwr http://127.0.0.1:8765/ } catch { $_.Exception.Delete() }'
])('unparsed no abre otros cuerpos/opciones: %s', (command) => {
  expect(classifyAutoCommand(command, win, { shell: 'powershell', unparsed: true }).verdict).not.toBe('allow')
})
it('carpetas aprobadas siguen permitidas; externalDirectories no convierte lecturas en escrituras', () => {
  expect(
    classifyAutoCommand('cp index.html /tmp/aprobada/index.html', mac, {
      approvedDirectories: ['/tmp/aprobada'],
      externalDirectories: ['/tmp/aprobada']
    }).verdict
  ).toBe('allow')
  expect(classifyAutoCommand('cat /tmp/notas.txt', mac, { externalDirectories: ['/tmp'] }).verdict).toBe('allow')
})
it.each(['kill 1234', 'git push', 'git reset --hard HEAD'])('otras dudas se conservan: %s', (command) => {
  expect(classifyAutoCommand(command, mac).verdict).toBe('doubt')
})

it.each(['Get-ChildItem *.log | Remove-Item -Recurse', 'Get-ChildItem -Filter *.log | Remove-Item -Recurse'])(
  'el motivo no llama borrado de todo el proyecto a un filtro parcial: %s',
  (command) => {
    const result = classifyAutoCommand(command, win, { shell: 'powershell' })
    expect(result.verdict).toBe('hard')
    expect(result.reason).not.toContain('proyecto entero')
  }
)
