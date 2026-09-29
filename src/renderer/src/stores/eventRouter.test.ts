/**
 * Enrutado de eventos por directorio (6.5). Incluye F6-B1 (sin contaminación de Code en useSessions),
 * F6-B12 (`loaded` en lugar de `messages[id]`) y el comportamiento de `routeEventToSessions` con la flag.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpencodeClient } from '../lib/opencode'
import { codeSubagent } from '../../../test/fixtures/traces/code-subagent'
import {
  assistantMessage,
  makeSession,
  msgUpdated,
  partDelta,
  partUpdated,
  resetEventIds,
  sessionCreated,
  statusBusy,
  statusIdle,
  textPart,
  userMessage
} from '../../../test/fixtures/events'

vi.mock('../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

type Router = typeof import('./eventRouter')
type Sessions = typeof import('./sessions')
let r: Router
let s: Sessions
const CHAT = '/data/chat-workspace'

const ctx = (over: Partial<Parameters<Router['shouldApplyToSessions']>[2]> = {}): Parameters<Router['shouldApplyToSessions']>[2] => ({
  chatDirectory: CHAT,
  knownChat: () => false,
  ...over
})

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  resetEventIds()
  r = await import('./eventRouter')
  s = await import('./sessions')
})

describe('shouldApplyToSessions', () => {
  it('acepta message.part.delta del chatDirectory', () => {
    const te = partDelta({ sessionID: 'c1', messageID: 'm1', partID: 'p1', delta: 'x' }, CHAT)
    expect(r.shouldApplyToSessions(te.event, te.directory, ctx())).toBe(true)
  })
  it('rechaza message.* de un proyecto de Code', () => {
    for (const te of [
      msgUpdated(userMessage('m1', 'k1'), '/work/code'),
      partUpdated(textPart('p1', 'm1', 'k1', 'x'), '/work/code'),
      partDelta({ sessionID: 'k1', messageID: 'm1', partID: 'p1', delta: 'x' }, '/work/code')
    ]) {
      expect(r.shouldApplyToSessions(te.event, te.directory, ctx())).toBe(false)
    }
  })
  it('fail-open: directorio distinto pero sesión ya conocida de Chat', () => {
    const te = partDelta({ sessionID: 'c1', messageID: 'm1', partID: 'p1', delta: 'x' }, '/otra/ruta')
    expect(r.shouldApplyToSessions(te.event, te.directory, ctx({ knownChat: (sid) => sid === 'c1' }))).toBe(true)
    const other = partDelta({ sessionID: 'k1', messageID: 'm1', partID: 'p1', delta: 'x' }, '/otra/ruta')
    expect(r.shouldApplyToSessions(other.event, other.directory, ctx({ knownChat: (sid) => sid === 'c1' }))).toBe(false)
  })
  it('chatDirectory null rechaza sin lanzar', () => {
    const te = statusBusy('c1', CHAT)
    expect(() => r.shouldApplyToSessions(te.event, te.directory, ctx({ chatDirectory: null }))).not.toThrow()
    expect(r.shouldApplyToSessions(te.event, te.directory, ctx({ chatDirectory: null }))).toBe(false)
  })
  it('la barra final es equivalente', () => {
    const te = statusBusy('c1', '/a/b/')
    expect(r.shouldApplyToSessions(te.event, te.directory, ctx({ chatDirectory: '/a/b' }))).toBe(true)
    const te2 = statusBusy('c1', '/a/b')
    expect(r.shouldApplyToSessions(te2.event, te2.directory, ctx({ chatDirectory: '/a/b/' }))).toBe(true)
    expect(r.sameDir('/', '/')).toBe(true)
  })
  it('session.status de una hija de Chat en chatDirectory se acepta', () => {
    const te = statusBusy('child_of_chat', CHAT)
    expect(r.shouldApplyToSessions(te.event, te.directory, ctx())).toBe(true)
  })
  it('un evento anterior a loadSessions se acepta (sesión aún desconocida, directorio del Chat)', () => {
    const te = msgUpdated(userMessage('m1', 'nueva'), CHAT)
    expect(s.useSessions.getState().sessions['nueva']).toBeUndefined()
    expect(r.shouldApplyToSessions(te.event, te.directory, ctx())).toBe(true)
  })
  it('eventSessionID cubre las formas de evento', () => {
    expect(r.eventSessionID(sessionCreated(makeSession('s1', CHAT)).event)).toBe('s1')
    expect(r.eventSessionID(msgUpdated(userMessage('m1', 's2'), CHAT).event)).toBe('s2')
    expect(r.eventSessionID(partUpdated(textPart('p1', 'm1', 's3', ''), CHAT).event)).toBe('s3')
    expect(r.eventSessionID({ type: 'server.connected', properties: {} } as never)).toBeUndefined()
  })
})

describe('traza code-subagent a través del router (F6-B1)', () => {
  it('useSessions no recibe sesiones ni mensajes de Code', () => {
    const { useSessions } = s
    for (const { event, directory } of codeSubagent) {
      const knownChat = (sid: string): boolean => !!useSessions.getState().sessions[sid]
      if (r.shouldApplyToSessions(event, directory, ctx({ knownChat }))) useSessions.getState().applyEvent(event)
    }
    const st = useSessions.getState()
    expect(Object.keys(st.sessions)).toEqual([])
    expect(Object.keys(st.messages)).toEqual([])
    expect(Object.keys(st.status)).toEqual([])
  })
})

describe('routeEventToSessions', () => {
  async function setup(): Promise<void> {
    const { useServer } = await import('./server')
    useServer.setState({ connection: { baseUrl: 'http://x', authorization: 'a', chatDirectory: CHAT } as never })
  }
  it('filtra Code y deja pasar Chat', async () => {
    await setup()
    const te = statusBusy('k1', '/work/code')
    r.routeEventToSessions(te.event, te.directory)
    expect(s.useSessions.getState().status['k1']).toBeUndefined()
    const ok = statusBusy('c1', CHAT)
    r.routeEventToSessions(ok.event, ok.directory)
    expect(s.useSessions.getState().status['c1']).toBe('busy')
  })
  it('sin connection rechaza sin lanzar; lee connection en cada evento (restart)', async () => {
    const { useServer } = await import('./server')
    const te = statusBusy('c1', CHAT)
    expect(() => r.routeEventToSessions(te.event, te.directory)).not.toThrow()
    expect(s.useSessions.getState().status['c1']).toBeUndefined()
    useServer.setState({ connection: { baseUrl: 'http://x', authorization: 'a', chatDirectory: CHAT } as never })
    r.routeEventToSessions(te.event, te.directory)
    expect(s.useSessions.getState().status['c1']).toBe('busy')
  })
  it('fail-open para sesión de Chat conocida con directorio distinto', async () => {
    await setup()
    s.useSessions.getState().upsertSession(makeSession('c1', CHAT))
    const te = statusIdle('c1', '/otra/ruta')
    s.useSessions.getState().setStatus('c1', 'busy')
    r.routeEventToSessions(te.event, te.directory)
    expect(s.useSessions.getState().status['c1']).toBe('idle')
  })
})

describe('F6-B12: openChatSession usa `loaded`', () => {
  it('carga el historial completo aunque existan mensajes parciales por eventos sueltos', async () => {
    const { useServer } = await import('./server')
    const messages = vi.fn(() =>
      Promise.resolve({
        data: [
          { info: userMessage('m0', 'c1'), parts: [] },
          { info: assistantMessage('m1', 'c1'), parts: [] }
        ]
      })
    )
    const client = { session: { messages } } as unknown as OpencodeClient
    useServer.setState({ client, connection: { baseUrl: 'http://x', authorization: 'a', chatDirectory: CHAT } as never })
    // mensaje suelto (p. ej. de una rutina) antes de abrir la sesión
    s.useSessions.getState().applyEvent(msgUpdated(assistantMessage('m1', 'c1'), CHAT).event)
    expect(s.useSessions.getState().messages['c1']).toHaveLength(1)
    const { openChatSession } = await import('../features/chat/actions')
    await openChatSession('c1')
    expect(messages).toHaveBeenCalledTimes(1)
    expect(s.useSessions.getState().messages['c1'].map((m) => m.info.id)).toEqual(['m0', 'm1'])
    expect(s.useSessions.getState().loaded['c1']).toBe(true)
    await openChatSession('c1') // ya cargada: no vuelve a pedir
    expect(messages).toHaveBeenCalledTimes(1)
  })
  it('removeSession limpia el marcador', () => {
    s.useSessions.setState({ loaded: { c1: true } })
    s.useSessions.getState().removeSession('c1')
    expect(s.useSessions.getState().loaded['c1']).toBeUndefined()
  })
})
