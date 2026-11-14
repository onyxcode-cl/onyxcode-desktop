/** Una sola observación de trabajos por tarea, compartida por la tarjeta y sus indicadores con el panel cerrado. */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTasks } from './store'
import { BackgroundJobs } from '../../code/impl/BackgroundJobs'
import { useSessionsJobsData } from '../../code/impl/BackgroundJobsConnectors'
import { sdkDir } from './conn-paths'

const TasksJobsContext = createContext<
  | (ReturnType<typeof useSessionsJobsData> & {
      focusRequest: number
      requestFocus: () => void
    })
  | null
>(null)

export function TasksBackgroundJobsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const activeTaskId = useTasks((s) => s.activeTaskId)
  const folder = useTasks((s) => s.folder)
  const client = useTasks((s) => s.client)
  const fullAccess = useTasks((s) => s.conn?.fullAccess === true)
  const permissions = useTasks((s) => s.permissions)
  const questions = useTasks((s) => s.questions)
  const pending = useMemo(
    () => [...Object.values(permissions).map((p) => p.sessionID), ...Object.values(questions).map((q) => q.sessionID)],
    [permissions, questions]
  )
  const data = useSessionsJobsData({
    rootId: activeTaskId,
    directory: folder ? sdkDir(folder) : '',
    taskFolder: folder ?? undefined,
    fullAccess,
    client,
    pendingSessionIds: pending,
    engineSource: 'tasks',
    includeForeground: true
  })
  const [focusRequest, setFocusRequest] = useState(0)
  return (
    <TasksJobsContext.Provider value={{ ...data, focusRequest, requestFocus: () => setFocusRequest((n) => n + 1) }}>
      {children}
    </TasksJobsContext.Provider>
  )
}

export function useTasksBackgroundJobs() {
  return useContext(TasksJobsContext)
}

/** La banda sobre el compositor se sustituye por esta tarjeta del panel de progreso. */
export function TasksBackgroundJobs(): React.JSX.Element | null {
  const data = useTasksBackgroundJobs()
  const ref = useRef<HTMLDivElement>(null)
  const focusRequest = data?.focusRequest ?? 0
  useEffect(() => {
    if (!focusRequest) return
    ref.current?.scrollIntoView?.({ block: 'nearest' })
    ref.current?.focus({ preventScroll: true })
  }, [focusRequest])
  if (!data) return null
  return (
    <div ref={ref} tabIndex={-1} data-testid="tasks-summary-jobs" className="outline-none">
      <BackgroundJobs
        layout="card"
        view={data.view}
        onCancel={data.abort}
        engineJobs={data.engine.rows}
        onStopEngineJob={data.engine.stop}
        onResumeEngineJob={data.engine.resume}
        onLoadConversation={data.onLoadConversation}
        conversationVersion={data.conversationVersion}
      />
    </div>
  )
}
