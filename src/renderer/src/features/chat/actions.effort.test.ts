import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Provider } from '@opencode-ai/sdk/v2/client'
import type { OpencodeClient } from '../../lib/opencode'
import { makeSession, textPart, userMessage } from '../../../../test/fixtures/events'

vi.mock('../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
const MODEL = { providerID: 'p', modelID: 'm' }
const CHAT = '/data/chat-workspace'

async function setup() {
  const session = {
    promptAsync: vi.fn(async (_body: unknown) => ({ data: undefined })),
    create: vi.fn(async () => ({ data: makeSession('new', CHAT) })),
    revert: vi.fn(async () => ({ data: makeSession('c1', CHAT) })),
    abort: vi.fn(async () => ({ data: true })),
    status: vi.fn(async () => ({ data: {} }))
  }
  const { useServer } = await import('../../stores/server')
  useServer.setState({
    client: { session } as unknown as OpencodeClient,
    connection: { baseUrl: 'http://x', authorization: 'test', chatDirectory: CHAT } as never
  })
  const aiGate = await import('../../lib/ai-gate')
  vi.spyOn(aiGate, 'currentAiGate').mockReturnValue({ effective: MODEL, gate: { blocked: false } } as never)
  const { useProviders } = await import('../../stores/providers')
  useProviders.setState({
    loaded: true,
    providers: [
      { id: 'p', models: { m: { variants: { low: {}, medium: {}, high: {} } }, b: { variants: { low: {} } }, plain: {} } }
    ] as unknown as Provider[]
  })
  const { useSessions } = await import('../../stores/sessions')
  useSessions.getState().upsertSession(makeSession('c1', CHAT))
  useSessions.setState({
    loaded: { c1: true },
    messages: { c1: [{ info: userMessage('m1', 'c1'), parts: [textPart('p1', 'm1', 'c1', 'hola')] }] }
  })
  const { useChat } = await import('./store')
  useChat.getState().setActive('c1')
  const actions = await import('./actions')
  return { session, useChat, useSessions, useProviders, ...actions }
}

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('Chat: esfuerzo por conversación', () => {
  it('envía el identificador dentro de model y omite la propiedad en estándar', async () => {
    const a = await setup()
    a.setChatVariant('medium')
    await a.sendChatMessage('hola')
    expect(a.session.promptAsync).toHaveBeenLastCalledWith(expect.objectContaining({ model: MODEL, variant: 'medium' }))
    a.setChatVariant(null)
    await a.sendChatMessage('hola')
    const model = (a.session.promptAsync.mock.calls[1][0] as { model: object }).model
    expect(model).toEqual(MODEL)
    expect(model).not.toHaveProperty('variant')
    expect(a.session.promptAsync.mock.calls[1][0]).not.toHaveProperty('variant')
  })

  it('reintentar y reenviar usan el nivel de la conversación', async () => {
    const a = await setup()
    a.setChatVariant('high')
    await a.retryChat('c1')
    expect(a.session.promptAsync).toHaveBeenLastCalledWith(expect.objectContaining({ model: MODEL, variant: 'high' }))
    a.useSessions.setState({ messages: { c1: [{ info: userMessage('m1', 'c1'), parts: [textPart('p1', 'm1', 'c1', 'hola')] }] } })
    await a.resendFromMessage('c1', 'm1', 'editado')
    expect(a.session.promptAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: MODEL, variant: 'high', parts: [{ type: 'text', text: 'editado' }] })
    )
  })

  it('conserva cada conversación y una nueva hereda el último nivel elegido, también al crearla', async () => {
    const a = await setup()
    a.setChatVariant('medium')
    a.useChat.getState().setActive('c2')
    expect(a.currentChatVariant()).toBeNull()
    a.setChatVariant('low')
    a.useChat.getState().setActive('c1')
    expect(a.currentChatVariant()).toBe('medium')
    a.newChat()
    expect(a.currentChatVariant()).toBe('low')
    await a.sendChatMessage('nueva')
    expect(a.useChat.getState().variants.new).toBe('low')
    expect(a.session.promptAsync).toHaveBeenLastCalledWith(expect.objectContaining({ sessionID: 'new', model: MODEL, variant: 'low' }))
    expect(JSON.parse(localStorage.getItem('chat.effort')!)).toEqual({
      variants: { c1: 'medium', c2: 'low', new: 'low' },
      lastVariant: 'low'
    })
    vi.resetModules()
    const { useChat } = await import('./store')
    expect(useChat.getState().variants.c1).toBe('medium')
    expect(useChat.getState().lastVariant).toBe('low')
  })

  it('mantiene un nivel compatible y vuelve a estándar al cambiar a un modelo incompatible o sin variantes', async () => {
    const a = await setup()
    a.setChatVariant('low')
    a.setChatModel({ providerID: 'p', modelID: 'b' })
    expect(a.currentChatVariant()).toBe('low')
    a.setChatVariant('high')
    a.setChatModel({ providerID: 'p', modelID: 'b' })
    expect(a.currentChatVariant()).toBeNull()
    a.setChatVariant('medium')
    a.setChatModel({ providerID: 'p', modelID: 'plain' })
    expect(a.currentChatVariant()).toBeNull()
  })

  it('no descarta el nivel antes de cargar proveedores y comprueba compatibilidad de nuevo al enviar', async () => {
    const a = await setup()
    a.setChatVariant('xhigh')
    a.useProviders.setState({ providers: [], loaded: false })
    expect(a.reconcileChatVariant(MODEL)).toBe('xhigh')
    a.useProviders.setState({ loaded: true })
    await a.sendChatMessage('hola')
    expect(a.currentChatVariant()).toBeNull()
    expect(a.session.promptAsync).toHaveBeenCalledWith(expect.objectContaining({ model: MODEL }))
  })
})
