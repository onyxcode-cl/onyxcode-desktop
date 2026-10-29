import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkLinkedFolder } from './linked'
import { posixOnly } from '../../test/platform'

let base: string
let home: string
let project: string
let ctx: { project: string; home: string; userData: string }

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'lzx-linked-'))
  home = join(base, 'home')
  project = join(home, 'proyecto')
  mkdirSync(project, { recursive: true })
  mkdirSync(join(home, 'facturas'))
  mkdirSync(join(home, '.ssh'))
  mkdirSync(join(home, 'app-data'))
  mkdirSync(join(project, 'dentro'))
  ctx = { project, home, userData: join(home, 'app-data') }
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

const reason = (p: string): string => {
  const r = checkLinkedFolder(p, ctx)
  return r.ok ? 'ok' : r.reason
}

describe('checkLinkedFolder', () => {
  it('acepta una carpeta normal fuera del proyecto', () => {
    expect(reason(join(home, 'facturas'))).toBe('ok')
  })
  it('rechaza lo que sería una puerta a todo el equipo o a secretos', () => {
    expect(reason(home)).toBe('root-or-home')
    expect(reason(base)).toBe('root-or-home') // contiene la carpeta personal
    expect(reason(join(home, '.ssh'))).toBe('secrets')
    expect(reason(join(home, 'app-data'))).toBe('app-state')
  })
  it('rechaza rutas relativas, inexistentes, archivos y nombres con comodines', () => {
    expect(reason('relativa')).toBe('not-absolute')
    expect(reason(join(home, 'no-existe'))).toBe('missing')
    writeFileSync(join(home, 'a.txt'), 'x')
    expect(reason(join(home, 'a.txt'))).toBe('not-folder')
    expect(reason(join(home, 'facturas', '*'))).toBe('has-wildcards')
  })
  it('rechaza la carpeta del proyecto, una dentro de él y una que lo contiene', () => {
    expect(reason(project)).toBe('same-as-project')
    expect(reason(join(project, 'dentro'))).toBe('inside-project')
    mkdirSync(join(home, 'grande', 'proyecto2'), { recursive: true })
    expect(checkLinkedFolder(join(home, 'grande'), { ...ctx, project: join(home, 'grande', 'proyecto2') })).toMatchObject({
      ok: false,
      reason: 'contains-project'
    })
  })
  it.skipIf(!posixOnly)('un enlace simbólico se resuelve: no sirve para colar una carpeta prohibida', () => {
    symlinkSync(join(home, '.ssh'), join(home, 'atajo'))
    expect(reason(join(home, 'atajo'))).toBe('secrets')
  })
  it.skipIf(!posixOnly)('carpetas del sistema', () => {
    expect(['system', 'root-or-home']).toContain(reason('/usr/bin'))
    expect(reason('/')).toBe('root-or-home')
  })
})
