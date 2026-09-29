import { describe, expect, it } from 'vitest'
import { nextVisibleVersion } from './useVisibleFsVersion'

describe('nextVisibleVersion', () => {
  it('visible: sigue a la versión actual', () => {
    expect(nextVisibleVersion(3, 3, false)).toBe(3)
    expect(nextVisibleVersion(3, 7, false)).toBe(7)
  })
  it('oculta: congela la versión previa aunque la actual avance', () => {
    expect(nextVisibleVersion(3, 7, true)).toBe(3)
    expect(nextVisibleVersion(3, 3, true)).toBe(3)
  })
  it('secuencia oculta → visible: una sola actualización al volver, a la última versión', () => {
    let shown = 5
    for (const current of [6, 7, 8]) shown = nextVisibleVersion(shown, current, true)
    expect(shown).toBe(5)
    shown = nextVisibleVersion(shown, 8, false)
    expect(shown).toBe(8)
  })
})
