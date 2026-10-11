/** Doble envío: mientras un envío está en curso el compositor se bloquea y un segundo envío NO crea otra tarea. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
})

describe('sendToTask: protección contra doble envío', () => {
  it('dos envíos seguidos con el servidor aún respondiendo crean UNA sola tarea', async () => {
    const S = await import('../../../stores/sessions')
    const C = await import('./store')
    const A = await import('./actions')
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const create = vi.fn(async () => {
      await gate // el servidor del sandbox tarda en responder
      return { data: { id: 'ses_1', title: 'hola', directory: '/tmp/p', time: { created: 1, updated: 1 } } }
    })
    const promptAsync = vi.fn(async () => ({ data: {} }))
    const client = {
      session: { create, promptAsync },
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
      activeTaskId: null,
      phase: 'ready'
    })
    void S
    const model = { providerID: 'opencode', modelID: 'x' }
    const first = A.sendToTask('hola', model)
    await vi.waitFor(() => expect(C.useTasks.getState().sending).toBe(true))
    await A.sendToTask('hola', model) // segundo clic: se ignora al instante
    release()
    await first.catch(() => undefined)
    expect(create).toHaveBeenCalledTimes(1)
    expect(C.useTasks.getState().sending).toBe(false)
  })

  it('un envío que falla libera el bloqueo', async () => {
    const C = await import('./store')
    const A = await import('./actions')
    C.useTasks.setState({ client: null, folder: null })
    await expect(A.sendToTask('x')).rejects.toThrow()
    expect(C.useTasks.getState().sending).toBe(false)
  })
})
