/**
 * Estado del modo Tareas. Los mensajes/partes de las sesiones viven en el store genérico
 * `useSessions` (alimentado aquí con el stream SSE del servidor sandboxeado de la carpeta);
 * este store guarda lo específico: carpeta, conexión, todos, permisos y entregables.
 */
import { create } from 'zustand'
import { createOpencodeClient, type PermissionRequest, type QuestionRequest, type Todo } from '@opencode-ai/sdk/v2/client'
import {
  DEFAULT_TASKS_PREFS,
  FULL_ACCESS_NOT_GRANTED,
  type AccessRequest,
  type AutoApprovalRecord,
  type AutoModeState,
  type ComputerActionEvent,
  type ComputerKillState,
  type ComputerStatus,
  type TasksActivitySnapshot,
  type TasksConnection,
  type TasksDeliverable,
  type TasksFolder,
  type TasksFolderSet,
  type TasksMemory,
  type TasksPrefs,
  type TasksProject,
  type TasksTaskMeta,
  type GrantsSnapshot,
  type ManagedPolicy,
  type NetworkBlockedEvent
} from '@shared/ipc-tasks'
import { APP_NAME } from '@shared/brand'
import { t } from '@shared/i18n'
import type { ModelRef } from '@shared/types'
import { errorMessage, startEventStream, type OcEvent, type OpencodeClient } from '../../../lib/opencode'
import { sendNotification } from '../../../lib/notify'
import { reconcileRunStatus, runStatusScope, unchangedSince } from '../../../lib/session-reducer'
import { MAIN_SOURCE, useSessions } from '../../../stores/sessions'
import { resolveModelForMode, useExtrasPrefs } from '../../settings/impl/extras'
import { cw, onTasks } from './bridge'
import type { RestoreResult } from './restore-logic'

export type TasksServerPhase = 'idle' | 'starting' | 'ready' | 'error'

/** Aviso de red bloqueada pendiente/resuelto para una tarea (evento `tasks:networkBlocked`). */
export interface NetworkBlockedEntry {
  host: string
  port: number
  at: number
  /** Cómo se resolvió (sin decidir aún = `undefined`); "Mantener bloqueado" quita la entrada. */
  resolved?: 'once' | 'always'
}

interface TasksState {
  folders: TasksFolder[]
  folder: string | null
  conn: TasksConnection | null
  client: OpencodeClient | null
  phase: TasksServerPhase
  error: string | null
  streaming: boolean
  activeTaskId: string | null
  /** Carpeta elegida pendiente de confirmación ("¿Permitir Tareas en…?"). */
  pendingApproval: string | null
  todos: Record<string, Todo[]>
  permissions: Record<string, PermissionRequest>
  /** Preguntas estructuradas pendientes (herramienta `question`), por id de solicitud. */
  questions: Record<string, QuestionRequest>
  deliverables: Record<string, TasksDeliverable[]>
  listLoading: boolean
  /** Modo de acceso solicitado para la carpeta actual (persistido por carpeta). */
  fullAccess: boolean
  /** Carpeta cuyo cambio a Control total espera confirmación. */
  pendingFullAccess: string | null
  /** Último estado de `computer:status` (null = sin comprobar). */
  computerStatus: ComputerStatus | null
  computerChecking: boolean
  /** Última acción del agente sobre el Mac (evento `computer:action`). */
  lastAction: ComputerActionEvent | null
  /**
   * Momento en que se detuvo el control (Detener / Cmd+Shift+Esc). Refleja el kill-switch del
   * proceso principal (`computer:state` / `computer:killState`): solo se limpia con "Reanudar control".
   */
  controlStoppedAt: number | null
  /** El atajo global ⌘⇧Esc no se pudo registrar (hay que usar el botón Detener). */
  shortcutUnavailable: boolean
  /** Texto del compositor (permite rellenarlo desde sugerencias / seguimientos). */
  draft: string
  /** Archivos adjuntos (ya copiados a la carpeta) para el próximo mensaje. */
  attachments: TasksDeliverable[]
  /** Panel derecho (Plan / Entregables / Actividad) visible. */
  panelOpen: boolean
  /** Ids de tareas cuyo resultado aún no se ha visto (terminaron en segundo plano). */
  unseen: Record<string, true>
  /** Ids de tareas fijadas ("Pin"), persistido en localStorage (no hay campo equivalente en el SDK). */
  pinned: Record<string, true>
  /** Proyecto (nombre + instrucciones) de la carpeta actual. */
  project: TasksProject | null
  /** Memoria (`.onyxcode/memoria.md`) de la carpeta actual. */
  memory: TasksMemory | null
  /** Panel "Proyecto y memoria" visible. */
  projectPanelOpen: boolean
  /** Apps concedidas/denegadas (concesión por app, `computer:grants`). */
  grants: GrantsSnapshot | null
  /** Tarjeta "¿Permitir que el agente use X?" pendiente (herramienta MCP `request_access`). */
  accessRequest: AccessRequest | null
  /** Avisos "acceso bloqueado" del proxy de egress, por tarea (id de sesión raíz). Dedupe por host. */
  networkBlocked: Record<string, NetworkBlockedEntry[]>
  /** "Permitir borrar" de la carpeta actual (`tasks:deleteGrant:get`; null = aún sin cargar). */
  deleteGrant: boolean | null
  deleteGrantBusy: boolean
  /** Tareas (id de sesión raíz) con el plan aprobado en Control total (`computer:planState`). */
  approvedPlans: Record<string, true>
  /** Tareas activas y servidores de TODAS las carpetas (monitor de main, evento `tasks:activity`). */
  activity: TasksActivitySnapshot | null
  /** Metadatos persistidos en main por id de sesión (fijada, grupo, título, carpeta y modo). */
  taskMeta: Record<string, TasksTaskMeta>
  /** Carpetas principal / vinculadas / de confianza de la carpeta actual (null = sin cargar). */
  folderSet: TasksFolderSet | null
  /** Modelo elegido para la tarea (null = el del modo Tareas, ver `currentTasksModel`). */
  taskModel: ModelRef | null
  /** Esfuerzo (variante) elegido para la tarea (null = el predeterminado del modelo). */
  taskVariant: string | null
  /** Preferencias de Tareas (null = sin cargar; usar `DEFAULT_TASKS_PREFS`). */
  prefs: TasksPrefs | null
  /** Política gestionada por la organización (null = ninguna o sin cargar). */
  policy: ManagedPolicy | null
  /** Consulta lateral abierta: tarea principal y su sesión hija (null hasta el primer mensaje). */
  sideChat: { taskId: string; sessionId: string | null } | null
  /** La lista de la carpeta muestra las tareas archivadas. */
  showArchived: boolean

