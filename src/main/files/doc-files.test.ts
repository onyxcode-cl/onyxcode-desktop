import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, chmodSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@shared/i18n', () => ({ t: (k: string) => k }))
import { docFilesInfo, resolveDocFile } from './doc-files'

function setup(): { root: string; outside: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'docfiles-')))
  const root = join(base, 'proyecto con ñ')
  const outside = join(base, 'fuera')
  mkdirSync(root)
  mkdirSync(outside)
  return { root, outside }
}

describe('resolveDocFile', () => {
  it('acepta un documento dentro del proyecto (espacios y acentos) con su peso real', () => {
    const { root } = setup()
    const f = join(root, 'Informe de ventas ñandú.xlsx')
    writeFileSync(f, 'x'.repeat(123))
    const info = resolveDocFile(root, f)
    expect(info.bytes).toBe(123)
    expect(info.name).toBe('Informe de ventas ñandú.xlsx')
  })
  it('rechaza rutas relativas, inexistentes y fuera de la carpeta', () => {
    const { root, outside } = setup()
    writeFileSync(join(outside, 'a.pdf'), 'x')
    expect(() => resolveDocFile(root, 'a.pdf')).toThrow()
    expect(() => resolveDocFile(root, join(root, 'nada.pdf'))).toThrow()
    expect(() => resolveDocFile(root, join(outside, 'a.pdf'))).toThrow(/fuera/)
  })
  it('rechaza extensiones que no son documento y archivos con bit de ejecución', () => {
    const { root } = setup()
    for (const n of ['run.sh', 'a.app', 'a.txt', 'a.command']) {
      writeFileSync(join(root, n), 'x')
      expect(() => resolveDocFile(root, join(root, n))).toThrow()
    }
    const exec = join(root, 'x.pdf')
    writeFileSync(exec, 'x')
    chmodSync(exec, 0o755)
    expect(() => resolveDocFile(root, exec)).toThrow()
  })
  it('rechaza un enlace simbólico que escapa del proyecto o apunta a otro tipo', () => {
    const { root, outside } = setup()
    writeFileSync(join(outside, 'secreto.pdf'), 'x')
    symlinkSync(join(outside, 'secreto.pdf'), join(root, 'enlace.pdf'))
    expect(() => resolveDocFile(root, join(root, 'enlace.pdf'))).toThrow(/fuera/)
    writeFileSync(join(root, 'real.sh'), 'x')
    symlinkSync(join(root, 'real.sh'), join(root, 'disfraz.pdf'))
    expect(() => resolveDocFile(root, join(root, 'disfraz.pdf'))).toThrow()
  })
})

describe('docFilesInfo', () => {
  it('omite inválidos y duplicados', () => {
    const { root, outside } = setup()
    const a = join(root, 'a.docx')
    writeFileSync(a, 'x')
    writeFileSync(join(outside, 'b.pdf'), 'x')
    const r = docFilesInfo(root, [a, a, join(outside, 'b.pdf'), join(root, 'c.pdf')])
    expect(r.map((i) => i.path)).toEqual([a])
  })
})
