import { describe, expect, it } from 'vitest'
import { en } from './en'
import { es } from './es'

// Restos de las pruebas de la 1.8.12: textos que decían algo falso o no cabían.
describe('textos del menú de modos y de Ajustes (1.8.12)', () => {
  it('la nota del menú de modos ya no dice que los conectores actúan sin avisar', () => {
    for (const d of [es, en]) {
      const n = String(d['code.mode.note'])
      expect(n).not.toMatch(/sin avisar|without asking/i)
    }
    expect(es['code.mode.note']).toMatch(/preguntan antes de usarse/)
    expect(es['code.mode.note']).toContain('Sin preguntar en Code')
    expect(en['code.mode.note']).toMatch(/ask before they are used/)
    expect(en['code.mode.note']).toContain('Don’t ask in Code')
  })

  it('la entrada del menú lateral de Ajustes cabe (una palabra); el título de la página conserva el nombre largo', () => {
    expect(es['settings.engine.nav']!.length).toBeLessThanOrEqual(14)
    expect(en['settings.engine.nav']!.length).toBeLessThanOrEqual(14)
    expect(es['settings.engine.title']).toBe('Funciones experimentales')
  })
})