  /** Lote C: estado del Modo auto (null = sin cargar; usar como apagado). */
  autoMode: AutoModeState | null
  /**
   * Ids de peticiones de permiso (`permission.asked`) que el Modo auto está considerando ahora
   * mismo (vía rápida, `tasks:auto:consider`): mientras están aquí, `PermissionPrompt` oculta su
   * tarjeta (se resuelve solo, sin que el usuario tenga que tocar nada) o, si el Modo auto no la
   * aprueba, vuelve a aparecer.
   */
  autoPending: Record<string, true>
  /** Último aviso "Aprobado por el modo auto: …" (evento `tasks:auto:approved`), para un toast. */
  autoApprovedNotice: AutoApprovalRecord | null

  /** Se está guardando el punto de restauración previo al envío (el compositor lo indica). */
  restoreSaving: boolean
  /** Motivo por el que el último envío de cada tarea no guardó un punto de restauración. */
  restoreWarning: Record<string, string>
  /** Sube al crear o aplicar un punto: el panel «Cambios en archivos» vuelve a consultar. */
  restoreVersion: number
  /** Último «Cambios deshechos…» (con «Rehacer»). */
  restoreResult: RestoreResult | null

  set: (patch: Partial<TasksState>) => void
}

const PINNED_KEY = 'tasks.pinned'

function readPinned(): Record<string, true> {
  try {
    const raw = localStorage.getItem(PINNED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, true>) : {}
  } catch {
    return {}
  }
}

function writePinned(map: Record<string, true>): void {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(map))
  } catch {
    // sin storage
  }
}

/** Fijadas del formato antiguo (localStorage) que aún no se han migrado a main. */
const legacyPinned: Record<string, true> = readPinned()

/** `pinned` derivado: fijadas de `taskMeta` más las antiguas todavía sin migrar. */
function derivePinned(taskMeta: Record<string, TasksTaskMeta>): Record<string, true> {
  const pinned: Record<string, true> = { ...legacyPinned }
  for (const m of Object.values(taskMeta)) {
    if (m.pinned) pinned[m.sessionId] = true
    // Una tarea con metadatos de main que no está fijada manda sobre la lista antigua.
    else delete pinned[m.sessionId]
  }
  return pinned
}

const PANEL_KEY = 'tasks.panelOpen'

function readPanelOpen(): boolean {
  try {
    return localStorage.getItem(PANEL_KEY) !== '0'
  } catch {
    return true
  }
}

export function setPanelOpen(open: boolean): void {
  try {
    localStorage.setItem(PANEL_KEY, open ? '1' : '0')
  } catch {
    // sin storage
  }
  useTasks.setState({ panelOpen: open })
}

export const useTasks = create<TasksState>((set) => ({
  folders: [],
  folder: null,
  conn: null,
  client: null,
  phase: 'idle',
  error: null,
  streaming: false,
  activeTaskId: null,
  pendingApproval: null,
  todos: {},
  permissions: {},
  questions: {},
  deliverables: {},
  listLoading: false,
  fullAccess: false,
  pendingFullAccess: null,
  computerStatus: null,
  computerChecking: false,
  lastAction: null,
  controlStoppedAt: null,
  shortcutUnavailable: false,
  draft: '',
  attachments: [],
  panelOpen: readPanelOpen(),
  unseen: {},
  pinned: readPinned(),
  project: null,
  memory: null,
  projectPanelOpen: false,
  grants: null,
  accessRequest: null,
  networkBlocked: {},
  deleteGrant: null,
  deleteGrantBusy: false,
  approvedPlans: {},
  activity: null,
  taskMeta: {},
  folderSet: null,
  taskModel: null,
  taskVariant: null,
  prefs: null,
  policy: null,
  sideChat: null,
  showArchived: false,
  autoMode: null,
  autoPending: {},
  autoApprovedNotice: null,
  restoreSaving: false,
  restoreWarning: {},
  restoreVersion: 0,
  restoreResult: null,
  set: (patch) => set(patch)
}))

export function setProjectPanelOpen(open: boolean): void {
  useTasks.setState({ projectPanelOpen: open })
  // Al abrir el panel se relee la memoria: el agente pudo escribir `.onyxcode/memoria.md` mientras estaba cerrado.
  if (open) {
    const { folder } = useTasks.getState()
    if (folder) void loadProjectAndMemory(folder)
  }
}

/** Carga proyecto + memoria de la carpeta actual (no bloquea la conexión si falla). */
export async function loadProjectAndMemory(folder: string): Promise<void> {
  try {
    const [project, memory] = await Promise.all([cw('tasks:project:get', { folder }), cw('tasks:memory:get', { folder })])
    if (useTasks.getState().folder === folder) useTasks.setState({ project, memory })
  } catch {
    if (useTasks.getState().folder === folder) useTasks.setState({ project: null, memory: null })
  }
}

export async function saveMemoryNotes(content: string): Promise<void> {
  const { folder } = useTasks.getState()
  if (!folder) return
  const memory = await cw('tasks:memory:save', { folder, content })
  if (useTasks.getState().folder === folder) useTasks.setState({ memory })
}

export async function deleteMemoryNotes(): Promise<void> {
  const { folder } = useTasks.getState()
  if (!folder) return
  const memory = await cw('tasks:memory:delete', { folder })
  if (useTasks.getState().folder === folder) useTasks.setState({ memory })
}

/** Carga "Permitir borrar" de la carpeta actual (no bloquea la conexión si falla). */
export async function loadDeleteGrant(folder: string): Promise<void> {
  try {
    const allowed = await cw('tasks:deleteGrant:get', { folder })
    if (useTasks.getState().folder === folder) useTasks.setState({ deleteGrant: allowed })
  } catch {
    if (useTasks.getState().folder === folder) useTasks.setState({ deleteGrant: null })
  }
}

