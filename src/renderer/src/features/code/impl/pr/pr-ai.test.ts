import { beforeEach, describe, expect, it, vi } from 'vitest'

const client = {
  session: {
    create: vi.fn(),
    promptAsync: vi.fn(),
    messages: vi.fn(),
    abort: vi.fn(),
    delete: vi.fn()
  }
}
vi.mock('../client', () => ({
  requireClient: () => client,
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e))
}))
let gate: { effective: { providerID: string; modelID: string } | null; gate: { blocked: boolean } } = {
  effective: { providerID: 'opencode', modelID: 'deepseek-v4.1-flash-free' },
  gate: { blocked: false }
}
vi.mock('../../../../lib/ai-gate', () => ({ currentAiGate: () => gate }))
vi.mock('../../../settings/impl/extras', () => ({ resolveModelForMode: () => ({ providerID: 'x', modelID: 'y' }) }))

import { askModel, finishedAnswer } from './pr-ai'

const assistant = (text: string, done = true, error?: unknown): unknown => ({
  info: { role: 'assistant', time: done ? { completed: 1 } : {}, ...(error ? { error } : {}) },
  parts: [{ type: 'text', text }]
})
const noWait = { sleep: () => Promise.resolve() }

beforeEach(() => {
  for (const f of Object.values(client.session)) f.mockReset()
  gate = { effective: { providerID: 'opencode', modelID: 'deepseek-v4.1-flash-free' }, gate: { blocked: false } }
  client.session.create.mockResolvedValue({ data: { id: 'ses_1' } })
  client.session.promptAsync.mockResolvedValue({})
  client.session.abort.mockResolvedValue({})
  client.session.delete.mockResolvedValue({})
})

describe('finishedAnswer', () => {
  it('solo devuelve la respuesta cuando está completa', () => {
    expect(finishedAnswer([])).toBeNull()
    expect(finishedAnswer([{ info: { role: 'user' }, parts: [{ type: 'text', text: 'hola' }] }])).toBeNull()
    expect(finishedAnswer([assistant('a medias', false)] as never)).toBeNull()
    expect(finishedAnswer([assistant('listo')] as never)).toBe('listo')
  })
  it('ignora partes que no son texto o sintéticas', () => {
    expect(
      finishedAnswer([
        {
          info: { role: 'assistant', time: { completed: 1 } },
          parts: [
            { type: 'reasoning', text: 'pienso' },
            { type: 'text', text: 'ok', synthetic: false },
            { type: 'text', text: 'oculto', synthetic: true }
          ]
        }
      ] as never)
    ).toBe('ok')
  })
  it('un error del motor se lanza', () => {
    expect(() => finishedAnswer([assistant('', true, { message: 'sin cuota' })] as never)).toThrow('sin cuota')
  })
})

describe('askModel', () => {
  it('sesión efímera SIN herramientas reales: todo denegado salvo `read` de una ruta inexistente (el modelo gratuito la exige), agente de conversación, modelo elegido', async () => {
    client.session.messages
      .mockResolvedValueOnce({ data: [assistant('a medias', false)] })
      .mockResolvedValueOnce({ data: [assistant('respuesta final')] })
    expect(await askModel('/proyecto', 'dime algo', noWait)).toBe('respuesta final')
    expect(client.session.create).toHaveBeenCalledWith({
      directory: '/proyecto',
      title: 'Lazunox',
      agent: 'chat',
      metadata: { mode: 'pr-helper' },
      permission: [
        { permission: '*', pattern: '*', action: 'deny' },
        { permission: 'read', pattern: '/__lazunox_sin_acceso__', action: 'allow' }
      ]
    })
    expect(client.session.promptAsync).toHaveBeenCalledWith({
      sessionID: 'ses_1',
      directory: '/proyecto',
      agent: 'chat',
      model: { providerID: 'opencode', modelID: 'deepseek-v4.1-flash-free' },
      parts: [{ type: 'text', text: 'dime algo' }]
    })
    expect(client.session.delete).toHaveBeenCalledWith({ sessionID: 'ses_1', directory: '/proyecto' })
    expect(client.session.abort).not.toHaveBeenCalled()
  })

  it('sin IA conectada no crea nada', async () => {
    gate = { effective: null, gate: { blocked: true } }
    await expect(askModel('/p', 'x', noWait)).rejects.toBeTruthy()
    expect(client.session.create).not.toHaveBeenCalled()
  })

  it('si el motor rechaza el mensaje, aborta y borra la sesión', async () => {
    client.session.promptAsync.mockResolvedValue({ error: { message: 'modelo no disponible' } })
    await expect(askModel('/p', 'x', noWait)).rejects.toThrow('modelo no disponible')
    expect(client.session.abort).toHaveBeenCalled()
    expect(client.session.delete).toHaveBeenCalled()
  })

  it('respuesta vacía → error entendible, y la sesión se borra', async () => {
    client.session.messages.mockResolvedValue({ data: [assistant('')] })
    await expect(askModel('/p', 'x', noWait)).rejects.toThrow()
    expect(client.session.delete).toHaveBeenCalled()
  })

  it('tiempo agotado → error, abort y borrado', async () => {
    client.session.messages.mockResolvedValue({ data: [assistant('nunca termina', false)] })
    await expect(askModel('/p', 'x', { ...noWait, timeoutMs: -1 })).rejects.toThrow()
    expect(client.session.abort).toHaveBeenCalled()
    expect(client.session.delete).toHaveBeenCalled()
  })

  it('cancelación', async () => {
    const ctl = new AbortController()
    ctl.abort()
    await expect(askModel('/p', 'x', { ...noWait, signal: ctl.signal })).rejects.toThrow('aborted')
    expect(client.session.delete).toHaveBeenCalled()
  })

  it('un fallo al borrar la sesión no tapa la respuesta', async () => {
    client.session.messages.mockResolvedValue({ data: [assistant('ok')] })
    client.session.delete.mockRejectedValue(new Error('x'))
    expect(await askModel('/p', 'x', noWait)).toBe('ok')
  })
})
