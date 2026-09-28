/** Acciones del modo Cowork (carpetas, tareas, permisos). */
import type { ModelRef } from '@shared/types'
import { errorMessage } from '../../../lib/opencode'
import { useSessions } from '../../../stores/sessions'
import { useSettings } from '../../../stores/settings'
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
  // El consentimiento lo registra main (cowork:start {fullAccess} lo exige); volver a sandbox
  // lo retira y detiene el servidor sin sandbox.
  try {
    if (fullAccess) await cw('cowork:grantFullAccess', { folder })
    else await cw('cowork:revokeFullAccess', { folder })
  } catch (err) {
    useCowork.setState({ error: errorMessage(err) })
    if (fullAccess) return
  }
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

/**
 * Instrucciones globales de Cowork (Ajustes) + instrucciones del proyecto (carpeta) + memoria
 * guardada (`.lapis/memoria.md`), combinadas como `system` extra del prompt (item 1: proyectos,
 * instrucciones y memoria). `undefined` si no hay nada que añadir.
 */
function buildSystemPrompt(): string | undefined {
  const { project, memory } = useCowork.getState()
  const globalInstructions = useSettings.getState().settings.coworkGlobalInstructions?.trim()
  const parts: string[] = []
  if (globalInstructions) parts.push(`Instrucciones generales de Cowork (todas las tareas):\n${globalInstructions}`)
  const projectInstructions = project?.instructions?.trim()
  if (projectInstructions) parts.push(`Instrucciones del proyecto "${project?.name}":\n${projectInstructions}`)
  const memoryContent = memory?.content?.trim()
  if (memoryContent) parts.push(`Memoria guardada de este proyecto (.lapis/memoria.md):\n${memoryContent}`)
  return parts.length > 0 ? parts.join('\n\n---\n\n') : undefined
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
    system: buildSystemPrompt(),
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

/** Responde una pregunta estructurada (una respuesta -array de labels seleccionados o texto libre- por pregunta). */
export async function replyQuestion(requestID: string, answers: string[][]): Promise<void> {
  const { client, folder } = ctx()
  const res = await client.question.reply({ requestID, directory: folder, answers })
  if (res.error) throw new Error(errorMessage(res.error))
  useCowork.setState((s) => {
    const questions = { ...s.questions }
    delete questions[requestID]
    return { questions }
  })
}

export async function rejectQuestion(requestID: string): Promise<void> {
  const { client, folder } = ctx()
  const res = await client.question.reject({ requestID, directory: folder })
  if (res.error) throw new Error(errorMessage(res.error))
  useCowork.setState((s) => {
    const questions = { ...s.questions }
    delete questions[requestID]
    return { questions }
  })
}

export async function archiveTask(sessionID: string): Promise<void> {
  const { client, folder } = ctx()
  const res = await client.session.update({ sessionID, directory: folder, time: { archived: Date.now() } })
  if (res.error) throw new Error(errorMessage(res.error))
  if (res.data) useSessions.getState().upsertSession(res.data)
  if (useCowork.getState().activeTaskId === sessionID) useCowork.setState({ activeTaskId: null })
}

/** Renombra una tarea (título mostrado en la lista; no cambia el prompt original). */
export async function renameTask(sessionID: string, title: string): Promise<void> {
  const { client, folder } = ctx()
  const trimmed = title.trim()
  if (!trimmed) return
  const res = await client.session.update({ sessionID, directory: folder, title: trimmed })
  if (res.error) throw new Error(errorMessage(res.error))
  if (res.data) useSessions.getState().upsertSession(res.data)
}

/** Borra una tarea (y su historial) de forma permanente. */
export async function deleteTask(sessionID: string): Promise<void> {
  const { client, folder } = ctx()
  const res = await client.session.delete({ sessionID, directory: folder })
  if (res.error) throw new Error(errorMessage(res.error))
  useSessions.setState((s) => {
    const sessions = { ...s.sessions }
    const messages = { ...s.messages }
    delete sessions[sessionID]
    delete messages[sessionID]
    return { sessions, messages }
  })
  if (useCowork.getState().activeTaskId === sessionID) useCowork.setState({ activeTaskId: null })
}

/**
 * "Programar esta tarea": abre el editor de rutinas (modo Rutinas) prellenado con la
 * instrucción original, la carpeta, el modo cowork y el modelo, enlazando la rutina a esta
 * tarea (`originSessionId`) para poder mostrar sus ejecuciones en el panel de la tarea.
 */
export async function scheduleActiveTask(): Promise<void> {
  const { activeTaskId, folder } = useCowork.getState()
  if (!activeTaskId || !folder) return
  const entries = useSessions.getState().messages[activeTaskId] ?? []
  const firstUser = entries.find((e) => e.info.role === 'user')
  const firstUserParts = firstUser?.parts ?? []
  const raw = firstUserParts
    .filter((p): p is Extract<(typeof firstUserParts)[number], { type: 'text' }> => p.type === 'text' && !p.synthetic)
    .map((p) => p.text)
    .join('\n')
  const markerIdx = raw.indexOf('\n\nArchivos adjuntos (ya copiados en la carpeta de la tarea):\n')
  const prompt = (markerIdx >= 0 ? raw.slice(0, markerIdx) : raw).trim()
  const title = useSessions.getState().sessions[activeTaskId]?.title || 'Tarea programada'
  const model = useSettings.getState().settings.defaultModel
  const { openEditor } = await import('../../routines/impl/store')
  const { useUi } = await import('../../../stores/ui')
  openEditor(
    {
      name: title.slice(0, 200),
      prompt: prompt || title,
      mode: 'cowork',
      folder,
      model,
      schedule: { kind: 'daily', time: '09:00' },
      enabled: true,
      originSessionId: activeTaskId
    },
    'Repite esta tarea con la programación que elijas.'
  )
  useUi.getState().setMode('routines')
}

export async function reveal(path: string): Promise<void> {
  await cw('cowork:reveal', { path })
}

export async function openPath(path: string): Promise<void> {
  await cw('cowork:openPath', { path })
}
