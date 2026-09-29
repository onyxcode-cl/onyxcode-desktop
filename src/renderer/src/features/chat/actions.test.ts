/**
 * `syncChatRunStatus` (F6-B5): tras reconectar el stream, la sesión de Chat que quedó `busy` por un
 * evento de fin perdido vuelve a idle; lo que el servidor sigue reportando ocupado se mantiene.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpencodeClient } from '../../lib/opencode'
import { assistantMessage, makeSession, msgUpdated, partDelta, textPart, userMessage } from '../../../../test/fixtures/events'

vi.mock('../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const CHAT = '/data/chat-workspace'

async function setup(serverStatus: Record<string, { type: string }> | 'error'): Promise<{
  useSessions: (typeof import('../../stores/sessions'))['useSessions']
  syncChatRunStatus: () => Promise<void>
}> {
  const { useServer } = await import('../../stores/server')
  const status = vi.fn(() => (serverStatus === 'error' ? Promise.reject(new Error('down')) : Promise.resolve({ data: serverStatus })))
  useServer.setState({
    client: { session: { status } } as unknown as OpencodeClient,
    connection: { baseUrl: 'http://x', authorization: 'a', chatDirectory: CHAT } as never
  })
  const { useSessions } = await import('../../stores/sessions')
  const { syncChatRunStatus } = await import('./actions')
  return { useSessions, syncChatRunStatus }
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
})

describe('syncChatRunStatus', () => {
  it('reconexión con sesión perdida limpia el spinner; la que sigue ocupada se mantiene', async () => {
    const { useSessions, syncChatRunStatus } = await setup({ live: { type: 'busy' } })
    const st = useSessions.getState()
    st.upsertSession(makeSession('lost', CHAT))
    st.upsertSession(makeSession('live', CHAT))
    st.upsertSession(makeSession('code', '/otro/proyecto'))
    useSessions.setState({ status: { lost: 'busy', live: 'busy', code: 'busy' } })
    await syncChatRunStatus()
    expect(useSessions.getState().status).toEqual({ lost: 'idle', live: 'busy', code: 'busy' })
  })

  it('si el servidor no responde no toca nada', async () => {
    const { useSessions, syncChatRunStatus } = await setup('error')
    useSessions.getState().upsertSession(makeSession('lost', CHAT))
    useSessions.setState({ status: { lost: 'busy' } })
    await syncChatRunStatus()
    expect(useSessions.getState().status['lost']).toBe('busy')
  })
})

describe('LRU de messages en Chat', () => {
  type Snap = { data: { info: unknown; parts: unknown[] }[] }
  const snap = (sid: string, text: string): Snap => ({
    data: [{ info: assistantMessage(`msg_${sid}`, sid), parts: [textPart(`prt_${sid}`, `msg_${sid}`, sid, text)] }]
  })

  async function lruSetup(messages: (sid: string) => Promise<Snap>): Promise<{
    useSessions: (typeof import('../../stores/sessions'))['useSessions']
    useChat: (typeof import('./store'))['useChat']
    open: (id: string) => Promise<void>
    calls: string[]
  }> {
    localStorage.setItem('onyx.lru.max', '1')
    const calls: string[] = []
    const { useServer } = await import('../../stores/server')
    useServer.setState({
      client: {
        session: {
          messages: ({ sessionID }: { sessionID: string }) => {
            calls.push(sessionID)
            return messages(sessionID)
          }
        }
      } as unknown as OpencodeClient,
      connection: { baseUrl: 'http://x', authorization: 'a', chatDirectory: CHAT } as never
    })
    const { useSessions } = await import('../../stores/sessions')
    const { useChat } = await import('./store')
    const { openChatSession } = await import('./actions') // registra la guarda de Chat
    return { useSessions, useChat, open: openChatSession, calls }
  }

  it('reabrir una sesión desalojada vuelve a llamar a session.messages (y una cargada no)', async () => {
    const { useSessions, open, calls } = await lruSetup((sid) => Promise.resolve(snap(sid, 'hola')))
    await open('A')
    await open('A') // ya cargada: sin llamada
    expect(calls).toEqual(['A'])
    await open('B')
    await open('C') // la activa (C) no cuenta para el tope: sobran A y B → sale la más antigua (A)
    expect(useSessions.getState().messages['A']).toBeUndefined()
    expect(useSessions.getState().loaded['A']).toBeUndefined()
    expect(Object.keys(useSessions.getState().messages).sort()).toEqual(['B', 'C'])
    await open('A')
    expect(calls).toEqual(['A', 'B', 'C', 'A'])
    expect(useSessions.getState().loaded['A']).toBe(true)
    expect(useSessions.getState().messages['A'][0].parts).toHaveLength(1)
  })

  it('la conversación activa no se desaloja aunque se pase del tope', async () => {
    const { useSessions, open } = await lruSetup((sid) => Promise.resolve(snap(sid, 'x')))
    await open('A')
    // sesiones de rutinas por eventos, en segundo plano
    for (const id of ['r1', 'r2']) useSessions.getState().applyEvent(msgUpdated(userMessage(`msg_${id}`, id), CHAT).event)
    await new Promise((r) => setTimeout(r, 0))
    // tope 1 sobre las no fijadas: sale una de las dos rutinas (nunca abiertas), no la activa
    expect(Object.keys(useSessions.getState().messages).sort()).toEqual(['A', 'r2'])
  })

  it('delta en vuelo durante la recarga no se pierde ni duplica', async () => {
    let release!: (v: Snap) => void
    let first = true
    const { useSessions, open, calls } = await lruSetup((sid) => {
      if (sid === 'A' && !first) return new Promise<Snap>((r) => (release = r))
      return Promise.resolve(snap(sid, 'Hel'))
    })
    await open('A')
    first = false
    await open('B')
    await open('C') // desaloja A
    expect(useSessions.getState().messages['A']).toBeUndefined()
    const reopening = open('A') // touch + loadMessages (pendiente)
    expect(calls.filter((c) => c === 'A')).toHaveLength(2)
    useSessions.getState().applyEvent(partDelta({ sessionID: 'A', messageID: 'msg_A', partID: 'prt_A', delta: 'lo' }, CHAT).event)
    release(snap('A', 'Hel'))
    await reopening
    const parts = useSessions.getState().messages['A'].flatMap((e) => e.parts)
    expect(parts).toHaveLength(1)
    expect((parts[0] as { text: string }).text).toBe('Hello')
  })
})
