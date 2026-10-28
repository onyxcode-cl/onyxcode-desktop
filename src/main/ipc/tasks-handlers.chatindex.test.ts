/** Modo unificado: los handlers `tasks:chatIndex:*` hablan con el índice de main (sin bandera: vacío y sin efecto). */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { macOnly } from '../../test/platform'

const dir = vi.hoisted(() => ({ v: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => dir.v, getAppPath: () => '/x', isPackaged: false, getVersion: () => '0' },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class {},
  dialog: {},
  shell: {},
  powerSaveBlocker: { start: () => 1, stop: () => undefined, isStarted: () => false },
  safeStorage: { isEncryptionAvailable: () => false },
  net: {},
  powerMonitor: { on: () => undefined, removeListener: () => undefined }
}))
vi.mock('./guard', () => ({ guardInvoke: (_e: unknown, _c: string, a: unknown[]) => a[0], IpcGuardError: class extends Error {} }))
vi.mock('../embedded-browser/service', () => ({ embeddedBrowser: {} }))
vi.mock('../embedded-browser/mcp-server', () => ({ embeddedBrowserMcp: { setApi: () => undefined, configFor: async () => null } }))

import { UNIFIED_APPS_ENV } from '@shared/unified-bridge'
import { registerTasksHandlers } from './tasks-handlers'

let root: string
beforeAll(() => {
  root = realpathSync(mkdtempSync(join(homedir(), '.lazunox-chatindex-ipc-')))
  dir.v = join(realpathSync(tmpdir()), `lzx-ci-${process.pid}`)
  mkdirSync(dir.v, { recursive: true })
})
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(dir.v, { recursive: true, force: true })
})

describe.skipIf(!macOnly)('handlers tasks:chatIndex:*', () => {
  it('con bandera: upsert/list/remove; carpeta no aprobada rechazada. Sin bandera: [] y no-op', async () => {
    const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>()
    const ipc = { removeHandler: () => undefined, handle: (ch: string, fn: never) => void handlers.set(ch, fn) }
    const mod = registerTasksHandlers(ipc as never, () => null, {
      getMainConnection: async () => ({}) as never,
      chatDirectory: dir.v,
      computer: false
    })
    const raw = (ch: string, req?: unknown): Promise<{ ok: boolean; data?: unknown }> =>
      Promise.resolve(handlers.get(ch)!({ sender: {} }, req)) as Promise<{ ok: boolean; data?: unknown }>
    const call = async (ch: string, req?: unknown): Promise<unknown> => {
      const r = await raw(ch, req)
      expect(r.ok, ch).toBe(true)
      return r.data
    }
    const prev = process.env[UNIFIED_APPS_ENV]
    try {
      process.env[UNIFIED_APPS_ENV] = '1'
      const proj = join(root, 'p')
      mkdirSync(proj)
      const { path } = (await call('tasks:approveFolder', { folder: proj })) as { path: string }
      const entry = { folder: path, sessionId: 'ses_1', title: 'hola', updatedAt: 5 }
      await call('tasks:chatIndex:upsert', entry)
      expect(await call('tasks:chatIndex:list')).toEqual([entry])
      expect((await raw('tasks:chatIndex:upsert', { ...entry, folder: join(root, 'ajena') })).ok).toBe(false)
      process.env[UNIFIED_APPS_ENV] = '0'
      expect(await call('tasks:chatIndex:list')).toEqual([])
      await call('tasks:chatIndex:remove', { folder: path })
      process.env[UNIFIED_APPS_ENV] = '1'
      expect(await call('tasks:chatIndex:list')).toEqual([entry])
      await call('tasks:chatIndex:remove', { folder: path, sessionId: 'ses_1' })
      expect(await call('tasks:chatIndex:list')).toEqual([])
    } finally {
      if (prev === undefined) delete process.env[UNIFIED_APPS_ENV]
      else process.env[UNIFIED_APPS_ENV] = prev
      await mod.shutdown()
    }
  })
})
