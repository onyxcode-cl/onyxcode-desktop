import { afterEach, describe, expect, it } from 'vitest'
import { exceededSlop, longPressAllowed } from './use-long-press'

describe('exceededSlop', () => {
  it('hasta 10 px no cancela; más, sí', () => {
    expect(exceededSlop(0, 0)).toBe(false)
    expect(exceededSlop(6, 8)).toBe(false) // 10 exacto
    expect(exceededSlop(8, 8)).toBe(true)
    expect(exceededSlop(0, -11)).toBe(true)
  })
  it('respeta un margen distinto', () => {
    expect(exceededSlop(15, 0, 20)).toBe(false)
  })
})

describe('longPressAllowed', () => {
  afterEach(() => undefined)
  const el = (matches: boolean): EventTarget => ({ closest: () => (matches ? {} : null) }) as unknown as EventTarget
  it('ignora enlaces, código, tablas y controles', () => {
    expect(longPressAllowed(el(true))).toBe(false)
  })
  it('permite el resto de objetivos', () => {
    expect(longPressAllowed(el(false))).toBe(true)
    expect(longPressAllowed(null)).toBe(true)
  })
})
