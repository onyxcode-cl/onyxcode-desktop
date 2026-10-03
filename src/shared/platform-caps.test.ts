import { describe, expect, it } from 'vitest'
import { capsFor, modeAvailable, usableMode } from './platform-caps'

describe('capsFor', () => {
  it('macOS tiene Tareas, Control del PC y actualizador', () => {
    expect(capsFor('darwin')).toEqual({ tasks: true, computer: true, updater: true, keepAwakeText: true, remote: true })
  })
  it.each(['win32', 'linux', 'freebsd'])('%s no tiene ninguna de las funciones de macOS', (p) => {
    expect(capsFor(p)).toEqual({ tasks: false, computer: false, updater: false, keepAwakeText: false, remote: false })
  })
})

describe('modos disponibles', () => {
  it('Tareas solo en macOS', () => {
    expect(modeAvailable('tasks', 'darwin')).toBe(true)
    expect(modeAvailable('tasks', 'win32')).toBe(false)
    for (const m of ['chat', 'code', 'routines']) expect(modeAvailable(m, 'win32')).toBe(true)
  })
  it('un modo Tareas guardado en Windows cae a Chat', () => {
    expect(usableMode('tasks', 'win32')).toBe('chat')
    expect(usableMode('code', 'win32')).toBe('code')
    expect(usableMode('tasks', 'darwin')).toBe('tasks')
  })
})
