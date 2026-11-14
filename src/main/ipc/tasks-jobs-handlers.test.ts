import { afterEach, describe, expect, it, vi } from 'vitest'
import { TASKS_INVOKE_CHANNELS } from '@shared/ipc-tasks'
import { CELULAR_POLICY } from '../remote/policy'
import { CHANNEL_ROLES, IPC_SCHEMAS } from './schemas'
import { registerTasksJobsHandlers } from './tasks-jobs-handlers'
import type { TasksIpcContext } from './tasks-handle'

const channels = ['tasks:jobs:list', 'tasks:jobs:stop', 'tasks:jobs:resume'] as const
const folder = '/workspace'
const servers = [
  { folder, fullAccess: false, baseUrl: 'http://127.0.0.1:4097', authorization: 'Basic isolated', directory: '/win/c/workspace' },
  { folder, fullAccess: true, baseUrl: 'http://127.0.0.1:4098', authorization: 'Basic full', directory: folder },
  { folder: '/other', fullAccess: false, baseUrl: 'http://127.0.0.1:4099', authorization: 'Basic other', directory: '/other' }
]

function setup(live = servers) {
  const handlers = new Map<string, (req: unknown) => unknown>()
  const assertInsideApproved = vi.fn((path: string) => {
    if (path !== folder) throw new Error('not-approved')
    return path
  })
  registerTasksJobsHandlers({
    handle: (ch: string, fn: (req: unknown) => unknown) => handlers.set(ch, fn),
    tasks: { assertInsideApproved, liveServers: () => live }
  } as unknown as TasksIpcContext)
  return { handlers, assertInsideApproved }
}

afterEach(() => vi.unstubAllGlobals())

describe('trabajos del servidor de Tareas', () => {
  it('tiene contrato, esquema estricto, rol principal y política remota X', () => {
    for (const ch of channels) {
      expect(TASKS_INVOKE_CHANNELS).toContain(ch)
      expect(CELULAR_POLICY[ch]).toBe('X')
      for (const roles of Object.values(CHANNEL_ROLES)) expect(roles.has(ch)).toBe(false)
      const req = { folder, sessionID: 'ses_1', ...(ch === 'tasks:jobs:list' ? {} : { jobId: 'sh_1' }) }
      expect(IPC_SCHEMAS[ch]!(req)).toEqual(req)
      for (const bad of [
        { ...req, directory: '/elsewhere' },
        { ...req, baseUrl: servers[0].baseUrl },
        { ...req, sessionID: '../ses' }
      ]) {
        expect(() => IPC_SCHEMAS[ch]!(bad)).toThrow()
      }
      expect(() => IPC_SCHEMAS[ch]!({ ...req, folder: 'relative' })).toThrow()
    }
  })

  it('elige el servidor aislado exacto y la ruta SDK de main (también WSL)', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ trabajos: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const { handlers, assertInsideApproved } = setup()
    await expect(handlers.get('tasks:jobs:list')!({ folder, sessionID: 'ses_1' })).resolves.toEqual({ available: true, jobs: [] })
    expect(assertInsideApproved).toHaveBeenCalledWith(folder)
    expect(fetch.mock.calls[0]).toEqual([
      `${servers[0].baseUrl}/experimental/session/ses_1/trabajos?directory=${encodeURIComponent(servers[0].directory)}`,
      expect.objectContaining({ headers: { Authorization: servers[0].authorization } })
    ])
  })

  it('parar y reanudar usan el servidor de Control total solo cuando se pide ese modo', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const { handlers } = setup()
    for (const [ch, tail] of [
      ['tasks:jobs:stop', 'terminar'],
      ['tasks:jobs:resume', 'reanudar']
    ]) {
      await expect(handlers.get(ch)!({ folder, fullAccess: true, sessionID: 'ses_1', jobId: 'sh_1' })).resolves.toEqual({ ok: true })
      expect(fetch.mock.calls.at(-1)).toEqual([
        `${servers[1].baseUrl}/experimental/session/ses_1/trabajos/sh_1/${tail}?directory=${encodeURIComponent(folder)}`,
        expect.objectContaining({ method: 'POST', headers: { Authorization: servers[1].authorization } })
      ])
    }
  })

  it('sin permiso o sin servidor exacto no consulta otro modo, carpeta ni motor principal', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const { handlers } = setup([servers[1], servers[2]])
    expect(() => handlers.get('tasks:jobs:list')!({ folder: '/other', sessionID: 'ses_1' })).toThrow('not-approved')
    expect(() => handlers.get('tasks:jobs:list')!({ folder, sessionID: 'ses_1' })).toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
})
