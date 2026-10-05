import { useEffect, useId } from 'react'
import type { ReactNode } from 'react'

const WIDTHS = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-xl' } as const

interface Props {
  /** Título visible (se enlaza con `aria-labelledby`). */
  title: string
  onClose: () => void
  size?: keyof typeof WIDTHS
  /** Esc y clic en el velo cierran (por defecto sí). `false` para flujos que no deben descartarse. */
  dismissable?: boolean
  /** `alertdialog` para avisos que exigen respuesta. */
  alert?: boolean
  /** Icono (20 px) en baldosa antes del título. */
  icon?: ReactNode
  children: ReactNode
  /** Pie con las acciones (alineado a la derecha). */
  footer?: ReactNode
  className?: string
}

/**
 * Marco único de los diálogos propios (reemplaza a los superpuestos hechos a mano): velo `--scrim` (oscurece en ambos temas),
 * tarjeta de radio 16 con sombra de nivel 3, `role="dialog" aria-modal` y `aria-labelledby`. El foco entra, queda atrapado y
 * vuelve solo (`installModalFocus` reconoce `aria-modal`). Esc y clic fuera cierran si `dismissable`.
 */
export function DialogFrame({
  title,
  onClose,
  size = 'md',
  dismissable = true,
  alert,
  icon,
  children,
  footer,
  className = ''
}: Props): React.JSX.Element {
  const titleId = useId()
  useEffect(() => {
    if (!dismissable) return undefined
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [dismissable, onClose])

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 p-6 animate-fade-in desk:bg-(--scrim)"
      onMouseDown={dismissable ? onClose : undefined}
    >
      <div
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
        className={`w-full ${WIDTHS[size]} rounded-2xl border border-border bg-elevated p-5 shadow-2xl animate-rise-in desk:rounded-modal desk:shadow-modal ${className}`}
      >
        {icon && (
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent desk:rounded-card">
            {icon}
          </div>
        )}
        <h2 id={titleId} className="text-base font-semibold desk:text-title-sm">
          {title}
        </h2>
        <div className="mt-2 text-sm text-muted">{children}</div>
        {footer && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}
