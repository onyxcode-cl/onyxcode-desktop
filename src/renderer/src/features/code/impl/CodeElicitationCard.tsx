/**
 * Formulario de un conector en Code: `ElicitationCard` conectada al store de Code. Va aparte para que Chat reutilice la tarjeta sin
 * traer el store de Code.
 */
import { useT } from '../../../lib/i18n'
import { useSettings } from '../../../stores/settings'
import type { ElicitationRequest } from '@shared/mcp-elicitation'
import { ElicitationCard, isTrustedConnector } from './ElicitationCard'
import { useCode } from './store'
import { useSubagentOfRequest } from './subagent-of-request'

/** El conector de confianza sale de los Ajustes («Sin preguntar en Code»); si viene de un ayudante, se dice. */
export function CodeElicitationCard({ request }: { request: ElicitationRequest }): React.JSX.Element {
  const t = useT()
  const reply = useCode((s) => s.replyElicitation)
  const trustedList = useSettings((s) => s.settings.codeTrustedMcp)
  const sub = useSubagentOfRequest(request.sessionID)
  const helperLabel = sub.child ? (sub.name ? t('code.q.fromSubagent', { name: sub.name }) : t('code.q.fromSubagentAnon')) : undefined
  return (
    <ElicitationCard
      key={request.id}
      request={request}
      trusted={isTrustedConnector(request.server, trustedList ?? [])}
      helperLabel={helperLabel}
      onSubmit={(action, content) => reply(request, action, content)}
    />
  )
}
