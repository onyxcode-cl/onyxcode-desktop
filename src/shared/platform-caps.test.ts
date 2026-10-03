import { describe, expect, it } from 'vitest'
import { REMOTE_SURFACE, capsFor, modeAvailable, usableMode } from './platform-caps'

/** Mac y Windows conservan terminal, diálogos nativos, enlaces externos y vista nativa del navegador. */
const NATIVE = { terminal: true, nativeDialogs: true, openExternal: true, nativeBrowser: true }

describe('capsFor', () => {
  it('macOS tiene Tareas, Control del PC y actualizador', () => {
    expect(capsFor('darwin')).toEqual({ ...NATIVE, tasks: true, computer: true, updater: true, keepAwakeText: true, remote: true })
  })
  it.each(['win32', 'linux', 'freebsd'])('%s no tiene ninguna de las funciones de macOS', (p) => {
    expect(capsFor(p)).toEqual({ ...NATIVE, tasks: false, computer: false, updater: false, keepAwakeText: false, remote: false })
  })
})

describe('superficie remote (PWA del celular)', () => {
  it('sin terminal, diálogos nativos, enlaces externos, vista nativa, actualizador, Control del PC ni ajustes del puente', () => {
    expect(capsFor(REMOTE_SURFACE)).toEqual({
      tasks: true,
      computer: false,
      updater: false,
      keepAwakeText: false,
      remote: false,
      terminal: false,
      nativeDialogs: false,
      openExternal: false,
      nativeBrowser: false
    })
  })
  it('Tareas disponible; un modo guardado sigue siendo usable', () => {
    expect(modeAvailable('tasks', REMOTE_SURFACE)).toBe(true)
    expect(usableMode('tasks', REMOTE_SURFACE)).toBe('tasks')
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
