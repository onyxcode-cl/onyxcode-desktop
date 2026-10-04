/**
 * Clasificación de errores de cuota («token rate limit», 429…) de una columna. Puro.
 * Reutiliza `friendlyError(...).kind === 'quota'` y cubre explícitamente «token rate limit» y el 429.
 */
import { friendlyError } from '@shared/ai-errors'
import { COMPARE_LIMITS } from './limits'

const TOKEN_RATE_LIMIT_RE = /token\s+rate\s+limit/i

/** Error de una llamada al motor: conserva el objeto crudo (`{ name, data: { statusCode… } }`) para clasificarlo. */
export class EngineCallError extends Error {
  constructor(
    readonly raw: unknown,
    message?: string
  ) {
    super(message ?? describeRaw(raw))
    this.name = 'EngineCallError'
  }
}

function describeRaw(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object') {
    const o = raw as { message?: unknown; data?: { message?: unknown } }
    if (typeof o.data?.message === 'string') return o.data.message
    if (typeof o.message === 'string') return o.message
  }
  return 'engine error'
}

function unwrap(err: unknown): unknown {
  return err instanceof EngineCallError ? err.raw : err
}

/** Texto legible del error (sin pila), para mostrarlo ya redactado por quien lo guarde. */
export function errorText(err: unknown): string {
  return describeRaw(unwrap(err))
}

export function isQuotaError(err: unknown): boolean {
  const raw = unwrap(err)
  if (TOKEN_RATE_LIMIT_RE.test(describeRaw(raw))) return true
  return friendlyError(raw).kind === 'quota'
}

/** Mensaje suelto (p. ej. el de `session.status: retry`). */
export function isQuotaMessage(text: string): boolean {
  return TOKEN_RATE_LIMIT_RE.test(text) || friendlyError(text).kind === 'quota'
}

export type EngineRetryStatus = { type: 'retry'; attempt: number; message: string }

/** El motor ya está reintentando solo por cuota más veces de las toleradas: hay que abortar la columna. */
export function engineRetryExceeded(
  status: { type: string; attempt?: number; message?: string } | undefined,
  limit: number = COMPARE_LIMITS.engineRetryAbortAfter
): boolean {
  if (!status || status.type !== 'retry') return false
  return typeof status.attempt === 'number' && status.attempt > limit && isQuotaMessage(status.message ?? '')
}

/** Espera del único reintento: 20 s ± 5 s. */
export function retryDelayMs(
  random: () => number = Math.random,
  base: number = COMPARE_LIMITS.retryBaseMs,
  jitter: number = COMPARE_LIMITS.retryJitterMs
): number {
  const r = Math.min(1, Math.max(0, random()))
  return Math.round(base - jitter + r * 2 * jitter)
}
