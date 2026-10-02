import { sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isWin } from '../../test/platform'
import { isInside } from './paths'

/** Copia literal de la versión privada que tenía tasks/folder-policy.ts (para demostrar equivalencia). */
function legacyPolicyIsInside(f: string, dir: string): boolean {
  const s = isWin ? '/' : sep
  return f === dir || f.startsWith(dir === '/' ? '/' : dir + s)
}

describe('isInside', () => {
  it('casos básicos', () => {
    expect(isInside('/a/b', '/a/b')).toBe(true)
    expect(isInside('/a/b/c', '/a/b')).toBe(true)
    expect(isInside('/a/bc', '/a/b')).toBe(false)
    expect(isInside('/a', '/a/b')).toBe(false)
  })
  it('barra final en dir', () => {
    expect(isInside('/a/b/c', '/a/b/')).toBe(true)
    expect(isInside('/a/b', '/a/b/')).toBe(true)
    expect(isInside('/a/bc', '/a/b/')).toBe(false)
  })
  it('la raíz contiene todo', () => {
    expect(isInside('/', '/')).toBe(true)
    expect(isInside('/a/b', '/')).toBe(true)
  })
  it('no interpreta `..` (comparación léxica)', () => {
    expect(isInside('/a/b/../c', '/a/b')).toBe(true)
    // léxico: no colapsa el `..`; quien necesite confianza debe hacer resolve() antes
    expect(isInside('/a/b/..', '/a/b')).toBe(true)
  })
  it('equivale a la versión de folder-policy para rutas normalizadas (sin barra final salvo raíz)', () => {
    const paths = ['/', '/a', '/a/b', '/a/b/c', '/a/bc', '/a/b/../c', '/a/b/..', '/x']
    for (const f of paths) for (const d of paths) expect(isInside(f, d), `${f} in ${d}`).toBe(legacyPolicyIsInside(f, d))
  })
})

describe('isInside en Windows', () => {
  const w = (p: string, d: string): boolean => isInside(p, d, 'win32')
  it('trata \\ y / igual y no distingue mayúsculas ni letra de unidad', () => {
    expect(w('C:\\Users\\X\\repo\\src', 'c:/users/x/REPO')).toBe(true)
    expect(w('C:\\Users\\X\\repo2', 'C:\\Users\\X\\repo')).toBe(false)
    expect(w('C:\\Users\\X\\repo', 'C:\\Users\\X\\repo\\')).toBe(true)
  })
  it('la raíz de unidad contiene su árbol y no otra unidad', () => {
    expect(w('C:\\a\\b', 'C:\\')).toBe(true)
    expect(w('D:\\a', 'C:\\')).toBe(false)
  })
})
