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

describe('registerUnsupportedHandlers', () => {
  it('macOS: no registra nada', () => {
    const { ipc, handlers } = fakeIpc()
    expect(registerUnsupportedHandlers(ipc, capsFor('darwin'))).toEqual([])
    expect(handlers.size).toBe(0)
  })

  it('Windows: cubre todos los canales de Tareas/Control (salvo routines:*) y los del actualizador', () => {
    const { ipc, handlers } = fakeIpc()
    registerUnsupportedHandlers(ipc, capsFor('win32'))
    for (const ch of TASKS_INVOKE_CHANNELS) {
      expect(handlers.has(ch), ch).toBe(!ch.startsWith('routines:'))
    }
    for (const ch of UPDATER_CHANNELS) expect(handlers.has(ch), ch).toBe(true)
    expect(tasksOnlyChannels().some((c) => c.startsWith('routines:'))).toBe(false)
  })

  it('las lecturas del arranque devuelven valores neutros', async () => {
    const { ipc, handlers } = fakeIpc()
    registerUnsupportedHandlers(ipc, capsFor('win32'))
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
    registerUnsupportedHandlers(ipc, capsFor('win32'))
    for (const ch of ['tasks:start', 'computer:status', 'tasks:network:state', 'app:updateInstall']) {
      expect(await handlers.get(ch)!({}, { folder: '/x' }), ch).toMatchObject({
        ok: false,
        code: 'PLATFORM_UNSUPPORTED',
        error: expect.stringMatching(/.{10}/)
      })
    }
  })
})
