import type { ReactNode } from 'react'
import { ChevronRight, type LucideIcon } from 'lucide-react'

/**
 * Lista agrupada del celular: encabezado de grupo opcional, tarjeta con filas separadas por filetes y pie opcional.
 * Solo se usa en la superficie móvil; las medidas salen de los tokens `--m-*`.
 */
export function ListGroup({
  title,
  footer,
  children,
  className = ''
}: {
  title?: string
  footer?: ReactNode
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <section data-m="list-group" className={className}>
      {title && <h2 className="px-4 pb-1.5 text-[12px] leading-4 font-semibold text-subtle">{title}</h2>}
      <div className="divide-y divide-[var(--m-hairline)] overflow-hidden rounded-[var(--m-card-radius)] bg-elevated shadow-sm">
        {children}
      </div>
      {footer && <p className="px-4 pt-1.5 text-[13px] leading-snug text-muted">{footer}</p>}
    </section>
  )
}

/** Fila de una lista agrupada: icono sin baldosa, etiqueta, dato final opcional y chevron (si es navegable). */
export function ListRow({
  icon: Icon,
  label,
  hint,
  detail,
  onClick,
  tone = 'default',
  chevron = true
}: {
  icon?: LucideIcon
  label: string
  hint?: string
  /** Dato final (p. ej. el estado de la conexión). */
  detail?: ReactNode
  onClick?: () => void
  tone?: 'default' | 'danger'
  chevron?: boolean
}): React.JSX.Element {
  const danger = tone === 'danger'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left active:bg-hover ${danger ? 'text-danger' : 'text-fg'}`}
    >
      {Icon && <Icon size={18} className={`shrink-0 ${danger ? 'text-danger' : 'text-muted'}`} aria-hidden="true" />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] leading-5">{label}</span>
        {hint && <span className="text-[13px] leading-snug text-muted">{hint}</span>}
      </span>
      {detail && <span className="flex shrink-0 items-center gap-2 text-[14px] text-muted">{detail}</span>}
      {chevron && onClick && <ChevronRight size={18} className="shrink-0 text-subtle" aria-hidden="true" />}
    </button>
  )
}
