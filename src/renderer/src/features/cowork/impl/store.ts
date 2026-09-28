/**
 * Estado del modo Cowork. Los mensajes/partes de las sesiones viven en el store genérico
 * `useSessions` (alimentado aquí con el stream SSE del servidor sandboxeado de la carpeta);
 * este store guarda lo específico: carpeta, conexión, todos, permisos y entregables.
 */
import { create } from 'zustand'
import { createOpencodeClient, type PermissionRequest, type QuestionRequest, type Todo } from '@opencode-ai/sdk/v2/client'
import {
  FULL_ACCESS_NOT_GRANTED,
  type ComputerActionEvent,
  type ComputerKillState,
  type ComputerStatus,
  type CoworkConnection,
  type CoworkDeliverable,
  type CoworkFolder,
  type CoworkMemory,
  type CoworkProject
} from '@shared/ipc-cowork'
import { errorMessage, startEventStream, type OcEvent, type OpencodeClient } from '../../../lib/opencode'
import { useSessions } from '../../../stores/sessions'
import { useUi } from '../../../stores/ui'
import { cw, onCowork } from './bridge'

export type CoworkServerPhase = 'idle' | 'starting' | 'ready' | 'error'

interface CoworkState {
  folders: CoworkFolder[]
  folder: string | null
  conn: CoworkConnection | null
  client: OpencodeClient | null
  phase: CoworkServerPhase
  error: string | null
  streaming: boolean
  activeTaskId: string | null
  /** Carpeta elegida pendiente de confirmación ("¿Permitir Cowork en…?"). */
  pendingApproval: string | null
  todos: Record<string, Todo[]>
  permissions: Record<string, PermissionRequest>
  /** Preguntas estructuradas pendientes (herramienta `question`), por id de solicitud. */
  questions: Record<string, QuestionRequest>
  deliverables: Record<string, CoworkDeliverable[]>
  listLoading: boolean
  /** Modo de acceso solicitado para la carpeta actual (persistido por carpeta). */
  fullAccess: boolean
  /** Carpeta cuyo cambio a "Acceso total" espera confirmación. */
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
  attachments: CoworkDeliverable[]
  /** Panel derecho (Plan / Entregables / Actividad) visible. */
  panelOpen: boolean
  /** Ids de tareas cuyo resultado aún no se ha visto (terminaron en segundo plano). */
  unseen: Record<string, true>
  /** Ids de tareas fijadas ("Pin"), persistido en localStorage (no hay campo equivalente en el SDK). */
  pinned: Record<string, true>
  /** Proyecto (nombre + instrucciones) de la carpeta actual. */
  project: CoworkProject | null
  /** Memoria (`.lapis/memoria.md`) de la carpeta actual. */
  memory: CoworkMemory | null
  /** Panel "Proyecto y memoria" visible. */
  projectPanelOpen: boolean

  set: (patch: Partial<CoworkState>) => void
}

const PINNED_KEY = 'cowork.pinned'

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

const PANEL_KEY = 'cowork.panelOpen'

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
  useCowork.setState({ panelOpen: open })
}

export const useCowork = create<CoworkState>((set) => ({
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
  set: (patch) => set(patch)
}))

export function setProjectPanelOpen(open: boolean): void {
  useCowork.setState({ projectPanelOpen: open })
}

/** Carga proyecto + memoria de la carpeta actual (no bloquea la conexión si falla). */
export async function loadProjectAndMemory(folder: string): Promise<void> {
  try {
    const [project, memory] = await Promise.all([cw('cowork:project:get', { folder }), cw('cowork:memory:get', { folder })])
    if (useCowork.getState().folder === folder) useCowork.setState({ project, memory })
  } catch {
    if (useCowork.getState().folder === folder) useCowork.setState({ project: null, memory: null })
  }
}

export async function saveProject(patch: { name?: string; instructions?: string }): Promise<void> {
  const { folder } = useCowork.getState()
  if (!folder) return
  const project = await cw('cowork:project:save', { folder, ...patch })
  if (useCowork.getState().folder === folder) useCowork.setState({ project })
}

