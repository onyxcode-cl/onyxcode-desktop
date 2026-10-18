/**
 * Lectura del uso (F8-B189): de dónde salen los números de «Uso». Todo es local: se le pregunta al motor de este equipo
 * (`experimental.session.list`, que ya guarda `tokens` y `cost` por sesión) y se suman las tareas de Overdrive: cada carpeta
 * aprobada tiene su propio servidor aislado y su propio registro, que `main` resume en `tasks:usage:summary` (solo cifras, F8-B198);
 * lo que la app tiene en memoria completa lo que ese resumen no cubra (p. ej. Windows). La lectura es perezosa (solo al abrir
 * la pantalla o al pulsar «Actualizar») y con tope.
 */
import type { GlobalSession, Session } from '@opencode-ai/sdk/v2/client'
import { CHAT_AGENT_ID, COMPUTER_AGENT_ID, TASKS_AGENT_ID } from '@shared/agents'
import { FREE_PROVIDER_ID } from '@shared/ai-availability'
import type { TasksUsageSummary } from '@shared/ipc-tasks'
import type { UsageMode, UsageSession } from './usage-aggregate'

/** Conversaciones más recientes que se leen (como la búsqueda global). */
export const USAGE_LIMIT = 300

type SessionLike = Pick<GlobalSession, 'id' | 'parentID' | 'directory' | 'agent' | 'model' | 'cost' | 'tokens' | 'time'>

/** Modo de una sesión del motor principal: por su agente y, si no lo trae, por la carpeta de Chat. */
export function modeOf(s: Pick<SessionLike, 'agent' | 'directory'>, chatDirectory: string | null): UsageMode {
  if (s.agent === CHAT_AGENT_ID) return 'chat'
  if (s.agent === TASKS_AGENT_ID || s.agent === COMPUTER_AGENT_ID) return 'tasks'
  if (chatDirectory && s.directory === chatDirectory) return 'chat'
  return 'code'
}

export function toUsageSession(s: SessionLike, mode: UsageMode): UsageSession {
  return {
    id: s.id,
    ...(s.parentID ? { parentID: s.parentID } : {}),
    mode,
    ...(s.model ? { model: { id: s.model.id, providerID: s.model.providerID } } : {}),
    ...(typeof s.cost === 'number' ? { cost: s.cost } : {}),
    ...(s.tokens ? { tokens: s.tokens } : {}),
    updated: s.time.updated
  }
}

/** Mínimo del cliente del motor que se usa (así las pruebas pasan uno falso). */
export interface UsageClient {
  experimental: {
    session: { list: (q: { limit: number }) => Promise<{ data?: GlobalSession[]; error?: unknown }> }
  }
}

export interface UsageRead {
  sessions: UsageSession[]
  /** La lectura llegó al tope: puede haber conversaciones más antiguas sin contar. */
  capped: boolean
  /** Actividad de la sesión más antigua leída del motor principal. */
  oldestRead?: number
  /** Cuántas sesiones de Overdrive se sumaron (las del resumen de `main` y las que la app tiene cargadas y no estaban en él). */
  tasksSessions: number
  /**
   * De dónde salió Overdrive: `read` = el registro de cada carpeta aprobada (completo); `unsupported` = esta plataforma no lo guarda donde la
   * app pueda leerlo (Windows); `unavailable` = no se pudo pedir. En los dos últimos solo se suma lo que la app tiene en memoria.
   */
  tasksSource: 'read' | 'unsupported' | 'unavailable'
  /** Carpetas de Overdrive cuyo registro no se pudo leer (solo con `tasksSource: 'read'`). */
  tasksUnreadable: number
}

/**
 * Lee el uso. `tasks` son las sesiones de Overdrive que la app ya tiene en memoria (se pasan de fuera; esta función no toca
 * ningún almacén). Lanza si el motor responde con error.
 */
export async function readUsage(
  client: UsageClient,
  opts: {
    chatDirectory: string | null
    tasks?: readonly Session[]
    /** Resumen de `tasks:usage:summary`; `null` si no se pudo pedir. */
    tasksUsage?: TasksUsageSummary | null
    limit?: number
  },
  errorText: (e: unknown) => string
): Promise<UsageRead> {
  const limit = opts.limit ?? USAGE_LIMIT
  const r = await client.experimental.session.list({ limit })
  if (r.error || !r.data) throw new Error(errorText(r.error))
  const seen = new Set<string>()
  const sessions: UsageSession[] = []
  for (const s of r.data) {
    if (seen.has(s.id)) continue
    seen.add(s.id)
    sessions.push(toUsageSession(s, modeOf(s, opts.chatDirectory)))
  }
  let tasksSessions = 0
  const summary = opts.tasksUsage ?? null
  let tasksOldest: number | undefined
  for (const s of summary?.supported ? summary.sessions : []) {
    if (seen.has(s.id)) continue
    seen.add(s.id)
    sessions.push({
      id: s.id,
      ...(s.parentID ? { parentID: s.parentID } : {}),
      mode: 'tasks',
      ...(s.model ? { model: s.model } : {}),
      ...(typeof s.cost === 'number' ? { cost: s.cost } : {}),
      tokens: s.tokens,
      updated: s.updated
    })
    tasksSessions++
    tasksOldest = tasksOldest === undefined || s.updated < tasksOldest ? s.updated : tasksOldest
  }
  for (const s of opts.tasks ?? []) {
    if (seen.has(s.id)) continue
    seen.add(s.id)
    sessions.push(toUsageSession(s, 'tasks'))
    tasksSessions++
  }
  const oldest = r.data.reduce<number | undefined>(
    (min, s) => (min === undefined || s.time.updated < min ? s.time.updated : min),
    undefined
  )
  // Cada fuente que llegó a su tope puede dejar fuera tareas más antiguas que su sesión más antigua leída: el período es incompleto si
  // empieza antes de CUALQUIERA de esas fechas, o sea, antes de la más reciente de ellas.
  const mainCapped = r.data.length >= limit
  const tasksCapped = !!summary?.supported && summary.capped
  const capped = mainCapped || tasksCapped
  const cutoffs = [mainCapped ? oldest : undefined, tasksCapped ? tasksOldest : undefined].filter((v): v is number => v !== undefined)
  const oldestAll = cutoffs.length > 0 ? Math.max(...cutoffs) : oldest
  return {
    sessions,
    capped,
    ...(oldestAll !== undefined ? { oldestRead: oldestAll } : {}),
    tasksSessions,
    tasksSource: !summary ? 'unavailable' : summary.supported ? 'read' : 'unsupported',
    tasksUnreadable: summary?.supported ? summary.unreadable : 0
  }
}

/**
 * ¿Es un modelo del servicio gratuito? Solo así se dice «gratuito»: un costo cero en cualquier otro servicio puede ser una
 * tarifa que falta, y entonces es «sin dato».
 */
export function isFreeModel(
  providerID: string,
  modelID: string,
  catalog: ReadonlyArray<{ id: string; models: Record<string, { cost?: { input: number; output: number } } | undefined> }>
): boolean {
  if (providerID !== FREE_PROVIDER_ID) return false
  const cost = catalog.find((p) => p.id === providerID)?.models[modelID]?.cost
  if (cost) return cost.input === 0 && cost.output === 0
  return /-free$/.test(modelID)
}
