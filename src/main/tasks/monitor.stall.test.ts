// Aviso NO destructivo «Sin actividad» (F8-B30): el monitor marca `quietSince` cuando una tarea en curso lleva el
// umbral sin avance, y NUNCA detiene ni cancela nada. Servidor falso por `fetch` inyectado y reloj manual.
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TASKS_PREFS, type TasksActivitySnapshot, type TasksPrefs } from '@shared/ipc-tasks'
import { TasksMonitor } from './monitor'

function setup(stallWarnMinutes: number) {
  let now = 1_000_000
  let msgTail = 'a'
  let sessionBusy = true
  const stop = vi.fn(async () => undefined)
  const snaps: TasksActivitySnapshot[] = []
  const prefs: TasksPrefs = { ...DEFAULT_TASKS_PREFS, stallWarnMinutes, idleStopMinutes: 0 }
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    const json = (data: unknown): Response => new Response(JSON.stringify(data), { status: 200 })
    if (url.pathname === '/session/status') return json(sessionBusy ? { ses_1: { type: 'busy' } } : {})
    if (url.pathname === '/permission' || url.pathname === '/question') return json([])
    if (url.pathname === '/session/ses_1/message') {
      return json([{ info: { id: 'msg_1', role: 'assistant' }, parts: [{ id: 'p1', type: 'text', text: msgTail }] }])
    }
    if (url.pathname === '/session/ses_1') return json({ id: 'ses_1', title: 'Tarea atascada' })
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  const monitor = new TasksMonitor({
    servers: () => [{ folder: '/tmp/f', fullAccess: false, baseUrl: 'http://x', authorization: 'a', startedAt: 1, lastStartCallAt: 1 }],
    stop,
    prefs: { get: () => prefs },
    tasks: { list: () => [] },
    notify: () => undefined,
    onActivity: (s) => snaps.push(s),
    now: () => now,
    fetch: fakeFetch
  })
  return {
    monitor,
    stop,
    snaps,
    advance: (ms: number) => void (now += ms),
    progress: () => void (msgTail += 'b'),
    finish: () => void (sessionBusy = false),
    quiet: () => monitor.snapshot().tasks[0]?.quietSince
  }
}

describe('aviso de inactividad de una tarea en curso', () => {
  it('no avisa antes del umbral y avisa al cumplirse, sin detener nada', async () => {
    const t = setup(5)
    await t.monitor.poll()
    expect(t.quiet()).toBeUndefined()
    t.advance(4 * 60_000)
    await t.monitor.poll()
    expect(t.quiet()).toBeUndefined()
    t.advance(61_000)
    await t.monitor.poll()
    expect(t.quiet()).toBe(1_000_000)
    expect(t.snaps.at(-1)?.tasks[0]?.quietSince).toBe(1_000_000)
    expect(t.stop).not.toHaveBeenCalled()
  })

  it('un avance (texto nuevo) reinicia la cuenta y quita el aviso', async () => {
    const t = setup(1)
    await t.monitor.poll()
    t.advance(70_000)
    await t.monitor.poll()
    expect(t.quiet()).toBeDefined()
    t.progress()
    await t.monitor.poll()
    expect(t.quiet()).toBeUndefined()
    t.advance(30_000)
    await t.monitor.poll()
    expect(t.quiet()).toBeUndefined()
  })

  it('con 0 minutos no avisa nunca', async () => {
    const t = setup(0)
    await t.monitor.poll()
    t.advance(60 * 60_000)
    await t.monitor.poll()
    expect(t.quiet()).toBeUndefined()
  })
})
