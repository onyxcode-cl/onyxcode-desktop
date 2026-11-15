/**
 * V29: revisión por IA de lo dudoso en «Automático» (Código y Overdrive), contrato §3.
 *
 * El clasificador (`auto-command.ts`) decide `allow` / `hard` / `doubt`. Lo `doubt` se manda a
 * `POST /permission/{requestID}/review` (v1) o `POST /api/session/{sessionID}/permission/{requestID}/review` (v2):
 *  - `allow`: se responde «una vez».
 *  - `block`: se rechaza con el motivo para que la IA lo haga de otra forma; tras 3 bloqueos seguidos o 20 en la
 *    conversación, lo siguiente que sería `block` sale como tarjeta con el motivo a la vista.
 *  - `unavailable` (o un error, un tope o una respuesta que no se entiende): tarjeta. Nunca `allow` por defecto.
 * Puro salvo `requestReview` (fetch inyectable): lo usan el renderer (Código) y main (Overdrive).
 */
import type { AutoCommandResult } from './auto-command'

export type ReviewDecision = { decision: 'allow' | 'block' | 'unavailable'; reason: string }

/** El motor corta a los 20 s; la app espera un poco más para no adelantarse a su respuesta. */
export const REVIEW_TIMEOUT_MS = 25_000
export const MAX_CONSECUTIVE_BLOCKS = 3
export const MAX_TOTAL_BLOCKS = 20

const UNAVAILABLE: ReviewDecision = { decision: 'unavailable', reason: '' }

/** Respuesta del motor; cualquier otra forma es `unavailable`. */
export function parseReview(body: unknown): ReviewDecision {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return UNAVAILABLE
  const { decision, reason } = body as Record<string, unknown>
  if (decision !== 'allow' && decision !== 'block' && decision !== 'unavailable') return UNAVAILABLE
  const text = typeof reason === 'string' ? reason.replace(/\s+/g, ' ').trim().slice(0, 600) : ''
  return { decision, reason: text }
}

export interface ReviewTarget {
  id: string
  sessionID: string
  api: 'v1' | 'v2'
  /** Carpeta del proyecto (`?directory=` de la API v1). */
  directory?: string
}

export function reviewUrl(baseUrl: string, target: ReviewTarget): string {
  const base = baseUrl.replace(/\/+$/, '')
  if (target.api === 'v2')
    return `${base}/api/session/${encodeURIComponent(target.sessionID)}/permission/${encodeURIComponent(target.id)}/review`
  const q = target.directory ? `?directory=${encodeURIComponent(target.directory)}` : ''
  return `${base}/permission/${encodeURIComponent(target.id)}/review${q}`
}

/** Pide la revisión. Un motor sin la ruta (404/405), un error de red o un tope dan `unavailable`. */
export async function requestReview(
  conn: { baseUrl: string; authorization?: string },
  target: ReviewTarget,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = REVIEW_TIMEOUT_MS
): Promise<ReviewDecision> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (conn.authorization) headers.Authorization = conn.authorization
    const res = await fetchImpl(reviewUrl(conn.baseUrl, target), {
      method: 'POST',
      headers,
      body: '{}',
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) return UNAVAILABLE
    return parseReview(await res.json().catch(() => null))
  } catch {
    return UNAVAILABLE
  }
}

/** Mensaje que recibe la IA cuando el revisor bloquea (`reject` + `message`). */
export function blockMessage(reason: string): string {
  const why = reason.replace(/[\s.]+$/, '') || 'no parece necesario para lo pedido'
  // i18n-ignore: prompt al agente (se queda en español, como los demás textos para la IA)
  return `Revisión automática: ${why}. Hazlo de otra forma o pregúntale a la persona.`
}

