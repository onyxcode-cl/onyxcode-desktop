import { describe, expect, it } from 'vitest'
import { THEME_PREF_KEY, readThemePref, writeThemePref } from './theme-pref'

const mem = (init: Record<string, string> = {}): Storage => {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } as unknown as Storage
}
const throwing = (): Storage =>
  ({
    getItem: () => {
      throw new Error('bloqueado')
    },
    setItem: () => {
      throw new Error('bloqueado')
    }
  }) as unknown as Storage

describe('theme-pref', () => {
  it('lee solo light o dark', () => {
    expect(readThemePref(mem({ [THEME_PREF_KEY]: 'dark' }))).toBe('dark')
    expect(readThemePref(mem({ [THEME_PREF_KEY]: 'light' }))).toBe('light')
    expect(readThemePref(mem({ [THEME_PREF_KEY]: 'system' }))).toBeNull()
    expect(readThemePref(mem())).toBeNull()
    expect(readThemePref(null)).toBeNull()
  })
  it('escribe valores válidos y rechaza los demás', () => {
    const s = mem()
    expect(writeThemePref(s, 'dark')).toBe(true)
    expect(readThemePref(s)).toBe('dark')
    expect(writeThemePref(s, 'rojo')).toBe(false)
    expect(readThemePref(s)).toBe('dark')
  })
  it('tolera un almacenamiento que lanza', () => {
    expect(readThemePref(throwing())).toBeNull()
    expect(writeThemePref(throwing(), 'light')).toBe(false)
  })
})
