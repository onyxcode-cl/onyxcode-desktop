/**
 * Estado de sesiones/mensajes de OpenCode alimentado por eventos SSE.
 * Es genérico (no depende del modo): Chat y Cowork lo reutilizan filtrando por directorio.
 *
 * ORIGEN (AUDIT.md B2): lo alimentan varios servidores (sidecar principal = Chat/Code y un
 * servidor por carpeta/modo de Cowork, cada uno con su propio almacenamiento). Cada sesión
 * guarda de qué servidor vino (`sessionSource`, clave = `MAIN_SOURCE` o el baseUrl del servidor
 * de Cowork) y cada directorio puede fijar qué origen se muestra (`directorySource`, lo pone
 * Cowork al conectar su carpeta). Así una misma carpeta abierta en Code y en Cowork no mezcla
 * listas, y `loadSessions` solo reemplaza las sesiones del origen que recarga.
 *
 * CARGA vs. STREAM (AUDIT.md B4): mientras `loadMessages` espera el snapshot, los eventos de esa
 * sesión se registran; al llegar el snapshot se fusiona conservando mensajes/partes creados
 * durante la carga y aplicando los deltas recibidos sin duplicar lo que el snapshot ya incluye.
 */
import { create } from 'zustand'
import type { Message, Part, Session } from '@opencode-ai/sdk/v2/client'
import type { OcEvent, OpencodeClient } from '../lib/opencode'
import { errorMessage } from '../lib/opencode'

export interface MessageEntry {
  info: Message
  parts: Part[]
}

export type SessionRunState = 'idle' | 'busy' | 'retry'

/** Origen del sidecar principal (Chat/Code). */
export const MAIN_SOURCE = 'main'

interface SessionsState {
  sessions: Record<string, Session>
  /** sessionID → origen (servidor) del que vino. Ausente = MAIN_SOURCE. */
  sessionSource: Record<string, string>
  /** directorio → origen que se muestra para ese directorio. Ausente = MAIN_SOURCE. */
  directorySource: Record<string, string>
  /** Mensajes por sessionID, ordenados por id (ascendente = cronológico). */
  messages: Record<string, MessageEntry[]>
  status: Record<string, SessionRunState>
  errors: Record<string, string | null>
  loadingMessages: Record<string, boolean>

  loadSessions: (client: OpencodeClient, directory: string, source?: string) => Promise<void>
  loadMessages: (client: OpencodeClient, sessionID: string, directory: string) => Promise<void>
  /** Sin `source`: conserva el origen conocido o usa el del directorio de la sesión. */
  upsertSession: (session: Session, source?: string) => void
  removeSession: (sessionID: string) => void
  setStatus: (sessionID: string, status: SessionRunState) => void
  setError: (sessionID: string, error: string | null) => void
  /** Fija (o quita con null) el origen visible de un directorio. */
  setDirectorySource: (directory: string, source: string | null) => void
  applyEvent: (event: OcEvent, source?: string) => void
}

/** Partes que llegan antes que su mensaje (message.updated). */
const orphanParts = new Map<string, Part[]>()

/** Eventos registrados mientras se carga el snapshot de mensajes de una sesión. */
interface LoadTracker {
  /** Mensajes creados/actualizados durante la carga. */
  messages: Set<string>
  /** Partes creadas/actualizadas durante la carga (messageID → partIDs). */
  parts: Map<string, Set<string>>
  /** Deltas recibidos durante la carga: `${partID}\u0000${field}` → trozos en orden. */
  deltas: Map<string, string[]>
}
const loading = new Map<string, LoadTracker>()

const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

function upsertSorted<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id)
  if (idx >= 0) {
    const next = list.slice()
    next[idx] = item
    return next
  }
  const next = [...list, item]
  // Casi siempre llega al final; solo ordenar si hace falta.
  if (next.length > 1 && byId(next[next.length - 2], item) > 0) next.sort(byId)
  return next
}

/**
 * `base` + los trozos de delta recibidos durante la carga, sin repetir los que el snapshot ya
 * incluía: se busca el mayor prefijo de trozos COMPLETOS con el que termina `base`
 * (solo en fronteras de trozo, para no comerse caracteres por coincidencias casuales).
 */
export function appendWithoutOverlap(base: string, chunks: string[]): string {
  let prefix = chunks.join('')
  for (let i = chunks.length; i > 0; i--) {
    if (prefix && base.endsWith(prefix)) return base + chunks.slice(i).join('')
    prefix = prefix.slice(0, prefix.length - chunks[i - 1].length)
  }
  return base + chunks.join('')
}

