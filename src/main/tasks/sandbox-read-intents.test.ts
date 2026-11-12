import { describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ event: vi.fn(), client: vi.fn() }))
vi.mock('@opencode-ai/sdk/v2/client', () => ({ createOpencodeClient: mock.client }))
import { readIntent, requestsRead, sandboxReadIntentSource } from './sandbox-read-intents'

const part = (status = 'running', input: unknown = { command: 'cat /home/.ssh/id' }) => ({
  payload: {
    type: 'message.part.updated',
    properties: { part: { id: 't1', type: 'tool', tool: 'bash', state: { status, input, time: { start: 100, end: 200 } } } }
  }
})
describe('evidencia de lectura pedida por el modelo', () => {
  it('solo admite herramientas ejecutadas con argumentos y tiempos válidos', () => {
    expect(readIntent(part(), 150)).toMatchObject({ id: 't1', start: 100 })
    expect(readIntent(part('completed'), 250)?.end).toBe(200)
    expect(readIntent(part('error'), 250)?.end).toBe(200)
    for (const event of [
      null,
      {},
      { payload: { type: 'session.status' } },
      part('pending'),
      part('running', null),
      part('running', { x: 'x'.repeat(40_000) })
    ]) {
      expect(readIntent(event, 250)).toBeNull()
    }
    expect(readIntent(part(), 50)).toBeNull()
    const todo = part()
    todo.payload.properties.part.tool = 'todowrite'
    expect(readIntent(todo, 250)).toBeNull()
  })
  it.each([
    [{ filePath: '/home/.ssh/id' }, '/home/.ssh/id', true],
    [{ command: 'cat /home/.ssh/id' }, '/home/.ssh/id', true],
    [{ command: 'python -c "open(\'/home/.ssh/id\').read()"' }, '/home/.ssh/id', true],
    [{ filePath: '../privado/id' }, '/work/privado/id', true],
    [{ filePath: '/var/secret' }, '/private/var/secret', true],
    [{ command: 'cat "/home/Library/Application Support/secreto"' }, '/home/Library/Application Support/secreto', true],
    [{ command: 'git status' }, '/home/.config/git/config', false],
    [{ command: 'python programa.py' }, '/home/.config/python', false],
    [{ command: 'cat /home/.ssh/id.backup' }, '/home/.ssh/id', false],
    [{ command: 'cat /home/.ssh/id' }, '/home/.ssh', true]
  ])('comprueba el destino exacto: %j → %s', (input, path, expected) => {
    expect(requestsRead({ id: 't1', input, start: 100, end: 200 }, path, '/work/tarea', 150)).toBe(expected)
  })
  it('no atribuye una negación anterior o posterior a la herramienta', () => {
    const intent = readIntent(part('completed'), 250)!
    expect(requestsRead(intent, '/home/.ssh/id', '/work', 99)).toBe(false)
    expect(requestsRead(intent, '/home/.ssh/id', '/work', 1201)).toBe(false)
  })
  it('abre el flujo con autorización local, filtra eventos y termina al abortar', async () => {
    const ctl = new AbortController()
    mock.client.mockReturnValue({ global: { event: mock.event } })
    mock.event.mockImplementation(async () => ({
      stream: (async function* () {
        yield {}
        yield part()
        ctl.abort()
      })()
    }))
    const receive = vi.fn()
    await sandboxReadIntentSource(12345, { OPENCODE_SERVER_USERNAME: 'fixture', OPENCODE_SERVER_PASSWORD: 'fixture' })(receive, ctl.signal)
    expect(receive).toHaveBeenCalledOnce()
    expect(mock.client).toHaveBeenCalledWith({
      baseUrl: 'http://127.0.0.1:12345',
      headers: { Authorization: 'Basic Zml4dHVyZTpmaXh0dXJl' }
    })
    expect(mock.event).toHaveBeenCalledOnce()
  })
})
