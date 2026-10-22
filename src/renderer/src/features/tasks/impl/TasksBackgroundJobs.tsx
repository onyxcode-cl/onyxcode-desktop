/** Banda de «Trabajos en segundo plano» de la tarea abierta (subagentes de fondo); no pinta nada si no hay. */
import { useTasks } from './store'
import { SessionsBackgroundJobs } from '../../code/impl/BackgroundJobsConnectors'
import { sdkDir } from './conn-paths'

export function TasksBackgroundJobs(): React.JSX.Element | null {
  const activeTaskId = useTasks((s) => s.activeTaskId)
  const folder = useTasks((s) => s.folder)
  const client = useTasks((s) => s.client)
  const permissions = useTasks((s) => s.permissions)
  const questions = useTasks((s) => s.questions)
  if (!activeTaskId || !folder) return null
  const pending = [...Object.values(permissions).map((p) => p.sessionID), ...Object.values(questions).map((q) => q.sessionID)]
  return <SessionsBackgroundJobs rootId={activeTaskId} directory={sdkDir(folder)} client={client} pendingSessionIds={pending} />
}
