import type { ReactNode } from 'react'
import { EMPTY } from './ui/recipes'

interface Props {
  /** Icono de 20 px (lucide) que va en la baldosa. */
  icon?: ReactNode
  title: string
  description?: ReactNode
  /** Acción opcional (normalmente un `Button`). */
  action?: ReactNode
  className?: string
}

/** Estado vacío: baldosa de 40 px con icono de 20, título, texto corto y una acción opcional. */
export function EmptyState({ icon, title, description, action, className = '' }: Props): React.JSX.Element {
  return (
    <div className={`${EMPTY} px-6 py-10 ${className}`}>
      {icon && (
        <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-inset text-muted desk:rounded-card">{icon}</div>
      )}
      <h3 className="text-sm font-medium text-fg desk:text-ui">{title}</h3>
      {description && <p className="max-w-sm text-xs leading-relaxed text-muted desk:text-meta">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
