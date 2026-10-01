/**
 * Calidad T2 · M2/H2: `editAndRetry` y `retryLast` revierten desde el mensaje y reenvían el texto (editado) con los
 * mismos adjuntos, sin duplicar el mensaje; si el envío falla se deshace el revert.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assistantMessage, makeSession, resetEventIds, sessionCreated, textPart, userMessage } from '../../../../../test/fixtures/events'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

type Store = typeof import('./store')
let useCode: Store['useCode']
let useServer: (typeof import('../../../stores/server'))['useServer']
const D = '/work/code'
const IMG = { id: 'prt_i', type: 'file', mime: 'image/png', filename: 'cap.png', url: 'data:image/png;base64,AAAA' }

function install(promptAsync: () => Promise<unknown> = () => Promise.resolve({ data: {} })) {
  const calls: string[] = []
  const session = {
    revert: vi.fn(
      async (p: { messageID: string }) => (
        calls.push(`revert:${p.messageID}`),
        { data: makeSession('s1', D, { revert: { messageID: p.messageID } }) }
      )
    ),
    unrevert: vi.fn(async () => (calls.push('unrevert'), { data: makeSession('s1', D) })),
    promptAsync: vi.fn(async () => (calls.push('prompt'), promptAsync())),
    abort: vi.fn(async () => ({ data: true })),
    status: vi.fn(async () => ({ data: {} })),
    messages: vi.fn(async () => ({ data: [] }))
  }
  useServer.setState({ client: { session } as never })
  return { session, calls }
}

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  resetEventIds()
  ;({ useCode } = await import('./store'))
  ;({ useServer } = await import('../../../stores/server'))
  useCode.setState({ directory: D })
  useCode.getState().applyEvent(sessionCreated(makeSession('s1', D)).event, D)
  useCode.setState({
    activeSessionID: 's1',
    messages: {
      s1: [
        { info: userMessage('m1', 's1'), parts: [textPart('p1', 'm1', 's1', 'uno')] },
        { info: assistantMessage('m2', 's1'), parts: [textPart('p2', 'm2', 's1', 'r1')] },
        { info: userMessage('m3', 's1'), parts: [textPart('p3', 'm3', 's1', 'dos'), IMG as never] },
        { info: assistantMessage('m4', 's1'), parts: [] }
      ]
    }
  })
})

describe('editAndRetry', () => {
  it('revierte desde el mensaje, oculta lo posterior y envía el texto editado con el adjunto original', async () => {
    const { session, calls } = install()
    expect(await useCode.getState().editAndRetry('m3', ' dos editado ')).toBe(true)
    expect(calls).toEqual(['revert:m3', 'prompt'])
    expect((session.promptAsync.mock.calls[0] as unknown as [{ parts: unknown[] }])[0].parts).toEqual([
      { type: 'text', text: 'dos editado' },
      { type: 'file', mime: 'image/png', filename: 'cap.png', url: IMG.url }
    ])
    expect(useCode.getState().messages['s1'].map((m) => m.info.id)).toEqual(['m1', 'm2'])
  })

  it('retryLast reenvía el último mensaje del usuario sin cambiarlo', async () => {
    const { session } = install()
    expect(await useCode.getState().retryLast()).toBe(true)
    expect(session.revert).toHaveBeenCalledWith(expect.objectContaining({ messageID: 'm3' }))
    const parts = (session.promptAsync.mock.calls[0] as unknown as [{ parts: { type: string; text?: string }[] }])[0].parts
    expect(parts[0]).toEqual({ type: 'text', text: 'dos' })
  })

  it('si el envío falla deshace el revert y recarga', async () => {
    const { calls, session } = install(() => Promise.reject(new Error('red caída')))
    expect(await useCode.getState().editAndRetry('m3', 'dos')).toBe(false)
    expect(calls).toEqual(['revert:m3', 'prompt', 'unrevert'])
    expect(session.messages).toHaveBeenCalled()
    expect(useCode.getState().runState['s1']).toBe('idle')
  })

  it('texto vacío sin adjuntos no envía nada', async () => {
    const { session } = install()
    expect(await useCode.getState().editAndRetry('m1', '  ')).toBe(false)
    expect(session.revert).not.toHaveBeenCalled()
  })
})
