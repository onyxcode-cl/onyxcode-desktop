import { sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isInside } from './paths'

/** Copia literal de la versión privada que tenía cowork/folder-policy.ts (para demostrar equivalencia). */
function legacyPolicyIsInside(f: string, dir: string): boolean {
  return f === dir || f.startsWith(dir === '/' ? '/' : dir + sep)
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
