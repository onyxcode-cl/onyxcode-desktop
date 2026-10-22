/**
 * Sesiones HIJAS (subagentes) de una conversación: lo que la interfaz necesita para no perderlas de vista.
 *
 * Funciones PURAS y compartidas por Code, Tareas y Chat (los tres guardan sesiones, estado y mensajes con la misma forma).
 * Contexto (prueba real del motor 1.19): los permisos y las preguntas de un subagente llegan con el `sessionID` de la HIJA y, mientras
 * ella trabaja, la raíz figura `idle`. Aquí se resuelve: (a) cómo se llama el ayudante, (b) si una petición es de una hija y
 * (c) qué raíces siguen «ocupadas» por sus hijas en segundo plano (el trabajo vivo lo decide `selectBackgroundJobs`, sin duplicar lógica).
 */
import type { Part, Session } from '@opencode-ai/sdk/v2/client'
import { selectBackgroundJobs } from './background-jobs'

type SessionMap = Record<string, Pick<Session, 'id' | 'parentID' | 'title' | 'time'> | undefined>
type Entries = ReadonlyArray<{ parts: Part[] }>
type MessageMap = Record<string, Entries | undefined>
export type RunStatus = 'idle' | 'busy' | 'retry'
type StatusMap = Record<string, RunStatus | undefined>

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** Sube por `parentID` hasta la raíz (tope de 20 niveles, como `rootSessionID`). */
export function rootOf(sessions: SessionMap, sessionID: string): string {
  let id = sessionID
  for (let i = 0; i < 20; i++) {
    const parent = sessions[id]?.parentID
    if (!parent) return id
    id = parent
  }
  return id
}

/**
 * ¿La petición (permiso o pregunta) es de una sesión hija de la conversación abierta?
 * Conocida con `parentID` → sí; conocida sin `parentID` → no (es una raíz); desconocida (el subagente aún no está en la lista) →
 * sí si hay una conversación abierta distinta. Sin conversación abierta nunca se asume hija (cierre seguro para las pruebas y el arranque).
 */
export function isChildRequest(sessions: SessionMap, sessionID: string, activeRoot: string | null | undefined): boolean {
  const s = sessions[sessionID]
  if (s) return !!s.parentID
  return !!activeRoot && sessionID !== activeRoot
}

/**
 * Nombre del ayudante dueño de la sesión hija: la descripción que le dio el agente al lanzarlo (parte `task` del padre), su tipo
 * (`explore`, `general`…) o, si no hay ni eso, el título de la sesión. Cadena vacía si no se puede saber (raíz o hija aún sin datos).
 */
export function subagentNameOf(sessions: SessionMap, messages: MessageMap, sessionID: string): string {
  const sess = sessions[sessionID]
  const parent = sess?.parentID
  if (parent) {
    for (const e of messages[parent] ?? []) {
      for (const p of e.parts) {
        if (p.type !== 'tool' || p.tool !== 'task') continue
        const state = rec((p as { state?: unknown }).state)
        if (str(rec(state.metadata).sessionId) !== sessionID) continue
        const input = rec(state.input)
        const name = str(input.description) || str(input.subagent_type) || str(state.title)
        if (name) return name
      }
    }
  }
  return str(sess?.title)
}

/** Ids de sesiones hijas que trabajan (`busy`/`retry`) y de ahí sus raíces (sin duplicados). */
function rootsWithBusyChildren(sessions: SessionMap, status: StatusMap): string[] {
  const roots = new Set<string>()
  for (const id of Object.keys(status)) {
    const run = status[id]
    if ((run !== 'busy' && run !== 'retry') || !sessions[id]?.parentID) continue
    roots.add(rootOf(sessions, id))
  }
  return [...roots]
}

export interface BusyInput {
  sessions: SessionMap
  /** Estado de ejecución por sesión (`runState` en Code, `status` en Tareas/Chat). */
  status: StatusMap
  messages: MessageMap
  errors?: Record<string, unknown>
}

/**
 * Ids de las sesiones hijas VIVAS (trabajando o esperando permiso) que `rootId` lanzó en segundo plano. Es lo mismo que cuenta la banda
 * `BackgroundJobs` (la «Consulta lateral» de Tareas y los subagentes en primer plano no entran: no tienen parte `task` de fondo).
 */
export function liveBackgroundChildIds(input: BusyInput & { rootId: string | null | undefined; pending?: readonly string[] }): string[] {
  const { rootId, ...rest } = input
  if (!rootId) return []
  const view = selectBackgroundJobs({ ...rest, rootId, pendingSessionIds: input.pending, now: Date.now() })
  return view.jobs.filter((j) => j.state === 'running' || j.state === 'waiting').map((j) => j.id)
}

/**
 * Raíces que figuran `idle` pero tienen hijas en segundo plano vivas: para el selector de los almacenes (se usa con `useShallow`, así
 * el componente solo repinta cuando cambia el conjunto). Sale rápido si ninguna hija trabaja, que es lo normal.
 */
export function backgroundBusyRoots(input: BusyInput): string[] {
  const candidates = rootsWithBusyChildren(input.sessions, input.status)
  if (candidates.length === 0) return []
  return candidates
    .filter((rootId) => {
      const run = input.status[rootId]
      return run !== 'busy' && run !== 'retry' && liveBackgroundChildIds({ ...input, rootId }).length > 0
    })
    .sort()
}

/** Estado de ejecución «visible» de una raíz: el suyo, o `busy` si solo trabajan sus hijas en segundo plano. */
export function effectiveRun(
  run: RunStatus | undefined,
  rootId: string | null | undefined,
  busyRoots: readonly string[]
): RunStatus | undefined {
  if (run === 'busy' || run === 'retry') return run
  return rootId && busyRoots.includes(rootId) ? 'busy' : run
}

/** El mapa de estados con las raíces ocupadas por sus hijas marcadas `busy` (mismo objeto si no hay ninguna). */
export function withBackgroundBusy<T extends StatusMap>(status: T, busyRoots: readonly string[]): T {
  if (busyRoots.length === 0) return status
  const next: StatusMap = { ...status }
  for (const id of busyRoots) next[id] = 'busy'
  return next as T
}
