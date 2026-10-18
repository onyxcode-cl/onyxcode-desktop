import { describe, expect, it } from 'vitest'
import {
  UNKNOWN_MODEL,
  aggregateUsage,
  costKind,
  periodStart,
  startOfWeek,
  usageStatus,
  type UsageMode,
  type UsageSession
} from './usage-aggregate'

// Jueves 15 de octubre de 2026, 15:00 (hora local de quien corre la prueba).
const NOW = new Date(2026, 9, 15, 15, 0, 0).getTime()
const day = (back: number, h = 12): number => new Date(2026, 9, 15 - back, h, 0, 0).getTime()
const free = (p: string, m: string): boolean => p === 'opencode' && m.endsWith('-free')

let n = 0
function ses(over: Partial<UsageSession> & { input?: number; output?: number; cache?: number }): UsageSession {
  const { input = 0, output = 0, cache = 0, ...rest } = over
  return {
    id: `s${++n}`,
    mode: 'chat' as UsageMode,
    updated: NOW - 3_600_000,
    tokens: { input, output, reasoning: 0, cache: { read: cache, write: 0 } },
    ...rest
  }
}
const agg = (s: UsageSession[], period: 'today' | '7d' | '30d', extra: Partial<Parameters<typeof aggregateUsage>[1]> = {}) =>
  aggregateUsage(s, { now: NOW, period, isFree: free, ...extra })

describe('aggregateUsage: períodos', () => {
  it('sin datos devuelve ceros, los tres modos y estado «vacío»', () => {
    const r = agg([], '7d')
    expect(r).toMatchObject({ conversations: 0, sessions: 0, total: 0, byModel: [], incomplete: false })
    expect(r.byMode.map((m) => m.key)).toEqual(['chat', 'code', 'tasks'])
    expect(r.byMode.every((m) => m.conversations === 0)).toBe(true)
    expect(costKind(r.cost)).toBe('none')
    expect(usageStatus(r)).toMatchObject({ tone: 'empty', costKey: null })
  })

  it('hoy empieza a medianoche; 7 días cuenta el día de hoy y los 6 anteriores; 30 días, 29 anteriores', () => {
    expect(periodStart('today', NOW)).toBe(new Date(2026, 9, 15).getTime())
    expect(periodStart('7d', NOW)).toBe(new Date(2026, 9, 9).getTime())
    expect(periodStart('30d', NOW)).toBe(new Date(2026, 8, 16).getTime())
    const s = [
      ses({ input: 10, updated: day(0, 0) }),
      ses({ input: 20, updated: day(1, 23) }),
      ses({ input: 40, updated: day(6, 0) }),
      ses({ input: 80, updated: day(7, 23) }),
      ses({ input: 160, updated: day(29, 0) }),
      ses({ input: 320, updated: day(30, 23) })
    ]
    expect(agg(s, 'today').total).toBe(10)
    expect(agg(s, '7d').total).toBe(10 + 20 + 40)
    expect(agg(s, '30d').total).toBe(10 + 20 + 40 + 80 + 160)
  })

  it('suma entrada, salida y razonamiento como tokens nuevos y deja la caché aparte', () => {
    const r = agg(
      [ses({ input: 100, output: 50, cache: 900, tokens: { input: 100, output: 50, reasoning: 25, cache: { read: 900, write: 100 } } })],
      'today'
    )
    expect(r.total).toBe(175)
    expect(r.tokens).toEqual({ input: 100, output: 50, reasoning: 25, cacheRead: 900, cacheWrite: 100 })
  })

  it('ignora números raros (negativos, NaN) sin romperse', () => {
    const r = agg([ses({ tokens: { input: -5, output: Number.NaN, reasoning: 3, cache: { read: 0, write: 0 } } })], 'today')
    expect(r.total).toBe(3)
  })

  it('lo marcado como del futuro lejano (reloj mal puesto) no cuenta', () => {
    expect(agg([ses({ input: 9, updated: NOW + 10 * 86_400_000 })], '7d').total).toBe(0)
  })
})

