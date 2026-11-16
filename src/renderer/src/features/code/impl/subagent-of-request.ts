import { usageOfMessages } from './helpers-board'
import { useProviders } from '../../../stores/providers'
import { useT } from '../../../lib/i18n'
/** Quién pide un permiso o hace una pregunta en Code: la conversación o un ayudante (subagente) suyo. Solo lectura del almacén. */
import { isChildRequest, subagentNameOf } from './child-sessions'
import { useCode } from './store'

export function useSubagentOfRequest(sessionID: string): { child: boolean; name: string; model: string | null } {
  const t = useT()
  const child = useCode((s) => isChildRequest(s.sessions, sessionID, s.activeSessionID))
  const name = useCode((s) => (child ? subagentNameOf(s.sessions, s.messages, sessionID, t) : ''))
  const ref = useCode((s) => (child ? usageOfMessages(s.messages[sessionID]).model : null))
  const providers = useProviders((s) => s.providers)
  const slash = ref?.indexOf('/') ?? -1
  const model = ref ? (providers.find((p) => p.id === ref.slice(0, slash))?.models[ref.slice(slash + 1)]?.name ?? ref) : null
  return { child, name, model }
}
