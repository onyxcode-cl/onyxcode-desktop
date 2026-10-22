/** Quién pide un permiso o hace una pregunta en Code: la conversación o un ayudante (subagente) suyo. Solo lectura del almacén. */
import { isChildRequest, subagentNameOf } from './child-sessions'
import { useCode } from './store'

export function useSubagentOfRequest(sessionID: string): { child: boolean; name: string } {
  const child = useCode((s) => isChildRequest(s.sessions, sessionID, s.activeSessionID))
  const name = useCode((s) => (child ? subagentNameOf(s.sessions, s.messages, sessionID) : ''))
  return { child, name }
}
