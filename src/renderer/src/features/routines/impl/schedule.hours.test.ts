/** F8-B94 / L5: en español la hora de las rutinas va en 24 h, sin «a. m.» ni «p. m.». */
import { afterEach, describe, expect, it } from 'vitest'
import { setLang } from '@shared/i18n'
import { fullDate, untilText } from './schedule'

afterEach(() => setLang('es'))

describe('hora de 24 h en español', () => {
  const now = new Date(2026, 9, 5, 10, 0).getTime()
  it('untilText lejano', () => {
    setLang('es')
    for (const [h, m] of [
      [9, 0],
      [14, 30],
      [21, 5]
    ]) {
      const ts = new Date(2026, 9, 20, h, m).getTime()
      const out = untilText(ts, now)
      expect(out).toContain(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
      expect(out).not.toMatch(/[ap]\. ?m\./i)
    }
  })
  it('fullDate sin a. m./p. m.', () => {
    setLang('es')
    expect(fullDate(new Date(2026, 9, 20, 21, 5).getTime())).toContain('21:05')
  })
})
