/**
 * Reglas «permitir siempre» demasiado amplias: un patrón que solo tiene comodines (`*`, `?`, `**`, `?*`, `* *`) equivale a «todo». Un
 * programa de la tarea puede escribir el JSON de `permisos-siempre` en su carpeta privada; la app lo limpia antes de que el motor lo cargue.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/no/se/usa' } }))

import { ensurePermissionDir, isPersistableRule, isWildcardOnly, sanitizeSavedPermissions } from './permission-store'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'lazunox-permrules-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const WILD = ['*', '?', '**', '?*', '*?', '* *', ' * ', '***', '?? ', '\t*']

describe('isWildcardOnly / isPersistableRule', () => {
  it.each(WILD)('«%s» es solo comodines', (p) => expect(isWildcardOnly(p)).toBe(true))
  it.each(['git status *', 'ls', 'npm run *', '*.md', '/Users/x/*'])('«%s» no es solo comodines', (p) =>
    expect(isWildcardOnly(p)).toBe(false)
  )

  it.each(WILD)('bash con «%s» NO se guarda ni se carga', (pattern) => {
    expect(isPersistableRule({ permission: 'bash', pattern })).toBe(false)
    expect(isPersistableRule({ permission: 'read', pattern })).toBe(false)
  })

  it('patrones concretos de bash sí', () => {
    expect(isPersistableRule({ permission: 'bash', pattern: 'git status *' })).toBe(true)
    expect(isPersistableRule({ permission: 'bash', pattern: 'npm test' })).toBe(true)
  })

  it('herramienta de un conector: solo el `*` exacto (la forma normal de su «siempre»), no `**` ni `?*`', () => {
    expect(isPersistableRule({ permission: 'crm_get_contact', pattern: '*' })).toBe(true)
    expect(isPersistableRule({ permission: 'crm_get_contact', pattern: '**' })).toBe(false)
    expect(isPersistableRule({ permission: 'crm_get_contact', pattern: '?*' })).toBe(false)
    // `shell_wait`, `apply_patch`… son propias aunque lleven guion bajo.
    expect(isPersistableRule({ permission: 'shell_wait', pattern: '*' })).toBe(false)
    expect(isPersistableRule({ permission: 'apply_patch', pattern: '*' })).toBe(false)
  })

  it('el NOMBRE del permiso no puede llevar comodines (el motor también lo compara con comodines)', () => {
    for (const permission of ['*', 'b*', 'edi?', '*_*', 'bash ']) {
      expect(isPersistableRule({ permission, pattern: 'git status' })).toBe(false)
      expect(isPersistableRule({ permission, pattern: '*' })).toBe(false)
    }
  })

  it('formas raras: no es objeto, vacíos, saltos de línea', () => {
    for (const r of [null, 'bash', 1, {}, { permission: 'bash' }, { permission: '', pattern: 'ls' }, { permission: 'bash', pattern: '' }])
      expect(isPersistableRule(r)).toBe(false)
    expect(isPersistableRule({ permission: 'bash', pattern: 'ls\nrm -rf x' })).toBe(false)
  })
})

describe('sanitizeSavedPermissions (al cargar lo ya guardado)', () => {
  const file = (d: string, rules: unknown[]): string => {
    const f = join(d, 'abc.json')
    writeFileSync(f, JSON.stringify({ directory: '/Users/x/p', rules }))
    return f
  }

  it('quita las reglas de solo comodines y deja las buenas y el resto del archivo', () => {
    const d = tmp()
    const f = file(d, [
      { permission: 'bash', pattern: '?*' },
      { permission: 'bash', pattern: 'git status *' },
      { permission: 'bash', pattern: '**' },
      { permission: '*', pattern: '*' },
      { permission: 'crm_get_contact', pattern: '*' }
    ])
    expect(sanitizeSavedPermissions(d)).toBe(3)
    const j = JSON.parse(readFileSync(f, 'utf8'))
    expect(j.directory).toBe('/Users/x/p')
    expect(j.rules).toEqual([
      { permission: 'bash', pattern: 'git status *' },
      { permission: 'crm_get_contact', pattern: '*' }
    ])
    expect(sanitizeSavedPermissions(d)).toBe(0)
  })

  it('también la carpeta general', () => {
    const d = tmp()
    const f = file(d, [{ permission: 'edit', pattern: '*' }])
    ensurePermissionDir(d)
    expect(JSON.parse(readFileSync(f, 'utf8')).rules).toEqual([])
  })

  it('borra (sin seguirlos) enlaces, carpetas y JSON que no son de reglas; el destino de un enlace no cambia', () => {
    const d = tmp()
    writeFileSync(join(d, 'roto.json'), '{no es json')
    writeFileSync(join(d, 'sinreglas.json'), '{"directory":"/x"}')
    writeFileSync(join(d, 'otro.txt'), 'x')
    mkdirSync(join(d, 'sub.json'))
    expect(sanitizeSavedPermissions(d)).toBe(3)
    expect(readdirSync(d).sort()).toEqual(['otro.txt'])
    if (process.platform === 'win32') return
    const fuera = tmp()
    const target = join(fuera, 'fuera.json')
    const original = JSON.stringify({ directory: '/x', rules: [{ permission: 'bash', pattern: '*' }] })
    writeFileSync(target, original)
    // La tarea deja `<huella>.json` → un archivo suyo con reglas amplias: el motor lo seguiría; la limpieza borra el enlace.
    symlinkSync(target, join(d, 'abc.json'))
    symlinkSync(fuera, join(d, 'carpeta-enlace'))
    expect(sanitizeSavedPermissions(d)).toBe(2)
    expect(readdirSync(d).sort()).toEqual(['otro.txt'])
    expect(readFileSync(target, 'utf8')).toBe(original)
    // Una carpeta que es un enlace tampoco se recorre .
    const linkDir = join(tmp(), 'permisos')
    symlinkSync(fuera, linkDir)
    expect(sanitizeSavedPermissions(linkDir)).toBe(0)
    expect(readFileSync(target, 'utf8')).toBe(original)
  })
})
