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
      computerBackend: 'ax',
      updater: true,
      keepAwakeText: true,
      quickLook: true,
      remote: true,
      docViewer: true,
      translatePdf: true
    })
  })
  it('win32 no tiene ninguna de las funciones de macOS (Tareas apagada; sandbox previsto: wsl)', () => {
    expect(capsFor('win32')).toEqual({
      ...NATIVE,
      tasks: false,
      tasksSandbox: 'wsl',
      computer: false,
      computerBackend: 'none',
      updater: true,
      keepAwakeText: false,
      quickLook: false,
      remote: false,
      docViewer: false,
      translatePdf: false
    })
  })
  it.each(['linux', 'freebsd'])('%s no tiene ninguna de las funciones de macOS', (p) => {
    expect(capsFor(p)).toEqual({
      ...NATIVE,
      tasks: false,
      tasksSandbox: 'none',
      computer: false,
      computerBackend: 'none',
      updater: false,
      keepAwakeText: false,
      quickLook: false,
      remote: false,
      docViewer: false,
      translatePdf: false
    })
  })
  it('docViewer sigue exactamente a tasks en Mac/Windows/Linux (misma condición: lo necesita la ventana nativa de Tareas)', () => {
    for (const p of ['darwin', 'win32', 'linux']) {
      for (const tasksWin of [undefined, false, true]) {
        const c = capsFor(p, { tasksWin })
        expect(c.docViewer).toBe(c.tasks)
      }
    }
  })
  it('docViewer es siempre false en el celular, aunque tasks sea true', () => {
    const c = capsFor(REMOTE_SURFACE)
    expect(c.tasks).toBe(true)
    expect(c.docViewer).toBe(false)
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
  it('la bandera solo afecta a Tareas (y docViewer, que la sigue): lo demás de win32 no cambia', () => {
    const { tasks: _a, docViewer: _c, ...off } = capsFor('win32')
    const { tasks: _b, docViewer: _d, ...on } = capsFor('win32', { tasksWin: true })
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
    darwin: {
      tasks: true,
      tasksSandbox: 'seatbelt',
      computer: true,
      computerBackend: 'ax',
      updater: true,
      keepAwakeText: true,
      remote: true,
      docViewer: true,
      translatePdf: true
    },
    win32: {
      tasks: false,
      tasksSandbox: 'wsl',
      computer: false,
      computerBackend: 'none',
      updater: true, // actualizador de Windows (plan win-D): antes apagado
      keepAwakeText: false,
      remote: false,
      docViewer: false,
      translatePdf: false
    }
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
  it('encender tasksWin en darwin no cambia nada; en win32 cambia tasks y docViewer (quickLook sigue apagado)', () => {
    expect(capsFor('darwin', { tasksWin: true })).toEqual(capsFor('darwin'))
    const on = capsFor('win32', { tasksWin: true })
    expect(on.tasks).toBe(true)
    expect(on.docViewer).toBe(true)
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
      computerBackend: 'none',
      updater: false,
      keepAwakeText: false,
      quickLook: false,
      remote: false,
      terminal: false,
      nativeDialogs: false,
      openExternal: false,
      nativeBrowser: false,
      docViewer: false,
      translatePdf: false
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

describe('bandera de producto computerWin (apagada por defecto) y computerBackend', () => {
  it('matriz plataforma x tasksWin x computerWin: solo win32 con AMBAS banderas enciende Control del PC (uia)', () => {
    const rows: Array<[string, boolean | undefined, boolean | undefined, boolean, string]> = [
      ['darwin', undefined, undefined, true, 'ax'],
      ['darwin', false, false, true, 'ax'],
      ['darwin', true, true, true, 'ax'],
      ['win32', undefined, undefined, false, 'none'],
      ['win32', true, undefined, false, 'none'],
      ['win32', true, false, false, 'none'],
      ['win32', undefined, true, false, 'none'],
      ['win32', false, true, false, 'none'],
      ['win32', true, true, true, 'uia'],
      ['linux', true, true, false, 'none'],
      [REMOTE_SURFACE, true, true, false, 'none']
    ]
    for (const [platform, tasksWin, computerWin, computer, backend] of rows) {
      const caps = capsFor(platform, { tasksWin, computerWin })
      expect([platform, tasksWin, computerWin, caps.computer, caps.computerBackend]).toEqual([
        platform,
        tasksWin,
        computerWin,
        computer,
        backend
      ])
    }
  })
  it('computerBackend es none siempre que computer sea false (derivado coherente)', () => {
    for (const p of ['darwin', 'win32', 'linux', REMOTE_SURFACE]) {
      for (const tasksWin of [undefined, false, true]) {
        for (const computerWin of [undefined, false, true]) {
          const c = capsFor(p, { tasksWin, computerWin })
          expect(c.computer === (c.computerBackend !== 'none')).toBe(true)
        }
      }
    }
  })
  it('un valor no booleano no enciende Control del PC (fail closed)', () => {
    expect(capsFor('win32', { tasksWin: true, computerWin: 'si' as unknown as boolean }).computer).toBe(false)
  })
  it('computerWin con tasksWin apagada o sola no cambia nada en win32 ni en darwin', () => {
    expect(capsFor('win32', { computerWin: true })).toEqual(capsFor('win32'))
    expect(capsFor('darwin', { tasksWin: true, computerWin: true })).toEqual(capsFor('darwin'))
  })
  it('encender computerWin (con tasksWin) solo cambia computer y computerBackend en win32', () => {
    const { computer: _a, computerBackend: _b, ...off } = capsFor('win32', { tasksWin: true })
    const { computer: _c, computerBackend: _d, ...on } = capsFor('win32', { tasksWin: true, computerWin: true })
    expect(on).toEqual(off)
  })
})
