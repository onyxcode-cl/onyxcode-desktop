import { describe, expect, it } from 'vitest'
import { displayTitle, isPlaceholderTitle } from './session-title'

describe('título provisorio de sesión', () => {
  it('reconoce los nombres que pone el motor antes de generar el título', () => {
    for (const t of [
      'New session - 2026-10-18T13:40:00.000Z',
      'Child session - 2026-10-18T13:40:00Z',
      ' new session - 2026-01-01T00:00:00.1Z ',
      '',
      null,
      undefined
    ])
      expect(isPlaceholderTitle(t)).toBe(true)
  })
  it('no confunde títulos reales', () => {
    for (const t of ['New session ideas', 'Receta de pan', 'New session - sin fecha', 'Mi new session - 2026-10-18T13:40:00.000Z'])
      expect(isPlaceholderTitle(t)).toBe(false)
  })
  it('displayTitle usa el texto de respaldo solo con título provisorio', () => {
    expect(displayTitle('New session - 2026-10-18T13:40:00.000Z', 'Nueva conversación')).toBe('Nueva conversación')
    expect(displayTitle('Receta', 'Nueva conversación')).toBe('Receta')
  })
})
