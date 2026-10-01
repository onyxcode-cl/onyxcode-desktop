/** F8-B32 (H6): tareas «Interrumpidas» (último mensaje del asistente sin `time.completed`) y sin falsos positivos. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSession } from '../../../../../test/fixtures/events'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
vi.mock('./bridge', () => ({ cw: vi.fn(async () => undefined) }))

const D = '/proj'
const SRC = 'http://cw'

let useSessions: (typeof import('../../../stores/sessions'))['useSessions']
let store: typeof import('./store')
let util: typeof import('./util')

const msg = (id: string, role: 'user' | 'assistant', time: Record<string, number>, extra: Record<string, unknown> = {}) =>
  ({ info: { id, role, sessionID: 's', time, ...extra }, parts: [] }) as never

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  ;({ useSessions } = await import('../../../stores/sessions'))
  store = await import('./store')
  util = await import('./util')
})

describe('endedMidTurn', () => {
  it('true si el último mensaje del asistente no tiene completed ni error', () => {
    expect(util.endedMidTurn([msg('1', 'user', { created: 1 }), msg('2', 'assistant', { created: 2 })])).toBe(true)
  })
  it('false si está completo, con error/aborto o sin asistente', () => {
    expect(util.endedMidTurn([msg('2', 'assistant', { created: 2, completed: 3 })])).toBe(false)
    expect(util.endedMidTurn([msg('2', 'assistant', { created: 2 }, { error: { name: 'MessageAbortedError' } })])).toBe(false)
    expect(util.endedMidTurn([msg('1', 'user', { created: 1 })])).toBe(false)
    expect(util.endedMidTurn(undefined)).toBe(false)
  })
})

describe('taskStatus con interrumpida', () => {
  const base = { waiting: false, error: null, entries: [] }
  it('muestra «interrumpida» solo si la sesión no está ocupada', () => {
    expect(util.taskStatus({ ...base, run: 'idle', interrupted: true })).toBe('interrupted')
    expect(util.taskStatus({ ...base, run: 'busy', interrupted: true })).toBe('running')
  })
})

describe('scanInterrupted', () => {
  function setup(statusOf: Record<string, 'busy' | 'idle'>) {
    const now = Date.now()
    for (const id of ['cortada', 'completa', 'ocupada']) {
      useSessions.getState().upsertSession(makeSession(id, D, { time: { created: now - 5000, updated: now - 1000 } }), SRC)
    }
    useSessions.setState({ status: statusOf })
    const data: Record<string, unknown[]> = {
      cortada: [msg('u1', 'user', { created: 1 }), msg('a1', 'assistant', { created: 2 })],
      completa: [msg('u1', 'user', { created: 1 }), msg('a1', 'assistant', { created: 2, completed: 3 })],
      ocupada: [msg('u1', 'user', { created: 1 }), msg('a1', 'assistant', { created: 2 })]
    }
    const client = { session: { messages: vi.fn(async ({ sessionID }: { sessionID: string }) => ({ data: data[sessionID] })) } }
    store.useTasks.setState({ folder: D, conn: { baseUrl: SRC, folder: D } as never, permissions: {}, questions: {} })
    return client
  }

  it('marca la cortada y no la completa ni la que sigue ocupada', async () => {
    const client = setup({ ocupada: 'busy' })
    await store.scanInterrupted(client as never, D)
    expect(Object.keys(store.useTasks.getState().interrupted)).toEqual(['cortada'])
    // la ocupada ni siquiera se consulta
    expect(client.session.messages).not.toHaveBeenCalledWith(expect.objectContaining({ sessionID: 'ocupada' }))
  })

  it('se quita la marca al volver a estar ocupada y solo se revisa una vez por servidor', async () => {
    const client = setup({})
    await store.scanInterrupted(client as never, D)
    const calls = client.session.messages.mock.calls.length
    await store.scanInterrupted(client as never, D)
    expect(client.session.messages.mock.calls.length).toBe(calls)
    expect(store.useTasks.getState().interrupted.cortada).toBe(true)
    useSessions.getState().setStatus('cortada', 'busy')
    expect(store.useTasks.getState().interrupted.cortada).toBeUndefined()
  })
})
