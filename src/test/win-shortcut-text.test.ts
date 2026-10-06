import { describe, expect, it } from 'vitest'
import { DICTIONARIES, type Msg } from '../shared/i18n'

/**
 * Guardia de textos de atajos en Windows: todo texto es/en que nombre una tecla del Mac (⌘ ⌥ ⌃) debe tener su variante `.win`
 * (`platformKey` la usa en win32). Solo se admiten claves SOLO del Mac, listadas y justificadas abajo.
 */
const MAC_GLYPHS = /[⌘⌥⌃]/

/** Prefijos de claves que nunca se muestran en Windows (funciones solo del Mac: Tareas y Control del PC). */
const MAC_ONLY_PREFIXES: ReadonlyArray<{ prefix: string; why: string }> = [
  { prefix: 'tasks.', why: 'Tareas no existe en Windows: platform-caps la desactiva y la pantalla no se monta' },
  { prefix: 'tasksComputer.', why: 'Control del PC (Computer Use) es solo macOS: sus textos no se muestran en Windows' }
]

function texts(m: Msg): string[] {
  return typeof m === 'string' ? [m] : Object.values(m).filter((v): v is string => typeof v === 'string')
}

describe('textos con ⌘⌥⌃ y su variante .win', () => {
  for (const lang of ['es', 'en'] as const) {
    it(`${lang}: toda clave con glifos del Mac tiene .win (salvo las solo-Mac)`, () => {
      const dict = DICTIONARIES[lang]
      const missing = Object.entries(dict)
        .filter(([k, v]) => !k.endsWith('.win') && texts(v).some((s) => MAC_GLYPHS.test(s)))
        .filter(([k]) => !MAC_ONLY_PREFIXES.some((p) => k.startsWith(p.prefix)))
        .filter(([k]) => !(`${k}.win` in dict))
        .map(([k]) => k)
      expect(missing).toEqual([])
    })

    it(`${lang}: ninguna variante .win conserva glifos del Mac`, () => {
      const bad = Object.entries(DICTIONARIES[lang])
        .filter(([k, v]) => k.endsWith('.win') && texts(v).some((s) => MAC_GLYPHS.test(s)))
        .map(([k]) => k)
      expect(bad).toEqual([])
    })
  }

  it('las excepciones solo-Mac siguen existiendo (si no, se quitan de la lista)', () => {
    for (const { prefix } of MAC_ONLY_PREFIXES) {
      expect(
        Object.keys(DICTIONARIES.es).some((k) => k.startsWith(prefix)),
        prefix
      ).toBe(true)
    }
  })
})
