import { describe, expect, it } from 'vitest'
import { classifyAutoCommand } from './auto-command'
import { displayCommandParts, permissionCommandPolicy, subcommandRuleSummary } from './auto-review'

const patch = `apply_patch <<'PATCH'
*** Begin Patch
*** Add File: index.html
+<!DOCTYPE html>
+<html lang="es"><head><title>Librería El Faro de Papel</title></head>
+<body><main>Libros</main></body></html>
*** End Patch
PATCH`
const python = `python3 - <<'PY'
from html.parser import HTMLParser
from pathlib import Path
class Check(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []
    def handle_endtag(self, tag):
        if tag in self.stack:
            i = len(self.stack) - 1 - self.stack[::-1].index(tag)
            del self.stack[i:]
        if tag == '/':
            print('</' + tag + '>')
parser = Check()
parser.feed(Path('index.html').read_text())
PY`

describe('V31 R2: los cuerpos heredoc son datos del receptor', () => {
  for (const root of ['/work/proyecto', 'C:/work/proyecto']) {
    it(`patch y Python no inventan borrados ni salidas del proyecto (${root})`, () => {
      for (const command of [patch, python]) {
        const result = classifyAutoCommand(command, root, { shell: 'bash', externalDirectories: [] })
        // Leer y verificar con Python dentro del proyecto puede pasar solo; nunca es borrar ni salir del proyecto.
        expect(['allow', 'doubt']).toContain(result.verdict)
        expect(
          permissionCommandPolicy({ permission: 'bash', metadata: { command, shell: 'bash', externalDirectories: [] }, patterns: [] }, root)
        ).toEqual({ alwaysAsk: false, notice: null })
        const md = { command, subcommands: [{ command, rule: null }] }
        expect(displayCommandParts(command)).toEqual([command])
        expect(subcommandRuleSummary(md)?.exclusions).toEqual([{ command, reason: 'blocked' }])
      }
    })
    it(`un borrado real después del delimitador sigue siendo hard (${root})`, () => {
      expect(classifyAutoCommand(python + '\nrm notas.txt', root, { shell: 'bash' }).verdict).toBe('hard')
      expect(displayCommandParts(python + '\nrm notas.txt')).toEqual([python, 'rm notas.txt'])
    })
  }
  it('el texto de un heredoc literal no activa las expresiones del shell', () => {
    expect(classifyAutoCommand("cat <<'EOF'\n[System.IO.File]::Delete('/fuera')\nEOF", '/work/proyecto').verdict).toBe('allow')
  })
})

it('las expansiones de un heredoc sin comillas conservan la revisión de lo que ejecutan', () => {
  expect(classifyAutoCommand('cat <<EOF\n$(rm notas.txt)\nEOF', '/work/proyecto').verdict).toBe('hard')
  expect(classifyAutoCommand("cat <<'EOF'\n$(rm notas.txt)\nEOF", '/work/proyecto').verdict).toBe('allow')
})
