/** Si el primer mensaje de una tarea RECIÉN creada no sale, se deshace la tarea y vuelve lo escrito (borrador y adjuntos). */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
})

const model = { providerID: 'opencode', modelID: 'x' }
const ATT = { name: 'a.txt', relPath: 'a.txt', path: '/tmp/p/a.txt' }

async function setup(promptAsync: () => Promise<unknown>, active: string | null) {
  const S = await import('../../../stores/sessions')
  const C = await import('./store')
  const A = await import('./actions')
  const create = vi.fn(async () => ({ data: { id: 'ses_new', title: 'hola', directory: '/tmp/p', time: { created: 1, updated: 1 } } }))
  const del = vi.fn(async () => ({ data: true }))
  const client = {
    session: { create, promptAsync: vi.fn(promptAsync), delete: del },
    config: { providers: vi.fn(async () => ({ data: { providers: [] } })) }
  }
  C.useTasks.setState({
    client: client as never,
    folder: '/tmp/p',
    conn: {
      folder: '/tmp/p',
      directory: '/tmp/p',
      pathMap: { kind: 'identity' },
      baseUrl: 'http://x',
      fullAccess: false,
      sandboxed: false
    } as never,
    activeTaskId: active,
    phase: 'ready',
    attachments: [ATT as never]
  })
  return { S, C, A, create, del }
}

describe('sendToTask: deshacer la tarea nueva si el primer mensaje no sale', () => {
  it('create OK + promptAsync con error: borra la sesión, limpia activeTaskId y restaura borrador y adjuntos', async () => {
    const { S, C, A, del } = await setup(async () => ({ error: new Error('Failed to fetch') }), null)
    await expect(A.sendToTask('hola', model)).rejects.toThrow('Failed to fetch')
    expect(del).toHaveBeenCalledTimes(1)
    expect(C.useTasks.getState().activeTaskId).toBeNull()
    expect(C.useTasks.getState().draft).toBe('hola')
    expect(C.useTasks.getState().attachments).toEqual([ATT])
    expect(S.useSessions.getState().sessions['ses_new']).toBeUndefined()
    expect(C.useTasks.getState().sending).toBe(false)
  })

  it('promptAsync que rechaza: mismo deshacer', async () => {
    const { C, A, del } = await setup(async () => Promise.reject(new Error('boom')), null)
    await expect(A.sendToTask('hola', model)).rejects.toThrow('boom')
    expect(del).toHaveBeenCalledTimes(1)
    expect(C.useTasks.getState().activeTaskId).toBeNull()
    expect(C.useTasks.getState().draft).toBe('hola')
  })

  it('mensaje a una tarea YA existente con error: no hay deshacer, el error queda en la tarea', async () => {
    const { S, C, A, create, del } = await setup(async () => ({ error: new Error('Failed to fetch') }), 'ses_old')
    await A.sendToTask('otro', model)
    expect(create).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
    expect(C.useTasks.getState().activeTaskId).toBe('ses_old')
    expect(S.useSessions.getState().errors['ses_old']).toBeTruthy()
  })

  it('session.create falla: no se toca activeTaskId ni se borra nada', async () => {
    const { C, A, create, del } = await setup(async () => ({ data: {} }), null)
    create.mockResolvedValueOnce({ error: new Error('sin red') } as never)
    await expect(A.sendToTask('hola', model)).rejects.toThrow()
    expect(del).not.toHaveBeenCalled()
    expect(C.useTasks.getState().activeTaskId).toBeNull()
  })
})