/** Fusiona el snapshot de `session.messages` con lo recibido por el stream durante la carga. */
function mergeSnapshot(snapshot: MessageEntry[], current: MessageEntry[], t: LoadTracker): MessageEntry[] {
  const currentById = new Map(current.map((m) => [m.info.id, m]))
  const out = new Map<string, MessageEntry>()
  for (const snap of snapshot) {
    const live = currentById.get(snap.info.id)
    let parts = snap.parts
    const touchedParts = t.parts.get(snap.info.id)
    const fromLive = new Set<string>()
    if (live && touchedParts) {
      // Partes creadas/actualizadas durante la carga: la versión del stream es más reciente
      // (y ya lleva sus deltas aplicados).
      for (const p of live.parts) {
        if (!touchedParts.has(p.id)) continue
        parts = upsertSorted(parts, p)
        fromLive.add(p.id)
      }
    }
    // Deltas recibidos durante la carga sobre partes del snapshot.
    parts = parts.map((p) => {
      if (fromLive.has(p.id)) return p
      let next = p
      for (const [key, delta] of t.deltas) {
        const [partID, field] = key.split('\u0000')
        if (partID !== p.id) continue
        const cur = (next as unknown as Record<string, unknown>)[field]
        if (cur !== undefined && typeof cur !== 'string') continue
        next = { ...next, [field]: appendWithoutOverlap(cur ?? '', delta) } as Part
      }
      return next
    })
    const info = live && t.messages.has(snap.info.id) ? live.info : snap.info
    out.set(snap.info.id, { info, parts })
  }
  // Mensajes nuevos que llegaron por el stream durante la carga y no están en el snapshot.
  for (const id of t.messages) {
    if (!out.has(id)) {
      const live = currentById.get(id)
      if (live) out.set(id, live)
    }
  }
  return [...out.values()].sort((a, b) => byId(a.info, b.info))
}

