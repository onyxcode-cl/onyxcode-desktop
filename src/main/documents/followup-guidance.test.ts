import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** Guardias de instrucciones: no miden obediencia del modelo, evitan reintroducir el flujo contradictorio. */
describe('quinta ronda: instrucciones de seguimiento de documentos', () => {
  it.each(['docx', 'pptx'])('%s propone fotos pertinentes aunque no se pidan y conserva su flujo y crédito', (kind) => {
    const guide = readFileSync(`resources/opencode/skills/${kind}/SKILL.md`, 'utf8')
    expect(guide).toContain('promocionales, infantiles, de turismo o de producto')
    expect(guide).toContain('aunque no las pidan, siguiendo este flujo de fotos libres con crédito')
    expect(guide).toContain('si no hay una buena, continúa sin foto')
    expect(guide).toContain('`documentos_imagenes_buscar` → `documentos_imagenes_ver` → `documentos_imagenes_usar`')
  })

  it.each(['docx', 'pptx', 'pdf'])('%s usa el original para exportar y no pide controlar el equipo', (kind) => {
    const guide = readFileSync(`resources/opencode/skills/${kind}/SKILL.md`, 'utf8')
    expect(guide).toContain('documentos_exportar_pdf')
    expect(guide).toContain('exporta el original, no lo reconstruyas como un resumen HTML')
    expect(guide).toContain('fotos, los créditos y el número de páginas')
    expect(guide).toContain('no requiere `computer_request_access`')
    expect(guide).toContain('avisa al principio de la respuesta, antes del enlace')
    expect(guide).toContain('Versión parcial: falta…')
  })

  it('el cierre obligatorio permite avisar de lo perdido antes de enumerar entregables', () => {
    const guide = readFileSync('resources/opencode/agents/tasks.md', 'utf8')
    expect(guide).toContain('documentos_exportar_pdf')
    expect(guide).toContain('no requiere `computer_request_access`')
    expect(guide).toContain('sustituye este inicio por **Versión parcial:**')
    expect(guide).toContain('di qué falta antes de los entregables')
  })
})
