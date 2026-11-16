import type { ToolPart } from '@opencode-ai/sdk/v2/client'
import { useProviders } from '../../stores/providers'
import { useSessions } from '../../stores/sessions'
import { useT } from '../../lib/i18n'

/** Metadata de task es la fuente preferida; la sesión hija sirve mientras el ayudante trabaja. */
export function HelperModelNote({ part }: { part: ToolPart }): React.JSX.Element | null {
  const t = useT()
  const metadata = 'metadata' in part.state ? part.state.metadata : undefined
  const childID = typeof metadata?.sessionId === 'string' ? metadata.sessionId : ''
  const entries = useSessions((s) => s.messages[childID])
  const sessionModel = useSessions((s) => s.sessions[childID]?.model)
  const providers = useProviders((s) => s.providers)
  if (part.tool !== 'task') return null
  let model = typeof metadata?.modelName === 'string' ? metadata.modelName.trim() : ''
  if (!model) {
    const last = [...(entries ?? [])].reverse().find((e) => e.info.role === 'assistant' || e.info.role === 'user')?.info
    const ref =
      last?.role === 'assistant'
        ? last
        : last?.role === 'user'
          ? last.model
          : sessionModel
            ? { providerID: sessionModel.providerID, modelID: sessionModel.id }
            : undefined
    if (ref) model = providers.find((p) => p.id === ref.providerID)?.models[ref.modelID]?.name ?? `${ref.providerID}/${ref.modelID}`
  }
  if (!model) return null
  return (
    <p data-testid="helper-model" className="mt-1 ml-7 text-xs text-muted break-words">
      {t('helpers.model', { model })}
    </p>
  )
}
