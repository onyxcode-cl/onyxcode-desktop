// detectFullDiskAccess (F8-B210): concedido / no concedido / indeterminado con aperturas simuladas.
import { describe, expect, it, vi } from 'vitest'
import { detectFullDiskAccess, type FullDiskDeps, type FullDiskProbe } from './full-disk'

const err = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })
const probes: FullDiskProbe[] = [
  { kind: 'dir', path: '/a' },
  { kind: 'file', path: '/b' }
]
const deps = (open: FullDiskDeps['open']): FullDiskDeps => ({ probes, open, timeoutMs: 40 })

describe('detectFullDiskAccess', () => {
  it('granted si alguna sonda se abre', async () => {
    expect(await detectFullDiskAccess(deps(async (p) => (p.path === '/a' ? undefined : Promise.reject(err('EPERM')))))).toBe('granted')
  })
  it.each(['EPERM', 'EACCES'])('denied con %s en todas', async (code) => {
    expect(await detectFullDiskAccess(deps(() => Promise.reject(err(code))))).toBe('denied')
  })
  it('denied si una da EPERM y la otra no existe', async () => {
    expect(await detectFullDiskAccess(deps(async (p) => Promise.reject(err(p.path === '/a' ? 'ENOENT' : 'EPERM'))))).toBe('denied')
  })
  it('unknown si todas faltan o fallan por otra causa', async () => {
    expect(await detectFullDiskAccess(deps(() => Promise.reject(err('ENOENT'))))).toBe('unknown')
    expect(await detectFullDiskAccess(deps(() => Promise.reject(err('EIO'))))).toBe('unknown')
  })
  it('unknown si vence el plazo', async () => {
    vi.useFakeTimers()
    const p = detectFullDiskAccess(deps(() => new Promise<void>(() => undefined)))
    await vi.advanceTimersByTimeAsync(50)
    expect(await p).toBe('unknown')
    vi.useRealTimers()
  })
  it('solo abre y cierra: nunca pide leer contenido (la sonda real no tiene lectura)', async () => {
    const open = vi.fn(async () => undefined)
    await detectFullDiskAccess(deps(open))
    expect(open).toHaveBeenCalledTimes(2)
  })
})
