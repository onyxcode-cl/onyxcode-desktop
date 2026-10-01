/**
 * R2-B: adjuntos de Chat. Viajan como partes `file` con URL `data:`; una URL `file://` (que el motor leería del disco
 * sin pasar por los permisos del agente `chat`) se rechaza antes de llegar al motor.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpencodeClient } from '../../lib/opencode'
import { makeSession } from '../../../../test/fixtures/events'

vi.mock('../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const CHAT = '/data/chat-workspace'
const PNG = 'data:image/png;base64,iVBORw0KGgo='

async function setup(promptAsync: (a: { parts: unknown[] }) => Promise<unknown>): Promise<{
  useSessions: (typeof import('../../stores/sessions'))['useSessions']
  sendChatMessage: (text: string, files?: { mime: string; filename?: string; url: string }[]) => Promise<boolean>
}> {
  const { useServer } = await import('../../stores/server')
  useServer.setState({
    client: { session: { promptAsync } } as unknown as OpencodeClient,
    connection: { baseUrl: 'http://x', authorization: 'a', chatDirectory: CHAT } as never
  })
  const aiGate = await import('../../lib/ai-gate')
  vi.spyOn(aiGate, 'currentAiGate').mockReturnValue({ effective: { providerID: 'p', modelID: 'm' }, gate: { blocked: false } } as never)
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

describe('sendChatMessage con adjuntos', () => {
  it('una imagen sin texto sale como una única parte file (sin bloque de texto vacío)', async () => {
    const promptAsync = vi.fn(() => Promise.resolve({ data: undefined }))
    const { sendChatMessage } = await setup(promptAsync)
    expect(await sendChatMessage('', [{ mime: 'image/png', filename: 'a.png', url: PNG }])).toBe(true)
    expect(promptAsync.mock.calls[0][0].parts).toEqual([{ type: 'file', mime: 'image/png', filename: 'a.png', url: PNG }])
  })

  it('texto + adjunto: texto primero y luego la parte file', async () => {
    const promptAsync = vi.fn(() => Promise.resolve({ data: undefined }))
    const { sendChatMessage } = await setup(promptAsync)
    await sendChatMessage('mira', [{ mime: 'image/png', url: PNG }])
    expect(promptAsync.mock.calls[0][0].parts.map((p) => (p as { type: string }).type)).toEqual(['text', 'file'])
  })

  it('rechaza una URL file:// sin llamar al motor y sin dejar la sesión ocupada', async () => {
    const promptAsync = vi.fn(() => Promise.resolve({ data: undefined }))
    const { sendChatMessage, useSessions } = await setup(promptAsync)
    await expect(sendChatMessage('x', [{ mime: 'text/plain', url: 'file:///etc/passwd' }])).rejects.toThrow()
    expect(promptAsync).not.toHaveBeenCalled()
    expect(useSessions.getState().status['c1'] ?? 'idle').toBe('idle')
  })

  it('con la red caída lanza, la sesión vuelve a idle (el compositor restaura texto y adjuntos)', async () => {
    const { sendChatMessage, useSessions } = await setup(() => Promise.reject(new Error('red caída')))
    await expect(sendChatMessage('hola', [{ mime: 'image/png', url: PNG }])).rejects.toThrow('red caída')
    expect(useSessions.getState().status['c1']).toBe('idle')
  })
})
