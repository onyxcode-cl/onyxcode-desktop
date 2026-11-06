import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstallApi } from './preflight-run'
import { autoPercent, resetAutoInstall, startAutoInstall, useAutoInstall } from './auto-install'

function apiWith(over: Partial<InstallApi> = {}): InstallApi {
  return {
    craftInstall: vi.fn(async () => ({ ok: true })),
    craftProgress: vi.fn(async () => 50),
    runtimesInstall: vi.fn(async () => ({ ok: true })),
    runtimesProgress: vi.fn(async () => null),
    trustInstall: vi.fn(async () => ({ ok: true })),
    sandboxSetup: vi.fn(async () => undefined),
    sandboxStatus: vi.fn(async () => ({ state: 'ready', setup: null })),
    fail: vi.fn(async (id, code) => ({ detail: `detalle ${id} ${code}` })),
    sleep: async () => undefined,
    alive: () => true,
    ...over
  }
}
const base = (api: InstallApi, o: { online?: () => boolean; wait?: (ms: number) => Promise<void>; delays?: number[] } = {}) => ({
  api,
  online: o.online ?? (() => true),
  wait: o.wait ?? (async () => undefined),
  delays: o.delays ?? [10, 20, 30]
})

beforeEach(() => resetAutoInstall())

describe('instalación automática en segundo plano', () => {
  it('instala todo el plan en orden y termina en reposo (la pastilla desaparece)', async () => {
    const api = apiWith()
    await startAutoInstall(['craft', 'runtimes', 'sandbox'], base(api))
    expect(useAutoInstall.getState().phase).toBe('idle')
    expect(useAutoInstall.getState().done).toEqual(['craft', 'runtimes', 'sandbox'])
    expect(api.fail).not.toHaveBeenCalled()
  })

  it('nunca instala la firma ni nada que pida contraseña: solo lo que se le pasa', async () => {
    const api = apiWith()
    await startAutoInstall(['craft'], base(api))
    expect(api.trustInstall).not.toHaveBeenCalled()
  })

  it('si falla la red espera y reintenta solo; sin ruido en el registro de problemas', async () => {
    let n = 0
    const craftInstall = vi.fn(async () => (++n < 3 ? { ok: false, error: 'offline' } : { ok: true }))
    const waits: number[] = []
    const api = apiWith({ craftInstall })
    await startAutoInstall(['craft'], base(api, { wait: async (ms) => void waits.push(ms) }))
    expect(craftInstall).toHaveBeenCalledTimes(3)
    expect(waits).toEqual([10, 20])
    expect(useAutoInstall.getState().phase).toBe('idle')
    expect(api.fail).not.toHaveBeenCalled()
  })

  it('agotados los reintentos, falla de verdad: motivo y detalle, y no sigue intentando', async () => {
    const craftInstall = vi.fn(async () => ({ ok: false, error: 'download' }))
    const api = apiWith({ craftInstall })
    await startAutoInstall(['craft'], base(api))
    expect(craftInstall).toHaveBeenCalledTimes(4)
    const s = useAutoInstall.getState()
    expect(s.phase).toBe('failed')
    expect(s.failed.craft).toBe('download')
    expect(s.details.craft).toContain('craft')
    expect(api.fail).toHaveBeenCalledTimes(1)
  })

  it('un fallo de integridad (hash) NO se reintenta en silencio: se informa de inmediato', async () => {
    const craftInstall = vi.fn(async () => ({ ok: false, error: 'hash' }))
    await startAutoInstall(['craft'], base(apiWith({ craftInstall })))
    expect(craftInstall).toHaveBeenCalledTimes(1)
    expect(useAutoInstall.getState().failed.craft).toBe('hash')
  })

  it('un fallo no frena al resto: ArtCraft falla por integridad y Node.js y uv se instalan', async () => {
    const api = apiWith({ craftInstall: async () => ({ ok: false, error: 'signature' }) })
    await startAutoInstall(['craft', 'runtimes'], base(api))
    expect(api.runtimesInstall).toHaveBeenCalledTimes(1)
    expect(useAutoInstall.getState().done).toEqual(['runtimes'])
    expect(useAutoInstall.getState().failed).toEqual({ craft: 'signature' })
  })

  it('sin conexión no descarga nada y queda esperando', async () => {
    const api = apiWith()
    await startAutoInstall(['craft'], base(api, { online: () => false }))
    expect(api.craftInstall).not.toHaveBeenCalled()
    expect(useAutoInstall.getState().phase).toBe('offline')
  })

  it('una sola tanda a la vez', async () => {
    const api = apiWith()
    const a = startAutoInstall(['craft'], base(api))
    const b = startAutoInstall(['craft'], base(api))
    await Promise.all([a, b])
    expect(api.craftInstall).toHaveBeenCalledTimes(1)
  })

  it('el avance general mezcla piezas listas y el % de la actual', () => {
    expect(autoPercent({ ids: ['craft', 'runtimes'], done: ['craft'], pct: 40 })).toBe(70)
    expect(autoPercent({ ids: [], done: [], pct: null })).toBe(0)
  })
})
