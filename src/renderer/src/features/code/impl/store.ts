/**
 * Estado del modo Code (Zustand).
 *
 * Mantiene su propio reductor de eventos (idempotente por id de evento) para no depender
 * de quién más esté aplicando eventos al store genérico de sesiones.
 */
import { create } from 'zustand'
import type { Part, Session, SessionStatus } from '@opencode-ai/sdk/v2/client'
import type { ModelRef } from '@shared/types'
import { getClient, requireClient, sdkData, errorMessage, subscribeEvents, subscribeReconnect, type OcEvent } from './client'
import type {
  CodeAgent,
  CodeMessage,
  PendingPermission,
  PendingQuestion,
  RightPanel,
  RunState,
  Todo
} from './types'

const LS_PROJECT = 'code.project'
const LS_AGENT = 'code.agent'
const LS_PANEL = 'code.panel'
const LS_SESSION = 'code.session.'

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function lsSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // sin storage
  }
}

const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

function upsertSorted<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id)
  if (idx >= 0) {
    const next = list.slice()
    next[idx] = item
    return next
  }
  const next = [...list, item]
  if (next.length > 1 && byId(next[next.length - 2], item) > 0) next.sort(byId)
  return next
}

function toRunState(s: SessionStatus): RunState {
  return s.type === 'busy' || s.type === 'retry' ? s.type : 'idle'
}

export interface CodeState {
  /** Carpeta del proyecto abierto. */
  directory: string | null
  sessions: Record<string, Session>
  /** Proyecto al que pertenece cada sesión conocida. */
  sessionProject: Record<string, string>
  activeSessionID: string | null
  messages: Record<string, CodeMessage[]>
  runState: Record<string, RunState>
  errors: Record<string, string | null>
  permissions: Record<string, PendingPermission>
  questions: Record<string, PendingQuestion>
  todos: Record<string, Todo[]>
  agent: CodeAgent
  model: ModelRef | null
  panel: RightPanel | null
  /** Se incrementa cuando cambian archivos (para refrescar Cambios/Archivos). */
  fsVersion: number
  loadingSessions: boolean
  loadingMessages: Record<string, boolean>
  globalError: string | null

  openProject: (directory: string) => Promise<void>
  closeProject: () => void
  loadSessions: () => Promise<void>
  newSession: () => Promise<string | null>
  selectSession: (sessionID: string | null) => Promise<void>
  deleteSession: (sessionID: string) => Promise<void>
  /** Envía un prompt. `files` = rutas relativas al proyecto mencionadas con @. */
  send: (text: string, files?: string[]) => Promise<void>
  /** Ejecuta un comando del servidor (`/nombre args`). */
  runCommand: (name: string, args: string) => Promise<void>
  abort: () => Promise<void>
  revertLast: () => Promise<void>
  /** Revierte la sesión hasta (e incluyendo) el mensaje de usuario indicado. */
  revertTo: (messageID: string) => Promise<void>
  unrevert: () => Promise<void>
  replyPermission: (p: PendingPermission, reply: 'once' | 'always' | 'reject') => Promise<void>
  replyQuestion: (q: PendingQuestion, answers: string[][]) => Promise<void>
  rejectQuestion: (q: PendingQuestion) => Promise<void>
  setAgent: (agent: CodeAgent) => void
  setModel: (model: ModelRef) => void
  togglePanel: (panel: RightPanel) => void
  setGlobalError: (error: string | null) => void
  /** Fuerza el refresco de Cambios/Archivos/rama (p. ej. tras un commit). */
  touchFs: () => void
  applyEvent: (event: OcEvent, directory: string) => void
  resync: () => Promise<void>
}

const orphanParts = new Map<string, Part[]>()
const seenEvents = new Set<string>()
const seenOrder: string[] = []

function markSeen(id: string): boolean {
  if (seenEvents.has(id)) return false
  seenEvents.add(id)
  seenOrder.push(id)
  if (seenOrder.length > 2000) {
    const old = seenOrder.splice(0, 500)
    for (const o of old) seenEvents.delete(o)
  }
  return true
}

