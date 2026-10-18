/**
 * Agregación del uso (F8-B189): suma lo que el motor ya guarda por conversación (tokens de entrada, salida, razonamiento y caché,
 * y costo cuando el servicio de IA lo informa) por período, modelo, modo y día/semana. Es pura: no lee ni escribe nada.
 *
 * Reglas de honestidad (no se inventa ningún número):
 *  - Cada conversación se cuenta en el día de su ÚLTIMA actividad (el motor guarda totales por conversación, no por día).
 *  - El costo solo es un monto si el motor informó uno mayor que cero. Un modelo del servicio gratuito sin costo se cuenta como
 *    «gratuito». Cualquier otro caso con uso y sin costo es «sin dato» (puede ser gratis, local o un servicio sin tarifa).
 *  - Los subagentes (sesiones hijas) suman tokens y costo pero no cuentan como conversaciones.
 */
import type { MsgKey } from '@shared/i18n'

export type UsageMode = 'chat' | 'code' | 'tasks'
export type UsagePeriod = 'today' | '7d' | '30d'
export const USAGE_PERIODS: readonly UsagePeriod[] = ['today', '7d', '30d']

/** Lo mínimo que se necesita de una sesión del motor (la forma de `Session`/`GlobalSession` del SDK). */
export interface UsageSession {
  id: string
  parentID?: string
  mode: UsageMode
  model?: { id: string; providerID: string }
  cost?: number
  tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  /** Última actividad (epoch ms). */
  updated: number
}

export interface TokenTotals {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

/** Costo de un grupo: monto informado + cuántas conversaciones fueron gratuitas o quedaron sin dato. */
export interface CostTotals {
  /** Suma de los costos informados (USD, solo de las sesiones con costo mayor que cero). */
  usd: number
  paid: number
  free: number
  unknown: number
}

export type CostKind = 'none' | 'free' | 'amount' | 'unknown'

export interface UsageRow {
  /** Clave estable: `provider/modelo`, el modo, o el inicio del día/semana (epoch ms como texto). */
  key: string
  conversations: number
  sessions: number
  tokens: TokenTotals
  /** Tokens nuevos: entrada + salida + razonamiento (la caché se muestra aparte). */
  total: number
  cost: CostTotals
}

export interface UsageReport {
  period: UsagePeriod
  /** Inicio del período (epoch ms). */
  from: number
  conversations: number
  sessions: number
  tokens: TokenTotals
  total: number
  cost: CostTotals
  byModel: UsageRow[]
  byMode: UsageRow[]
  /** Por día (7 días) o por semana (30 días); vacío con «hoy». */
  buckets: UsageRow[]
  bucketUnit: 'day' | 'week' | null
  /** true si la lectura se cortó en el tope y este período podría tener conversaciones más antiguas sin contar. */
  incomplete: boolean
}

const DAY = 86_400_000
export const UNKNOWN_MODEL = '\u0000unknown'

const emptyTokens = (): TokenTotals => ({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 })
const emptyCost = (): CostTotals => ({ usd: 0, paid: 0, free: 0, unknown: 0 })
const newRow = (key: string): UsageRow => ({ key, conversations: 0, sessions: 0, tokens: emptyTokens(), total: 0, cost: emptyCost() })

const num = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0)

export function startOfDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Lunes (00:00 local) de la semana de `ms`. */
export function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms))
  const back = (d.getDay() + 6) % 7
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime()
}

/** Inicio de un período en días de calendario locales: hoy, los últimos 7 días (con hoy) o los últimos 30. */
export function periodStart(period: UsagePeriod, now: number): number {
  const today = new Date(startOfDay(now))
  const back = period === 'today' ? 0 : period === '7d' ? 6 : 29
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - back).getTime()
}

/** Tokens nuevos de una sesión (entrada + salida + razonamiento). */
export function sessionTotal(s: UsageSession): number {
  return num(s.tokens?.input) + num(s.tokens?.output) + num(s.tokens?.reasoning)
}

function hasUsage(s: UsageSession): boolean {
  return sessionTotal(s) > 0 || num(s.tokens?.cache.read) > 0 || num(s.tokens?.cache.write) > 0 || num(s.cost) > 0
}