/**
 * Contador de bloqueos por conversación (clave: la sesión raíz). Tras `MAX_CONSECUTIVE_BLOCKS` seguidos o
 * `MAX_TOTAL_BLOCKS` en total, el siguiente bloqueo se convierte en tarjeta. Una aprobación de la persona (o del
 * revisor) corta la racha de seguidos; el total no se reinicia.
 */
export class ReviewTracker {
  private readonly counts = new Map<string, { consecutive: number; total: number }>()
  constructor(
    private readonly limits = { consecutive: MAX_CONSECUTIVE_BLOCKS, total: MAX_TOTAL_BLOCKS },
    private readonly max = 500
  ) {}

  private entry(key: string): { consecutive: number; total: number } {
    let e = this.counts.get(key)
    if (!e) {
      if (this.counts.size >= this.max) this.counts.delete(this.counts.keys().next().value!)
      e = { consecutive: 0, total: 0 }
      this.counts.set(key, e)
    }
    return e
  }

  /** Un `block` del revisor: `reject` si aún se puede devolver a la IA, `card` si ya se llegó al tope. */
  onBlock(key: string): 'reject' | 'card' {
    const e = this.entry(key)
    if (e.consecutive >= this.limits.consecutive || e.total >= this.limits.total) return 'card'
    e.consecutive++
    e.total++
    return 'reject'
  }

  /** La persona aprobó algo en esta conversación. */
  personApproved(key: string): void {
    const e = this.counts.get(key)
    if (e) e.consecutive = 0
  }

  /** El revisor aprobó: también corta la racha de bloqueos seguidos. */
  reviewerAllowed(key: string): void {
    this.personApproved(key)
  }

  snapshot(key: string): { consecutive: number; total: number } {
    return { ...(this.counts.get(key) ?? { consecutive: 0, total: 0 }) }
  }
}

export type AutoDecision = { action: 'once' } | { action: 'card'; note?: string } | { action: 'reject'; message: string }

/**
 * Flujo completo de una petición de terminal en «Automático»: `allow` → una vez; `hard` → tarjeta; `doubt` → revisión.
 * `review` solo se llama para `doubt`.
 */
export async function decideAuto(
  verdict: AutoCommandResult,
  review: () => Promise<ReviewDecision>,
  tracker: ReviewTracker,
  key: string
): Promise<AutoDecision> {
  if (verdict.verdict === 'allow') return { action: 'once' }
  if (verdict.verdict === 'hard') return { action: 'card' }
  let result: ReviewDecision
  try {
    result = await review()
  } catch {
    result = UNAVAILABLE
  }
  if (result.decision === 'allow') {
    tracker.reviewerAllowed(key)
    return { action: 'once' }
  }
  if (result.decision === 'block') {
    if (tracker.onBlock(key) === 'card') return { action: 'card', note: result.reason || undefined }
    return { action: 'reject', message: blockMessage(result.reason) }
  }
  return { action: 'card' }
}

/** Reglas de «no volver a preguntar en este proyecto» (contrato §1): las `rule` no nulas de `subcommands`, sin repetir. */
export function subcommandRules(metadata: unknown): string[] | null {
  if (!metadata || typeof metadata !== 'object') return null
  const list = (metadata as Record<string, unknown>).subcommands
  if (!Array.isArray(list)) return null
  const rules: string[] = []
  for (const item of list) {
    const rule = item && typeof item === 'object' ? (item as Record<string, unknown>).rule : null
    if (typeof rule === 'string' && rule.trim() && !rules.includes(rule)) rules.push(rule)
  }
  return rules.slice(0, 5)
}

/** Carpetas de fuera del proyecto que toca el comando (`externalDirectories`; motor viejo: `directories`). */
export function outsideDirectories(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== 'object') return []
  const md = metadata as Record<string, unknown>
  const list = Array.isArray(md.externalDirectories) ? md.externalDirectories : Array.isArray(md.directories) ? md.directories : []
  return [...new Set(list.filter((d): d is string => typeof d === 'string' && d.trim() !== ''))]
}
