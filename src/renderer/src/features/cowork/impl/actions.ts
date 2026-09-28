/** Acciones del modo Cowork (carpetas, tareas, permisos). */
import type { ModelRef } from '@shared/types'
import { errorMessage } from '../../../lib/opencode'
import { useSessions } from '../../../stores/sessions'
import { cw } from './bridge'
import {
  clearUnseen,
  connectFolder,
  disconnect,
  fullAccessFor,
  loadTask,
  refreshComputerStatus,
  rememberFolder,
  rememberFullAccess,
  useCowork
} from './store'

export const COWORK_AGENT = 'cowork'
/** Agente de los servidores de acceso total (sin sandbox + control del Mac). */
export const COMPUTER_AGENT = 'computer'

/** Agente a usar según el servidor conectado. */
export function currentAgent(): string {
  return useCowork.getState().conn?.fullAccess ? COMPUTER_AGENT : COWORK_AGENT
}

export async function loadFolders(): Promise<void> {
  try {
    useCowork.setState({ folders: await cw('cowork:listFolders') })
  } catch (err) {
    useCowork.setState({ error: errorMessage(err) })
  }
}

/** Abre el diálogo nativo; si la carpeta ya está autorizada, conecta; si no, pide confirmación. */
export async function chooseFolder(): Promise<void> {
  const picked = await cw('cowork:pickFolder')
  if (!picked) return
  const { folders } = useCowork.getState()
  if (folders.some((f) => f.path === picked)) await selectFolder(picked)
  else useCowork.setState({ pendingApproval: picked })
}

export async function approvePending(): Promise<void> {
  const folder = useCowork.getState().pendingApproval
  if (!folder) return
  try {
    const approved = await cw('cowork:approveFolder', { folder })
    useCowork.setState({ pendingApproval: null })
    await loadFolders()
    await selectFolder(approved.path)
  } catch (err) {
    useCowork.setState({ pendingApproval: null, error: errorMessage(err) })
  }
}

export function cancelPending(): void {
  useCowork.setState({ pendingApproval: null })
}

export async function selectFolder(folder: string): Promise<void> {
  const st = useCowork.getState()
  if (st.folder === folder && st.phase === 'ready' && st.fullAccess === fullAccessFor(folder)) return
  await connectFolder(folder)
}

/**
 * Cambia el modo de acceso de la carpeta actual. Pasar a acceso total pide confirmación
 * (diálogo) salvo que `confirmed` sea true; volver a sandbox es inmediato.
 */
export async function setAccessMode(fullAccess: boolean, confirmed = false): Promise<void> {
  const { folder } = useCowork.getState()
  if (!folder) return
  if (fullAccess && !confirmed) {
    useCowork.setState({ pendingFullAccess: folder })
    return
  }
  useCowork.setState({ pendingFullAccess: null })
  rememberFullAccess(folder, fullAccess)
  await connectFolder(folder, fullAccess)
}

export function cancelFullAccess(): void {
  useCowork.setState({ pendingFullAccess: null })
}

export async function checkComputer(): Promise<void> {
  await refreshComputerStatus()
}

/** Abre los prompts de macOS / Ajustes › Privacidad y vuelve a comprobar. */
export async function requestComputerPermissions(): Promise<void> {
  await cw('computer:requestPermissions')
  await refreshComputerStatus()
}

/** Sesiones de la carpeta actual que están trabajando. */
function busySessionIds(): string[] {
  const { folder } = useCowork.getState()
  const { sessions, status } = useSessions.getState()
  return Object.keys(status).filter((id) => status[id] !== 'idle' && (!folder || sessions[id]?.directory === folder))
}

/** Aborta todas las tareas en curso de la carpeta (tras detener el control del Mac). */
export async function abortBusyTasks(): Promise<void> {
  const { client, folder, activeTaskId } = useCowork.getState()
  if (!client || !folder) return
  const ids = new Set(busySessionIds())
  if (activeTaskId) ids.add(activeTaskId)
  await Promise.all(
    [...ids].map((sessionID) => client.session.abort({ sessionID, directory: folder }).catch(() => undefined))
  )
}

/**
 * Botón "Detener": el proceso principal activa el kill-switch, aborta las sesiones de TODOS los
 * servidores de acceso total y mata los helpers (igual que ⌘⇧Esc y la píldora). El abort local es
 * solo redundancia por si main tardara.
 */
export async function stopComputerControl(): Promise<void> {
  useCowork.setState({ controlStoppedAt: Date.now() })
  await Promise.allSettled([cw('computer:stop'), abortBusyTasks()])
}

/** "Reanudar control": acción explícita del usuario tras una parada. */
export async function resumeComputerControl(): Promise<void> {
  await cw('computer:resume')
  useCowork.setState({ controlStoppedAt: null, lastAction: null })
}

export const CONTROL_STOPPED_SEND_ERROR =
  'El control del Mac está detenido. Pulsa «Reanudar control» para volver a darle el control al agente.'

export async function forgetFolder(folder: string): Promise<void> {
  try {
    await cw('cowork:removeFolder', { folder })
    if (useCowork.getState().folder === folder) {
      disconnect()
      rememberFolder(null)
      useCowork.setState({ folder: null, activeTaskId: null })
    }
    await loadFolders()
  } catch (err) {
    useCowork.setState({ error: errorMessage(err) })
  }
}

