/** «Volver a comprobar» salta la caché de main (force); el sondeo automático no. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn(async () => ({ ok: true, data: { backend: 'wsl', state: 'ready', setup: null } }))
beforeEach(() => {
  invoke.mockClear()
  ;(globalThis as { window?: unknown }).window = { api: { platform: 'win32', tasks: { invoke }, capsFlags: { tasksWin: true } } }
})
afterEach(() => delete (globalThis as { window?: unknown }).window)

describe('sandbox-store.refresh', () => {
  it('sin argumento no manda force (usa la caché de main)', async () => {
    const { useSandbox } = await import('./sandbox-store')
    await useSandbox.getState().refresh()
    expect(invoke).toHaveBeenCalledWith('tasks:sandbox:status', undefined)
  })
  it('refresh(true) manda { force: true }', async () => {
    const { useSandbox } = await import('./sandbox-store')
    await useSandbox.getState().refresh(true)
    expect(invoke).toHaveBeenCalledWith('tasks:sandbox:status', { force: true })
    expect(useSandbox.getState().status?.state).toBe('ready')
  })
})
