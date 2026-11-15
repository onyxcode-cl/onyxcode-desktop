import { deferWorkingChange } from '../../../lib/working-change'
import { useSessions } from '../../../stores/sessions'
import { useTasks } from './store'
import { useUnified } from './unified'

/** Mismo estado y misma acción que Detener en el compositor de Overdrive. */
export function deferTaskChange(apply: () => void | Promise<void>, unchanged = false): boolean {
  const { activeTaskId: id, conn, folder } = useTasks.getState()
  const current = (): boolean => {
    const s = useTasks.getState()
    return s.activeTaskId === id && s.conn === conn && s.folder === folder
  }
  return deferWorkingChange(
    {
      busy: () => !!id && (useSessions.getState().status[id] ?? 'idle') !== 'idle',
      current,
      stop: async () => {
        // El store también usa esta guardia: cargar las acciones aquí evita un ciclo store → acciones → store al iniciar.
        const { abortTask, stopComputerControl, stopIsolatedTask } = await import('./actions')
        if (!current()) return
        return conn?.fullAccess ? stopComputerControl() : useUnified.getState().on ? stopIsolatedTask() : abortTask()
      },
      subscribe: (listener) => {
        const offSessions = useSessions.subscribe(listener)
        const offTasks = useTasks.subscribe(listener)
        return () => {
          offSessions()
          offTasks()
        }
      },
      onError: (error) => useTasks.setState({ error })
    },
    apply,
    unchanged
  )
}
