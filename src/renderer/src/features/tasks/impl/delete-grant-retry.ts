/** Cambia el perfil real y reanuda la tarea raíz; nunca aprueba el comando contra el perfil antiguo. */
import type { PermissionRequest, ToolPart } from '@opencode-ai/sdk/v2/client'
import { t } from '@shared/i18n'
import { confirmInterruptRunning, openTask, replyPermission, sendToTask, setDeleteGrantAllowed, type DeleteGrantScope } from './actions'
import { sdkDir } from './conn-paths'
import { currentTasksModel, rootTaskId, useTasks } from './store'

let changing = false

export async function enableDeleteAndRetry(request: PermissionRequest | ToolPart, scope: DeleteGrantScope): Promise<void> {
  if (changing) return
  const { folder, conn } = scope
  const current = useTasks.getState()
  const { client } = current
  if (!folder || !conn || conn.fullAccess || !client || current.folder !== folder || current.conn !== conn)
    throw new Error(t('tasksComputer.delete.changed'))
  const taskId = rootTaskId(request.sessionID)
  const failedTool = 'type' in request && request.type === 'tool'
  changing = true
  try {
    if (!(await confirmInterruptRunning(taskId))) return
    const now = useTasks.getState()
    if (now.folder !== folder || now.conn !== conn || (failedTool ? now.activeTaskId !== taskId : !now.permissions[request.id]))
      throw new Error(t('tasksComputer.delete.changed'))
    // Cierra la pregunta antigua sin conceder «once» ni «always». El servidor nuevo tendrá otro perfil.
    if (!failedTool) await replyPermission(request.id, 'reject', t('tasksComputer.delete.enableRetry'), true)
    for (const sessionID of new Set([request.sessionID, taskId])) {
      const res = await client.session.abort({ sessionID, directory: sdkDir(folder) })
      if (res.error) throw new Error(t('tasksComputer.delete.changed'))
    }
    const stopped = useTasks.getState()
    if (stopped.folder !== folder || stopped.conn !== conn || (failedTool && stopped.activeTaskId !== taskId))
      throw new Error(t('tasksComputer.delete.changed'))
    await setDeleteGrantAllowed(true, scope)
    const restarted = useTasks.getState()
    if (restarted.folder !== folder || restarted.conn?.fullAccess || restarted.phase !== 'ready')
      throw new Error(t('tasksComputer.delete.restartError'))
    await openTask(taskId)
    if (useTasks.getState().folder !== folder || useTasks.getState().activeTaskId !== taskId)
      throw new Error(t('tasksComputer.delete.changed'))
    await sendToTask(t('tasksComputer.delete.retry'), currentTasksModel())
  } finally {
    changing = false
  }
}
