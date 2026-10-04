import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  columnBadges,
  columnView,
  costLabel,
  durationLabel,
  elapsedMs,
  isActiveColumn,
  isActiveManifest,
  isFinished,
  isLimitedProvider,
  liveMetrics,
  mergeMetrics,
  rateInfo,
  retrySeconds,
  tokensLabel,
  validateSelection
} from './model'
import { mkCol, mkManifest, NO_METRICS } from './testkit'
import { assistantMessage } from '../../../../test/fixtures/events'
import type { MessageEntry } from '../../lib/session-reducer'

const model = (n: number, providerID = 'p'): { providerID: string; modelID: string } => ({ providerID, modelID: `m${n}` })

describe('columnView', () => {
  it('descartada > elegida > interrumpida > estado de main', () => {
    expect(columnView(mkCol(0, { state: 'done', discarded: true, adopted: true }))).toBe('discarded')
    expect(columnView(mkCol(0, { state: 'done', adopted: true, interrupted: true }))).toBe('adopted')
    expect(columnView(mkCol(0, { state: 'running', interrupted: true }))).toBe('interrupted')
    for (const s of ['queued', 'starting', 'running', 'done', 'error', 'rateLimited', 'cancelled'] as const) {
      expect(columnView(mkCol(0, { state: s }))).toBe(s)
    }
  })
  it('activa: en cola, arrancando, corriendo o con reintento programado; no si agotó el reintento', () => {
    expect(isActiveColumn(mkCol(0, { state: 'queued' }))).toBe(true)
    expect(isActiveColumn(mkCol(0, { state: 'rateLimited', retryAt: 5 }))).toBe(true)
    expect(isActiveColumn(mkCol(0, { state: 'rateLimited', retryAt: null }))).toBe(false)
    expect(isActiveColumn(mkCol(0, { state: 'done' }))).toBe(false)
    expect(isActiveColumn(mkCol(0, { state: 'running', interrupted: true }))).toBe(false)
    expect(isActiveColumn(mkCol(0, { state: 'running', discarded: true }))).toBe(false)
  })
  it('manifiesto activo / terminado', () => {
    const m = mkManifest({}, [mkCol(0, { state: 'done' }), mkCol(1, { state: 'running' })])
    expect(isActiveManifest(m)).toBe(true)
    expect(isFinished(m)).toBe(false)
    const f = mkManifest({}, [mkCol(0, { state: 'done' }), mkCol(1, { state: 'error' }), mkCol(2, { state: 'running', discarded: true })])
    expect(isActiveManifest(f)).toBe(false)
    expect(isFinished(f)).toBe(true)
  })
})

describe('validateSelection', () => {
  it('2 a 4 modelos distintos', () => {
    expect(validateSelection([model(1)])).toBe('min')
    expect(validateSelection([])).toBe('min')
    expect(validateSelection([model(1), model(2)])).toBeNull()
    expect(validateSelection([model(1), model(2), model(3), model(4)])).toBeNull()
    expect(validateSelection([model(1), model(2), model(3), model(4), model(5)])).toBe('max')
    expect(validateSelection([model(1), model(1)])).toBe('dup')
    expect(validateSelection([model(1), { ...model(1), variant: 'high' }])).toBeNull()
  })
  it('proveedores con tope de simultaneidad', () => {
    expect(isLimitedProvider('opencode-go')).toBe(true)
    expect(isLimitedProvider('opencode')).toBe(true)
    expect(isLimitedProvider('anthropic')).toBe(false)
  })
})

describe('cuenta atrás de reintentos (reloj falso)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
  })
  afterEach(() => vi.useRealTimers())

  it('retrySeconds redondea hacia arriba y nunca es negativo', () => {
    expect(retrySeconds(120_000, 100_000)).toBe(20)
    expect(retrySeconds(120_000, 100_001)).toBe(20)
    expect(retrySeconds(120_000, 119_001)).toBe(1)
    expect(retrySeconds(120_000, 130_000)).toBe(0)
  })
  it('baja con el reloj; con retryAt null queda agotado; en cola de un proveedor en pausa', () => {
    const c = mkCol(2, { state: 'rateLimited', retryAt: 120_000 })
    const m = mkManifest({}, [c])
    expect(rateInfo(c, m, Date.now())).toEqual({ kind: 'scheduled', seconds: 20 })
    vi.advanceTimersByTime(5_000)
    vi.setSystemTime(105_000)
    expect(rateInfo(c, m, Date.now())).toEqual({ kind: 'scheduled', seconds: 15 })
    vi.setSystemTime(125_000)
    expect(rateInfo(c, m, Date.now())).toEqual({ kind: 'scheduled', seconds: 0 })
    expect(rateInfo(mkCol(2, { state: 'rateLimited', retryAt: null }), m, 1)).toEqual({ kind: 'exhausted' })
    const q = mkCol(3, { state: 'queued', model: { providerID: 'opencode-go', modelID: 'x' } })
    expect(rateInfo(q, { pausedProviders: ['opencode-go'] }, 1)).toEqual({ kind: 'paused' })
    expect(rateInfo(q, { pausedProviders: [] }, 1)).toBeNull()
    expect(rateInfo(mkCol(0, { state: 'done' }), m, 1)).toBeNull()
  })
  it('la duración en vivo sigue al reloj mientras corre y usa la de main al terminar', () => {
    const running = mkCol(0, { state: 'running', startedAt: 90_000 })
    expect(elapsedMs(running, Date.now())).toBe(10_000)
    expect(elapsedMs(mkCol(0, { state: 'queued', startedAt: null }), Date.now())).toBeNull()
    expect(elapsedMs(mkCol(0, { state: 'done', metrics: { ...NO_METRICS, durationMs: 48_000 } }), Date.now())).toBe(48_000)
    expect(elapsedMs(mkCol(0, { state: 'done' }), Date.now())).toBeNull()
  })
})

