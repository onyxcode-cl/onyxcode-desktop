import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
const MODEL = { providerID: 'opencode', modelID: 'nuevo' }
const ATT = { name: 'a.txt', relPath: 'a.txt', path: '/tmp/p/a.txt' }
let tasks: typeof import('./store')
let actions: typeof import('./actions')
let sessions: typeof import('../../../stores/sessions').useSessions
let abort: ReturnType<typeof vi.fn>
let prompt: ReturnType<typeof vi.fn>
const state = () => tasks.useTasks.getState()
const sent = () => prompt.mock.calls.map(([p]) => p.parts[0].text)
const status = (run: 'busy' | 'idle' | 'retry') => sessions.getState().setStatus('s1', run)

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  tasks = await import('./store')
  actions = await import('./actions')
  ;({ useSessions: sessions } = await import('../../../stores/sessions'))
  abort = vi.fn(async () => {
    status('idle')
    return { data: true }
  })
  prompt = vi.fn(async () => ({ data: {} }))
  tasks.useTasks.setState({
    client: { session: { abort, promptAsync: prompt } } as never,
    folder: '/tmp/p',
    activeTaskId: 's1',
    phase: 'ready',
    conn: {
      folder: '/tmp/p',
      directory: '/tmp/p',
      pathMap: { kind: 'identity' },
      baseUrl: 'http://x',
      fullAccess: false,
      sandboxed: false
    } as never
  })
})

describe('Overdrive: envío durante retry sin cola', () => {
  it('elige otro modelo durante retry, aborta y envía con ese modelo y adjuntos', async () => {
    status('retry')
    tasks.setTaskModel(MODEL)
    tasks.useTasks.setState({ attachments: [ATT as never], draft: 'continúa' })
    expect(state().taskModel).toEqual(MODEL)
    await actions.sendToTask('continúa', tasks.currentTasksModel())
    expect(abort).toHaveBeenCalledWith({ sessionID: 's1', directory: '/tmp/p' })
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(prompt.mock.calls[0][0]).toMatchObject({ sessionID: 's1', model: MODEL })
    expect(sent()[0]).toContain('continúa')
    expect(sent()[0]).toContain('a.txt')
    expect(abort.mock.invocationCallOrder[0]).toBeLessThan(prompt.mock.invocationCallOrder[0])
    expect(state().attachments).toEqual([])
    expect(state().draft).toBe('')
    expect(state().sending).toBe(false)
  })

  it('busy no aborta ni envía; conserva el borrador y los adjuntos sin envío automático posterior', async () => {
    status('busy')
    tasks.useTasks.setState({ attachments: [ATT as never], draft: 'uno' })
    await actions.sendToTask('uno', MODEL)
    await actions.sendToTask('dos', MODEL)
    expect(state().attachments).toEqual([ATT])
    expect(state().draft).toBe('uno')
    expect(state().sending).toBe(false)
    status('retry')
    status('idle')
    await Promise.resolve()
    expect(abort).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
  })

  it.each(['respuesta', 'excepción'])('un fallo de abort (%s) no envía ni borra el borrador y los adjuntos', async (failure) => {
    if (failure === 'respuesta') abort.mockResolvedValueOnce({ error: new Error('sin red') })
    else abort.mockRejectedValueOnce(new Error('sin red'))
    status('retry')
    tasks.useTasks.setState({ attachments: [ATT as never], draft: 'uno' })
    await expect(actions.sendToTask('uno', MODEL)).rejects.toThrow('sin red')
    expect(state().attachments).toEqual([ATT])
    expect(state().draft).toBe('uno')
    expect(state().sending).toBe(false)
    expect(prompt).not.toHaveBeenCalled()
  })

  it('el rechazo del proveedor conserva el error completo tras abortar retry', async () => {
    const error = { name: 'APIError', data: { message: 'Allowance exhausted', statusCode: 429, isRetryable: false } }
    prompt.mockResolvedValueOnce({ error } as never)
    status('retry')
    await actions.sendToTask('uno', MODEL)
    expect(sessions.getState().errors.s1).toEqual(error)
    expect(sessions.getState().status.s1).toBe('idle')
    expect(state().sending).toBe(false)
  })

  it('un doble envío mientras aborta solo envía el primero', async () => {
    let release!: () => void
    abort.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ data: true })
        })
    )
    status('retry')
    const sending = actions.sendToTask('uno', MODEL)
    await actions.sendToTask('dos', MODEL)
    expect(state().sending).toBe(true)
    expect(prompt).not.toHaveBeenCalled()
    release()
    await sending
    expect(abort).toHaveBeenCalledTimes(1)
    expect(sent()).toEqual(['uno'])
  })

  it('cambiar de conversación durante abort no envía allí ni al volver', async () => {
    let release!: () => void
    abort.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ data: true })
        })
    )
    tasks.useTasks.setState({ attachments: [ATT as never], draft: 'uno' })
    status('retry')
    const sending = actions.sendToTask('uno', MODEL)
    tasks.useTasks.setState({ activeTaskId: 'otra' })
    release()
    await sending
    expect(prompt).not.toHaveBeenCalled()
    expect(state().draft).toBe('uno')
    expect(state().attachments).toEqual([ATT])
    tasks.useTasks.setState({ activeTaskId: 's1' })
    await Promise.resolve()
    expect(prompt).not.toHaveBeenCalled()
  })
})

it('error terminal del proveedor por evento persiste después de idle', () => {
  const error = { name: 'APIError', data: { message: 'Allowance exhausted', statusCode: 429, isRetryable: false } }
  sessions.getState().applyEvent({ id: 'quota-error', type: 'session.error', properties: { sessionID: 's1', error } } as never)
  status('idle')
  expect(sessions.getState().errors.s1).toEqual(error)
})
