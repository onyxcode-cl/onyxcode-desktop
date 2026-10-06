import { describe, expect, it } from 'vitest'
import { REMOTE_SURFACE, capsFor, type CapsFlags, modeAvailable, usableMode } from './platform-caps'

/** Mac y Windows conservan terminal, diálogos nativos, enlaces externos y vista nativa del navegador. */
const NATIVE = { terminal: true, nativeDialogs: true, openExternal: true, nativeBrowser: true }

describe('capsFor', () => {
  it('macOS tiene Tareas, Control del PC y actualizador', () => {
    expect(capsFor('darwin')).toEqual({
      ...NATIVE,
      tasks: true,
      tasksSandbox: 'seatbelt',
      computer: true,
      updater: true,
      keepAwakeText: true,
      quickLook: true,
      remote: true
    })
  })
  it('win32 no tiene ninguna de las funciones de macOS (Tareas apagada; sandbox previsto: wsl)', () => {
    expect(capsFor('win32')).toEqual({
      ...NATIVE,
      tasks: false,
      tasksSandbox: 'wsl',
      computer: false,
      updater: false,
      keepAwakeText: false,
      quickLook: false,
      remote: false
    })
  })
  it.each(['linux', 'freebsd'])('%s no tiene ninguna de las funciones de macOS', (p) => {
    expect(capsFor(p)).toEqual({
      ...NATIVE,
      tasks: false,
      tasksSandbox: 'none',
      computer: false,
      updater: false,
      keepAwakeText: false,
      quickLook: false,
      remote: false
    })
  })
})

describe('bandera de producto tasksWin (apagada por defecto)', () => {
  it('matriz plataforma x bandera: solo win32 con la bandera enciende Tareas; darwin y remoto no cambian', () => {
    const rows: Array<[string, boolean | undefined, boolean, string]> = [
      ['darwin', undefined, true, 'seatbelt'],
      ['darwin', true, true, 'seatbelt'],
      ['darwin', false, true, 'seatbelt'],
      ['win32', undefined, false, 'wsl'],
      ['win32', false, false, 'wsl'],
      ['win32', true, true, 'wsl'],
      ['linux', true, false, 'none'],
      [REMOTE_SURFACE, true, true, 'none'],
      [REMOTE_SURFACE, undefined, true, 'none']
    ]
    for (const [platform, tasksWin, tasks, sandbox] of rows) {
      const caps = capsFor(platform, { tasksWin })
      expect([platform, tasksWin, caps.tasks, caps.tasksSandbox]).toEqual([platform, tasksWin, tasks, sandbox])
    }
  })
  it('la bandera solo afecta a Tareas: lo demás de win32 no cambia', () => {
    const { tasks: _a, ...off } = capsFor('win32')
    const { tasks: _b, ...on } = capsFor('win32', { tasksWin: true })
    expect(on).toEqual(off)
  })
  it('un valor no booleano no enciende Tareas (fail closed)', () => {
    expect(capsFor('win32', { tasksWin: 'si' as unknown as boolean }).tasks).toBe(false)
  })
  it('modeAvailable/usableMode sin bandera: Tareas sigue cayendo a Chat en Windows', () => {
    expect(modeAvailable('tasks', 'win32')).toBe(false)
    expect(usableMode('tasks', 'win32')).toBe('chat')
  })
})

/**
 * Congelado del resultado ACTUAL con la bandera apagada (antes de W1): si cambia algo con `tasksWin` apagada en
 * macOS o Windows, esta matriz falla. `quickLook` es el único campo nuevo y vale exactamente `computer` (solo Mac).
 */
describe('bandera apagada: resultado idéntico al previo en macOS y Windows', () => {
  const PREVIOUS = {
    darwin: { tasks: true, tasksSandbox: 'seatbelt', computer: true, updater: true, keepAwakeText: true, remote: true },
    win32: { tasks: false, tasksSandbox: 'wsl', computer: false, updater: false, keepAwakeText: false, remote: false }
  } as const
  const OFF: Array<CapsFlags | undefined> = [undefined, {}, { tasksWin: false }]
  it.each(['darwin', 'win32'] as const)('%s: todas las formas de «apagada» dan el mismo objeto', (platform) => {
    for (const flags of OFF) {
      const caps = capsFor(platform, flags)
      const { quickLook, ...rest } = caps
      expect(rest).toEqual({ ...NATIVE, ...PREVIOUS[platform] })
      expect(quickLook).toBe(platform === 'darwin')
      expect(caps).toEqual(capsFor(platform))
    }
  })
  it('encender tasksWin en darwin no cambia nada; en win32 solo cambia tasks (quickLook sigue apagado)', () => {
    expect(capsFor('darwin', { tasksWin: true })).toEqual(capsFor('darwin'))
    const on = capsFor('win32', { tasksWin: true })
    expect(on.tasks).toBe(true)
    expect(on.quickLook).toBe(false)
    expect(on.computer).toBe(false)
  })
  it('modeAvailable/usableMode con bandera: solo win32 + tasksWin habilita Tareas', () => {
    expect(modeAvailable('tasks', 'win32', { tasksWin: true })).toBe(true)
    expect(usableMode('tasks', 'win32', { tasksWin: true })).toBe('tasks')
    expect(modeAvailable('tasks', 'win32', { tasksWin: false })).toBe(false)
    expect(usableMode('tasks', 'win32', {})).toBe('chat')
    expect(modeAvailable('tasks', 'linux', { tasksWin: true })).toBe(false)
  })
})

describe('superficie remote (PWA del celular)', () => {
  it('sin terminal, diálogos nativos, enlaces externos, vista nativa, actualizador, Control del PC ni ajustes del puente', () => {
    expect(capsFor(REMOTE_SURFACE)).toEqual({
      tasks: true,
      tasksSandbox: 'none',
      computer: false,
      updater: false,
      keepAwakeText: false,
      quickLook: false,
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
