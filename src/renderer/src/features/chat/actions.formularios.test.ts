/**
 * Formularios de conectores (`mcp.elicitation.*`) en el Chat: eventos, carga desde el servidor, respuesta y «Detener» (que cancela los
 * formularios de la conversación y de sus ayudantes). Rutas del motor con `fetch` crudo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpencodeClient } from '../../lib/opencode'
import type { ElicitationRequest } from '@shared/mcp-elicitation'
import { makeSession } from '../../../../test/fixtures/events'

vi.mock('../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const CHAT = '/data/chat-workspace'
const fetchMock = vi.fn()

const asked = (id: string, sessionID: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  sessionID,
  server: 'crm',
  message: 'Dato',
  fields: [{ name: 'nombre', type: 'string', required: true, maxLength: 50 }],
  expiresAt: Date.now() + 60_000,
  ...over
})
/** La misma solicitud, ya con su forma tipada (lo que guarda el store tras sanearla). */
const req = (id: string, sessionID: string): ElicitationRequest => asked(id, sessionID) as unknown as ElicitationRequest
const json = (body: unknown = true, status = 200): Response => new Response(JSON.stringify(body), { status })

async function setup() {
  const session = { abort: vi.fn(() => Promise.resolve({ data: true })) }
  const { useServer } = await import('../../stores/server')
  useServer.setState({
    client: { session } as unknown as OpencodeClient,
    connection: { baseUrl: 'http://127.0.0.1:4999', authorization: 'Basic abc', chatDirectory: CHAT } as never
  })
  const { useSessions } = await import('../../stores/sessions')
  useSessions.getState().upsertSession(makeSession('s1', CHAT))
  useSessions.getState().upsertSession(makeSession('kid', CHAT, { parentID: 's1' }))
  useSessions.getState().upsertSession(makeSession('s2', CHAT))
  useSessions.getState().upsertSession(makeSession('code1', '/otro'))
  const { useChat } = await import('./store')
  const actions = await import('./actions')
  const { routeEventToSessions } = await import('../../stores/eventRouter')
  return { session, useChat, actions, route: routeEventToSessions }
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('eventos mcp.elicitation.* en el Chat', () => {
  it('asked de una sesión de Chat queda pendiente (saneado); el de Code no entra; replied lo limpia', async () => {
    const { useChat, route } = await setup()
    route({ type: 'mcp.elicitation.asked', properties: asked('eli_1', 's1', { message: 'Hola\u202E' }) } as never, CHAT)
    route({ type: 'mcp.elicitation.asked', properties: asked('eli_c', 'code1') } as never, '/otro')
    expect(Object.keys(useChat.getState().elicitations)).toEqual(['eli_1'])
    expect(useChat.getState().elicitations.eli_1.message).toBe('Hola')
    route({ type: 'mcp.elicitation.replied', properties: { id: 'eli_1', sessionID: 's1', action: 'accept' } } as never, CHAT)
    expect(useChat.getState().elicitations).toEqual({})
  })

  it('un asked mal formado se ignora', async () => {
    const { useChat, route } = await setup()
    route({ type: 'mcp.elicitation.asked', properties: { id: 'x', sessionID: 's1' } } as never, CHAT)
    expect(useChat.getState().elicitations).toEqual({})
  })

  it('rejected: abort/server-cancel la quitan sin aviso; timeout con tarjeta, aviso; secret/schema/ambiguous sin tarjeta, aviso', async () => {
    const { useChat, route } = await setup()
    route({ type: 'mcp.elicitation.asked', properties: asked('eli_1', 's1') } as never, CHAT)
    route({ type: 'mcp.elicitation.rejected', properties: { id: 'eli_1', sessionID: 's1', reason: 'abort' } } as never, CHAT)
    expect(useChat.getState().elicitations).toEqual({})
    expect(useChat.getState().elicitationNotices).toEqual({})
    route({ type: 'mcp.elicitation.asked', properties: asked('eli_2', 's1') } as never, CHAT)
    route({ type: 'mcp.elicitation.rejected', properties: { id: 'eli_2', sessionID: 's1', reason: 'timeout' } } as never, CHAT)
    route({ type: 'mcp.elicitation.rejected', properties: { id: 'eli_3', sessionID: 's1', reason: 'secret' } } as never, CHAT)
    expect(useChat.getState().elicitations).toEqual({})
    expect(Object.values(useChat.getState().elicitationNotices).map((n) => n.reason)).toEqual(['timeout', 'secret'])
    // Un rechazo de otro modo no deja aviso en el Chat.
    route({ type: 'mcp.elicitation.rejected', properties: { id: 'eli_c', sessionID: 'code1', reason: 'secret' } } as never, '/otro')
    expect(useChat.getState().elicitationNotices.eli_c).toBeUndefined()
    useChat.getState().dismissElicitationNotice('eli_3')
    expect(Object.keys(useChat.getState().elicitationNotices)).toEqual(['eli_2'])
  })
})

describe('acciones del Chat', () => {
  it('loadChatElicitations reconstruye desde el servidor (solo sesiones de Chat); sin la ruta (404) no toca nada', async () => {
    const { useChat, actions } = await setup()
    useChat.getState().addElicitation(req('viejo', 's1'))
    fetchMock.mockResolvedValue(json([asked('eli_1', 's1'), asked('eli_c', 'code1')]))
    await actions.loadChatElicitations()
    expect(Object.keys(useChat.getState().elicitations)).toEqual(['eli_1'])
    expect(fetchMock.mock.calls[0]![0]).toBe(`http://127.0.0.1:4999/mcp/elicitation?directory=${encodeURIComponent(CHAT)}`)
    fetchMock.mockResolvedValue(json({}, 404))
    await actions.loadChatElicitations()
    expect(Object.keys(useChat.getState().elicitations)).toEqual(['eli_1'])
  })

  it('replyChatElicitation: ok o 404 quitan la tarjeta; 400 la deja con los motivos', async () => {
    const { useChat, actions } = await setup()
    const e = req('eli_1', 's1')
    useChat.getState().addElicitation(e)
    fetchMock.mockResolvedValueOnce(json({ errors: [{ campo: 'nombre', motivo: 'corto' }] }, 400))
    expect(await actions.replyChatElicitation(e, 'accept', { nombre: 'x' })).toEqual({
      ok: false,
      invalid: [{ campo: 'nombre', motivo: 'corto' }]
    })
    expect(Object.keys(useChat.getState().elicitations)).toEqual(['eli_1'])
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/mcp/elicitation/eli_1/reply')
    expect((init.headers as Record<string, string>).Authorization).toBe('Basic abc')
    fetchMock.mockResolvedValueOnce(json())
    expect(await actions.replyChatElicitation(e, 'accept', { nombre: 'Ana' })).toEqual({ ok: true })
    expect(useChat.getState().elicitations).toEqual({})
    useChat.getState().addElicitation(e)
    fetchMock.mockResolvedValueOnce(json({}, 404))
    expect(await actions.replyChatElicitation(e, 'decline')).toEqual({ ok: false, gone: true })
    expect(useChat.getState().elicitations).toEqual({})
  })

  it('Detener (abortChat) cancela los formularios de la conversación y de su ayudante, no los de otra', async () => {
    const { useChat, actions, session } = await setup()
    fetchMock.mockImplementation(async () => json())
    for (const [id, sid] of [
      ['eli_root', 's1'],
      ['eli_kid', 'kid'],
      ['eli_otra', 's2']
    ] as const)
      useChat.getState().addElicitation(req(id, sid))
    await actions.abortChat('s1')
    expect(session.abort).toHaveBeenCalledTimes(1)
    const sent = fetchMock.mock.calls.map((c) => ({ url: c[0] as string, body: JSON.parse((c[1] as RequestInit).body as string) }))
    expect(sent.map((p) => p.url.split('/mcp/elicitation/')[1]!.split('/reply')[0]).sort()).toEqual(['eli_kid', 'eli_root'])
    for (const p of sent) expect(p.body).toEqual({ action: 'cancel' })
    expect(Object.keys(useChat.getState().elicitations)).toEqual(['eli_otra'])
  })
})