describe('aggregateUsage: modelos, costo y «sin dato»', () => {
  const paid = { id: 'claude-x', providerID: 'acme' }
  const other = { id: 'gpt-y', providerID: 'otro' }
  const gratis = { id: 'deepseek-v4.1-flash-free', providerID: 'opencode' }

  it('agrupa por modelo, ordena por tokens y suma el costo informado', () => {
    const r = agg(
      [
        ses({ input: 1000, model: paid, cost: 0.5 }),
        ses({ input: 500, model: paid, cost: 0.25 }),
        ses({ input: 4000, model: gratis, cost: 0 }),
        ses({ input: 10 })
      ],
      '7d'
    )
    expect(r.byModel.map((m) => m.key)).toEqual(['opencode/deepseek-v4.1-flash-free', 'acme/claude-x', UNKNOWN_MODEL])
    const acme = r.byModel[1]
    expect(acme).toMatchObject({ conversations: 2, total: 1500 })
    expect(acme.cost.usd).toBeCloseTo(0.75)
    expect(costKind(acme.cost)).toBe('amount')
  })

  it('un modelo gratuito con costo cero es «gratuito»; cualquier otro sin costo es «sin dato»', () => {
    const r = agg(
      [ses({ input: 100, model: gratis, cost: 0 }), ses({ input: 100, model: other, cost: 0 }), ses({ input: 100, model: other })],
      '7d'
    )
    const g = r.byModel.find((m) => m.key === 'opencode/deepseek-v4.1-flash-free')!
    const o = r.byModel.find((m) => m.key === 'otro/gpt-y')!
    expect(costKind(g.cost)).toBe('free')
    expect(costKind(o.cost)).toBe('unknown')
    expect(o.cost.unknown).toBe(2)
    // En el total manda «sin dato»: no se puede afirmar que todo fue gratis.
    expect(costKind(r.cost)).toBe('unknown')
    expect(usageStatus(r).costKey).toBe('settings.usage.status.costUnknown')
  })

  it('todo gratuito: lo dice; mezcla de monto y sin dato: lo avisa; solo monto: lo informa', () => {
    expect(usageStatus(agg([ses({ input: 5, model: gratis, cost: 0 })], '7d')).costKey).toBe('settings.usage.status.costFree')
    expect(usageStatus(agg([ses({ input: 5, model: paid, cost: 1 }), ses({ input: 5, model: other })], '7d')).costKey).toBe(
      'settings.usage.status.costMixed'
    )
    expect(usageStatus(agg([ses({ input: 5, model: paid, cost: 1 })], '7d')).costKey).toBe('settings.usage.status.costAmount')
  })

  it('una conversación vacía no cuenta como «sin dato»', () => {
    const r = agg([ses({ model: other })], '7d')
    expect(r.cost).toEqual({ usd: 0, paid: 0, free: 0, unknown: 0 })
    expect(r.conversations).toBe(1)
    expect(costKind(r.cost)).toBe('none')
  })

  it('los ayudantes (sesiones hijas) suman tokens y costo pero no cuentan como conversaciones', () => {
    const r = agg(
      [ses({ id: 'raiz', input: 100, model: paid, cost: 0.1 }), ses({ id: 'hija', parentID: 'raiz', input: 300, model: paid, cost: 0.3 })],
      '7d'
    )
    expect(r.conversations).toBe(1)
    expect(r.sessions).toBe(2)
    expect(r.total).toBe(400)
    expect(r.cost.usd).toBeCloseTo(0.4)
  })
})

describe('aggregateUsage: modos y series', () => {
  it('reparte entre Chat, Code y Overdrive y deja en cero el que no tiene', () => {
    const r = agg([ses({ input: 10, mode: 'chat' }), ses({ input: 20, mode: 'code' }), ses({ input: 40, mode: 'code' })], '7d')
    expect(r.byMode.map((m) => [m.key, m.conversations, m.total])).toEqual([
      ['chat', 1, 10],
      ['code', 2, 60],
      ['tasks', 0, 0]
    ])
  })

  it('7 días: siete filas en orden, también los días sin uso', () => {
    const r = agg([ses({ input: 10, updated: day(0) }), ses({ input: 30, updated: day(3) })], '7d')
    expect(r.bucketUnit).toBe('day')
    expect(r.buckets).toHaveLength(7)
    expect(r.buckets.map((b) => Number(b.key))).toEqual([...Array(7).keys()].map((i) => new Date(2026, 9, 9 + i).getTime()))
    expect(r.buckets.map((b) => b.total)).toEqual([0, 0, 0, 30, 0, 0, 10])
  })

  it('30 días: por semana (lunes a domingo); hoy: sin serie', () => {
    const r = agg([ses({ input: 10, updated: day(0) }), ses({ input: 20, updated: day(1) }), ses({ input: 40, updated: day(8) })], '30d')
    expect(r.bucketUnit).toBe('week')
    // El 15 de oct (jueves) cae en la semana del lunes 12; el 7 de oct (miércoles), en la del 5.
    expect(r.buckets.map((b) => [new Date(Number(b.key)).getDate(), b.total])).toEqual([
      [5, 40],
      [12, 30]
    ])
    expect(startOfWeek(NOW)).toBe(new Date(2026, 9, 12).getTime())
    expect(agg([ses({ input: 1 })], 'today')).toMatchObject({ bucketUnit: null, buckets: [] })
  })
})

describe('aggregateUsage: tope de lectura', () => {
  it('avisa que el período puede estar incompleto solo si se llegó al tope y la lectura no alcanza el inicio', () => {
    const s = [ses({ input: 10, updated: day(2) })]
    expect(agg(s, '30d', { capped: true, oldestRead: day(2) }).incomplete).toBe(true)
    expect(agg(s, '7d', { capped: true, oldestRead: day(10) }).incomplete).toBe(false)
    expect(agg(s, '30d', { capped: false, oldestRead: day(2) }).incomplete).toBe(false)
    expect(agg(s, '30d', {}).incomplete).toBe(false)
    expect(usageStatus(agg(s, '30d', { capped: true, oldestRead: day(2) })).tone).toBe('warn')
    expect(usageStatus(agg(s, '7d')).tone).toBe('ok')
  })
})
