/**
 * Lógica pura de «Comparar modelos»: estado visible de cada columna, insignias, métricas y validación de la selección.
 * Sin React ni IPC (se prueba sola). Las métricas `null` significan «el motor no lo informó» y se pintan «—», nunca «0».
 */
import { COMPARE_MODELS_MAX, COMPARE_MODELS_MIN } from '@shared/ipc-code'
import type { CompareColumnManifest, CompareManifest, CompareMetrics, CompareModelRef } from '@shared/ipc-code'
import type { AssistantMessage } from '@opencode-ai/sdk/v2/client'
import { formatCost, formatTokens } from '../../lib/format'
import { dateLocale } from '../../lib/i18n'
import type { MessageEntry } from '../../lib/session-reducer'

/** Estado que se pinta: los de main más los derivados de las banderas de la columna. */
export type ColumnView =
  'queued' | 'starting' | 'running' | 'done' | 'error' | 'rateLimited' | 'cancelled' | 'adopted' | 'interrupted' | 'discarded'

export const columnView = (c: CompareColumnManifest): ColumnView => {
  if (c.discarded) return 'discarded'
  if (c.adopted) return 'adopted'
  if (c.interrupted) return 'interrupted'
  return c.state
}

/** La columna sigue consumiendo (o va a consumir) cupo: arrancando, corriendo, en cola o con un reintento programado. */
export const isActiveColumn = (c: CompareColumnManifest): boolean =>
  !c.discarded &&
  !c.interrupted &&
  (c.state === 'queued' || c.state === 'starting' || c.state === 'running' || (c.state === 'rateLimited' && c.retryAt !== null))

export const isActiveManifest = (m: CompareManifest): boolean => m.columns.some(isActiveColumn)

/** Todas las columnas llegaron a un estado final (la exportación al banco lo exige). */
export const isFinished = (m: CompareManifest): boolean => m.columns.every((c) => c.discarded || !isActiveColumn(c))

export const modelKey = (m: CompareModelRef): string => `${m.providerID}/${m.modelID}${m.variant ? `#${m.variant}` : ''}`

/** Proveedores con tope de simultaneidad (límite de uso): se avisa en el lanzador. */
export const isLimitedProvider = (providerID: string): boolean => providerID === 'opencode-go' || providerID === 'opencode'

export type SelectionIssue = 'min' | 'max' | 'dup'

export function validateSelection(models: readonly CompareModelRef[]): SelectionIssue | null {
  if (new Set(models.map(modelKey)).size !== models.length) return 'dup'
  if (models.length > COMPARE_MODELS_MAX) return 'max'
  if (models.length < COMPARE_MODELS_MIN) return 'min'
  return null
}

/** Segundos que faltan para el reintento programado (redondeado hacia arriba; nunca negativo). */
export const retrySeconds = (retryAt: number, now: number): number => Math.max(0, Math.ceil((retryAt - now) / 1000))

export type RateInfo =
  | { kind: 'scheduled'; seconds: number }
  /** Ya se reintentó (o el motor insistió): espera a que el usuario pulse «Reintentar». */
  | { kind: 'exhausted' }
  /** Columna en cola de un proveedor en pausa. */
  | { kind: 'paused' }

export function rateInfo(c: CompareColumnManifest, m: Pick<CompareManifest, 'pausedProviders'>, now: number): RateInfo | null {
  if (c.discarded || c.adopted) return null
  if (c.state === 'rateLimited')
    return c.retryAt !== null ? { kind: 'scheduled', seconds: retrySeconds(c.retryAt, now) } : { kind: 'exhausted' }
  if (c.state === 'queued' && m.pausedProviders.includes(c.model.providerID)) return { kind: 'paused' }
  return null
}

/** Coste a mostrar: `null` (o un 0 que no es un coste real) se pinta «—»; nunca «$0». */
export function costLabel(costUsd: number | null | undefined, none = '—'): string {
  if (costUsd === null || costUsd === undefined || !Number.isFinite(costUsd) || costUsd <= 0) return none
  return formatCost(costUsd)
}

export function tokensLabel(n: number | null | undefined, none = '—'): string {
  return n === null || n === undefined || !Number.isFinite(n) ? none : formatTokens(n)
}

export function durationLabel(ms: number | null | undefined, none = '—'): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return none
  // L7: por debajo de 10 s se muestra una décima («0,4 s»); si no, dos columnas distintas se verían como «0 s» y «0 s».
  if (ms < 10_000) return `${(Math.round(ms / 100) / 10).toLocaleString(dateLocale(), { maximumFractionDigits: 1 })} s`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const min = Math.floor(s / 60)
  return `${min} min ${String(s % 60).padStart(2, '0')} s`
}