// ── Red de Tareas (avisos de bloqueo por tarea) ──

/**
 * Asocia un `tasks:networkBlocked` a la tarea raíz que esté trabajando en esa carpeta (la
 * activa si lo está; si no, la primera tarea raíz ocupada). Ignora eventos de otra carpeta y
 * deduplica por host dentro de la misma tarea.
 */
export function addNetworkBlocked(ev: NetworkBlockedEvent): void {
  const st = useTasks.getState()
  if (ev.folder !== st.folder) return
  const { sessions, status } = useSessions.getState()
  const isBusyRoot = (id: string | null | undefined): boolean =>
    !!id && status[id] !== undefined && status[id] !== 'idle' && !sessions[id]?.parentID
  let taskId = st.activeTaskId
  if (!isBusyRoot(taskId)) {
    taskId =
      Object.keys(status).find((id) => status[id] !== 'idle' && !sessions[id]?.parentID && sessions[id]?.directory === ev.folder) ?? taskId
  }
  if (!taskId) return
  const id = taskId
  useTasks.setState((s) => {
    const list = s.networkBlocked[id] ?? []
    if (list.some((b) => b.host === ev.host)) return s
    return { networkBlocked: { ...s.networkBlocked, [id]: [...list, { host: ev.host, port: ev.port, at: ev.at }] } }
  })
}

/** Marca cómo se resolvió el aviso ("Permitir esta vez"/"Permitir siempre"), sin quitar la tarjeta. */
export function resolveNetworkBlocked(taskId: string, host: string, resolved: 'once' | 'always'): void {
  useTasks.setState((s) => {
    const list = s.networkBlocked[taskId]
    if (!list) return s
    return { networkBlocked: { ...s.networkBlocked, [taskId]: list.map((b) => (b.host === host ? { ...b, resolved } : b)) } }
  })
}

/** Quita el aviso ("Mantener bloqueado" tras persistirlo, o tras "Reintentar"). */
export function dismissNetworkBlocked(taskId: string, host: string): void {
  useTasks.setState((s) => {
    const list = s.networkBlocked[taskId]
    if (!list) return s
    return { networkBlocked: { ...s.networkBlocked, [taskId]: list.filter((b) => b.host !== host) } }
  })
}

/** Fija/desfija una tarea en la barra lateral (persistido en main con `tasks:tasks:setMeta`). */
export function togglePinned(sessionID: string): void {
  void setTaskMeta(sessionID, { pinned: !isPinned(sessionID) })
}

export function isPinned(sessionID: string): boolean {
  return !!useTasks.getState().pinned[sessionID]
}

// ── Metadatos de tareas (fijadas, grupos) ──

/** Carpeta y modo de una tarea: de su sesión / metadatos, o de la conexión actual. null = desconocida. */
function taskOrigin(sessionId: string): { folder: string; fullAccess: boolean } | null {
  const st = useTasks.getState()
  const meta = st.taskMeta[sessionId]
  const folder = useSessions.getState().sessions[sessionId]?.directory ?? meta?.folder ?? st.folder
  if (!folder) return null
  return { folder, fullAccess: meta ? meta.fullAccess : (st.conn?.fullAccess ?? false) }
}

/**
 * Cambia fijada / grupo / título de una tarea en main (`tasks:tasks:setMeta`). Actualización
 * optimista: si main falla se restaura el valor anterior y se muestra el error.
 */
export async function setTaskMeta(sessionId: string, patch: { pinned?: boolean; group?: string | null; title?: string }): Promise<void> {
  const origin = taskOrigin(sessionId)
  if (!origin) return
  const prev = useTasks.getState().taskMeta[sessionId]
  const title = (patch.title ?? prev?.title ?? useSessions.getState().sessions[sessionId]?.title ?? '').slice(0, 500)
  const optimistic: TasksTaskMeta = {
    sessionId,
    folder: origin.folder,
    fullAccess: origin.fullAccess,
    title,
    pinned: patch.pinned ?? prev?.pinned,
    group: patch.group !== undefined ? patch.group : prev?.group,
    updatedAt: Date.now()
  }
  const apply = (meta: TasksTaskMeta | undefined): void =>
    useTasks.setState((s) => {
      const taskMeta = { ...s.taskMeta }
      if (meta) taskMeta[sessionId] = meta
      else delete taskMeta[sessionId]
      return { taskMeta, pinned: derivePinned(taskMeta) }
    })
  apply(optimistic)
  try {
    const saved = await cw('tasks:tasks:setMeta', {
      sessionId,
      folder: origin.folder,
      fullAccess: origin.fullAccess,
      ...(title ? { title } : {}),
      ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
      ...(patch.group !== undefined ? { group: patch.group } : {})
    })
    apply(saved)
  } catch (err) {
    apply(prev)
    useTasks.setState({ error: errorMessage(err) })
  }
}

/** Quita los metadatos de una tarea borrada (main y estado local). */
export function forgetTaskMeta(sessionId: string): void {
  useTasks.setState((s) => {
    if (!s.taskMeta[sessionId] && !s.pinned[sessionId]) return s
    const taskMeta = { ...s.taskMeta }
    delete taskMeta[sessionId]
    delete legacyPinned[sessionId]
    return { taskMeta, pinned: derivePinned(taskMeta) }
  })
  void cw('tasks:tasks:forget', { sessionId }).catch(() => undefined)
}

let legacyMigrating = false

/**
 * Migra UNA vez las fijadas de localStorage (`tasks.pinned`) a main. Solo se migran las tareas cuya
 * carpeta se conoce (las de la conexión actual); el resto queda pendiente hasta que se conecte su
 * carpeta. Cuando no queda ninguna pendiente se borra la clave antigua.
 */
