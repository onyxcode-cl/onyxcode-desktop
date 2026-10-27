import { describe, expect, it } from 'vitest'
import { stripEscalationMarkers } from './escalation-markers'

describe('stripEscalationMarkers', () => {
  it('oculta NEEDS_APP, OPEN_FOLDER y NEEDS_FULL_CONTROL, con su decoración markdown', () => {
    expect(stripEscalationMarkers('Necesito Notas.\n[[LAZUNOX:NEEDS_APP:Notas]]')).toBe('Necesito Notas.')
    expect(stripEscalationMarkers('Listo.\n**[[LAZUNOX:OPEN_FOLDER]]**\n')).toBe('Listo.')
    expect(stripEscalationMarkers('Hay que abrir Discord\n[[LAZUNOX:NEEDS_FULL_CONTROL]]')).toBe('Hay que abrir Discord')
    expect(stripEscalationMarkers('Motivo [[LAZUNOX:NEEDS_FULL_CONTROL]] breve')).toBe('Motivo  breve')
  })
  it('oculta un marcador a medio escribir al final (streaming) y no toca el texto normal', () => {
    expect(stripEscalationMarkers('Hola\n[[LAZUNOX:NEEDS_A')).toBe('Hola')
    expect(stripEscalationMarkers('Usa [[1]] como referencia')).toBe('Usa [[1]] como referencia')
    expect(stripEscalationMarkers('Sin marcadores')).toBe('Sin marcadores')
  })
})
