import { describe, expect, it } from 'vitest'
import { capsFor } from './platform-caps'

describe('capsFor', () => {
  it('macOS tiene Tareas, Control del PC y actualizador', () => {
    expect(capsFor('darwin')).toEqual({ tasks: true, computer: true, updater: true, keepAwakeText: true })
  })
  it.each(['win32', 'linux', 'freebsd'])('%s no tiene ninguna de las funciones de macOS', (p) => {
    expect(capsFor(p)).toEqual({ tasks: false, computer: false, updater: false, keepAwakeText: false })
  })
})