export const useSessions = create<SessionsState>((set, get) => {
  const updateMessages = (sessionID: string, fn: (list: MessageEntry[]) => MessageEntry[]): void => {
    set((s) => ({ messages: { ...s.messages, [sessionID]: fn(s.messages[sessionID] ?? []) } }))
  }

  const updatePart = (sessionID: string, messageID: string, fn: (parts: Part[]) => Part[]): boolean => {
    const list = get().messages[sessionID]
    const idx = list?.findIndex((m) => m.info.id === messageID) ?? -1
    if (!list || idx < 0) return false
    const entry = list[idx]
    const next = list.slice()
    next[idx] = { info: entry.info, parts: fn(entry.parts) }
    set((s) => ({ messages: { ...s.messages, [sessionID]: next } }))
    return true
  }

  const track = (sessionID: string, fn: (t: LoadTracker) => void): void => {
    const t = loading.get(sessionID)
    if (t) fn(t)
  }

  return {
    sessions: {},
    sessionSource: {},
    directorySource: {},
    messages: {},
    status: {},
    errors: {},
    loadingMessages: {},

    loadSessions: async (client, directory, source = MAIN_SOURCE) => {
      const res = await client.session.list({ directory, roots: true, limit: 200 })
      if (res.error || !res.data) throw new Error(errorMessage(res.error))
      const list = res.data
      set((s) => {
        const sessions = { ...s.sessions }
        const sessionSource = { ...s.sessionSource }
        // Reemplaza las sesiones de este directorio Y de este origen por la lista fresca.
        for (const [id, sess] of Object.entries(sessions)) {
          if (sess.directory === directory && (sessionSource[id] ?? MAIN_SOURCE) === source) delete sessions[id]
        }
        for (const sess of list) {
          sessions[sess.id] = sess
          if (source === MAIN_SOURCE) delete sessionSource[sess.id]
          else sessionSource[sess.id] = source
        }
        return { sessions, sessionSource }
      })
    },

    loadMessages: async (client, sessionID, directory) => {
      set((s) => ({ loadingMessages: { ...s.loadingMessages, [sessionID]: true } }))
      const tracker: LoadTracker = { messages: new Set(), parts: new Map(), deltas: new Map() }
      loading.set(sessionID, tracker)
      try {
        const res = await client.session.messages({ sessionID, directory })
        if (res.error || !res.data) throw new Error(errorMessage(res.error))
        const entries = res.data.map((m) => ({ info: m.info, parts: [...m.parts].sort(byId) })).sort((a, b) => byId(a.info, b.info))
        set((s) => ({
          messages: { ...s.messages, [sessionID]: mergeSnapshot(entries, s.messages[sessionID] ?? [], tracker) }
        }))
      } finally {
        if (loading.get(sessionID) === tracker) loading.delete(sessionID)
        set((s) => ({ loadingMessages: { ...s.loadingMessages, [sessionID]: false } }))
      }
    },

    upsertSession: (session, source) =>
      set((s) => {
        const src = source ?? s.sessionSource[session.id] ?? s.directorySource[session.directory] ?? MAIN_SOURCE
        const sessionSource = { ...s.sessionSource }
        if (src === MAIN_SOURCE) delete sessionSource[session.id]
        else sessionSource[session.id] = src
        return { sessions: { ...s.sessions, [session.id]: session }, sessionSource }
      }),

    removeSession: (sessionID) =>
      set((s) => {
        const sessions = { ...s.sessions }
        const messages = { ...s.messages }
        const sessionSource = { ...s.sessionSource }
        delete sessions[sessionID]
        delete messages[sessionID]
        delete sessionSource[sessionID]
        return { sessions, messages, sessionSource }
      }),

    setStatus: (sessionID, status) => set((s) => ({ status: { ...s.status, [sessionID]: status } })),
    setError: (sessionID, error) => set((s) => ({ errors: { ...s.errors, [sessionID]: error } })),

    setDirectorySource: (directory, source) =>
      set((s) => {
        const directorySource = { ...s.directorySource }
        if (source && source !== MAIN_SOURCE) directorySource[directory] = source
        else delete directorySource[directory]
        return { directorySource }
      }),

    applyEvent: (event, source = MAIN_SOURCE) => {
      switch (event.type) {
        case 'session.created':
        case 'session.updated':
          get().upsertSession(event.properties.info, source)
          break
        case 'session.deleted':
          // Solo si la sesión es de este origen (IDs de otro servidor no deben borrarse).
          if ((get().sessionSource[event.properties.info.id] ?? MAIN_SOURCE) === source) {
            get().removeSession(event.properties.info.id)
          }
          break
        case 'session.status': {
          const st = event.properties.status.type
          get().setStatus(event.properties.sessionID, st === 'busy' || st === 'retry' ? st : 'idle')
          break
        }
        case 'session.idle':
          get().setStatus(event.properties.sessionID, 'idle')
          break
        case 'session.error': {
          const { sessionID, error } = event.properties
          if (sessionID && error && error.name !== 'MessageAbortedError') get().setError(sessionID, errorMessage(error))
          break
        }
        case 'message.updated': {
          const info = event.properties.info
          track(info.sessionID, (t) => t.messages.add(info.id))
          updateMessages(info.sessionID, (list) => {
            const existing = list.find((m) => m.info.id === info.id)
            const orphans = orphanParts.get(info.id) ?? []
            orphanParts.delete(info.id)
            let parts = existing?.parts ?? []
            for (const p of orphans) parts = upsertSorted(parts, p)
            const entry: MessageEntry = { info, parts }
            const idx = list.findIndex((m) => m.info.id === info.id)
            if (idx >= 0) return list.map((m, i) => (i === idx ? entry : m))
            return [...list, entry].sort((a, b) => byId(a.info, b.info))
          })
          break
        }
        case 'message.removed':
          updateMessages(event.properties.sessionID, (list) => list.filter((m) => m.info.id !== event.properties.messageID))
          break
        case 'message.part.updated': {
          const part = event.properties.part
          track(part.sessionID, (t) => {
            const set = t.parts.get(part.messageID) ?? new Set<string>()
            set.add(part.id)
            t.parts.set(part.messageID, set)
          })
          const ok = updatePart(part.sessionID, part.messageID, (parts) => upsertSorted(parts, part))
          if (!ok) orphanParts.set(part.messageID, upsertSorted(orphanParts.get(part.messageID) ?? [], part))
          break
        }
        case 'message.part.removed': {
          const { sessionID, messageID, partID } = event.properties
          updatePart(sessionID, messageID, (parts) => parts.filter((p) => p.id !== partID))
          break
        }
        case 'message.part.delta': {
          const { sessionID, messageID, partID, field, delta } = event.properties
          track(sessionID, (t) => {
            const key = `${partID}\u0000${field}`
            const chunks = t.deltas.get(key) ?? []
            chunks.push(delta)
            t.deltas.set(key, chunks)
          })
          updatePart(sessionID, messageID, (parts) =>
            parts.map((p) => {
              if (p.id !== partID) return p
              const current = (p as unknown as Record<string, unknown>)[field]
              if (current !== undefined && typeof current !== 'string') return p
              return { ...p, [field]: (current ?? '') + delta } as Part
            })
          )
          break
        }
        default:
          break
      }
    }
  }
})

/**
 * Sesiones raíz (no hijas, no archivadas) de un directorio, más recientes primero.
 * Solo las del origen visible de ese directorio (ver `directorySource`).
 */
export function selectSessionsForDirectory(sessions: Record<string, Session>, directory: string): Session[] {
  const { sessionSource, directorySource } = useSessions.getState()
  const source = directorySource[directory] ?? MAIN_SOURCE
  return Object.values(sessions)
    .filter(
      (s) =>
        s.directory === directory &&
        !s.parentID &&
        !s.time.archived &&
        (sessionSource[s.id] ?? MAIN_SOURCE) === source
    )
    .sort((a, b) => b.time.updated - a.time.updated)
}
