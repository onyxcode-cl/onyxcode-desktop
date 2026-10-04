import { describe, expect, it } from 'vitest'
import { en, es } from '../../pwa/src/i18n'

/** `t()` de la capa ligera cae a `es` si falta una clave en `en` sin avisar: esta prueba lo impide. */
describe('pwa-i18n', () => {
  it('es y en tienen las mismas claves', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort())
  })

  it('ninguna cadena está vacía', () => {
    for (const [k, v] of [...Object.entries(es), ...Object.entries(en)]) expect(v.trim(), k).not.toBe('')
  })

  it('los marcadores {x} coinciden entre idiomas', () => {
    const vars = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const k of Object.keys(es)) expect(vars(en[k] ?? ''), k).toEqual(vars(es[k]))
  })
})
