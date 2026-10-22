/**
 * Estado del modo Code (Zustand).
 *
 * Mantiene su propio reductor de eventos (idempotente por id de evento) para no depender
 * de quién más esté aplicando eventos al store genérico de sesiones.
 */
import { create } from 'zustand'
import type { FilePart, Session, SessionStatus, TextPart } from '@opencode-ai/sdk/v2/client'
import { rulesetForState, sessionHasRuleset } from './permission-rules'
import { approvalKindOf, isAutoApprovableCommand } from '@shared/permission-rules'
import { NO_AI_ERROR } from '@shared/ai-errors'
import { buildCodeSystemPrompt } from '@shared/code-prompt'
import { t } from '@shared/i18n'
import type { ModelRef } from '@shared/types'
import { currentAiGate } from '../../../lib/ai-gate'
import { useProviders } from '../../../stores/providers'
import { useSettings } from '../../../stores/settings'
import { resolveModelForMode, setModeModel, useExtrasPrefs } from '../../settings/impl/extras'
import { loadCodeLearnedMemory, useCodeLearnedMemory } from './learned-memory-store'
import { hasTasksBridge } from '../../tasks/impl/bridge'
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
  interruptRunningParts,
  interruptSettledSessions,
  reconcileRunStatus,
  reduceEvent,
  unchangedSince,
  type ConvError,
  type ConvSlice,
  type LoadTracker
} from '../../../lib/session-reducer'
import { nextSessionsLimit, SESSIONS_PAGE, sessionsMayHaveMore } from '../../../lib/session-paging'
import { isRemoteSurface, platformCaps } from '../../../lib/platform'
import { phoneSafeAttachments } from './mobile-logic'
import { mentionMime } from './mention-mime'
import { acceptFilesIn, acceptSessionIn, parseReviewed, trimReviewed, withBaseline, type ReviewRecord } from './review-logic'
import { getClient, requireClient, sdkData, errorMessage, subscribeEvents, subscribeReconnect, type OcEvent } from './client'
import { ELEMENT_METADATA, elementPartsOf, elementTextsOf, isElementAttachment } from '../../browser/element-context'
import { MAX_OPEN_PROJECTS, nextFocusAfterClose, parseOpenProjects, planOpen, sameDir } from './open-projects'
import type {
  Attachment,
  FileAttachment,
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
/** Proyectos abiertos a la vez (plural) + cuál tiene el foco: `{v:1, open:string[], focus:string|null}`. `LS_PROJECT` se sigue
 *  escribiendo como espejo del foco (solo lectura para una versión anterior de la app: migración sin pérdida). */
const LS_PROJECTS = 'code.projects'
const LS_AGENT = 'code.agent'
const LS_PANEL = 'code.panel'
const LS_SESSION = 'code.session.'
const LS_PERM_MODE = 'code.permissionMode'
const LS_PINNED = 'code.pinned'
const LS_TRUSTED = 'code.trustedFolders'
/** Lo que el usuario ya revisó («Aceptar») en el panel Cambios, por sesión. Solo estado de interfaz: no toca el disco. */
const LS_REVIEWED = 'code.reviewed'
/** Cuándo empezó a existir ese registro: lo anterior se da por revisado (ver `sessionNeedsReview`). */
const LS_REVIEWED_SINCE = 'code.reviewed.since'

/** Primera ejecución con el registro de revisión (no hay `code.reviewed`): se fija «desde cuándo» y se guarda. */
function initReviewedSince(): number | null {
  const saved = Number(lsGet(LS_REVIEWED_SINCE))
  if (Number.isFinite(saved) && saved > 0) return saved
  if (lsGet(LS_REVIEWED) !== null) return null
  const now = Date.now()
  lsSet(LS_REVIEWED_SINCE, String(now))
  return now
}

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

function toRunState(s: SessionStatus): RunState {
  return s.type === 'busy' || s.type === 'retry' ? s.type : 'idle'
}

export interface CodeState {
  /** Carpeta del proyecto CON FOCO (chat, barra superior, paneles, compositor). `null` solo si no hay ninguno abierto. */
  directory: string | null
  /** Proyectos abiertos a la vez en la barra lateral, en orden de apertura. En escritorio `directory`, si no es `null`,
   *  siempre está incluido aquí; en el celular como mucho hay uno (abrir otro reemplaza, como antes). */
  openDirectories: string[]
  /** Se muestra la pantalla de "Proyectos recientes" ENCIMA del proyecto con foco, para agregar uno más (no reemplaza). */
  projectPickerOpen: boolean
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
  /** Antes era un solo booleano (un proyecto a la vez); ahora por carpeta. */
  loadingSessionsByDir: Record<string, boolean>
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
  /** Revisión del panel Cambios por sesión (persistida): qué archivos se aceptaron y con qué contenido. */
  reviewed: Record<string, ReviewRecord>
  /** Desde cuándo existe el registro de revisión (null: desde siempre). Las sesiones sin tocar desde antes no salen «por revisar». */
  reviewedSince: number | null
  /** Carpetas en las que el usuario ya confirmó "confiar" (workspace trust). */
  trustedFolders: string[]

  /** Agrega `directory` a los proyectos abiertos (si no lo estaba ya) y le da el foco. En el celular reemplaza, como antes. */
  openProject: (directory: string) => Promise<void>
  /** Solo para el celular (un proyecto a la vez): vuelve a la pantalla de elegir proyecto. En escritorio no la usa nadie. */
  closeProject: () => void
  /** Cierra UN proyecto de los abiertos (escritorio). Si tenía el foco, lo pasa a otro abierto o, si no queda ninguno,
   *  a `null` (pantalla de recientes a pantalla completa). Libera de memoria sus sesiones, mensajes, cola, etc. */
  closeOneProject: (directory: string) => void
  /** Pasa el foco a un proyecto YA abierto, sin recargar sus sesiones desde el servidor. No hace nada si no está abierto. */
  focusProject: (directory: string) => Promise<void>
  /** Al arrancar (o reconectar con un cliente nuevo): carga en paralelo las sesiones de los proyectos abiertos que NO
   *  tienen el foco (el que tiene foco lo maneja `openProjectTrusted` como siempre). Descarta los que no son de confianza. */
  restoreOpenProjects: () => Promise<void>
  /** Muestra la pantalla de recientes ENCIMA del proyecto con foco, para agregar uno más. */
  showProjectPicker: () => void
  hideProjectPicker: () => void
  loadSessions: (dir?: string) => Promise<void>
  /** «Cargar más» (o todas con `all`) en la lista de sesiones de `dir` (por defecto, el proyecto con foco). */
  loadMoreSessions: (all?: boolean, dir?: string) => Promise<void>
  /** Puede haber más sesiones en el servidor que las cargadas, por carpeta (antes era un solo booleano). */
  moreSessionsByDir: Record<string, boolean>
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
  /** «Aceptar»: marca archivos (ruta → huella de su contenido) como revisados en esa sesión. No toca el disco. */
  acceptFiles: (sessionID: string, entries: Record<string, string>) => void
  /** «Aceptar todo»: además de los archivos, guarda la huella del resumen de la sesión (la lista deja de marcarla «por revisar»). */
  acceptSession: (sessionID: string, sig: string | null, entries: Record<string, string>) => void
  /** Migración: fija como revisadas las sesiones anteriores al registro (sesión → huella del resumen), sin pisar nada. */
  baselineReviewed: (entries: Record<string, string>) => void
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

/** Tope de sesiones con contenido no fijadas en `useCode` (`localStorage['lazunox.lru.max']` lo sobrescribe). */
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
/** Paneles que existen en esta superficie: la PWA del celular no tiene terminal (pty) ni vista nativa del navegador. */
function panelAllowed(p: RightPanel): boolean {
  const caps = platformCaps()
  return (p !== 'terminal' || caps.terminal) && (p !== 'browser' || caps.nativeBrowser)
}
function initialPanel(): RightPanel | null {
  const p = lsGet(LS_PANEL)
  return (p === 'changes' || p === 'terminal' || p === 'files' || p === 'browser') && panelAllowed(p) ? p : null
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

/** Último foco por carpeta (contador monótono; sin registro = nunca tuvo el foco). Estado de módulo, sin `set`. */
const focusAt = new Map<string, number>()
let focusTick = 0
const focusRank = (dir: string): number => focusAt.get(dir) ?? -Infinity
const touchFocus = (dir: string): void => {
  focusAt.set(dir, ++focusTick)
}

/** Escribe `code.projects` (clave nueva) y, como espejo, `code.project` (clave vieja: solo el foco, para una versión anterior). */
function writeOpenProjects(open: string[], focus: string | null): void {
  lsSetJSON(LS_PROJECTS, { v: 1, open, focus })
  lsSet(LS_PROJECT, focus)
}

export const useCode = create<CodeState>((set, get) => {
  /** `directory` cuenta como abierto aunque `openDirectories` no lo tenga (pruebas que hacen `setState({directory: D})`
   *  directo, o estado a medio migrar). En escritorio, tras pasar por `openProject`, ya está incluido de por sí. */
  const openDirs = (s: Pick<CodeState, 'directory' | 'openDirectories'>): string[] =>
    s.directory && !s.openDirectories.some((d) => sameDir(d, s.directory!)) ? [...s.openDirectories, s.directory] : s.openDirectories
  const isOpenDir = (s: Pick<CodeState, 'directory' | 'openDirectories'>, d: string): boolean => openDirs(s).some((x) => sameDir(x, d))

  /** ¿`dir` tiene alguna sesión trabajando, con cola pendiente o con un permiso/pregunta sin responder? Para no
   *  desalojarlo al llegar al tope de proyectos abiertos (`selectProjectIsLive` es la misma lógica, exportada para la UI). */
  const projectIsLive = (dir: string): boolean => selectProjectIsLive(get(), dir)

  /** Desalojo agrupado: varios eventos en el mismo tick producen un único `evictIdle`. */
  const scheduleEvict = (): void => {
    if (evictScheduled) return
    evictScheduled = true
    queueMicrotask(() => {
      evictScheduled = false
      get().evictIdle()
    })
  }

  /** ¿El directorio del evento es el del proyecto CON FOCO o el de una de sus sesiones (worktrees)? Pf1 solo refresca
   *  Cambios/Archivos del proyecto con foco (el único con paneles visibles): no hace falta mirar los demás abiertos. */
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

  /** Proyecto al que pertenece una sesión reportada por el servidor (o null). Mira CUALQUIER proyecto abierto, no
   *  solo el que tiene el foco: una sesión creada por la CLI en un proyecto abierto en segundo plano debe aparecer ahí. */
  const projectFor = (info: Session): string | null => {
    const s = get()
    const known = s.sessionProject[info.id]
    if (known) return known
    if (info.parentID && s.sessionProject[info.parentID]) return s.sessionProject[info.parentID]
    for (const [sid, proj] of Object.entries(s.sessionProject)) {
      if (proj === info.directory || s.sessions[sid]?.directory === info.directory) return proj
    }
    const open = openDirs(s).find((d) => sameDir(d, info.directory))
    return open ?? null
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
   * cargar la lista) si el evento viene del directorio de CUALQUIER proyecto abierto (con foco o no).
   */
  const adopt = (sessionID: string, eventDir: string): boolean => {
    if (known(sessionID)) return true
    const s = get()
    const dir = openDirs(s).find((d) => sameDir(d, eventDir))
    if (!dir) return false
    set((st) => ({ sessionProject: { ...st.sessionProject, [sessionID]: dir } }))
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
        set((s) => {
          const merged = mergeSnapshot(entries, s.messages[sessionID] ?? [], tracker)
          // Sesión que SE SABE ociosa: lo «en curso» que traiga la base del motor es un fantasma (reinicio del motor).
          return {
            messages: { ...s.messages, [sessionID]: s.runState[sessionID] === 'idle' ? (interruptRunningParts(merged) ?? merged) : merged }
          }
        })
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

  /** Parche que borra TODO el estado de varios ids a la vez (F7-B17 generalizado a varios: antes solo se quitaban
   *  `sessions` y `sessionProject`; cerrar un proyecto entero purga todas sus sesiones en un solo `set`). */
  const purgeManyPatch = (s: CodeState, ids: ReadonlySet<string>): Partial<CodeState> => {
    const without = <V>(rec: Record<string, V>): Record<string, V> => {
      if (![...ids].some((id) => id in rec)) return rec
      const next = { ...rec }
      for (const id of ids) delete next[id]
      return next
    }
    const bySession = <V extends { sessionID: string }>(rec: Record<string, V>): Record<string, V> =>
      Object.fromEntries(Object.entries(rec).filter(([, v]) => !ids.has(v.sessionID)))
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
      activeSessionID: s.activeSessionID && ids.has(s.activeSessionID) ? null : s.activeSessionID
    }
  }
  const purgePatch = (s: CodeState, id: string): Partial<CodeState> => purgeManyPatch(s, new Set([id]))
  /** Lo que no vive en el estado de Zustand: acceso LRU, cargas en vuelo, partes huérfanas, marcas de idle. */
  const purgeManySideState = (ids: ReadonlySet<string>): void => {
    for (const id of ids) {
      lastAccess.delete(id)
      buffers.loading.delete(id)
      inflightLoads.delete(id)
      idleSeen.delete(id)
    }
    forgetOrphansOf(buffers, ids)
  }
  const purgeSessionSideState = (id: string): void => purgeManySideState(new Set([id]))

  /** Permisos y preguntas pendientes + estado de ejecución de `dir` (por defecto, el proyecto con foco). */
  const loadPending = async (dir?: string): Promise<void> => {
    const client = getClient()
    dir = dir ?? get().directory ?? undefined
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
        if (!runState) return {}
        const messages = interruptSettledSessions(s.runState, runState, s.messages)
        return messages ? { runState, messages } : { runState }
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

  /**
   * «Automático» y «Solo explorar»: el motor pregunta por todo comando (`bash * ask`) y la app aprueba sola, con «una vez», los de solo
   * lectura, pero únicamente tras comprobar el comando COMPLETO (el motor evalúa por separado cada parte de una orden compuesta y sin
   * su redirección). Solo si la sesión termina con el bloque de ese modo; cualquier otra cosa sigue su camino normal (la tarjeta).
   */
  const autoApproveReadOnly = (p: PendingPermission): boolean => {
    if (p.permission !== 'bash') return false
    const kind = approvalKindOf(get().sessions[p.sessionID]?.permission)
    if (!kind) return false
    const command = (p.metadata as Record<string, unknown> | undefined)?.command
    if (!isAutoApprovableCommand(kind, typeof command === 'string' ? command : undefined)) return false
    void get().replyPermission(p, 'once')
    return true
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
    variant: string | null,
    /** Bloques de elemento ya armados (reintentar un mensaje que los llevaba): se reenvían tal cual. */
    keptElementTexts: string[] = []
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
    // El modo de permisos es de la interfaz, pero el ruleset vive en la sesión del motor: una sesión creada antes (o por otra vía) puede
    // no tenerlo y «Manual» no preguntaría nada. Se iguala ANTES de enviar; en Manual, si no se puede, no se envía (falla cerrado).
    // El bloque de reglas es autosuficiente (anula lo de bloques anteriores) y el motor lo AÑADE: solo se reenvía si la sesión no
    // termina ya con él, así no crece la lista en cada mensaje. El agente `plan` manda sobre el modo (ver `effectiveModeFor`).
    const wantRules = rulesetForState(get().permissionMode, agent)
    if (!sessionHasRuleset(get().sessions[sid]?.permission, wantRules)) {
      try {
        const updated = sdkData(await client.session.update({ sessionID: sid, directory: dir, permission: wantRules }))
        set((st) => ({ sessions: { ...st.sessions, [updated.id]: updated } }))
      } catch (err) {
        if (get().permissionMode === 'manual' || agent === 'plan') {
          setError(sid, errorMessage(err))
          return false
        }
      }
    }
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
    // Desde el celular solo salen adjuntos `data:` (nunca `file://`: el motor los leería del disco del Mac sin pasar por permisos).
    const fileAttachments = attachments.filter((a): a is FileAttachment => a.kind !== 'element')
    const attachParts = (isRemoteSurface() ? phoneSafeAttachments(fileAttachments) : fileAttachments).map((a) => ({
      type: 'file' as const,
      mime: a.mime,
      filename: a.name,
      url: a.url
    }))
    // Elementos del navegador: un texto sintético (con metadata) y, si la casilla está marcada, la captura `data:`. El
    // celular no puede elegir elementos, pero sí reintentar uno: su política solo admite `{type,text}`, así que allí el
    // bloque sale sin `synthetic`/`metadata` (la burbuja lo reconoce igualmente por su marcador).
    const remote = isRemoteSurface()
    // Memoria aprobada al día (de usuario y de este proyecto): se relee justo antes de enviar, así lo que se aprobó hace un
    // momento ya vale en este mensaje. Nunca desde el celular (ver el comentario de `system` más abajo).
    if (!remote && hasTasksBridge()) await loadCodeLearnedMemory(dir)
    const elementParts = [
      ...elementPartsOf(attachments.filter(isElementAttachment)),
      ...keptElementTexts.map((text) => ({ type: 'text' as const, text, synthetic: true as const, metadata: ELEMENT_METADATA }))
    ].map((p) => (remote && p.type === 'text' ? { type: 'text' as const, text: p.text } : p))
    try {
      sdkData(
        await client.session.promptAsync({
          sessionID: sid,
          directory: dir,
          agent,
          model: sendModel ? { providerID: sendModel.providerID, modelID: sendModel.modelID } : undefined,
          variant: variant ?? undefined,
          // Memoria aprendida (decisión del dueño, 2026-10-07): nunca desde el celular. `PROMPT_KEYS` en
          // `remote/policy.ts` no incluye `system`, así que un `system` armado en el celular (con memoria
          // que ese mismo celular pudo manipular en su copia local de los ajustes) sería una forma de colar
          // instrucciones con el peso de "sistema" sin pasar por la aprobación del dueño en el Mac/PC.
          system: remote
            ? undefined
            : buildCodeSystemPrompt({
                learningEnabled: useSettings.getState().settings.learningEnabled,
                instructions: useSettings.getState().settings.userInstructions,
                learnedUser: useCodeLearnedMemory.getState().learnedUser,
                learnedProject: useCodeLearnedMemory.getState().learnedProject,
                projectName: dir.split(/[\\/]/).filter(Boolean).pop() ?? null
              }),
          // H1: un adjunto sin texto es un mensaje válido (solo partes `file`); no se manda un bloque de texto vacío.
          parts: [...(trimmed ? [{ type: 'text' as const, text: trimmed }] : []), ...fileParts, ...elementParts, ...attachParts]
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

  const initialProjects = parseOpenProjects(lsGet(LS_PROJECTS), lsGet(LS_PROJECT), MAX_OPEN_PROJECTS)
  if (initialProjects.focus) touchFocus(initialProjects.focus)

  return {
    directory: initialProjects.focus,
    openDirectories: initialProjects.open,
    projectPickerOpen: false,
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
    loadingSessionsByDir: {},
    loadingMessages: {},
    globalError: null,
    permissionMode: initialPermissionMode(),
    queue: {},
    unread: {},
    moreSessionsByDir: {},
    pinned: lsGetJSON<Record<string, string[]>>(LS_PINNED, {}),
    trustedFolders: lsGetJSON<string[]>(LS_TRUSTED, []),
    // Antes de leer el registro: su ausencia es la que marca la primera ejecución.
    reviewedSince: initReviewedSince(),
    reviewed: parseReviewed(lsGetJSON<unknown>(LS_REVIEWED, {})),

    openProject: async (directory) => {
      // Celular: un solo proyecto a la vez, reemplaza (como siempre). Escritorio: agrega y da el foco.
      if (isRemoteSurface()) {
        touchFocus(directory)
        writeOpenProjects([directory], directory)
        set({ directory, openDirectories: [directory], activeSessionID: null, globalError: null, projectPickerOpen: false })
      } else {
        const s = get()
        const plan = planOpen(openDirs(s), directory, MAX_OPEN_PROJECTS, projectIsLive, focusRank)
        if (plan.refused) {
          set({ globalError: t('code.store.tooManyProjects', { max: MAX_OPEN_PROJECTS }) })
          return
        }
        if (plan.evict) get().closeOneProject(plan.evict)
        touchFocus(directory)
        writeOpenProjects(plan.open, directory)
        set({ directory, openDirectories: plan.open, activeSessionID: null, globalError: null, projectPickerOpen: false })
      }
      void window.api.invoke('settings:addRecentFolder', { path: directory }).catch(() => undefined)
      await get().loadSessions(directory)
      const last = lsGet(LS_SESSION + directory)
      const sessions = selectProjectSessions(get(), directory)
      const pick = sessions.find((x) => x.id === last) ?? sessions[0]
      if (pick) await get().selectSession(pick.id)
    },

    closeProject: () => {
      // Solo lo usa el celular. En escritorio nadie la llama: ver `closeOneProject`.
      writeOpenProjects([], null)
      set({ directory: null, openDirectories: [], activeSessionID: null })
    },

    closeOneProject: (directory) => {
      const s = get()
      if (!isOpenDir(s, directory)) return
      deltaQueue.flush()
      const ids = new Set(
        Object.entries(s.sessionProject)
          .filter(([, p]) => sameDir(p, directory))
          .map(([id]) => id)
      )
      const openDirectories = openDirs(s).filter((d) => !sameDir(d, directory))
      focusAt.delete(directory)
      codeSessionLimits.delete(directory)
      const wasFocused = sameDir(s.directory ?? '', directory)
      const next = wasFocused ? nextFocusAfterClose(openDirs(s), directory, focusRank) : (s.directory ?? null)
      // Si se cierra el proyecto con foco, el foco pasa al siguiente EN LA MISMA actualización: si no, `openDirs` seguiría
      // contando la carpeta cerrada (por ser `directory`) y `focusProject` la volvía a guardar en la lista (reaparecía al reiniciar).
      set((st) => ({
        ...purgeManyPatch(st, ids),
        openDirectories,
        ...(wasFocused ? { directory: next ?? null, activeSessionID: null } : {})
      }))
      purgeManySideState(ids)
      writeOpenProjects(openDirectories, next)
      if (wasFocused && next) {
        touchFocus(next)
        const last = lsGet(LS_SESSION + next)
        const sessions = selectProjectSessions(get(), next)
        const pick = sessions.find((x) => x.id === last) ?? sessions[0]
        if (pick) void get().selectSession(pick.id)
      }
    },

    focusProject: async (directory) => {
      const s = get()
      if (!isOpenDir(s, directory) || sameDir(s.directory ?? '', directory)) return
      touchFocus(directory)
      writeOpenProjects(openDirs(s), directory)
      set({ directory, activeSessionID: null, projectPickerOpen: false })
      const last = lsGet(LS_SESSION + directory)
      const sessions = selectProjectSessions(get(), directory)
      const pick = sessions.find((x) => x.id === last) ?? sessions[0]
      if (pick) await get().selectSession(pick.id)
    },

    restoreOpenProjects: async () => {
      const s = get()
      // Los proyectos que el usuario ya tenía abiertos NO se quitan de la barra aunque aún no consten como de confianza (antes
      // desaparecían sin avisar al reiniciar): quedan visibles y piden confirmar al entrar. Solo se cargan sus sesiones (lo que
      // inicia el motor en esa carpeta) si son de confianza.
      const all = openDirs(s)
      const others = all.filter((d) => !sameDir(d, s.directory ?? '') && s.isTrusted(d))
      await Promise.all(others.map((d) => get().loadSessions(d)))
    },

    showProjectPicker: () => set({ projectPickerOpen: true }),
    hideProjectPicker: () => set({ projectPickerOpen: false }),

    loadSessions: async (dirArg) => {
      const client = getClient()
      const dir = dirArg ?? get().directory
      if (!client || !dir) return
      set((s) => ({ loadingSessionsByDir: { ...s.loadingSessionsByDir, [dir]: true } }))
      try {
        const limit = codeSessionLimits.get(dir) ?? SESSIONS_PAGE
        const list = sdkData(await client.session.list({ directory: dir, roots: true, limit }))
        set((s) => ({ moreSessionsByDir: { ...s.moreSessionsByDir, [dir]: sessionsMayHaveMore(list.length, limit) } }))
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
        await loadPending(dir)
      } catch (err) {
        set({ globalError: errorMessage(err) })
      } finally {
        set((s) => ({ loadingSessionsByDir: { ...s.loadingSessionsByDir, [dir]: false } }))
      }
    },

    loadMoreSessions: async (all = false, dirArg) => {
      const dir = dirArg ?? get().directory
      if (!dir) return
      codeSessionLimits.set(dir, nextSessionsLimit(codeSessionLimits.get(dir) ?? SESSIONS_PAGE, all))
      await get().loadSessions(dir)
    },

    newSession: async () => {
      const dir = get().directory
      if (!dir) return null
      return get().newSessionAt(dir)
    },

    newSessionAt: async (dir, title) => {
      try {
        const client = requireClient()
        const sess = sdkData(
          await client.session.create({ directory: dir, title, permission: rulesetForState(get().permissionMode, get().agent) })
        )
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
        const elementTexts = elementTextsOf(entry.parts)
        if (!trimmed && attachments.length === 0 && elementTexts.length === 0) return false
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
        // Los bloques de elemento (texto sintético) también vuelven, o el modelo perdería el contexto de la página.
        const ok = await doSend(client, dir, sid, trimmed, [], attachments, agent, model, variant, elementTexts)
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
      if (mode === 'plan') get().setAgent('plan')
      else if (get().agent === 'plan') get().setAgent('build')
      // El bloque del modo se manda ya (también «Solo explorar»: tiene que anular lo que dejó el modo anterior en esta sesión).
      // No se reenvía si la sesión ya termina con él. Si hay una respuesta en curso, el motor la termina con las reglas anteriores:
      // el cambio vale desde el próximo mensaje (la interfaz lo avisa).
      const permission = rulesetForState(mode, get().agent)
      if (sessionHasRuleset(get().sessions[sid]?.permission, permission)) return
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
    acceptFiles: (sessionID, entries) => {
      set((s) => {
        const prev = s.reviewed[sessionID]
        // Reinserta la sesión al final: el tope descarta primero las más antiguas.
        const { [sessionID]: _old, ...rest } = s.reviewed
        const reviewed = trimReviewed({ ...rest, [sessionID]: acceptFilesIn(prev, entries) })
        lsSetJSON(LS_REVIEWED, reviewed)
        return { reviewed }
      })
    },
    acceptSession: (sessionID, sig, entries) => {
      set((s) => {
        const prev = s.reviewed[sessionID]
        const { [sessionID]: _old, ...rest } = s.reviewed
        const reviewed = trimReviewed({ ...rest, [sessionID]: acceptSessionIn(acceptFilesIn(prev, entries), sig) })
        lsSetJSON(LS_REVIEWED, reviewed)
        return { reviewed }
      })
    },
    baselineReviewed: (entries) => {
      set((s) => {
        const reviewed = withBaseline(s.reviewed, entries)
        if (reviewed === s.reviewed) return {}
        lsSetJSON(LS_REVIEWED, reviewed)
        return { reviewed }
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
      if (!panelAllowed(panel)) return
      const next = get().panel === panel ? null : panel
      lsSet(LS_PANEL, next)
      set({ panel: next })
    },

    revealBrowserPanel: () => {
      if (get().panel === 'browser' || !panelAllowed('browser')) return
      lsSet(LS_PANEL, 'browser')
      set({ panel: 'browser' })
    },

    setGlobalError: (globalError) => set({ globalError }),

    touchFs: () => set((s) => ({ fsVersion: s.fsVersion + 1 })),

    resync: async () => {
      const s = get()
      if (!s.directory) return
      await Promise.all(
        openDirs(s)
          .filter((d) => sameDir(d, s.directory ?? '') || s.isTrusted(d))
          .map((d) => get().loadSessions(d))
      )
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
          // Sesión efímera del flujo de PR (mensaje de commit, revisión…): nunca entra en la lista de Code.
          if ((info as { metadata?: { mode?: unknown } }).metadata?.mode === 'pr-helper') return
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
          const pending: PendingPermission = {
            id: p.id,
            sessionID: p.sessionID,
            permission: p.permission,
            patterns: p.patterns,
            metadata: p.metadata ?? {},
            always: p.always,
            tool: p.tool,
            api: 'v1'
          }
          if (autoApproveReadOnly(pending)) break
          markUnread(rootSessionID(get().sessions, p.sessionID))
          notifyCode(p.sessionID, t('code.store.notifyApproval'))
          set((s) => ({ permissions: { ...s.permissions, [p.id]: pending } }))
          break
        }
        case 'permission.v2.asked': {
          const p = event.properties
          if (!adopt(p.sessionID, eventDir)) return
          const pending: PendingPermission = {
            id: p.id,
            sessionID: p.sessionID,
            permission: p.action,
            patterns: p.resources,
            metadata: p.metadata ?? {},
            always: p.save ?? [],
            tool: p.source ? { messageID: p.source.messageID, callID: p.source.callID } : undefined,
            api: 'v2'
          }
          if (autoApproveReadOnly(pending)) break
          markUnread(rootSessionID(get().sessions, p.sessionID))
          notifyCode(p.sessionID, t('code.store.notifyApproval'))
          set((s) => ({ permissions: { ...s.permissions, [p.id]: pending } }))
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

/** ¿`directory` tiene alguna sesión trabajando, con cola pendiente o con un permiso/pregunta sin responder? Para avisar
 *  antes de cerrarlo (`closeOneProject` lo hace de todos modos; esto es solo para la confirmación en la UI). */
export function selectProjectIsLive(
  s: Pick<CodeState, 'sessionProject' | 'runState' | 'queue' | 'permissions' | 'questions'>,
  directory: string
): boolean {
  const ids = new Set(
    Object.entries(s.sessionProject)
      .filter(([, p]) => sameDir(p, directory))
      .map(([id]) => id)
  )
  if (ids.size === 0) return false
  for (const id of ids) {
    const run = s.runState[id]
    if (run === 'busy' || run === 'retry') return true
    if ((s.queue[id]?.length ?? 0) > 0) return true
  }
  for (const p of Object.values(s.permissions)) if (ids.has(p.sessionID)) return true
  for (const q of Object.values(s.questions)) if (ids.has(q.sessionID)) return true
  return false
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

// Si cambia el conjunto de proveedores conectados (conectar o desconectar una cuenta), el modelo elegido en memoria (p. ej. el que el
// compositor fijó con `setModel(eff, false)`) puede ser de la cuenta anterior: se descarta y manda el del modo (ya reconciliado).
let providerIdsSig: string | null = null
useProviders.subscribe((s) => {
  if (!s.loaded) return
  const sig = s.providers
    .map((p) => p.id)
    .sort()
    .join(',')
  const changed = providerIdsSig !== null && sig !== providerIdsSig
  providerIdsSig = sig
  if (changed && useCode.getState().model) useCode.setState({ model: null, variant: null })
})
