/** `dropFolder`: la carpeta soltada la valida main y sigue el camino de «Elegir carpeta» (confirmación, o conexión si ya estaba autorizada). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

function setup(check: unknown): ReturnType<typeof vi.fn> {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'tasks:folders:check') return { ok: true, data: check }
    return { ok: true, data: null }
  })
  ;(globalThis as { window?: unknown }).window = {
    api: { platform: 'darwin', tasks: { invoke, on: () => () => undefined } }
  }
  return invoke
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
})
afterEach(() => delete (globalThis as { window?: unknown }).window)

describe('dropFolder', () => {
  it('carpeta nueva: pide la confirmación de siempre (no la conecta sola)', async () => {
    const invoke = setup({ ok: true, normalized: '/Users/ana/proyecto' })
    const { useTasks } = await import('./store')
    const { dropFolder } = await import('./actions')
    await dropFolder('/Users/ana/proyecto/')
    expect(invoke).toHaveBeenCalledWith('tasks:folders:check', { path: '/Users/ana/proyecto/' })
    expect(useTasks.getState().pendingApproval).toBe('/Users/ana/proyecto')
    expect(invoke).not.toHaveBeenCalledWith('tasks:approveFolder', expect.anything())
    expect(invoke).not.toHaveBeenCalledWith('tasks:start', expect.anything())
  })

  it('carpeta rechazada por main: muestra su motivo y no pide nada', async () => {
    setup({ ok: false, normalized: '/Users/ana', reason: 'No se puede usar tu carpeta personal completa.' })
    const { useTasks } = await import('./store')
    const { dropFolder } = await import('./actions')
    await dropFolder('/Users/ana')
    expect(useTasks.getState().error).toBe('No se puede usar tu carpeta personal completa.')
    expect(useTasks.getState().pendingApproval).toBeNull()
  })

  it('ruta vacía (arrastre sin ruta): no hace nada', async () => {
    const invoke = setup({ ok: true, normalized: '/x' })
    const { dropFolder } = await import('./actions')
    await dropFolder('')
    expect(invoke).not.toHaveBeenCalled()
  })
})
