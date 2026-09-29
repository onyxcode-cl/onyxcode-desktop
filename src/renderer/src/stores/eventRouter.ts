/**
 * Enrutado de eventos del sidecar por directorio del sobre (Fase 6.5, D1). `useSessions` solo debe
 * recibir lo de Chat (y lo que Tareas aplica por su cuenta con su origen); Code tiene su propio store.
 */
import type { OcEvent } from '../lib/opencode'
import { useServer } from './server'
import { MAIN_SOURCE, useSessions } from './sessions'

export interface RouterCtx {
  chatDirectory: string | null
  /** ¿Es una sesión de Chat ya conocida? (fail-open si el directorio no coincide). */
  knownChat: (sessionID: string) => boolean
}

/**
 * Compara directorios tras quitar la barra final (sin realpath: no existe en el renderer).
 *
 * LÍMITE CONOCIDO (F7-B20, se deja así a propósito): no resuelve symlinks ni diferencias de mayúsculas/minúsculas
 * (macOS es insensible por defecto) ni `..`/`.`. Si el servidor reporta el directorio de otra forma que
 * `chatDirectory`, `shouldApplyToSessions` cae en su respaldo por sesión conocida (fail-open) y en desarrollo
 * avisa con `console.warn` (ver `routeEventToSessions`). Normalizar de más aquí arriesga unir directorios distintos.
 */
export function sameDir(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const n = (p: string): string => (p.length > 1 ? p.replace(/[\\/]+$/, '') : p)
  return n(a) === n(b)
}

/** sessionID del evento, con el mismo criterio que el reductor (`session-reducer`) y `sessions.ts`. */
export function eventSessionID(ev: OcEvent): string | undefined {
  const p = (ev as { properties?: Record<string, unknown> }).properties
  if (!p) return undefined
  if (typeof p.sessionID === 'string') return p.sessionID
  const part = p.part as { sessionID?: unknown } | undefined
  if (part && typeof part.sessionID === 'string') return part.sessionID
  const info = p.info as { id?: unknown; sessionID?: unknown } | undefined
  if (info) {
    if (typeof info.sessionID === 'string') return info.sessionID // message.updated
    if (typeof info.id === 'string' && ev.type.startsWith('session.')) return info.id // session.created/updated/deleted
  }
  return undefined
}

export function shouldApplyToSessions(ev: OcEvent, dir: string | null | undefined, ctx: RouterCtx): boolean {
  if (sameDir(dir, ctx.chatDirectory)) return true
  const sid = eventSessionID(ev)
  return !!sid && ctx.knownChat(sid)
}

const warned = new Set<string>()

/** Punto de entrada de `App.tsx`: aplica a `useSessions` solo los eventos de Chat (directorio de Chat o sesión de Chat conocida). */
export function routeEventToSessions(ev: OcEvent, dir: string): void {
  const chatDirectory = useServer.getState().connection?.chatDirectory ?? null
  const st = useSessions.getState()
  const knownChat = (sid: string): boolean => {
    const s = st.sessions[sid]
    return !!s && (st.sessionSource[sid] ?? MAIN_SOURCE) === MAIN_SOURCE && sameDir(s.directory, chatDirectory)
  }
  if (!shouldApplyToSessions(ev, dir, { chatDirectory, knownChat })) return
  // Alarma dev: sesión de Chat conocida que llega con otro directorio = desajuste de rutas (solo entra por fail-open).
  if (import.meta.env.DEV && !sameDir(dir, chatDirectory)) {
    const key = `${dir}|${chatDirectory}`
    if (!warned.has(key)) {
      warned.add(key)
      console.warn(`[eventRouter] evento de sesión de Chat con directory=${dir} distinto de chatDirectory=${chatDirectory}`)
    }
  }
  useSessions.getState().applyEvent(ev)
}
