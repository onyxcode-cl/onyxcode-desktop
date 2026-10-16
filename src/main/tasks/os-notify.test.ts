// Aviso del sistema de tareas: foco, tipos, interruptores, anti-duplicados y recorte del título.
import { describe, expect, it, vi } from 'vitest'
import { cleanTaskTitle, createOsNotifier, NOTIFY_DEDUPE_MS, NOTIFY_TITLE_MAX, type OsNotifyDeps } from './os-notify'
import type { MonitorNotifyEvent } from './monitor'

function setup(over: Partial<OsNotifyDeps> = {}) {
  const shown: Array<{ title: string; silent: boolean }> = []
  const clicks: Array<() => void> = []
  const open = vi.fn()
  let now = 1_000
  const notify = createOsNotifier({
    isSupported: () => true,
    create: (opts) => ({
      on: (_e, cb) => void clicks.push(cb),
      show: () => void shown.push(opts)
    }),
    appEnabled: () => true,
    tasksEnabled: () => true,
    silent: () => false,
    windowFocused: () => false,
    open,
    now: () => now,
    ...over
  })
  const ev = (o: Partial<MonitorNotifyEvent> = {}): MonitorNotifyEvent => ({
    kind: 'done',
    sessionId: 'ses_1',
    folder: '/Users/x/Proyecto',
    fullAccess: false,
    title: 'Resumen de ventas',
    ...o
  })
  return { notify, ev, shown, clicks, open, advance: (ms: number) => void (now += ms) }
}

describe('aviso del sistema de tareas', () => {
  it('con la ventana enfocada no avisa', () => {
    const s = setup({ windowFocused: () => true })
    s.notify(s.ev())
    expect(s.shown).toHaveLength(0)
  })

  it('sin foco y terminada: avisa una sola vez', () => {
    const s = setup()
    s.notify(s.ev())
    s.notify(s.ev())
    expect(s.shown).toEqual([{ title: 'Tarea terminada: Resumen de ventas', silent: false }])
    s.advance(NOTIFY_DEDUPE_MS)
    s.notify(s.ev())
    expect(s.shown).toHaveLength(2)
  })

  it('aprobación, pregunta y fallo tienen su texto y no se tapan entre sí', () => {
    const s = setup()
    s.notify(s.ev({ kind: 'approval', title: 'A' }))
    s.notify(s.ev({ kind: 'question', title: 'B' }))
    s.notify(s.ev({ kind: 'error', title: 'C' }))
    s.notify(s.ev({ kind: 'error', sessionId: 'ses_2', title: 'D' }))
    expect(s.shown.map((n) => n.title)).toEqual([
      'Tarea esperando tu aprobación: A',
      'Tarea esperando tu respuesta: B',
      'La tarea falló: C',
      'La tarea falló: D'
    ])
  })

  it('interruptor de Tareas apagado, de la app apagado o sin soporte: no avisa', () => {
    for (const over of [{ tasksEnabled: () => false }, { appEnabled: () => false }, { isSupported: () => false }]) {
      const s = setup(over)
      s.notify(s.ev())
      expect(s.shown).toHaveLength(0)
    }
  })

  it('título largo recortado, una línea y sin ruta de la carpeta', () => {
    const s = setup()
    s.notify(s.ev({ title: `x${'y'.repeat(300)}\nsegunda línea` }))
    const text = s.shown[0].title
    expect(text.startsWith('Tarea terminada: ')).toBe(true)
    expect(text.endsWith('…')).toBe(true)
    expect(text.length).toBeLessThanOrEqual('Tarea terminada: '.length + NOTIFY_TITLE_MAX)
    expect(text).not.toContain('\n')
    expect(text).not.toContain('/Users')
  })

  it('título vacío usa «Tarea sin título»', () => {
    expect(cleanTaskTitle('  \n ')).toBe('Tarea sin título')
  })

  it('clic: abre esa tarea', () => {
    const s = setup()
    s.notify(s.ev({ fullAccess: true }))
    s.clicks[0]()
    expect(s.open).toHaveBeenCalledWith({ mode: 'tasks', id: 'ses_1', directory: '/Users/x/Proyecto', fullAccess: true })
  })

  it('silencio según el ajuste de sonido', () => {
    const s = setup({ silent: () => true })
    s.notify(s.ev())
    expect(s.shown[0].silent).toBe(true)
  })
})
