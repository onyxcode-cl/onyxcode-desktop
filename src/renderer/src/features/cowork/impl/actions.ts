/** Acciones del modo Cowork (carpetas, tareas, permisos). */
import type { ModelRef } from '@shared/types'
import { errorMessage } from '../../../lib/opencode'
import { useSessions } from '../../../stores/sessions'
import { cw } from './bridge'
import { connectFolder, disconnect, loadTask, rememberFolder, useCowork } from './store'

export const COWORK_AGENT = 'cowork'

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
  if (useCowork.getState().folder === folder && useCowork.getState().phase === 'ready') return
  await connectFolder(folder)
}

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
  await loadTask(sessionID)
}

function ctx(): { client: NonNullable<ReturnType<typeof useCowork.getState>['client']>; folder: string } {
  const { client, folder } = useCowork.getState()
  if (!client || !folder) throw new Error('El servidor de Cowork no está listo')
  return { client, folder }
}

/** Envía un mensaje; si no hay tarea activa, crea una nueva sesión con el agente `cowork`. */
export async function sendToTask(text: string, model: ModelRef): Promise<void> {
  const { client, folder } = ctx()
  const sessions = useSessions.getState()
  let sessionID = useCowork.getState().activeTaskId
  if (!sessionID) {
    const res = await client.session.create({
      directory: folder,
      agent: COWORK_AGENT,
      title: text.slice(0, 80),
      metadata: { mode: 'cowork' }
    })
    if (res.error || !res.data) throw new Error(errorMessage(res.error))
    sessions.upsertSession(res.data)
    sessionID = res.data.id
    const id = sessionID
    useSessions.setState((s) => ({ messages: { ...s.messages, [id]: s.messages[id] ?? [] } }))
    useCowork.setState({ activeTaskId: id })
  }
  sessions.setError(sessionID, null)
  sessions.setStatus(sessionID, 'busy')
  const res = await client.session.promptAsync({
    sessionID,
    directory: folder,
    agent: COWORK_AGENT,
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