describe('etiquetas de métricas: «—» y NUNCA «$0»', () => {
  it('coste', () => {
    expect(costLabel(null)).toBe('—')
    expect(costLabel(undefined)).toBe('—')
    expect(costLabel(0)).toBe('—')
    expect(costLabel(NaN)).toBe('—')
    expect(costLabel(0.021)).toMatch(/0,021/)
    for (const v of [null, 0, undefined]) expect(costLabel(v)).not.toMatch(/\$\s?0([^,.\d]|$)/)
  })
  it('tokens y duración', () => {
    expect(tokensLabel(null)).toBe('—')
    expect(tokensLabel(12_400)).toMatch(/12,4/)
    expect(durationLabel(null)).toBe('—')
    expect(durationLabel(48_000)).toBe('48 s')
    expect(durationLabel(72_000)).toBe('1 min 12 s')
  })
})

describe('insignias', () => {
  const done = (
    i: number,
    metrics: Partial<typeof NO_METRICS>,
    diff?: { additions: number; deletions: number }
  ): ReturnType<typeof mkCol> =>
    mkCol(i, { state: 'done', metrics: { ...NO_METRICS, ...metrics }, diff: diff ? { files: 1, ...diff } : null })
  it('hace falta al menos 2 columnas hechas', () => {
    expect(columnBadges([done(0, { costUsd: 1 })]).size).toBe(0)
    expect(columnBadges([done(0, { costUsd: 1 }), mkCol(1, { state: 'running' })]).size).toBe(0)
  })
  it('más barato, más rápido y menos cambios por separado', () => {
    const b = columnBadges([
      done(0, { costUsd: 0.5, durationMs: 9_000 }, { additions: 30, deletions: 5 }),
      done(1, { costUsd: 0.1, durationMs: 30_000 }, { additions: 3, deletions: 1 }),
      done(2, { costUsd: 0.9, durationMs: 4_000 }, { additions: 90, deletions: 9 })
    ])
    expect(b.get(0)).toBeUndefined()
    expect(b.get(1)).toEqual(['cheapest', 'smallest'])
    expect(b.get(2)).toEqual(['fastest'])
  })
  it('sin dato de coste en la mayoría no hay «más barato»; los empates totales no premian a nadie', () => {
    const b = columnBadges([done(0, { costUsd: 0.3, durationMs: 5_000 }), done(1, { costUsd: null, durationMs: 5_000 })])
    expect(b.size).toBe(0)
  })
})

describe('liveMetrics / mergeMetrics', () => {
  const entry = (id: string, over: Parameters<typeof assistantMessage>[2]): MessageEntry => ({
    info: assistantMessage(id, 's1', over),
    parts: []
  })
  it('suma los mensajes del asistente; el coste 0 y lo que falta son null', () => {
    const m = liveMetrics(
      [
        entry('a', {
          cost: 0,
          tokens: { input: 100, output: 20, reasoning: 0, cache: { read: 10, write: 0 } },
          time: { created: 1_100, completed: 2_000 }
        }),
        entry('b', {
          cost: 0,
          tokens: { input: 50, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 2_100, completed: 4_000 }
        })
      ],
      1_000
    )
    expect(m.inputTokens).toBe(150)
    expect(m.outputTokens).toBe(25)
    expect(m.costUsd).toBeNull()
    expect(m.llmCalls).toBe(2)
    expect(m.durationMs).toBe(3_000)
    expect(liveMetrics([], null)).toEqual({ ...NO_METRICS })
  })
  it('un coste real se suma', () => {
    expect(liveMetrics([entry('a', { cost: 0.01 }), entry('b', { cost: 0.02 })], null).costUsd).toBeCloseTo(0.03)
  })
  it('el manifiesto manda; lo vivo solo rellena huecos', () => {
    const merged = mergeMetrics({ ...NO_METRICS, costUsd: 0.5, llmCalls: 1 }, { ...NO_METRICS, costUsd: 0.9, inputTokens: 7, llmCalls: 3 })
    expect(merged.costUsd).toBe(0.5)
    expect(merged.inputTokens).toBe(7)
    expect(merged.llmCalls).toBe(3)
    expect(merged.outputTokens).toBeNull()
  })
})
