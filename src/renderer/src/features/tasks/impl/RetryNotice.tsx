/**
 * Aviso «el modelo no responde y se está reintentando» en lugar de «Pensando…» mientras la sesión está en `retry`.
 * Dice el motivo (uso gratuito agotado, clave inválida, red, saturación…) y qué hacer; el texto sale de `lib/retry-info`
 * (mensaje del proveedor ya limpio de claves). Sustituye a la tarjeta de trabajo y silencia «Sin actividad» (ver `StallNotice`).
 */
import { AlertTriangle } from 'lucide-react'
import { useT } from '../../../lib/i18n'
import { useRetryInfo, useRetryLabel, type RetryKind } from '../../../lib/retry-info'
import { useSessions } from '../../../stores/sessions'

const TITLE = {
  free: 'tasks.retry.title.free',
  auth: 'tasks.retry.title.auth',
  network: 'tasks.retry.title.network',
  quota: 'tasks.retry.title.quota',
  unavailable: 'tasks.retry.title.unavailable',
  other: 'tasks.retry.title.other'
} as const satisfies Record<RetryKind, string>

/** `true` mientras la sesión reintenta (estado del motor), con o sin motivo conocido. */
export function useIsRetrying(sessionId: string | null | undefined): boolean {
  return useSessions((s) => (sessionId ? s.status[sessionId] === 'retry' : false))
}

export function RetryNotice({ sessionId }: { sessionId: string }): React.JSX.Element | null {
  const t = useT()
  const retrying = useIsRetrying(sessionId)
  const kind = useRetryInfo((s) => s.bySession[sessionId]?.kind ?? 'other')
  const body = useRetryLabel(sessionId)
  if (!retrying) return null
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="retry-notice"
      className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs desk:rounded-ctl desk:border-transparent desk:text-ui desk:ring-1 desk:ring-inset desk:ring-warning/45"
    >
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t(TITLE[kind])}</p>
        <p className="mt-0.5 text-muted">{body ?? t('chat.msg.retrying')}</p>
        <p className="mt-0.5 text-muted">{t('tasks.retry.wait')}</p>
      </div>
    </div>
  )
}
