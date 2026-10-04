import { describe, expect, it } from 'vitest'
import { computeMetrics, emptyMetrics, type MetricMessage } from './metrics'

const asst = (o: {
  cost?: number
  input?: number
  output?: number
  reasoning?: number
  read?: number
  created?: number
  completed?: number
}): MetricMessage => ({
  info: {
    role: 'assistant',
    cost: o.cost,
    tokens: { input: o.input ?? 0, output: o.output ?? 0, reasoning: o.reasoning ?? 0, cache: { read: o.read ?? 0, write: 0 } },
    time: { created: o.created ?? 0, completed: o.completed }
  }
})

describe('métricas de una columna', () => {
  it('suma la sesión y sus hijas (subagentes)', () => {
    const root = [
      { info: { role: 'user' } },
      asst({ cost: 0.01, input: 100, output: 20, completed: 5000 }),
      asst({ cost: 0.02, input: 50, output: 10, read: 7, completed: 9000 })
    ]
    const kid = [asst({ cost: 0.005, input: 10, output: 5, reasoning: 3 })]
    const m = computeMetrics([root, kid], 1000)
    expect(m.inputTokens).toBe(160)
    expect(m.outputTokens).toBe(35)
    expect(m.reasoningTokens).toBe(3)
    expect(m.cacheReadTokens).toBe(7)
    expect(m.costUsd).toBeCloseTo(0.035)
    expect(m.llmCalls).toBe(3)
  })

  it('la duración va del envío al time.completed del último mensaje del asistente de la sesión raíz', () => {
    const root = [asst({ completed: 4000 }), asst({ completed: 9000 })]
    expect(computeMetrics([root], 1000).durationMs).toBe(8000)
    expect(computeMetrics([[asst({})]], 1000).durationMs).toBeNull()
    expect(computeMetrics([root], null).durationMs).toBeNull()
  })

  it('lo que el motor no informa es null, nunca 0', () => {
    const m = computeMetrics([[asst({ cost: 0 })]], 0)
    expect(m.costUsd).toBeNull()
    expect(m.inputTokens).toBeNull()
    expect(m.outputTokens).toBeNull()
    expect(m.llmCalls).toBe(1)
    expect(computeMetrics([], null)).toEqual(emptyMetrics())
    expect(emptyMetrics().costUsd).toBeNull()
  })
})
