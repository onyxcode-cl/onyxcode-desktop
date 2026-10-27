import { describe, expect, it } from 'vitest'
import { parseEscalation } from './EscalateCard'
import { stripEscalationMarkers } from './escalation-markers'

describe('stripEscalationMarkers', () => {
  it('oculta el marcador de la última línea (NEEDS_APP, OPEN_FOLDER, NEEDS_FULL_CONTROL), con su decoración markdown', () => {
    expect(stripEscalationMarkers('Necesito Notas.\n[[LAZUNOX:NEEDS_APP:Notas]]')).toBe('Necesito Notas.')
    expect(stripEscalationMarkers('Listo.\n**[[LAZUNOX:OPEN_FOLDER]]\n')).toBe('Listo.')
    expect(stripEscalationMarkers('Hay que abrir Discord\n[[LAZUNOX:NEEDS_FULL_CONTROL]]\n\n')).toBe('Hay que abrir Discord')
  })
  it('un marcador citado (en medio de una línea, en un bloque de código o en línea) se ve tal cual', () => {
    expect(stripEscalationMarkers('Motivo [[LAZUNOX:NEEDS_FULL_CONTROL]] breve')).toBe('Motivo [[LAZUNOX:NEEDS_FULL_CONTROL]] breve')
    const inline = 'Para abrir la carpeta usa `[[LAZUNOX:OPEN_FOLDER]]` al final.\nListo.'
    expect(stripEscalationMarkers(inline)).toBe(inline)
    const fenced = 'Ejemplo:\n```\n[[LAZUNOX:OPEN_FOLDER]]\n```\nListo.'
    expect(stripEscalationMarkers(fenced)).toBe(fenced)
    expect(stripEscalationMarkers('[[LAZUNOX:OPEN_FOLDER]]\nmás texto')).toBe('[[LAZUNOX:OPEN_FOLDER]]\nmás texto')
    const lastInline = 'Usa\n`[[LAZUNOX:OPEN_FOLDER]]`'
    expect(stripEscalationMarkers(lastInline)).toBe(lastInline)
  })
  it('el recorte de un marcador a medio escribir solo ocurre en streaming', () => {
    expect(stripEscalationMarkers('Hola\n[[LAZUNOX:NEEDS_A', true)).toBe('Hola')
    expect(stripEscalationMarkers('Hola [[LAZUNOX', true)).toBe('Hola')
    expect(stripEscalationMarkers('Hola\n[[LAZ', true)).toBe('Hola')
    // Mensaje terminado que acaba en «[[LAZUNOX»: es texto del agente, no se toca.
    expect(stripEscalationMarkers('El prefijo es [[LAZUNOX')).toBe('El prefijo es [[LAZUNOX')
    expect(stripEscalationMarkers('Hola\n[[LAZUNOX:NEEDS_A')).toBe('Hola\n[[LAZUNOX:NEEDS_A')
    expect(stripEscalationMarkers('Usa [[1]] como referencia', true)).toBe('Usa [[1]] como referencia')
    expect(stripEscalationMarkers('Sin marcadores')).toBe('Sin marcadores')
  })
  it('lo oculto coincide con lo que parseEscalation lee', () => {
    const cases = [
      'Motivo.\n[[LAZUNOX:OPEN_FOLDER]]',
      'Motivo.\n**[[LAZUNOX:NEEDS_APP:Notas]]**',
      'Motivo.\n[[LAZUNOX:NEEDS_FULL_CONTROL]]',
      'Motivo [[LAZUNOX:NEEDS_FULL_CONTROL]] breve',
      'Usa `[[LAZUNOX:OPEN_FOLDER]]` aquí.\nListo.',
      'Motivo.\n`[[LAZUNOX:OPEN_FOLDER]]`',
      '```\n[[LAZUNOX:OPEN_FOLDER]]\n```',
      'Texto normal'
    ]
    for (const c of cases) {
      const hidden = stripEscalationMarkers(c) !== c
      if (hidden) expect(parseEscalation(c), c).not.toBeNull()
      if (parseEscalation(c)) expect(hidden, c).toBe(true)
    }
  })
})
