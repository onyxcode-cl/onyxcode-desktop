import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FULL_DIFF_SHARE_MS, resetSharedFullDiff, sharedFullDiff } from './full-diff'

describe('sharedFullDiff (barra y panel Cambios piden el mismo diff)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetSharedFullDiff()
  })
  afterEach(() => vi.useRealTimers())

  it('misma carpeta y versión: una sola llamada; otra versión u otra carpeta: llamada nueva', async () => {
    const load = vi.fn(async () => 'patch')
    const [a, b] = await Promise.all([sharedFullDiff('/p', 1, load), sharedFullDiff('/p', 1, load)])
    expect(a).toBe('patch')
    expect(b).toBe('patch')
    expect(load).toHaveBeenCalledTimes(1)
    await sharedFullDiff('/p', 2, load)
    await sharedFullDiff('/q', 2, load)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('no retiene el texto: pasado el margen se vuelve a pedir', async () => {
    const load = vi.fn(async () => 'patch')
    await sharedFullDiff('/p', 1, load)
    await vi.advanceTimersByTimeAsync(FULL_DIFF_SHARE_MS + 1)
    await sharedFullDiff('/p', 1, load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('un fallo no se reutiliza', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue('ok')
    await expect(sharedFullDiff('/p', 1, load)).rejects.toThrow('x')
    await expect(sharedFullDiff('/p', 1, load)).resolves.toBe('ok')
  })
})
