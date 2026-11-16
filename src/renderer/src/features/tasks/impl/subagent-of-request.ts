import { usageOfMessages } from '../../code/impl/helpers-board'
import { useProviders } from '../../../stores/providers'
import { useT } from '../../../lib/i18n'
/** Quién pide un permiso o hace una pregunta en Tareas: la tarea o un ayudante (subagente) suyo. Solo lectura de los almacenes. */
import { isChildRequest, subagentNameOf } from '../../code/impl/child-sessions'
import { useSessions } from '../../../stores/sessions'
import { useTasks } from './store'

export function useTaskSubagentOfRequest(sessionID: string): { child: boolean; name: string; model: string | null } {
  const activeTaskId = useTasks((s) => s.activeTaskId)
  const t = useT()
  const child = useSessions((s) => isChildRequest(s.sessions, sessionID, activeTaskId))
  const name = useSessions((s) => (child ? subagentNameOf(s.sessions, s.messages, sessionID, t) : ''))
  const ref = useSessions((s) => (child ? usageOfMessages(s.messages[sessionID]).model : null))
  const providers = useProviders((s) => s.providers)
  const slash = ref?.indexOf('/') ?? -1
  const model = ref ? (providers.find((p) => p.id === ref.slice(0, slash))?.models[ref.slice(slash + 1)]?.name ?? ref) : null
  return { child, name, model }
}
