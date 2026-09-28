/**
 * Estado del modo Code (Zustand).
 *
 * Mantiene su propio reductor de eventos (idempotente por id de evento) para no depender
 * de quién más esté aplicando eventos al store genérico de sesiones.
 */
import { create } from 'zustand'
import type { Part, PermissionRuleset, Session, SessionStatus } from '@opencode-ai/sdk/v2/client'
import type { ModelRef } from '@shared/types'
import { sendNotification } from '../../../lib/notify'
import { getClient, requireClient, sdkData, errorMessage, subscribeEvents, subscribeReconnect, type OcEvent } from './client'
import type {
  Attachment,
  CodeAgent,
  CodeMessage,
  PendingPermission,
  PendingQuestion,
  PermissionMode,
  QueuedMessage,
  RightPanel,
  RunState,
  Todo
} from './types'

const LS_PROJECT = 'code.project'
const LS_AGENT = 'code.agent'
const LS_PANEL = 'code.panel'
const LS_SESSION = 'code.session.'
const LS_PERM_MODE = 'code.permissionMode'
const LS_PINNED = 'code.pinned'
const LS_TRUSTED = 'code.trustedFolders'

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

function lsGetJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function lsSetJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // sin storage
  }
}

/**
 * Traduce un `PermissionMode` a un `PermissionRuleset` para `session.update`. `undefined` deja
 * el ruleset de la sesión sin tocar (se usa para 'plan', que no depende de permisos sino del agente).
 */