async function migrateLegacyPinned(): Promise<void> {
  if (legacyMigrating || Object.keys(legacyPinned).length === 0) return
  const { conn, taskMeta } = useTasks.getState()
  if (!conn) return
  legacyMigrating = true
  try {
    const { sessions, sessionSource } = useSessions.getState()
    for (const id of Object.keys(legacyPinned)) {
      if (taskMeta[id]) {
        delete legacyPinned[id] // main ya la conoce
        continue
      }
      const sess = sessions[id]
      if (!sess || sessionSource[id] !== conn.baseUrl || sess.directory !== conn.folder) continue
      try {
        const saved = await cw('tasks:tasks:setMeta', {
          sessionId: id,
          folder: conn.folder,
          fullAccess: conn.fullAccess,
          title: (sess.title || '').slice(0, 500),
          pinned: true
        })
        delete legacyPinned[id]
        useTasks.setState((s) => {
          const next = { ...s.taskMeta, [id]: saved }
          return { taskMeta: next, pinned: derivePinned(next) }
        })
      } catch {
        // main no disponible: se reintenta en la próxima carga
      }
    }
    if (Object.keys(legacyPinned).length === 0) {
      try {
        localStorage.removeItem(PINNED_KEY)
      } catch {
        // sin storage
      }
    } else {
      writePinned(legacyPinned)
    }
  } finally {
    legacyMigrating = false
  }
}

/** Carga los metadatos de tareas de main y migra las fijadas antiguas. */
export async function loadTaskMetas(): Promise<void> {
  try {
    const list = await cw('tasks:tasks:list')
    const taskMeta: Record<string, TasksTaskMeta> = {}
    for (const m of list) taskMeta[m.sessionId] = m
    useTasks.setState({ taskMeta, pinned: derivePinned(taskMeta) })
  } catch {
    return // sin puente o main aún sin implementar: se conserva lo local
  }
  await migrateLegacyPinned()
}

/** Marca una tarea como no leída a propósito (acción manual, además del "unseen" automático). */
export function markUnread(sessionID: string): void {
  useTasks.setState((s) => ({ unseen: { ...s.unseen, [sessionID]: true } }))
}

const LAST_FOLDER_KEY = 'tasks.lastFolder'
const FULL_ACCESS_KEY = 'tasks.fullAccess'
let stopStream: (() => void) | null = null
let deliverablesTimer: ReturnType<typeof setTimeout> | null = null

export function rememberFolder(folder: string | null): void {
  try {
    if (folder) localStorage.setItem(LAST_FOLDER_KEY, folder)
    else localStorage.removeItem(LAST_FOLDER_KEY)
  } catch {
    // sin storage
  }
}

export function lastFolder(): string | null {
  try {
    return localStorage.getItem(LAST_FOLDER_KEY)
  } catch {
    return null
  }
}

