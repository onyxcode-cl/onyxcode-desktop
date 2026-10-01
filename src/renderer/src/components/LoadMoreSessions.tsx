import { useT } from '../lib/i18n'

/** «Cargar más» al final de una lista de sesiones cuando el servidor devolvió el límite completo. */
export function LoadMoreSessions({
  visible,
  onClick,
  className = ''
}: {
  visible: boolean
  onClick: () => void
  className?: string
}): React.JSX.Element | null {
  const t = useT()
  if (!visible) return null
  return (
    <button
      type="button"
      onClick={onClick}
      className={`no-drag w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] font-medium text-accent hover:bg-hover ${className}`}
    >
      {t('common.sessions.loadMore')}
    </button>
  )
}
