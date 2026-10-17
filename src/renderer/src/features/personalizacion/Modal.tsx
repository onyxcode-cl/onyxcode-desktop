import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { DialogScrim } from '../../components/Dialog'
import { IconButton } from '../../components/IconButton'
import { useT } from '../../lib/i18n'

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Diálogo de Personalización: velo, `role="dialog"`, foco atrapado, Esc cierra (y no cierra Personalización de fondo) y el foco
 * inicial va a `initialFocus` (por defecto, «Cancelar»: Enter no instala ni conecta nada por accidente).
 */
export function Modal({
  labelId,
  onClose,
  busy,
  wide,
  initialFocus,
  header,
  footer,
  children
}: {
  labelId: string
  onClose: () => void
  busy?: boolean
  wide?: boolean
  /** Selector CSS del elemento que recibe el foco al abrir. */
  initialFocus?: string
  header: React.ReactNode
  footer: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const returnTo = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null)

  useEffect(() => {
    const root = ref.current
    const target =
      (initialFocus && root?.querySelector<HTMLElement>(initialFocus)) || root?.querySelector<HTMLElement>('[data-initial-focus]')
    target?.focus()
    const back = returnTo.current
    return () => {
      if (back instanceof HTMLElement) back.focus()
    }
    // solo al montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (!busy) onClose()
        return
      }
      if (e.key !== 'Tab') return
      const root = ref.current
      if (!root) return
      const list = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute('disabled'))
      if (!list.length) return
      const first = list[0]
      const last = list[list.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [busy, onClose])

  return (
    <DialogScrim onDismiss={busy ? undefined : onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        className={`flex max-h-[92vh] w-full flex-col rounded-2xl border border-border bg-elevated shadow-2xl desk:border-transparent desk:shadow-modal ${wide ? 'max-w-3xl' : 'max-w-xl'}`}
      >
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">{header}</div>
          <IconButton label={t('pers.close')} disabled={busy} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>
      </div>
    </DialogScrim>
  )
}
