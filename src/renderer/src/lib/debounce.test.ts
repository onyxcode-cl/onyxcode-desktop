import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { debounce } from './debounce'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('debounce', () => {
  it('agrupa una ráfaga en una sola ejecución tras la espera final', () => {
    const fn = vi.fn()
    const d = debounce(fn, { wait: 400, maxWait: 2000 })
    for (let i = 0; i < 100; i++) {
      d()
      vi.advanceTimersByTime(3)
    }
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(400)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(d.pending()).toBe(false)
  })

  it('una ráfaga continua se ejecuta al menos cada maxWait', () => {
    const fn = vi.fn()
    const d = debounce(fn, { wait: 400, maxWait: 2000 })
    for (let t = 0; t < 5000; t += 50) {
      d()
      vi.advanceTimersByTime(50)
    }
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('cancel descarta la ejecución pendiente', () => {
    const fn = vi.fn()
    const d = debounce(fn, { wait: 400 })
    d()
    d.cancel()
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
    expect(d.pending()).toBe(false)
  })

  it('sin maxWait solo cuenta la espera final', () => {
    const fn = vi.fn()
    const d = debounce(fn, { wait: 100 })
    d()
    vi.advanceTimersByTime(99)
    d()
    vi.advanceTimersByTime(99)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