export function newTask(): void {
  useCowork.setState({ activeTaskId: null })
}

export async function openTask(sessionID: string): Promise<void> {
  useCowork.setState({ activeTaskId: sessionID })
  clearUnseen(sessionID)
  await loadTask(sessionID)
}

function ctx(): { client: NonNullable<ReturnType<typeof useCowork.getState>['client']>; folder: string } {
  const { client, folder } = useCowork.getState()
  if (!client || !folder) throw new Error('El servidor de Cowork no está listo')
  return { client, folder }
}

/** Diálogo nativo para adjuntar archivos: se copian a la carpeta y quedan listos para el próximo mensaje. */
export async function attachFiles(): Promise<void> {
  const { folder } = useCowork.getState()
  if (!folder) throw new Error('Elige primero una carpeta')
  const files = await cw('cowork:importFiles', { folder })
  if (files.length === 0) return
  useCowork.setState((s) => {
    const seen = new Set(s.attachments.map((a) => a.path))
    return { attachments: [...s.attachments, ...files.filter((f) => !seen.has(f.path))] }
  })
}

export function removeAttachment(path: string): void {
  useCowork.setState((s) => ({ attachments: s.attachments.filter((a) => a.path !== path) }))
}

/** Texto final del mensaje con la lista de adjuntos (rutas relativas a la carpeta). */
function withAttachments(text: string): string {
  const files = useCowork.getState().attachments
  if (files.length === 0) return text
  const list = files.map((f) => `- ${f.relPath}`).join('\n')
  return `${text}\n\nArchivos adjuntos (ya copiados en la carpeta de la tarea):\n${list}`
}

/** Envía un mensaje; si no hay tarea activa, crea una nueva sesión con el agente `cowork`. */
export async function sendToTask(rawText: string, model: ModelRef): Promise<void> {
  const { client, folder } = ctx()
  if (useCowork.getState().conn?.fullAccess === true) {
    // Tras una parada NO se reanuda solo: hace falta "Reanudar control" (estado en main).
    const st = await cw('computer:state').catch(() => null)
    const stopped = st ? st.stopped : !!useCowork.getState().controlStoppedAt
    useCowork.setState({ controlStoppedAt: stopped ? (st?.stoppedAt ?? Date.now()) : null })
    if (stopped) throw new Error(CONTROL_STOPPED_SEND_ERROR)
  }
  const text = withAttachments(rawText)
  useCowork.setState({ attachments: [], draft: '' })
  const sessions = useSessions.getState()
  let sessionID = useCowork.getState().activeTaskId
  if (!sessionID) {
    const res = await client.session.create({
      directory: folder,
      agent: currentAgent(),
      title: rawText.slice(0, 80),
      metadata: { mode: 'cowork', fullAccess: useCowork.getState().conn?.fullAccess === true }
    })
    if (res.error || !res.data) throw new Error(errorMessage(res.error))
    sessions.upsertSession(res.data)
    sessionID = res.data.id
    const id = sessionID
    useSessions.setState((s) => ({ messages: { ...s.messages, [id]: s.messages[id] ?? [] } }))
    useCowork.setState({ activeTaskId: id })
  }
  const fullAccess = useCowork.getState().conn?.fullAccess === true
  if (fullAccess) useCowork.setState({ lastAction: null })
  sessions.setError(sessionID, null)
  sessions.setStatus(sessionID, 'busy')
  const res = await client.session.promptAsync({
    sessionID,
    directory: folder,
    agent: fullAccess ? COMPUTER_AGENT : COWORK_AGENT,
    model: { providerID: model.providerID, modelID: model.modelID },
    parts: [{ type: 'text', text }]
  })
  if (res.error) {
    sessions.setStatus(sessionID, 'idle')
    sessions.setError(sessionID, errorMessage(res.error))
  }
}

export async function abortTask(): Promise<void> {
  const { activeTaskId } = useCowork.getState()
  if (!activeTaskId) return
  const { client, folder } = ctx()
  await client.session.abort({ sessionID: activeTaskId, directory: folder })
}

export async function replyPermission(requestID: string, reply: 'once' | 'always' | 'reject'): Promise<void> {
  const { client, folder } = ctx()
  const res = await client.permission.reply({ requestID, directory: folder, reply })
  if (res.error) throw new Error(errorMessage(res.error))
  useCowork.setState((s) => {
    const permissions = { ...s.permissions }
    delete permissions[requestID]
    return { permissions }
  })
}

export async function archiveTask(sessionID: string): Promise<void> {
  const { client, folder } = ctx()
  const res = await client.session.update({ sessionID, directory: folder, time: { archived: Date.now() } })
  if (res.error) throw new Error(errorMessage(res.error))
  if (res.data) useSessions.getState().upsertSession(res.data)
  if (useCowork.getState().activeTaskId === sessionID) useCowork.setState({ activeTaskId: null })
}

export async function reveal(path: string): Promise<void> {
  await cw('cowork:reveal', { path })
}

export async function openPath(path: string): Promise<void> {
  await cw('cowork:openPath', { path })
}
