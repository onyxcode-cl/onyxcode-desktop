/** `tasks:sandbox:status` con `force` (botón «Volver a comprobar»): llega al servicio y el esquema lo acepta. */
import { describe, expect, it, vi } from 'vitest'
import { IPC_SCHEMAS } from './schemas'

const status = vi.hoisted(() => vi.fn(async () => ({ backend: 'seatbelt', state: 'ready', setup: null })))
vi.mock('../tasks/sandbox-service', () => ({
  TasksSandboxService: class {
    status = status
    setup = vi.fn()
    cancel = vi.fn()
    idle = vi.fn()
  }
}))
vi.mock('../tasks/backends/seatbelt', () => ({ seatbeltAvailable: () => true }))

import { registerTasksSandboxHandlers } from './tasks-sandbox-handlers'

function setup(): (req: unknown) => Promise<unknown> {
  const fns = new Map<string, (req: unknown) => Promise<unknown>>()
  registerTasksSandboxHandlers({ handle: (ch: string, fn: never) => void fns.set(ch, fn), send: () => undefined } as never, {})
  return fns.get('tasks:sandbox:status') as (req: unknown) => Promise<unknown>
}

describe('tasks:sandbox:status', () => {
  it('sin carga útil: usa la caché (force=false)', async () => {
    status.mockClear()
    await setup()(undefined)
    expect(status).toHaveBeenCalledWith({ force: false })
  })
  it('con { force: true } salta la caché de main', async () => {
    status.mockClear()
    await setup()({ force: true })
    expect(status).toHaveBeenCalledWith({ force: true })
  })
  it('el esquema acepta vacío y { force }, y rechaza otros tipos', () => {
    const v = IPC_SCHEMAS['tasks:sandbox:status']
    expect(v(undefined)).toBeUndefined()
    expect(v({ force: true })).toEqual({ force: true })
    expect(() => v({ force: 'si' })).toThrow()
    expect(() => v(5)).toThrow()
  })
})
