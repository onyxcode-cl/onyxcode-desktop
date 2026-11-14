import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** La descripción es compartida por Mac y Windows; esta guardia no prueba obediencia del modelo ni permisos. */
describe('guía de request_access: documentos no son una petición de controlar apps', () => {
  const source = readFileSync(join(__dirname, 'mcp-server.ts'), 'utf8')
  const start = source.indexOf("name: 'request_access'")
  const end = source.indexOf('action: false', start)
  const guidance = source.slice(start, end)

  it('distingue el trabajo en una carpeta del plan obligatorio de Control total', () => {
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    expect(guidance).toContain('En Tareas o Código dentro de una carpeta: úsala SOLO para controlar apps')
    expect(guidance).toContain('no la llames con "apps": [] para preparar archivos')
    expect(guidance).toContain('documentos_crear/documentos_renderizar no requiere esta herramienta')
    expect(guidance).toContain('Solo en Control total (fuera del modo de carpeta)')
    expect(guidance).not.toContain('llámala AL PRINCIPIO de cada tarea')
  })

  it('los argumentos apps y plan conservan la misma distinción sin un atajo contradictorio', () => {
    expect(guidance).toContain('En modo carpeta exige al menos una app; solo en Control total puede ser [] con "plan"')
    expect(guidance).toContain('Solo en Control total, nunca en modo carpeta')
    expect(guidance).not.toContain('Puede ser [] si envías "plan" y no controlas ninguna app')
  })
})
