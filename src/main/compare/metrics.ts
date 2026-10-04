/**
 * Métricas de una columna a partir de los mensajes del motor. Puro.
 * Lo que el motor no informa es `null`, nunca 0 (coste 0 = «no informado»).
 */
import type { CompareMetrics } from '@shared/ipc-code'

/** Subconjunto de `Message` del SDK que se usa aquí. */
export interface MetricMessage {
  info: {
    role: string
    time?: { created?: number; completed?: number }
    cost?: number
    tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } }
  }
}

export function emptyMetrics(): CompareMetrics {
  return {
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    costUsd: null,
    llmCalls: 0,
    durationMs: null
  }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

/**
 * `lists`: mensajes de la sesión raíz y de cada sesión hija (subagentes).
 * `startedAt`: epoch ms del envío del prompt; la duración llega hasta el `time.completed` del último mensaje del asistente
 * de la sesión raíz (`lists[0]`).
 */
export function computeMetrics(lists: readonly (readonly MetricMessage[])[], startedAt: number | null): CompareMetrics {
  let calls = 0
  let input = 0
  let output = 0
  let reasoning = 0
  let cacheRead = 0
  let cacheWrite = 0
  let cost = 0
  for (const list of lists) {
    for (const m of list) {
      if (m.info.role !== 'assistant') continue
      calls++
      input += num(m.info.tokens?.input)
      output += num(m.info.tokens?.output)
      reasoning += num(m.info.tokens?.reasoning)
      cacheRead += num(m.info.tokens?.cache?.read)
      cacheWrite += num(m.info.tokens?.cache?.write)
      cost += num(m.info.cost)
    }
  }
  const reported = input + output + reasoning + cacheRead + cacheWrite > 0
  const orNull = (v: number): number | null => (reported ? v : null)

  let lastCompleted: number | null = null
  for (const m of lists[0] ?? []) {
    if (m.info.role !== 'assistant') continue
    const c = m.info.time?.completed
    if (typeof c === 'number' && (lastCompleted === null || c > lastCompleted)) lastCompleted = c
  }
  const durationMs = startedAt !== null && lastCompleted !== null ? Math.max(0, lastCompleted - startedAt) : null

  return {
    inputTokens: orNull(input),
    outputTokens: orNull(output),
    reasoningTokens: orNull(reasoning),
    cacheReadTokens: orNull(cacheRead),
    cacheWriteTokens: orNull(cacheWrite),
    costUsd: cost > 0 ? cost : null,
    llmCalls: calls,
    durationMs
  }
}
