/**
 * Chat: instrucciones personalizadas y memoria aprobada llegan al motor en el `system` de cada mensaje (para cualquier
 * proveedor, porque es el campo estándar del prompt) y nunca desde el celular.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpencodeClient } from '../../lib/opencode'
import { REMOTE_SURFACE } from '@shared/platform-caps'
import { makeSession } from '../../../../test/fixtures/events'

vi.mock('../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const CHAT = '/data/chat-workspace'
type Win = { api?: Record<string, unknown> & { platform?: string } }

async function setup(opts: { instructions?: string; learningEnabled?: boolean; notes?: string[] }): Promise<{
  send: (t: string) => Promise<boolean>
  promptAsync: ReturnType<typeof vi.fn>
  invoke: ReturnType<typeof vi.fn>
}> {
  const promptAsync = vi.fn(() => Promise.resolve({ data: undefined }))
  const invoke = vi.fn(() =>
    Promise.resolve({
      ok: true,
      data: {
        usuario: (opts.notes ?? []).map((texto, i) => ({ id: `0000000${i}`, tipo: 'preferencia', texto, fecha: '2026-10-16' })),
        proyecto: []
      }
    })
  )
  ;(globalThis as unknown as { window: Win }).window.api!.tasks = { invoke, on: vi.fn() }
  const { useServer } = await import('../../stores/server')
  useServer.setState({
    client: { session: { promptAsync } } as unknown as OpencodeClient,
    connection: { baseUrl: 'http://x', authorization: 'a', chatDirectory: CHAT } as never
  })
  const { useSettings } = await import('../../stores/settings')
  useSettings.setState({
    settings: {
      ...useSettings.getState().settings,
      defaultModel: { providerID: 'p', modelID: 'm' },
      userInstructions: opts.instructions ?? '',
      learningEnabled: opts.learningEnabled ?? true
    }
  })
  const aiGate = await import('../../lib/ai-gate')
  vi.spyOn(aiGate, 'currentAiGate').mockReturnValue({ effective: { providerID: 'p', modelID: 'm' }, gate: { blocked: false } } as never)
  const { useSessions } = await import('../../stores/sessions')
  const { useChat } = await import('./store')
  useSessions.getState().upsertSession(makeSession('c1', CHAT))
  useChat.getState().setActive('c1')
  const { sendChatMessage } = await import('./actions')
  return { send: sendChatMessage, promptAsync, invoke }
}

const systemOf = (p: ReturnType<typeof vi.fn>): string | undefined => (p.mock.calls[0] as unknown as [{ system?: string }])[0].system

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  localStorage.clear()
  ;(globalThis as unknown as { window: Win }).window.api!.platform = 'darwin'
})

describe('sendChatMessage: system con instrucciones y memoria', () => {
  it('lleva la instrucción de la persona y la nota aprobada, y relee la memoria en cada envío', async () => {
    const { send, promptAsync, invoke } = await setup({ instructions: 'responde siempre en una frase', notes: ['me llamo Ana'] })
    await send('hola')
    const sys = systemOf(promptAsync)
    expect(sys).toContain('responde siempre en una frase')
    expect(sys).toContain('me llamo Ana')
    expect(sys).toContain('lazunox-memoria')
    expect(invoke).toHaveBeenCalledWith('tasks:mem:get', {})
  })

  it('con la memoria apagada: no lee ni manda notas, pero las instrucciones siguen', async () => {
    const { send, promptAsync, invoke } = await setup({ instructions: 'sé breve', learningEnabled: false, notes: ['me llamo Ana'] })
    await send('hola')
    const sys = systemOf(promptAsync)
    expect(sys).toContain('sé breve')
    expect(sys).not.toContain('me llamo Ana')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('si la lectura de la memoria falla, el mensaje sale igual (con las instrucciones)', async () => {
    const { send, promptAsync, invoke } = await setup({ instructions: 'sé breve', notes: ['x'] })
    invoke.mockRejectedValueOnce(new Error('ipc'))
    expect(await send('hola')).toBe(true)
    expect(systemOf(promptAsync)).toContain('sé breve')
  })

  it('desde el celular el system nunca se manda', async () => {
    ;(globalThis as unknown as { window: Win }).window.api!.platform = REMOTE_SURFACE
    const { send, promptAsync } = await setup({ instructions: 'sé breve', notes: ['me llamo Ana'] })
    await send('hola')
    expect(systemOf(promptAsync)).toBeUndefined()
  })
})
