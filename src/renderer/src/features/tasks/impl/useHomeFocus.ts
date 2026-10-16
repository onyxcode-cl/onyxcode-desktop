/** Datos del inicio de Tareas para retomar trabajo: tareas de la carpeta actual, separadas en «esperan al usuario» y «recientes». */
import { useMemo } from 'react'
import { useSessions } from '../../../stores/sessions'
import { selectSessionsForDirectory } from '../../../lib/session-reducer'
import { pickHomeFocus, type HomeFocus } from './home-focus'
import { sdkDirOf } from './path-map'
import { useTasks } from './store'
import { useTaskStatusOf } from './useTaskStatusOf'

export function useHomeFocus(): HomeFocus {
  const folder = useTasks((s) => s.folder)
  // Carpeta tal como la ve OpenCode (`session.directory`): en macOS es la propia carpeta; en Windows, la ruta del sandbox.
  const dirKey = useTasks((s) => (folder ? sdkDirOf(s.conn, folder) : ''))
  const sessions = useSessions((s) => s.sessions)
  const sessionSource = useSessions((s) => s.sessionSource)
  const directorySource = useSessions((s) => s.directorySource)
  const statusOf = useTaskStatusOf()
  const tasks = useMemo(
    () => (folder ? selectSessionsForDirectory({ sessions, sessionSource, directorySource }, dirKey) : []),
    [sessions, sessionSource, directorySource, folder, dirKey]
  )
  // Sin carpeta no hay tareas que mostrar (nunca se mezclan las de otras carpetas).
  return pickHomeFocus(tasks, statusOf)
}