function addTo(row: UsageRow, s: UsageSession, free: boolean): void {
  const k = s.tokens
  row.sessions++
  if (!s.parentID) row.conversations++
  row.tokens.input += num(k?.input)
  row.tokens.output += num(k?.output)
  row.tokens.reasoning += num(k?.reasoning)
  row.tokens.cacheRead += num(k?.cache.read)
  row.tokens.cacheWrite += num(k?.cache.write)
  row.total += sessionTotal(s)
  // Una sesión sin ningún uso (conversación vacía) no cuenta ni como gratuita ni como «sin dato».
  if (!hasUsage(s)) return
  const cost = num(s.cost)
  if (cost > 0) {
    row.cost.usd += cost
    row.cost.paid++
  } else if (free) row.cost.free++
  else row.cost.unknown++
}

/** Cómo mostrar el costo de un grupo. */
export function costKind(c: CostTotals): CostKind {
  if (c.paid > 0) return 'amount'
  if (c.unknown > 0) return 'unknown'
  if (c.free > 0) return 'free'
  return 'none'
}

const byTotalDesc = (a: UsageRow, b: UsageRow): number =>
  b.total - a.total || b.conversations - a.conversations || a.key.localeCompare(b.key)

export interface AggregateOptions {
  now: number
  period: UsagePeriod
  /** ¿Este modelo es del servicio gratuito? */
  isFree: (providerID: string, modelID: string) => boolean
  /** La lectura llegó al tope de conversaciones. */
  capped?: boolean
  /** Actividad de la sesión leída más antigua: si el período empieza antes, está incompleto. */
  oldestRead?: number
}

export function aggregateUsage(sessions: readonly UsageSession[], opts: AggregateOptions): UsageReport {
  const from = periodStart(opts.period, opts.now)
  const total = newRow('total')
  const models = new Map<string, UsageRow>()
  const modes = new Map<string, UsageRow>()
  const buckets = new Map<number, UsageRow>()
  const unit: 'day' | 'week' | null = opts.period === 'today' ? null : opts.period === '7d' ? 'day' : 'week'

  for (const s of sessions) {
    if (s.updated < from || s.updated > opts.now + DAY) continue
    const free = !!s.model && opts.isFree(s.model.providerID, s.model.id)
    addTo(total, s, free)
    const mk = s.model ? `${s.model.providerID}/${s.model.id}` : UNKNOWN_MODEL
    addTo(models.get(mk) ?? models.set(mk, newRow(mk)).get(mk)!, s, free)
    addTo(modes.get(s.mode) ?? modes.set(s.mode, newRow(s.mode)).get(s.mode)!, s, free)
    if (unit) {
      const start = unit === 'day' ? startOfDay(s.updated) : startOfWeek(s.updated)
      addTo(buckets.get(start) ?? buckets.set(start, newRow(String(start))).get(start)!, s, free)
    }
  }

  // Todos los días de la semana aparecen (también los de cero), para que la barra se lea como una serie.
  if (unit === 'day') {
    for (let i = 0; i < 7; i++) {
      const d = new Date(from)
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i).getTime()
      if (!buckets.has(start)) buckets.set(start, newRow(String(start)))
    }
  }

  return {
    period: opts.period,
    from,
    conversations: total.conversations,
    sessions: total.sessions,
    tokens: total.tokens,
    total: total.total,
    cost: total.cost,
    byModel: [...models.values()].sort(byTotalDesc),
    byMode: (['chat', 'code', 'tasks'] as const).map((m) => modes.get(m) ?? newRow(m)),
    buckets: [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r),
    bucketUnit: unit,
    incomplete: !!opts.capped && opts.oldestRead !== undefined && from < opts.oldestRead
  }
}

/** Texto de estado de la cabecera: clave del diccionario y parámetros (el componente los formatea). */
export interface UsageStatus {
  tone: 'ok' | 'warn' | 'empty'
  key: MsgKey
  /** Qué decir sobre el costo, o null si no hay nada que decir. */
  costKey: MsgKey | null
}

export function usageStatus(r: UsageReport): UsageStatus {
  const kind = costKind(r.cost)
  const costKey: MsgKey | null =
    kind === 'amount'
      ? r.cost.unknown > 0
        ? 'settings.usage.status.costMixed'
        : 'settings.usage.status.costAmount'
      : kind === 'free'
        ? 'settings.usage.status.costFree'
        : kind === 'unknown'
          ? 'settings.usage.status.costUnknown'
          : null
  if (r.conversations === 0 && r.sessions === 0) return { tone: 'empty', key: 'settings.usage.status.empty', costKey: null }
  return {
    tone: r.incomplete ? 'warn' : 'ok',
    key: r.incomplete ? 'settings.usage.status.incomplete' : 'settings.usage.status.ok',
    costKey
  }
}
