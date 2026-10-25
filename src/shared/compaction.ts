/**
 * Compactación visible (motor propio, plan `docs/PLAN-REBOBINAR-Y-COMPACTACION.md`, 2.B y fase C3).
 *
 *  - `parseCompaction`: lee las cifras que el motor guarda en la parte `compaction.lazunox` (`auto`, `parcial`, `mensajes`, `tokensAntes`,
 *    `tokensDespues`, `reinyectado`). Todo es OPCIONAL: un motor anterior no las trae y la tarjeta dice solo «Se resumió la conversación».
 *    Solo se aceptan cifras y etiquetas con la forma del contrato (`plan:5`, `habilidades:2`…): nunca texto libre del motor.
 *  - `postSummarize`: `POST /session/{id}/summarize` con `upTo` («Compactar hasta aquí»). El SDK fijado no conoce `upTo`, así que va con
 *    `fetch` crudo (igual que los trabajos y rebobinar). Un motor que no entiende `upTo` lo ignoraría y compactaría TODO, por eso la app
 *    solo ofrece la acción con el motor propio nuevo (ver `compactUpToAvailable` en el store).
 *  - `compactBlockReason`: por qué NO se puede compactar ahora (el motor responde 409 por lo mismo).
 *
 * Funciones puras, sin Electron ni DOM.
 */

export const KEPT_KINDS = ['plan', 'habilidades', 'instrucciones', 'ayudantes', 'gancho'] as const
export type KeptKind = (typeof KEPT_KINDS)[number]

export interface KeptItem {
  kind: KeptKind
  count: number
}

export interface CompactionMeta {
  /** La disparó el motor (contexto casi lleno) y no la persona. */
  auto: boolean
  /** «Compactar hasta aquí»: lo posterior al mensaje elegido se conservó íntegro. */
  partial: boolean
  /** Mensajes resumidos, si el motor lo informa. */
  messages: number | null
  /** Tokens reales de la última respuesta antes de resumir. */
  tokensBefore: number | null
  /** ESTIMACIÓN de tokens tras resumir (se muestra con «≈»). */
  tokensAfter: number | null
  /** Lo que el motor volvió a inyectar tras el resumen, ya validado. */
  kept: KeptItem[]
}

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const MAX_NUM = 1_000_000_000
const KEPT_RE = /^(plan|habilidades|instrucciones|ayudantes|gancho):(\d{1,5})$/

const count = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), MAX_NUM) : null

/** Cifras de una parte `compaction`. Nunca lanza; sin `lazunox` (motor anterior) devuelve solo `auto`. */
export function parseCompaction(part: unknown): CompactionMeta {
  const p = isRec(part) ? part : {}
  const l = isRec(p.lazunox) ? p.lazunox : {}
  const kept: KeptItem[] = []
  if (Array.isArray(l.reinyectado)) {
    for (const raw of l.reinyectado.slice(0, 20)) {
      const m = typeof raw === 'string' ? KEPT_RE.exec(raw) : null
      if (!m) continue
      const n = Number(m[2])
      if (n > 0 && !kept.some((k) => k.kind === m[1])) kept.push({ kind: m[1] as KeptKind, count: n })
    }
  }
  return {
    auto: typeof l.auto === 'boolean' ? l.auto : p.auto === true,
    partial: l.parcial === true || p.manual_tail === true,
    messages: count(l.mensajes),
    tokensBefore: count(l.tokensAntes),
    tokensAfter: count(l.tokensDespues),
    kept
  }
}

/** ¿Hay cifras de contexto para mostrar? (Si no, la tarjeta dice solo que se resumió.) */
export function hasTokenMetrics(m: CompactionMeta): m is CompactionMeta & { tokensBefore: number; tokensAfter: number } {
  return m.tokensBefore !== null && m.tokensAfter !== null
}

/** Tokens liberados (nunca negativo). */
export function tokensFreed(m: { tokensBefore: number; tokensAfter: number }): number {
  return Math.max(0, m.tokensBefore - m.tokensAfter)
}

export type CompactBlockReason = 'ocupada' | 'pendiente' | 'revert'

/** Por qué no se puede compactar ahora; el orden es el del motor (ocupada, pendiente, revert). `null` = se puede. */
export function compactBlockReason(s: { busy: boolean; pending: boolean; revertPending: boolean }): CompactBlockReason | null {
  if (s.busy) return 'ocupada'
  if (s.pending) return 'pendiente'
  if (s.revertPending) return 'revert'
  return null
}

// ───────────────────────────── ruta del motor (fetch crudo) ─────────────────────────────

export interface SummarizeConn {
  baseUrl: string
  /** Valor completo de la cabecera `Authorization`. */
  authorization?: string
}

type FetchLike = typeof fetch
const TIMEOUT_MS = 20_000

export type SummarizeFailure =
  /** 409 `CompactionConflictError`: ocupada, permiso/pregunta/formulario pendiente o revert pendiente. */
  | { ok: false; kind: 'conflict'; motivo: CompactBlockReason | null }
  /** 400 `InvalidRequestError { field: "upTo" }`: `invalido` (no existe, no es de la persona, ya resumido) o `cola-grande`. */
  | { ok: false; kind: 'invalid'; reason: 'invalido' | 'cola-grande' | null }
  | { ok: false; kind: 'error'; error: string }

export type SummarizeOutcome = { ok: true } | SummarizeFailure

const REASONS = new Set<string>(['ocupada', 'pendiente', 'revert'])

/** Busca `key` en el cuerpo y en un nivel de anidación (`error`, `data`): el motor etiqueta sus errores de formas distintas. */
function pick(body: unknown, key: string): unknown {
  if (!isRec(body)) return undefined
  if (key in body) return body[key]
  for (const inner of [body.error, body.data]) if (isRec(inner) && key in inner) return inner[key]
  return undefined
}

/** `POST /session/{id}/summarize` con modelo explícito y, opcionalmente, `upTo`. Nunca lanza: devuelve el resultado. */
export async function postSummarize(
  conn: SummarizeConn,
  req: { sessionID: string; providerID: string; modelID: string; upTo?: string; directory?: string },
  fetchImpl: FetchLike = fetch
): Promise<SummarizeOutcome> {
  const q = req.directory ? `?directory=${encodeURIComponent(req.directory)}` : ''
  const endpoint = `${conn.baseUrl.replace(/\/+$/, '')}/session/${encodeURIComponent(req.sessionID)}/summarize`
  try {
    const res = await fetchImpl(endpoint + q, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(conn.authorization ? { Authorization: conn.authorization } : {}) },
      body: JSON.stringify({ providerID: req.providerID, modelID: req.modelID, ...(req.upTo ? { upTo: req.upTo } : {}) }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (res.ok) return { ok: true }
    const body = await res.json().catch(() => null)
    if (res.status === 409) {
      const m = pick(body, 'motivo')
      return { ok: false, kind: 'conflict', motivo: typeof m === 'string' && REASONS.has(m) ? (m as CompactBlockReason) : null }
    }
    if (res.status === 400 && pick(body, 'field') === 'upTo') {
      const k = pick(body, 'kind')
      return { ok: false, kind: 'invalid', reason: k === 'invalido' || k === 'cola-grande' ? k : null }
    }
    return { ok: false, kind: 'error', error: `El motor respondió ${res.status}` }
  } catch (err) {
    return { ok: false, kind: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}
