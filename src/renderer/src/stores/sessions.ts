/**
 * Estado de sesiones/mensajes de OpenCode alimentado por eventos SSE.
 * Es genérico (no depende del modo): Chat, Code y Cowork lo reutilizan filtrando por directorio.
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

interface SessionsState {
  sessions: Record<string, Session>
  /** Mensajes por sessionID, ordenados por id (ascendente = cronológico). */
  messages: Record<string, MessageEntry[]>
  status: Record<string, SessionRunState>
  errors: Record<string, string | null>
  loadingMessages: Record<string, boolean>

  loadSessions: (client: OpencodeClient, directory: string) => Promise<void>
  loadMessages: (client: OpencodeClient, sessionID: string, directory: string) => Promise<void>
  upsertSession: (session: Session) => void
  removeSession: (sessionID: string) => void
  setStatus: (sessionID: string, status: SessionRunState) => void
  setError: (sessionID: string, error: string | null) => void
  applyEvent: (event: OcEvent) => void
}

/** Partes que llegan antes que su mensaje (message.updated). */
const orphanParts = new Map<string, Part[]>()

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

  return {
    sessions: {},
    messages: {},
    status: {},
    errors: {},
    loadingMessages: {},

    loadSessions: async (client, directory) => {
      const res = await client.session.list({ directory, roots: true, limit: 200 })
      if (res.error || !res.data) throw new Error(errorMessage(res.error))
      const list = res.data
      set((s) => {
        const sessions = { ...s.sessions }
        // Reemplaza las sesiones de este directorio por la lista fresca.
        for (const [id, sess] of Object.entries(sessions)) if (sess.directory === directory) delete sessions[id]
        for (const sess of list) sessions[sess.id] = sess
        return { sessions }
      })
    },

    loadMessages: async (client, sessionID, directory) => {
      set((s) => ({ loadingMessages: { ...s.loadingMessages, [sessionID]: true } }))
      try {
        const res = await client.session.messages({ sessionID, directory })
        if (res.error || !res.data) throw new Error(errorMessage(res.error))
        const entries = res.data.map((m) => ({ info: m.info, parts: [...m.parts].sort(byId) })).sort((a, b) => byId(a.info, b.info))
        set((s) => ({ messages: { ...s.messages, [sessionID]: entries } }))
      } finally {
        set((s) => ({ loadingMessages: { ...s.loadingMessages, [sessionID]: false } }))
      }
    },

    upsertSession: (session) => set((s) => ({ sessions: { ...s.sessions, [session.id]: session } })),

    removeSession: (sessionID) =>
      set((s) => {
        const sessions = { ...s.sessions }
        const messages = { ...s.messages }
        delete sessions[sessionID]
        delete messages[sessionID]
        return { sessions, messages }
      }),

    setStatus: (sessionID, status) => set((s) => ({ status: { ...s.status, [sessionID]: status } })),
    setError: (sessionID, error) => set((s) => ({ errors: { ...s.errors, [sessionID]: error } })),

    applyEvent: (event) => {
      switch (event.type) {
        case 'session.created':
        case 'session.updated':
          get().upsertSession(event.properties.info)
          break
        case 'session.deleted':
          get().removeSession(event.properties.info.id)
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

/** Sesiones raíz (no hijas, no archivadas) de un directorio, más recientes primero. */
export function selectSessionsForDirectory(sessions: Record<string, Session>, directory: string): Session[] {
  return Object.values(sessions)
    .filter((s) => s.directory === directory && !s.parentID && !s.time.archived)
    .sort((a, b) => b.time.updated - a.time.updated)
}
