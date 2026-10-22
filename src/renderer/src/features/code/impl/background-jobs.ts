/**
 * Trabajos en segundo plano de una conversación (subagentes lanzados con `task` y `background`).
 *
 * Selector PURO, compartido por Code y Tareas (los dos guardan sesiones, estado y mensajes con la misma forma).
 *
 * Qué cuenta como trabajo: una sesión HIJA de la sesión raíz actual a la que apunta una parte `task` de la raíz
 * (`state.metadata.sessionId`) marcada como de fondo (`metadata.background` o `input.background`). `parentID` solo NO basta:
 * la «Consulta lateral» de Tareas también es una sesión hija y no tiene parte `task`, así que nunca entra.
 * Los subagentes en primer plano ya tienen su propia tarjeta en la conversación y tampoco entran.
 */
import type { Part, Session } from '@opencode-ai/sdk/v2/client'

/** Máximo de trabajos vivos que se listan a la vez; de ahí en adelante se avisa. El motor no pone tope. */
export const MAX_VISIBLE_JOBS = 4
/** Cuánto tiempo (ms) se deja a la vista un trabajo que ya terminó, para que se vea cómo acabó. */
export const FINISHED_GRACE_MS = 20_000
/** Una hija recién creada puede estar «sin actividad» un instante antes de su primer `busy`. */
const FRESH_MS = 3_000

export type BackgroundJobState = 'running' | 'waiting' | 'done' | 'failed'

export interface BackgroundJob {
  /** Id de la sesión hija (lo que se aborta con «Cancelar»). */
  id: string
  /** Descripción corta que dio el agente (o el título de la sesión). */
  title: string
  /** Tipo de subagente (`explore`, `general`…), si lo hay. */
  agent: string | null
  state: BackgroundJobState
  startedAt: number
  /** Cuándo terminó; `null` si sigue viva. */
  endedAt: number | null
  elapsedMs: number
}

export interface BackgroundJobsView {
  /** Los que se muestran: hasta `MAX_VISIBLE_JOBS` vivos (los más antiguos) y los terminados hace poco. */
  jobs: BackgroundJob[]
  /** Cuántos trabajos hay vivos en total (corriendo o esperando permiso). */
  liveCount: number
  /** Vivos que no caben en la lista. */
  hidden: number
  /** Hay más trabajos vivos que el tope visible. */
  overLimit: boolean
}

export interface BackgroundJobsInput {
  /** Sesión raíz de la conversación abierta. */
  rootId: string | null | undefined
  sessions: Record<string, Pick<Session, 'id' | 'parentID' | 'title' | 'time'> | undefined>
  status: Record<string, 'idle' | 'busy' | 'retry' | undefined>
  messages: Record<string, ReadonlyArray<{ parts: Part[] }> | undefined>
  errors?: Record<string, unknown>
  /** Sesiones con un permiso o una pregunta sin responder. */
  pendingSessionIds?: ReadonlySet<string> | readonly string[]
  now: number
}

interface TaskRef {
  childId: string
  title: string
  agent: string | null
  background: boolean
  partStatus: string
  start: number | null
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Las partes `task` de la raíz que apuntan a una sesión hija, por id de hija (la última parte gana). */
function taskRefs(entries: ReadonlyArray<{ parts: Part[] }>): Map<string, TaskRef> {
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

export function selectBackgroundJobs(input: BackgroundJobsInput): BackgroundJobsView {
  const empty: BackgroundJobsView = { jobs: [], liveCount: 0, hidden: 0, overLimit: false }
  const { rootId, sessions, status, messages, errors = {}, now } = input
  if (!rootId) return empty
  const pending = new Set(input.pendingSessionIds ?? [])
  const refs = taskRefs(messages[rootId] ?? [])

  const live: BackgroundJob[] = []
  const finished: BackgroundJob[] = []
  for (const ref of refs.values()) {
    if (!ref.background) continue
    const sess = sessions[ref.childId]
    if (!sess || sess.parentID !== rootId) continue
    const startedAt = sess.time?.created ?? ref.start ?? now
    const run = status[ref.childId]
    const fresh = now - startedAt < FRESH_MS && (messages[ref.childId]?.length ?? 0) === 0
    let state: BackgroundJobState
    if (pending.has(ref.childId)) state = 'waiting'
    else if (run === 'busy' || run === 'retry') state = 'running'
    else if (errors[ref.childId] || ref.partStatus === 'error') state = 'failed'
    else if (fresh) state = 'running'
    else state = 'done'

    const alive = state === 'running' || state === 'waiting'
    const endedAt = alive ? null : Math.max(startedAt, sess.time?.updated ?? startedAt)
    const job: BackgroundJob = {
      id: ref.childId,
      title: ref.title || sess.title || ref.childId,
      agent: ref.agent,
      state,
      startedAt,
      endedAt,
      elapsedMs: Math.max(0, (endedAt ?? now) - startedAt)
    }
    if (alive) live.push(job)
    else if (endedAt !== null && now - endedAt <= FINISHED_GRACE_MS) finished.push(job)
  }

  live.sort((a, b) => a.startedAt - b.startedAt)
  finished.sort((a, b) => a.startedAt - b.startedAt)
  const shown = live.slice(0, MAX_VISIBLE_JOBS)
  return {
    jobs: [...shown, ...finished],
    liveCount: live.length,
    hidden: live.length - shown.length,
    overLimit: live.length > MAX_VISIBLE_JOBS
  }
}

/** «1 min 05 s», «42 s»: tiempo transcurrido legible y corto. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`
  if (m > 0) return `${m} min ${String(s).padStart(2, '0')} s`
  return `${s} s`
}
