/**
 * Estado del modo Cowork. Los mensajes/partes de las sesiones viven en el store genérico
 * `useSessions` (alimentado aquí con el stream SSE del servidor sandboxeado de la carpeta);
 * este store guarda lo específico: carpeta, conexión, todos, permisos y entregables.
 */
import { create } from 'zustand'
import { createOpencodeClient, type PermissionRequest, type Todo } from '@opencode-ai/sdk/v2/client'
import type { CoworkConnection, CoworkDeliverable, CoworkFolder } from '@shared/ipc-cowork'
import { errorMessage, startEventStream, type OcEvent, type OpencodeClient } from '../../../lib/opencode'
import { useSessions } from '../../../stores/sessions'
import { cw } from './bridge'

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
  deliverables: Record<string, CoworkDeliverable[]>
  listLoading: boolean

  set: (patch: Partial<CoworkState>) => void
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
  deliverables: {},
  listLoading: false,
  set: (patch) => set(patch)
}))

const LAST_FOLDER_KEY = 'cowork.lastFolder'
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

function handleEvent(event: OcEvent, directory: string): void {
  const st = useCowork.getState()
  if (!st.folder || directory !== st.folder) return
  useSessions.getState().applyEvent(event)
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

/** Conecta con el servidor sandboxeado de la carpeta y abre su stream de eventos. */
export async function connectFolder(folder: string): Promise<void> {
  stopStream?.()
  stopStream = null
  useCowork.setState({
    folder,
    conn: null,
    client: null,
    phase: 'starting',
    error: null,
    streaming: false,
    activeTaskId: null,
    todos: {},
    permissions: {},
    deliverables: {}
  })
  try {
    const conn = await cw('cowork:start', { folder })
    if (useCowork.getState().folder !== folder) return // el usuario cambió de carpeta
    const client = makeClient(conn)
    rememberFolder(conn.folder)
    useCowork.setState({ folder: conn.folder, conn, client, phase: 'ready' })
    stopStream = startEventStream(client, handleEvent, {
      onOpen: () => {
        useCowork.setState({ streaming: true })
        void resync()
      },
      onError: () => useCowork.setState({ streaming: false })
    })
    await resync()
  } catch (err) {
    if (useCowork.getState().folder === folder) useCowork.setState({ phase: 'error', error: errorMessage(err) })
  }
}

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
    await useSessions.getState().loadSessions(client, folder)
    const perms = await client.permission.list({ directory: folder })
    const permissions: Record<string, PermissionRequest> = {}
    for (const p of perms.data ?? []) permissions[p.id] = p
    useCowork.setState({ permissions })
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
