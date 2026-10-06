import { describe, expect, it } from 'vitest'
import { DICTIONARIES, type Msg } from '../shared/i18n'

/**
 * Guardia de textos de atajos en Windows: todo texto es/en que nombre una tecla del Mac (⌘ ⌥ ⌃) debe tener su variante `.win`
 * (`platformKey` la usa en win32). Solo se admiten claves SOLO del Mac, listadas y justificadas abajo.
 */
const MAC_GLYPHS = /[⌘⌥⌃]/

/**
 * Claves con glifos del Mac que nunca se muestran en Windows. Tareas SÍ existe en Windows (con la bandera `tasksWin`), así que
 * ya no se exime por prefijo: solo estas claves de Control total / Control del PC (que Windows no ofrece sin `computer`).
 */
const MAC_ONLY_KEYS: ReadonlyArray<{ key: string; why: string }> = [
  { key: 'tasksComputer.banner.shortcutOff', why: 'Atajo global de parada de Control total (solo con Control del PC)' },
  { key: 'tasksComputer.banner.shortcutNA', why: 'Atajo global de parada de Control total (solo con Control del PC)' },
  { key: 'tasksComputer.onb.tip5', why: 'Consejo de Control total: la guía de primer uso lo omite sin `caps.computer`' },
  { key: 'tasks.home.lead.full', why: 'Texto del modo Control total (el selector no existe sin `caps.computer`)' }
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
        .filter(([k]) => !MAC_ONLY_KEYS.some((p) => p.key === k))
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
    for (const { key } of MAC_ONLY_KEYS) expect(key in DICTIONARIES.es, key).toBe(true)
  })
})
