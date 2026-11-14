/** Trabajos del motor de Tareas, sin arrancar servidores ni aceptar conexiones o rutas SDK del renderer. */
import { t } from '@shared/i18n'
import { fetchEngineJobs, resumeEngineJob, stopEngineJob } from './engine-jobs'
import { IpcError } from './handle'
import type { TasksIpcContext, TasksSubmodule } from './tasks-handle'

export function registerTasksJobsHandlers(ctx: TasksIpcContext): TasksSubmodule {
  const { tasks, handle } = ctx
  const serverFor = (req: { folder: string; fullAccess?: boolean }) => {
    const folder = tasks.assertInsideApproved(req.folder)
    const server = tasks.liveServers().find((s) => s.folder === folder && s.fullAccess === (req.fullAccess === true))
    if (!server) throw new IpcError('NOT_READY', t('chat.server.notReady'))
    return server
  }
  handle('tasks:jobs:list', (req) => {
    const server = serverFor(req)
    return fetchEngineJobs(server, { sessionID: req.sessionID, directory: server.directory })
  })
  handle('tasks:jobs:stop', (req) => {
    const server = serverFor(req)
    return stopEngineJob(server, { sessionID: req.sessionID, jobId: req.jobId, directory: server.directory })
  })
  handle('tasks:jobs:resume', (req) => {
    const server = serverFor(req)
    return resumeEngineJob(server, { sessionID: req.sessionID, jobId: req.jobId, directory: server.directory })
  })
  return {}
}
