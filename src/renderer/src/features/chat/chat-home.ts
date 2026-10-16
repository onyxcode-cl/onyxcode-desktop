/** Qué muestra el inicio de Chat para retomar conversaciones: la respuesta en curso y las más recientes (lógica pura). */
import type { Session } from '@opencode-ai/sdk/v2/client'

export const CHAT_HOME_WORKING_MAX = 3
export const CHAT_HOME_RECENT_MAX = 5

export interface ChatHomeItem {
  session: Session
  working: boolean
}

export interface ChatHome {
  /** Conversaciones donde el asistente está respondiendo ahora (máx. 3), la más reciente primero. */
  working: ChatHomeItem[]
  /** Las más recientes que no están respondiendo (máx. 5). */
  recent: ChatHomeItem[]
  /** ¿Hay conversaciones? Decide si las ideas de ejemplo salen plegadas. */
  hasChats: boolean
}

/**
 * `sessions`: conversaciones de Chat; se ignoran subsesiones y archivadas, y un id repetido cuenta una vez. Una conversación
 * sale en una sola lista.
 */
export function pickChatHome(sessions: Session[], busyIds: ReadonlySet<string>): ChatHome {
  const seen = new Set<string>()
  const items: ChatHomeItem[] = []
  for (const session of sessions) {
    if (seen.has(session.id) || session.parentID || session.time.archived) continue
    seen.add(session.id)
    items.push({ session, working: busyIds.has(session.id) })
  }
  items.sort((a, b) => b.session.time.updated - a.session.time.updated || a.session.id.localeCompare(b.session.id))
  return {
    working: items.filter((i) => i.working).slice(0, CHAT_HOME_WORKING_MAX),
    recent: items.filter((i) => !i.working).slice(0, CHAT_HOME_RECENT_MAX),
    hasChats: items.length > 0
  }
}
