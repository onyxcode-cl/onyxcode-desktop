/** La primera instantánea necesita una confirmación real de sesión vacía, ligada al mismo servidor. */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => state.userData, getAppPath: () => '/nonexistent', isPackaged: false, getVersion: () => '0' }
}))
vi.mock('../embedded-browser/service', () => ({ embeddedBrowser: {} }))
vi.mock('../embedded-browser/mcp-server', () => ({ embeddedBrowserMcp: {} }))
import { TasksManager } from './manager'

let root: string
let folder: string
let manager: TasksManager
let servers: Map<string, unknown>
const sid = 'ses_abcdefgh'
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-own-session-')))
  state.userData = join(root, 'ud')
  folder = join(root, 'task')
  mkdirSync(state.userData)
  mkdirSync(folder)
  manager = new TasksManager({ platform: 'darwin' })
  servers = (manager as unknown as { servers: Map<string, unknown> }).servers
  servers.set(folder, { handle: { baseUrl: 'http://127.0.0.1:1234', authorization: 'Basic test', paths: { directory: folder } } })
})
afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(root, { recursive: true, force: true })
})

describe('confirmación inicial del motor', () => {
  it('solo vacío habilita el registro, sin enviar contenido al sandbox', async () => {
    const f = vi.fn(async () => new Response('[]'))
    vi.stubGlobal('fetch', f)
    expect(await manager.isPristineSession(folder, sid)).toBe(true)
    expect(f.mock.calls).toHaveLength(1)
  })
  it.each(['[{"info":{"role":"user"}}]', '[{"parts":[{"type":"tool"}]}]', '{}'])(
    'mensajes existentes o forma no verificable cierran el registro: %s',
    async (data) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(data))
      )
      expect(await manager.isPristineSession(folder, sid)).toBe(false)
    }
  )
  it('caída, sesión desconocida o servidor cambiado durante la consulta cierran el registro', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 404 }))
    )
    expect(await manager.isPristineSession(folder, sid)).toBe(false)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        servers.delete(folder)
        return new Response('[]')
      })
    )
    expect(await manager.isPristineSession(folder, sid)).toBe(false)
  })
  it('no consulta sesiones o carpetas sin servidor', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await manager.isPristineSession(folder, 'invalid')).toBe(false)
    servers.clear()
    expect(await manager.isPristineSession(folder, sid)).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })
})
