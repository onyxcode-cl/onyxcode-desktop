/** Stubs de Tareas/Control/actualizador fuera de macOS: canal por canal, sin tocar nada de macOS. */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '1.2.3' }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('./guard', () => ({ guardInvoke: (_e: unknown, _c: string, a: unknown[]) => a[0], IpcGuardError: class extends Error {} }))

import { TASKS_INVOKE_CHANNELS } from '@shared/ipc-tasks'
import { capsFor } from '@shared/platform-caps'
import { registerUnsupportedHandlers, tasksOnlyChannels, UPDATER_CHANNELS } from './unsupported-handlers'

function fakeIpc(): { ipc: never; handlers: Map<string, (e: unknown, ...a: unknown[]) => Promise<unknown>> } {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => Promise<unknown>>()
  const ipc = {
    removeHandler: () => undefined,
    handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => Promise<unknown>) => handlers.set(ch, fn)
  }
  return { ipc: ipc as never, handlers }
}

// Windows con el actualizador propio activo (instalación normal) o apagado (build de la Microsoft Store, `process.windowsStore`).
const WIN_STORE = { ...capsFor('win32'), updater: false }

describe('registerUnsupportedHandlers', () => {
  it('Windows con actualizador propio: no responde por él los canales del actualizador (los registra ipc/update.ts)', () => {
    const { ipc, handlers } = fakeIpc()
    registerUnsupportedHandlers(ipc, capsFor('win32'))
    for (const ch of UPDATER_CHANNELS) expect(handlers.has(ch), ch).toBe(false)
  })

  it('macOS: solo el stub neutro de tasks:winBeta (no hay nada más que simular)', () => {
    const { ipc, handlers } = fakeIpc()
    expect(registerUnsupportedHandlers(ipc, capsFor('darwin'))).toEqual(['tasks:winBeta'])
    expect([...handlers.keys()]).toEqual(['tasks:winBeta'])
  })

  it('tasks:winBeta: stub neutro (available false) o ninguno si ya hay handler real', async () => {
    const a = fakeIpc()
    registerUnsupportedHandlers(a.ipc, capsFor('darwin'))
    expect(await a.handlers.get('tasks:winBeta')!({}, { action: 'accept' })).toMatchObject({
      ok: true,
      data: { available: false, consent: false, armed: false, restartRequired: false }
    })
    const b = fakeIpc()
    expect(registerUnsupportedHandlers(b.ipc, capsFor('darwin'), { winBetaHandled: true })).toEqual([])
    expect(b.handlers.size).toBe(0)
  })

  it('Windows (Store, sin actualizador propio): cubre todos los canales de Tareas/Control (salvo routines:*) y los del actualizador', () => {
    const { ipc, handlers } = fakeIpc()
    registerUnsupportedHandlers(ipc, WIN_STORE)
    for (const ch of TASKS_INVOKE_CHANNELS) {
      expect(handlers.has(ch), ch).toBe(!ch.startsWith('routines:'))
    }
    for (const ch of UPDATER_CHANNELS) expect(handlers.has(ch), ch).toBe(true)
    expect(tasksOnlyChannels().some((c) => c.startsWith('routines:'))).toBe(false)
  })

  it('las lecturas del arranque devuelven valores neutros', async () => {
    const { ipc, handlers } = fakeIpc()
    registerUnsupportedHandlers(ipc, WIN_STORE)
    const call = (ch: string): Promise<unknown> => handlers.get(ch)!({}, undefined)
    expect(await call('tasks:listFolders')).toEqual({ ok: true, data: [] })
    expect(await call('tasks:policy')).toEqual({ ok: true, data: null })
    expect(await call('computer:approvedPlans')).toEqual({ ok: true, data: [] })
    expect(await call('tasks:prefs:get')).toMatchObject({ ok: true })
    expect(await call('app:bootConfirm')).toEqual({ ok: true, data: undefined })
    expect(await call('app:updateState')).toMatchObject({ ok: true, data: { available: false, installable: false, current: '1.2.3' } })
  })

  it('el resto responde PLATFORM_UNSUPPORTED con mensaje', async () => {
    const { ipc, handlers } = fakeIpc()
    registerUnsupportedHandlers(ipc, WIN_STORE)
    for (const ch of ['tasks:start', 'computer:status', 'tasks:network:state', 'app:updateInstall']) {
      expect(await handlers.get(ch)!({}, { folder: '/x' }), ch).toMatchObject({
        ok: false,
        code: 'PLATFORM_UNSUPPORTED',
        error: expect.stringMatching(/.{10}/)
      })
    }
  })
})