function readFullAccessMap(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(FULL_ACCESS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

/** ¿El usuario eligió Control total del Mac para esta carpeta? */
export function fullAccessFor(folder: string): boolean {
  return readFullAccessMap()[folder] === true
}

export function rememberFullAccess(folder: string, fullAccess: boolean): void {
  try {
    const map = readFullAccessMap()
    if (fullAccess) map[folder] = true
    else delete map[folder]
    localStorage.setItem(FULL_ACCESS_KEY, JSON.stringify(map))
  } catch {
    // sin storage
  }
}

export function makeClient(conn: TasksConnection): OpencodeClient {
  return createOpencodeClient({ baseUrl: conn.baseUrl, headers: { Authorization: conn.authorization } })
}

/** Programa una recarga (con debounce) de los entregables de la tarea activa. */
export function scheduleDeliverablesRefresh(delay = 800): void {
  if (deliverablesTimer) clearTimeout(deliverablesTimer)
  deliverablesTimer = setTimeout(() => {
    deliverablesTimer = null
    void refreshDeliverables()
  }, delay)
}

export async function refreshDeliverables(sessionID?: string): Promise<void> {
  const { folder, activeTaskId } = useTasks.getState()
  const id = sessionID ?? activeTaskId
  if (!folder || !id) return
  const session = useSessions.getState().sessions[id]
  if (!session) return
  try {
    // Pequeño margen por diferencias de reloj/mtime.
    const files = await cw('tasks:deliverables', { folder, since: session.time.created - 2000 })
    useTasks.setState((s) => ({ deliverables: { ...s.deliverables, [id]: files } }))
  } catch {
    // ignorar: carpeta quizá movida
  }
}

/**
 * Notificación nativa (proceso principal, ver `lib/notify.ts`): un clic restaura/enfoca la
 * ventana y reenvía `app:openTarget` (mode 'tasks', id de la tarea raíz, modo de acceso), que
 * `App.tsx` usa para cambiar de modo y seleccionar la tarea. Respeta `prefs.notify` por tipo.
 */
export type TasksNotifyKind = 'done' | 'error' | 'approval' | 'question'

export function notifyTask(sessionID: string, kind: TasksNotifyKind, title: string, body: string): void {
  const { folder, conn, prefs } = useTasks.getState()
  if (!(prefs?.notify ?? DEFAULT_TASKS_PREFS.notify)[kind]) return
  sendNotification(title, body, { mode: 'tasks', id: sessionID, directory: folder ?? undefined, fullAccess: conn?.fullAccess === true })
}

export function rootTaskId(sessionID: string): string {
  const sessions = useSessions.getState().sessions
  let id = sessionID
  for (let i = 0; i < 5; i++) {
    const parent = sessions[id]?.parentID
    if (!parent) break
    id = parent
  }
  return id
}

function taskTitle(sessionID: string): string {
  return useSessions.getState().sessions[sessionID]?.title || t('tasks.ws.untitled')
}

export function clearUnseen(sessionID: string): void {
  if (!useTasks.getState().unseen[sessionID]) return
  useTasks.setState((s) => {
    const unseen = { ...s.unseen }
    delete unseen[sessionID]
    return { unseen }
  })
}

function handleEvent(event: OcEvent, directory: string): void {
  const st = useTasks.getState()
  if (!st.folder || directory !== st.folder || !st.conn) return
  const prevRun =
    event.type === 'session.idle' || event.type === 'session.status' ? useSessions.getState().status[event.properties.sessionID] : undefined
  // Origen = servidor de esta carpeta/modo (no mezclar con sesiones de Code/Chat, B2).
  useSessions.getState().applyEvent(event, st.conn.baseUrl)
  // Avisos: tarea terminada / necesita aprobación / error (solo tareas raíz).
  if (event.type === 'session.idle' || (event.type === 'session.status' && event.properties.status.type === 'idle')) {
    const id = event.properties.sessionID
    const isRoot = !useSessions.getState().sessions[id]?.parentID
    if (isRoot && prevRun && prevRun !== 'idle') {
      if (id !== st.activeTaskId || !document.hasFocus()) {
        useTasks.setState((s) => ({ unseen: { ...s.unseen, [id]: true } }))
      }
      const failed = useSessions.getState().errors[id]
      notifyTask(id, failed ? 'error' : 'done', failed ? t('tasks.notify.failed') : t('tasks.notify.done'), taskTitle(id))
      // El agente pudo guardar memoria (`.onyxcode/memoria.md`): si el panel está cerrado se relee; si está
      // abierto no se pisa lo que el usuario esté editando.
      if (!st.projectPanelOpen) void loadProjectAndMemory(st.folder)
    }
  } else if (event.type === 'permission.asked' && !st.permissions[event.properties.id]) {
    const id = rootTaskId(event.properties.sessionID)
    notifyTask(id, 'approval', t('tasks.notify.approval'), taskTitle(id))
  } else if (event.type === 'question.asked' && !st.questions[event.properties.id]) {
    const id = rootTaskId(event.properties.sessionID)
    notifyTask(id, 'question', t('tasks.notify.question'), taskTitle(id))
  }
  switch (event.type) {
    case 'todo.updated':
      useTasks.setState((s) => ({ todos: { ...s.todos, [event.properties.sessionID]: event.properties.todos } }))
      break
    case 'permission.asked':
      useTasks.setState((s) => ({ permissions: { ...s.permissions, [event.properties.id]: event.properties } }))
      maybeAutoConsider(event.properties)
      break
    case 'permission.replied':
      useTasks.setState((s) => {
        const permissions = { ...s.permissions }
        delete permissions[event.properties.requestID]
        const autoPending = { ...s.autoPending }
        delete autoPending[event.properties.requestID]
        return { permissions, autoPending }
      })
      break
    case 'question.asked':
      useTasks.setState((s) => ({
        questions: {
          ...s.questions,
          [event.properties.id]: {
            id: event.properties.id,
            sessionID: event.properties.sessionID,
            questions: event.properties.questions,
            tool: event.properties.tool
          }
        }
      }))
      break
    case 'question.replied':
    case 'question.rejected':
      useTasks.setState((s) => {
        const questions = { ...s.questions }
        delete questions[event.properties.requestID]
        return { questions }
      })
      break
    case 'session.idle':
      if (event.properties.sessionID === st.activeTaskId) scheduleDeliverablesRefresh(300)
      break
    case 'message.part.updated': {
      const part = event.properties.part
      if (
        part.type === 'tool' &&
        part.sessionID === st.activeTaskId &&
        part.state.status === 'completed' &&
        ['write', 'edit', 'bash', 'patch', 'apply_patch', 'multiedit'].includes(part.tool)
      ) {
        scheduleDeliverablesRefresh()
      }
      break
    }
    default:
      break
  }
}

/**
 * Quita de `useSessions.status` los estados de sesiones de OTROS servidores de Tareas (su stream ya
 * no está abierto). Las sesiones de Chat/Code (origen principal) no se tocan.
 */
function purgeForeignTasksStatus(): void {
  // F7-B14: ya no llega ningún evento de esos servidores: su historial cargado puede quedar obsoleto (y al
  // reconectar el mismo origen debe recargarse al reabrir la tarea). Las de Chat/Code (origen principal) no se tocan.
  useSessions.getState().invalidateLoaded((src) => src !== MAIN_SOURCE)
  const { status, sessionSource } = useSessions.getState()
  let changed = false
  const next: typeof status = {}
  for (const [id, run] of Object.entries(status)) {
    const src = sessionSource[id]
    if (src && src !== MAIN_SOURCE) {
      changed = true
      continue
    }
    next[id] = run
  }
  if (changed) useSessions.setState({ status: next })
}

/**
 * Conecta con el servidor de la carpeta (sandboxeado, o de Control total si así se eligió)
 * y abre su stream de eventos. `fullAccess` por defecto = preferencia guardada de la carpeta.
 */
export async function connectFolder(folder: string, fullAccess = fullAccessFor(folder)): Promise<void> {
  stopStream?.()
  stopStream = null
  // Ya no llegan eventos de los demás servidores de Tareas: sus estados `busy` quedarían congelados
  // (y mantendrían el Mac despierto). El estado de fondo lo da el monitor de main (`activity`).
  purgeForeignTasksStatus()
  syncActivity()
  useTasks.setState({
    folder,
    fullAccess,
    computerStatus: null,
    lastAction: null,
    conn: null,
    client: null,
    phase: 'starting',
    error: null,
    streaming: false,
    activeTaskId: null,
    todos: {},
    permissions: {},
    questions: {},
    deliverables: {},
    attachments: [],
    unseen: {},
    project: null,
    memory: null,
    networkBlocked: {},
    deleteGrant: null,
    folderSet: null,
    taskModel: null,
    taskVariant: null,
    sideChat: null
  })
  try {
    const conn = await cw('tasks:start', { folder, fullAccess })
    const now = useTasks.getState()
    if (now.folder !== folder || now.fullAccess !== fullAccess) return // el usuario cambió de carpeta/modo
    const client = makeClient(conn)
    rememberFolder(conn.folder)
    useSessions.getState().setDirectorySource(conn.folder, conn.baseUrl)
    useTasks.setState({ folder: conn.folder, conn, client, phase: 'ready' })
    void loadProjectAndMemory(conn.folder)
    void loadDeleteGrant(conn.folder)
    void loadFolderSet(conn.folder)
    if (conn.fullAccess) {
      void refreshComputerStatus()
      void syncKillState()
    }
    stopStream = startEventStream(client, handleEvent, {
      onOpen: () => {
        useTasks.setState({ streaming: true })
        void resync()
      },
      onError: () => useTasks.setState({ streaming: false })
    })
    await resync()
  } catch (err) {
    const now = useTasks.getState()
    // Preferencia local de Control total sin consentimiento registrado en main: volver a sandbox.
    if (fullAccess && now.folder === folder && errorMessage(err).includes(FULL_ACCESS_NOT_GRANTED)) {
      rememberFullAccess(folder, false)
      return connectFolder(folder, false)
    }
    if (now.folder === folder && now.fullAccess === fullAccess) useTasks.setState({ phase: 'error', error: errorMessage(err) })
  }
}

// ── Sesión de control del Mac (overlay + píldora del proceso principal) ──
let computerSessionKey = 'false||'

/** Activa/desactiva `computer:session` según haya tareas de Control total trabajando. */
function syncComputerSession(): void {
  const { conn, folder, questions } = useTasks.getState()
  const { status, sessions, sessionSource } = useSessions.getState()
  let label: string | undefined
  let sessionId: string | undefined
  let active = false
  if (conn?.fullAccess && folder) {
    for (const id of Object.keys(status)) {
      const sess = sessions[id]
      if (status[id] !== 'idle' && sess?.directory === folder && !sess.parentID && sessionSource[id] === conn.baseUrl) {
        active = true
        sessionId = id
        // Si la tarea espera una respuesta tuya (`question`), la píldora lo dice en vez del título.
        const asking = Object.values(questions).some((q) => rootTaskId(q.sessionID) === id)
        label = asking ? t('tasks.pill.asking', { app: APP_NAME }) : sess.title || undefined
        break
      }
    }
  }
  const key = `${active}|${sessionId ?? ''}|${label ?? ''}`
  if (key === computerSessionKey) return
  computerSessionKey = key
  cw('computer:session', active ? { active, label, sessionId } : { active }).catch(() => undefined)
}

useSessions.subscribe((s, prev) => {
  if (s.status !== prev.status) syncComputerSession()
})
useTasks.subscribe((s, prev) => {
  if (s.conn !== prev.conn || s.folder !== prev.folder || s.questions !== prev.questions) syncComputerSession()
})

// ── Mantener el Mac despierto (powerSaveBlocker en main) mientras haya tareas en curso ──
let keepAwakeActive = false

/**
 * true si alguna tarea del servidor actualmente conectado está corriendo o reintentando. Solo cuenta el
 * origen actual: el resto lo cubre el monitor de main, que hace el OR con esta señal.
 */
function anyTasksTaskRunning(): boolean {
  const conn = useTasks.getState().conn
  if (!conn) return false
  const { status, sessionSource } = useSessions.getState()
  for (const id of Object.keys(status)) {
    const st = status[id]
    if ((st === 'busy' || st === 'retry') && sessionSource[id] === conn.baseUrl) return true
  }
  return false
}

function syncKeepAwake(): void {
  const active = anyTasksTaskRunning()
  if (active === keepAwakeActive) return
  keepAwakeActive = active
  cw('tasks:keepAwakeActive', { active }).catch(() => undefined)
}

useSessions.subscribe((s, prev) => {
  if (s.status !== prev.status) syncKeepAwake()
})
useTasks.subscribe((s, prev) => {
  if (s.conn !== prev.conn) syncKeepAwake()
})

export function disconnect(): void {
  stopStream?.()
  stopStream = null
  purgeForeignTasksStatus()
  useTasks.setState({ conn: null, client: null, phase: 'idle', streaming: false })
}

/** Recarga lista de tareas, permisos pendientes y la tarea activa. */
export async function resync(): Promise<void> {
  const { client, folder, activeTaskId } = useTasks.getState()
  if (!client || !folder) return
  useTasks.setState({ listLoading: true })
  try {
    await useSessions.getState().loadSessions(client, folder, useTasks.getState().conn?.baseUrl)
    await syncRunStatus(client, folder)
    void migrateLegacyPinned()
    const perms = await client.permission.list({ directory: folder })
    const permissions: Record<string, PermissionRequest> = {}
    for (const p of perms.data ?? []) permissions[p.id] = p
    useTasks.setState({ permissions })
    const qs = await client.question.list({ directory: folder }).catch(() => ({ data: [] as QuestionRequest[] }))
    const questions: Record<string, QuestionRequest> = {}
    for (const q of qs.data ?? []) questions[q.id] = q
    useTasks.setState({ questions })
    if (activeTaskId) await loadTask(activeTaskId)
  } catch (err) {
    useTasks.setState({ error: errorMessage(err) })
  } finally {
    useTasks.setState({ listLoading: false })
  }
}

/**
 * Lee `session.status` del servidor y lo vuelca en `useSessions.status` (al conectar/reconectar hay
 * tareas que ya estaban trabajando y de las que no llegó ningún evento).
 */
async function syncRunStatus(client: OpencodeClient, folder: string): Promise<void> {
  const baseUrl = useTasks.getState().conn?.baseUrl
  if (!baseUrl) return
  const before = useSessions.getState().status
  const res = await client.session.status({ directory: folder }).catch(() => null)
  const data = res?.data
  if (!data) return
  // F7-B10: el ámbito incluye las entradas de `status` huérfanas de este servidor y excluye lo que cambió durante la petición.
  const { sessions, sessionSource, status } = useSessions.getState()
  const scope = unchangedSince(
    runStatusScope({ sessions, sessionSource, status }, folder, (src) => src === baseUrl),
    before,
    status
  )
  const next = reconcileRunStatus(status, data, scope)
  if (next) useSessions.setState({ status: next })
}

export async function loadTask(sessionID: string): Promise<void> {
  const { client, folder } = useTasks.getState()
  if (!client || !folder) return
  const sessions = useSessions.getState()
  try {
    await sessions.loadMessages(client, sessionID, folder)
    const todos = await client.session.todo({ sessionID, directory: folder })
    if (todos.data) useTasks.setState((s) => ({ todos: { ...s.todos, [sessionID]: todos.data ?? [] } }))
    const status = await client.session.status({ directory: folder })
    const st = status.data?.[sessionID]
    if (st) sessions.setStatus(sessionID, st.type === 'busy' || st.type === 'retry' ? st.type : 'idle')
  } catch (err) {
    sessions.setError(sessionID, errorMessage(err))
  }
  await refreshDeliverables(sessionID)
}

// ── Kill-switch (estado en el proceso principal) ──
function applyKillState(st: ComputerKillState): void {
  useTasks.setState({
    controlStoppedAt: st.stopped ? (st.stoppedAt ?? Date.now()) : null,
    shortcutUnavailable: !st.shortcutRegistered
  })
}

let killStateListening = false

/** Lee el kill-switch de main y se suscribe (una vez) a sus cambios, en cualquier vista. */
export async function syncKillState(): Promise<void> {
  if (!killStateListening) {
    killStateListening = true
    onTasks('computer:killState', applyKillState)
  }
  try {
    applyKillState(await cw('computer:state'))
  } catch {
    // Sin puente (p.ej. tests): nada que sincronizar.
  }
}

// ── Concesión por app ──

let accessRequestListening = false

/**
 * Se suscribe (una vez) a las tarjetas `request_access` del agente y a su resolución (también desde la
 * píldora: `computer:accessResolved` cierra la tarjeta de la ventana), y al estado de aprobación del
 * plan por tarea (`computer:planState`), en cualquier vista.
 */
export function syncAccessRequests(): void {
  if (accessRequestListening) return
  accessRequestListening = true
  // Ids con evento `planState` recibido durante la carga inicial: mandan sobre la lista cargada.
  const touched = new Set<string>()
  let loaded = false
  onTasks('computer:accessRequest', (req) => useTasks.setState({ accessRequest: req }))
  onTasks('computer:accessResolved', ({ id }) => {
    if (useTasks.getState().accessRequest?.id === id) useTasks.setState({ accessRequest: null })
  })
  onTasks('computer:planState', ({ sessionId, approved }) => {
    if (!loaded) touched.add(sessionId)
    useTasks.setState((s) => {
      if (!!s.approvedPlans[sessionId] === approved) return s
      const approvedPlans = { ...s.approvedPlans }
      if (approved) approvedPlans[sessionId] = true
      else delete approvedPlans[sessionId]
      return { approvedPlans }
    })
  })
  cw('computer:approvedPlans')
    .then((ids) => {
      useTasks.setState((s) => {
        const approvedPlans = { ...s.approvedPlans }
        for (const id of ids) if (!touched.has(id)) approvedPlans[id] = true
        return { approvedPlans }
      })
    })
    .catch(() => undefined)
    .finally(() => {
      loaded = true
    })
}

/** Carga la lista de apps concedidas/denegadas (pantalla de permisos). */
export async function loadGrants(): Promise<void> {
  try {
    useTasks.setState({ grants: await cw('computer:grants') })
  } catch {
    // sin puente: nada que cargar
  }
}

// ── Lote C: Modo auto (vía rápida desde `permission.asked` + estado para Ajustes/AutoModeChip) ──

/** true si `folder`/la raíz de `sessionID` tienen el Modo auto activo (maestro + carpeta o tarea). */
function isAutoActiveFor(folder: string, sessionID: string): boolean {
  const settings = useTasks.getState().autoMode?.settings
  if (!settings?.enabled) return false
  if (settings.folders.includes(folder)) return true
  return settings.tasks.includes(rootTaskId(sessionID))
}

/**
 * Vía rápida: ante un `permission.asked` con el Modo auto activo para esa carpeta/tarea, oculta la
 * tarjeta (`autoPending`) y le pide a main que la considere (`tasks:auto:consider`). Si no la
 * aprueba, la tarjeta vuelve a aparecer con normalidad.
 */
function maybeAutoConsider(perm: PermissionRequest): void {
  const { folder, conn } = useTasks.getState()
  if (!folder || !conn) return
  if (!isAutoActiveFor(folder, perm.sessionID)) return
  useTasks.setState((s) => ({ autoPending: { ...s.autoPending, [perm.id]: true } }))
  const clear = (): void =>
    useTasks.setState((s) => {
      if (!s.autoPending[perm.id]) return s
      const autoPending = { ...s.autoPending }
      delete autoPending[perm.id]
      return { autoPending }
    })
  cw('tasks:auto:consider', { folder, fullAccess: conn.fullAccess, requestId: perm.id })
    .then((r) => {
      if (!r.auto) clear()
    })
    .catch(() => clear())
}

/** Carga el estado del Modo auto (ajustes + registro) desde main. */
export async function loadAutoMode(): Promise<void> {
  try {
    useTasks.setState({ autoMode: await cw('tasks:auto:state') })
  } catch {
    // sin puente: se conserva null (equivale a apagado)
  }
}

let autoModeSynced = false

/** Suscripción única (cualquier vista) al aviso "Aprobado por el modo auto: …" + carga inicial. */
export function syncAutoMode(): void {
  if (autoModeSynced) return
  autoModeSynced = true
  onTasks('tasks:auto:approved', (rec) => {
    useTasks.setState((s) => ({
      autoMode: s.autoMode ? { ...s.autoMode, log: [...s.autoMode.log, rec] } : s.autoMode,
      autoApprovedNotice: rec
    }))
  })
  void loadAutoMode()
}

/** Cambia los ajustes del Modo auto (interruptor maestro, carpeta, tarea o lista de apps). */
export async function setAutoModeSettings(req: {
  enabled?: boolean
  folder?: { path: string; on: boolean }
  task?: { sessionId: string; on: boolean }
  viewApps?: string[]
}): Promise<void> {
  const autoMode = await cw('tasks:auto:set', req)
  useTasks.setState({ autoMode })
}

// Guarda del LRU de `messages`: tarea activa, Consulta lateral y sesiones con permiso/pregunta pendiente
// (el store añade su raíz e hijas). Se registra al importar este módulo.
useSessions.getState().addEvictionGuard(() => {
  const { activeTaskId, sideChat, permissions, questions } = useTasks.getState()
  const ids: string[] = []
  if (activeTaskId) ids.push(activeTaskId)
  if (sideChat) {
    ids.push(sideChat.taskId)
    if (sideChat.sessionId) ids.push(sideChat.sessionId)
  }
  for (const p of Object.values(permissions)) ids.push(p.sessionID)
  for (const q of Object.values(questions)) ids.push(q.sessionID)
  return ids
})

/**
 * Conteo combinado (para el badge del Dock): tareas raíz con resultado sin ver (terminaron) o que
 * esperan algo del usuario (permiso o pregunta pendiente), sin duplicar la misma raíz.
 */
export function selectTasksAttentionCount(s: Pick<TasksState, 'unseen' | 'permissions' | 'questions'>): number {
  const ids = new Set<string>(Object.keys(s.unseen))
  for (const p of Object.values(s.permissions)) ids.add(rootTaskId(p.sessionID))
  for (const q of Object.values(s.questions)) ids.add(rootTaskId(q.sessionID))
  return ids.size
}

/** Consulta `computer:status` (helper nativo + permisos de macOS). */
export async function refreshComputerStatus(): Promise<void> {
  useTasks.setState({ computerChecking: true })
  try {
    const status = await cw('computer:status')
    useTasks.setState({ computerStatus: status })
  } catch {
    useTasks.setState({ computerStatus: { helperOk: false, accessibility: false, screenRecording: false, screens: [] } })
  } finally {
    useTasks.setState({ computerChecking: false })
  }
}

// ── Estado nuevo del Lote B: actividad, carpetas, preferencias, política y modelo ──

let activitySynced = false
let viewingKey = ''

/** Avisa a main qué servidor se está mirando (no se notifica lo que el usuario ya ve). */
function reportViewing(): void {
  const { conn } = useTasks.getState()
  const key = conn ? `${conn.folder}|${conn.fullAccess}` : ''
  if (key === viewingKey) return
  viewingKey = key
  cw('tasks:viewing', conn ? { folder: conn.folder, fullAccess: conn.fullAccess } : { folder: null }).catch(() => undefined)
}

/**
 * Suscripción única a `tasks:activity` (tareas y servidores de todas las carpetas) + carga inicial de
 * actividad, metadatos de tareas, preferencias y política. También reporta `tasks:viewing` cada vez
 * que cambia la conexión. Idempotente: `connectFolder` la llama y puede llamarse desde cualquier vista.
 */
export function syncActivity(): void {
  if (activitySynced) return
  activitySynced = true
  onTasks('tasks:activity', (activity) => useTasks.setState({ activity }))
  cw('tasks:activity')
    .then((snap) => {
      // Un evento más reciente que la respuesta inicial manda.
      if ((useTasks.getState().activity?.at ?? 0) < snap.at) useTasks.setState({ activity: snap })
    })
    .catch(() => undefined)
  void loadTaskMetas()
  void loadTasksPrefs()
  void loadPolicy()
  syncAutoMode()
  useTasks.subscribe((s, prev) => {
    if (s.conn !== prev.conn) reportViewing()
  })
  reportViewing()
}

/** Carga carpeta principal, vinculadas y de confianza de `folder` (y si el servidor ya las aplicó). */
export async function loadFolderSet(folder: string): Promise<void> {
  try {
    const folderSet = await cw('tasks:folders:get', { folder })
    if (useTasks.getState().folder === folder) useTasks.setState({ folderSet })
  } catch {
    if (useTasks.getState().folder === folder) useTasks.setState({ folderSet: null })
  }
}

export async function loadTasksPrefs(): Promise<void> {
  try {
    useTasks.setState({ prefs: await cw('tasks:prefs:get') })
  } catch {
    // sin puente: se usan los valores por defecto
  }
}

export async function saveTasksPrefs(patch: Partial<TasksPrefs>): Promise<void> {
  const req: {
    autoArchiveDays?: number
    idleStopMinutes?: number
    stallWarnMinutes?: number
    maxServers?: number
    notify?: Partial<TasksPrefs['notify']>
  } = {}
  if (patch.autoArchiveDays !== undefined) req.autoArchiveDays = patch.autoArchiveDays
  if (patch.idleStopMinutes !== undefined) req.idleStopMinutes = patch.idleStopMinutes
  if (patch.stallWarnMinutes !== undefined) req.stallWarnMinutes = patch.stallWarnMinutes
  if (patch.maxServers !== undefined) req.maxServers = patch.maxServers
  if (patch.notify !== undefined) req.notify = patch.notify
  const prefs = await cw('tasks:prefs:set', req)
  useTasks.setState({ prefs })
}

export async function loadPolicy(): Promise<void> {
  try {
    useTasks.setState({ policy: await cw('tasks:policy') })
  } catch {
    // sin puente: sin política
  }
}

/** Modelo de la tarea: el elegido para ella o, si no hay, el configurado para el modo Tareas. */
export function currentTasksModel(): ModelRef {
  return useTasks.getState().taskModel ?? resolveModelForMode('tasks')
}

/** Esfuerzo (variante) elegido para la tarea; undefined = el predeterminado del modelo. */
export function currentTasksVariant(): string | undefined {
  return useTasks.getState().taskVariant ?? undefined
}

/**
 * Elige el modelo de la tarea y lo recuerda como modelo del modo Tareas (`modelsByMode.tasks`).
 * NUNCA toca `settings.defaultModel` (es el de Chat). Si cambia de modelo, se descarta el esfuerzo.
 */
export function setTaskModel(m: ModelRef): void {
  const cur = useTasks.getState().taskModel
  const changed = !cur || cur.providerID !== m.providerID || cur.modelID !== m.modelID
  useTasks.setState((s) => ({ taskModel: m, taskVariant: changed ? null : s.taskVariant }))
  try {
    const extras = useExtrasPrefs.getState()
    void extras.update({ modelsByMode: { ...extras.prefs.modelsByMode, tasks: m } }).catch(() => undefined)
  } catch {
    // sin puente "extras": el modelo vale solo para esta sesión de la app
  }
}

export function setTaskVariant(v: string | null): void {
  useTasks.setState({ taskVariant: v })
}

/** ¿La tarea está usando el Mac ahora? (Control total, corriendo y con una acción de hace < 15 s.) */
export function isUsingComputer(taskId: string): boolean {
  const { conn, lastAction } = useTasks.getState()
  if (!conn?.fullAccess || !lastAction) return false
  const run = useSessions.getState().status[taskId]
  return !!run && run !== 'idle' && Date.now() - lastAction.at < 15_000
}

/** ¿Hay un plan esperando la aprobación del usuario para esta tarea? */
export function isPlanPending(taskId: string): boolean {
  const req = useTasks.getState().accessRequest
  return !!req?.plan && req.sessionId === taskId
}
