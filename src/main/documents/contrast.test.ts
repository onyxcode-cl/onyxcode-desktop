import { describe, expect, it } from 'vitest'
import { contrastRatio, isLargeText, parseHex, requiredContrast } from './contrast'

describe('contraste WCAG', () => {
  it('negro sobre blanco es 21 a 1 y blanco sobre blanco 1 a 1', () => {
    expect(contrastRatio('000000', 'FFFFFF')).toBeCloseTo(21, 1)
    expect(contrastRatio('#ffffff', '#FFFFFF')).toBeCloseTo(1, 5)
  })
  it('valores conocidos: #777777 sobre blanco ≈ 4,48 (no llega a 4,5) y #767676 ≈ 4,54', () => {
    expect(contrastRatio('777777', 'FFFFFF')!).toBeLessThan(4.5)
    expect(contrastRatio('767676', 'FFFFFF')!).toBeGreaterThanOrEqual(4.5)
  })
  it('gris claro sobre blanco falla', () => {
    expect(contrastRatio('CCCCCC', 'FFFFFF')!).toBeLessThan(3)
  })
  it('colores desconocidos no se juzgan', () => {
    expect(parseHex('accent1')).toBeNull()
    expect(contrastRatio('accent1', 'FFFFFF')).toBeNull()
    expect(contrastRatio('000000', undefined)).toBeNull()
  })
  it('texto grande: desde 18 pt, o 14 pt en negrita', () => {
    expect(isLargeText(18, false)).toBe(true)
    expect(isLargeText(14, true)).toBe(true)
    expect(isLargeText(14, false)).toBe(false)
    expect(isLargeText(null, true)).toBe(false)
    expect(requiredContrast(24, false)).toBe(3)
    expect(requiredContrast(12, false)).toBe(4.5)
  })
})
