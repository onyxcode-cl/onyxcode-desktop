import { ArrowDown } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { isRemoteSurface } from '../../lib/platform'

/** Botón flotante «Ir al final» (hijo de un contenedor `relative` que envuelve al scroller). */
export function ScrollToEnd({ visible, onClick }: { visible: boolean; onClick: () => void }): React.JSX.Element | null {
  const t = useT()
  if (!visible) return null
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('chat.msg.scrollEnd')}
      title={t('chat.msg.scrollEnd')}
      className={`absolute bottom-3 left-1/2 flex -translate-x-1/2 animate-pop-in items-center justify-center rounded-full border border-border bg-elevated text-muted shadow-md transition-colors hover:text-fg ${isRemoteSurface() ? 'h-11 w-11' : 'h-8 w-8'}`}
    >
      <ArrowDown size={15} />
    </button>
  )
}
