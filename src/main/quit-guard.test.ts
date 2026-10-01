import { describe, expect, it } from 'vitest'
import { needsQuitConfirmation } from './quit-guard'

describe('needsQuitConfirmation', () => {
  it('sin tareas en curso no pregunta', () => {
    expect(needsQuitConfirmation({ busyCount: 0, updating: false, systemShutdown: false })).toBe(0)
  })
  it('con tareas en curso devuelve cuántas', () => {
    expect(needsQuitConfirmation({ busyCount: 3, updating: false, systemShutdown: false })).toBe(3)
  })
  it('nunca bloquea al actualizador ni al apagado del sistema', () => {
    expect(needsQuitConfirmation({ busyCount: 2, updating: true, systemShutdown: false })).toBe(0)
    expect(needsQuitConfirmation({ busyCount: 2, updating: false, systemShutdown: true })).toBe(0)
  })
})
