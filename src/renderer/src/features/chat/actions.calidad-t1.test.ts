/**
 * Calidad T1 · H4/H3: `sendChatMessage` no deja la sesión «ocupada» si el motor no responde (excepción o error)
 * y devuelve si el envío fue aceptado (el compositor restaura el borrador si no).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpencodeClient } from '../../lib/opencode'
import { makeSession } from '../../../../test/fixtures/events'

vi.mock('../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const CHAT = '/data/chat-workspace'

async function setup(promptAsync: () => Promise<unknown>): Promise<{
  useSessions: (typeof import('../../stores/sessions'))['useSessions']
  sendChatMessage: (text: string) => Promise<boolean>
}> {
  const { useServer } = await import('../../stores/server')
  useServer.setState({
    client: { session: { promptAsync } } as unknown as OpencodeClient,
    connection: { baseUrl: 'http://x', authorization: 'a', chatDirectory: CHAT } as never
  })
  const { useSettings } = await import('../../stores/settings')
  useSettings.setState({ settings: { ...useSettings.getState().settings, defaultModel: { providerID: 'p', modelID: 'm' } } })
  const aiGate = await import('../../lib/ai-gate')
  vi.spyOn(aiGate, 'currentAiGate').mockReturnValue({
    effective: { providerID: 'p', modelID: 'm' },
    gate: { blocked: false }
  } as never)
  const { useSessions } = await import('../../stores/sessions')
  const { useChat } = await import('./store')
  useSessions.getState().upsertSession(makeSession('c1', CHAT))
  useChat.getState().setActive('c1')
  const { sendChatMessage } = await import('./actions')
  return { useSessions, sendChatMessage }
}

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('sendChatMessage', () => {
  it('H4: si promptAsync lanza, la sesión vuelve a idle y se propaga el error', async () => {
    const { useSessions, sendChatMessage } = await setup(() => Promise.reject(new Error('red caída')))
    await expect(sendChatMessage('hola')).rejects.toThrow('red caída')
    expect(useSessions.getState().status['c1']).toBe('idle')
  })

  it('H4/H3: con error del servidor vuelve a idle, deja el error y devuelve false', async () => {
    const { useSessions, sendChatMessage } = await setup(() => Promise.resolve({ error: { message: 'boom' } }))
    expect(await sendChatMessage('hola')).toBe(false)
    expect(useSessions.getState().status['c1']).toBe('idle')
    expect(useSessions.getState().errors['c1']).toBeTruthy()
  })

  it('envío aceptado: devuelve true y la sesión queda ocupada', async () => {
    const { useSessions, sendChatMessage } = await setup(() => Promise.resolve({ data: undefined }))
    expect(await sendChatMessage('hola')).toBe(true)
    expect(useSessions.getState().status['c1']).toBe('busy')
  })
})
