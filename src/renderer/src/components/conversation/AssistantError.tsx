import type { AssistantMessage } from '@opencode-ai/sdk/v2/client'
import { ErrorNotice, type ErrorActions } from './ErrorNotice'

/**
 * Error (o aborto) de un mensaje del asistente.
 * - `panel`: Code y Tareas (aborto sin margen; error con borde/fondo más marcados).
 * - `chat`: Chat (aborto en cursiva; error suave con animación de entrada).
 */
export function AssistantError({
  info,
  abortedLabel,
  variant = 'panel',
  onRetry,
  onCompact
}: {
  info: AssistantMessage
  abortedLabel: string
  variant?: 'panel' | 'chat'
} & ErrorActions): React.JSX.Element | null {
  if (!info.error) return null
  if (info.error.name === 'MessageAbortedError') {
    return <div className={variant === 'chat' ? 'mt-1 text-xs text-subtle italic' : 'text-xs text-subtle'}>{abortedLabel}</div>
  }
  return <ErrorNotice error={info.error} variant={variant} onRetry={onRetry} onCompact={onCompact} />
}
