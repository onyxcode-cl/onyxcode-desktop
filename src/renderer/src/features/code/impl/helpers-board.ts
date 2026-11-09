/**
 * Tablero «Ayudantes» de la conversación activa: una fila por sesión hija (subagente) que la raíz lanzó con `task`
 * (en primer plano o en segundo plano), con su estado, modelo, tokens, costo y tiempo.
 *
 * Funciones PURAS (sin red ni React). Todo sale de lo que el almacén ya tiene por los eventos del motor (`session.status`,
 * `message.updated`…): no se pregunta nada nuevo al motor. Lo que no se sabe sale como `null` («sin dato»), nunca inventado:
 *  - tokens: suma de `info.tokens` de los mensajes del asistente de la hija que el almacén tiene. Si no hay ninguno con cifras → `null`.
 *  - costo: suma de `info.cost` (el motor lo calcula con el precio del catálogo). 0 no distingue «gratis» de «sin precio» → `null`.
 *  - modelo: el del último mensaje del asistente de la hija (o el pedido en su mensaje de usuario).
 */
import type { Part, Session } from '@opencode-ai/sdk/v2/client'
import { sameDir } from './open-projects'

export type HelperState = 'working' | 'waiting' | 'blocked' | 'done' | 'error' | 'stopped'

export interface HelperRow {
  /** Id de la sesión hija. */
  id: string
  title: string
  /** Tipo de subagente (`explore`, `general`…), si lo hay. */
  agent: string | null
  state: HelperState
  /** Trabajando o esperando permiso (se puede detener). */
  live: boolean
  /** Lo lanzó en segundo plano. */
  background: boolean
  /** `proveedor/modelo` o `null` si no se sabe. */
  model: string | null
  tokens: { total: number; input: number; output: number } | null
  cost: number | null
  startedAt: number
  endedAt: number | null
  elapsedMs: number
}

export interface HelperBoard {
  rows: HelperRow[]
  liveCount: number
  /** Suma de tokens de las filas que tienen dato; `null` si ninguna lo tiene. */
  totalTokens: number | null
  /** Cuántas filas no tienen dato de tokens (para avisar que la suma es parcial). */
  unknownTokens: number
  totalCost: number | null
}

type Entry = { info: unknown; parts: Part[] }
export interface HelperBoardInput {
  rootId: string | null | undefined
  sessions: Record<string, Pick<Session, 'id' | 'parentID' | 'title' | 'time'> | undefined>
  status: Record<string, 'idle' | 'busy' | 'retry' | undefined>
  messages: Record<string, ReadonlyArray<Entry> | undefined>
  errors?: Record<string, unknown>
  /** Sesiones con un permiso, pregunta o formulario sin responder. */
  pendingSessionIds?: ReadonlySet<string> | readonly string[]
  now: number
}

/** Una hija recién creada puede estar «sin actividad» un instante antes de su primer `busy`. */
const FRESH_MS = 3_000
/** Tope de filas que se listan (las más recientes); el resto se resume con un número. */
export const MAX_HELPER_ROWS = 40

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

interface TaskRef {
  childId: string
  title: string
  agent: string | null
  background: boolean
  partStatus: string
  start: number | null
}

function taskRefs(entries: ReadonlyArray<Entry>): Map<string, TaskRef> {
  const out = new Map<string, TaskRef>()
  for (const e of entries) {
    for (const p of e.parts) {
      if (p.type !== 'tool' || p.tool !== 'task') continue
      const state = rec((p as { state?: unknown }).state)
      const meta = rec(state.metadata)
      const input = rec(state.input)
      const childId = str(meta.sessionId)
      if (!childId) continue
      const time = rec(state.time)
      out.set(childId, {
        childId,
        title: str(input.description) || str(state.title),
        agent: str(input.subagent_type) || null,
        background: meta.background === true || input.background === true,
        partStatus: str(state.status),
        start: typeof time.start === 'number' ? time.start : null
      })
    }
  }
  return out
}

