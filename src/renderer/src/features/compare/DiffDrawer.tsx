/** Cajón lateral con el diff de una columna. Se cierra con Esc y devuelve el foco a quien lo abrió. */
import { useEffect, useRef } from 'react'
import { Loader2, X } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { DiffView } from '../../components/DiffView'
import type { DiffState } from './store'

export function DiffDrawer({
  title,
  state,
  onClose,
  returnFocus
}: {
  title: string
  state: DiffState | undefined
  onClose: () => void
  returnFocus?: HTMLElement | null
}): React.JSX.Element {
  const t = useT()
  const closeRef = useRef<HTMLButtonElement>(null)
  const returnRef = useRef(returnFocus)
  returnRef.current = returnFocus

  useEffect(() => {
    closeRef.current?.focus()
    return () => {
      const el = returnRef.current
      if (el && el.isConnected) el.focus()
    }
  }, [])

  return (
    <aside
      role="dialog"
      aria-label={title}
      data-testid="compare-diff-drawer"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
      }}
      className="absolute inset-y-0 right-0 z-30 flex w-[560px] max-w-[90vw] animate-rise-in flex-col border-l border-border bg-elevated shadow-xl"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium">{title}</h2>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          title={t('compare.diff.close')}
          aria-label={t('compare.diff.close')}
          className="no-drag flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg"
        >
          <X size={15} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {(!state || state.status === 'loading') && (
          <div role="status" className="flex items-center gap-2 px-4 py-6 text-[13px] text-muted">
            <Loader2 size={14} className="animate-spin" /> {t('compare.diff.loading')}
          </div>
        )}
        {state?.status === 'error' && (
          <p role="alert" className="px-4 py-6 text-[13px] text-danger">
            {state.message}
          </p>
        )}
        {state?.status === 'ready' && (
          <>
            {state.diff.truncated && (
              <p className="border-b border-border px-4 py-2 text-[12px] text-warning">{t('compare.diff.truncated')}</p>
            )}
            {state.diff.patch.trim() ? (
              <DiffView patch={state.diff.patch} />
            ) : (
              <p className="px-4 py-6 text-[13px] text-muted">{t('compare.diff.none')}</p>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
