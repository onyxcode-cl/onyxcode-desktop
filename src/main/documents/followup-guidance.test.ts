import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** Guardias de instrucciones: no miden obediencia del modelo, evitan reintroducir el flujo contradictorio. */
describe('quinta ronda: instrucciones de seguimiento de documentos', () => {
  it.each(['docx', 'pptx'])('%s propone fotos pertinentes aunque no se pidan y conserva su flujo', (kind) => {
    const guide = readFileSync(`resources/opencode/skills/${kind}/SKILL.md`, 'utf8')
    expect(guide).toContain('promocionales, infantiles, de turismo o de producto')
    expect(guide).toContain('aunque no las pidan, siguiendo este flujo de fotos libres')
    expect(guide).toContain('si no hay una buena, continúa sin foto')
    expect(guide).toContain('`documentos_imagenes_buscar` → `documentos_imagenes_ver` → `documentos_imagenes_usar`')
  })

  it.each(['docx', 'pptx', 'pdf'])('%s usa el original para exportar y no pide controlar el equipo', (kind) => {
    const guide = readFileSync(`resources/opencode/skills/${kind}/SKILL.md`, 'utf8')
    expect(guide).toContain('documentos_exportar_pdf')
    expect(guide).toContain('exporta el original, no lo reconstruyas como un resumen HTML')
    expect(guide).toContain('fotos y el número de páginas')
    expect(guide).toContain('no requiere `computer_request_access`')
    expect(guide).toContain('avisa al principio de la respuesta, antes del enlace')
    expect(guide).toContain('Versión parcial: falta…')
  })

  it.each([
    'resources/opencode/agents/chat.md',
    'resources/opencode/agents/tasks.md',
    ...['docx', 'pptx', 'pdf'].map((kind) => `resources/opencode/skills/${kind}/SKILL.md`),
    'src/main/opencode/config.ts',
    'src/main/opencode/code-docs-prompt.ts'
  ])('%s deja los créditos a pedido de la persona', (path) => {
    const guide = readFileSync(path, 'utf8')
    expect(guide).toContain('No agregues créditos ni pies de foto salvo que la persona los pida')
    expect(guide).not.toMatch(/44 px inferiores|crédito visible|crédito legible|créditos legibles|ruta y crédito|fotos, (?:los )?créditos/)
  })

  it('el cierre obligatorio permite avisar de lo perdido antes de enumerar entregables', () => {
    const guide = readFileSync('resources/opencode/agents/tasks.md', 'utf8')
    expect(guide).toContain('documentos_exportar_pdf')
    expect(guide).toContain('no requiere `computer_request_access`')
    expect(guide).toContain('sustituye este inicio por **Versión parcial:**')
    expect(guide).toContain('di qué falta antes de los entregables')
  })
})
