/**
 * Windows, modo unificado: cuando el agente aislado pide una app y Control del PC no está activado, la tarjeta de consentimiento sale
 * AQUÍ, en el propio chat (antes solo existía en Ajustes). Reusa `ComputerConsentWin` (casilla «Entiendo», botón armado, main
 * vuelve a exigir el armado), así que no hay otra vía de activar el permiso. Sin ese rechazo en la conversación no se muestra nada.
 */
import { useEffect } from 'react'
import { Check } from 'lucide-react'
import { useT } from '../../../lib/i18n'
import type { MessageEntry } from '../../../stores/sessions'
import { ComputerConsentWin } from './ComputerConsentWin'
import { refreshComputerStatus, useTasks } from './store'
import { looksLikeMissingWinConsent } from './util'

export function WinConsentHintCard({ entries }: { entries: MessageEntry[] }): React.JSX.Element | null {
  const t = useT()
  const consent = useTasks((s) => s.computerStatus?.win?.consent)
  const hit = entries.some((e) => e.parts.some((p) => p.type === 'tool' && looksLikeMissingWinConsent(p)))
  useEffect(() => {
    if (hit) void refreshComputerStatus()
  }, [hit])
  if (!hit) return null
  if (consent === true) {
    return (
      <p role="status" className="flex items-center gap-2 rounded-xl border border-border p-3 text-sm text-muted">
        <Check size={14} aria-hidden="true" /> {t('tasksComputer.consentHint.done')}
      </p>
    )
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">{t('tasksComputer.consentHint.intro')}</p>
      <ComputerConsentWin />
    </div>
  )
}
