import { describe, expect, it } from 'vitest'
import { MuxCallError } from './mux'
import { RemoteLinkError, SlowTracker, abortError, isAbortError, toLinkError } from './link'

const text = (c: string): string => `texto:${c}`

describe('toLinkError', () => {
  it.each([
    [new MuxCallError('disconnected'), 'disconnected'],
    [new MuxCallError('forbidden', 'locked'), 'locked'],
    [new MuxCallError('forbidden', 'rejected'), 'denied'],
    [new MuxCallError('forbidden', 'cancelled'), 'denied'],
    [new MuxCallError('forbidden', 'expired'), 'expired'],
    [new MuxCallError('forbidden', 'busy'), 'busy'],
    [new MuxCallError('forbidden', 'rate-limited'), 'rate-limited'],
    [new MuxCallError('forbidden', 'out-of-scope'), 'forbidden'],
    [new MuxCallError('forbidden'), 'forbidden'],
    [new MuxCallError('unavailable'), 'unavailable'],
    [new MuxCallError('busy'), 'busy'],
    [new MuxCallError('too-large'), 'too-large'],
    [new MuxCallError('failed', 'algo'), 'failed'],
    [new Error('offline'), 'disconnected'],
    [new Error('closed'), 'disconnected'],
    [new Error('timeout'), 'disconnected'],
    [new Error('otra cosa'), 'failed'],
    ['no es un error', 'failed']
  ])('%s → %s', (e, code) => {
    const out = toLinkError(e, text)
    expect(out).toBeInstanceOf(RemoteLinkError)
    expect((out as RemoteLinkError).code).toBe(code)
    expect(out.message).toBe(`texto:${code}`)
  })

  it('la cancelación sigue siendo AbortError (no un error del puente)', () => {
    expect(isAbortError(toLinkError(new MuxCallError('cancelled'), text))).toBe(true)
    expect(isAbortError(toLinkError(abortError(), text))).toBe(true)
  })

  it('conserva el detalle del Mac en errores «failed»', () => {
    expect((toLinkError(new MuxCallError('failed', 'No hay carpeta'), text) as RemoteLinkError).detail).toBe('No hay carpeta')
  })
})

describe('SlowTracker', () => {
  function rig(): { t: SlowTracker; seen: number[]; fire: () => void; cleared: number } {
    const seen: number[] = []
    let cb: (() => void) | null = null
    const o = { cleared: 0 }
    const t = new SlowTracker((n) => seen.push(n), 1500, {
      set: (fn) => {
        cb = fn
        return 1
      },
      clear: () => void (o.cleared += 1)
    })
    return {
      t,
      seen,
      fire: () => cb?.(),
      get cleared() {
        return o.cleared
      }
    }
  }

  it('cuenta solo lo que tarda más que el umbral y baja al terminar', async () => {
    const r = rig()
    let done!: (v: number) => void
    const p = r.t.track(new Promise<number>((res) => (done = res)))
    expect(r.t.count).toBe(0)
    r.fire()
    expect(r.seen).toEqual([1])
    done(7)
    expect(await p).toBe(7)
    expect(r.seen).toEqual([1, 0])
  })

  it('una llamada rápida nunca se marca; un rechazo también libera', async () => {
    const r = rig()
    await r.t.track(Promise.resolve(1))
    expect(r.seen).toEqual([])
    const bad = r.t.track(Promise.reject(new Error('x')))
    await expect(bad).rejects.toThrow('x')
    expect(r.cleared).toBeGreaterThan(0)
  })
})
