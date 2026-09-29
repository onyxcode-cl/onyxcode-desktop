/**
 * Fase 7 · G3: `syncRunStatus` con huérfanas (F7-B10) e invalidación de `loaded` de los servidores de Cowork que
 * dejan de emitir (F7-B14).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSession } from '../../../../../test/fixtures/events'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const D = '/proj'
const SRC = 'http://cw1'
let S: typeof import('../../../stores/sessions')
let C: typeof import('./store')

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  S = await import('../../../stores/sessions')
  C = await import('./store')
})
const sessions = (): ReturnType<typeof S.useSessions.getState> => S.useSessions.getState()

describe('F7-B14: disconnect/connectFolder invalidan loaded de los orígenes de Cowork', () => {
  it('disconnect marca loaded=false en las tareas de Cowork y no en las de Chat', () => {
    sessions().upsertSession(makeSession('chat1', D)) // main
    sessions().upsertSession(makeSession('t1', D), SRC)
    S.useSessions.setState((s) => ({ loaded: { chat1: true, t1: true }, messages: { ...s.messages, chat1: [], t1: [] } }))
    C.disconnect()
    expect(sessions().loaded).toEqual({ chat1: true, t1: false })
  })
})

describe('F7-B10: resync limpia entradas busy huérfanas del servidor de Cowork', () => {
  function connectFake(statusData: Record<string, { type: string }>): void {
    const client = {
      session: {
        list: () => Promise.resolve({ data: [] }), // el sidecar nuevo no conoce la tarea
        status: () => Promise.resolve({ data: statusData })
      },
      permission: { list: () => Promise.resolve({ data: [] }) },
      question: { list: () => Promise.resolve({ data: [] }) }
    }
    C.useCowork.setState({ client: client as never, folder: D, conn: { baseUrl: SRC } as never, activeTaskId: null })
  }

  it('la tarea desaparecida deja de estar busy; la de otro servidor no se toca', async () => {
    sessions().upsertSession(makeSession('t1', D), SRC)
    sessions().upsertSession(makeSession('t2', D), 'http://otro')
    sessions().setStatus('t1', 'busy')
    sessions().setStatus('t2', 'busy')
    connectFake({})
    await C.resync()
    expect(sessions().sessions['t1']).toBeUndefined()
    expect(sessions().status['t1']).toBe('idle')
    expect(sessions().status['t2']).toBe('busy')
  })
})