export async function saveMemoryNotes(content: string): Promise<void> {
  const { folder } = useCowork.getState()
  if (!folder) return
  const memory = await cw('cowork:memory:save', { folder, content })
  if (useCowork.getState().folder === folder) useCowork.setState({ memory })
}

export async function deleteMemoryNotes(): Promise<void> {
  const { folder } = useCowork.getState()
  if (!folder) return
  const memory = await cw('cowork:memory:delete', { folder })
  if (useCowork.getState().folder === folder) useCowork.setState({ memory })
}

/** Fija/desfija una tarea en la barra lateral (persistido; no depende del servidor). */
export function togglePinned(sessionID: string): void {
  const current = useCowork.getState().pinned
  const pinned = { ...current }
  if (pinned[sessionID]) delete pinned[sessionID]
  else pinned[sessionID] = true
  writePinned(pinned)
  useCowork.setState({ pinned })
}

export function isPinned(sessionID: string): boolean {
  return !!useCowork.getState().pinned[sessionID]
}

/** Marca una tarea como no leída a propósito (acción manual, además del "unseen" automático). */
export function markUnread(sessionID: string): void {
  useCowork.setState((s) => ({ unseen: { ...s.unseen, [sessionID]: true } }))
}

const LAST_FOLDER_KEY = 'cowork.lastFolder'
const FULL_ACCESS_KEY = 'cowork.fullAccess'
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

/** ¿El usuario eligió "Acceso total + control del Mac" para esta carpeta? */
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

export function makeClient(conn: CoworkConnection): OpencodeClient {
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
  const { folder, activeTaskId } = useCowork.getState()
  const id = sessionID ?? activeTaskId
  if (!folder || !id) return
  const session = useSessions.getState().sessions[id]
  if (!session) return
  try {
    // Pequeño margen por diferencias de reloj/mtime.
    const files = await cw('cowork:deliverables', { folder, since: session.time.created - 2000 })
    useCowork.setState((s) => ({ deliverables: { ...s.deliverables, [id]: files } }))
  } catch {
    // ignorar: carpeta quizá movida
  }
}

/** Notificación nativa (solo si la ventana no tiene el foco). Clic ⇒ abre la tarea. */
function notifyTask(sessionID: string, title: string, body: string): void {
  if (typeof Notification === 'undefined' || document.hasFocus()) return
  try {
    const n = new Notification(title, { body, silent: false })
    n.onclick = () => {
      window.focus()
      useUi.getState().setMode('cowork')
      useCowork.setState({ activeTaskId: sessionID })
      void loadTask(sessionID)
      clearUnseen(sessionID)
    }
  } catch {
    // Notificaciones no disponibles
  }
}

function rootTaskId(sessionID: string): string {
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
  return useSessions.getState().sessions[sessionID]?.title || 'Tarea de Cowork'
}

export function clearUnseen(sessionID: string): void {
  if (!useCowork.getState().unseen[sessionID]) return
  useCowork.setState((s) => {
    const unseen = { ...s.unseen }
    delete unseen[sessionID]
    return { unseen }
  })
}

