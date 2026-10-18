/**
 * Lectura del uso (F8-B189): de dónde salen los números de «Uso». Todo es local: se le pregunta al motor de este equipo
 * (`experimental.session.list`, que ya guarda `tokens` y `cost` por sesión) y se suman las tareas de Overdrive que la app tiene
 * a la vista (cada carpeta de Overdrive tiene su propio motor y su propio almacén). La lectura es perezosa (solo al abrir
 * la pantalla o al pulsar «Actualizar») y con tope.
 */
import type { GlobalSession, Session } from '@opencode-ai/sdk/v2/client'
import { CHAT_AGENT_ID, COMPUTER_AGENT_ID, TASKS_AGENT_ID } from '@shared/agents'
import { FREE_PROVIDER_ID } from '@shared/ai-availability'
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
  /** Cuántas sesiones de Overdrive se sumaron (las que la app tiene cargadas). */
  tasksSessions: number
}

/**
 * Lee el uso. `tasks` son las sesiones de Overdrive que la app ya tiene en memoria (se pasan de fuera; esta función no toca
 * ningún almacén). Lanza si el motor responde con error.
 */
export async function readUsage(
  client: UsageClient,
  opts: { chatDirectory: string | null; tasks?: readonly Session[]; limit?: number },
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
  return { sessions, capped: r.data.length >= limit, ...(oldest !== undefined ? { oldestRead: oldest } : {}), tasksSessions }
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
