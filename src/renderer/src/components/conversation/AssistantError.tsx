import type { AssistantMessage, Part } from '@opencode-ai/sdk/v2/client'
import { readWatchdogMark } from '@shared/watchdog-mark'
import { useT } from '../../lib/i18n'
import { ErrorNotice, type ErrorActions } from './ErrorNotice'

/**
 * Error (o aborto) de un mensaje del asistente.
 * - `panel`: Code y Tareas (aborto sin margen; error con borde/fondo más marcados).
 * - `chat`: Chat (aborto en cursiva; error suave con animación de entrada).
 */
export function AssistantError({
  info,
  abortedLabel,
  parts,
  variant = 'panel',
  onRetry,
  onCompact
}: {
  info: AssistantMessage
  abortedLabel: string
  /** Partes del mensaje: si traen la marca del vigilante del Modo código, el aborto se explica con su causa real. */
  parts?: ReadonlyArray<Part>
  variant?: 'panel' | 'chat'
} & ErrorActions): React.JSX.Element | null {
  const t = useT()
  if (!info.error) return null
  if (info.error.name === 'MessageAbortedError') {
    const mark = readWatchdogMark(parts)
    const key = mark ? (`conv.stoppedByLimit.${mark.limit}` as const) : null
    const params = mark ? { seconds: mark.value, count: mark.value, kb: mark.value } : undefined
    const cause = key ? t(key, params) : null
    // Sin la clave en este diccionario (p. ej. el celular) o sin marca, se queda el texto genérico de siempre.
    const label = cause && cause !== key ? cause : abortedLabel
    return <div className={variant === 'chat' ? 'mt-1 text-xs text-subtle italic' : 'text-xs text-subtle'}>{label}</div>
  }
  return <ErrorNotice error={info.error} variant={variant} onRetry={onRetry} onCompact={onCompact} />
}