function handleEvent(event: OcEvent, directory: string): void {
  const st = useCowork.getState()
  if (!st.folder || directory !== st.folder || !st.conn) return
  const prevRun =
    event.type === 'session.idle' || event.type === 'session.status'
      ? useSessions.getState().status[event.properties.sessionID]
      : undefined
  // Origen = servidor de esta carpeta/modo (no mezclar con sesiones de Code/Chat, B2).
  useSessions.getState().applyEvent(event, st.conn.baseUrl)
  // Avisos: tarea terminada / necesita aprobación / error (solo tareas raíz).
  if (event.type === 'session.idle' || (event.type === 'session.status' && event.properties.status.type === 'idle')) {
    const id = event.properties.sessionID
    const isRoot = !useSessions.getState().sessions[id]?.parentID
    if (isRoot && prevRun && prevRun !== 'idle') {
      if (id !== st.activeTaskId || !document.hasFocus()) {
        useCowork.setState((s) => ({ unseen: { ...s.unseen, [id]: true } }))
      }
      const failed = useSessions.getState().errors[id]
      notifyTask(id, failed ? 'La tarea terminó con un error' : 'Tarea terminada', taskTitle(id))
    }
  } else if (event.type === 'permission.asked' && !st.permissions[event.properties.id]) {
    const id = rootTaskId(event.properties.sessionID)
    notifyTask(id, 'Cowork necesita tu aprobación', taskTitle(id))
  } else if (event.type === 'question.asked' && !st.questions[event.properties.id]) {
    const id = rootTaskId(event.properties.sessionID)
    notifyTask(id, 'Cowork tiene una pregunta para ti', taskTitle(id))
  }
  switch (event.type) {
    case 'todo.updated':
      useCowork.setState((s) => ({ todos: { ...s.todos, [event.properties.sessionID]: event.properties.todos } }))
      break
    case 'permission.asked':
      useCowork.setState((s) => ({ permissions: { ...s.permissions, [event.properties.id]: event.properties } }))
      break
    case 'permission.replied':
      useCowork.setState((s) => {
        const permissions = { ...s.permissions }
        delete permissions[event.properties.requestID]
        return { permissions }
      })
      break
    case 'question.asked':
      useCowork.setState((s) => ({
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
      useCowork.setState((s) => {
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
 * Conecta con el servidor de la carpeta (sandboxeado, o de acceso total si así se eligió)
 * y abre su stream de eventos. `fullAccess` por defecto = preferencia guardada de la carpeta.
 */
export async function connectFolder(folder: string, fullAccess = fullAccessFor(folder)): Promise<void> {
  stopStream?.()
  stopStream = null
  useCowork.setState({
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
    memory: null
  })
  try {
    const conn = await cw('cowork:start', { folder, fullAccess })
    const now = useCowork.getState()
    if (now.folder !== folder || now.fullAccess !== fullAccess) return // el usuario cambió de carpeta/modo
    const client = makeClient(conn)
    rememberFolder(conn.folder)
    useSessions.getState().setDirectorySource(conn.folder, conn.baseUrl)
    useCowork.setState({ folder: conn.folder, conn, client, phase: 'ready' })
    void loadProjectAndMemory(conn.folder)
    if (conn.fullAccess) {
      void refreshComputerStatus()
      void syncKillState()
    }
    stopStream = startEventStream(client, handleEvent, {
      onOpen: () => {
        useCowork.setState({ streaming: true })
        void resync()
      },
      onError: () => useCowork.setState({ streaming: false })
    })
    await resync()
  } catch (err) {
    const now = useCowork.getState()
    // Preferencia local de acceso total sin consentimiento registrado en main: volver a sandbox.
    if (fullAccess && now.folder === folder && errorMessage(err).includes(FULL_ACCESS_NOT_GRANTED)) {
      rememberFullAccess(folder, false)
      return connectFolder(folder, false)
    }
    if (now.folder === folder && now.fullAccess === fullAccess) useCowork.setState({ phase: 'error', error: errorMessage(err) })
  }
}

// ── Sesión de control del Mac (overlay + píldora del proceso principal) ──
let computerSessionActive = false

/** Activa/desactiva `computer:session` según haya tareas de acceso total trabajando. */
function syncComputerSession(): void {
  const { conn, folder } = useCowork.getState()
  const { status, sessions, sessionSource } = useSessions.getState()
  let label: string | undefined
  let active = false
  if (conn?.fullAccess && folder) {
    for (const id of Object.keys(status)) {
      const sess = sessions[id]
      if (status[id] !== 'idle' && sess?.directory === folder && !sess.parentID && sessionSource[id] === conn.baseUrl) {
        active = true
        label = sess.title || undefined
        break
      }
    }
  }
  if (active === computerSessionActive) return
  computerSessionActive = active
  cw('computer:session', active ? { active, label } : { active }).catch(() => undefined)
}

useSessions.subscribe((s, prev) => {
  if (s.status !== prev.status) syncComputerSession()
})
useCowork.subscribe((s, prev) => {
  if (s.conn !== prev.conn || s.folder !== prev.folder) syncComputerSession()
})

// ── Mantener el Mac despierto (powerSaveBlocker en main) mientras haya tareas en curso ──
let keepAwakeActive = false

/** true si alguna tarea (en cualquier carpeta de Cowork conocida) está corriendo o reintentando. */
function anyCoworkTaskRunning(): boolean {
  const { folders } = useCowork.getState()
  if (folders.length === 0) return false
  const known = new Set(folders.map((f) => f.path))
  const { status, sessions } = useSessions.getState()
  for (const id of Object.keys(status)) {
    const st = status[id]
    if ((st === 'busy' || st === 'retry') && known.has(sessions[id]?.directory ?? '')) return true
  }
  return false
}

function syncKeepAwake(): void {
  const active = anyCoworkTaskRunning()
  if (active === keepAwakeActive) return
  keepAwakeActive = active
  cw('cowork:keepAwakeActive', { active }).catch(() => undefined)
}

useSessions.subscribe((s, prev) => {
  if (s.status !== prev.status) syncKeepAwake()
})
useCowork.subscribe((s, prev) => {
  if (s.folders !== prev.folders) syncKeepAwake()
})

export function disconnect(): void {
  stopStream?.()
  stopStream = null
  useCowork.setState({ conn: null, client: null, phase: 'idle', streaming: false })
}

/** Recarga lista de tareas, permisos pendientes y la tarea activa. */
export async function resync(): Promise<void> {
  const { client, folder, activeTaskId } = useCowork.getState()
  if (!client || !folder) return
  useCowork.setState({ listLoading: true })
  try {
    await useSessions.getState().loadSessions(client, folder, useCowork.getState().conn?.baseUrl)
    const perms = await client.permission.list({ directory: folder })
    const permissions: Record<string, PermissionRequest> = {}
    for (const p of perms.data ?? []) permissions[p.id] = p
    useCowork.setState({ permissions })
    const qs = await client.question.list({ directory: folder }).catch(() => ({ data: [] as QuestionRequest[] }))
    const questions: Record<string, QuestionRequest> = {}
    for (const q of qs.data ?? []) questions[q.id] = q
    useCowork.setState({ questions })
    if (activeTaskId) await loadTask(activeTaskId)
  } catch (err) {
    useCowork.setState({ error: errorMessage(err) })
  } finally {
    useCowork.setState({ listLoading: false })
  }
}

export async function loadTask(sessionID: string): Promise<void> {
  const { client, folder } = useCowork.getState()
  if (!client || !folder) return
  const sessions = useSessions.getState()
  try {
    await sessions.loadMessages(client, sessionID, folder)
    const todos = await client.session.todo({ sessionID, directory: folder })
    if (todos.data) useCowork.setState((s) => ({ todos: { ...s.todos, [sessionID]: todos.data ?? [] } }))
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
  useCowork.setState({
    controlStoppedAt: st.stopped ? (st.stoppedAt ?? Date.now()) : null,
    shortcutUnavailable: !st.shortcutRegistered
  })
}

let killStateListening = false

/** Lee el kill-switch de main y se suscribe (una vez) a sus cambios, en cualquier vista. */
export async function syncKillState(): Promise<void> {
  if (!killStateListening) {
    killStateListening = true
    onCowork('computer:killState', applyKillState)
  }
  try {
    applyKillState(await cw('computer:state'))
  } catch {
    // Sin puente (p.ej. tests): nada que sincronizar.
  }
}

/** Consulta `computer:status` (helper nativo + permisos de macOS). */
export async function refreshComputerStatus(): Promise<void> {
  useCowork.setState({ computerChecking: true })
  try {
    const status = await cw('computer:status')
    useCowork.setState({ computerStatus: status })
  } catch {
    useCowork.setState({ computerStatus: { helperOk: false, accessibility: false, screenRecording: false, screens: [] } })
  } finally {
    useCowork.setState({ computerChecking: false })
  }
}
