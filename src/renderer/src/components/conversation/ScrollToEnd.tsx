import { ArrowDown } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { isRemoteSurface } from '../../lib/platform'

/** Botón flotante «Ir al final» (hijo de un contenedor `relative` que envuelve al scroller). */
export function ScrollToEnd({
  visible,
  onClick,
  fresh
}: {
  visible: boolean
  onClick: () => void
  fresh?: boolean
}): React.JSX.Element | null {
  const t = useT()
  if (!visible) return null
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('chat.msg.scrollEnd')}
      title={t('chat.msg.scrollEnd')}
      className={`absolute bottom-3 left-1/2 flex -translate-x-1/2 animate-pop-in items-center justify-center rounded-full border border-border bg-elevated text-muted shadow-md transition-colors hover:text-fg ${isRemoteSurface() ? 'h-10 w-10 text-fg' : 'h-8 w-8'}`}
    >
      <ArrowDown size={isRemoteSurface() ? 18 : 15} />
      {isRemoteSurface() && fresh && <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-accent" />}
    </button>
  )
}
