/**
 * Estado del modo Code (Zustand).
 *
 * Mantiene su propio reductor de eventos (idempotente por id de evento) para no depender
 * de quién más esté aplicando eventos al store genérico de sesiones.
 */
import { create } from 'zustand'
import type { FilePart, PermissionRuleset, Session, SessionStatus, TextPart } from '@opencode-ai/sdk/v2/client'
import { NO_AI_ERROR } from '@shared/ai-errors'
import { t } from '@shared/i18n'
import type { ModelRef } from '@shared/types'
import { currentAiGate } from '../../../lib/ai-gate'
import { resolveModelForMode, setModeModel, useExtrasPrefs } from '../../settings/impl/extras'
import { sendNotification } from '../../../lib/notify'
import { debounce } from '../../../lib/debounce'
import { lruMax } from '../../../lib/lru'
import { createFrameQueue } from '../../../lib/frame-queue'
import {
  byId,
  createBuffers,
  createLoadTracker,
  evictMessages,
  forgetOrphansOf,
  markSeen,
  isChildOfAny,
  mergeSnapshot,
  pickEvictions,
  pinClosure,
  messageEventSessionID,
  reconcilePending,
  reconcileRunStatus,
  reduceEvent,
  unchangedSince,
  type ConvError,
  type ConvSlice,
  type LoadTracker
} from '../../../lib/session-reducer'
import { nextSessionsLimit, SESSIONS_PAGE, sessionsMayHaveMore } from '../../../lib/session-paging'
import { mentionMime } from './mention-mime'
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
  errors: Record<string, ConvError | null>
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
  /** «Cargar más» (o todas con `all`) en la lista de sesiones del proyecto. */
  loadMoreSessions: (all?: boolean) => Promise<void>
  /** Puede haber más sesiones en el servidor que las cargadas. */
  moreSessions: boolean
  newSession: () => Promise<string | null>
  /** Crea la sesión en `dir` en vez de `directory` (usado para worktrees nuevos). */
  newSessionAt: (dir: string, title?: string) => Promise<string | null>
  selectSession: (sessionID: string | null) => Promise<void>
  deleteSession: (sessionID: string) => Promise<void>
  /** Envía un prompt. `files` = rutas relativas al proyecto mencionadas con @. */
  /** Devuelve `true` si el motor aceptó el mensaje (el compositor restaura el borrador si no). */
  send: (text: string, files?: string[], attachments?: Attachment[]) => Promise<boolean>
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
  /** `remember` (por defecto sí): lo guarda como el modelo del modo Code (`modelsByMode.code`); nunca toca el predeterminado global. */
  setModel: (model: ModelRef, remember?: boolean) => void
  setVariant: (variant: string | null) => void
  togglePanel: (panel: RightPanel) => void
  /** Abre el panel del navegador (sin alternar/cerrar si ya estaba abierto) y sin robar el foco. */
  revealBrowserPanel: () => void
  setGlobalError: (error: string | null) => void
  /** Fuerza el refresco de Cambios/Archivos/rama (p. ej. tras un commit). */
  touchFs: () => void
  applyEvent: (event: OcEvent, directory: string) => void
  resync: () => Promise<void>

  // -- Cola de mensajes --
  /** Devuelve `false` si no había nada que encolar (sin texto ni adjuntos). */
  enqueue: (sessionID: string, text: string, files?: string[], attachments?: Attachment[]) => boolean
  dequeue: (sessionID: string, id: string) => void
  moveQueued: (sessionID: string, id: string, dir: -1 | 1) => void
  /** Interrumpe la ejecución actual (si la hay) y envía el texto de inmediato, saltando la cola. */
  sendNow: (text: string, files?: string[], attachments?: Attachment[]) => Promise<boolean>

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
  /**
   * «Editar y reintentar»: detiene si hace falta, revierte desde ese mensaje (archivos incluidos, como «Revertir»)
   * y reenvía el texto editado con los mismos adjuntos. `false` = no se envió (la sesión queda como estaba).
   */
  editAndRetry: (messageID: string, text: string) => Promise<boolean>
  /** «Reintentar» tras un error: igual que `editAndRetry` con el texto original del último mensaje del usuario. */
  retryLast: () => Promise<boolean>

  // -- Confianza de carpeta --
  isTrusted: (dir: string) => boolean
  trustFolder: (dir: string) => void

  // -- No leído --
  markRead: (sessionID: string) => void

  // -- LRU de `messages` (docs/LRU-PLAN.md) --
  /** Marca la sesión como usada ahora. NO hace `set` (Map de módulo); solo desaloja si hay exceso. Un evento NO cuenta. */
  touchSession: (sessionID: string) => void
  /** Desaloja `messages`/`loadingMessages` de las sesiones no fijadas que sobran del tope (un solo `set`). */
  evictIdle: () => void
}

