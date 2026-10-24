import { describe, expect, it } from 'vitest'
// @ts-expect-error módulo .mjs sin tipos (script del repositorio)
import { diferencias, leerManifiesto, archivosDeZonas } from '../../scripts/zonas-intocables-lib.mjs'

/**
 * Zonas intocables (AGENTS.md §7). Si esta prueba falla, un archivo de seguridad cambió sin dejar motivo:
 * revisa el cambio (idealmente con una revisión independiente) y regístralo con
 *   npm run zonas:actualizar -- "motivo del cambio en una frase"
 * El registro queda en docs/zonas-intocables.json (con fecha y archivos) y en el historial de git.
 */
describe('zonas intocables', () => {
  it('las zonas existen y no están vacías', () => {
    expect((archivosDeZonas() as string[]).length).toBeGreaterThan(15)
  })

  it('ningún archivo de seguridad cambió sin registrar el motivo', () => {
    const d = diferencias(leerManifiesto()) as { cambiados: string[]; nuevos: string[]; desaparecidos: string[] }
    const msg =
      'Cambiaron archivos de las zonas intocables sin registro. Revísalos y corre: npm run zonas:actualizar -- "motivo".\n' +
      JSON.stringify(d, null, 2)
    expect({ cambiados: d.cambiados, nuevos: d.nuevos, desaparecidos: d.desaparecidos }, msg).toEqual({
      cambiados: [],
      nuevos: [],
      desaparecidos: []
    })
  })
})
