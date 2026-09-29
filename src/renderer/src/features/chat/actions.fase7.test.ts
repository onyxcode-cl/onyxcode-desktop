/**
 * Fase 7 · G3: `syncChatRunStatus` con entradas huérfanas (F7-B10, bug 5 del E2E) e invalidación de `loaded`
 * al reconectar el stream (F7-B14).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeApi } from '../../../../test/setup'
import { makeSession } from '../../../../test/fixtures/events'

// El stream SSE real no se abre: se captura `onOpen` para simular (re)conexiones.
const streamOpts = vi.hoisted(() => ({ onOpen: undefined as (() => void) | undefined }))
vi.mock('../../lib/opencode', async (orig) => ({
  ...(await orig<typeof import('../../lib/opencode')>()),
  startEventStream: (_c: unknown, _h: unknown, o: { onOpen?: () => void }) => {
    streamOpts.onOpen = o.onOpen
    return () => undefined
  }
}))

type Sessions = typeof import('../../stores/sessions')
let S: Sessions
let A: typeof import('./actions')
let server: typeof import('../../stores/server')
const D = '/chat'

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  S = await import('../../stores/sessions')
  server = await import('../../stores/server')
  A = await import('./actions')
})

function installServer(over: {
  status?: () => Promise<{ data?: Record<string, { type: string }> }>
  list?: () => Promise<{ data: unknown[] }>
}): void {
  const client = {
    session: {
      status: over.status ?? (() => Promise.resolve({ data: {} })),
      list: over.list ?? (() => Promise.resolve({ data: [] }))
    }
  }
  server.useServer.setState({ client: client as never, connection: { chatDirectory: D } as never })
}
const st = (): ReturnType<Sessions['useSessions']['getState']> => S.useSessions.getState()

describe('F7-B10: syncChatRunStatus limpia entradas busy huérfanas', () => {
  it('tras reiniciar el sidecar (la lista ya no tiene la sesión) status[sid] pasa a idle', async () => {
    installServer({ list: () => Promise.resolve({ data: [] }), status: () => Promise.resolve({ data: {} }) })
    st().upsertSession(makeSession('s1', D))
    st().setStatus('s1', 'busy')
    await A.loadChatSessions() // vacía `sessions`
    expect(st().sessions['s1']).toBeUndefined()
    await A.syncChatRunStatus()
    expect(st().status['s1']).toBe('idle')
  })

  it('una entrada huérfana que el servidor sigue reportando busy se conserva', async () => {
    installServer({ status: () => Promise.resolve({ data: { s1: { type: 'busy' } } }) })
    st().setStatus('s1', 'busy')
    await A.syncChatRunStatus()
    expect(st().status['s1']).toBe('busy')
  })

  it('las entradas de un servidor de Tasks no se tocan', async () => {
    installServer({})
    st().upsertSession(makeSession('cw', D), 'http://tasks')
    st().setStatus('cw', 'busy')
    await A.syncChatRunStatus()
    expect(st().status['cw']).toBe('busy')
  })

  it('no degrada a idle una sesión que pasó a busy mientras se pedía el estado', async () => {
    let release!: (v: { data: Record<string, { type: string }> }) => void
    installServer({ status: () => new Promise((r) => (release = r)) })
    st().upsertSession(makeSession('s1', D))
    st().setStatus('s1', 'idle')
    const sync = A.syncChatRunStatus()
    st().setStatus('s1', 'busy') // llega el evento durante la petición
    release({ data: {} }) // la foto del servidor es anterior
    await sync
    expect(st().status['s1']).toBe('busy')
  })

  it('una sesión busy antes de la petición y ausente del servidor sí pasa a idle', async () => {
    installServer({ status: () => Promise.resolve({ data: {} }) })
    st().upsertSession(makeSession('s1', D))
    st().setStatus('s1', 'busy')
    await A.syncChatRunStatus()
    expect(st().status['s1']).toBe('idle')
  })
})

describe('F7-B14: al reconectar el stream, loaded=false salvo la conversación activa', () => {
  it('invalida las de Chat (origen principal), no la activa ni las de Tasks', async () => {
    const chat = await import('./store')
    for (const [id, src] of [
      ['a', undefined],
      ['b', undefined],
      ['c', 'http://cw']
    ] as const) {
      st().upsertSession(makeSession(id, D), src)
      S.useSessions.setState((s) => ({ loaded: { ...s.loaded, [id]: true } }))
    }
    chat.useChat.getState().setActive('b')
    // Conecta (registra el stream falso) y simula que el stream (re)abre.
    server.useServer.getState().init()
    const calls = fakeApi.on.mock.calls as unknown as [string, (c: unknown) => void][]
    const onConn = calls.find((c) => c[0] === 'opencode:connection')?.[1] as (c: unknown) => void
    onConn({ baseUrl: 'http://127.0.0.1:1', authorization: 'x', chatDirectory: D })
    streamOpts.onOpen?.()
    expect(st().loaded).toEqual({ a: false, b: true, c: true })
  })
})