/** Tope de sesiones con contenido no fijadas en `useCode` (`localStorage['onyx.lru.max']` lo sobrescribe). */
/** Límite de la lista de sesiones por proyecto (sube con «Cargar más»). */
const codeSessionLimits = new Map<string, number>()

export const CODE_LRU_MAX = 20
/** Ventana para reconocer `session.status→idle` y `session.idle` de una misma terminación (F7-B18). */
const IDLE_DUP_WINDOW_MS = 2000
/** Último acceso por sesión (contador monótono; sin registro = nunca abierta). Estado de módulo, sin `set`. */
const lastAccess = new Map<string, number>()
let accessTick = 0
let evictScheduled = false
/** Vacía ya la cola de deltas del store (se asigna al crearlo; uso interno y de tests). */
let flushDeltas: () => void = () => undefined
export function flushPendingDeltas(): void {
  flushDeltas()
}

/** Buffers de este store (partes huérfanas, ids de evento vistos). Instancia propia, no compartida con useSessions. */
const buffers = createBuffers({ seenMax: 2000 })

function initialAgent(): CodeAgent {
  return lsGet(LS_AGENT) === 'plan' ? 'plan' : 'build'
}
function initialPanel(): RightPanel | null {
  const p = lsGet(LS_PANEL)
  return p === 'changes' || p === 'terminal' || p === 'files' || p === 'browser' ? p : null
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

/** Debounce de `fsVersion` para eventos externos (Pf1): 400 ms tras el último, como mucho 2 s de espera. */
export const FS_BUMP_WAIT_MS = 400
export const FS_BUMP_MAX_WAIT_MS = 2000
const bumpFsDebounced = debounce(() => useCode.setState((s) => ({ fsVersion: s.fsVersion + 1 })), {
  wait: FS_BUMP_WAIT_MS,
  maxWait: FS_BUMP_MAX_WAIT_MS
})

const trimSlash = (p: string): string => (p.length > 1 ? p.replace(/[\\/]+$/, '') : p)

export const useCode = create<CodeState>((set, get) => {
  /** Desalojo agrupado: varios eventos en el mismo tick producen un único `evictIdle`. */
  const scheduleEvict = (): void => {
    if (evictScheduled) return
    evictScheduled = true
    queueMicrotask(() => {
      evictScheduled = false
      get().evictIdle()
    })
  }

  /** ¿El directorio del evento es el del proyecto o el de una sesión del proyecto (worktrees)? */
  const isProjectDir = (eventDir: string): boolean => {
    const s = get()
    if (!s.directory || !eventDir) return false
    const ev = trimSlash(eventDir)
    if (ev === trimSlash(s.directory)) return true
    for (const [sid, proj] of Object.entries(s.sessionProject)) {
      if (proj !== s.directory) continue
      const d = s.sessions[sid]?.directory
      if (d && trimSlash(d) === ev) return true
    }
    return false
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
   * Deltas de texto pendientes (F7-B43): se encolan en `applyEvent` y se aplican en lote una vez por frame con un
   * solo `set`. Cualquier otro evento, `loadMessages`, `deleteSession` y el desalojo vacían la cola ANTES de actuar
   * (mismo orden relativo que aplicando uno a uno). El dedupe por `event.id` y la guarda `known` se aplican al encolar.
   */
  const deltaQueue = createFrameQueue<OcEvent>((events) => {
    const cur = get()
    let slice: ConvSlice = { messages: cur.messages, status: cur.runState, errors: cur.errors, sessions: cur.sessions }
    for (const ev of events) slice = reduceEvent(slice, ev, buffers, { accept: known, dedupe: false }).slice
    if (slice.messages === cur.messages) return
    set({ messages: slice.messages })
    // Un delta no crea claves en `messages`, pero se mantiene la misma comprobación que el resto de eventos.
    for (const ev of events) {
      const sid = messageEventSessionID(ev)
      if (sid && !(sid in cur.messages)) {
        scheduleEvict()
        break
      }
    }
  })
  flushDeltas = deltaQueue.flush

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

  const setError = (sessionID: string, error: ConvError | null): void => set((s) => ({ errors: { ...s.errors, [sessionID]: error } }))

  /** Cargas de `loadMessages` en vuelo por sesión (F7-B11): una segunda llamada reutiliza la promesa. */
  const inflightLoads = new Map<string, Promise<void>>()

  const loadMessages = (sessionID: string): Promise<void> => {
    const client = getClient()
    const dir = get().sessionProject[sessionID] ?? get().directory
    if (!client || !dir) return Promise.resolve()
    // F7-B11: antes cada llamada abría su propio tracker (pisaba al anterior) y el `finally` de la que
    // terminaba antes apagaba `loadingMessages` de la otra.
    const running = inflightLoads.get(sessionID)
    if (running) {
      lastAccess.set(sessionID, ++accessTick)
      return running
    }
    const p: Promise<void> = (async () => {
      lastAccess.set(sessionID, ++accessTick) // cargar es acceder
      deltaQueue.flush() // los deltas anteriores a la carga no deben registrarse en el tracker
      set((s) => ({ loadingMessages: { ...s.loadingMessages, [sessionID]: true } }))
      // Registra lo que llega por el stream durante la carga y lo fusiona con el snapshot (F6-B6).
      const tracker: LoadTracker = createLoadTracker()
      buffers.loading.set(sessionID, tracker)
      // Si se borró la sesión mientras se esperaba, `purgeSession` retiró el tracker: no resucitarla (F7-B17).
      const dropped = (): boolean => buffers.loading.get(sessionID) !== tracker
      try {
        const data = sdkData(await client.session.messages({ sessionID, directory: dir }))
        if (dropped()) return
        deltaQueue.flush() // los deltas de la carga ya están en `messages` y en el tracker
        const entries = data.map((m) => ({ info: m.info, parts: [...m.parts].sort(byId) })).sort((a, b) => byId(a.info, b.info))
        set((s) => ({ messages: { ...s.messages, [sessionID]: mergeSnapshot(entries, s.messages[sessionID] ?? [], tracker) } }))
        scheduleEvict()
        const todo = await client.session.todo({ sessionID, directory: dir }).catch(() => null)
        if (todo?.data && !dropped()) {
          const todos = todo.data
          set((s) => ({ todos: { ...s.todos, [sessionID]: todos } }))
        }
      } catch (err) {
        if (!dropped()) setError(sessionID, errorMessage(err))
      } finally {
        if (!dropped()) {
          buffers.loading.delete(sessionID)
          set((s) => ({ loadingMessages: { ...s.loadingMessages, [sessionID]: false } }))
        }
      }
    })().finally(() => {
      if (inflightLoads.get(sessionID) === p) inflightLoads.delete(sessionID)
    })
    inflightLoads.set(sessionID, p)
    return p
  }

  /**
   * Último paso a idle procesado por sesión y por qué evento llegó (`session.status` o `session.idle`). El servidor
   * emite AMBOS al terminar: el segundo, si llega tras `maybeAutoSend` (que deja la sesión `busy` en local), lo
   * confundía con un fin de ejecución nuevo (F7-B18). Se descarta como duplicado si es del OTRO tipo, llegó hace
   * menos de `IDLE_DUP_WINDOW_MS` y no hubo un `busy` confirmado por el servidor entre medias.
   */
  const idleSeen = new Map<string, { kind: 'status' | 'idle'; at: number }>()
  const isDupIdle = (sessionID: string, kind: 'status' | 'idle'): boolean => {
    const e = idleSeen.get(sessionID)
    return !!e && e.kind !== kind && Date.now() - e.at < IDLE_DUP_WINDOW_MS
  }

  /** Parche que borra TODO el estado de `id` (F7-B17): antes solo se quitaban `sessions` y `sessionProject`. */
  const purgePatch = (s: CodeState, id: string): Partial<CodeState> => {
    const without = <V>(rec: Record<string, V>): Record<string, V> => {
      if (!(id in rec)) return rec
      const next = { ...rec }
      delete next[id]
      return next
    }
    const bySession = <V extends { sessionID: string }>(rec: Record<string, V>): Record<string, V> =>
      Object.fromEntries(Object.entries(rec).filter(([, v]) => v.sessionID !== id))
    return {
      sessions: without(s.sessions),
      sessionProject: without(s.sessionProject),
      messages: without(s.messages),
      queue: without(s.queue),
      todos: without(s.todos),
      runState: without(s.runState),
      errors: without(s.errors),
      unread: without(s.unread),
      loadingMessages: without(s.loadingMessages),
      permissions: bySession(s.permissions),
      questions: bySession(s.questions),
      activeSessionID: s.activeSessionID === id ? null : s.activeSessionID
    }
  }
  /** Lo que no vive en el estado de Zustand: acceso LRU, cargas en vuelo, partes huérfanas, marcas de idle. */
  const purgeSessionSideState = (id: string): void => {
    lastAccess.delete(id)
    buffers.loading.delete(id)
    inflightLoads.delete(id)
    idleSeen.delete(id)
    forgetOrphansOf(buffers, new Set([id]))
  }

  /** Permisos y preguntas pendientes + estado de ejecución del proyecto actual. */
  const loadPending = async (): Promise<void> => {
    const client = getClient()
    const dir = get().directory
    if (!client || !dir) return
    const beforePerms = get().permissions
    const beforeQs = get().questions
    const beforeRun = get().runState
    const [perms, questions, status] = await Promise.all([
      client.permission.list({ directory: dir }).catch(() => null),
      client.question.list({ directory: dir }).catch(() => null),
      client.session.status({ directory: dir }).catch(() => null)
    ])
    // F7-B16: se RECONSTRUYEN desde el servidor (filtrando por proyecto) en vez de solo acumular: uno respondido
    // desde otro cliente o mientras la app no escuchaba quedaba pegado. Si la petición falló no se toca nada.
    if (perms?.data) {
      const list: PendingPermission[] = perms.data
        .filter((p) => known(p.sessionID))
        .map((p) => ({ ...p, metadata: p.metadata ?? {}, api: 'v1' as const }))
      set((s) => ({
        permissions: reconcilePending({
          cur: s.permissions,
          before: beforePerms,
          server: list,
          inScope: (p) => s.sessionProject[p.sessionID] === dir
        })
      }))
    }
    if (questions?.data) {
      const list: PendingQuestion[] = questions.data
        .filter((q) => known(q.sessionID))
        .map((q) => ({ id: q.id, sessionID: q.sessionID, questions: q.questions }))
      set((s) => ({
        questions: reconcilePending({
          cur: s.questions,
          before: beforeQs,
          server: list,
          inScope: (q) => s.sessionProject[q.sessionID] === dir
        })
      }))
    }
    if (status?.data) {
      const map = status.data
      // Lo ausente del mapa en el proyecto pasa a idle: evita el `busy` pegado (F6-B5).
      set((s) => {
        // F7-B10: también las entradas de `runState` sin sesión (huérfanas: `loadSessions` ya las quitó), y solo las
        // que no cambiaron durante la petición (una sesión que pasó a busy por evento no debe degradarse).
        const scope = unchangedSince(
          [
            ...Object.entries(s.sessionProject)
              .filter(([, proj]) => proj === dir)
              .map(([sid]) => sid),
            ...Object.keys(s.runState).filter((sid) => !(sid in s.sessionProject))
          ],
          beforeRun,
          s.runState
        )
        const runState = reconcileRunStatus(s.runState, map, scope)
        return runState ? { runState } : {}
      })
    }
  }

  const activeDir = (): { client: ReturnType<typeof requireClient>; dir: string; sid: string } => {
    const client = requireClient()
    const { directory, activeSessionID } = get()
    if (!directory) throw new Error(t('code.store.noProject'))
    if (!activeSessionID) throw new Error(t('code.store.noSession'))
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
  ): Promise<boolean> => {
    lastAccess.set(sid, ++accessTick)
    // Modelo efectivo: sin ninguna IA conectada no se envía (evita el error técnico del motor).
    // Modelo pedido: el elegido en esta sesión de la app o el del modo Code (`modelsByMode.code`, si no el predeterminado).
    const wanted = model ?? resolveModelForMode('code')
    const aiGate = currentAiGate(wanted)
    if (aiGate.gate.blocked) {
      setError(sid, NO_AI_ERROR)
      return false
    }
    const sendModel = aiGate.avail === 'unknown' ? wanted : aiGate.effective
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
          mime: mentionMime(rel),
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
          model: sendModel ? { providerID: sendModel.providerID, modelID: sendModel.modelID } : undefined,
          variant: variant ?? undefined,
          // H1: un adjunto sin texto es un mensaje válido (solo partes `file`); no se manda un bloque de texto vacío.
          parts: [...(trimmed ? [{ type: 'text' as const, text: trimmed }] : []), ...fileParts, ...attachParts]
        })
      )
      return true
    } catch (err) {
      setError(sid, errorMessage(err))
      set((s) => ({ runState: { ...s.runState, [sid]: 'idle' } }))
      return false
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
    const body = s.sessions[sessionID]?.title || t('code.store.sessionTitle')
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
    void doSend(client, dir, sessionID, next.text, next.files, next.attachments, s.agent, s.model, s.variant).then((ok) => {
      // F7-B18: si el envío falla el ítem no se pierde: vuelve al frente de la cola (si la sesión sigue existiendo).
      if (ok || !known(sessionID)) return
      set((st) => ({ queue: { ...st.queue, [sessionID]: [next, ...(st.queue[sessionID] ?? [])] } }))
    })
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
    moreSessions: false,
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
        const limit = codeSessionLimits.get(dir) ?? SESSIONS_PAGE
        const list = sdkData(await client.session.list({ directory: dir, roots: true, limit }))
        set({ moreSessions: sessionsMayHaveMore(list.length, limit) })
        set((s) => {
          const sessions = { ...s.sessions }
          const sessionProject = { ...s.sessionProject }
          // La lista es `roots:true`: las hijas (subagentes) cuya raíz sigue se conservan (F6-B4).
          const rootIds = new Set(list.map((x) => x.id))
          for (const [sid, proj] of Object.entries(sessionProject)) {
            if (proj === dir && !rootIds.has(sid) && !isChildOfAny(s.sessions, sid, rootIds)) {
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

    loadMoreSessions: async (all = false) => {
      const dir = get().directory
      if (!dir) return
      codeSessionLimits.set(dir, nextSessionsLimit(codeSessionLimits.get(dir) ?? SESSIONS_PAGE, all))
      await get().loadSessions()
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
      // Reabrir fija la sesión (activa + acceso) ANTES de cargar: no se desaloja a mitad de la recarga.
      get().touchSession(sessionID)
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
      deltaQueue.flush()
      set((s) => purgePatch(s, sessionID))
      purgeSessionSideState(sessionID)
    },

    send: async (text, files = [], attachments = []) => {
      const trimmed = text.trim()
      if (!trimmed && attachments.length === 0) return false
      let sid = get().activeSessionID
      if (!sid) sid = await get().newSession()
      if (!sid) return false
      const { client, dir } = activeDir()
      const { agent, model, variant } = get()
      return doSend(client, dir, sid, trimmed, files, attachments, agent, model, variant)
    },

    runCommand: async (name, args) => {
      let sid = get().activeSessionID
      if (!sid) sid = await get().newSession()
      if (!sid) return
      const { client, dir } = activeDir()
      const { agent, model: picked } = get()
      const model = picked ?? resolveModelForMode('code')
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
            model: `${model.providerID}/${model.modelID}`
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
        const users = (get().messages[sid] ?? []).filter((m) => m.info.role === 'user' && (!boundary || m.info.id < boundary))
        const target = users[users.length - 1]
        if (!target) throw new Error(t('code.store.nothingToRevert'))
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

    editAndRetry: async (messageID, text) => {
      try {
        const { client, dir, sid } = activeDir()
        const entry = (get().messages[sid] ?? []).find((m) => m.info.id === messageID && m.info.role === 'user')
        if (!entry) return false
        const trimmed = text.trim()
        // Los adjuntos (imágenes pegadas y archivos por ruta) vuelven como partes `file` tal cual estaban.
        const attachments: Attachment[] = entry.parts
          .filter((p): p is FilePart => p.type === 'file')
          .map((p) => ({ id: p.id, name: p.filename ?? p.url, mime: p.mime, url: p.url }))
        if (!trimmed && attachments.length === 0) return false
        if (get().runState[sid] && get().runState[sid] !== 'idle') {
          await client.session.abort({ sessionID: sid, directory: dir }).catch(() => null)
          const until = Date.now() + 5000
          while (Date.now() < until) {
            const st = await client.session.status({ directory: dir }).catch(() => null)
            const ty = st?.data?.[sid]?.type
            if (!ty || ty === 'idle') break
            await new Promise((r) => setTimeout(r, 200))
          }
          set((st) => ({ runState: { ...st.runState, [sid]: 'idle' } }))
        }
        const reverted = sdkData(await client.session.revert({ sessionID: sid, directory: dir, messageID }))
        set((st) => ({
          sessions: { ...st.sessions, [reverted.id]: reverted },
          // Lo posterior se descarta ya en pantalla (el motor lo borra al aceptar el nuevo prompt).
          messages: { ...st.messages, [sid]: (st.messages[sid] ?? []).filter((m) => m.info.id < messageID) },
          fsVersion: st.fsVersion + 1
        }))
        const { agent, model, variant } = get()
        const ok = await doSend(client, dir, sid, trimmed, [], attachments, agent, model, variant)
        if (ok) {
          // El motor consolidó el revert al aceptar el prompt: se quita la marca para no ocultar el mensaje nuevo.
          set((st) => {
            const cur = st.sessions[sid]
            return cur?.revert ? { sessions: { ...st.sessions, [sid]: { ...cur, revert: undefined } } } : {}
          })
        } else {
          // No se pudo enviar: se deshace el `revert` y se recarga para no dejar la sesión recortada.
          const un = await client.session.unrevert({ sessionID: sid, directory: dir }).catch(() => null)
          if (un?.data) set((st) => ({ sessions: { ...st.sessions, [un.data!.id]: un.data! } }))
          await loadMessages(sid)
        }
        return ok
      } catch (err) {
        set({ globalError: errorMessage(err) })
        return false
      }
    },

    retryLast: async () => {
      const sid = get().activeSessionID
      if (!sid) return false
      const users = (get().messages[sid] ?? []).filter((m) => m.info.role === 'user')
      const target = users[users.length - 1]
      if (!target) return false
      const text = target.parts
        .filter((p): p is TextPart => p.type === 'text' && !p.synthetic)
        .map((p) => p.text)
        .join('\n')
      return get().editAndRetry(target.info.id, text)
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

    setModel: (model, remember = true) => {
      set({ model, variant: null })
      if (remember) setModeModel('code', model)
    },
    setVariant: (variant) => set({ variant }),

    // -- Cola de mensajes --
    enqueue: (sessionID, text, files = [], attachments = []) => {
      const trimmed = text.trim()
      if (!trimmed && attachments.length === 0) return false
      const item: QueuedMessage = { id: `q${Date.now()}${Math.random().toString(36).slice(2, 6)}`, text: trimmed, files, attachments }
      set((s) => ({ queue: { ...s.queue, [sessionID]: [...(s.queue[sessionID] ?? []), item] } }))
      return true
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
      if (!trimmed && attachments.length === 0) return false
      let sid = get().activeSessionID
      if (!sid) sid = await get().newSession()
      if (!sid) return false
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
      return doSend(client, dir, sid, trimmed, files, attachments, agent, model, variant)
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

    touchSession: (sessionID) => {
      lastAccess.set(sessionID, ++accessTick)
      get().evictIdle()
    },

    evictIdle: () => {
      const max = lruMax(CODE_LRU_MAX)
      if (Object.keys(get().messages).length <= max) return // atajo: ni con todas sin fijar hay exceso
      deltaQueue.flush() // un delta encolado de una sesión que se desaloja debe aplicarse antes, como uno a uno
      const cur = get()
      // Fijadas: activa, ejecutando, carga en vuelo, cola no vacía y permisos/preguntas pendientes (+ raíz e hijas).
      const seeds = new Set<string>()
      if (cur.activeSessionID) seeds.add(cur.activeSessionID)
      for (const [id, run] of Object.entries(cur.runState)) if (run === 'busy' || run === 'retry') seeds.add(id)
      for (const [id, on] of Object.entries(cur.loadingMessages)) if (on) seeds.add(id)
      for (const id of buffers.loading.keys()) seeds.add(id)
      for (const [id, q] of Object.entries(cur.queue)) if (q.length > 0) seeds.add(id)
      for (const p of Object.values(cur.permissions)) seeds.add(p.sessionID)
      for (const q of Object.values(cur.questions)) seeds.add(q.sessionID)
      const ids = pickEvictions({
        candidates: Object.keys(cur.messages),
        pinned: pinClosure(cur.sessions, seeds),
        lastAccess,
        max
      })
      if (ids.length === 0) return
      // Code no tiene `loaded` (selectSession siempre recarga): se reutiliza `evictMessages` con un `loaded` vacío.
      const next = evictMessages({ messages: cur.messages, loaded: {}, loadingMessages: cur.loadingMessages }, ids)
      set({ messages: next.messages, loadingMessages: next.loadingMessages })
      forgetOrphansOf(buffers, new Set(ids))
    },

    togglePanel: (panel) => {
      const next = get().panel === panel ? null : panel
      lsSet(LS_PANEL, next)
      set({ panel: next })
    },

    revealBrowserPanel: () => {
      if (get().panel === 'browser') return
      lsSet(LS_PANEL, 'browser')
      set({ panel: 'browser' })
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
      if (event.id && !markSeen(buffers.seen, event.id)) return
      if (event.type === 'message.part.delta') {
        if (known(event.properties.sessionID)) deltaQueue.push(event)
        return
      }
      deltaQueue.flush() // orden: lo encolado va antes que este evento
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
          set((s) => purgePatch(s, id))
          purgeSessionSideState(id)
          break
        }
        case 'session.status': {
          const { sessionID, status } = event.properties
          if (!known(sessionID)) return
          const next = toRunState(status)
          if (next === 'idle' && isDupIdle(sessionID, 'status')) return // duplicado de `session.idle` ya tratado (F7-B18)
          if (next !== 'idle') idleSeen.delete(sessionID) // `busy` confirmado por el servidor: nueva ejecución
          const prev = get().runState[sessionID]
          set((s) => ({ runState: { ...s.runState, [sessionID]: next } }))
          if (prev !== 'idle' && next === 'idle') {
            idleSeen.set(sessionID, { kind: 'status', at: Date.now() })
            set((s) => ({ fsVersion: s.fsVersion + 1 }))
            markUnread(sessionID)
            notifyCode(sessionID, t('code.store.notifyDone'))
            maybeAutoSend(sessionID)
          }
          break
        }
        case 'session.idle': {
          const { sessionID } = event.properties
          if (!known(sessionID)) return
          const prev = get().runState[sessionID]
          // F7-B18: ya está idle, o es el duplicado de un `session.status→idle` ya tratado (tras el cual `maybeAutoSend`
          // dejó la sesión `busy` en local): no hacer nada (ni pisar ese `busy`, ni notificar ni lanzar otro ítem).
          if (prev === 'idle') {
            // Solo refresca Cambios/Archivos (como antes); sin notificar ni lanzar el siguiente de la cola.
            set((s) => ({ fsVersion: s.fsVersion + 1 }))
            return
          }
          if (isDupIdle(sessionID, 'idle')) return
          idleSeen.set(sessionID, { kind: 'idle', at: Date.now() })
          set((s) => ({ runState: { ...s.runState, [sessionID]: 'idle' }, fsVersion: s.fsVersion + 1 }))
          markUnread(sessionID)
          notifyCode(sessionID, t('code.store.notifyDone'))
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
          // Pf1: solo eventos del proyecto (o del worktree de una de sus sesiones) y con debounce.
          if (isProjectDir(eventDir)) bumpFsDebounced()
          break
        case 'message.updated':
        case 'message.removed':
        case 'message.part.updated':
        case 'message.part.removed': {
          // Reductor común (lib/session-reducer). El dedupe ya se hizo arriba para TODOS los eventos.
          const cur = get()
          const { slice } = reduceEvent(
            { messages: cur.messages, status: cur.runState, errors: cur.errors, sessions: cur.sessions },
            event,
            buffers,
            { accept: known, dedupe: false }
          )
          if (slice.messages !== cur.messages) {
            set({ messages: slice.messages })
            // Clave nueva en `messages` (sesión que empieza a tener contenido): puede pasarse del tope.
            const sid = messageEventSessionID(event)
            if (sid && !(sid in cur.messages)) scheduleEvict()
          }
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
          notifyCode(p.sessionID, t('code.store.notifyApproval'))
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
          notifyCode(p.sessionID, t('code.store.notifyApproval'))
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
          notifyCode(q.sessionID, t('code.store.notifyQuestion'))
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
 * ¿Hay que mostrar el loader del historial de `sid`? Sesión conocida cuyo contenido no está en `messages` (nunca abierta
 * o desalojada por el LRU) mientras se carga: `selectSession` marca `loadingMessages` en el mismo tick que la activa,
 * así que cubre también el instante «recién seleccionada». Con historial ya presente (aunque recargue) o sin carga en
 * curso (sesión nueva vacía, error) es falso y se ve la vista de siempre.
 */
export function isCodeTranscriptLoading(
  s: Pick<CodeState, 'sessions' | 'messages' | 'loadingMessages'>,
  sid: string | null | undefined
): boolean {
  return !!sid && !!s.sessions[sid] && s.messages[sid] === undefined && !!s.loadingMessages[sid]
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
      bumpFsDebounced.cancel()
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

// Si el modelo del modo Code cambia desde fuera del selector (Ajustes › Modelos, «Usar el predeterminado»), manda el del modo:
// se descarta el elegido en memoria y su esfuerzo.
useExtrasPrefs.subscribe((s, prev) => {
  const next = s.prefs.modelsByMode.code
  const before = prev.prefs.modelsByMode.code
  if (next?.providerID === before?.providerID && next?.modelID === before?.modelID) return
  const cur = useCode.getState().model
  if (cur && next && cur.providerID === next.providerID && cur.modelID === next.modelID) return
  useCode.setState({ model: null, variant: null })
})
