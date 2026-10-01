/**
 * Calidad T2 · H2/M2/M10: «Reintentar» y «Editar y reintentar» deshacen la conversación (`session.revert`) y reenvían
 * las partes del mensaje de usuario sin duplicarlo ni perder adjuntos; «Compactar» resume con `session.summarize`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpencodeClient } from '../../lib/opencode'
import { assistantMessage, makeSession, textPart, userMessage } from '../../../../test/fixtures/events'

vi.mock('../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const CHAT = '/data/chat-workspace'
const FILE = { id: 'prt_f', type: 'file', mime: 'image/png', filename: 'a.png', url: 'data:image/png;base64,AAAA' }

async function setup(opts: { promptAsync?: () => Promise<unknown> } = {}) {
  const calls: string[] = []
  const session = {
    revert: vi.fn(
      async (p: { messageID: string }) => (
        calls.push(`revert:${p.messageID}`),
        { data: makeSession('c1', CHAT, { revert: { messageID: p.messageID } }) }
      )
    ),
    unrevert: vi.fn(async () => (calls.push('unrevert'), { data: makeSession('c1', CHAT) })),
    promptAsync: vi.fn(async (_p: unknown) => (calls.push('prompt'), opts.promptAsync ? opts.promptAsync() : { data: undefined })),
    abort: vi.fn(async () => ({ data: true })),
    status: vi.fn(async () => ({ data: {} })),
    summarize: vi.fn(async () => ({ data: true })),
    messages: vi.fn(async () => ({ data: [] }))
  }
  const { useServer } = await import('../../stores/server')
  useServer.setState({
    client: { session } as unknown as OpencodeClient,
    connection: { baseUrl: 'http://x', authorization: 'a', chatDirectory: CHAT } as never
  })
  const aiGate = await import('../../lib/ai-gate')
  vi.spyOn(aiGate, 'currentAiGate').mockReturnValue({ effective: { providerID: 'p', modelID: 'm' }, gate: { blocked: false } } as never)
  const { useSessions } = await import('../../stores/sessions')
  const { useChat } = await import('./store')
  useSessions.getState().upsertSession(makeSession('c1', CHAT))
  useSessions.setState({
    loaded: { c1: true },
    messages: {
      c1: [
        { info: userMessage('m1', 'c1'), parts: [textPart('p1', 'm1', 'c1', 'primero')] },
        { info: assistantMessage('m2', 'c1'), parts: [textPart('p2', 'm2', 'c1', 'resp 1')] },
        { info: userMessage('m3', 'c1'), parts: [textPart('p3', 'm3', 'c1', 'segundo'), FILE as never] },
        { info: assistantMessage('m4', 'c1', { error: { name: 'APIError', data: { message: 'x', statusCode: 429 } } as never }), parts: [] }
      ]
    }
  })
  useChat.getState().setActive('c1')
  const actions = await import('./actions')
  return { session, useSessions, calls, ...actions }
}

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('retryChat', () => {
  it('revierte hasta el último mensaje del usuario y reenvía texto y adjuntos (un solo mensaje, sin duplicar)', async () => {
    const { session, useSessions, calls, retryChat } = await setup()
    expect(await retryChat('c1')).toBe(true)
    expect(calls).toEqual(['revert:m3', 'prompt'])
    const parts = (session.promptAsync.mock.calls[0][0] as { parts: unknown[] }).parts
    expect(parts).toEqual([
      { type: 'text', text: 'segundo' },
      { type: 'file', mime: 'image/png', filename: 'a.png', url: FILE.url }
    ])
    // Lo posterior (y el propio mensaje, que el motor vuelve a crear) ya no está en pantalla.
    expect(useSessions.getState().messages['c1'].map((e) => e.info.id)).toEqual(['m1', 'm2'])
  })

  it('un mensaje solo con adjunto se reenvía sin bloque de texto vacío', async () => {
    const { session, useSessions, retryChat } = await setup()
    useSessions.setState((s) => ({
      messages: { c1: [...s.messages['c1'].slice(0, 2), { info: userMessage('m5', 'c1'), parts: [FILE as never] }] }
    }))
    expect(await retryChat('c1')).toBe(true)
    expect((session.promptAsync.mock.calls[0][0] as { parts: { type: string }[] }).parts.map((p) => p.type)).toEqual(['file'])
  })

  it('si el motor rechaza el envío deshace el revert y recarga (no deja la conversación recortada)', async () => {
    const { session, calls, retryChat } = await setup({ promptAsync: async () => ({ error: { message: 'boom' } }) })
    expect(await retryChat('c1')).toBe(false)
    expect(calls).toEqual(['revert:m3', 'prompt', 'unrevert'])
    expect(session.messages).toHaveBeenCalled()
  })

  it('sin mensajes de usuario no hace nada', async () => {
    const { session, useSessions, retryChat } = await setup()
    useSessions.setState({ messages: { c1: [] } })
    expect(await retryChat('c1')).toBe(false)
    expect(session.revert).not.toHaveBeenCalled()
  })
})

describe('resendFromMessage (editar y reintentar)', () => {
  it('editar un mensaje antiguo descarta lo posterior y envía el texto editado con los adjuntos de ese mensaje', async () => {
    const { session, useSessions, resendFromMessage } = await setup()
    expect(await resendFromMessage('c1', 'm1', '  primero editado ')).toBe(true)
    expect(session.revert).toHaveBeenCalledWith(expect.objectContaining({ messageID: 'm1' }))
    expect((session.promptAsync.mock.calls[0][0] as { parts: unknown[] }).parts).toEqual([{ type: 'text', text: 'primero editado' }])
    expect(useSessions.getState().messages['c1']).toEqual([])
  })

  it('si la conversación está ocupada la detiene antes de revertir', async () => {
    const { session, useSessions, resendFromMessage } = await setup()
    useSessions.getState().setStatus('c1', 'busy')
    await resendFromMessage('c1', 'm3', 'otra cosa')
    expect(session.abort).toHaveBeenCalled()
  })
})

describe('compactChat', () => {
  it('resume con session.summarize y deja la conversación ocupada hasta el evento de fin', async () => {
    const { session, useSessions, compactChat } = await setup()
    useSessions.getState().setError('c1', { name: 'ContextOverflowError', data: { message: 'x' } } as never)
    await compactChat('c1')
    expect(session.summarize).toHaveBeenCalledWith(expect.objectContaining({ sessionID: 'c1', providerID: 'p', modelID: 'm' }))
    expect(useSessions.getState().errors['c1']).toBeNull()
    expect(useSessions.getState().status['c1']).toBe('busy')
  })

  it('si falla vuelve a idle con el error', async () => {
    const { session, useSessions, compactChat } = await setup()
    session.summarize.mockResolvedValueOnce({ error: { message: 'no' } } as never)
    await compactChat('c1')
    expect(useSessions.getState().status['c1']).toBe('idle')
    expect(useSessions.getState().errors['c1']).toBeTruthy()
  })
})
