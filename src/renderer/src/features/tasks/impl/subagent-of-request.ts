/** Quién pide un permiso o hace una pregunta en Tareas: la tarea o un ayudante (subagente) suyo. Solo lectura de los almacenes. */
import { isChildRequest, subagentNameOf } from '../../code/impl/child-sessions'
import { useSessions } from '../../../stores/sessions'
import { useTasks } from './store'

export function useTaskSubagentOfRequest(sessionID: string): { child: boolean; name: string } {
  const activeTaskId = useTasks((s) => s.activeTaskId)
  const child = useSessions((s) => isChildRequest(s.sessions, sessionID, activeTaskId))
  const name = useSessions((s) => (child ? subagentNameOf(s.sessions, s.messages, sessionID) : ''))
  return { child, name }
}
