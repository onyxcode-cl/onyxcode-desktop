import { describe, expect, it } from 'vitest'
import { CV_RECENT, isOldRow, withCv } from './cv'

describe('content-visibility de filas (F7-B46)', () => {
  it('las últimas CV_RECENT filas nunca son antiguas; las anteriores sí', () => {
    const total = 20
    for (let i = 0; i < total; i++) expect(isOldRow(i, total)).toBe(i < total - CV_RECENT)
    expect(isOldRow(0, CV_RECENT)).toBe(false) // una lista corta no lleva la clase en ninguna fila
    expect(isOldRow(total - 1, total)).toBe(false)
  })
  it('toda fila lleva `turn-row` (recuerda su alto real); solo las antiguas llevan `turn-cv`', () => {
    expect(withCv('a b', false)).toBe('a b turn-row')
    expect(withCv('a b', true)).toBe('a b turn-row turn-cv')
    expect(withCv('a b', true, true)).toBe('a b turn-row turn-cv turn-cv-pad')
    expect(withCv('a b', false, true)).toBe('a b turn-row turn-cv-pad')
  })
})
