import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSession, resetEventIds, sessionCreated, statusBusy, statusIdle } from '../../../../../test/fixtures/events'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
const D = '/work/code'
const MODEL = { providerID: 'opencode', modelID: 'nuevo' }
const IMG = { id: 'a1', name: 'captura.png', mime: 'image/png', url: 'data:image/png;base64,AAAA' }
let code: typeof import('./store').useCode
let abort: ReturnType<typeof vi.fn>
let prompt: ReturnType<typeof vi.fn>
let eventId = 0
const state = () => code.getState()
const status = (type: 'busy' | 'idle' | 'retry') =>
  state().applyEvent(
    {
      id: `retry-test-${++eventId}`,
      type: 'session.status',
      properties: { sessionID: 's1', status: { type, attempt: 1, message: 'quota exhausted', next: Date.now() + 900_000 } }
    } as never,
    D
  )
const queued = () => (state().queue.s1 ?? []).map((m) => m.text)
const sent = () => prompt.mock.calls.map(([p]) => p.parts[0].text)

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  resetEventIds()
  ;({ useCode: code } = await import('./store'))
  const { useServer } = await import('../../../stores/server')
  abort = vi.fn(async () => {
    // Ambos avisos de fin pueden llegar mientras se espera la respuesta de abort.
    status('idle')
    state().applyEvent({ id: `abort-idle-${++eventId}`, type: 'session.idle', properties: { sessionID: 's1' } } as never, D)
    return { data: true }
  })
  prompt = vi.fn(async () => ({ data: {} }))
  useServer.setState({
    client: {
      session: {
        abort,
        promptAsync: prompt,
        update: async (p: { sessionID: string; permission: unknown }) => ({ data: { id: p.sessionID, permission: p.permission } })
      }
    } as never
  })
  code.setState({ directory: D, activeSessionID: 's1' })
  state().applyEvent(sessionCreated(makeSession('s1', D)).event, D)
})

describe('Código: envío normal durante retry', () => {
  it('elige el modelo nuevo sin esperar y aborta antes de enviar', async () => {
    status('retry')
    state().setModel(MODEL)
    expect(state().model).toEqual(MODEL)
    expect(await state().submit('continúa')).toBe(true)
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
    expect(abort).toHaveBeenCalledWith({ sessionID: 's1', directory: D })
    expect(abort.mock.invocationCallOrder[0]).toBeLessThan(prompt.mock.invocationCallOrder[0])
    expect(prompt.mock.calls[0][0]).toMatchObject({ sessionID: 's1', model: MODEL })
    expect(queued()).toEqual([])
  })

  it('busy mantiene la cola y no aborta ni envía', async () => {
    status('busy')
    await state().submit('uno', [], [IMG])
    await state().submit('dos')
    expect(queued()).toEqual(['uno', 'dos'])
    expect(state().queue.s1[0].attachments).toEqual([IMG])
    expect(abort).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
  })

  it('al pasar a retry interrumpe y conserva FIFO, adjuntos y un solo envío por turno', async () => {
    status('busy')
    await state().submit('uno', [], [IMG])
    await state().submit('dos')
    status('retry')
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
    expect(sent()).toEqual(['uno'])
    expect(prompt.mock.calls[0][0].parts[1]).toMatchObject({ type: 'file', url: IMG.url })
    expect(queued()).toEqual(['dos'])
    state().applyEvent(statusBusy('s1', D).event, D)
    state().applyEvent(statusIdle('s1', D).event, D)
    await vi.waitFor(() => expect(sent()).toEqual(['uno', 'dos']))
    expect(queued()).toEqual([])
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('un envío nuevo mientras abort está pendiente queda detrás de los anteriores', async () => {
    let release!: () => void
    abort.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ data: true })
        })
    )
    status('busy')
    await state().submit('uno')
    await state().submit('dos')
    status('retry')
    await state().submit('tres')
    expect(queued()).toEqual(['uno', 'dos', 'tres'])
    release()
    await vi.waitFor(() => expect(sent()).toEqual(['uno']))
    expect(queued()).toEqual(['dos', 'tres'])
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it.each(['abort', 'prompt'])('si falla %s conserva todos los pendientes', async (failure) => {
    if (failure === 'abort') abort.mockResolvedValueOnce({ error: new Error('sin red') })
    else prompt.mockRejectedValueOnce(new Error('sin red'))
    status('busy')
    await state().submit('uno', [], [IMG])
    await state().submit('dos')
    status('retry')
    await vi.waitFor(() => expect(state().errors.s1).toBeTruthy())
    await vi.waitFor(() => expect(queued()).toEqual(['uno', 'dos']))
    expect(state().queue.s1[0].attachments).toEqual([IMG])
    if (failure === 'abort') expect(prompt).not.toHaveBeenCalled()
  })
})

it('session.error conserva statusCode y detalle del proveedor después de idle', () => {
  const error = { name: 'APIError', data: { message: 'Allowance exhausted', statusCode: 429, isRetryable: false } }
  status('busy')
  state().applyEvent({ id: 'quota-error', type: 'session.error', properties: { sessionID: 's1', error } } as never, D)
  status('idle')
  expect(state().errors.s1).toEqual(error)
})

it('tras un envío rechazado, un mensaje nuevo reintenta primero el pendiente conservado', async () => {
  status('retry')
  prompt.mockRejectedValueOnce(new Error('sin red'))
  await state().submit('primero', [], [IMG])
  await vi.waitFor(() => expect(state().runState.s1).toBe('idle'))
  await vi.waitFor(() => expect(queued()).toEqual(['primero']))
  await state().submit('segundo')
  await vi.waitFor(() => expect(sent()).toEqual(['primero', 'primero']))
  expect(queued()).toEqual(['segundo'])
})
