import { ArrowDown } from 'lucide-react'
import { useT } from '../../lib/i18n'

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
      className="absolute bottom-3 left-1/2 flex h-8 w-8 -translate-x-1/2 animate-pop-in items-center justify-center rounded-full border border-border bg-elevated text-muted shadow-md transition-colors hover:text-fg"
    >
      <ArrowDown size={15} />
    </button>
  )
}
