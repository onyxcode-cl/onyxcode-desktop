// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useServer } from '../../stores/server'
import { useSessions } from '../../stores/sessions'
import { useCode } from '../code/impl/store'
import { clearSearchIndex, ensureSearchIndex, indexForTests, MAX_CONVERSATIONS, searchContent, useSearchStatus } from './search-service'

const CHAT_DIR = '/tmp/lzx-chat'
const CODE_DIR = '/tmp/lzx-proyecto'

function session(id: string, directory: string, title: string, updated: number, extra: Record<string, unknown> = {}): never {
  return { id, directory, title, time: { created: 1, updated }, ...extra } as never
}

function transcript(id: string, text: string) {
  return [
    { info: { id: `${id}-u`, role: 'user', sessionID: id, time: { created: 10 } }, parts: [{ id: `${id}-pu`, type: 'text', text }] },
    {
      info: { id: `${id}-a`, role: 'assistant', sessionID: id, parentID: `${id}-u`, time: { created: 11 } },
      parts: [{ id: `${id}-pa`, type: 'text', text: `respuesta sobre ${text}` }]
    }
  ]
}

let messages: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useRealTimers()
  messages = vi.fn(async ({ sessionID }: { sessionID: string }) => ({ data: transcript(sessionID, `contenido de ${sessionID}`) }))
  useServer.setState({
    client: { session: { messages } } as never,
    connection: { chatDirectory: CHAT_DIR } as never
  })
  useSessions.setState({
    sessions: { c1: session('c1', CHAT_DIR, 'Primera', 100), c2: session('c2', CHAT_DIR, 'Segunda', 200) },
    sessionSource: {},
    directorySource: {},
    status: {}
  })
  useCode.setState({
    sessions: { k1: session('k1', CODE_DIR, 'Proyecto', 150), kc: session('kc', CODE_DIR, 'Hija', 160, { parentID: 'k1' }) },
    sessionProject: { k1: CODE_DIR, kc: CODE_DIR },
    runState: {}
  })
})

afterEach(() => {
  clearSearchIndex()
})

async function settled(): Promise<void> {
  await vi.waitFor(() => expect(useSearchStatus.getState().phase).toBe('ready'), { timeout: 3000 })
}

describe('servicio de búsqueda por contenido', () => {
  it('lee solo las conversaciones raíz de Chat y Code y las vuelve buscables', async () => {
    ensureSearchIndex()
    await settled()
    expect(messages).toHaveBeenCalledTimes(3) // c1, c2 y k1; la hija de Code se omite
    expect(indexForTests().ids().sort()).toEqual(['c1', 'c2', 'k1'])
    const r = searchContent('contenido de c2')
    expect(r.groups[0].sessionId).toBe('c2')
    expect(r.groups[0].mode).toBe('chat')
    expect(searchContent('contenido de k1').groups[0].mode).toBe('code')
    expect(MAX_CONVERSATIONS).toBeGreaterThan(0)
  })

  it('es incremental: solo relee lo que cambió', async () => {
    ensureSearchIndex()
    await settled()
    messages.mockClear()
    ensureSearchIndex()
    await settled()
    expect(messages).not.toHaveBeenCalled()
    useSessions.setState({ sessions: { ...useSessions.getState().sessions, c1: session('c1', CHAT_DIR, 'Primera', 999) } })
    ensureSearchIndex()
    await vi.waitFor(() => expect(messages).toHaveBeenCalledTimes(1))
    expect(messages.mock.calls[0][0].sessionID).toBe('c1')
  })

  it('quita lo que ya no existe y no relee una conversación mientras la IA escribe en ella', async () => {
    ensureSearchIndex()
    await settled()
    const { c2, ...rest } = useSessions.getState().sessions
    void c2
    messages.mockClear()
    useSessions.setState({ sessions: { ...rest, c1: session('c1', CHAT_DIR, 'Primera', 500) }, status: { c1: 'busy' } })
    ensureSearchIndex()
    await settled()
    expect(indexForTests().has('c2')).toBe(false)
    expect(messages).not.toHaveBeenCalled() // c1 está ocupada
  })

  it('una lectura que falla no rompe el resto y se cuenta', async () => {
    messages.mockImplementation(async ({ sessionID }: { sessionID: string }) => {
      if (sessionID === 'c1') throw new Error('red')
      return { data: transcript(sessionID, `contenido de ${sessionID}`) }
    })
    ensureSearchIndex()
    await settled()
    expect(useSearchStatus.getState().failed).toBe(1)
    expect(searchContent('contenido de c2').groups).toHaveLength(1)
  })

  it('sin conexión con el motor queda en error sin lanzar', async () => {
    useServer.setState({ client: null as never })
    ensureSearchIndex()
    await vi.waitFor(() => expect(useSearchStatus.getState().phase).toBe('error'))
  })

  it('«Vaciar» borra todo y no vuelve a leer hasta que se pida otra vez', async () => {
    ensureSearchIndex()
    await settled()
    clearSearchIndex()
    expect(indexForTests().size).toBe(0)
    expect(useSearchStatus.getState().phase).toBe('idle')
    expect(searchContent('contenido').groups).toEqual([])
    messages.mockClear()
    useSessions.setState({ sessions: { ...useSessions.getState().sessions, c1: session('c1', CHAT_DIR, 'Primera', 1234) } })
    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(10_000) // mucho más que la espera de re-sincronización
    vi.useRealTimers()
    expect(messages).not.toHaveBeenCalled()
    ensureSearchIndex()
    await settled()
    expect(indexForTests().size).toBe(3)
  })
})