function initialAgent(): CodeAgent {
  return lsGet(LS_AGENT) === 'plan' ? 'plan' : 'build'
}
function initialPanel(): RightPanel | null {
  const p = lsGet(LS_PANEL)
  return p === 'changes' || p === 'terminal' || p === 'files' ? p : null
}

export const useCode = create<CodeState>((set, get) => {
  const updateMessages = (sessionID: string, fn: (list: CodeMessage[]) => CodeMessage[]): void => {
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

  /** Proyecto al que pertenece una sesión reportada por el servidor (o null). */
  const projectFor = (info: Session): string | null => {
    const s = get()
    const known = s.sessionProject[info.id]
    if (known) return known
    if (info.parentID && s.sessionProject[info.parentID]) return s.sessionProject[info.parentID]
    for (const [sid, proj] of Object.entries(s.sessionProject)) {
      if (proj === info.directory || s.sessions[sid]?.directory === info.directory) return proj
    }
    if (s.directory && info.directory === s.directory) return s.directory
    return null
  }

  const known = (sessionID: string): boolean => sessionID in get().sessionProject

  /**
   * Para permisos/preguntas: acepta sesiones desconocidas (p. ej. subagentes creados antes de
   * cargar la lista) si el evento viene del directorio del proyecto abierto.
   */
  const adopt = (sessionID: string, eventDir: string): boolean => {
    if (known(sessionID)) return true
    const dir = get().directory
    if (!dir || eventDir !== dir) return false
    set((s) => ({ sessionProject: { ...s.sessionProject, [sessionID]: dir } }))
    return true
  }

  const setError = (sessionID: string, error: string | null): void =>
    set((s) => ({ errors: { ...s.errors, [sessionID]: error } }))

  const loadMessages = async (sessionID: string): Promise<void> => {
    const client = getClient()
    const dir = get().sessionProject[sessionID] ?? get().directory
    if (!client || !dir) return
    set((s) => ({ loadingMessages: { ...s.loadingMessages, [sessionID]: true } }))
    try {
      const data = sdkData(await client.session.messages({ sessionID, directory: dir }))
      const entries = data
        .map((m) => ({ info: m.info, parts: [...m.parts].sort(byId) }))
        .sort((a, b) => byId(a.info, b.info))
      set((s) => ({ messages: { ...s.messages, [sessionID]: entries } }))
      const todo = await client.session.todo({ sessionID, directory: dir }).catch(() => null)
      if (todo?.data) {
        const todos = todo.data
        set((s) => ({ todos: { ...s.todos, [sessionID]: todos } }))
      }
    } catch (err) {
      setError(sessionID, errorMessage(err))
    } finally {
      set((s) => ({ loadingMessages: { ...s.loadingMessages, [sessionID]: false } }))
    }
  }

  /** Permisos y preguntas pendientes + estado de ejecución del proyecto actual. */
  const loadPending = async (): Promise<void> => {
    const client = getClient()
    const dir = get().directory
    if (!client || !dir) return
    const [perms, questions, status] = await Promise.all([
      client.permission.list({ directory: dir }).catch(() => null),
      client.question.list({ directory: dir }).catch(() => null),
      client.session.status({ directory: dir }).catch(() => null)
    ])
    if (perms?.data) {
      const list = perms.data
      set((s) => {
        const permissions = { ...s.permissions }
        for (const p of list) {
          if (!known(p.sessionID)) continue
          permissions[p.id] = { ...p, metadata: p.metadata ?? {}, api: 'v1' }
        }
        return { permissions }
      })
    }
    if (questions?.data) {
      const list = questions.data
      set((s) => {
        const qs = { ...s.questions }
        for (const q of list) if (known(q.sessionID)) qs[q.id] = { id: q.id, sessionID: q.sessionID, questions: q.questions }
        return { questions: qs }
      })
    }
    if (status?.data) {
      const map = status.data
      set((s) => {
        const runState = { ...s.runState }
        for (const [sid, st] of Object.entries(map)) runState[sid] = toRunState(st)
        return { runState }
      })
    }
  }

  const activeDir = (): { client: ReturnType<typeof requireClient>; dir: string; sid: string } => {
    const client = requireClient()
    const { directory, activeSessionID } = get()
    if (!directory) throw new Error('No hay proyecto abierto')
    if (!activeSessionID) throw new Error('No hay sesión seleccionada')
    return { client, dir: get().sessionProject[activeSessionID] ?? directory, sid: activeSessionID }
  }

  return {
    directory: lsGet(LS_PROJECT),
    sessions: {},
    sessionProject: {},
    activeSessionID: null,
    messages: {},
    runState: {},
    errors: {},
    permissions: {},
    questions: {},
    todos: {},
    agent: initialAgent(),
    model: null,
    panel: initialPanel(),
    fsVersion: 0,
    loadingSessions: false,
    loadingMessages: {},
    globalError: null,

    openProject: async (directory) => {
      lsSet(LS_PROJECT, directory)
      set({ directory, activeSessionID: null, globalError: null })
      void window.api.invoke('settings:addRecentFolder', { path: directory }).catch(() => undefined)
      await get().loadSessions()
      const last = lsGet(LS_SESSION + directory)
      const sessions = selectProjectSessions(get(), directory)
      const pick = sessions.find((x) => x.id === last) ?? sessions[0]
      if (pick) await get().selectSession(pick.id)
    },

    closeProject: () => {
      lsSet(LS_PROJECT, null)
      set({ directory: null, activeSessionID: null })
    },

    loadSessions: async () => {
      const client = getClient()
      const dir = get().directory
      if (!client || !dir) return
      set({ loadingSessions: true })
      try {
        const list = sdkData(await client.session.list({ directory: dir, roots: true, limit: 200 }))
        set((s) => {
          const sessions = { ...s.sessions }
          const sessionProject = { ...s.sessionProject }
          for (const [sid, proj] of Object.entries(sessionProject)) {
            if (proj === dir && !list.some((x) => x.id === sid)) {
              delete sessionProject[sid]
              delete sessions[sid]
            }
          }
          for (const sess of list) {
            sessions[sess.id] = sess
            sessionProject[sess.id] = dir
          }
          return { sessions, sessionProject }
        })
        await loadPending()
      } catch (err) {
        set({ globalError: errorMessage(err) })
      } finally {
        set({ loadingSessions: false })
      }
    },

    newSession: async () => {
      const dir = get().directory
      if (!dir) return null
      try {
        const client = requireClient()
        const sess = sdkData(await client.session.create({ directory: dir }))
        set((s) => ({
          sessions: { ...s.sessions, [sess.id]: sess },
          sessionProject: { ...s.sessionProject, [sess.id]: dir },
          messages: { ...s.messages, [sess.id]: s.messages[sess.id] ?? [] }
        }))
        await get().selectSession(sess.id)
        return sess.id
      } catch (err) {
        set({ globalError: errorMessage(err) })
        return null
      }
    },

    selectSession: async (sessionID) => {
      set({ activeSessionID: sessionID })
      const dir = get().directory
      if (dir) lsSet(LS_SESSION + dir, sessionID)
      if (!sessionID) return
      await loadMessages(sessionID)
    },

    deleteSession: async (sessionID) => {
      const dir = get().sessionProject[sessionID] ?? get().directory
      try {
        const client = requireClient()
        sdkData(await client.session.delete({ sessionID, directory: dir ?? undefined }))
      } catch (err) {
        set({ globalError: errorMessage(err) })
        return
      }
      set((s) => {
        const sessions = { ...s.sessions }
        const sessionProject = { ...s.sessionProject }
        delete sessions[sessionID]
        delete sessionProject[sessionID]
        return {
          sessions,
          sessionProject,
          activeSessionID: s.activeSessionID === sessionID ? null : s.activeSessionID
        }
      })
    },

    send: async (text, files = []) => {
      const trimmed = text.trim()
      if (!trimmed) return
      let sid = get().activeSessionID
      if (!sid) sid = await get().newSession()
      if (!sid) return
      const { client, dir } = activeDir()
      const { agent, model } = get()
      setError(sid, null)
      set((s) => ({ runState: { ...s.runState, [sid]: 'busy' } }))
      const base = dir.replace(/[/\\]+$/, '')
      const fileParts = [...new Set(files)].flatMap((rel) => {
        const token = `@${rel}`
        const start = trimmed.indexOf(token)
        if (start < 0) return []
        const abs = `${base}/${rel}`
        return [
          {
            type: 'file' as const,
            mime: 'text/plain',
            filename: rel.split('/').pop() ?? rel,
            url: `file://${abs}`,
            source: { type: 'file' as const, path: abs, text: { value: token, start, end: start + token.length } }
          }
        ]
      })
      try {
        sdkData(
          await client.session.promptAsync({
            sessionID: sid,
            directory: dir,
            agent,
            model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
            parts: [{ type: 'text', text: trimmed }, ...fileParts]
          })
        )
      } catch (err) {
        setError(sid, errorMessage(err))
        set((s) => ({ runState: { ...s.runState, [sid]: 'idle' } }))
      }
    },

    runCommand: async (name, args) => {
      let sid = get().activeSessionID
      if (!sid) sid = await get().newSession()
      if (!sid) return
      const { client, dir } = activeDir()
      const { agent, model } = get()
      setError(sid, null)
      set((s) => ({ runState: { ...s.runState, [sid]: 'busy' } }))
      try {
        sdkData(
          await client.session.command({
            sessionID: sid,
            directory: dir,
            command: name,
            arguments: args,
            agent,
            model: model ? `${model.providerID}/${model.modelID}` : undefined
          })
        )
      } catch (err) {
        setError(sid, errorMessage(err))
        set((s) => ({ runState: { ...s.runState, [sid]: 'idle' } }))
      }
    },

    abort: async () => {
      try {
        const { client, dir, sid } = activeDir()
        sdkData(await client.session.abort({ sessionID: sid, directory: dir }))
      } catch (err) {
        set({ globalError: errorMessage(err) })
      }
    },

    revertLast: async () => {
      try {
        const { client, dir, sid } = activeDir()
        const sess = get().sessions[sid]
        const boundary = sess?.revert?.messageID
        const users = (get().messages[sid] ?? []).filter(
          (m) => m.info.role === 'user' && (!boundary || m.info.id < boundary)
        )
        const target = users[users.length - 1]
        if (!target) throw new Error('No hay cambios que revertir')
        const updated = sdkData(await client.session.revert({ sessionID: sid, directory: dir, messageID: target.info.id }))
        set((s) => ({ sessions: { ...s.sessions, [updated.id]: updated }, fsVersion: s.fsVersion + 1 }))
      } catch (err) {
        set({ globalError: errorMessage(err) })
      }
    },

    revertTo: async (messageID) => {
      try {
        const { client, dir, sid } = activeDir()
        const updated = sdkData(await client.session.revert({ sessionID: sid, directory: dir, messageID }))
        set((s) => ({ sessions: { ...s.sessions, [updated.id]: updated }, fsVersion: s.fsVersion + 1 }))
      } catch (err) {
        set({ globalError: errorMessage(err) })
      }
    },

    unrevert: async () => {
      try {
        const { client, dir, sid } = activeDir()
        const updated = sdkData(await client.session.unrevert({ sessionID: sid, directory: dir }))
        set((s) => ({ sessions: { ...s.sessions, [updated.id]: updated }, fsVersion: s.fsVersion + 1 }))
      } catch (err) {
        set({ globalError: errorMessage(err) })
      }
    },

    replyPermission: async (p, reply) => {
      try {
        const client = requireClient()
        const dir = get().sessionProject[p.sessionID] ?? get().directory ?? undefined
        if (p.api === 'v2') {
          sdkData(await client.v2.session.permission.reply({ sessionID: p.sessionID, requestID: p.id, reply }))
        } else {
          sdkData(await client.permission.reply({ requestID: p.id, reply, directory: dir }))
        }
        set((s) => {
          const permissions = { ...s.permissions }
          delete permissions[p.id]
          return { permissions }
        })
      } catch (err) {
        set({ globalError: errorMessage(err) })
      }
    },

    replyQuestion: async (q, answers) => {
      try {
        const client = requireClient()
        const dir = get().sessionProject[q.sessionID] ?? get().directory ?? undefined
        sdkData(await client.question.reply({ requestID: q.id, answers, directory: dir }))
        set((s) => {
          const questions = { ...s.questions }
          delete questions[q.id]
          return { questions }
        })
      } catch (err) {
        set({ globalError: errorMessage(err) })
      }
    },

    rejectQuestion: async (q) => {
      try {
        const client = requireClient()
        const dir = get().sessionProject[q.sessionID] ?? get().directory ?? undefined
        sdkData(await client.question.reject({ requestID: q.id, directory: dir }))
        set((s) => {
          const questions = { ...s.questions }
          delete questions[q.id]
          return { questions }
        })
      } catch (err) {
        set({ globalError: errorMessage(err) })
      }
    },

    setAgent: (agent) => {
      lsSet(LS_AGENT, agent)
      set({ agent })
    },

    setModel: (model) => set({ model }),

    togglePanel: (panel) => {
      const next = get().panel === panel ? null : panel
      lsSet(LS_PANEL, next)
      set({ panel: next })
    },

    setGlobalError: (globalError) => set({ globalError }),

    touchFs: () => set((s) => ({ fsVersion: s.fsVersion + 1 })),

    resync: async () => {
      if (!get().directory) return
      await get().loadSessions()
      const sid = get().activeSessionID
      if (sid) await loadMessages(sid)
    },

    applyEvent: (event, eventDir) => {
      if (event.id && !markSeen(event.id)) return
      switch (event.type) {
        case 'session.created':
        case 'session.updated': {
          const info = event.properties.info
          const proj = projectFor(info)
          if (!proj) return
          set((s) => ({
            sessions: { ...s.sessions, [info.id]: info },
            sessionProject: { ...s.sessionProject, [info.id]: proj }
          }))
          break
        }
        case 'session.deleted': {
          const id = event.properties.info.id
          if (!known(id)) return
          set((s) => {
            const sessions = { ...s.sessions }
            const sessionProject = { ...s.sessionProject }
            delete sessions[id]
            delete sessionProject[id]
            return { sessions, sessionProject, activeSessionID: s.activeSessionID === id ? null : s.activeSessionID }
          })
          break
        }
        case 'session.status': {
          const { sessionID, status } = event.properties
          if (!known(sessionID)) return
          const next = toRunState(status)
          const prev = get().runState[sessionID]
          set((s) => ({ runState: { ...s.runState, [sessionID]: next } }))
          if (prev !== 'idle' && next === 'idle') set((s) => ({ fsVersion: s.fsVersion + 1 }))
          break
        }
        case 'session.idle': {
          const { sessionID } = event.properties
          if (!known(sessionID)) return
          set((s) => ({ runState: { ...s.runState, [sessionID]: 'idle' }, fsVersion: s.fsVersion + 1 }))
          break
        }
        case 'session.error': {
          const { sessionID, error } = event.properties
          if (sessionID && known(sessionID) && error && error.name !== 'MessageAbortedError') {
            setError(sessionID, errorMessage(error))
          }
          break
        }
        case 'session.diff':
        case 'file.edited':
        case 'file.watcher.updated':
          set((s) => ({ fsVersion: s.fsVersion + 1 }))
          break
        case 'message.updated': {
          const info = event.properties.info
          if (!known(info.sessionID)) return
          updateMessages(info.sessionID, (list) => {
            const existing = list.find((m) => m.info.id === info.id)
            const orphans = orphanParts.get(info.id) ?? []
            orphanParts.delete(info.id)
            let parts = existing?.parts ?? []
            for (const p of orphans) parts = upsertSorted(parts, p)
            const entry: CodeMessage = { info, parts }
            const idx = list.findIndex((m) => m.info.id === info.id)
            if (idx >= 0) return list.map((m, i) => (i === idx ? entry : m))
            return [...list, entry].sort((a, b) => byId(a.info, b.info))
          })
          break
        }
        case 'message.removed': {
          const { sessionID, messageID } = event.properties
          if (!known(sessionID)) return
          updateMessages(sessionID, (list) => list.filter((m) => m.info.id !== messageID))
          break
        }
        case 'message.part.updated': {
          const part = event.properties.part
          if (!known(part.sessionID)) return
          const ok = updatePart(part.sessionID, part.messageID, (parts) => upsertSorted(parts, part))
          if (!ok) orphanParts.set(part.messageID, upsertSorted(orphanParts.get(part.messageID) ?? [], part))
          break
        }
        case 'message.part.removed': {
          const { sessionID, messageID, partID } = event.properties
          if (!known(sessionID)) return
          updatePart(sessionID, messageID, (parts) => parts.filter((p) => p.id !== partID))
          break
        }
        case 'message.part.delta': {
          const { sessionID, messageID, partID, field, delta } = event.properties
          if (!known(sessionID)) return
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
        case 'todo.updated': {
          const { sessionID, todos } = event.properties
          if (!known(sessionID)) return
          set((s) => ({ todos: { ...s.todos, [sessionID]: todos } }))
          break
        }
        case 'permission.asked': {
          const p = event.properties
          if (!adopt(p.sessionID, eventDir)) return
          set((s) => ({
            permissions: {
              ...s.permissions,
              [p.id]: {
                id: p.id,
                sessionID: p.sessionID,
                permission: p.permission,
                patterns: p.patterns,
                metadata: p.metadata ?? {},
                always: p.always,
                tool: p.tool,
                api: 'v1'
              }
            }
          }))
          break
        }
        case 'permission.v2.asked': {
          const p = event.properties
          if (!adopt(p.sessionID, eventDir)) return
          set((s) => ({
            permissions: {
              ...s.permissions,
              [p.id]: {
                id: p.id,
                sessionID: p.sessionID,
                permission: p.action,
                patterns: p.resources,
                metadata: p.metadata ?? {},
                always: p.save ?? [],
                tool: p.source ? { messageID: p.source.messageID, callID: p.source.callID } : undefined,
                api: 'v2'
              }
            }
          }))
          break
        }
        case 'permission.replied':
        case 'permission.v2.replied': {
          const { requestID } = event.properties
          if (!(requestID in get().permissions)) return
          set((s) => {
            const permissions = { ...s.permissions }
            delete permissions[requestID]
            return { permissions }
          })
          break
        }
        case 'question.asked': {
          const q = event.properties
          if (!adopt(q.sessionID, eventDir)) return
          set((s) => ({ questions: { ...s.questions, [q.id]: { id: q.id, sessionID: q.sessionID, questions: q.questions } } }))
          break
        }
        case 'question.replied':
        case 'question.rejected': {
          const { requestID } = event.properties
          if (!(requestID in get().questions)) return
          set((s) => {
            const questions = { ...s.questions }
            delete questions[requestID]
            return { questions }
          })
          break
        }
        default:
          break
      }
    }
  }
})

/** Sesión raíz (sube por `parentID`) de una sesión; útil para agrupar permisos de subagentes. */
export function rootSessionID(sessions: Record<string, Session>, sessionID: string): string {
  let id = sessionID
  for (let i = 0; i < 20; i++) {
    const parent = sessions[id]?.parentID
    if (!parent) return id
    id = parent
  }
  return id
}

/** Sesiones raíz (no archivadas) del proyecto, más recientes primero. */
export function selectProjectSessions(s: Pick<CodeState, 'sessions' | 'sessionProject'>, directory: string): Session[] {
  return Object.values(s.sessions)
    .filter((x) => s.sessionProject[x.id] === directory && !x.parentID && !x.time.archived)
    .sort((a, b) => b.time.updated - a.time.updated)
}

let subscribers = 0
let unsubscribe: (() => void) | null = null

/**
 * Conecta el store al stream global de eventos (con conteo de referencias: se puede llamar
 * desde varios componentes). Devuelve la función para soltar la referencia.
 */
export function ensureCodeSubscription(): () => void {
  subscribers++
  if (!unsubscribe) {
    const offEvents = subscribeEvents((event, directory) => useCode.getState().applyEvent(event, directory))
    const offReconnect = subscribeReconnect(() => void useCode.getState().resync())
    unsubscribe = () => {
      offEvents()
      offReconnect()
    }
  }
  let released = false
  return () => {
    if (released) return
    released = true
    subscribers--
    if (subscribers === 0 && unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
  }
}
