import { describe, expect, it } from 'vitest'
import { reasoningLabel } from './Reasoning'

const t = (start: number, end?: number) => ({ time: { start, end } })

describe('reasoningLabel', () => {
  it('en vivo y sin fin: Razonando…', () => {
    expect(reasoningLabel(t(0), true)).toBe('Razonando…')
  })
  it('con fin: duración mínima de 1 s', () => {
    expect(reasoningLabel(t(1000, 1400), false)).toBe('Razonó durante 1 s')
    expect(reasoningLabel(t(0, 4600), false)).toBe('Razonó durante 5 s')
  })
  it('en vivo pero con fin: muestra la duración', () => {
    expect(reasoningLabel(t(0, 2000), true)).toBe('Razonó durante 2 s')
  })
  it('sin fin y no en vivo: Razonamiento', () => {
    expect(reasoningLabel(t(0), false)).toBe('Razonamiento')
  })
  it('fin en 0 (falsy) se trata como sin tiempo', () => {
    expect(reasoningLabel(t(0, 0), false)).toBe('Razonamiento')
  })
})
