import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { raceReport } from './preflight-late'

function delayed<T>(value: T, ms: number): Promise<T> {
  return new Promise((res) => setTimeout(() => res(value), ms))
}

describe('raceReport (informe de arranque contra su plazo)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('informe a tiempo: se devuelve tal cual y no queda plazo pendiente', async () => {
    const p = raceReport(delayed({ ok: 1 }, 1000), 3500)
    await vi.advanceTimersByTimeAsync(1000)
    const r = await p
    expect(r.timedOut).toBe(false)
    expect(r.report).toEqual({ ok: 1 })
    expect(await r.late).toEqual({ ok: 1 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('informe a los 5 s con plazo de 3,5 s: la app entra y el informe llega después por `late`', async () => {
    const p = raceReport(delayed({ ok: 2 }, 5000), 3500)
    await vi.advanceTimersByTimeAsync(3500)
    const r = await p
    expect(r.timedOut).toBe(true)
    expect(r.report).toBeNull()
    let got: unknown = 'pendiente'
    void r.late.then((v) => (got = v))
    await vi.advanceTimersByTimeAsync(1000)
    expect(got).toBe('pendiente')
    await vi.advanceTimersByTimeAsync(500)
    expect(got).toEqual({ ok: 2 })
  })

  it('la revisión falla: sin informe, sin plazo vencido y sin rechazo', async () => {
    const r = await raceReport(Promise.reject(new Error('x')), 3500)
    expect(r.report).toBeNull()
    expect(r.timedOut).toBe(false)
    expect(await r.late).toBeNull()
  })

  it('falla después del plazo: `late` resuelve null, no rechaza', async () => {
    const failing = new Promise<null>((_, rej) => setTimeout(() => rej(new Error('x')), 6000))
    const p = raceReport(failing, 3500)
    await vi.advanceTimersByTimeAsync(3500)
    const r = await p
    expect(r.timedOut).toBe(true)
    const late = r.late
    await vi.advanceTimersByTimeAsync(3000)
    expect(await late).toBeNull()
  })
})
