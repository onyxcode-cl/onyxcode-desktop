/** Qué muestra el inicio de Code para retomar sesiones: las que esperan al usuario y las recientes del proyecto (lógica pura). */
import type { Session } from '@opencode-ai/sdk/v2/client'
import type { SessionState } from '../../../components/SidebarTree'

export const CODE_HOME_WAITING_MAX = 3
export const CODE_HOME_RECENT_MAX = 5

export interface CodeHomeItem {
  session: Session
  /** El mismo estado que pinta el punto de la barra lateral (`deriveSessionState`). */
  state: SessionState | null
}

export interface CodeHome {
  /** Las que esperan aprobación o respuesta (máx. 3), la más reciente primero. */
  waiting: CodeHomeItem[]
  /** Cuántas esperan en total (puede ser más que las mostradas). */
  waitingTotal: number
  /** Las más recientes que no esperan (máx. 5). */
  recent: CodeHomeItem[]
  /** ¿El proyecto ya tiene sesiones? Decide si las ideas de ejemplo salen plegadas. */
  hasSessions: boolean
}

/**
 * Sesiones que bloquean a su raíz: un permiso o una pregunta pendiente de una subsesión cuentan para la sesión principal.
 * Es la misma cuenta que hace la barra lateral.
 */
export function waitingRoots(
  permissions: Record<string, { sessionID: string }>,
  questions: Record<string, { sessionID: string }>,
  rootOf: (sessionID: string) => string
): Set<string> {
  return new Set([
    ...Object.values(permissions).map((p) => rootOf(p.sessionID)),
    ...Object.values(questions).map((q) => rootOf(q.sessionID))
  ])
}

/** `sessions`: las del proyecto actual. Se ignoran subsesiones y archivadas; un id repetido cuenta una vez y sale en una sola lista. */
export function pickCodeHome(sessions: Session[], stateOf: (s: Session) => SessionState | null): CodeHome {
  const seen = new Set<string>()
  const items: CodeHomeItem[] = []
  for (const session of sessions) {
    if (seen.has(session.id) || session.parentID || session.time.archived) continue
    seen.add(session.id)
    items.push({ session, state: stateOf(session) })
  }
  items.sort((a, b) => b.session.time.updated - a.session.time.updated || a.session.id.localeCompare(b.session.id))
  const waiting = items.filter((i) => i.state === 'waiting')
  return {
    waiting: waiting.slice(0, CODE_HOME_WAITING_MAX),
    waitingTotal: waiting.length,
    recent: items.filter((i) => i.state !== 'waiting').slice(0, CODE_HOME_RECENT_MAX),
    hasSessions: items.length > 0
  }
}