/** Tokens, costo, modelo y si lo último fue un aborto, a partir de los mensajes de la hija que el almacén tiene. */
export function usageOfMessages(entries: ReadonlyArray<Entry> | undefined): {
  tokens: HelperRow['tokens']
  cost: number | null
  model: string | null
  aborted: boolean
} {
  let input = 0
  let output = 0
  let total = 0
  let seen = false
  let cost = 0
  let model: string | null = null
  let aborted = false
  for (const e of entries ?? []) {
    const info = rec(e.info)
    if (info.role === 'user') {
      const m = rec(info.model)
      if (!model && str(m.modelID)) model = str(m.providerID) ? `${str(m.providerID)}/${str(m.modelID)}` : str(m.modelID)
      continue
    }
    if (info.role !== 'assistant') continue
    if (str(info.modelID)) model = str(info.providerID) ? `${str(info.providerID)}/${str(info.modelID)}` : str(info.modelID)
    aborted = str(rec(info.error).name) === 'MessageAbortedError'
    cost += num(info.cost)
    const tk = rec(info.tokens)
    const cache = rec(tk.cache)
    const sum = num(tk.input) + num(tk.output) + num(tk.reasoning) + num(cache.read) + num(cache.write)
    const t = typeof tk.total === 'number' && tk.total > 0 ? tk.total : sum
    if (t > 0) {
      seen = true
      total += t
      input += num(tk.input)
      output += num(tk.output)
    }
  }
  return { tokens: seen ? { total, input, output } : null, cost: cost > 0 ? cost : null, model, aborted }
}

export function selectHelperBoard(input: HelperBoardInput): HelperBoard {
  const empty: HelperBoard = { rows: [], liveCount: 0, totalTokens: null, unknownTokens: 0, totalCost: null }
  const { rootId, sessions, status, messages, errors = {}, now } = input
  if (!rootId) return empty
  const pending = new Set(input.pendingSessionIds ?? [])
  const rows: HelperRow[] = []
  for (const ref of taskRefs(messages[rootId] ?? []).values()) {
    const sess = sessions[ref.childId]
    if (!sess || sess.parentID !== rootId) continue
    const startedAt = sess.time?.created ?? ref.start ?? now
    const run = status[ref.childId]
    const entries = messages[ref.childId]
    const use = usageOfMessages(entries)
    const fresh = now - startedAt < FRESH_MS && (entries?.length ?? 0) === 0
    let state: HelperState
    if (pending.has(ref.childId)) state = 'waiting'
    else if (run === 'retry') state = 'blocked'
    else if (run === 'busy') state = 'working'
    else if (errors[ref.childId] || ref.partStatus === 'error') state = 'error'
    else if (fresh) state = 'working'
    else if (use.aborted) state = 'stopped'
    else state = 'done'
    const live = state === 'working' || state === 'waiting' || state === 'blocked'
    const endedAt = live ? null : Math.max(startedAt, sess.time?.updated ?? startedAt)
    rows.push({
      id: ref.childId,
      title: ref.title || sess.title || ref.childId,
      agent: ref.agent,
      state,
      live,
      background: ref.background,
      model: use.model,
      tokens: use.tokens,
      cost: use.cost,
      startedAt,
      endedAt,
      elapsedMs: Math.max(0, (endedAt ?? now) - startedAt)
    })
  }
  // Vivos primero (los más antiguos arriba), luego los terminados, el más reciente primero.
  rows.sort((a, b) => (a.live === b.live ? (a.live ? a.startedAt - b.startedAt : b.startedAt - a.startedAt) : a.live ? -1 : 1))
  const known = rows.filter((r) => r.tokens)
  const costs = rows.filter((r) => r.cost !== null)
  return {
    rows,
    liveCount: rows.filter((r) => r.live).length,
    totalTokens: known.length ? known.reduce((n, r) => n + (r.tokens?.total ?? 0), 0) : null,
    unknownTokens: rows.length - known.length,
    totalCost: costs.length ? costs.reduce((n, r) => n + (r.cost ?? 0), 0) : null
  }
}

/**
 * ¿Se puede pedir algo al motor sobre las sesiones de `dir` desde este panel? Cada petición con `directory=` carga esa carpeta en el motor
 * (complementos y conectores), así que SOLO con la carpeta con el foco, de confianza vigente y verificada en esta ejecución
 * (docs/SEGURIDAD.md, «3 octogies septies decies»; mismo criterio que `syncLiveFolders`). Cierra en falso ante cualquier duda.
 */
export function canQueryFolder(
  dir: string | null | undefined,
  s: { directory: string | null; isTrusted: (d: string) => boolean },
  isVerified: (d: string) => boolean
): boolean {
  if (!dir || !s.directory) return false
  return sameDir(dir, s.directory) && s.isTrusted(dir) && isVerified(dir)
}
