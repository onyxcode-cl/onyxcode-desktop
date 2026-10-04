import { useT } from '../../lib/i18n'
import { isRemoteSurface } from '../../lib/platform'
import { LogoMark } from '../Logo'

/**
 * Indicador de «pensando» con la chispa de la marca: el mismo en Chat y en Code. Los tres puntos que rebotan solo se
 * pintan fuera del celular (allí la chispa ya indica actividad; `dots` los fuerza o los quita).
 */
export function ThinkingIndicator({ label, dots }: { label?: string; dots?: boolean }): React.JSX.Element {
  const t = useT()
  const showDots = dots ?? !isRemoteSurface()
  return (
    <div className="flex animate-fade-in items-center gap-2.5 text-sm text-muted" role="status" aria-live="polite">
      <LogoMark size={18} animated />
      <span className="text-shimmer">{label ?? t('chat.msg.thinking')}</span>
      {showDots && (
        <span className="typing-dots flex items-center gap-1 text-subtle">
          <span />
          <span />
          <span />
        </span>
      )}
    </div>
  )
}
