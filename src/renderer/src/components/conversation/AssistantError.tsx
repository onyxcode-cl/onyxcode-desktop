import type { AssistantMessage } from '@opencode-ai/sdk/v2/client'
import { AlertCircle } from 'lucide-react'
import { errorMessage } from '../../lib/opencode'

/**
 * Error (o aborto) de un mensaje del asistente.
 * - `panel`: Code y Tareas (aborto sin margen; error con borde/fondo más marcados).
 * - `chat`: Chat (aborto en cursiva; error suave con animación de entrada).
 */
export function AssistantError({
  info,
  abortedLabel,
  variant = 'panel'
}: {
  info: AssistantMessage
  abortedLabel: string
  variant?: 'panel' | 'chat'
}): React.JSX.Element | null {
  if (!info.error) return null
  const chat = variant === 'chat'
  if (info.error.name === 'MessageAbortedError') {
    return <div className={chat ? 'mt-1 text-xs text-subtle italic' : 'text-xs text-subtle'}>{abortedLabel}</div>
  }
  return (
    <div
      className={
        chat
          ? 'mt-2 flex animate-fade-in items-start gap-2 rounded-lg border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-danger'
          : 'flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger'
      }
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span>{errorMessage(info.error)}</span>
    </div>
  )
}
