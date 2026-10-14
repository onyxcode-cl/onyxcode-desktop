import { afterEach, describe, expect, it, vi } from 'vitest'
import { WEB_OPEN_TIMEOUT_MS, WebTimeoutError, withTimeout } from './web-timeout'

afterEach(() => vi.useRealTimers())

describe('withTimeout', () => {
  it('devuelve el valor si llega a tiempo', async () => {
    await expect(withTimeout(Promise.resolve(7), 50, 'x')).resolves.toBe(7)
  })

  it('propaga el error de la promesa original', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 50, 'x')).rejects.toThrow('boom')
  })

  it('se rinde con WebTimeoutError si la promesa no termina (el panel no se queda «generando»)', async () => {
    vi.useFakeTimers()
    const p = withTimeout(new Promise<never>(() => undefined), WEB_OPEN_TIMEOUT_MS, 'motor')
    const assertion = expect(p).rejects.toBeInstanceOf(WebTimeoutError)
    await vi.advanceTimersByTimeAsync(WEB_OPEN_TIMEOUT_MS + 1)
    await assertion
  })

  it('el plazo total es de 20 s', () => {
    expect(WEB_OPEN_TIMEOUT_MS).toBe(20_000)
  })
})
