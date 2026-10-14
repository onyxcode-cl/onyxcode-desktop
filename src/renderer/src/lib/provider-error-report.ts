import { friendlyError } from '@shared/ai-errors'
import type { OcEvent } from './opencode'
import { reportProblem } from './report-problems'

/**
 * Resumen de un error de proveedor de una sesión para el registro de problemas: SOLO id del proveedor, estado HTTP y clase
 * (`auth`, `quota`, `network`…). Nunca el texto del error ni el cuerpo de la respuesta (podrían llevar datos del usuario).
 * Devuelve `null` si el evento no es un error de sesión (o es un aborto del usuario).
 */
export function providerErrorSummary(ev: OcEvent): string | null {
  if (ev.type !== 'session.error') return null
  const error = (ev.properties as { error?: unknown }).error
  if (!error || typeof error !== 'object') return null
  const e = error as { name?: unknown; data?: { providerID?: unknown; statusCode?: unknown } }
  if (e.name === 'MessageAbortedError') return null
  const id = typeof e.data?.providerID === 'string' ? e.data.providerID.slice(0, 64) : '?'
  const status = typeof e.data?.statusCode === 'number' ? String(e.data.statusCode) : '?'
  const kind = friendlyError(error).kind
  const name = typeof e.name === 'string' ? e.name.slice(0, 64) : '?'
  return `Error de proveedor en una sesión: proveedor=${id} estado=${status} clase=${kind} tipo=${name}`
}

const lastSent = new Map<string, number>()
const SPAM_WINDOW_MS = 10_000

/** Anota el error de proveedor de un evento (si lo es), sin repetir lo mismo en 10 s; el registro además agrupa los repetidos. */
export function reportProviderError(ev: OcEvent, now: number = Date.now()): void {
  const summary = providerErrorSummary(ev)
  if (!summary) return
  const prev = lastSent.get(summary)
  if (prev !== undefined && now - prev < SPAM_WINDOW_MS) return
  lastSent.set(summary, now)
  if (lastSent.size > 50) lastSent.clear()
  reportProblem(summary)
}
