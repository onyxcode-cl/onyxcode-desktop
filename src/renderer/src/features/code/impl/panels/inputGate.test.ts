import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInputGate } from './inputGate'

describe('inputGate', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('retiene lo tecleado antes de la primera salida y lo entrega junto, en orden', () => {
    const out: string[] = []
    const g = createInputGate((d) => out.push(d))
    g.start()
    g.push('e')
    g.push('cho')
    expect(out).toEqual([])
    g.onOutput()
    expect(out).toEqual([]) // aún dentro de la pausa corta
    vi.advanceTimersByTime(60)
    expect(out).toEqual(['echo'])
    g.push('\r')
    expect(out).toEqual(['echo', '\r']) // después, directo
  })

  it('si el shell no imprime nada, entrega al cumplirse el tiempo máximo', () => {
    const out: string[] = []
    const g = createInputGate((d) => out.push(d), { maxWaitMs: 1000 })
    g.start()
    g.push('ls')
    vi.advanceTimersByTime(999)
    expect(out).toEqual([])
    vi.advanceTimersByTime(1)
    expect(out).toEqual(['ls'])
    expect(g.ready).toBe(true)
  })

  it('sin nada retenido no escribe vacío y varias salidas no duplican', () => {
    const out: string[] = []
    const g = createInputGate((d) => out.push(d))
    g.start()
    g.onOutput()
    g.onOutput()
    vi.advanceTimersByTime(5000)
    expect(out).toEqual([])
  })

  it('dispose descarta lo retenido', () => {
    const out: string[] = []
    const g = createInputGate((d) => out.push(d))
    g.start()
    g.push('x')
    g.dispose()
    vi.advanceTimersByTime(5000)
    expect(out).toEqual([])
  })
})
