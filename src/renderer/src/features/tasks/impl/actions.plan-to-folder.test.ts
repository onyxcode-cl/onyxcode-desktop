/**
 * «Cambiar a Solo en tu carpeta» desde el plan de Control total sin apps: cancela el plan y vuelve al modo carpeta,
 * o explica por qué no se puede (sin carpeta autorizada). Vale para cualquier plan, sin importar la herramienta.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: Array<{ channel: string; payload: unknown }> = []
vi.mock('./bridge', () => ({
  hasTasksBridge: () => true,
  onTasks: vi.fn(),
  onTasksPush: vi.fn(),
  cw: vi.fn((channel: string, payload?: unknown) => {
    calls.push({ channel, payload })
    return Promise.resolve(channel === 'tasks:revokeFullAccess' ? undefined : null)
  })
}))
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

let C: typeof import('./store')
let A: typeof import('./actions')

const REQ = (apps: unknown[]): never => ({ id: 'r1', apps, plan: ['Leer archivos'], sessionId: 's1' }) as never

beforeEach(async () => {
  vi.resetModules()
  calls.length = 0
  C = await import('./store')
  A = await import('./actions')
})

describe('switchPlanToFolderMode', () => {
  it.each(['/Users/ana/docs', '/Users/luis/otra carpeta'])(
    'con carpeta autorizada (%s): cancela el plan y sale de Control total',
    async (folder) => {
      C.useTasks.setState({ folder, folders: [{ path: folder }] as never, accessRequest: REQ([]), error: null })
      await A.switchPlanToFolderMode()
      const respond = calls.find((c) => c.channel === 'computer:respondAccess')
      expect(respond?.payload).toMatchObject({ id: 'r1', cancel: true })
      expect(calls.some((c) => c.channel === 'tasks:revokeFullAccess')).toBe(true)
      expect(C.useTasks.getState().accessRequest).toBeNull()
    }
  )

  it.each(['Ordena los archivos de la carpeta', 'Resume el informe de ventas'])(
    'deja el último mensaje del usuario (%s) en el compositor para reenviarlo',
    async (text) => {
      const { useSessions } = await import('../../../stores/sessions')
      const msg = (role: string, t: string): never => ({ info: { id: t, role }, parts: [{ type: 'text', text: t }] }) as never
      useSessions.setState({ messages: { s1: [msg('user', 'primero'), msg('assistant', 'ok'), msg('user', text)] } } as never)
      C.useTasks.setState({
        folder: '/Users/ana',
        folders: [{ path: '/Users/ana' }] as never,
        accessRequest: REQ([]),
        activeTaskId: 's1',
        draft: ''
      })
      await A.switchPlanToFolderMode()
      expect(C.useTasks.getState().draft).toBe(text)
    }
  )

  it('no pisa lo que el usuario ya estaba escribiendo', async () => {
    const { useSessions } = await import('../../../stores/sessions')
    useSessions.setState({ messages: { s1: [{ info: { id: 'm', role: 'user' }, parts: [{ type: 'text', text: 'viejo' }] }] } } as never)
    C.useTasks.setState({
      folder: '/a',
      folders: [{ path: '/a' }] as never,
      accessRequest: REQ([]),
      activeTaskId: 's1',
      draft: 'nuevo texto'
    })
    await A.switchPlanToFolderMode()
    expect(C.useTasks.getState().draft).toBe('nuevo texto')
  })

  it.each([
    ['sin carpeta', null, []],
    ['carpeta no autorizada', '/Users/ana', [{ path: '/Users/ana/otra' }]]
  ])('%s: no cancela nada y muestra el motivo', async (_n, folder, folders) => {
    C.useTasks.setState({ folder, folders: folders as never, accessRequest: REQ([]), error: null })
    await A.switchPlanToFolderMode()
    expect(calls.length).toBe(0)
    expect(C.useTasks.getState().accessRequest).not.toBeNull()
    expect(C.useTasks.getState().error).toMatch(/carpeta/i)
  })
})
