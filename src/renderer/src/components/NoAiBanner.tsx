import { Plug } from 'lucide-react'
import type { ModelRef } from '@shared/types'
import { NO_AI_BODY, NO_AI_TITLE } from '@shared/ai-errors'
import type { SendGate } from '@shared/ai-availability'
import { useUi } from '../stores/ui'
import { Button } from './Button'

/** Aviso sobre el composer cuando no hay ninguna IA conectada (bloquea el envío) o solo se usa un modelo gratuito. */
export function NoAiBanner({
  gate,
  freeModel,
  onUseFree
}: {
  gate: SendGate
  freeModel: ModelRef | null
  onUseFree: (m: ModelRef) => void
}): React.JSX.Element | null {
  const connect = (): void => useUi.getState().openSettingsAt('models', 'providers')

  if (gate.blocked) {
    return (
      <div
        role="status"
        data-testid="no-ai-banner"
        className="mb-2 flex items-start gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-xs"
      >
        <Plug size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 flex-1 text-muted">
          <div className="text-sm font-medium text-fg">{NO_AI_TITLE}</div>
          <p className="mt-0.5">{NO_AI_BODY}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={connect}>
              Conectar una IA
            </Button>
            {freeModel && (
              <Button size="sm" variant="secondary" onClick={() => onUseFree(freeModel)}>
                Probar un modelo gratuito
              </Button>
            )}
          </div>
        </div>
      </div>
    )
  }
  if (gate.freeNote) {
    return (
      <div role="status" data-testid="free-model-note" className="mb-2 px-1 text-xs text-subtle">
        Estás usando un modelo gratuito de OpenCode. Conecta una IA para acceder a más modelos.{' '}
        <button type="button" onClick={connect} className="no-drag text-accent underline-offset-2 hover:underline">
          Conectar una IA
        </button>
      </div>
    )
  }
  return null
}