function rulesetFor(mode: PermissionMode): PermissionRuleset | undefined {
  switch (mode) {
    case 'manual':
      // Ruleset vacío no equivale a "preguntar por todo": si no hay reglas, el agente cae a su
      // configuración por defecto (que puede permitir). Por eso Manual fija `ask` explícito en
      // los permisos habituales en vez de dejar el array vacío.
      return [
        { permission: 'edit', pattern: '*', action: 'ask' },
        { permission: 'write', pattern: '*', action: 'ask' },
        { permission: 'bash', pattern: '*', action: 'ask' },
        { permission: 'webfetch', pattern: '*', action: 'ask' },
        { permission: 'websearch', pattern: '*', action: 'ask' },
        { permission: 'external_directory', pattern: '*', action: 'ask' }
      ]
    case 'acceptEdits':
      return [
        { permission: 'edit', pattern: '*', action: 'allow' },
        { permission: 'write', pattern: '*', action: 'allow' }
      ]
    case 'auto':
      return [
        { permission: 'edit', pattern: '*', action: 'allow' },
        { permission: 'write', pattern: '*', action: 'allow' },
        { permission: 'read', pattern: '*', action: 'allow' },
        { permission: 'bash', pattern: 'git status*', action: 'allow' },
        { permission: 'bash', pattern: 'git diff*', action: 'allow' },
        { permission: 'bash', pattern: 'git log*', action: 'allow' },
        { permission: 'bash', pattern: 'npm run*', action: 'allow' },
        { permission: 'bash', pattern: 'npm test*', action: 'allow' }
      ]
    case 'bypass':
      return [
        { permission: 'edit', pattern: '*', action: 'allow' },
        { permission: 'write', pattern: '*', action: 'allow' },
        { permission: 'read', pattern: '*', action: 'allow' },
        { permission: 'bash', pattern: '*', action: 'allow' },
        { permission: 'webfetch', pattern: '*', action: 'allow' },
        { permission: 'websearch', pattern: '*', action: 'allow' },
        { permission: 'external_directory', pattern: '*', action: 'allow' }
      ]
    case 'plan':
      return undefined
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
  variant: string | null
  panel: RightPanel | null
  /** Se incrementa cuando cambian archivos (para refrescar Cambios/Archivos). */
  fsVersion: number
  loadingSessions: boolean
  loadingMessages: Record<string, boolean>
  globalError: string | null

  /** Modo de permisos aplicado a la sesión activa (ver `types.ts`). */
  permissionMode: PermissionMode
  /** Mensajes en cola por sesión (se envían cuando la sesión queda libre, o con "Enviar ahora"). */
  queue: Record<string, QueuedMessage[]>
  /** Sesiones con actividad sin ver (terminó de trabajar o pide algo mientras no estaba activa/enfocada). */
  unread: Record<string, boolean>
  /** Sesiones fijadas (por proyecto). */
  pinned: Record<string, string[]>
  /** Carpetas en las que el usuario ya confirmó "confiar" (workspace trust). */
  trustedFolders: string[]

  openProject: (directory: string) => Promise<void>
  closeProject: () => void
  loadSessions: () => Promise<void>
  newSession: () => Promise<string | null>
  /** Crea la sesión en `dir` en vez de `directory` (usado para worktrees nuevos). */
  newSessionAt: (dir: string, title?: string) => Promise<string | null>
  selectSession: (sessionID: string | null) => Promise<void>
  deleteSession: (sessionID: string) => Promise<void>
  /** Envía un prompt. `files` = rutas relativas al proyecto mencionadas con @. */
  send: (text: string, files?: string[], attachments?: Attachment[]) => Promise<void>
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
  setVariant: (variant: string | null) => void
  togglePanel: (panel: RightPanel) => void
  setGlobalError: (error: string | null) => void
  /** Fuerza el refresco de Cambios/Archivos/rama (p. ej. tras un commit). */
  touchFs: () => void
  applyEvent: (event: OcEvent, directory: string) => void
  resync: () => Promise<void>

  // -- Cola de mensajes --
  enqueue: (sessionID: string, text: string, files?: string[], attachments?: Attachment[]) => void
  dequeue: (sessionID: string, id: string) => void
  moveQueued: (sessionID: string, id: string, dir: -1 | 1) => void
  /** Interrumpe la ejecución actual (si la hay) y envía el texto de inmediato, saltando la cola. */
  sendNow: (text: string, files?: string[], attachments?: Attachment[]) => Promise<void>

  // -- Modo de permisos --
  setPermissionMode: (mode: PermissionMode) => Promise<void>

  // -- Sesiones: renombrar / fijar / archivar --
  renameSession: (sessionID: string, title: string) => Promise<void>
  togglePin: (sessionID: string) => void
  isPinned: (sessionID: string) => boolean
  archiveSession: (sessionID: string) => Promise<void>
  unarchiveSession: (sessionID: string) => Promise<void>

  // -- Fork / compactar --
  forkSession: (sessionID: string, messageID?: string) => Promise<string | null>
  compactSession: (sessionID: string) => Promise<void>

  // -- Confianza de carpeta --
  isTrusted: (dir: string) => boolean
  trustFolder: (dir: string) => void

  // -- No leído --
  markRead: (sessionID: string) => void
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
function initialPermissionMode(): PermissionMode {
  const v = lsGet(LS_PERM_MODE)
  return v === 'manual' || v === 'acceptEdits' || v === 'plan' || v === 'auto' || v === 'bypass' ? v : 'manual'
}
/** ¿La ventana tiene el foco Y la pestaña/sesión referida está actualmente visible al usuario? */
function windowIsFocused(): boolean {
  try {
    return document.hasFocus() && document.visibilityState === 'visible'
  } catch {
    return true
  }
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

  /** Envía un prompt a `sid` (no necesariamente la sesión activa: lo usa también el auto-envío de la cola). */
  const doSend = async (
    client: ReturnType<typeof requireClient>,
    dir: string,
    sid: string,
    trimmed: string,
    files: string[],
    attachments: Attachment[],
    agent: CodeAgent,
    model: ModelRef | null,
    variant: string | null
  ): Promise<void> => {
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
    const attachParts = attachments.map((a) => ({
      type: 'file' as const,
      mime: a.mime,
      filename: a.name,
      url: a.url
    }))
    try {
      sdkData(
        await client.session.promptAsync({
          sessionID: sid,
          directory: dir,
          agent,
          model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
          variant: variant ?? undefined,
          parts: [{ type: 'text', text: trimmed }, ...fileParts, ...attachParts]
        })
      )
    } catch (err) {
      setError(sid, errorMessage(err))
      set((s) => ({ runState: { ...s.runState, [sid]: 'idle' } }))
    }
  }

  /** Marca `sessionID` como no leída, salvo que sea la activa y la ventana tenga el foco. */
  const markUnread = (sessionID: string): void => {
    const s = get()
    if (s.activeSessionID === sessionID && windowIsFocused()) return
    if (s.unread[sessionID]) return
    set((st) => ({ unread: { ...st.unread, [sessionID]: true } }))
  }

  /** Notificación nativa para `sessionID` (salvo que sea la activa y la ventana tenga el foco). */
  const notifyCode = (sessionID: string, title: string): void => {
    const s = get()
    if (s.activeSessionID === sessionID && windowIsFocused()) return
    const root = rootSessionID(s.sessions, sessionID)
    const directory = s.sessionProject[root] ?? s.directory ?? undefined
    const body = s.sessions[sessionID]?.title || 'Sesión de Code'
    sendNotification(title, body, { mode: 'code', id: root, directory })
  }

  /** Si hay mensajes en cola para `sessionID`, envía el primero (se llama al quedar libre). */
  const maybeAutoSend = (sessionID: string): void => {
    const s = get()
    const q = s.queue[sessionID]
    if (!q || q.length === 0) return
    const dir = s.sessionProject[sessionID] ?? s.directory
    const client = getClient()
    if (!dir || !client) return
    const [next, ...rest] = q
    set((st) => ({ queue: { ...st.queue, [sessionID]: rest } }))
    void doSend(client, dir, sessionID, next.text, next.files, next.attachments, s.agent, s.model, s.variant)
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
    variant: null,
    panel: initialPanel(),
    fsVersion: 0,
    loadingSessions: false,
    loadingMessages: {},
    globalError: null,
    permissionMode: initialPermissionMode(),
    queue: {},
    unread: {},
    pinned: lsGetJSON<Record<string, string[]>>(LS_PINNED, {}),
    trustedFolders: lsGetJSON<string[]>(LS_TRUSTED, []),

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
      return get().newSessionAt(dir)
    },

    newSessionAt: async (dir, title) => {
      try {
        const client = requireClient()
        const sess = sdkData(await client.session.create({ directory: dir, title }))
        set((s) => ({
          sessions: { ...s.sessions, [sess.id]: sess },
          sessionProject: { ...s.sessionProject, [sess.id]: dir },
          messages: { ...s.messages, [sess.id]: s.messages[sess.id] ?? [] }
        }))
        if (dir === get().directory) await get().selectSession(sess.id)
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
      get().markRead(sessionID)
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

    send: async (text, files = [], attachments = []) => {
      const trimmed = text.trim()
      if (!trimmed) return
      let sid = get().activeSessionID
      if (!sid) sid = await get().newSession()
      if (!sid) return
      const { client, dir } = activeDir()
      const { agent, model, variant } = get()
      await doSend(client, dir, sid, trimmed, files, attachments, agent, model, variant)
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

    setModel: (model) => set({ model, variant: null }),
    setVariant: (variant) => set({ variant }),

    // -- Cola de mensajes --
    enqueue: (sessionID, text, files = [], attachments = []) => {
      const trimmed = text.trim()
      if (!trimmed) return
      const item: QueuedMessage = { id: `q${Date.now()}${Math.random().toString(36).slice(2, 6)}`, text: trimmed, files, attachments }
      set((s) => ({ queue: { ...s.queue, [sessionID]: [...(s.queue[sessionID] ?? []), item] } }))
    },
    dequeue: (sessionID, id) => {
      set((s) => ({ queue: { ...s.queue, [sessionID]: (s.queue[sessionID] ?? []).filter((m) => m.id !== id) } }))
    },
    moveQueued: (sessionID, id, dir) => {
      set((s) => {
        const list = s.queue[sessionID] ?? []
        const idx = list.findIndex((m) => m.id === id)
        const j = idx + dir
        if (idx < 0 || j < 0 || j >= list.length) return s
        const next = list.slice()
        ;[next[idx], next[j]] = [next[j], next[idx]]
        return { queue: { ...s.queue, [sessionID]: next } }
      })
    },
    sendNow: async (text, files = [], attachments = []) => {
      const trimmed = text.trim()
      if (!trimmed) return
      let sid = get().activeSessionID
      if (!sid) sid = await get().newSession()
      if (!sid) return
      const run = get().runState[sid]
      if (run === 'busy' || run === 'retry') {
        try {
          const { client, dir } = activeDir()
          sdkData(await client.session.abort({ sessionID: sid, directory: dir }))
        } catch {
          // si ya había terminado, seguimos igual
        }
      }
      const { client, dir } = activeDir()
      const { agent, model, variant } = get()
      await doSend(client, dir, sid, trimmed, files, attachments, agent, model, variant)
    },

    // -- Modo de permisos --
    setPermissionMode: async (mode) => {
      lsSet(LS_PERM_MODE, mode)
      set({ permissionMode: mode })
      const sid = get().activeSessionID
      if (!sid) return
      if (mode === 'plan') {
        get().setAgent('plan')
        return
      }
      if (get().agent === 'plan') get().setAgent('build')
      const permission = rulesetFor(mode)
      if (!permission) return
      try {
        const { client, dir } = activeDir()
        const updated = sdkData(await client.session.update({ sessionID: sid, directory: dir, permission }))
        set((s) => ({ sessions: { ...s.sessions, [updated.id]: updated } }))
      } catch (err) {
        set({ globalError: errorMessage(err) })
      }
    },

    // -- Sesiones: renombrar / fijar / archivar --
    renameSession: async (sessionID, title) => {
      const trimmed = title.trim()
      if (!trimmed) return
      try {
        const client = requireClient()
        const dir = get().sessionProject[sessionID] ?? get().directory ?? undefined
        const updated = sdkData(await client.session.update({ sessionID, directory: dir, title: trimmed }))
        set((s) => ({ sessions: { ...s.sessions, [updated.id]: updated } }))
      } catch (err) {
        set({ globalError: errorMessage(err) })
      }
    },
    togglePin: (sessionID) => {
      const dir = get().sessionProject[sessionID] ?? get().directory
      if (!dir) return
      set((s) => {
        const list = s.pinned[dir] ?? []
        const next = list.includes(sessionID) ? list.filter((x) => x !== sessionID) : [...list, sessionID]
        const pinned = { ...s.pinned, [dir]: next }
        lsSetJSON(LS_PINNED, pinned)
        return { pinned }
      })
    },
    isPinned: (sessionID) => {
      const s = get()
      const dir = s.sessionProject[sessionID] ?? s.directory
      return !!dir && (s.pinned[dir] ?? []).includes(sessionID)
    },
    archiveSession: async (sessionID) => {
      try {
        const client = requireClient()
        const dir = get().sessionProject[sessionID] ?? get().directory ?? undefined
        const updated = sdkData(await client.session.update({ sessionID, directory: dir, time: { archived: Date.now() } }))
        set((s) => ({
          sessions: { ...s.sessions, [updated.id]: updated },
          activeSessionID: s.activeSessionID === sessionID ? null : s.activeSessionID
        }))
      } catch (err) {
        set({ globalError: errorMessage(err) })
      }
    },
    unarchiveSession: async (sessionID) => {
      try {
        const client = requireClient()
        const dir = get().sessionProject[sessionID] ?? get().directory ?? undefined
        // `archived: 0` es un timestamp falsy: `selectProjectSessions`/la vista de archivadas lo tratan
        // como "no archivada" (mismo criterio `!x.time.archived` que ya usa el resto del código).
        const updated = sdkData(await client.session.update({ sessionID, directory: dir, time: { archived: 0 } }))
        set((s) => ({ sessions: { ...s.sessions, [updated.id]: updated } }))
      } catch (err) {
        set({ globalError: errorMessage(err) })
      }
    },

    // -- Fork / compactar --
    forkSession: async (sessionID, messageID) => {
      try {
        const client = requireClient()
        const dir = get().sessionProject[sessionID] ?? get().directory ?? undefined
        const forked = sdkData(await client.session.fork({ sessionID, directory: dir, messageID }))
        const targetDir = dir ?? get().directory
        if (targetDir) {
          set((s) => ({
            sessions: { ...s.sessions, [forked.id]: forked },
            sessionProject: { ...s.sessionProject, [forked.id]: targetDir }
          }))
          await get().selectSession(forked.id)
        }
        return forked.id
      } catch (err) {
        set({ globalError: errorMessage(err) })
        return null
      }
    },
    compactSession: async (sessionID) => {
      try {
        const { client, dir } = activeDir()
        setError(sessionID, null)
        set((s) => ({ runState: { ...s.runState, [sessionID]: 'busy' } }))
        sdkData(await client.session.summarize({ sessionID, directory: dir }))
      } catch (err) {
        set({ globalError: errorMessage(err) })
        set((s) => ({ runState: { ...s.runState, [sessionID]: 'idle' } }))
      }
    },

    // -- Confianza de carpeta --
    isTrusted: (dir) => get().trustedFolders.includes(dir),
    trustFolder: (dir) => {
      set((s) => {
        if (s.trustedFolders.includes(dir)) return s
        const trustedFolders = [...s.trustedFolders, dir]
        lsSetJSON(LS_TRUSTED, trustedFolders)
        return { trustedFolders }
      })
    },

    // -- No leído --
    markRead: (sessionID) => {
      if (!get().unread[sessionID]) return
      set((s) => {
        const unread = { ...s.unread }
        delete unread[sessionID]
        return { unread }
      })
    },

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
          if (prev !== 'idle' && next === 'idle') {
            set((s) => ({ fsVersion: s.fsVersion + 1 }))
            markUnread(sessionID)
            notifyCode(sessionID, 'Code terminó')
            maybeAutoSend(sessionID)
          }
          break
        }
        case 'session.idle': {
          const { sessionID } = event.properties
          if (!known(sessionID)) return
          const prev = get().runState[sessionID]
          set((s) => ({ runState: { ...s.runState, [sessionID]: 'idle' }, fsVersion: s.fsVersion + 1 }))
          if (prev !== 'idle') {
            markUnread(sessionID)
            notifyCode(sessionID, 'Code terminó')
          }
          maybeAutoSend(sessionID)
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
          markUnread(rootSessionID(get().sessions, p.sessionID))
          notifyCode(p.sessionID, 'Code necesita tu aprobación')
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
          markUnread(rootSessionID(get().sessions, p.sessionID))
          notifyCode(p.sessionID, 'Code necesita tu aprobación')
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
          markUnread(rootSessionID(get().sessions, q.sessionID))
          notifyCode(q.sessionID, 'Code tiene una pregunta para ti')
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

/**
 * Conteo combinado (para el badge del Dock): sesiones raíz con actividad sin ver (terminaron) o
 * que esperan algo del usuario (permiso o pregunta pendiente), sin duplicar la misma raíz.
 */
export function selectCodeAttentionCount(s: Pick<CodeState, 'unread' | 'permissions' | 'questions' | 'sessions'>): number {
  const ids = new Set<string>(Object.keys(s.unread))
  for (const p of Object.values(s.permissions)) ids.add(rootSessionID(s.sessions, p.sessionID))
  for (const q of Object.values(s.questions)) ids.add(rootSessionID(s.sessions, q.sessionID))
  return ids.size
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