/** Duración visible: la del manifiesto si ya hay una; mientras corre, `now - startedAt`. */
export function elapsedMs(c: CompareColumnManifest, now: number): number | null {
  if (c.metrics.durationMs !== null) return c.metrics.durationMs
  if (c.startedAt !== null && isActiveColumn(c) && c.state !== 'queued') return Math.max(0, now - c.startedAt)
  return null
}

export type BadgeKind = 'cheapest' | 'fastest' | 'smallest'

/**
 * Insignias entre las columnas HECHAS (hace falta al menos 2). Cada criterio solo cuenta las columnas que informan ese dato
 * (coste y diff pueden ser `null`) y se concede solo si hay al menos 2 con dato y no están todas empatadas.
 */
export function columnBadges(columns: readonly CompareColumnManifest[]): Map<number, BadgeKind[]> {
  const out = new Map<number, BadgeKind[]>()
  const done = columns.filter((c) => c.state === 'done' && !c.discarded)
  if (done.length < 2) return out
  const award = (
    kind: BadgeKind,
    value: (c: CompareColumnManifest) => number | null,
    /** ¿La diferencia entre el mejor y el siguiente es lo bastante grande para destacarla? */
    significant: (best: number, next: number) => boolean = () => true
  ): void => {
    const rows = done.map((c) => ({ index: c.index, v: value(c) })).filter((r): r is { index: number; v: number } => r.v !== null)
    if (rows.length < 2) return
    const min = Math.min(...rows.map((r) => r.v))
    if (rows.every((r) => r.v === min)) return
    const next = Math.min(...rows.filter((r) => r.v !== min).map((r) => r.v))
    if (!significant(min, next)) return
    for (const r of rows) if (r.v === min) out.set(r.index, [...(out.get(r.index) ?? []), kind])
  }
  award('cheapest', (c) => (c.metrics.costUsd !== null && c.metrics.costUsd > 0 ? c.metrics.costUsd : null))
  // «Más rápido» solo con una ventaja real: al menos 10 % y 200 ms sobre la siguiente (si no, es ruido de medición).
  award(
    'fastest',
    (c) => c.metrics.durationMs,
    (best, next) => next - best >= 200 && (next - best) / next >= 0.1
  )
  award('smallest', (c) => (c.diff ? c.diff.additions + c.diff.deletions : null))
  return out
}

const sum = (xs: (number | undefined)[]): number | null => {
  const known = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
  return known.length ? known.reduce((a, b) => a + b, 0) : null
}

/**
 * Métricas vivas a partir de la conversación ya cargada (respaldo mientras el manifiesto aún no trae números).
 * Lo que ningún mensaje informa es `null`; el coste 0 se trata como «no informado».
 */
export function liveMetrics(entries: readonly MessageEntry[], startedAt: number | null): CompareMetrics {
  const assistants = entries.map((e) => e.info).filter((i): i is AssistantMessage => i.role === 'assistant')
  const cost = sum(assistants.map((a) => a.cost))
  const completed = assistants.filter((a) => typeof a.time.completed === 'number')
  const last = completed[completed.length - 1]
  return {
    inputTokens: sum(assistants.map((a) => a.tokens?.input)),
    outputTokens: sum(assistants.map((a) => a.tokens?.output)),
    reasoningTokens: sum(assistants.map((a) => a.tokens?.reasoning)),
    cacheReadTokens: sum(assistants.map((a) => a.tokens?.cache?.read)),
    cacheWriteTokens: sum(assistants.map((a) => a.tokens?.cache?.write)),
    costUsd: cost !== null && cost > 0 ? cost : null,
    llmCalls: assistants.length,
    durationMs: last && startedAt !== null && last.time.completed ? Math.max(0, last.time.completed - startedAt) : null
  }
}

/** Números del manifiesto con respaldo en lo vivo, campo a campo (`null` solo si ninguno informa). */
export function mergeMetrics(manifest: CompareMetrics, live: CompareMetrics): CompareMetrics {
  return {
    inputTokens: manifest.inputTokens ?? live.inputTokens,
    outputTokens: manifest.outputTokens ?? live.outputTokens,
    reasoningTokens: manifest.reasoningTokens ?? live.reasoningTokens,
    cacheReadTokens: manifest.cacheReadTokens ?? live.cacheReadTokens,
    cacheWriteTokens: manifest.cacheWriteTokens ?? live.cacheWriteTokens,
    costUsd: manifest.costUsd ?? live.costUsd,
    llmCalls: Math.max(manifest.llmCalls, live.llmCalls),
    durationMs: manifest.durationMs ?? live.durationMs
  }
}
