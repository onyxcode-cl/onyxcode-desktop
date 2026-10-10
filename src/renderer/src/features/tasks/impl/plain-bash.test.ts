import { describe, expect, it } from 'vitest'
import { plainBash } from './plain-bash'

describe('plainBash', () => {
  it.each([
    ['PY="$LAZUNOX_PYTHON" S="/x/skills/xlsx/scripts"; "$PY" "$S/recalc_check.py" ~/Desktop/a.xlsx', 'check'],
    ['python3 check_docx.py informe.docx', 'check'],
    ['python3 render.py informe.pdf --outdir out', 'render'],
    ['"$PY" "$S/build_xlsx.py" spec.json', 'excel'],
    ['python3 build_docx.py spec.json', 'word'],
    ['mkdir -p ~/Desktop/facturas && mv a.txt ~/Desktop/facturas/', 'mkdir'],
    ['mv a.txt b/', 'move'],
    ['cp a.txt b.txt', 'copy'],
    ['rm -f temporal.txt', 'remove'],
    ['test -e ~/Desktop/x && ls -l ~/Desktop/x', 'look'],
    ['ls -la', 'look'],
    ['python3 -c "print(1)"', 'prep'],
    ['New-Item -ItemType Directory -Path C:\\Users\\x\\Desktop\\facturas', 'mkdir'],
    ['Move-Item a.txt C:\\x\\b\\', 'move'],
    ['Copy-Item a.txt b.txt', 'copy'],
    ['Remove-Item temporal.txt', 'remove'],
    ['Get-ChildItem C:\\Users\\x\\Desktop', 'look'],
    ['curl https://example.com', 'other']
  ] as const)('%s → %s', (cmd, id) => {
    expect(plainBash(cmd)).toBe(id)
  })
})
