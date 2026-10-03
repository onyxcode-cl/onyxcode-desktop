/**
 * PROVISIONAL (tanda T8 `movil-code`): sustituto mínimo de `Sheet` mientras la tanda T7 (`movil-shell`) no integre el suyo.
 * La API es la acordada con T7: `Sheet({ open, onClose, title, size?, children })`. Al integrar se toma SIEMPRE la versión de
 * T7 de este archivo (no hay nada que fusionar: T8 solo lo consume).
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useT } from '../../lib/i18n'

export interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  /** `half` = hoja inferior; `full` = pantalla completa. */
  size?: 'half' | 'full'
  children: ReactNode
}

export function Sheet({ open, onClose, title, size = 'half', children }: SheetProps): React.JSX.Element | null {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [open, onClose])
  if (!open) return null
  const full = size === 'full'
  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/40" onClick={full ? undefined : onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`flex min-h-0 flex-col bg-bg text-fg shadow-2xl outline-none ${full ? 'h-dvh' : 'max-h-[80dvh] rounded-t-2xl border-t border-border'}`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingTop: full ? 'env(safe-area-inset-top)' : undefined }}
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border pr-1 pl-4">
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('code.chat.close')}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-fg"
          >
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body
  )
}
