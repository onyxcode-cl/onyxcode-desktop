/**
 * Git real sobre un repo temporal: nombres no ASCII y con espacios salen en el diff tal cual (`core.quotepath=off`), igual
 * que en `status -z`; antes git los citaba con escapes octales y el panel Cambios no los casaba. El troceo de las rutas que
 * git sigue citando (p. ej. con «"») se prueba en `review-logic.test.ts` con esta misma salida.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isWin } from '../../test/platform'
import { diff, status } from './service'

let dir: string
const g = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })

// Windows no admite «"» en nombres de archivo.
describe.skipIf(isWin)('diff con nombres especiales (core.quotepath=off)', () => {
  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'lazunox-git-names-')))
    g('init', '-q')
    g('config', 'user.email', 't@t.t')
    g('config', 'user.name', 't')
    g('config', 'commit.gpgsign', 'false')
    // El valor del repo no debe importar: se fuerza el de fábrica («on»).
    g('config', 'core.quotepath', 'on')
    mkdirSync(join(dir, 'a b'))
    for (const f of ['café.txt', 'q"uote.txt', 'a b/c.txt', 'viejo.txt']) writeFileSync(join(dir, f), 'uno\n')
    g('add', '-A')
    g('commit', '-q', '-m', 'init')
    for (const f of ['café.txt', 'q"uote.txt', 'a b/c.txt']) writeFileSync(join(dir, f), 'uno\ndos\n')
    writeFileSync(join(dir, 'nuevo ñ.txt'), 'hola\n')
    g('mv', 'viejo.txt', 'nuevo b.txt')
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('el diff nombra los archivos como status (sin escapes octales)', async () => {
    const st = await status(dir)
    const paths = st.files.map((f) => f.path).sort()
    expect(paths).toEqual(['a b/c.txt', 'café.txt', 'nuevo b.txt', 'nuevo ñ.txt', 'q"uote.txt'].sort())
    const patch = await diff({ cwd: dir })
    expect(patch).not.toMatch(/\\303/)
    const heads = patch.split('\n').filter((l) => l.startsWith('diff --git ') || l.startsWith('rename to '))
    expect(heads).toEqual(
      expect.arrayContaining([
        'diff --git a/café.txt b/café.txt',
        'diff --git a/nuevo ñ.txt b/nuevo ñ.txt',
        'diff --git a/a b/c.txt b/a b/c.txt',
        'rename to nuevo b.txt',
        // «"» se sigue citando aunque quotepath esté apagado: el renderer lo decodifica.
        'diff --git "a/q\\"uote.txt" "b/q\\"uote.txt"'
      ])
    )
  })
})
