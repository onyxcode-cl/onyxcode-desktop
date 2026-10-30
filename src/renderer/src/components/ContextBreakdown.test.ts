import { describe, expect, it } from 'vitest'
import { buildRows } from './ContextBreakdown'

const t = (k: string): string => k
const d = {
  sistema: 10_000,
  herramientas: 21_000,
  mcpInstrucciones: 2_000,
  mcpHerramientas: 22_000,
  skills: 6_000,
  memoria: 2_500,
  agentes: 300
}

describe('buildRows', () => {
  it('reparte lo usado y calcula el espacio libre con la reserva', () => {
    const rows = buildRows(
      152_000,
      1_000_000,
      { tokens: 0, desglose: d, ventana: { contexto: 1_000_000, usable: 967_000, reservado: 33_000 } },
      t
    )
    const by = Object.fromEntries(rows.map((r) => [r.id, r.tokens]))
    expect(by.messages).toBe(152_000 - (10_300 + 21_000 + 22_000 + 2_000 + 6_000 + 2_500))
    expect(by.buffer).toBe(33_000)
    expect(by.free).toBe(1_000_000 - 152_000 - 33_000)
  })
  it('nunca deja Mensajes negativo si la estimación pasa del total real', () => {
    const rows = buildRows(30_000, 1_000_000, { tokens: 0, desglose: d }, t)
    const sum = rows.filter((r) => r.id !== 'free').reduce((s, r) => s + r.tokens, 0)
    expect(rows.find((r) => r.id === 'messages')!.tokens).toBeGreaterThanOrEqual(0)
    expect(sum).toBeLessThanOrEqual(30_001)
  })
  it('sin desglose del motor no devuelve filas', () => {
    expect(buildRows(10, 100, { tokens: 1 }, t)).toEqual([])
  })
})
