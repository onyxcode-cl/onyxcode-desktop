/**
 * Avance discreto y NO bloqueante de la instalación automática («Preparando herramientas… 40 %»). Aparece abajo a la izquierda mientras
 * se descarga o se espera para reintentar, y desaparece solo al terminar. Si falla de verdad, dice el motivo y ofrece «Reintentar».
 */
import { useState } from 'react'
import { AlertTriangle, Loader2, WifiOff, X } from 'lucide-react'
import { DISPLAY_NAME } from '@shared/brand'
import type { PreflightId } from '@shared/preflight'
import { Button } from '../../components/Button'
import { useT } from '../../lib/i18n'
import { autoPercent, useAutoInstall } from './auto-install'
import { failureKey } from './preflight-view'

export function AutoInstallPill({ onRetry }: { onRetry: () => void }): React.JSX.Element | null {
  const t = useT()
  const s = useAutoInstall()
  const [hidden, setHidden] = useState(false)
  if (s.phase === 'idle') return null
  const shell =
    'pointer-events-auto fixed bottom-3 left-3 z-[70] flex max-w-[min(26rem,calc(100vw-1.5rem))] items-center gap-2 rounded-ctl border border-border bg-elevated px-3 py-2 text-[12px] leading-4 text-fg shadow-lg'
  if (s.phase === 'failed' || s.phase === 'nodisk') {
    if (hidden) return null
    const id = (Object.keys(s.failed)[0] as PreflightId | undefined) ?? 'craft'
    const msg = s.phase === 'nodisk' ? t('autoinstall.nodisk') : t(failureKey(id, s.failed[id]), { app: DISPLAY_NAME })
    return (
      <div role="alert" className={shell} data-testid="autoinstall-pill" data-phase={s.phase}>
        <AlertTriangle size={14} className="shrink-0 text-warning" />
        <span className="min-w-0 flex-1">{msg}</span>
        <Button variant="secondary" size="sm" onClick={() => (setHidden(false), onRetry())}>
          {t('preflight.retry')}
        </Button>
        <button
          type="button"
          aria-label={t('autoinstall.hide')}
          className="shrink-0 text-muted hover:text-fg"
          onClick={() => setHidden(true)}
        >
          <X size={14} />
        </button>
      </div>
    )
  }
  if (s.phase === 'offline' || s.phase === 'waiting')
    return (
      <div role="status" className={shell} data-testid="autoinstall-pill" data-phase={s.phase}>
        <WifiOff size={14} className="shrink-0 text-muted" />
        <span>{t(s.phase === 'offline' ? 'autoinstall.offline' : 'autoinstall.waiting', { app: DISPLAY_NAME })}</span>
      </div>
    )
  const pct = autoPercent(s)
  return (
    <div role="status" className={shell} data-testid="autoinstall-pill" data-phase="running">
      <Loader2 size={14} className="shrink-0 animate-spin text-accent" />
      <span>{t('autoinstall.running', { pct })}</span>
    </div>
  )
}
